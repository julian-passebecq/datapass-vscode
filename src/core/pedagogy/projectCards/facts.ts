/**
 * V5 PEDA1b: project facts for card binding from a DataPass Hop bridge explanation (V3-HOP1, written by the client
 * AI, so origin `ai-proposed`). Analyzer facts (NAVSQL1 partitioning, orchestration retries, dbt/MERGE history) use
 * the same `ProjectFact` shape when their readers land. Nothing is parsed as code or run. Pure (no `vscode`).
 */
import type { UnderstandingDoc } from "../../understanding/contract";
import type { ProjectFact } from "./bind";

const JOIN_CARD: Readonly<Record<string, string>> = { anti: "card.sql-technique.anti-join" };
const KEYWORD_CARD: readonly (readonly [RegExp, string])[] = [
  [/\bwindow\b|row_number|\bover\s*\(/i, "card.spark-sql.window-functions"],
  [/\bmerge\b|upsert/i, "card.sql-technique.merge"],
  [/\bctes?\b|common table expression/i, "card.sql-technique.cte"]
];

export function factsFromUnderstanding(repositoryKey: string, doc: UnderstandingDoc): ProjectFact[] {
  const out: ProjectFact[] = [];
  const at = (lines: [number, number]) => ({ repositoryKey, path: doc.target.path, startLine: lines[0], endLine: lines[1] });
  const steps = new Map(doc.steps.map(s => [s.id, s]));
  for (const j of doc.joins ?? []) {
    const card = JOIN_CARD[j.type];
    const step = steps.get(j.step);
    if (card && step) out.push({ signal: `technique:${card}`, at: at(step.lines), origin: "ai-proposed" });
  }
  for (const s of doc.steps) {
    const text = `${s.title} ${s.note ?? ""}`;
    for (const [re, card] of KEYWORD_CARD) if (re.test(text)) out.push({ signal: `technique:${card}`, at: at(s.lines), origin: "ai-proposed" });
  }
  return out;
}
