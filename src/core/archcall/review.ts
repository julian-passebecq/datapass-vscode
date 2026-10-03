/**
 * ARCHCALL1 (TL-7 architect-on-call): the product side of `architect-review/1`. Pure (no `vscode`).
 *
 *   trigger (large change · repeated failure · before done) ─► suggestion (never automatic)
 *     ─► request document in the AI exchange (the person pastes it into their own AI)
 *     ─► answer pasted back ─► checked against the request ─► Context "Why & alternatives" as ai-proposed
 *
 * The wire shapes, the request id and the answer check come from the vendored Common `exchange-protocol`
 * `architect-review/1` (frozen by V5FREEZE2). This file adds readable reasons in front of the contract checks.
 * No hidden AI call: nothing here sends anything. Titles and question texts come from settings.
 */
import {
  ARCHITECT_REVIEW_ANSWER_SCHEMA_ID,
  ARCHITECT_REVIEW_PROTOCOL,
  ARCHITECT_REVIEW_REQUEST_SCHEMA_ID,
  ARCHITECT_REVIEW_TRIGGERS,
  buildArchitectReviewRequest,
  checkArchitectReviewAnswer,
  createArchitectReviewRequestId,
  type ArchitectReviewAnswer,
  type ArchitectReviewEvidenceRef,
  type ArchitectReviewLocation,
  type ArchitectReviewRequest,
  type ArchitectReviewTrigger,
  type ArchitectReviewTriggerDetail
} from "@juliandatapass-group/exchange-protocol";
import type { ValidationIssue } from "@juliandatapass-group/semantic-core";
import type { RationaleInput } from "../navigation/context/why";

export { ARCHITECT_REVIEW_PROTOCOL, type ArchitectReviewAnswer, type ArchitectReviewRequest };
export const REQUEST_SCHEMA = ARCHITECT_REVIEW_REQUEST_SCHEMA_ID;
export const ANSWER_SCHEMA = ARCHITECT_REVIEW_ANSWER_SCHEMA_ID;
export const TRIGGERS = ARCHITECT_REVIEW_TRIGGERS;
export type TriggerKind = ArchitectReviewTrigger;
export type EvidenceKind = ArchitectReviewEvidenceRef["kind"];
export type TriggerDetail = ArchitectReviewTriggerDetail;
export type EvidenceRef = ArchitectReviewEvidenceRef;
export type RequestLocation = ArchitectReviewLocation;

const issuesText = (issues: readonly ValidationIssue[]): string => issues.map(i => `${i.code}${i.pointer ? ` at ${i.pointer}` : ""}`).join("; ");

