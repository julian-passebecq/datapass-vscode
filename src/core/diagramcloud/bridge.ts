/**
 * DataPass ↔ DiagramCloud Bridge V1 (contracts/diagramcloud/README.md).
 *
 * - `.datapass/diagramcloud.json` is one DiagramCloud document, detected by convention. DataPass does
 *   not own that grammar: it reads only identity/revision here, and DiagramCloud validates the whole
 *   document before opening it.
 * - `datapass.ai-context` V1 is a sanitized JSON envelope for manual ChatGPT/Claude use.
 * - `datapass.ai-plan` V1 comes back from the AI. It is parsed as untrusted data, schema-checked,
 *   revision-checked and reviewed per operation. Only operations with a V1 payload shape
 *   (APPLICABLE_V1 below) can be applied, and only to the sidecar file.
 *
 * Runtime validation mirrors the canonical JSON Schemas in contracts/diagramcloud; tests check that
 * both agree on the same fixtures. Pure and deterministic: no VS Code, no file system.
 */
import { parseStrictJson, isPlainObject } from "../model/strictJson";
import { ID_PATTERN, sha256Bytes, slugId } from "../model/ids";
import { scrub } from "../exchange/aiContext";
import type { DataPassProjectManifest, WorkScope } from "../projectManifestModel";
import type { WorkChecklistEntry, WorkOperation } from "../work/workModel";
import type { PreflightStatus } from "../capabilities/preflight";
import { isRfc3339 } from "../contracts/schemaDsl";

export const SIDECAR_PATH = ".datapass/diagramcloud.json";
/** DiagramCloud's own import bound (src/core/model.ts MAX_DOCUMENT_BYTES). */
export const MAX_SIDECAR_BYTES = 12 * 1024 * 1024;
const SIDECAR_LIMITS = { maxBytes: MAX_SIDECAR_BYTES, maxDepth: 30, maxEntries: 400_000, maxStringLength: 4 * 1024 * 1024 };

// ---------------------------------------------------------------- sidecar identity

export type SidecarState =
  | { present: false }
  | { present: true; ok: true; documentId: string; title: string; revision: number; hash: string; bytes: number }
  | { present: true; ok: false; error: string; hash: string; bytes: number };

/** Identity only. A readable sidecar is not a validated DiagramCloud document; DiagramCloud decides that. */
export function inspectSidecar(bytes: Uint8Array | undefined): SidecarState {
  if (!bytes || !bytes.byteLength) return { present: false };
  const hash = sha256Bytes(bytes).value, size = bytes.byteLength;
  try {
    const doc = parseStrictJson(bytes, SIDECAR_LIMITS);
    if (!isPlainObject(doc)) throw new Error("not a JSON object");
    if (doc.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
    if (typeof doc.id !== "string" || !ID_PATTERN.test(doc.id)) throw new Error("id is not a DiagramCloud id");
    if (typeof doc.title !== "string" || !doc.title) throw new Error("title is missing");
    const revision = doc.revision ?? 0;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) throw new Error("revision must be a non-negative integer");
    return { present: true, ok: true, documentId: doc.id, title: doc.title.slice(0, 160), revision, hash, bytes: size };
  } catch (error) {
    return { present: true, ok: false, error: `${SIDECAR_PATH}: ${error instanceof Error ? error.message : String(error)}`, hash, bytes: size };
  }
}

export function manifestRevision(manifestBytes: Uint8Array | undefined): string {
  return `sha256:${sha256Bytes(manifestBytes ?? new Uint8Array()).value}`;
}

// ---------------------------------------------------------------- AI context V1

export type ScopeType = "organization" | "project" | "workstream" | "workspace" | "task" | "component" | "resource" | "repository";
export type PlatformStatus = "unknown" | "missing" | "partial" | "ready" | "attention";
export type TaskStatus = "unknown" | "todo" | "in-progress" | "blocked" | "done";
type Revision = number | string | null;

