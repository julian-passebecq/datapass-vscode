/**
 * The committed work-order summary (pass AI-2, Julian's answer Q2 in handoff/v3/09 §13.1): format
 * `datapass.work-log`, version `1` (Galaxy contract datapass.work-log/1). Pure.
 *
 *   <coordination repository>/.datapass/work-log.json     one per project, committed with the project
 *   <private log repository>/work-logs/<project id>.json  the same format, across projects, in a
 *                                                          private repository named by a machine setting
 *
 * ChatGPT (and so Mongoku, which reads GitHub files only) can read it on GitHub. It holds what
 * happened, never how: order id, title, kind, dates, statuses, the repositories by their declared
 * remote, planned branches and pull requests. Never the goal text, the agent's summary, questions,
 * local paths, session ids, receipts or any credential. DataPass writes it when the person clicks
 * *Publish summary*; it never commits or pushes it.
 */
import { anyOf, arr, constOf, enumOf, obj, validateSchema, type Schema } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { scrub } from "../exchange/aiContext";
import { gitHostOf, remoteIdentity } from "../project/gitHosts";
import {
  AGENT_TOOLS, ORDER_KINDS, ORDER_STATUSES, PROJECT_TYPES, RESULT_STATUSES, SURFACES, WorkOrderFormatError,
  type AgentTool, type OrderKind, type OrderState, type OrderStatus, type ProjectType, type ResultStatus, type Surface, type WorkOrder
} from "./format";

export const WORK_LOG_FORMAT = "datapass.work-log";
export const WORK_LOG_PATH = ".datapass/work-log.json";
export const PRIVATE_LOG_DIR = "work-logs";
export const MAX_LOG_ENTRIES = 500;
export const MAX_LOG_BYTES = 2 * 1024 * 1024;
/** This public repository: never a private log repository. */
export const DATAPASS_PUBLIC_REPOSITORY = "github.com/julian-passebecq/datapass-vscode";

const S = (maxLength: number, minLength = 1, pattern?: string): Schema => ({ type: "string", minLength, maxLength, ...(pattern ? { pattern } : {}) });
const TIME: Schema = { type: "string", format: "date-time" };
const REF: Schema = S(100, 1, "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$");
const ORDER_ID: Schema = S(21, 21, "^wo-\\d{8}-\\d{4}-[0-9a-z]{4}$");
const NULLABLE_ORDER: Schema = anyOf(ORDER_ID, { type: "null" });

const LOG_PR: Schema = obj({ number: { type: "integer", minimum: 1, maximum: 1e9 }, url: S(2000, 1, "^https://\\S+$"), state: enumOf("open", "merged", "closed") });
const LOG_ENTRY: Schema = obj({
  id: ORDER_ID, title: S(80), kind: enumOf(...ORDER_KINDS), createdAt: TIME, status: enumOf(...ORDER_STATUSES),
  agent: obj({ tool: enumOf(...AGENT_TOOLS), surface: enumOf(...SURFACES) }),
  scope: obj({ subproject: REF, components: arr(REF, 30), boardCard: REF, decision: REF }, []),
  repositories: arr(obj({
    ref: REF, remote: S(500, 1, "^(https://|git@|ssh://)[^\\s]+$"), access: enumOf("change", "read"),
    branch: S(200, 1, "^[A-Za-z0-9._/-]{1,200}$"), pullRequests: arr(LOG_PR, 10)
  }, ["ref", "access"]), 30),
  result: anyOf({ type: "null" }, obj({ status: enumOf(...RESULT_STATUSES), questions: { type: "integer", minimum: 0, maximum: 20 } })),
  links: obj({ revises: NULLABLE_ORDER, followsUp: NULLABLE_ORDER }),
  closedAt: anyOf({ type: "null" }, TIME)
}, ["id", "title", "kind", "createdAt", "status", "agent", "repositories", "result", "links", "closedAt"]);

export const WORK_LOG_SCHEMA: Schema = obj({
  $schema: S(500),
  format: constOf(WORK_LOG_FORMAT), version: constOf("1"),
  note: S(500),
  project: obj({ id: S(120), title: S(200), type: enumOf(...PROJECT_TYPES), company: S(60) }, ["id", "title", "type"]),
  updatedAt: TIME,
  entries: arr(LOG_ENTRY, MAX_LOG_ENTRIES)
}, ["format", "version", "project", "updatedAt", "entries"]);

export interface WorkLogPr { number: number; url: string; state: "open" | "merged" | "closed" }
export interface WorkLogEntry {
  id: string;
  title: string;
  kind: OrderKind;
  createdAt: string;
  status: OrderStatus;
  agent: { tool: AgentTool; surface: Surface };
  scope?: { subproject?: string; components?: string[]; boardCard?: string; decision?: string };
  repositories: Array<{ ref: string; remote?: string; access: "change" | "read"; branch?: string; pullRequests?: WorkLogPr[] }>;
  result: null | { status: ResultStatus; questions: number };
  links: { revises: string | null; followsUp: string | null };
  closedAt: string | null;
}
export interface WorkLog {
  $schema?: string;
  format: typeof WORK_LOG_FORMAT;
  version: "1";
  note?: string;
  project: { id: string; title: string; type: ProjectType; company?: string };
  updatedAt: string;
  entries: WorkLogEntry[];
}

