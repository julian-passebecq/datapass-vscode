import { createHash } from "node:crypto";

/**
 * NAVAIX1 "Ask the AI to explain this": an explanation of one navigation Location written by the client AI, never by
 * DataPass. The button in the Context Why tab prepares a work order through the existing AI exchange (`datapass.workOrders.new`);
 * the AI answers with `decision-rationale/1` entries (Common packages/decision-rationale, RATIO1) in
 * `.datapass/explain/<safe node id>.json`. DataPass validates the answer like decision-rationale `consume` (structure,
 * origin, subjects) and shows it as **AI-proposed** (§ 34), marked stale when a source file changed since the order.
 * Pure: no vscode, no network, no client code execution.
 *
 * The rationale types below are the structural subset this package reads; they switch to the vendored package
 * (`validateRationaleDocument` / `createRationaleIndex`) when NAVSVC1 vendors decision-rationale.
 */

/** Same shape as navStub `NavLocation` (go/NAV-contract.md); kept structural so this file stands alone. */
export interface ExplainLocation { readonly level: string; readonly nodeId: string; readonly artifactKind: string }

export const NAV_EXPLANATION_SCHEMA_ID = "datapass.nav-explanation/1";
export const EXPLAIN_DIR = ".datapass/explain";
const DECISION_RATIONALE_SCHEMA_ID = "datapass.decision-rationale/1";
const RATIONALE_ORIGINS = ["static-inferred", "ai-proposed", "ai-confirmed", "owner-stated"] as const;
/** What a client AI may claim: `static-inferred` is DataPass's own, `owner-stated` is the owner's (decision-rationale validate). */
const AI_ORIGINS: readonly string[] = ["ai-proposed", "ai-confirmed"];
const LIMITS = { text: 4000, title: 200, items: 64, rationales: 64, subjects: 64, sources: 64, bytes: 512_000 };

/** File name of a node's explanation: readable prefix + short hash, so distinct ids never collide. */
export function safeNodeId(nodeId: string): string {
  const readable = nodeId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 80) || "node";
  return `${readable}-${createHash("sha256").update(nodeId, "utf8").digest("hex").slice(0, 10)}`;
}
export const explainPathOf = (nodeId: string): string => `${EXPLAIN_DIR}/${safeNodeId(nodeId)}.json`;

/** Hash of a source file as the AI and DataPass both compute it: SHA-256 of the text with line endings normalised to LF. */
export function sourceSha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

// ---------- labels and prompts (data, overridable by settings) ----------

export interface ExplainLabels {
  readonly button: string;
  readonly badge: string;
  readonly stale: string;
  readonly missing: string;
  readonly invalid: string;
  readonly orderTitle: string;
  readonly orderNote: string;
}
export const DEFAULT_EXPLAIN_LABELS: ExplainLabels = {
  button: "Ask the AI to explain this",
  badge: "AI-proposed",
  stale: "Stale: {paths} changed since the AI wrote this",
  missing: "No AI explanation yet for {node}",
  invalid: "The AI explanation of {node} was refused: {reason}",
  orderTitle: "Explain {node} for DataPass",
  orderNote: "DataPass navigation: the AI writes {file}; nothing is written until you confirm the order."
};
export function explainLabels(overrides: unknown): ExplainLabels {
  const o = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides as Record<string, unknown> : {};
  const out: Record<string, string> = { ...DEFAULT_EXPLAIN_LABELS };
  for (const k of Object.keys(DEFAULT_EXPLAIN_LABELS)) { const v = o[k]; if (typeof v === "string" && v.trim() && v.length <= 300) out[k] = v; }
  return out as unknown as ExplainLabels;
}
export const fillLabel = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

/** The decision-rationale answer rules (RATIONALE_ANSWER_RULES), adapted to one Location; data, overridable. */
export const DEFAULT_EXPLAIN_RULES: readonly string[] = [
  "Explain why this part of the project is built the way it is, as one or more decision-rationale entries (origin \"ai-proposed\").",
  "choice: the catalogue option id when one fits, and what was done in one sentence. problemSolved: the customer problem it solves.",
  "why: one driver per constraint that pushed the choice, each with a constraint kind and evidence spans (path, 1-based startLine/endLine).",
  "how: the mechanism and the files and line spans that realise it. Evidence must point at real files.",
  "alternatives: at least one; each says when it would be better, its cost or risk, and why not here.",
  "tradeoffs, revisitWhen triggers, confidence, and openQuestions for the owner when you lack business context.",
  "Never claim static-inferred or owner-stated. Do not change any other file. Never write a credential or a connection string."
];