/** Settings `datapass.architectReview.*` (thresholds, toggle, labels). Defaults below; labels are data. */
export interface ArchitectReviewSettings {
  readonly suggestions: boolean;
  readonly largeChangeComponents: number;
  readonly repeatedFailures: number;
  /** Extensions of the file names an answer may cite; a cited file not found in the project flags the answer "unverified". */
  readonly citedFileExtensions: readonly string[];
  readonly labels: ArchitectReviewLabels;
}
export interface ArchitectReviewLabels {
  readonly triggers: Readonly<Record<TriggerKind, string>>;
  /** Question sent per trigger; `{subjects}`, `{count}`, `{threshold}`, `{check}`, `{milestone}`, `{change}` are filled. */
  readonly questions: Readonly<Record<TriggerKind, string>>;
  readonly suggestion: Readonly<Record<TriggerKind, string>>;
  readonly answerRules: string;
  readonly problemSolved: string;
  /** Confidence shown on a review whose answer cites files that are not in the project. */
  readonly unverified: string;
  /** Open question added to that review; `{files}` is filled. */
  readonly unverifiedFiles: string;
}
export const DEFAULT_LABELS: ArchitectReviewLabels = {
  triggers: { "large-change": "Large change", "repeated-failure": "Repeated failure", "before-done": "Before marking done" },
  questions: {
    "large-change": "This change ({change}) touches {count} components ({subjects}). Review the architecture: coupling, ownership, data contracts and what could break downstream.",
    "repeated-failure": "The check {check} failed {count} times in a row. Review the design behind it, not only the last error: what is structurally wrong, and what should change?",
    "before-done": "Readiness milestone {milestone} is about to be marked done. Review the architecture of {subjects}: gaps, risks and what to verify first."
  },
  suggestion: {
    "large-change": "This change touches {count} components (more than {threshold}). Ask an architect review through the AI exchange?",
    "repeated-failure": "{check} failed {count} times in a row. Ask an architect review through the AI exchange?",
    "before-done": "Before marking {milestone} done: ask an architect review through the AI exchange?"
  },
  answerRules: "Answer with ONE JSON object of schema \"datapass.architect-review-answer/1\" (protocol \"architect-review/1\", the same requestId, origin \"ai-proposed\"). Findings may name only the subject nodeIds and cite only the evidence refIds listed in the request. Give a recommendation and its alternatives with their trade-offs.",
  problemSolved: "Architect review ({trigger})",
  unverified: "unverified",
  unverifiedFiles: "Unverified: the answer cites {files}, not found in the project. Check before relying on it."
};
export const DEFAULT_CITED_FILE_EXTENSIONS: readonly string[] = [
  "sql", "py", "ipynb", "scala", "r", "java", "kt", "ts", "js", "json", "yml", "yaml", "toml", "cfg", "ini", "xml",
  "md", "txt", "csv", "sh", "ps1", "tmdl", "bim", "pbip", "pbir", "dax", "m", "pq", "dbt"
];
export const DEFAULT_SETTINGS: ArchitectReviewSettings = { suggestions: true, largeChangeComponents: 5, repeatedFailures: 2, citedFileExtensions: DEFAULT_CITED_FILE_EXTENSIONS, labels: DEFAULT_LABELS };

export const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

// ------------------------------------------------------------------ suggestions (never automatic)

export interface Suggestion { readonly trigger: TriggerDetail; readonly subjects: readonly RequestLocation[]; readonly evidence: readonly EvidenceRef[]; readonly message: string }

/** An MR (or local) diff whose files fall in more than `largeChangeComponents` components. */
export function suggestForChange(
  change: { ref: string; baseSha: string; headSha: string; componentIds: readonly string[] },
  locate: (componentId: string) => RequestLocation,
  settings: ArchitectReviewSettings = DEFAULT_SETTINGS
): Suggestion | undefined {
  const ids = [...new Set(change.componentIds)].sort();
  if (!settings.suggestions || ids.length <= settings.largeChangeComponents) return undefined;
  const trigger: TriggerDetail = { kind: "large-change", changeRef: change.ref, baseSha: change.baseSha, headSha: change.headSha, componentCount: ids.length, threshold: settings.largeChangeComponents };
  return {
    trigger, subjects: ids.map(locate), evidence: [{ refId: "diff", kind: "mr-diff", ref: change.ref, digest: null }],
    message: fill(settings.labels.suggestion["large-change"], { count: ids.length, threshold: settings.largeChangeComponents })
  };
}

/** The same check failing `repeatedFailures` times in a row (runs newest last). */
export function suggestForCheckRuns(
  checkId: string,
  runs: readonly { ref: string; failed: boolean }[],
  subject: RequestLocation,
  settings: ArchitectReviewSettings = DEFAULT_SETTINGS
): Suggestion | undefined {
  let streak = 0;
  for (let i = runs.length - 1; i >= 0 && runs[i]!.failed; i -= 1) streak += 1;
  const threshold = Math.max(2, settings.repeatedFailures);
  if (!settings.suggestions || streak < threshold) return undefined;
  const failing = runs.slice(runs.length - streak);
  return {
    trigger: { kind: "repeated-failure", checkId, consecutiveFailures: streak, threshold },
    subjects: [subject], evidence: failing.map((r, i) => ({ refId: `run-${i + 1}`, kind: "check-run" as const, ref: r.ref, digest: null })),
    message: fill(settings.labels.suggestion["repeated-failure"], { check: checkId, count: streak })
  };
}

