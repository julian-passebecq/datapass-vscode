/**
 * V3-HOP2: what the DataPass Hop view shows for one native file, built from the HOP1 entry (pure,
 * no `vscode`). Four cases: the file is explained (ok, stale, orphan, invalid), it has no
 * explanation yet (the "Explain this file" button prepares a work order), or DataPass cannot
 * explain it here (not a file of the project's repositories, no project).
 */
import { stepsInLineOrder } from "../core/understanding/lines";
import { UNDERSTANDING_DIR, type JoinType, type LinkKind, type Provenance, type StepKind, type UnderstandingLanguage } from "../core/understanding/contract";
import type { UnderstandingEntry, UnderstandingState } from "../core/understanding/load";

export const KIND_LABELS: Record<StepKind, string> = {
  source: "Source", read: "Read", filter: "Filter", transform: "Transform", join: "Join", aggregate: "Aggregate",
  write: "Write", task: "Task", branch: "Branch", config: "Configuration", test: "Test", other: "Step"
};

export const LANGUAGE_LABELS: Record<UnderstandingLanguage, string> = {
  pyspark: "PySpark", python: "Python", sql: "SQL", airflow: "Airflow DAG", adf: "Data Factory pipeline",
  "fabric-pipeline": "Fabric pipeline", dockerfile: "Dockerfile", bicep: "Bicep", opentofu: "OpenTofu", other: "File"
};

export const PROVENANCE_LABELS: Record<Provenance, { label: string; about: string }> = {
  declared: { label: "declared", about: "The code says it." },
  inferred: { label: "inferred", about: "Deduced by the AI from the code." },
  estimated: { label: "estimated", about: "A guess (a size, a count…)." },
  illustrative: { label: "illustrative", about: "A drawing aid only." }
};

export const JOIN_LABELS: Record<JoinType, string> = {
  inner: "INNER", left: "LEFT", right: "RIGHT", full: "FULL", cross: "CROSS", semi: "SEMI", anti: "ANTI"
};

export interface HopJoinView { id: string; left: string; right: string; type: JoinType; typeLabel: string; keys: Array<[string, string]>; note?: string; provenance: Provenance }
export interface HopLinkRef { id: string; title: string; kind: LinkKind }
export interface HopStepView {
  id: string;
  title: string;
  kind: StepKind;
  kindLabel: string;
  milestone?: string;
  lines: [number, number];
  /** The step's lines are (partly) beyond the file as it is now. */
  beyond: boolean;
  inputs: string[];
  outputs: string[];
  columns: Array<{ name: string; from?: string; note?: string }>;
  note?: string;
  provenance: Provenance;
  /** Link from the step drawn just above (the connector); undefined: no declared link. */
  fromPrevious?: LinkKind;
  /** Other steps feeding this one (not the one just above). */
  from: HopLinkRef[];
  joins: HopJoinView[];
}

export type HopKind = "explained" | "missing" | "unavailable";

export interface HopState {
  kind: HopKind;
  fileName: string;
  /** Repository and path, as the person reads it. */
  where: string;
  title?: string;
  summary?: string;
  language?: UnderstandingLanguage;
  languageLabel?: string;
  state?: UnderstandingState;
  banner?: { level: "info" | "warning" | "error"; title: string; text: string };
  problems: string[];
  steps: HopStepView[];
  /** The explanation's place in the bridge (missing: where the AI writes it). */
  explanationPath?: string;
  /** Why "Explain this file" cannot run here (shown instead of running). */
  explainDisabled?: string;
  /** A diagram exists to go back to. */
  canGoBack: boolean;
}

export interface HopInput {
  fileName: string;
  /** Where the native file sits in the project; undefined: outside every repository of the project. */
  located?: { repositoryKey: string; nativePath: string; repositoryLabel?: string };
  entry?: UnderstandingEntry;
  hasProject: boolean;
  workOrdersEnabled: boolean;
  /** Lines of the native file as the editor holds it now (unsaved edits included). */
  lineCount?: number;
  canGoBack: boolean;
}