export interface ExplainSource { readonly path: string; readonly sha256: string | null }
export interface ExplainOrderInput {
  readonly location: ExplainLocation;
  readonly title?: string;
  /** Repository paths the Location is made of, with their current hash when readable here. */
  readonly sources: readonly ExplainSource[];
  readonly revision?: string | null;
  /** Decision-rationale prompt lines for the Location's domain (RATIONALE_PROMPTS `ask`), when the host knows them. */
  readonly asks?: readonly string[];
  readonly rules?: readonly string[];
  readonly labels?: ExplainLabels;
}
export interface ExplainOrderDraft {
  readonly kind: "prepare-files";
  readonly title: string;
  readonly goal: string;
  readonly doneWhen: string[];
  readonly note: string;
}

/** The work order the button prepares: the client AI writes the explanation file; DataPass never calls an AI itself. */
export function explainOrderDraft(input: ExplainOrderInput): ExplainOrderDraft {
  const labels = input.labels ?? DEFAULT_EXPLAIN_LABELS;
  const node = input.title ?? input.location.nodeId;
  const file = explainPathOf(input.location.nodeId);
  const sources = input.sources.slice(0, LIMITS.sources);
  const skeleton = {
    schema: NAV_EXPLANATION_SCHEMA_ID,
    location: { level: input.location.level, nodeId: input.location.nodeId, artifactKind: input.location.artifactKind },
    origin: "ai-proposed",
    source: { revision: input.revision ?? null, files: sources.map(s => ({ path: s.path, sha256: s.sha256 ?? "<sha256 of the file, LF line endings>" })) },
    writtenAt: "<ISO date>",
    rationale: { schema: DECISION_RATIONALE_SCHEMA_ID, project: "<project id>", author: "<your AI name>", rationales: ["<decision-rationale entries>"] }
  };
  const goal = [
    `Write the DataPass explanation of ${node} (${input.location.level}, ${input.location.artifactKind}): the JSON file ${file} at the root of the bridge repository.`,
    "",
    ...(sources.length ? ["Source files of this part (read them; do not change them):", ...sources.map(s => `- ${s.path}${s.sha256 ? ` (sha256 ${s.sha256})` : ""}`), ""] : []),
    ...(input.rules ?? DEFAULT_EXPLAIN_RULES).map(r => `- ${r}`),
    ...(input.asks?.length ? ["", "Questions a senior would ask here:", ...input.asks.map(a => `- ${a}`)] : []),
    "",
    "Every rationale has subject {\"kind\": \"path\", \"id\": <source path>} or the node id, so DataPass can attach it here.",
    "File shape (copy the source hashes as given, so DataPass can tell when the code changed):",
    JSON.stringify(skeleton, null, 2)
  ].join("\n");
  return {
    kind: "prepare-files",
    title: fillLabel(labels.orderTitle, { node }).slice(0, 80),
    goal,
    doneWhen: [`${file} exists and DataPass shows it in the Context Why tab with the ${labels.badge} badge (not refused)`],
    note: fillLabel(labels.orderNote, { file })
  };
}

// ---------- reading the answer (decision-rationale consume, structural) ----------

export interface RationaleRead {
  readonly id: string;
  readonly decisionPoint: string | null;
  readonly subjects: readonly { readonly kind: string; readonly id: string }[];
  readonly choice: { readonly option: string | null; readonly summary: string };
  readonly problemSolved: string;
  readonly why: readonly { readonly constraint: string; readonly driver: string }[];
  readonly alternatives: readonly { readonly option: string | null; readonly label: string; readonly whenBetter: string; readonly costRisk: string; readonly whyNotHere: string }[];
  readonly tradeoffs: readonly string[];
  readonly confidence: string;
  readonly origin: (typeof RATIONALE_ORIGINS)[number];
  readonly openQuestions: readonly string[];
}
export interface ExplanationFile {
  readonly location: ExplainLocation;
  readonly origin: "ai-proposed";
  readonly sources: readonly ExplainSource[];
  readonly revision: string | null;
  readonly writtenAt: string | null;
  readonly rationales: readonly RationaleRead[];
}
export type ExplanationRead =
  | { readonly ok: true; readonly file: ExplanationFile; readonly rejected: readonly string[]; readonly issues: readonly string[] }
  | { readonly ok: false; readonly reason: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : null);