/** Before a readiness milestone is marked done. `title` (default the id) is what the message shows. */
export function suggestBeforeDone(milestoneId: string, subjects: readonly RequestLocation[], settings: ArchitectReviewSettings = DEFAULT_SETTINGS, title: string = milestoneId): Suggestion | undefined {
  if (!settings.suggestions || !subjects.length) return undefined;
  return {
    trigger: { kind: "before-done", milestoneId }, subjects: [...subjects],
    evidence: [{ refId: "milestone", kind: "readiness-milestone", ref: milestoneId, digest: null }],
    message: fill(settings.labels.suggestion["before-done"], { milestone: title })
  };
}

/**
 * A readiness checklist item just written (Work view checklist or a component's project checklist): offer the
 * before-done review only when it moves to "done" from another state. The item stays reversible; nothing is blocked.
 */
export function suggestForChecklistDone(
  change: { key: string; state: string; previous?: string; title?: string },
  subjects: readonly RequestLocation[],
  settings: ArchitectReviewSettings = DEFAULT_SETTINGS
): Suggestion | undefined {
  if (change.state !== "done" || change.previous === "done") return undefined;
  return suggestBeforeDone(change.key, subjects, settings, change.title ?? change.key);
}

/** The component of a component checklist key (`component:<id>/<item>`), else undefined (a scope item). */
export function checklistComponent(key: string): string | undefined {
  const m = /^component:(.+)\/[^/]+$/.exec(key);
  return m ? m[1] : undefined;
}

// ------------------------------------------------------------------ the request

/** Common `createArchitectReviewRequestId`: same trigger, subjects, evidence and question = same id. */
export function requestId(r: Pick<ArchitectReviewRequest, "trigger" | "subjects" | "evidence" | "question">): string {
  return createArchitectReviewRequestId({ trigger: r.trigger, subjects: r.subjects, evidence: r.evidence, question: r.question });
}

export function questionFor(trigger: TriggerDetail, subjects: readonly RequestLocation[], labels: ArchitectReviewLabels = DEFAULT_LABELS, nameOf: (nodeId: string) => string = n => n): string {
  const names = subjects.map(s => nameOf(s.nodeId)).join(", ");
  const values: Record<string, string | number> = { subjects: names };
  if (trigger.kind === "large-change") Object.assign(values, { change: trigger.changeRef, count: trigger.componentCount, threshold: trigger.threshold });
  else if (trigger.kind === "repeated-failure") Object.assign(values, { check: trigger.checkId, count: trigger.consecutiveFailures, threshold: trigger.threshold });
  else values.milestone = trigger.milestoneId;
  return fill(labels.questions[trigger.kind], values);
}

/** Readable reasons first, then Common `buildArchitectReviewRequest` (the contract has the last word). */
export function buildRequest(s: Pick<Suggestion, "trigger" | "subjects" | "evidence">, question: string): ArchitectReviewRequest {
  const t = s.trigger;
  if (!s.subjects.length) throw new Error("an architect review needs at least one subject");
  if (new Set(s.subjects.map(x => x.nodeId)).size !== s.subjects.length) throw new Error("duplicate subject");
  if (new Set(s.evidence.map(e => e.refId)).size !== s.evidence.length) throw new Error("duplicate evidence ref");
  if (t.kind === "large-change" && (t.threshold < 1 || t.componentCount <= t.threshold)) throw new Error("the change is not large enough for this trigger");
  if (t.kind === "repeated-failure" && (t.threshold < 2 || t.consecutiveFailures < t.threshold)) throw new Error("the check did not fail often enough for this trigger");
  const needed: EvidenceKind = t.kind === "large-change" ? "mr-diff" : t.kind === "repeated-failure" ? "check-run" : "readiness-milestone";
  if (!s.evidence.some(e => e.kind === needed)) throw new Error(`the ${t.kind} trigger needs a ${needed} evidence ref`);
  if (!question.trim()) throw new Error("empty question");
  const body = { trigger: t, subjects: s.subjects.map(x => ({ level: x.level, nodeId: x.nodeId, artifactKind: x.artifactKind })), evidence: s.evidence.map(e => ({ ...e })), question };
  const built = buildArchitectReviewRequest(body);
  if (!built.ok) throw new Error(`invalid architect review request: ${issuesText(built.issues)}`);
  return built.value;
}

