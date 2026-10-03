/**
 * V4-NAV NAVCHG1 binding `change-summary`: the review page of one Git change (dbt Cloud change-review shape).
 * A change is the local working changes of a repository, a commit range, or a pull request already known to
 * the Git view (diagramGit `ChangeSet`). Three parts, one per view of the `changes` pack:
 *
 *   summary   counts by status and artifact kind (origin static), plus Assumptions and Expectations — those
 *             only from `.datapass/explain/changes/<base>..<head>.json`, written by the client AI through the
 *             AI exchange (origin ai-proposed, NAVAIX1 rules); else a hole with the "ask the AI" fill
 *   impact    a graph of the added / modified / removed nodes and the downstream nodes they reach in the
 *             lineage graph (statuses styled from legend data); without lineage, the touched components
 *   files     one row per changed file, opened as a read-only diff (never a checkout)
 *
 * Pure: Git, the file reader and the lineage graph are injected by the host; per-file facts come from Common
 * semantic-diff (`gitSemanticDiffer`, text only). Nothing is
 * guessed — what cannot be read is a typed hole with its reason. No client code is executed.
 */
import { prDiffArgs, MAX_FILES } from "../../git/diagramGit";
import { isSha } from "../../git/porcelain";
import type { RevRequest } from "../../git/fileVersions";
import type { GitRunner } from "../../workspace/gitBase";
import { diffFile, type FileSide } from "@juliandatapass-group/semantic-diff";
import { vetRelativePath } from "../../exchange/pathSafety";
import type { NavLocation } from "../navTypes";
import type { BindingCard, BindingGraph, BindingMetric, BindingProvider, BindingResult, BindingRow } from "./index";

export const CHANGE_SUMMARY_SOURCE = "change-summary";
export const CHANGE_EXPLANATION_SCHEMA_ID = "datapass.change-explanation/1";
export const CHANGE_EXPLAIN_DIR = ".datapass/explain/changes";
export const CHANGE_PARTS = ["summary", "impact", "files"] as const;
export type ChangePart = (typeof CHANGE_PARTS)[number];
export const CHANGE_STATUSES = ["added", "modified", "removed", "renamed"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
/** Status of a graph node: a changed node, or one only reached downstream. */
export type ImpactStatus = Exclude<ChangeStatus, "renamed"> | "impacted";

// ---------- labels (data: a ViewDef's params.labels or a setting overrides them) ----------

export interface ChangeLabels {
  restricted: string; noChange: string; pickChange: string; diffFailed: string; revFailed: string; truncated: string;
  noLineage: string; noLineageNode: string; outside: string; noSemantic: string;
  missingExplain: string; invalidExplain: string; askAi: string;
  summaryTitle: string; assumptionsTitle: string; expectationsTitle: string;
  fChange: string; fRange: string; fFiles: string; fByStatus: string; fByKind: string; fWritten: string;
  local: string; range: string; pr: string; worktree: string;
  orderTitle: string; orderNote: string;
}
export const DEFAULT_CHANGE_LABELS: ChangeLabels = {
  restricted: "Restricted Mode: trust this workspace before DataPass runs Git.",
  noChange: "This change has no changed file.",
  pickChange: "No change is open: run “DataPass: Change summary” and pick a change.",
  diffFailed: "Git could not list the files of {change}.",
  revFailed: "Git could not resolve {ref} (fetch the branch first; DataPass never fetches for this view).",
  truncated: "Only the first {max} changed files are listed.",
  noLineage: "Downstream impact unknown: no lineage graph for this project yet; the graph shows the touched components.",
  noLineageNode: "No lineage node is built from the changed files; downstream impact unknown.",
  outside: "{count} changed file(s) belong to no component.",
  noSemantic: "Tables read and written per file need the Common semantic diff, not available in this build.",
  missingExplain: "No AI assumptions or expectations yet for {range}.",
  invalidExplain: "The AI explanation of {range} was refused: {reason}",
  askAi: "Ask the AI for assumptions and expectations",
  summaryTitle: "Summary", assumptionsTitle: "Assumptions", expectationsTitle: "Expectations",
  fChange: "Change", fRange: "Range", fFiles: "Files", fByStatus: "By status", fByKind: "By kind", fWritten: "Written",
  local: "Local changes in {repo}", range: "{base}..{head} in {repo}", pr: "PR #{number}: {title}", worktree: "working tree",
  orderTitle: "Explain change {range} for DataPass",
  orderNote: "DataPass change summary: the AI writes {file}; nothing is written until you confirm the order."
};
export function changeLabels(overrides: unknown): ChangeLabels {
  const o = obj(overrides) ?? {};
  const out: Record<string, string> = { ...DEFAULT_CHANGE_LABELS };
  for (const k of Object.keys(DEFAULT_CHANGE_LABELS)) { const v = o[k]; if (typeof v === "string" && v.trim() && v.length <= 300) out[k] = v; }
  return out as unknown as ChangeLabels;
}
export const fill = (t: string, v: Readonly<Record<string, string | number>>): string => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

// ---------- the change and its files ----------

export type ChangeTarget =
  | { readonly kind: "local"; readonly repo: string; readonly repoKey: string; readonly repoLabel: string }
  | { readonly kind: "range"; readonly repo: string; readonly repoKey: string; readonly repoLabel: string; readonly base: string; readonly head: string }
  | { readonly kind: "pr"; readonly repo: string; readonly repoKey: string; readonly repoLabel: string; readonly defaultBranch: string; readonly head: string; readonly number: number; readonly title: string };

/** A ref the user may type for a range: a hash, a branch or a tag, `~n`/`^n` suffixes; never an option or `..`. */
export function isRangeRef(s: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}(?:[~^]\d{0,3})*$/.test(s) && !s.includes("..") && !s.endsWith(".lock") && !s.endsWith("/");
}