export interface AiContextV1 {
  format: "datapass.ai-context";
  schemaVersion: 1;
  generatedAt?: string;
  project: { id: string; title: string; kind?: string; profile?: string };
  scope: { id: string; type: ScopeType; title?: string };
  base: { projectManifestRevision: string; diagramCloudRevision?: Revision; repositoryCommit?: string | null };
  diagramCloud?: { present?: boolean; documentPath?: string; documentId?: string; revision?: Revision };
  repositories: Array<{ id: string; label: string; revision?: string; role?: string }>;
  platforms: Array<{ id: string; label: string; status: PlatformStatus; evidence: "declared" | "inferred" | "observed" | "verified-in-source" | "verified-at-runtime"; summary?: string }>;
  tasks: Array<{ id: string; title: string; status: TaskStatus; summary?: string; sourceIds?: string[] }>;
  blockers?: string[];
  redactions: string[];
}

export interface ContextInput {
  manifest: DataPassProjectManifest;
  manifestBytes: Uint8Array | undefined;
  scope: WorkScope;
  implicitScope: boolean;
  checklist: WorkChecklistEntry[];
  operations: WorkOperation[];
  problems: string[];
  sidecar: SidecarState;
  repositoryCommit?: string | null;
  generatedAt: string;
}

const PLATFORM_PROVIDERS: Record<string, string> = { fabric: "fabric", databricks: "databricks", powerbi: "powerbi", grafana: "grafana", infrastructure: "infrastructure", oracle: "infrastructure", airflow: "airflow" };
const PLATFORM_LABELS: Record<string, string> = { fabric: "Microsoft Fabric", databricks: "Databricks", powerbi: "Power BI", grafana: "Grafana", infrastructure: "Infrastructure", oracle: "Oracle", airflow: "Airflow" };
const CHECKLIST_TO_TASK: Record<string, TaskStatus> = { todo: "todo", done: "done", blocked: "blocked", problem: "blocked", skipped: "unknown" };
const clip = (value: string, max: number) => { const chars = [...scrub(value)]; return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join(""); };

export const CONTEXT_REDACTIONS = [
  "repository paths and remote URLs",
  "platform binding values (workspace IDs, hosts, bundle roots, commands)",
  "local filesystem paths inside notes (replaced by <local-path>)",
  "credentials, tokens and environment values",
  "DiagramCloud document content (only its ID and revision)"
];

function platformStatus(statuses: PreflightStatus[]): PlatformStatus {
  if (!statuses.length) return "unknown";
  const ready = statuses.filter(s => s === "ready").length;
  if (ready === statuses.length) return "ready";
  if (ready) return "partial";
  if (statuses.some(s => s === "blocked" || s === "needs-review" || s === "needs-config")) return "attention";
  return "unknown";
}