/** The text the person pastes into their own AI. */
export function renderForAi(request: ArchitectReviewRequest, labels: ArchitectReviewLabels = DEFAULT_LABELS): string {
  return [
    `# ${labels.triggers[request.trigger.kind]}: architect review (DataPass, ${ARCHITECT_REVIEW_PROTOCOL})`, "",
    request.question, "", labels.answerRules, "", "```json", JSON.stringify(request, null, 2), "```", ""
  ].join("\n");
}

// ------------------------------------------------------------------ the answer

/** The JSON object of an answer pasted whole or with prose around it (first fenced block, else the outer braces). */
export function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const text = fenced ? fenced[1]! : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try { return JSON.parse(text); } catch { throw new Error("no JSON object found in the answer"); }
}

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const strArr = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= 200 && v.every(x => str(x, max));

/** Readable reasons first, then Common `checkArchitectReviewAnswer`. Throws; the result is ai-proposed only. */
export function checkAnswer(request: ArchitectReviewRequest, input: unknown): ArchitectReviewAnswer {
  const a = input as Partial<ArchitectReviewAnswer> | null;
  if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error("the answer is not a JSON object");
  const allowed = ["schema", "protocol", "requestId", "origin", "findings", "recommendation", "model", "responder"];
  const extra = Object.keys(a).filter(k => !allowed.includes(k));
  if (extra.length) throw new Error(`unknown field(s): ${extra.join(", ")}`);
  if (a.schema !== ANSWER_SCHEMA || a.protocol !== ARCHITECT_REVIEW_PROTOCOL) throw new Error(`not a ${ANSWER_SCHEMA} answer`);
  if (a.origin !== "ai-proposed") throw new Error("an architect review answer is always ai-proposed");
  if (a.requestId !== request.requestId) throw new Error("this answer is for another request");
  if (!str(a.model, 256) || !a.model || !str(a.responder, 256) || !a.responder) throw new Error("model and responder are required");
  const rec = a.recommendation;
  if (!rec || !str(rec.summary, 16384) || !rec.summary.trim() || !Array.isArray(rec.alternatives) || rec.alternatives.length > 10
    || !rec.alternatives.every(x => x && str(x.title, 1024) && x.title.trim() && str(x.tradeoff, 16384))) throw new Error("invalid recommendation");
  if (!Array.isArray(a.findings) || a.findings.length > 50) throw new Error("invalid findings");
  const subjects = new Set(request.subjects.map(s => s.nodeId));
  const evidence = new Set(request.evidence.map(e => e.refId));
  for (const f of a.findings) {
    if (!f || !["info", "warning", "risk"].includes(f.severity) || !str(f.summary, 1024) || !f.summary.trim() || !str(f.detail, 16384)
      || !strArr(f.subjectNodeIds, 1024) || !strArr(f.evidenceRefIds, 64)) throw new Error("invalid finding");
    if (f.subjectNodeIds.some((n: string) => !subjects.has(n))) throw new Error("a finding names a subject that was not sent");
    if (f.evidenceRefIds.some((e: string) => !evidence.has(e))) throw new Error("a finding cites evidence that was not sent");
  }
  const accepted = checkArchitectReviewAnswer(request, a);
  if (!accepted.ok) throw new Error(`invalid architect review answer: ${issuesText(accepted.issues)}`);
  return accepted.value.answer;
}

