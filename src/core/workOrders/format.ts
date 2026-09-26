/**
 * Work orders (pass AI-2, handoff/v3/09 §4 and §13.1): the file formats and their strict parsers. Pure.
 *
 *   <coordination repository>/.datapass/local/work-orders/<id>/
 *     order.md, order.json, attachments/   DataPass, written once (the agent reads them)
 *     state.json                            DataPass only
 *     result.json, proposed/<kind>.json     the agent only: untrusted input
 *
 * The schema objects below are the single source: they are emitted as JSON Schema files for editors
 * (schemas/datapass-work-order*.schema.json) and interpreted at runtime, so the two cannot drift.
 * Semantic rules the schema cannot express (the receipt, PR addresses on the declared repositories,
 * credential-shaped text) are checked after it.
 */
import { anyOf, arr, constOf, enumOf, obj, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { gitHostOf } from "../project/gitHosts";
import { sensitiveFindings } from "../project/aiExchange";

export const ORDER_FORMAT = "datapass.work-order";
export const STATE_FORMAT = "datapass.work-order-state";
export const RESULT_FORMAT = "datapass.work-order-result";
export const FORMAT_VERSION = "1";

/** Where orders live, relative to the coordination repository (git-ignored through .datapass/local). */
export const WORK_ORDERS_DIR = ".datapass/local/work-orders";
export const ARCHIVE_DIR = "archive";
export const ORDERS_KEPT = 100;

export const ORDER_ID_RE = /^wo-\d{8}-\d{4}-[0-9a-z]{4}$/;
/** Receipt alphabet: no 0/O or 1/I, so it can be read aloud and typed back. Not a secret. */
export const RECEIPT_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const RECEIPT_RE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
/** Claude Control's builders find a work-order conversation with this on the first user message (Galaxy datapass.work-order-marker/1). */
export const MARKER_RE = /\bDataPass work order (wo-\d{8}-\d{4}-[0-9a-z]{4})\b/;
export const MAX_ORDER_BYTES = 256 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024;
export const MAX_STATE_BYTES = 256 * 1024;

export const ORDER_KINDS = ["change", "investigate", "prepare-files", "apply-decision", "fix-card", "datapass-files", "pilot-read"] as const;
export type OrderKind = typeof ORDER_KINDS[number];
export const AGENT_TOOLS = ["claude-code", "codex"] as const;
export type AgentTool = typeof AGENT_TOOLS[number];
export const SURFACES = ["desktop", "terminal"] as const;
export type Surface = typeof SURFACES[number];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = typeof EFFORTS[number];
export const MERGE_POLICIES = ["person", "agent-when-green"] as const;
export type MergePolicy = typeof MERGE_POLICIES[number];
export const PROJECT_TYPES = ["dev", "work", "perso"] as const;
export type ProjectType = typeof PROJECT_TYPES[number];
/** The DataPass files an order can name (the AI exchange kinds; "project" is project.json). */
export const DATAPASS_FILE_KINDS = ["project", "graph", "options", "sheet", "board", "catalog"] as const;
export type DataPassFileKind = typeof DATAPASS_FILE_KINDS[number];
/** 0.26 (AI-4a): the CLIs a pilot order names (stage 1: az and func; fab and databricks later, each behind its flag). */
export const PILOT_ORDER_CLIS = ["az", "func", "fab", "databricks"] as const;
export type PilotOrderCli = typeof PILOT_ORDER_CLIS[number];
export const ORDER_STATUSES = ["written", "launched", "reported", "done", "abandoned"] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const RESULT_STATUSES = ["done", "partial", "blocked", "failed"] as const;
export type ResultStatus = typeof RESULT_STATUSES[number];

// ------------------------------------------------------------------ field schemas

const S = (maxLength: number, minLength = 1, pattern?: string): Schema => ({ type: "string", minLength, maxLength, ...(pattern ? { pattern } : {}) });
const ORDER_ID: Schema = S(21, 21, "^wo-\\d{8}-\\d{4}-[0-9a-z]{4}$");
const RECEIPT: Schema = S(9, 9, "^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$");
/** Repository keys, component, sub-project, card and decision ids of the project. */
const REF: Schema = S(100, 1, "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$");
const TIME: Schema = { type: "string", format: "date-time" };
const BRANCH: Schema = S(200, 1, "^(?!.*\\.\\.)(?!/)(?!.*/$)[A-Za-z0-9._/-]{1,200}$");
const COMMIT: Schema = S(40, 7, "^[0-9a-f]{7,40}$");
const BASE_COMMIT: Schema = S(40, 12, "^[0-9a-f]{12,40}$");
/** An absolute path on this machine (Windows drive or POSIX), without control characters. */
const ABS_PATH: Schema = S(400, 2, "^(?:[A-Za-z]:[\\\\/]|/)[^\\u0000-\\u001f\\u007f]*$");
/** Repository-relative, never absolute, never climbing out. */
const REL_PATH: Schema = S(300, 1, "^(?![/\\\\~])(?![A-Za-z]:)(?!.*(^|[/\\\\])\\.\\.([/\\\\]|$))[^\\u0000-\\u001f\\u007f]+$");
/** Paths inside the order folder (attachments/…, proposed/…). */
const ORDER_REL: Schema = S(200, 1, "^(attachments|proposed)/[A-Za-z0-9._/-]*$");
const REMOTE: Schema = S(500, 1, "^(https://|git@|ssh://)[^\\s]+$");
const UUID: Schema = S(36, 36, "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
const MODEL: Schema = S(60, 1, "^[a-z0-9.-]{1,60}$");
const HTTPS: Schema = S(2000, 1, "^https://\\S+$");
const NULLABLE_ORDER: Schema = anyOf(ORDER_ID, { type: "null" });

const ORDER_REPOSITORY: Schema = obj({
  ref: REF, remote: REMOTE, localPath: ABS_PATH, access: enumOf("change", "read"),
  base: obj({ branch: BRANCH, commit: BASE_COMMIT }), branch: BRANCH, hadLocalChanges: { type: "boolean" }
}, ["ref", "localPath", "access"]);
const REPO_FILE: Schema = obj({ repoRef: REF, path: REL_PATH });

export const WORK_ORDER_SCHEMA: Schema = obj({
  format: constOf(ORDER_FORMAT), version: constOf(FORMAT_VERSION),
  id: ORDER_ID, receipt: RECEIPT, title: S(80), createdAt: TIME, createdBy: S(60),
  kind: enumOf(...ORDER_KINDS),
  project: obj({ id: S(120), title: S(200), coordination: REMOTE, type: enumOf(...PROJECT_TYPES) }, ["id", "title", "type"]),
  scope: obj({ subproject: REF, components: arr(REF, 30), boardCard: REF, decision: REF }, []),
  goal: S(8000),
  repositories: arr(ORDER_REPOSITORY, 30, 1),
  context: obj({
    datapassFiles: arr(enumOf(...DATAPASS_FILE_KINDS), 6), conventions: arr(REPO_FILE, 30), handoffs: arr(REPO_FILE, 20),
    attachments: arr(ORDER_REL, 40)
  }),
  expected: obj({
    pullRequests: enumOf("one-per-changed-repository", "none"),
    datapassFiles: arr(obj({ kind: enumOf(...DATAPASS_FILE_KINDS), via: enumOf("pull-request", "import") }), 6),
    boardMoves: arr(obj({ card: REF, to: REF }), 20),
    checks: arr(obj({ repoRef: REF, text: S(500) }, ["text"]), 20),
    doneWhen: arr(S(1000), 10)
  }),
  policy: obj({ merge: enumOf(...MERGE_POLICIES), cloud: enumOf("none", "read-only"), secrets: constOf("never"), stayInRepositories: constOf(true) }),
  pilot: obj({ stage: constOf(1), environment: REF, clis: arr(enumOf(...PILOT_ORDER_CLIS), 4, 1) }),
  agent: obj({ tool: enumOf(...AGENT_TOOLS), surface: enumOf(...SURFACES), model: MODEL, effort: enumOf(...EFFORTS), sessionId: UUID, permissions: enumOf("usual", "ask") }, ["tool", "surface", "effort", "permissions"]),
  result: obj({ path: ABS_PATH }),
  links: obj({ revises: NULLABLE_ORDER, followsUp: NULLABLE_ORDER })
}, ["format", "version", "id", "receipt", "title", "createdAt", "createdBy", "kind", "project", "scope", "goal", "repositories", "context", "expected", "policy", "agent", "result", "links"]);

const SEEN_PR: Schema = obj({
  repoRef: REF, url: HTTPS, number: { type: "integer", minimum: 1, maximum: 1e9 }, state: enumOf("open", "merged", "closed"),
  ci: enumOf("passing", "failing", "running", "none", "unknown"), headBranch: BRANCH, checkedAt: TIME
}, ["repoRef", "url", "number", "state", "headBranch", "checkedAt"]);

export const WORK_ORDER_STATE_SCHEMA: Schema = obj({
  format: constOf(STATE_FORMAT), version: constOf(FORMAT_VERSION),
  orderId: ORDER_ID, digest: S(71, 71, "^sha256:[0-9a-f]{64}$"), status: enumOf(...ORDER_STATUSES),
  launches: arr(obj({
    at: TIME, tool: enumOf(...AGENT_TOOLS), surface: enumOf(...SURFACES), sessionId: UUID, cwd: ABS_PATH, how: enumOf("launched", "copied")
  }, ["at", "tool", "surface", "how"]), 50),
  seen: obj({ pullRequests: arr(SEEN_PR, 60), checkedAt: TIME }, ["pullRequests"]),
  imported: arr(obj({ kind: enumOf(...DATAPASS_FILE_KINDS), at: TIME, backup: S(200) }, ["kind", "at"]), 20),
  published: obj({ at: TIME, workLog: { type: "boolean" }, privateLog: { type: "boolean" } }, ["at"]),
  closed: anyOf({ type: "null" }, obj({ at: TIME, how: enumOf("done", "abandoned"), note: S(1000) }, ["at", "how"]))
}, ["format", "version", "orderId", "digest", "status", "launches", "seen", "closed"]);

export const WORK_ORDER_RESULT_SCHEMA: Schema = obj({
  $schema: S(500),
  format: constOf(RESULT_FORMAT), version: constOf(FORMAT_VERSION),
  orderId: ORDER_ID, receipt: RECEIPT, status: enumOf(...RESULT_STATUSES),
  summary: S(4000),
  repositories: arr(obj({ ref: REF, branch: BRANCH, commits: arr(COMMIT, 100), pullRequest: S(2000, 1) }, ["ref"]), 30),
  datapassFiles: arr(obj({ kind: enumOf(...DATAPASS_FILE_KINDS), via: enumOf("pull-request", "import") }), 6),
  checks: arr(obj({ what: S(500), outcome: enumOf("passed", "failed", "not-run"), note: S(1000) }, ["what", "outcome"]), 30),
  questions: arr(S(1000), 20),
  followUps: arr(obj({ title: S(80), why: S(1000) }, ["title"]), 10),
  agent: obj({ tool: S(60), model: S(100) }, []),
  finishedAt: TIME
}, ["format", "version", "orderId", "receipt", "status", "summary"]);

// ------------------------------------------------------------------ types

export interface OrderRepository {
  ref: string;
  remote?: string;
  localPath: string;
  access: "change" | "read";
  base?: { branch: string; commit: string };
  branch?: string;
  hadLocalChanges?: boolean;
}
export interface RepoFile { repoRef: string; path: string }
export interface WorkOrder {
  format: typeof ORDER_FORMAT;
  version: typeof FORMAT_VERSION;
  id: string;
  receipt: string;
  title: string;
  createdAt: string;
  createdBy: string;
  kind: OrderKind;
  project: { id: string; title: string; coordination?: string; type: ProjectType };
  scope: { subproject?: string; components?: string[]; boardCard?: string; decision?: string };
  goal: string;
  repositories: OrderRepository[];
  context: { datapassFiles: DataPassFileKind[]; conventions: RepoFile[]; handoffs: RepoFile[]; attachments: string[] };
  expected: {
    pullRequests: "one-per-changed-repository" | "none";
    datapassFiles: Array<{ kind: DataPassFileKind; via: "pull-request" | "import" }>;
    boardMoves: Array<{ card: string; to: string }>;
    checks: Array<{ repoRef?: string; text: string }>;
    doneWhen: string[];
  };
  policy: { merge: MergePolicy; cloud: "none" | "read-only"; secrets: "never"; stayInRepositories: true };
  /** 0.26 (AI-4a): only on `kind: pilot-read` (stage 1: read-only, one environment, the CLIs the agent may run). */
  pilot?: { stage: 1; environment: string; clis: PilotOrderCli[] };
  agent: { tool: AgentTool; surface: Surface; model?: string; effort: Effort; sessionId?: string; permissions: "usual" | "ask" };
  result: { path: string };
  links: { revises: string | null; followsUp: string | null };
}

export interface SeenPr { repoRef: string; url: string; number: number; state: "open" | "merged" | "closed"; ci?: "passing" | "failing" | "running" | "none" | "unknown"; headBranch: string; checkedAt: string }
export interface OrderLaunch { at: string; tool: AgentTool; surface: Surface; sessionId?: string; cwd?: string; how: "launched" | "copied" }
export interface OrderState {
  format: typeof STATE_FORMAT;
  version: typeof FORMAT_VERSION;
  orderId: string;
  digest: string;
  status: OrderStatus;
  launches: OrderLaunch[];
  seen: { pullRequests: SeenPr[]; checkedAt?: string };
  imported?: Array<{ kind: DataPassFileKind; at: string; backup?: string }>;
  published?: { at: string; workLog?: boolean; privateLog?: boolean };
  closed: null | { at: string; how: "done" | "abandoned"; note?: string };
}

export interface ResultRepository { ref: string; branch?: string; commits?: string[]; pullRequest?: string }
export interface WorkOrderResult {
  $schema?: string;
  format: typeof RESULT_FORMAT;
  version: typeof FORMAT_VERSION;
  orderId: string;
  receipt: string;
  status: ResultStatus;
  summary: string;
  repositories?: ResultRepository[];
  datapassFiles?: Array<{ kind: DataPassFileKind; via: "pull-request" | "import" }>;
  checks?: Array<{ what: string; outcome: "passed" | "failed" | "not-run"; note?: string }>;
  questions?: string[];
  followUps?: Array<{ title: string; why?: string }>;
  agent?: { tool?: string; model?: string };
  finishedAt?: string;
}

/** A result checked against its order: PR addresses rebuilt from the declared repository, warnings for what was dropped. */
export interface CheckedResult {
  result: WorkOrderResult;
  /** Per repository ref: the PR number and its canonical page (rebuilt, never the agent's text). */
  pullRequests: Array<{ ref: string; number: number; url: string; branch?: string }>;
  warnings: string[];
}
export type ResultVerdict =
  | { ok: true; checked: CheckedResult }
  | { ok: false; why: "too-large" | "invalid" | "other-order" | "sensitive"; message: string };

export class WorkOrderFormatError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
    this.name = "WorkOrderFormatError";
  }
}