/** Build a sanitized context. Nothing from bindings is copied except declared platform names. */
export function buildBridgeContext(input: ContextInput): AiContextV1 {
  const m = input.manifest;
  const sidecar = input.sidecar.present && input.sidecar.ok ? input.sidecar : undefined;
  const platforms = Object.keys(m.platforms ?? {}).filter(key => key in PLATFORM_PROVIDERS).slice(0, 100).map(key => {
    const ops = input.operations.filter(o => o.capability.provider === PLATFORM_PROVIDERS[key]);
    const ready = ops.filter(o => o.result.status === "ready").length;
    return { id: slugId(key, "platform"), label: PLATFORM_LABELS[key] ?? key, status: platformStatus(ops.map(o => o.result.status)), evidence: "declared" as const,
      summary: ops.length ? `Declared in the project manifest. ${ops.length} operation(s) in scope, ${ready} ready by local preflight (tools and configuration, not a live target check).` : "Declared in the project manifest. No operation in the selected scope." };
  });
  const tasks = input.checklist.slice(0, 500).map(entry => ({
    id: clip(entry.id, 200), title: clip(entry.label, 300), status: CHECKLIST_TO_TASK[entry.state] ?? "unknown",
    summary: clip(`User-reported checklist state: ${entry.state}.${entry.note ? ` Note: ${entry.note}` : ""}`, 2000)
  }));
  const blockers = [
    ...input.problems,
    ...input.operations.filter(o => o.result.status === "blocked").map(o => `${o.capability.label}: ${o.result.blockers.map(b => b.label).join(", ") || "blocked"}`)
  ].slice(0, 100).map(b => clip(b, 2000));
  const context: AiContextV1 = {
    format: "datapass.ai-context", schemaVersion: 1, generatedAt: input.generatedAt,
    project: { id: clip(m.project.id, 160), title: clip(m.project.title, 240), ...(m.project.profile ? { profile: clip(m.project.profile, 160) } : {}) },
    scope: { id: clip(input.scope.id, 240), type: input.implicitScope ? "project" : "workstream", title: clip(input.scope.title, 240) },
    base: { projectManifestRevision: manifestRevision(input.manifestBytes), diagramCloudRevision: sidecar ? sidecar.revision : null, repositoryCommit: input.repositoryCommit ?? null },
    diagramCloud: sidecar ? { present: true, documentPath: SIDECAR_PATH, documentId: sidecar.documentId, revision: sidecar.revision } : { present: false, documentPath: SIDECAR_PATH, revision: null },
    repositories: Object.entries(m.repositories ?? {}).slice(0, 100).map(([key, repo]) => ({ id: slugId(key, "repo"), label: clip(repo.label ?? key, 240) })),
    platforms, tasks, blockers,
    redactions: CONTEXT_REDACTIONS
  };
  const issues = contextIssues(context);
  if (issues.length) throw new Error(`Internal error: generated AI context violates datapass-ai-context-v1: ${issues.slice(0, 5).join("; ")}`);
  return context;
}

// ---------------------------------------------------------------- runtime validation (mirrors contracts/diagramcloud/*.schema.json)

type Check = (value: unknown, path: string, out: string[]) => void;
const str = (min: number, max: number, pattern?: RegExp): Check => (v, p, o) => {
  if (typeof v !== "string") { o.push(`${p} must be a string`); return; }
  const n = [...v].length;
  if (n < min) o.push(`${p} must have at least ${min} characters`);
  if (n > max) o.push(`${p} must have at most ${max} characters`);
  if (pattern && !pattern.test(v)) o.push(`${p} has an invalid format`);
};
const oneOfValues = (...values: unknown[]): Check => (v, p, o) => { if (!values.includes(v)) o.push(`${p} must be one of ${values.map(x => JSON.stringify(x)).join(", ")}`); };
const bool: Check = (v, p, o) => { if (typeof v !== "boolean") o.push(`${p} must be a boolean`); };
const revision = (minLength: number): Check => (v, p, o) => {
  if (v === null) return;
  if (typeof v === "number") { if (!Number.isInteger(v) || v < 0) o.push(`${p} must be a non-negative integer`); return; }
  if (typeof v === "string") { str(minLength, 200)(v, p, o); return; }
  o.push(`${p} must be an integer, a string or null`);
};
const nullableStr = (max: number): Check => (v, p, o) => { if (v !== null) str(0, max)(v, p, o); };
const list = (item: Check, max: number): Check => (v, p, o) => {
  if (!Array.isArray(v)) { o.push(`${p} must be an array`); return; }
  if (v.length > max) o.push(`${p} must have at most ${max} items`);
  v.forEach((x, i) => item(x, `${p}[${i}]`, o));
};
const object = (fields: Record<string, Check>, required: string[]): Check => (v, p, o) => {
  if (!isPlainObject(v)) { o.push(`${p} must be an object`); return; }
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(v, key)) o.push(`${p}.${key} is required`);
  for (const [key, value] of Object.entries(v)) {
    const check = fields[key];
    if (!check) o.push(`${p}.${key} is not an allowed property`);
    else check(value, `${p}.${key}`, o);
  }
};
const SCOPE_TYPES = ["organization", "project", "workstream", "workspace", "task", "component", "resource", "repository"];

