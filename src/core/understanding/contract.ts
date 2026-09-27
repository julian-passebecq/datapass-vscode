/**
 * V3-HOP1: the DataPass Hop contract (`datapass.understanding` version 1).
 *
 * A bridge file, written in advance by the client AI, that explains ONE native file visually:
 * vertical steps (milestones) tied to line ranges of the code, links between the steps and, for
 * SQL, the joins. DataPass validates it and renders it beside the code (V3-HOP2). Apache Hop is a
 * visual reference only: nothing in the native file or in this JSON is parsed as code or run.
 *
 * Location: `.datapass/understanding/<repositoryKey>/<native path>.json` in the bridge, where
 * `repositoryKey` is the manifest's repository key. The JSON is untrusted data: strict JSON reader,
 * size bounds, vetted paths, credential-shaped content refused.
 */
import { arr, enumOf, constOf, ID, DIGEST, obj, validateSchema, type Schema } from "../contracts/schemaDsl";
import { parseStrictJson, StrictJsonError } from "../model/strictJson";
import { vetRelativePath } from "../exchange/pathSafety";
import { scrubSecrets } from "../exchange/aiContext";

export const UNDERSTANDING_FORMAT = "datapass.understanding";
export const UNDERSTANDING_VERSION = 1;
export const UNDERSTANDING_DIR = ".datapass/understanding";

export const LANGUAGES = ["pyspark", "python", "sql", "airflow", "adf", "fabric-pipeline", "dockerfile", "bicep", "opentofu", "other"] as const;
export const STEP_KINDS = ["source", "read", "filter", "transform", "join", "aggregate", "write", "task", "branch", "config", "test", "other"] as const;
export const LINK_KINDS = ["data", "control", "dependency"] as const;
export const JOIN_TYPES = ["inner", "left", "right", "full", "cross", "semi", "anti"] as const;
/** Where a statement comes from: said by the code, deduced by the AI, a guess, or a drawing aid. */
export const PROVENANCE = ["declared", "inferred", "estimated", "illustrative"] as const;

export type UnderstandingLanguage = typeof LANGUAGES[number];
export type StepKind = typeof STEP_KINDS[number];
export type LinkKind = typeof LINK_KINDS[number];
export type JoinType = typeof JOIN_TYPES[number];
export type Provenance = typeof PROVENANCE[number];

/** Bounds: one file explained, so a few hundred steps at most. */
export const UNDERSTANDING_LIMITS = { maxBytes: 512 * 1024, steps: 300, links: 1000, joins: 200, names: 100, columns: 200, maxLine: 1_000_000 } as const;

export interface UnderstandingColumn { name: string; from?: string[]; note?: string }
export interface UnderstandingStep {
  id: string;
  title: string;
  kind: StepKind;
  /** 1-based, inclusive. */
  lines: [number, number];
  inputs?: string[];
  outputs?: string[];
  columns?: UnderstandingColumn[];
  note?: string;
  provenance: Provenance;
}
export interface UnderstandingLink { from: string; to: string; kind: LinkKind; note?: string }
export interface UnderstandingJoin {
  id: string;
  step: string;
  left: string;
  right: string;
  type: JoinType;
  keys: Array<[string, string]>;
  note?: string;
  provenance: Provenance;
}
export interface UnderstandingTarget {
  repository: string;
  path: string;
  /** SHA-256 of the native file's content when the JSON was written, line endings normalised to LF. */
  sha256: string;
  language: UnderstandingLanguage;
}
export interface UnderstandingDoc {
  format: typeof UNDERSTANDING_FORMAT;
  version: typeof UNDERSTANDING_VERSION;
  target: UnderstandingTarget;
  title: string;
  summary: string;
  component?: string;
  steps: UnderstandingStep[];
  links?: UnderstandingLink[];
  joins?: UnderstandingJoin[];
  milestoneLabels?: Array<{ step: string; label: string }>;
}

const str = (max: number): Schema => ({ type: "string", minLength: 1, maxLength: max });
const NAME = str(200);
const NOTE = str(2000);
const LINE: Schema = { type: "integer", minimum: 1, maximum: UNDERSTANDING_LIMITS.maxLine };
const L = UNDERSTANDING_LIMITS;

