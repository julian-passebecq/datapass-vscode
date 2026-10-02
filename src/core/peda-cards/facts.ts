/**
 * V5 PEDA1b: project facts for card binding from a DataPass Hop bridge explanation (V3-HOP1, written by the client
 * AI, so origin `ai-proposed`). Analyzer facts (NAVSQL1 partitioning, orchestration retries, dbt/MERGE history, the
 * PEDA3 technique tagger) use the same `ProjectFact` shape when their readers land. Nothing is parsed as code or run.
 * Pure (no `vscode`).
 */
import type { UnderstandingDoc } from "../understanding/contract";
import type { ProjectFact } from "./bind";

/** Join type → concept entry carrying the card. */
const JOIN_CONCEPT: Readonly<Record<string, string>> = { anti: "concept.sql.anti-join-nulls" };
/** Words of a step's title or note → concept entry (the bridge text is ai-proposed, so are these facts). */
const KEYWORD_CONCEPT: readonly (readonly [RegExp, string])[] = [
  [/\bbroadcast\b/i, "concept.spark-perf.join-strategy"],
  [/\bctes?\b|common table expression/i, "concept.sql.cte"]
];

export function factsFromUnderstanding(repositoryKey: string, doc: UnderstandingDoc): ProjectFact[] {
  const out: ProjectFact[] = [];
  const at = (lines: [number, number]) => ({ repositoryKey, path: doc.target.path, startLine: lines[0], endLine: lines[1] });
  const steps = new Map(doc.steps.map(s => [s.id, s]));
  for (const j of doc.joins ?? []) {
    const concept = JOIN_CONCEPT[j.type];
    const step = steps.get(j.step);
    if (concept && step) out.push({ signal: `concept:${concept}`, at: at(step.lines), origin: "ai-proposed" });
  }
  for (const s of doc.steps) {
    const text = `${s.title} ${s.note ?? ""}`;
    for (const [re, concept] of KEYWORD_CONCEPT) if (re.test(text)) out.push({ signal: `concept:${concept}`, at: at(s.lines), origin: "ai-proposed" });
  }
  return out;
}