const contextCheck = object({
  format: oneOfValues("datapass.ai-context"), schemaVersion: oneOfValues(1), generatedAt: (v, p, o) => { if (typeof v !== "string" || !isRfc3339(v)) o.push(`${p} must be an RFC 3339 date-time`); },
  project: object({ id: str(1, 160), title: str(1, 240), kind: oneOfValues("active-engineering", "learning", "portfolio-reconstruction", "reference", "archived"), profile: str(0, 160) }, ["id", "title"]),
  scope: object({ id: str(1, 240), type: oneOfValues(...SCOPE_TYPES), title: str(0, 240) }, ["id", "type"]),
  base: object({ projectManifestRevision: str(1, 200), diagramCloudRevision: revision(1), repositoryCommit: nullableStr(200) }, ["projectManifestRevision"]),
  diagramCloud: object({ present: bool, documentPath: str(0, 500), documentId: str(0, 160), revision: revision(0) }, []),
  repositories: list(object({ id: str(1, 160), label: str(1, 240), revision: str(0, 200), role: str(0, 500) }, ["id", "label"]), 100),
  platforms: list(object({ id: str(1, 160), label: str(1, 240), status: oneOfValues("unknown", "missing", "partial", "ready", "attention"), evidence: oneOfValues("declared", "inferred", "observed", "verified-in-source", "verified-at-runtime"), summary: str(0, 1200) }, ["id", "label", "status", "evidence"]), 100),
  tasks: list(object({ id: str(1, 200), title: str(1, 300), status: oneOfValues("unknown", "todo", "in-progress", "blocked", "done"), summary: str(0, 2000), sourceIds: list(str(0, 200), 100) }, ["id", "title", "status"]), 500),
  blockers: list(str(0, 2000), 100),
  redactions: list(str(0, 500), 100)
}, ["format", "schemaVersion", "project", "scope", "base", "repositories", "platforms", "tasks", "redactions"]);

export const PLAN_ACTIONS = ["add-task", "update-task", "add-relation", "update-relation", "add-item", "update-item", "add-workspace", "update-workspace", "add-placement", "remove-placement", "link-node-workspace", "set-project-metadata"] as const;
export type PlanAction = typeof PLAN_ACTIONS[number];
const SECRET_KEY = /(password|Password|secret|Secret|token|Token|credential|Credential|privateKey|clientSecret)/;
const payloadCheck: Check = (v, p, o) => {
  if (!isPlainObject(v)) { o.push(`${p} must be an object`); return; }
  const keys = Object.keys(v);
  if (keys.length > 60) o.push(`${p} must have at most 60 properties`);
  for (const key of keys) if (SECRET_KEY.test(key)) o.push(`${p}.${key} is a secret-shaped property name and is not allowed`);
};
const planCheck = object({
  format: oneOfValues("datapass.ai-plan"), schemaVersion: oneOfValues(1),
  base: object({ projectManifestRevision: str(1, 200), diagramCloudRevision: revision(1), contextHash: str(0, 200) }, ["projectManifestRevision"]),
  scope: object({ id: str(1, 240), type: oneOfValues(...SCOPE_TYPES) }, ["id", "type"]),
  summary: str(1, 4000),
  operations: list(object({
    id: str(1, 200), target: oneOfValues("project-manifest", "diagramcloud-document"), action: oneOfValues(...PLAN_ACTIONS),
    reviewLabel: str(1, 500), entityId: str(0, 240), payload: payloadCheck
  }, ["id", "target", "action", "reviewLabel", "payload"]), 300),
  warnings: list(str(0, 2000), 100),
  notes: str(0, 6000)
}, ["format", "schemaVersion", "base", "scope", "summary", "operations"]);