export const UNDERSTANDING_SCHEMA: Schema = obj({
  format: constOf(UNDERSTANDING_FORMAT),
  version: constOf(UNDERSTANDING_VERSION),
  target: obj({ repository: str(80), path: str(512), sha256: DIGEST, language: enumOf(...LANGUAGES) }),
  title: str(160),
  summary: str(4000),
  component: ID,
  steps: arr(obj({
    id: ID, title: str(160), kind: enumOf(...STEP_KINDS), lines: arr(LINE, 2, 2),
    inputs: arr(NAME, L.names), outputs: arr(NAME, L.names),
    columns: arr(obj({ name: NAME, from: arr(NAME, L.names), note: NOTE }, ["name"]), L.columns),
    note: NOTE, provenance: enumOf(...PROVENANCE)
  }, ["id", "title", "kind", "lines", "provenance"]), L.steps, 1),
  links: arr(obj({ from: ID, to: ID, kind: enumOf(...LINK_KINDS), note: NOTE }, ["from", "to", "kind"]), L.links),
  joins: arr(obj({
    id: ID, step: ID, left: NAME, right: NAME, type: enumOf(...JOIN_TYPES),
    keys: arr(arr(NAME, 2, 2), 20), note: NOTE, provenance: enumOf(...PROVENANCE)
  }, ["id", "step", "left", "right", "type", "keys", "provenance"]), L.joins),
  milestoneLabels: arr(obj({ step: ID, label: str(24) }), L.steps)
}, ["format", "version", "target", "title", "summary", "steps"]);

/** One finding about an understanding file. `code` is stable (tests and HOP2 key on it). */
export interface UnderstandingDiagnostic {
  severity: "error" | "warning";
  code:
    | "json" | "schema" | "credential" | "target-path" | "location" | "duplicate-id" | "line-range"
    | "unknown-step" | "self-link" | "duplicate-link" | "link-cycle" | "join-step" | "join-keys"
    | "unknown-repository" | "not-cloned" | "native-missing" | "native-unreadable" | "native-escape"
    | "lines-beyond-file" | "stale" | "oversized" | "unreadable" | "symlink" | "not-json" | "truncated";
  message: string;
  path?: string;
}

export interface ParsedUnderstanding { doc?: UnderstandingDoc; diagnostics: UnderstandingDiagnostic[] }

const err = (code: UnderstandingDiagnostic["code"], message: string, path?: string): UnderstandingDiagnostic => ({ severity: "error", code, message, ...(path ? { path } : {}) });
const warn = (code: UnderstandingDiagnostic["code"], message: string, path?: string): UnderstandingDiagnostic => ({ severity: "warning", code, message, ...(path ? { path } : {}) });

/** True when a diagnostic list holds an error (the file is then "invalid"). */
export const hasError = (d: readonly UnderstandingDiagnostic[]): boolean => d.some(x => x.severity === "error");

/** Every string of a parsed value, with its JSON path (bounded by the strict reader's own limits). */
function* strings(value: unknown, path = "$"): Generator<[string, string]> {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}[${i}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* strings(v, `${path}.${k}`);
}

/**
 * Parse and validate one understanding file on its own (no native file needed). Errors make the
 * document unusable (`doc` undefined); warnings keep it.
 */