export function changeTitle(t: ChangeTarget, labels: ChangeLabels = DEFAULT_CHANGE_LABELS): string {
  if (t.kind === "local") return fill(labels.local, { repo: t.repoLabel });
  if (t.kind === "range") return fill(labels.range, { base: t.base, head: t.head, repo: t.repoLabel });
  return fill(labels.pr, { number: t.number, title: t.title });
}

/** The listing command of a change (read-only). */
export function changeListArgs(t: ChangeTarget): string[] | undefined {
  if (t.kind === "local") return ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  if (t.kind === "pr") return prDiffArgs(t.defaultBranch, t.head);
  return isRangeRef(t.base) && isRangeRef(t.head) ? ["diff", "--name-status", "-z", "-M", `${t.base}..${t.head}`, "--"] : undefined;
}

/** The two refs whose hashes name the change: base and head (local: HEAD and the working tree). */
export function changeRefs(t: ChangeTarget): { base: string[]; head: string[] | null } | undefined {
  const verify = (ref: string) => ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`];
  if (t.kind === "local") return { base: verify("HEAD"), head: null };
  if (t.kind === "range") return isRangeRef(t.base) && isRangeRef(t.head) ? { base: verify(t.base), head: verify(t.head) } : undefined;
  if (!prDiffArgs(t.defaultBranch, t.head)) return undefined;
  return { base: ["merge-base", `refs/remotes/origin/${t.defaultBranch}`, `refs/remotes/origin/${t.head}`], head: verify(`refs/remotes/origin/${t.head}`) };
}

export interface ChangedFile { readonly path: string; readonly oldPath?: string; readonly status: ChangeStatus }

const statusOf = (c: string): ChangeStatus => (c === "A" || c === "?" ? "added" : c === "D" ? "removed" : c === "R" ? "renamed" : "modified");
const posix = (p: string) => p.replace(/\\/g, "/");

/** `git diff --name-status -z` entries with their status (copies count as added). */
export function parseNameStatus(stdout: string): ChangedFile[] {
  const parts = stdout.split("\0");
  const out: ChangedFile[] = [];
  for (let i = 0; i < parts.length;) {
    const s = parts[i] ?? "";
    if (!/^[ACDMRTUXB]\d*$/.test(s)) { i += 1; continue; }
    if (/^[RC]/.test(s)) {
      const from = parts[i + 1], to = parts[i + 2];
      if (from && to) out.push(s[0] === "R" ? { path: posix(to), oldPath: posix(from), status: "renamed" } : { path: posix(to), status: "added" });
      i += 3;
    } else {
      const p = parts[i + 1];
      if (p) out.push({ path: posix(p), status: statusOf(s[0]!) });
      i += 2;
    }
  }
  return out;
}

/** `git status --porcelain=v1 -z` entries: the index or worktree letter that matters, renames with their source. */
export function parsePorcelainStatus(stdout: string): ChangedFile[] {
  const parts = stdout.split("\0");
  const out: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i]!;
    if (e.length < 4) continue;
    const x = e[0]!, y = e[1]!, p = posix(e.slice(3));
    if (/[RC]/.test(x) && parts[i + 1]) { out.push(x === "R" ? { path: p, oldPath: posix(parts[i + 1]!), status: "renamed" } : { path: p, status: "added" }); i += 1; continue; }
    const letter = x === "?" ? "?" : x === "D" || y === "D" ? "D" : x === "A" ? "A" : "M";
    out.push({ path: p, status: statusOf(letter) });
  }
  return out;
}

/** Artifact kind of a changed file: first matching rule (data; a view's params.fileKinds replaces it). */
export interface FileKindRule { readonly pattern: string; readonly kind: string }
export const DEFAULT_FILE_KINDS: readonly FileKindRule[] = [
  { pattern: "(^|/)dbt_project\\.yml$|(^|/)models/.+\\.sql$", kind: "dbt-model" },
  { pattern: "\\.sql$", kind: "sql-script" },
  { pattern: "\\.ipynb$", kind: "python-notebook" },
  { pattern: "(^|/)dags/.+\\.py$", kind: "airflow-dag" },
  { pattern: "\\.py$", kind: "spark-job" },
  { pattern: "\\.(pbix|pbip|tmdl|bim)$|\\.Report/|\\.SemanticModel/", kind: "powerbi" },
  { pattern: "\\.(tf|bicep)$|(^|/)arm/.+\\.json$", kind: "iac" },
  { pattern: "(^|/)(pipeline|pipelines)/.+\\.json$|azure-pipelines\\.ya?ml$|\\.gitlab-ci\\.ya?ml$", kind: "pipeline" },
  { pattern: "\\.(ya?ml|json|toml|ini|cfg|conf)$", kind: "config" }
];
export function fileKindRules(raw: unknown): FileKindRule[] {
  if (!Array.isArray(raw)) return [...DEFAULT_FILE_KINDS];
  const out: FileKindRule[] = [];
  for (const r of raw.slice(0, 64)) {
    const o = obj(r);
    if (!o || typeof o.pattern !== "string" || typeof o.kind !== "string" || o.pattern.length > 300 || !o.kind.trim()) continue;
    try { new RegExp(o.pattern, "i"); out.push({ pattern: o.pattern, kind: o.kind.slice(0, 64) }); } catch { /* skipped: not a pattern */ }
  }
  return out.length ? out : [...DEFAULT_FILE_KINDS];
}
export function fileKind(path: string, rules: readonly FileKindRule[] = DEFAULT_FILE_KINDS): string {
  return rules.find(r => new RegExp(r.pattern, "i").test(path))?.kind ?? "other";
}

// ---------- AI assumptions and expectations (NAVAIX1 rules, one file per change) ----------

export interface ChangeRange { readonly base: string; readonly head: string }
export const WORKTREE = "worktree";
const short = (s: string) => (s === WORKTREE ? s : s.slice(0, 12));
export const rangeText = (r: ChangeRange) => `${short(r.base)}..${short(r.head)}`;
export const explainChangePathOf = (r: ChangeRange): string => `${CHANGE_EXPLAIN_DIR}/${rangeText(r)}.json`;

export interface ChangeExplanation { readonly assumptions: readonly string[]; readonly expectations: readonly string[]; readonly writtenAt: string | null; readonly author: string | null }
export type ChangeExplanationRead = { readonly ok: true; readonly file: ChangeExplanation } | { readonly ok: false; readonly reason: string };
const LIMITS = { text: 2000, items: 32, bytes: 256_000 };
/** Credentials never reach the view, whatever the AI wrote (same rule as NAVAIX1). */
const SECRETISH = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|sqlserver):\/\/|\bAccountKey=|\bglpat-|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{16,}/i;

/** Validates the AI's file: right schema, this exact range, origin ai-proposed, text lists; nothing else is read. */
export function readChangeExplanation(raw: string | unknown, expected: ChangeRange): ChangeExplanationRead {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > LIMITS.bytes) return { ok: false, reason: "file too large" };
    try { v = JSON.parse(raw); } catch { return { ok: false, reason: "not valid JSON" }; }
  }
  const o = obj(v);
  if (!o || o.schema !== CHANGE_EXPLANATION_SCHEMA_ID) return { ok: false, reason: `schema must be ${CHANGE_EXPLANATION_SCHEMA_ID}` };
  const r = obj(o.range);
  const same = (a: unknown, b: string) => typeof a === "string" && (a === b || (b !== WORKTREE && a.length >= 7 && b.startsWith(a)));
  if (!r || !same(r.base, expected.base) || !same(r.head, expected.head)) return { ok: false, reason: "the file explains another range" };
  if (o.origin !== "ai-proposed") return { ok: false, reason: "origin must be ai-proposed" };
  const list = (x: unknown) => Array.isArray(x) ? x.slice(0, LIMITS.items).filter((s): s is string => typeof s === "string" && /\S/.test(s) && s.length <= LIMITS.text).map(s => s.trim()) : [];
  const assumptions = list(o.assumptions), expectations = list(o.expectations);
  if (!assumptions.length && !expectations.length) return { ok: false, reason: "no assumption and no expectation" };
  if (SECRETISH.test(JSON.stringify([assumptions, expectations]))) return { ok: false, reason: "contains credential-shaped text" };
  const writtenAt = typeof o.writtenAt === "string" && !Number.isNaN(Date.parse(o.writtenAt)) ? o.writtenAt : null;
  const author = typeof o.author === "string" && o.author.trim() && o.author.length <= 100 ? o.author.trim() : null;
  return { ok: true, file: { assumptions, expectations, writtenAt, author } };
}

export interface ChangeOrderDraft { readonly kind: "prepare-files"; readonly title: string; readonly goal: string; readonly doneWhen: string[]; readonly note: string }

/** The work order of the "ask the AI" fill: the client AI writes the file; DataPass never calls an AI itself. */
export function changeExplainOrderDraft(title: string, range: ChangeRange, files: readonly ChangedFile[], labels: ChangeLabels = DEFAULT_CHANGE_LABELS): ChangeOrderDraft {
  const file = explainChangePathOf(range);
  const skeleton = {
    schema: CHANGE_EXPLANATION_SCHEMA_ID, range: { base: range.base, head: range.head }, origin: "ai-proposed", author: "<your AI name>", writtenAt: "<ISO date>",
    assumptions: ["<what this change takes for granted: inputs, data shape, environment, ordering>"],
    expectations: ["<what should be observably true after it runs: rows, tables, schedules, reports>"]
  };
  const goal = [
    `Write the DataPass review notes of the change ${title} (${rangeText(range)}): the JSON file ${file} at the root of the repository.`,
    "",
    "Changed files (read them and their diff; do not change them):",
    ...files.slice(0, 100).map(f => `- ${f.status} ${f.oldPath ? `${f.oldPath} → ` : ""}${f.path}`),
    ...(files.length > 100 ? [`- … and ${files.length - 100} more`] : []),
    "",
    "- assumptions: one sentence each, what the change relies on and nobody checked yet.",
    "- expectations: one sentence each, what a reviewer should see after it runs, testable when possible.",
    "- Origin stays \"ai-proposed\". Do not change any other file. Never write a credential or a connection string.",
    "",
    JSON.stringify(skeleton, null, 2)
  ].join("\n");
  const range_ = rangeText(range);
  return { kind: "prepare-files", title: fill(labels.orderTitle, { range: range_ }).slice(0, 80), goal, doneWhen: [`${file} exists and the Change summary shows its assumptions and expectations`], note: fill(labels.orderNote, { file }) };
}

// ---------- impact: lineage downstream, else components ----------

/** Structural subset of lineage-core `datapass.lineage-graph/1` (same as the NAVLIN1 binding reads). */
export interface ImpactLineageLike {
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly name: string; readonly evidence: readonly { readonly locator: { readonly path: string } | null }[] }[];
  readonly edges: readonly { readonly id: string; readonly kind: string; readonly fromId: string; readonly toId: string }[];
}
export const IMPACT_DEFAULTS = { depth: 3, maxNodes: 200, edgeKinds: ["reads", "writes", "derives"] as readonly string[] };

export interface ImpactNode { readonly id: string; readonly label: string; readonly kind: string; readonly status: ImpactStatus; readonly distance: number }
export interface ImpactEdge { readonly id: string; readonly fromId: string; readonly toId: string; readonly kind: string }
export interface Impact { readonly nodes: readonly ImpactNode[]; readonly edges: readonly ImpactEdge[]; readonly truncated: boolean; readonly basis: "lineage" | "components" }

const mergeStatus = (a: ImpactStatus | undefined, b: ImpactStatus): ImpactStatus => (a === undefined || a === b ? b : "modified");
const nodeStatus = (s: ChangeStatus): ImpactStatus => (s === "renamed" ? "modified" : s);

/** Changed lineage nodes (evidence in a changed file) and what they reach downstream (data-flow direction), bounded. */
export function lineageImpact(graph: ImpactLineageLike, files: readonly ChangedFile[], opts: Partial<typeof IMPACT_DEFAULTS> = {}): Impact | null {
  const depth = Math.max(0, Math.min(8, opts.depth ?? IMPACT_DEFAULTS.depth));
  const maxNodes = Math.max(1, Math.min(1000, opts.maxNodes ?? IMPACT_DEFAULTS.maxNodes));
  const kinds = new Set(opts.edgeKinds ?? IMPACT_DEFAULTS.edgeKinds);
  const byPath = new Map<string, ChangeStatus>();
  for (const f of files) { byPath.set(f.path, f.status); if (f.oldPath) byPath.set(f.oldPath, f.status); }
  const seeds = new Map<string, ImpactStatus>();
  for (const n of graph.nodes) for (const e of n.evidence) {
    const s = e.locator && byPath.get(posix(e.locator.path));
    if (s) seeds.set(n.id, mergeStatus(seeds.get(n.id), nodeStatus(s)));
  }
  if (!seeds.size) return null;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const dist = new Map<string, number>([...seeds.keys()].map(id => [id, 0]));
  const edges: ImpactEdge[] = [];
  let frontier = [...seeds.keys()], truncated = false;
  for (let d = 1; d <= depth && frontier.length; d += 1) {
    const next: string[] = [];
    for (const e of graph.edges) {
      if (!kinds.has(e.kind) || !frontier.includes(e.fromId) || !byId.has(e.toId)) continue;
      if (!dist.has(e.toId)) {
        if (dist.size >= maxNodes) { truncated = true; continue; }
        dist.set(e.toId, d); next.push(e.toId);
      }
      edges.push({ id: e.id, fromId: e.fromId, toId: e.toId, kind: e.kind });
    }
    frontier = next;
  }
  const nodes = [...dist].map(([id, distance]) => {
    const n = byId.get(id)!;
    return { id, label: n.name, kind: n.kind, status: seeds.get(id) ?? "impacted", distance };
  });
  return { nodes, edges: dedupe(edges), truncated, basis: "lineage" };
}

/** Without lineage: the touched components, each with the status of its files. */
export function componentImpact(components: readonly { id: string; label: string; files: readonly string[] }[], files: readonly ChangedFile[]): Impact {
  const st = new Map(files.flatMap(f => [[f.path, f.status], ...(f.oldPath ? [[f.oldPath, f.status] as const] : [])] as [string, ChangeStatus][]));
  const nodes = components.map(c => {
    const s = c.files.map(p => st.get(p)).filter((x): x is ChangeStatus => !!x).map(nodeStatus);
    return { id: c.id, label: c.label, kind: "component", status: s.reduce<ImpactStatus | undefined>((a, b) => mergeStatus(a, b), undefined) ?? "modified", distance: 0 };
  });
  return { nodes, edges: [], truncated: false, basis: "components" };
}
const dedupe = (es: ImpactEdge[]) => [...new Map(es.map(e => [e.id, e])).values()];

/** Status → look (legend data; a view's params.legend overrides entries). Colours are theme tokens or #rrggbb. */
export interface StatusStyle { readonly label: string; readonly shape: string; readonly color: string; readonly border: string }
export const DEFAULT_CHANGE_LEGEND: Readonly<Record<ImpactStatus, StatusStyle>> = {
  added: { label: "New", shape: "rounded", color: "gitDecoration-addedResourceForeground", border: "solid" },
  modified: { label: "Modified", shape: "rounded", color: "gitDecoration-modifiedResourceForeground", border: "solid" },
  removed: { label: "Removed", shape: "rounded", color: "gitDecoration-deletedResourceForeground", border: "dashed" },
  impacted: { label: "Impacted downstream", shape: "rounded", color: "descriptionForeground", border: "dotted" }
};
export function changeLegend(raw: unknown): Record<ImpactStatus, StatusStyle> {
  const o = obj(raw) ?? {};
  const out = { ...DEFAULT_CHANGE_LEGEND } as Record<ImpactStatus, StatusStyle>;
  for (const k of Object.keys(DEFAULT_CHANGE_LEGEND) as ImpactStatus[]) {
    const v = obj(o[k]);
    if (!v) continue;
    const s = (x: unknown, d: string) => (typeof x === "string" && /^[A-Za-z0-9#._ -]{1,80}$/.test(x) ? x : d);
    out[k] = { label: s(v.label, out[k].label), shape: s(v.shape, out[k].shape), color: s(v.color, out[k].color), border: s(v.border, out[k].border) };
  }
  return out;
}

/** The impact as a view-spi `datapass.graph-view/1` (the fields the NAVREN2 graph layout reads). */
export function impactGraphView(impact: Impact, legend: Readonly<Record<ImpactStatus, StatusStyle>> = DEFAULT_CHANGE_LEGEND) {
  const style = (s: ImpactStatus) => ({ shape: legend[s].shape, color: legend[s].color, border: legend[s].border });
  const edgeStyle = { line: "solid", color: "foreground", width: 1, arrow: "end" };
  const used = [...new Set(impact.nodes.map(n => n.status))];
  return {
    schema: "datapass.graph-view/1" as const,
    groups: [] as { id: string; label: string; memberCount: number; collapsed: boolean; color: string }[],
    nodes: impact.nodes.map(n => ({ id: n.id, kind: n.kind, label: n.label, groupId: null, origin: "static", certain: true, memberIds: [] as string[], style: style(n.status), status: n.status })),
    edges: impact.edges.map(e => ({ id: e.id, fromId: e.fromId, toId: e.toId, kinds: [e.kind], origin: "static", certain: true, volumetry: null, style: edgeStyle })),
    legend: (Object.keys(legend) as ImpactStatus[]).filter(s => used.includes(s)).map(s => ({ label: legend[s].label, target: "node" as const, ruleId: `change-${s}`, nodeStyle: style(s), edgeStyle: null }))
  };
}

// ---------- semantic facts (Common semantic-diff over read-only revisions) ----------

/** The `datapass.semantic-diff.file/1` fields a file row shows (TableRef reads/writes, notes). */
export interface SemanticFileLike {
  readonly tables: { readonly added: readonly { name: string; access: string }[]; readonly removed: readonly { name: string; access: string }[] };
  readonly notes: readonly string[];
  readonly formatOnly: boolean;
}
export type SemanticDiffer = (file: ChangedFile, range: ChangeRange) => Promise<SemanticFileLike | null>;

/** Above this a side is not read (semantic-diff `too-large`). */
export const SEMANTIC_MAX_BYTES = 1_000_000;

/** One side's text: `git show <sha>:<path>` (read-only), the working file for the worktree; skipped when binary or too large. */
export async function readSide(git: GitRunner, repo: string, rev: string, rel: string, readWorking: (rel: string) => Promise<string | null>): Promise<FileSide> {
  const vet = vetRelativePath(rel);
  if (!vet.ok) return { skipped: "unreadable" };
  let text: string | null;
  if (rev === WORKTREE) text = await readWorking(vet.relative).catch(() => null);
  else {
    if (!isSha(rev)) return { skipped: "unreadable" };
    const r = await git(["show", `${rev}:${vet.relative}`], repo, 10000);
    text = r.ok ? r.stdout : null;
  }
  if (text === null) return null;
  if (text.length > SEMANTIC_MAX_BYTES) return { skipped: "too-large" };
  return text.includes("\0") ? { skipped: "binary" } : text;
}

/** Common `diffFile` over both sides of a changed file (static text facts; nothing is executed). */
export function gitSemanticDiffer(git: GitRunner, repo: string, readWorking: (rel: string) => Promise<string | null>): SemanticDiffer {
  return async (f, range) => {
    const before = f.status === "added" ? null : await readSide(git, repo, range.base, f.oldPath ?? f.path, readWorking);
    const after = f.status === "removed" ? null : await readSide(git, repo, range.head, f.path, readWorking);
    return diffFile({ path: f.path, fromPath: f.oldPath ?? null, before, after });
  };
}
export function tablesText(s: SemanticFileLike): string {
  const t = [...s.tables.added.map(x => `+${x.access} ${x.name}`), ...s.tables.removed.map(x => `−${x.access} ${x.name}`)];
  return [...t, ...s.notes, ...(s.formatOnly ? ["format only"] : [])].slice(0, 12).join(", ");
}

// ---------- the summary (computed once per change by the host, then served synchronously) ----------

export interface ChangeFileRow {
  readonly id: string; readonly path: string; readonly oldPath?: string; readonly status: ChangeStatus; readonly kind: string;
  readonly component?: string; readonly semantic?: string;
}
export interface Hole { readonly reason: string; readonly fill?: "ask-ai"; readonly part?: ChangePart }
export interface ChangeSummary {
  readonly target: ChangeTarget;
  readonly title: string;
  readonly range: ChangeRange | null;
  readonly files: readonly ChangeFileRow[];
  readonly truncated: boolean;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly byKind: Readonly<Record<string, number>>;
  readonly impact: Impact | null;
  readonly explanation: ChangeExplanation | null;
  readonly explainFile: string | null;
  readonly holes: readonly Hole[];
  readonly computedAt: string;
}

export interface ChangeSummaryDeps {
  readonly git: GitRunner;
  readonly trusted: boolean;
  /** Text of a repository file, or null when absent (the AI explanation). */
  readonly readFile: (repo: string, rel: string) => Promise<string | null>;
  /** Components of the change's repository touched by these paths (diagramGit/gitSync `changedComponents`). */
  readonly components?: (paths: readonly string[]) => { id: string; label: string; files: string[] }[];
  readonly lineage?: ImpactLineageLike | null;
  readonly semantic?: SemanticDiffer;
  readonly labels?: Partial<ChangeLabels>;
  readonly fileKinds?: readonly FileKindRule[];
  readonly impact?: Partial<typeof IMPACT_DEFAULTS>;
  readonly now?: () => Date;
}

const count = (xs: readonly string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

export async function collectChangeSummary(target: ChangeTarget, deps: ChangeSummaryDeps): Promise<ChangeSummary> {
  const L = { ...DEFAULT_CHANGE_LABELS, ...deps.labels };
  const title = changeTitle(target, L);
  const empty = (holes: Hole[]): ChangeSummary => ({ target, title, range: null, files: [], truncated: false, byStatus: {}, byKind: {}, impact: null, explanation: null, explainFile: null, holes, computedAt: (deps.now?.() ?? new Date()).toISOString() });
  if (!deps.trusted) return empty([{ reason: L.restricted }]);
  const args = changeListArgs(target), refs = changeRefs(target);
  if (!args || !refs) return empty([{ reason: fill(L.diffFailed, { change: title }) }]);
  const sha = async (a: string[], ref: string): Promise<string | Hole> => {
    const r = await deps.git(a, target.repo, 10000);
    const s = r.stdout.trim().split(/\r?\n/)[0];
    return r.ok && isSha(s) ? s : { reason: fill(L.revFailed, { ref }) };
  };
  const refName = target.kind === "range" ? [target.base, target.head] : target.kind === "pr" ? [`origin/${target.defaultBranch}`, `origin/${target.head}`] : ["HEAD", ""];
  const base = await sha(refs.base, refName[0]!);
  const head = refs.head ? await sha(refs.head, refName[1]!) : WORKTREE;
  const holes: Hole[] = [];
  for (const x of [base, head]) if (typeof x !== "string") holes.push(x);
  const list = await deps.git(args, target.repo, 20000);
  if (!list.ok) return empty([...holes, { reason: fill(L.diffFailed, { change: title }) }]);
  const all = target.kind === "local" ? parsePorcelainStatus(list.stdout) : parseNameStatus(list.stdout);
  const changed = all.slice(0, MAX_FILES);
  const truncated = all.length > MAX_FILES;
  if (truncated) holes.push({ reason: fill(L.truncated, { max: MAX_FILES }), part: "files" });
  if (!changed.length) holes.push({ reason: L.noChange });

  const kinds = deps.fileKinds ?? DEFAULT_FILE_KINDS;
  const comps = deps.components?.(changed.flatMap(f => (f.oldPath ? [f.path, f.oldPath] : [f.path]))) ?? [];
  const compOf = new Map<string, string>();
  for (const c of comps) for (const p of c.files) if (!compOf.has(p)) compOf.set(p, c.id);
  const outside = changed.filter(f => !compOf.has(f.path) && !(f.oldPath && compOf.has(f.oldPath))).length;
  if (deps.components && outside) holes.push({ reason: fill(L.outside, { count: outside }), part: "impact" });

  const rangeOk = typeof base === "string" && typeof head === "string";
  const files: ChangeFileRow[] = [];
  for (const f of changed) {
    const semantic = deps.semantic && rangeOk ? await deps.semantic(f, { base: base as string, head: head as string }).catch(() => null) : null;
    const component = compOf.get(f.path) ?? (f.oldPath ? compOf.get(f.oldPath) : undefined);
    files.push({ id: `${f.status}:${f.oldPath ?? ""}:${f.path}`, path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}), status: f.status, kind: fileKind(f.path, kinds),
      ...(component ? { component } : {}), ...(semantic ? { semantic: tablesText(semantic) } : {}) });
  }
  if (!deps.semantic && changed.length) holes.push({ reason: L.noSemantic, part: "files" });

  let impact: Impact | null = null;
  if (deps.lineage) {
    impact = lineageImpact(deps.lineage, changed, deps.impact);
    if (!impact) holes.push({ reason: L.noLineageNode, part: "impact" });
  } else if (changed.length) holes.push({ reason: L.noLineage, part: "impact" });
  if (!impact && comps.length) impact = componentImpact(comps, changed);

  let explanation: ChangeExplanation | null = null, explainFile: string | null = null;
  if (typeof base === "string" && typeof head === "string") {
    const range = { base, head };
    explainFile = explainChangePathOf(range);
    const raw = await deps.readFile(target.repo, explainFile).catch(() => null);
    const text = rangeText(range);
    if (raw === null) holes.push({ reason: fill(L.missingExplain, { range: text }), fill: "ask-ai", part: "summary" });
    else {
      const read = readChangeExplanation(raw, range);
      if (read.ok) explanation = read.file;
      else holes.push({ reason: fill(L.invalidExplain, { range: text, reason: read.reason }), fill: "ask-ai", part: "summary" });
    }
  }
  const range = typeof base === "string" && typeof head === "string" ? { base, head } : null;
  return {
    target, title, range, files, truncated, byStatus: count(files.map(f => f.status)), byKind: count(files.map(f => f.kind)),
    impact, explanation, explainFile, holes, computedAt: (deps.now?.() ?? new Date()).toISOString()
  };
}

// ---------- the binding provider (synchronous: serves the last computed summary) ----------

const tally = (m: Readonly<Record<string, number>>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${n} ${k}`).join(", ") || "0";