export function contextIssues(value: unknown): string[] { const out: string[] = []; contextCheck(value, "$", out); return out; }
export function planIssues(value: unknown): string[] { const out: string[] = []; planCheck(value, "$", out); return out; }

// ---------------------------------------------------------------- AI plan review and apply

export interface PlanOperation { id: string; target: "project-manifest" | "diagramcloud-document"; action: PlanAction; reviewLabel: string; entityId?: string; payload: Record<string, unknown> }
export interface AiPlanV1 {
  format: "datapass.ai-plan"; schemaVersion: 1;
  base: { projectManifestRevision: string; diagramCloudRevision?: Revision; contextHash?: string };
  scope: { id: string; type: ScopeType }; summary: string; operations: PlanOperation[]; warnings?: string[]; notes?: string;
}
export interface ReviewedOperation { op: PlanOperation; applicable: boolean; reason: string; change?: string }
export interface PlanReview { plan: AiPlanV1; conflicts: string[]; warnings: string[]; operations: ReviewedOperation[] }
export interface CurrentState { manifestRevision: string; sidecar: SidecarState; sidecarDocument?: Record<string, unknown>; selectedScopeId: string }

/** Actions DataPass V1 can apply, with their payload shape. Everything else is reviewed but not applied. */
export const APPLICABLE_V1 = {
  "set-project-metadata": "payload { title?: string (1–160), summary?: string (≤3000) }; sets the DiagramCloud document title/summary",
  "link-node-workspace": "entityId = existing node id; payload { workspaceId: existing experience workspace id }"
} as const;

export class PlanRejected extends Error {
  constructor(message: string, readonly details: string[]) { super(message); this.name = "PlanRejected"; }
}

/** Parse untrusted plan bytes. Throws PlanRejected with every schema issue; never partially accepts. */
export function parsePlan(raw: Uint8Array | string): AiPlanV1 {
  let doc: unknown;
  try { doc = parseStrictJson(raw); } catch (error) { throw new PlanRejected("The AI plan is not valid JSON.", [error instanceof Error ? error.message : String(error)]); }
  const issues = planIssues(doc);
  if (issues.length) throw new PlanRejected(`The AI plan does not match datapass-ai-plan-v1 (${issues.length} issue${issues.length === 1 ? "" : "s"}).`, issues.slice(0, 50));
  return doc as AiPlanV1;
}

/** Parse the sidecar for editing, with the same bounds as inspection. */
export function readSidecarDocument(bytes: Uint8Array): Record<string, unknown> {
  const doc = parseStrictJson(bytes, SIDECAR_LIMITS);
  if (!isPlainObject(doc)) throw new Error(`${SIDECAR_PATH} is not a JSON object`);
  return doc;
}

const ids = (list: unknown, key = "id") => new Set(Array.isArray(list) ? list.filter(isPlainObject).map(x => x[key]).filter((x): x is string => typeof x === "string") : []);