export const explanationPathOf = (repositoryKey: string, nativePath: string): string => `${UNDERSTANDING_DIR}/${repositoryKey}/${nativePath}.json`;

const MAX_PROBLEMS = 12;

export function hopState(i: HopInput): HopState {
  const where = i.located ? `${i.located.repositoryLabel ?? i.located.repositoryKey} / ${i.located.nativePath}` : i.fileName;
  const base = { fileName: i.fileName, where, problems: [] as string[], steps: [] as HopStepView[], canGoBack: i.canGoBack };
  if (!i.hasProject) return { ...base, kind: "unavailable", banner: { level: "info", title: "No DataPass project", text: "Open a client project (DataPass: Open Client Project) to see the visual explanation of its files." } };
  if (!i.located) return { ...base, kind: "unavailable", banner: { level: "info", title: "Not a file of this project", text: "DataPass explains files of the repositories the project manifest declares. This file is outside them." } };
  const explanationPath = explanationPathOf(i.located.repositoryKey, i.located.nativePath);
  const e = i.entry;
  if (!e) {
    return {
      ...base, kind: "missing", explanationPath,
      explainDisabled: i.workOrdersEnabled ? undefined : "Work orders are off on this computer (setting datapass.ai.workOrders.enabled). You can still ask your AI to write the file named below.",
      banner: { level: "info", title: "No explanation yet", text: `The client AI writes it with the code, at ${explanationPath} in the bridge (docs/PREPARING_A_PROJECT.md, section 17). DataPass never writes it itself.` }
    };
  }
  const errors = e.diagnostics.filter(d => d.severity === "error").map(d => d.message);
  const warnings = e.diagnostics.filter(d => d.severity === "warning" && d.code !== "stale").map(d => d.message);
  const problems = [...errors, ...warnings].slice(0, MAX_PROBLEMS);
  const doc = e.doc;
  const head = doc ? { title: doc.title, summary: doc.summary, language: doc.target.language, languageLabel: LANGUAGE_LABELS[doc.target.language] } : {};
  if (e.state === "invalid" || !doc) {
    return { ...base, ...head, kind: "explained", state: "invalid", explanationPath, problems, banner: { level: "error", title: "Explanation refused", text: "The explanation file has errors, so DataPass does not draw it. Ask the AI to fix it (the reasons are below)." } };
  }
  const banner: HopState["banner"] = e.state === "stale"
    ? { level: "warning", title: "Stale: the code changed", text: "The code changed since this explanation was written; steps may point at the wrong lines until the AI updates it." }
    : e.state === "orphan"
      ? { level: "info", title: "Orphan: the code is not here", text: problems[0] ?? "The native file is missing on this computer; the explanation is shown without its code." }
      : undefined;

  const titles = new Map(doc.steps.map(s => [s.id, s.title]));
  const milestones = new Map((doc.milestoneLabels ?? []).map(m => [m.step, m.label]));
  const ordered = stepsInLineOrder(doc);
  const lineCount = i.lineCount ?? e.lines;
  const steps = ordered.map((s, index): HopStepView => {
    const previous = index > 0 ? ordered[index - 1]!.id : undefined;
    const incoming = (doc.links ?? []).filter(l => l.to === s.id && l.from !== s.id);
    const fromPrevious = incoming.find(l => l.from === previous)?.kind;
    const seen = new Set<string>();
    const from = incoming.filter(l => l.from !== previous && titles.has(l.from) && !seen.has(l.from) && seen.add(l.from)).map(l => ({ id: l.from, title: titles.get(l.from)!, kind: l.kind }));
    return {
      id: s.id, title: s.title, kind: s.kind, kindLabel: KIND_LABELS[s.kind], milestone: milestones.get(s.id),
      lines: [s.lines[0], s.lines[1]], beyond: lineCount !== undefined && s.lines[1] > lineCount,
      inputs: s.inputs ?? [], outputs: s.outputs ?? [],
      columns: (s.columns ?? []).map(c => ({ name: c.name, from: c.from?.join(", "), note: c.note })),
      note: s.note, provenance: s.provenance, fromPrevious, from,
      joins: (doc.joins ?? []).filter(j => j.step === s.id).map(j => ({ id: j.id, left: j.left, right: j.right, type: j.type, typeLabel: JOIN_LABELS[j.type], keys: j.keys.map(k => [k[0], k[1]] as [string, string]), note: j.note, provenance: j.provenance }))
    };
  });
  return { ...base, ...head, kind: "explained", state: e.state, explanationPath, problems: warnings.slice(0, MAX_PROBLEMS), banner, steps };
}