/** At an artifact Location only that component's files are shown. */
function scoped(s: ChangeSummary, location: NavLocation | undefined): ChangeSummary {
  if (!location || location.level !== "artifact") return s;
  const files = s.files.filter(f => f.component === location.nodeId);
  return { ...s, files, byStatus: count(files.map(f => f.status)), byKind: count(files.map(f => f.kind)) };
}

/** One part of the summary as a registry `BindingResult` (rows, graph, cards, metrics; holes typed `ask-ai` when the AI can fill them). */
export function changeSummaryBinding(summary: ChangeSummary | null, part: unknown, opts: { location?: NavLocation; labels?: unknown; legend?: unknown } = {}): BindingResult {
  const L = changeLabels(opts.labels);
  const p: ChangePart = (CHANGE_PARTS as readonly unknown[]).includes(part) ? part as ChangePart : "summary";
  if (!summary) return { holes: [{ reason: L.pickChange }], origin: "static" };
  const s = scoped(summary, opts.location);
  // Hole kinds (`ask-ai`) join the registry type with NAVDATA1; until then the reason carries it.
  const holes = s.holes.filter(h => !h.part || h.part === p).map(h => ({ reason: h.reason }));
  if (p === "files") {
    const rows: BindingRow[] = s.files.map(f => ({
      id: f.id, label: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path, origin: "static",
      status: f.status, kind: f.kind, component: f.component ?? null, semantic: f.semantic ?? null
    }));
    return { rows, holes, origin: "static" };
  }
  if (p === "impact") {
    if (!s.impact) return { holes, origin: "static" };
    const legend = changeLegend(opts.legend);
    // Nodes carry their status and its legend style; `graphView` is the same graph as view-spi graph-view/1 (NAVREN2 layout).
    const nodes = s.impact.nodes.map(n => ({ id: n.id, label: n.label, origin: "static", status: n.status, kind: n.kind, style: legend[n.status] }));
    const edges = s.impact.edges.map(e => ({ source: e.fromId, target: e.toId, label: e.kind, origin: "static" }));
    const graph: BindingGraph & { graphView: unknown } = { nodes, edges, graphView: impactGraphView(s.impact, legend) };
    return { graph, holes, origin: "static" };
  }
  const field = (label: string, value: string | number, origin = "static") => ({ label, value: String(value), origin });
  const cards: BindingCard[] = [{
    title: L.summaryTitle,
    fields: [
      field(L.fChange, s.title),
      ...(s.range ? [field(L.fRange, rangeText(s.range).replace(WORKTREE, L.worktree))] : []),
      field(L.fFiles, s.files.length), field(L.fByStatus, tally(s.byStatus)), field(L.fByKind, tally(s.byKind))
    ]
  }];
  if (s.explanation) {
    const e = s.explanation;
    const w = e.writtenAt ? [field(L.fWritten, `${e.writtenAt.slice(0, 16).replace("T", " ")}${e.author ? ` · ${e.author}` : ""}`, "ai-proposed")] : [];
    if (e.assumptions.length) cards.push({ title: L.assumptionsTitle, fields: [...e.assumptions.map((a, i) => field(`${i + 1}`, a, "ai-proposed")), ...w] });
    if (e.expectations.length) cards.push({ title: L.expectationsTitle, fields: [...e.expectations.map((a, i) => field(`${i + 1}`, a, "ai-proposed")), ...w] });
  }
  const metrics: BindingMetric[] = [...CHANGE_STATUSES.map(st => ({ id: `files-${st}`, label: st, value: s.byStatus[st] ?? 0, origin: "static" })), { id: "files", label: L.fFiles, value: s.files.length, origin: "static" }];
  return { cards, metrics, holes, origin: "static" };
}