// ------------------------------------------------------------------ ids

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** wo-YYYYMMDD-HHMM-xxxx: local time plus four random base-36 characters. */
export function newOrderId(now: Date, random: Uint8Array): string {
  const suffix = [...random.slice(0, 4)].map(b => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
  if (suffix.length !== 4) throw new Error("four random bytes are needed");
  return `wo-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}-${suffix}`;
}

/** Eight random characters XXXX-XXXX; the result must repeat it. It binds a result to this exact order; it is not a secret. */
export function newReceipt(random: Uint8Array): string {
  const c = [...random.slice(0, 8)].map(b => RECEIPT_ALPHABET[b % RECEIPT_ALPHABET.length]).join("");
  if (c.length !== 8) throw new Error("eight random bytes are needed");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** The short name of an order in lists: its last four characters. */
export const shortId = (id: string) => id.slice(-4);

/** ISO 8601 with the local offset (2026-09-25T18:30:12+02:00). */
export function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The one-line first prompt, the same for every tool and surface (§5). Its wording is a Galaxy contract. */
export function markerLine(order: Pick<WorkOrder, "id">, orderMdPath: string): string {
  return `DataPass work order ${order.id}: read ${orderMdPath} and follow it.`;
}

// ------------------------------------------------------------------ parsers

function strict(raw: string | Uint8Array, maxBytes: number, what: string): unknown {
  const size = typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.length;
  if (size > maxBytes) throw new WorkOrderFormatError(`${what} is larger than ${Math.round(maxBytes / 1024)} KiB`);
  try {
    return parseStrictJson(raw, { maxBytes, maxDepth: 12, maxEntries: 20_000, maxStringLength: 20_000 });
  } catch (e) {
    throw new WorkOrderFormatError(`${what} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function checkSchema(schema: Schema, doc: unknown, what: string): void {
  const issues = validateSchema(schema, doc);
  if (issues.length) throw new WorkOrderFormatError(`Invalid ${what}`, issues);
}

/** order.json, as DataPass wrote it (it is still re-read strictly: the folder is on disk and could be edited). */
export function parseWorkOrder(raw: string | Uint8Array, folderId?: string): WorkOrder {
  const doc = strict(raw, MAX_ORDER_BYTES, "order.json");
  checkSchema(WORK_ORDER_SCHEMA, doc, "order.json");
  const o = doc as WorkOrder;
  if (folderId !== undefined && o.id !== folderId) throw new WorkOrderFormatError(`order.json says ${o.id} but its folder is ${folderId}`);
  const refs = o.repositories.map(r => r.ref);
  const dup = refs.find((r, i) => refs.indexOf(r) !== i);
  if (dup) throw new WorkOrderFormatError(`repository "${dup}" is listed twice`);
  for (const r of o.repositories) {
    if (r.access === "change" && (!r.base || !r.branch)) throw new WorkOrderFormatError(`repository "${r.ref}" is to change but has no base or branch`);
    if (r.access === "read" && (r.base || r.branch)) throw new WorkOrderFormatError(`repository "${r.ref}" is read-only but has a base or branch`);
  }
  if (o.expected.pullRequests === "one-per-changed-repository" && !o.repositories.some(r => r.access === "change")) {
    throw new WorkOrderFormatError("the order expects pull requests but changes no repository");
  }
  for (const f of [...o.context.conventions, ...o.context.handoffs, ...o.expected.checks.filter(c => c.repoRef)]) {
    const ref = "repoRef" in f ? f.repoRef : undefined;
    if (ref && !refs.includes(ref)) throw new WorkOrderFormatError(`"${ref}" is not a repository of the order`);
  }
  if (o.agent.sessionId && !(o.agent.tool === "claude-code" && o.agent.surface === "terminal")) {
    throw new WorkOrderFormatError("a session id is chosen only for Claude Code in a terminal");
  }
  const pilot = o.kind === "pilot-read";
  if (pilot !== Boolean(o.pilot) || pilot !== (o.policy.cloud === "read-only")) throw new WorkOrderFormatError("only a pilot-read order has a pilot section and policy.cloud read-only");
  if (pilot) {
    if (o.repositories.some(r => r.access !== "read")) throw new WorkOrderFormatError("a pilot order only reads repositories");
    if (o.expected.pullRequests !== "none") throw new WorkOrderFormatError("a pilot order opens no pull request");
    if (o.agent.permissions !== "ask") throw new WorkOrderFormatError("a pilot order always asks before each action (permissions: ask)");
  }
  if (o.links.revises === o.id || o.links.followsUp === o.id) throw new WorkOrderFormatError("an order cannot revise or follow itself");
  return o;
}

export function parseOrderState(raw: string | Uint8Array, orderId?: string): OrderState {
  const doc = strict(raw, MAX_STATE_BYTES, "state.json");
  checkSchema(WORK_ORDER_STATE_SCHEMA, doc, "state.json");
  const s = doc as OrderState;
  if (orderId !== undefined && s.orderId !== orderId) throw new WorkOrderFormatError(`state.json belongs to ${s.orderId}, not ${orderId}`);
  return s;
}

/** The pull-request page of `url` when it is a PR of `remote` (GitHub /pull/N, Azure DevOps /pullrequest/N, GitLab /-/merge_requests/N). */
export function pullRequestOf(url: string, remote: string | undefined): { number: number; url: string } | undefined {
  const host = gitHostOf(remote);
  if (!host || !/^https:\/\/[^\s]+$/.test(url) || url.length > 2000) return undefined;
  const clean = url.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const base = host.web.toLowerCase();
  const lower = clean.toLowerCase();
  const suffix = host.kind === "github" ? /^\/pull\/(\d{1,9})(?:\/(?:files|commits|checks))?$/
    : host.kind === "azure-devops" ? /^\/pullrequest\/(\d{1,9})$/
    : /^\/-\/merge_requests\/(\d{1,9})(?:\/(?:diffs|commits|pipelines))?$/;
  if (!lower.startsWith(base)) return undefined;
  const m = suffix.exec(clean.slice(base.length));
  if (!m) return undefined;
  const number = Number(m[1]);
  if (!Number.isSafeInteger(number) || number < 1) return undefined;
  const page = host.kind === "github" ? `${host.web}/pull/${number}` : host.kind === "azure-devops" ? `${host.web}/pullrequest/${number}` : `${host.web}/-/merge_requests/${number}`;
  return { number, url: page };
}

/** Every text field of a result, for the credential check. */
function resultTexts(r: WorkOrderResult): string[] {
  return [
    r.summary, ...(r.questions ?? []),
    ...(r.followUps ?? []).flatMap(f => [f.title, f.why ?? ""]),
    ...(r.checks ?? []).flatMap(c => [c.what, c.note ?? ""]),
    r.agent?.tool ?? "", r.agent?.model ?? ""
  ];
}

/**
 * result.json, written by the agent: untrusted. Strict JSON, ≤ 256 KiB, unknown fields refused, the
 * order id and receipt must match, credential-shaped text refuses the whole result. PR addresses are
 * kept only when they are a PR of the declared repository (rebuilt from its address); anything else
 * is dropped with a warning.
 */
export function checkResult(raw: string | Uint8Array, order: WorkOrder): ResultVerdict {
  const size = typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.length;
  if (size > MAX_RESULT_BYTES) return { ok: false, why: "too-large", message: `result.json is larger than ${MAX_RESULT_BYTES / 1024} KiB` };
  let doc: unknown;
  try {
    doc = strict(raw, MAX_RESULT_BYTES, "result.json");
    checkSchema(WORK_ORDER_RESULT_SCHEMA, doc, "result.json");
  } catch (e) {
    return { ok: false, why: "invalid", message: e instanceof Error ? e.message : String(e) };
  }
  const r = doc as WorkOrderResult;
  if (r.orderId !== order.id || r.receipt !== order.receipt) {
    return { ok: false, why: "other-order", message: r.orderId !== order.id ? `written for another order (${r.orderId})` : "written for another revision of this order (the receipt does not match)" };
  }
  const sensitive = resultTexts(r).flatMap(t => sensitiveFindings(t).filter(f => /^line \d+: credential-shaped text/.test(f)));
  if (sensitive.length) return { ok: false, why: "sensitive", message: "refused: it contains credential-shaped text" };
  const warnings: string[] = [];
  const pullRequests: CheckedResult["pullRequests"] = [];
  const repos = new Map(order.repositories.map(x => [x.ref, x]));
  const seen = new Set<string>();
  for (const rr of r.repositories ?? []) {
    const repo = repos.get(rr.ref);
    if (!repo || repo.access !== "change") { warnings.push(`"${rr.ref}" is not a repository this order changes: ignored`); continue; }
    if (seen.has(rr.ref)) { warnings.push(`"${rr.ref}" is listed twice: the first entry is kept`); continue; }
    seen.add(rr.ref);
    if (rr.branch && rr.branch !== repo.branch) warnings.push(`${rr.ref}: the agent used branch ${rr.branch}, not the planned ${repo.branch}`);
    if (rr.pullRequest) {
      const pr = pullRequestOf(rr.pullRequest, repo.remote);
      if (pr) pullRequests.push({ ref: rr.ref, ...pr, branch: rr.branch ?? repo.branch });
      else warnings.push(`${rr.ref}: "${rr.pullRequest.slice(0, 120)}" is not a pull request of ${repo.remote ?? "this repository"}: dropped`);
    }
  }
  for (const f of r.datapassFiles ?? []) {
    if (f.via === "import" && !order.expected.datapassFiles.some(e => e.kind === f.kind)) warnings.push(`the agent proposes ${f.kind}.json, which the order did not ask for: review it with care`);
  }
  return { ok: true, checked: { result: r, pullRequests, warnings } };
}

/** The state DataPass writes when it writes an order. */
export function initialState(order: WorkOrder, digest: string): OrderState {
  return { format: STATE_FORMAT, version: FORMAT_VERSION, orderId: order.id, digest, status: "written", launches: [], seen: { pullRequests: [] }, closed: null };
}