const text = (v: unknown, max = LIMITS.text): string | null => (typeof v === "string" && /\S/.test(v) && v.length <= max ? v : null);
const nullableText = (v: unknown, max = LIMITS.text): string | null | undefined => (v === null || v === undefined ? null : text(v, max) ?? undefined);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.slice(0, LIMITS.items).map(x => text(x)).filter((x): x is string => x !== null) : []);
/** Credentials never reach the panel, whatever the AI wrote. */
const SECRETISH = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|sqlserver):\/\/|\bAccountKey=|\bglpat-|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{16,}/i;

function readRationale(raw: unknown, i: number): { r?: RationaleRead; error?: string } {
  const o = obj(raw);
  const id = o && text(o.id, 256);
  const label = id ?? `#${i}`;
  if (!o || !id) return { error: `${label}: id missing` };
  const origin = o.origin;
  if (typeof origin !== "string" || !AI_ORIGINS.includes(origin)) return { error: `${label}: origin must be ai-proposed (a client AI may not claim ${String(origin)})` };
  const choice = obj(o.choice);
  const summary = choice && text(choice.summary);
  const problemSolved = text(o.problemSolved);
  if (!summary || !problemSolved) return { error: `${label}: choice.summary and problemSolved are required` };
  const why = Array.isArray(o.why) ? o.why.slice(0, LIMITS.items).map(w => { const x = obj(w); const c = x && text(x.constraint, 64), d = x && text(x.driver); return c && d ? { constraint: c, driver: d } : null; }).filter(x => x !== null) : [];
  if (!why.length) return { error: `${label}: why needs at least one driver` };
  const alternatives = Array.isArray(o.alternatives) ? o.alternatives.slice(0, LIMITS.items).map(a => {
    const x = obj(a); if (!x) return null;
    const lab = text(x.label, LIMITS.title), wb = text(x.whenBetter), cr = text(x.costRisk), wn = text(x.whyNotHere), opt = nullableText(x.option, 256);
    return lab && wb && cr && wn && opt !== undefined ? { option: opt, label: lab, whenBetter: wb, costRisk: cr, whyNotHere: wn } : null;
  }).filter(x => x !== null) : [];
  if (!alternatives.length) return { error: `${label}: alternatives needs at least one complete entry` };
  const subjects = Array.isArray(o.subjects) ? o.subjects.slice(0, LIMITS.subjects).map(s => { const x = obj(s); const k = x && text(x.kind, 32), sid = x && text(x.id, 1024); return k && sid ? { kind: k, id: sid } : null; }).filter(x => x !== null) : [];
  const confidence = text(o.confidence, 32) ?? "low";
  const decisionPoint = nullableText(o.decisionPoint, 256) ?? null;
  const option = nullableText(choice.option, 256) ?? null;
  const r: RationaleRead = {
    id, decisionPoint, subjects, choice: { option, summary }, problemSolved, why, alternatives,
    tradeoffs: texts(o.tradeoffs), confidence, origin: origin as RationaleRead["origin"], openQuestions: texts(o.openQuestions)
  };
  if (SECRETISH.test(JSON.stringify(r))) return { error: `${label}: contains credential-shaped text` };
  return { r };
}

/**
 * Validates an explanation file for one Location. A file for another node, a non-AI origin or no valid rationale is
 * refused as a whole; single bad rationales are dropped and listed. AI-confirmed entries stay shown as AI answers.
 */
export function readExplanation(raw: string | unknown, expected: ExplainLocation): ExplanationRead {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > LIMITS.bytes) return { ok: false, reason: "file too large" };
    try { v = JSON.parse(raw); } catch { return { ok: false, reason: "not valid JSON" }; }
  }
  const o = obj(v);
  if (!o || o.schema !== NAV_EXPLANATION_SCHEMA_ID) return { ok: false, reason: `schema must be ${NAV_EXPLANATION_SCHEMA_ID}` };
  const loc = obj(o.location);
  if (!loc || loc.nodeId !== expected.nodeId) return { ok: false, reason: "the file explains another node" };
  if (o.origin !== "ai-proposed") return { ok: false, reason: "origin must be ai-proposed" };
  const src = obj(o.source);
  const sources: ExplainSource[] = Array.isArray(src?.files) ? (src!.files as unknown[]).slice(0, LIMITS.sources).map(f => {
    const x = obj(f); const p = x && text(x.path, 4096);
    const h = x && typeof x.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256) ? x.sha256 : null;
    return p && !p.includes("..") && !/^([A-Za-z]:|[\\/])/.test(p) ? { path: p.replace(/\\/g, "/"), sha256: h } : null;
  }).filter((x): x is ExplainSource => x !== null) : [];
  const doc = obj(o.rationale);
  if (!doc || doc.schema !== DECISION_RATIONALE_SCHEMA_ID || !Array.isArray(doc.rationales)) return { ok: false, reason: `rationale must be a ${DECISION_RATIONALE_SCHEMA_ID} document` };
  const rationales: RationaleRead[] = [], rejected: string[] = [], issues: string[] = [];
  (doc.rationales as unknown[]).slice(0, LIMITS.rationales).forEach((x, i) => {
    const { r, error } = readRationale(x, i);
    if (r) rationales.push(r); else { rejected.push(obj(x) && typeof obj(x)!.id === "string" ? String(obj(x)!.id).slice(0, 256) : `#${i}`); issues.push(error!); }
  });
  if (!rationales.length) return { ok: false, reason: issues[0] ?? "no rationale" };
  rationales.sort((a, b) => (a.origin === b.origin ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.origin === "ai-confirmed" ? -1 : 1));
  const writtenAt = typeof o.writtenAt === "string" && !Number.isNaN(Date.parse(o.writtenAt)) ? o.writtenAt : null;
  const revision = typeof src?.revision === "string" && src.revision.length <= 80 ? src.revision : null;
  return {
    ok: true, rejected, issues,
    file: { location: { level: String(loc.level ?? expected.level), nodeId: expected.nodeId, artifactKind: String(loc.artifactKind ?? expected.artifactKind) }, origin: "ai-proposed", sources, revision, writtenAt, rationales }
  };
}