let current: ChangeSummary | null = null;
/** The host sets the summary the command just computed; the provider serves it to every `change-summary` binding. */
export function setCurrentChangeSummary(s: ChangeSummary | null): void { current = s; }
export function currentChangeSummary(): ChangeSummary | null { return current; }

/** Self-registered provider (out/gen/bindings.ts). */
export const changeSummaryProvider: BindingProvider = {
  source: CHANGE_SUMMARY_SOURCE,
  provide(ctx) {
    return changeSummaryBinding(current, ctx.params?.part, { location: ctx.location, labels: ctx.params?.labels, legend: ctx.params?.legend });
  }
};
export default changeSummaryProvider;

// ---------- per-file diff (read-only revisions, never a checkout) ----------

export type ChangeDiffOpen =
  | { kind: "diff"; left: RevRequest; right: RevRequest | string; title: string }
  | { kind: "revision"; rev: RevRequest; title: string }
  | { kind: "file"; fsPath: string; title: string };

/** What opens for a file row: left = base revision, right = head revision or the working file (local). */
export function changeDiffOpen(s: Pick<ChangeSummary, "target" | "range">, row: ChangeFileRow, workingFile: (rel: string) => string): ChangeDiffOpen | undefined {
  if (!s.range) return undefined;
  const { base, head } = s.range;
  const name = row.path.split("/").pop() ?? row.path;
  const title = `${name} (${rangeText(s.range)})`;
  const right: RevRequest | string = head === WORKTREE ? workingFile(row.path) : { repo: s.target.repo, sha: head, path: row.path };
  if (row.status === "added") return typeof right === "string" ? { kind: "file", fsPath: right, title } : { kind: "revision", rev: right, title };
  const left: RevRequest = { repo: s.target.repo, sha: base, path: row.oldPath ?? row.path };
  if (row.status === "removed") return { kind: "revision", rev: left, title };
  return { kind: "diff", left, right, title };
}

/** A webview `{ rowId, action: "open-diff" }` message, validated (untrusted input). */
export function vetChangeMessage(raw: unknown, rows: readonly ChangeFileRow[]): ChangeFileRow | undefined {
  const m = obj(raw);
  if (!m || m.action !== "open-diff" || typeof m.rowId !== "string") return undefined;
  return rows.find(r => r.id === m.rowId);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