/** Files an answer cites that were not found in the project, per finding index (-1 = the recommendation). */
export interface UnverifiedCitation { readonly finding: number; readonly files: readonly string[] }
export interface StoredReview {
  readonly request: ArchitectReviewRequest; readonly answer: ArchitectReviewAnswer | null; readonly at: string; readonly importedAt?: string;
  /** Set at import: the answer is untrusted, so a cited file that does not exist flags the review "unverified". */
  readonly unverified?: readonly UnverifiedCitation[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * File names cited in a text: a token with one of `extensions` (case-insensitive), optionally with folders, a drive
 * or a leading slash, and an optional `:line` suffix (dropped). Separators become "/". `sales.orders` is not a file.
 */
export function citedFiles(text: string, extensions: readonly string[] = DEFAULT_CITED_FILE_EXTENSIONS): string[] {
  if (!extensions.length) return [];
  const ext = extensions.map(escapeRe).join("|");
  const re = new RegExp(String.raw`(?:^|[\s` + "`" + String.raw`"'(\[<])((?:[A-Za-z]:)?[\\/]?(?:[\w.-]+[\\/])*[\w-][\w.-]*\.(?:${ext}))(?=$|[\s` + "`" + String.raw`"'),\]>:;!?]|\.(?:\s|$))`, "gi");
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(m[1]!.replace(/\\/g, "/"));
  return [...out];
}

/** A cited path that cannot be in the project whatever exists: absolute, or climbing out with "..". */
export const outsideProject = (p: string): boolean => /^([A-Za-z]:)?\//.test(p) || p.split("/").includes("..");

/**
 * The hole check of ARCHCALL1: every file an answer's findings or recommendation cite must exist in the project
 * (`exists` is the host's lookup). Returns the missing ones; empty = verified.
 */
export async function verifyCitations(
  answer: ArchitectReviewAnswer,
  exists: (relativePath: string) => Promise<boolean>,
  extensions: readonly string[] = DEFAULT_CITED_FILE_EXTENSIONS
): Promise<UnverifiedCitation[]> {
  const texts: [number, string][] = [
    ...answer.findings.map((f, i): [number, string] => [i, `${f.summary}\n${f.detail}`]),
    [-1, [answer.recommendation.summary, ...answer.recommendation.alternatives.flatMap(a => [a.title, a.tradeoff])].join("\n")]
  ];
  const known = new Map<string, boolean>();
  const out: UnverifiedCitation[] = [];
  for (const [finding, text] of texts) {
    const missing: string[] = [];
    for (const f of citedFiles(text, extensions)) {
      if (!known.has(f)) known.set(f, !outsideProject(f) && await exists(f.replace(/^\.\//, "")));
      if (!known.get(f)) missing.push(f);
    }
    if (missing.length) out.push({ finding, files: missing });
  }
  return out;
}

export const unverifiedFiles = (r: Pick<StoredReview, "unverified">): string[] => [...new Set((r.unverified ?? []).flatMap(u => u.files))];

/**
 * Imported answers as `decision-rationale`-shaped inputs for the Context "Why & alternatives" section (NAVCTX2
 * `resolveWhy`): one card per review, on the request's subjects, origin `ai-proposed`, never confirmed here.
 */
export function reviewRationales(reviews: readonly StoredReview[], labels: ArchitectReviewLabels = DEFAULT_LABELS): RationaleInput[] {
  return reviews.filter((r): r is StoredReview & { answer: ArchitectReviewAnswer } => !!r.answer).map(r => ({ r, request: r.request, answer: r.answer })).map(({ r, request, answer }) => ({
    id: `${request.requestId}:answer`,
    decisionPoint: null,
    subjects: request.subjects.map(s => ({ kind: "node", id: s.nodeId })),
    choice: { option: null, summary: answer.recommendation.summary },
    problemSolved: fill(labels.problemSolved, { trigger: labels.triggers[request.trigger.kind] }),
    why: answer.findings.map(f => ({ constraint: f.summary, driver: f.detail })),
    alternatives: answer.recommendation.alternatives.map(x => ({ option: null, label: x.title, whenBetter: "", costRisk: x.tradeoff, whyNotHere: "" })),
    tradeoffs: [],
    confidence: unverifiedFiles(r).length ? labels.unverified : "unrated",
    origin: "ai-proposed" as const,
    openQuestions: unverifiedFiles(r).length ? [fill(labels.unverifiedFiles, { files: unverifiedFiles(r).join(", ") })] : []
  }));
}