function reviewOperation(op: PlanOperation, doc: Record<string, unknown> | undefined): ReviewedOperation {
  const no = (reason: string): ReviewedOperation => ({ op, applicable: false, reason });
  if (op.target === "project-manifest") return no("Project-manifest changes are not applied from AI plans in V1. Edit .datapass/project.json with its own reviewed commands.");
  if (!(op.action in APPLICABLE_V1)) return no(`"${op.action}" has no V1 payload shape. Make this change in DiagramCloud (JSON / AI → reviewed import), or ask the AI for a whole-document edit.`);
  if (!doc) return no(`${SIDECAR_PATH} is missing or unreadable.`);
  const keys = Object.keys(op.payload);
  if (op.action === "set-project-metadata") {
    const extra = keys.filter(k => k !== "title" && k !== "summary");
    if (extra.length || !keys.length) return no(`Payload must contain only title and/or summary${extra.length ? ` (unexpected: ${extra.join(", ")})` : ""}.`);
    const { title, summary } = op.payload;
    if (title !== undefined && (typeof title !== "string" || !title.trim() || [...title].length > 160)) return no("title must be a non-empty string of at most 160 characters.");
    if (summary !== undefined && (typeof summary !== "string" || [...summary].length > 3000)) return no("summary must be a string of at most 3000 characters.");
    const parts = [title !== undefined ? `title → “${title}”` : "", summary !== undefined ? "summary replaced" : ""].filter(Boolean);
    return { op, applicable: true, reason: "", change: parts.join("; ") };
  }
  // link-node-workspace
  if (keys.length !== 1 || typeof op.payload.workspaceId !== "string") return no("Payload must be exactly { workspaceId }.");
  const nodeId = op.entityId, workspaceId = op.payload.workspaceId;
  if (!nodeId || !ids(doc.nodes).has(nodeId)) return no(`Node "${nodeId ?? ""}" does not exist in the DiagramCloud document.`);
  const experience = isPlainObject(doc.experience) ? doc.experience : undefined;
  if (!ids(experience?.workspaces).has(workspaceId)) return no(`Workspace "${workspaceId}" does not exist in the document's experience pack.`);
  return { op, applicable: true, reason: "", change: `node ${nodeId} → workspace ${workspaceId}` };
}

/** Revision checks, then per-operation applicability. A conflict means nothing may be applied. */
export function reviewPlan(plan: AiPlanV1, current: CurrentState): PlanReview {
  const conflicts: string[] = [], warnings: string[] = [...(plan.warnings ?? []).map(w => `AI warning: ${w}`)];
  if (plan.base.projectManifestRevision !== current.manifestRevision) conflicts.push(`The project manifest changed since the context was exported (plan base ${plan.base.projectManifestRevision.slice(0, 19)}…, now ${current.manifestRevision.slice(0, 19)}…). Export a fresh AI context.`);
  const touchesDocument = plan.operations.some(o => o.target === "diagramcloud-document");
  const sidecarRevision = current.sidecar.present && current.sidecar.ok ? current.sidecar.revision : null;
  if (touchesDocument || plan.base.diagramCloudRevision !== undefined) {
    const planned = plan.base.diagramCloudRevision ?? null;
    if (planned !== sidecarRevision) conflicts.push(`${SIDECAR_PATH} is at revision ${sidecarRevision ?? "none"}, but the plan was written against revision ${planned ?? "none"}. Export a fresh AI context.`);
  }
  if (current.sidecar.present && !current.sidecar.ok && touchesDocument) conflicts.push(current.sidecar.error);
  if (plan.scope.id !== current.selectedScopeId) warnings.push(`The plan targets scope "${plan.scope.id}"; the selected scope is "${current.selectedScopeId}".`);
  const seen = new Set<string>();
  for (const op of plan.operations) { if (seen.has(op.id)) conflicts.push(`Duplicate operation id "${op.id}".`); seen.add(op.id); }
  return { plan, conflicts, warnings, operations: plan.operations.map(op => reviewOperation(op, current.sidecarDocument)) };
}

/**
 * Apply approved, applicable operations to the sidecar bytes. Revision increments once. Output uses
 * DiagramCloud's own serialization (two-space JSON + newline) so Git diffs stay minimal.
 */