export function parseUnderstanding(raw: string | Uint8Array): ParsedUnderstanding {
  const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
  if (bytes > L.maxBytes) return { diagnostics: [err("oversized", `The file is ${bytes} bytes; the limit is ${L.maxBytes}. Explain less per file or split it.`)] };
  let value: unknown;
  try {
    value = parseStrictJson(raw, { maxBytes: L.maxBytes, maxDepth: 12, maxEntries: 50_000, maxStringLength: 4000 });
  } catch (error) {
    return { diagnostics: [err("json", error instanceof StrictJsonError ? error.message : String(error))] };
  }
  const issues = validateSchema(UNDERSTANDING_SCHEMA, value);
  if (issues.length) return { diagnostics: issues.map(i => err("schema", `${i.path} ${i.message}`, i.path)) };

  const diagnostics: UnderstandingDiagnostic[] = [];
  // Credentials never belong in an explanation; the value itself is never echoed.
  for (const [p, s] of strings(value)) {
    if (scrubSecrets(s) !== s) { diagnostics.push(err("credential", "Credential-shaped text refused (value not shown). Name the secret's store, never its value.", p)); break; }
  }
  const doc = value as UnderstandingDoc;
  const vet = vetRelativePath(doc.target.path);
  if (!vet.ok) diagnostics.push(err("target-path", `target.path is refused: ${vet.reason}.`, "$.target.path"));
  else if (/^\.datapass(\/|$)/i.test(vet.relative)) diagnostics.push(err("target-path", "target.path must name a native file, not a DataPass file.", "$.target.path"));
  const repoVet = vetRelativePath(doc.target.repository);
  if (!repoVet.ok || repoVet.relative.includes("/")) diagnostics.push(err("target-path", "target.repository must be one manifest repository key (a single folder name).", "$.target.repository"));

  const steps = new Map<string, UnderstandingStep>();
  doc.steps.forEach((s, i) => {
    if (steps.has(s.id)) diagnostics.push(err("duplicate-id", `Step id "${s.id}" is used twice.`, `$.steps[${i}].id`));
    steps.set(s.id, s);
    if (s.lines[0] > s.lines[1]) diagnostics.push(err("line-range", `Step "${s.id}": lines [${s.lines[0]}, ${s.lines[1]}] start after they end.`, `$.steps[${i}].lines`));
  });
  const seenLinks = new Set<string>();
  (doc.links ?? []).forEach((l, i) => {
    const p = `$.links[${i}]`;
    for (const end of [l.from, l.to] as const) if (!steps.has(end)) diagnostics.push(err("unknown-step", `Link ${l.from} → ${l.to}: step "${end}" does not exist.`, p));
    if (l.from === l.to) diagnostics.push(err("self-link", `Link ${l.from} → ${l.to} points to itself.`, p));
    const key = `${l.from}\u0000${l.to}\u0000${l.kind}`;
    if (seenLinks.has(key)) diagnostics.push(warn("duplicate-link", `Link ${l.from} → ${l.to} (${l.kind}) is listed twice.`, p));
    seenLinks.add(key);
  });
  const cycle = findCycle(doc.links ?? [], steps);
  if (cycle) diagnostics.push(warn("link-cycle", `The links form a loop (${cycle.join(" → ")}); the view draws each step once.`, "$.links"));
  const joinIds = new Set<string>();
  (doc.joins ?? []).forEach((j, i) => {
    const p = `$.joins[${i}]`;
    if (joinIds.has(j.id)) diagnostics.push(err("duplicate-id", `Join id "${j.id}" is used twice.`, `${p}.id`));
    joinIds.add(j.id);
    const step = steps.get(j.step);
    if (!step) diagnostics.push(err("unknown-step", `Join "${j.id}": step "${j.step}" does not exist.`, `${p}.step`));
    else if (step.kind !== "join") diagnostics.push(warn("join-step", `Join "${j.id}" is attached to step "${j.step}", whose kind is ${step.kind} (expected join).`, `${p}.step`));
    if (j.type === "cross" ? j.keys.length > 0 : j.keys.length === 0) diagnostics.push(err("join-keys", j.type === "cross" ? `Join "${j.id}": a cross join has no keys.` : `Join "${j.id}": a ${j.type} join needs at least one key pair.`, `${p}.keys`));
  });
  const labelled = new Set<string>();
  (doc.milestoneLabels ?? []).forEach((m, i) => {
    if (!steps.has(m.step)) diagnostics.push(err("unknown-step", `Milestone label "${m.label}": step "${m.step}" does not exist.`, `$.milestoneLabels[${i}].step`));
    if (labelled.has(m.step)) diagnostics.push(err("duplicate-id", `Step "${m.step}" has two milestone labels.`, `$.milestoneLabels[${i}].step`));
    labelled.add(m.step);
  });
  return hasError(diagnostics) ? { diagnostics } : { doc, diagnostics };
}

/** First loop found in the links between known steps (iterative, so a long chain cannot overflow the stack). */
export function findCycle(links: readonly UnderstandingLink[], steps: ReadonlyMap<string, unknown>): string[] | undefined {
  const next = new Map<string, string[]>();
  for (const l of links) if (steps.has(l.from) && steps.has(l.to) && l.from !== l.to) (next.get(l.from) ?? next.set(l.from, []).get(l.from)!).push(l.to);
  const state = new Map<string, 1 | 2>();
  for (const start of steps.keys()) {
    if (state.has(start)) continue;
    const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const outs = next.get(top.id) ?? [];
      if (top.i >= outs.length) { state.set(top.id, 2); stack.pop(); continue; }
      const to = outs[top.i++]!;
      const s = state.get(to);
      if (s === 1) { const from = stack.findIndex(f => f.id === to); return [...stack.slice(from).map(f => f.id), to]; }
      if (s === undefined) { state.set(to, 1); stack.push({ id: to, i: 0 }); }
    }
  }
  return undefined;
}

/** Text as hashed for `target.sha256`: UTF-8, a leading BOM dropped, CRLF and CR turned into LF. */
export function normaliseNativeText(bytes: Uint8Array): string {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, "\n");
}

/** Lines of a native file, as an editor counts them (a final newline does not open a new line). */
export function lineCount(text: string): number {
  if (!text) return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/** Checks that need the native file's text: every step's lines exist in it. */
export function checkAgainstNative(doc: UnderstandingDoc, lines: number): UnderstandingDiagnostic[] {
  const out: UnderstandingDiagnostic[] = [];
  doc.steps.forEach((s, i) => {
    if (s.lines[1] > lines) out.push(err("lines-beyond-file", `Step "${s.id}": lines [${s.lines[0]}, ${s.lines[1]}] go beyond the file's ${lines} lines.`, `$.steps[${i}].lines`));
  });
  return out;
}