/** Source paths whose current hash differs from the one recorded in the file (null current = file gone). */
export function changedSources(file: ExplanationFile, current: ReadonlyMap<string, string | null>): string[] {
  return file.sources.filter(s => s.sha256 !== null && current.has(s.path) && current.get(s.path) !== s.sha256).map(s => s.path);
}

// ---------- the Context provider ----------

export interface ExplainCard {
  readonly rationaleId: string;
  readonly decisionPoint: string | null;
  readonly choice: RationaleRead["choice"];
  readonly problemSolved: string;
  readonly drivers: RationaleRead["why"];
  readonly alternatives: RationaleRead["alternatives"];
  readonly tradeoffs: readonly string[];
  readonly confidence: string;
  readonly openQuestions: readonly string[];
  /** Always shown with the AI-proposed badge (§ 34), whatever the AI claimed. */
  readonly origin: "ai-proposed";
  readonly badge: string;
  readonly stale: string | null;
  readonly writtenAt: string | null;
}
export interface ExplainHole { readonly reason: string; readonly fill?: "ask-ai" }
/** Binding-provider result (go/NAV-contract.md: `{ cards, holes, origin }`). */
export interface ExplainSection { readonly cards: readonly ExplainCard[]; readonly holes: readonly ExplainHole[]; readonly origin: "ai-proposed" | "static"; readonly file: string }

export interface ExplainProviderInput {
  readonly location: ExplainLocation;
  readonly title?: string;
  /** File text, or null when `.datapass/explain/<safe id>.json` does not exist. */
  readonly raw: string | null;
  /** Current hashes of the source files (null = file not found). */
  readonly current: ReadonlyMap<string, string | null>;
  readonly labels?: ExplainLabels;
}

export function aiExplainSection(input: ExplainProviderInput): ExplainSection {
  const labels = input.labels ?? DEFAULT_EXPLAIN_LABELS;
  const node = input.title ?? input.location.nodeId;
  const file = explainPathOf(input.location.nodeId);
  if (input.raw === null) return { cards: [], holes: [{ reason: fillLabel(labels.missing, { node }), fill: "ask-ai" }], origin: "static", file };
  const read = readExplanation(input.raw, input.location);
  if (!read.ok) return { cards: [], holes: [{ reason: fillLabel(labels.invalid, { node, reason: read.reason }), fill: "ask-ai" }], origin: "static", file };
  const changed = changedSources(read.file, input.current);
  const stale = changed.length ? fillLabel(labels.stale, { paths: changed.join(", ") }) : null;
  const cards = read.file.rationales.map((r): ExplainCard => ({
    rationaleId: r.id, decisionPoint: r.decisionPoint, choice: r.choice, problemSolved: r.problemSolved, drivers: r.why,
    alternatives: r.alternatives, tradeoffs: r.tradeoffs, confidence: r.confidence, openQuestions: r.openQuestions,
    origin: "ai-proposed", badge: labels.badge, stale, writtenAt: read.file.writtenAt
  }));
  const holes: ExplainHole[] = read.issues.map(reason => ({ reason: fillLabel(labels.invalid, { node, reason }), fill: "ask-ai" as const }));
  return { cards, holes, origin: "ai-proposed", file };
}