/** The Home tile's list: explained files, by repository then path. */
export function explainedFiles(files: ReadonlyArray<{ repositoryKey: string; nativePath: string }>, limit = 8): { items: Array<{ index: number; label: string; detail: string }>; more: number } {
  const all = files.map((f, index) => ({ index, label: f.nativePath.split("/").pop() ?? f.nativePath, detail: `${f.repositoryKey} / ${f.nativePath}`, key: `${f.repositoryKey}/${f.nativePath}` }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { items: all.slice(0, limit).map(({ index, label, detail }) => ({ index, label, detail })), more: Math.max(0, all.length - limit) };
}

/** The language a file most likely has, from its name only (a suggestion for the AI; it decides). */
export function suggestedLanguage(nativePath: string): UnderstandingLanguage {
  const name = nativePath.split("/").pop()!.toLowerCase();
  if (name.endsWith(".sql")) return "sql";
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile";
  if (name.endsWith(".bicep")) return "bicep";
  if (name.endsWith(".tf") || name.endsWith(".tofu")) return "opentofu";
  if (name.endsWith(".py")) return "python";
  return "other";
}

/**
 * The work order that asks the client AI to write a file's explanation (never written by DataPass).
 * `native` describes the file as it is now, so the AI writes the matching hash and line ranges.
 */
export function explanationOrderDraft(at: { repositoryKey: string; nativePath: string }, native?: { sha256: string; lines: number }): { title: string; goal: string; doneWhen: string[] } {
  const target = explanationPathOf(at.repositoryKey, at.nativePath);
  const name = at.nativePath.split("/").pop() ?? at.nativePath;
  const language = suggestedLanguage(at.nativePath);
  return {
    title: `Explain ${name} for DataPass Hop`.slice(0, 80),
    goal: [
      `Write the DataPass Hop explanation of ${at.repositoryKey}/${at.nativePath}: the JSON file ${target} in the bridge repository, format "datapass.understanding" version 1 (docs/PREPARING_A_PROJECT.md, section 17; schema schemas/datapass-understanding.schema.json).`,
      "",
      `- target: repository "${at.repositoryKey}", path "${at.nativePath}", language "${language}"${language === "python" ? " (use \"pyspark\" or \"airflow\" when the file is a Spark job or an Airflow DAG)" : ""}${native ? `, sha256 "${native.sha256}" (the file as it is now, ${native.lines} lines, line endings normalised to LF)` : ", sha256 of the file with line endings normalised to LF"}.`,
      "- steps: the file's milestones, top to bottom, each tied to its 1-based inclusive line range, with inputs, outputs and the columns that matter.",
      "- links between the steps (data, control or dependency); for SQL, and for joins in PySpark, the joins with their tables, type and key pairs.",
      "- provenance on every step and join: declared (the code says it), inferred, estimated or illustrative.",
      "- Do not change the native file. Never write a credential or a connection string in the explanation."
    ].join("\n"),
    doneWhen: [
      `${target} validates against schemas/datapass-understanding.schema.json`,
      "DataPass Hop shows the explanation as ok (not stale) beside the code"
    ]
  };
}