export function applyApproved(sidecarBytes: Uint8Array, review: PlanReview, approvedIds: ReadonlySet<string>): { bytes: Uint8Array; revision: number; applied: string[] } {
  if (review.conflicts.length) throw new PlanRejected("The plan has revision conflicts; nothing can be applied.", review.conflicts);
  const doc = readSidecarDocument(sidecarBytes);
  const current = inspectSidecar(sidecarBytes);
  if (!current.present || !current.ok) throw new Error(current.present ? current.error : `${SIDECAR_PATH} is missing.`);
  const chosen = review.operations.filter(r => approvedIds.has(r.op.id));
  const blocked = chosen.filter(r => !r.applicable);
  if (blocked.length) throw new PlanRejected("Some approved operations cannot be applied.", blocked.map(r => `${r.op.id}: ${r.reason}`));
  if (!chosen.length) throw new Error("No operation was approved.");
  // Re-check against the exact bytes being edited, not the document used at review time.
  const fresh = chosen.map(r => reviewOperation(r.op, doc)).filter(r => !r.applicable);
  if (fresh.length) throw new PlanRejected("The document no longer satisfies the reviewed operations.", fresh.map(r => `${r.op.id}: ${r.reason}`));
  for (const { op } of chosen) {
    if (op.action === "set-project-metadata") {
      if (typeof op.payload.title === "string") doc.title = op.payload.title.trim();
      if (typeof op.payload.summary === "string") doc.summary = op.payload.summary;
    } else if (op.action === "link-node-workspace") {
      // Same key position as DiagramCloud's schema (before blockIds), so its next save produces no Git diff.
      const nodes = doc.nodes as Record<string, unknown>[], index = nodes.findIndex(n => isPlainObject(n) && n.id === op.entityId);
      const entries = Object.entries(nodes[index]!).filter(([key]) => key !== "experienceWorkspaceId"), at = entries.findIndex(([key]) => key === "blockIds");
      entries.splice(at < 0 ? entries.length : at, 0, ["experienceWorkspaceId", op.payload.workspaceId]);
      nodes[index] = Object.fromEntries(entries);
    }
  }
  doc.revision = current.revision + 1;
  return { bytes: new TextEncoder().encode(JSON.stringify(doc, null, 2) + "\n"), revision: current.revision + 1, applied: chosen.map(r => r.op.id) };
}

// ---------------------------------------------------------------- outline for AI instructions

export interface SidecarOutline { nodes: Array<{ id: string; label: string }>; workspaces: Array<{ id: string; title: string }> }

/** IDs and short labels only (no summaries, code, tables or images), so an AI can reference existing objects. */
export function sidecarOutline(doc: Record<string, unknown>, max = 200): SidecarOutline {
  const pairs = (list: unknown, key: string) => (Array.isArray(list) ? list : []).filter(isPlainObject)
    .filter(x => typeof x.id === "string" && typeof x[key] === "string").slice(0, max).map(x => ({ id: x.id as string, text: clip(x[key] as string, 160) }));
  const experience = isPlainObject(doc.experience) ? doc.experience : {};
  return { nodes: pairs(doc.nodes, "label").map(p => ({ id: p.id, label: p.text })), workspaces: pairs(experience.workspaces, "title").map(p => ({ id: p.id, title: p.text })) };
}

// ---------------------------------------------------------------- plain summary

export function projectSummary(context: AiContextV1, sidecar: SidecarState): string {
  const lines = [
    `# ${context.project.title} (${context.project.id})`,
    `Scope: ${context.scope.title ?? context.scope.id} [${context.scope.type}]`,
    sidecar.present ? (sidecar.ok ? `DiagramCloud: “${sidecar.title}” (${sidecar.documentId}), revision ${sidecar.revision}, ${SIDECAR_PATH}` : `DiagramCloud: ${SIDECAR_PATH} present but unreadable — ${sidecar.error}`) : `DiagramCloud: no ${SIDECAR_PATH} yet`,
    "",
    "Platforms (declared; readiness is local preflight, not a live check):",
    ...(context.platforms.length ? context.platforms.map(p => `- ${p.label}: ${p.status}`) : ["- none declared"]),
    "",
    "Tasks (user-reported checklist):",
    ...(context.tasks.length ? context.tasks.map(t => `- [${t.status}] ${t.title}`) : ["- none in this scope"]),
    ...(context.blockers?.length ? ["", "Blockers:", ...context.blockers.map(b => `- ${b}`)] : [])
  ];
  return lines.join("\n") + "\n";
}