const NOTE = "Work orders DataPass prepared for this project: ids, titles, dates, statuses, planned branches and pull requests. No goal text, agent output, local path or secret. Written by DataPass (Publish summary); commit it like any project file.";

export function parseWorkLog(raw: string | Uint8Array): WorkLog {
  let doc: unknown;
  try { doc = parseStrictJson(raw, { maxBytes: MAX_LOG_BYTES, maxDepth: 10, maxEntries: 200_000 }); }
  catch (e) { throw new WorkOrderFormatError(`work-log.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
  const issues = validateSchema(WORK_LOG_SCHEMA, doc);
  if (issues.length) throw new WorkOrderFormatError("Invalid work-log.json", issues);
  const log = doc as WorkLog;
  const ids = log.entries.map(e => e.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new WorkOrderFormatError(`work-log.json lists ${dup} twice`);
  return log;
}

/** One line of text for a public file: credentials and local paths removed, control characters gone. */
export function publicText(text: string, max: number): string {
  const clean = scrub(text).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || "(untitled)";
}

/** What the order says, what the person decided and what DataPass saw on the host — nothing the agent wrote except its status. */
export function workLogEntry(order: WorkOrder, state: OrderState | undefined, result: { status: ResultStatus; questions: number } | undefined): WorkLogEntry {
  const prs = state?.seen.pullRequests ?? [];
  const scope = Object.fromEntries(Object.entries(order.scope).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  return {
    id: order.id,
    title: publicText(order.title, 80),
    kind: order.kind,
    createdAt: order.createdAt,
    status: state?.status ?? "written",
    agent: { tool: order.agent.tool, surface: order.agent.surface },
    ...(Object.keys(scope).length ? { scope } : {}),
    repositories: order.repositories.map(r => {
      const own = prs.filter(p => p.repoRef === r.ref).slice(0, 10).map(p => ({ number: p.number, url: p.url, state: p.state }));
      return {
        ref: r.ref, ...(publicRemote(r.remote) ? { remote: publicRemote(r.remote) } : {}), access: r.access,
        ...(r.branch ? { branch: r.branch } : {}), ...(own.length ? { pullRequests: own } : {})
      };
    }),
    result: result ? { status: result.status, questions: Math.min(20, result.questions) } : null,
    links: { ...order.links },
    closedAt: state?.closed?.at ?? null
  };
}

/** The log with these entries added or replaced (by id), newest first, at most MAX_LOG_ENTRIES. */
export function mergeWorkLog(existing: WorkLog | undefined, project: WorkLog["project"], entries: readonly WorkLogEntry[], now: string): WorkLog {
  const byId = new Map((existing?.entries ?? []).map(e => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  const sorted = [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1)).slice(0, MAX_LOG_ENTRIES);
  return {
    format: WORK_LOG_FORMAT, version: "1", note: NOTE,
    project: { id: project.id, title: publicText(project.title, 200), type: project.type, ...(project.company ? { company: publicText(project.company, 60) } : {}) },
    updatedAt: now,
    entries: sorted
  };
}

export function serializeWorkLog(log: WorkLog): string {
  const issues = validateSchema(WORK_LOG_SCHEMA, log);
  if (issues.length) throw new WorkOrderFormatError("The work log would be invalid", issues);
  return JSON.stringify(log, null, 2) + "\n";
}

/**
 * A remote address safe to write into an order or a committed file: the host's canonical https page
 * when DataPass knows the host (no user, token or port), else the address without any user
 * information. Undefined when nothing safe is left.
 */
export function publicRemote(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const u = url.trim();
  const host = gitHostOf(u);
  if (host) return host.web;
  if (/^git@[A-Za-z0-9.-]+:[^\s]+$/.test(u)) return u;
  const m = /^(https|ssh):\/\/(?:[^@/\s]*@)?([^/\s]+\/[^\s]+)$/.exec(u);
  return m ? `${m[1]}://${m[2]}` : undefined;
}

/** File of a project inside the private log repository (a safe file name from the project id). */
export function privateLogFile(projectId: string): string {
  const base = projectId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 80) || "project";
  return `${PRIVATE_LOG_DIR}/${base}.json`;
}

export type PrivateRepoVerdict = { ok: true } | { ok: false; why: string };

/**
 * The private log repository must be a Git clone whose origin is neither this public repository nor
 * a repository of the project itself. Whether the host keeps it private is checked separately (gh).
 */
export function privateRepoVerdict(originUrl: string | undefined, projectRemotes: readonly (string | undefined)[]): PrivateRepoVerdict {
  const id = remoteIdentity(originUrl);
  if (!id) return { ok: false, why: "it has no origin remote DataPass recognises" };
  if (id === DATAPASS_PUBLIC_REPOSITORY) return { ok: false, why: "it is the public DataPass repository" };
  if (projectRemotes.some(r => remoteIdentity(r) === id)) return { ok: false, why: "it is a repository of this project (the per-project log already lives in .datapass/work-log.json)" };
  return { ok: true };
}
