/**
 * XGAP1 Next-steps source: each gap an AI-exchange answer flagged ("I could not determine X") becomes one
 * "AI flagged: …" row at the Location the gap names (project root when DataPass cannot place it). Origin is
 * always `ai-proposed`; the row stays until a later answer no longer flags it — never auto-resolved. Labels are
 * data (AI_GAP_LABELS, overridable through the facts). Pure (no `vscode`).
 */
import type { NavLocation } from "../navTypes";
import type { AiGapFact, ExchangeGapReason } from "../../exchange/exchangeGaps";
import type { NextStepItem, NextStepSource } from "./nextStepSources";

export const AI_GAP_SOURCE_ID = "ai-gaps";

export interface AiGapLabels {
  readonly prefix: string;
  readonly reasons: Readonly<Record<ExchangeGapReason, string>>;
}

/** Default labels (data; a setting may replace any of them). */
export const AI_GAP_LABELS: AiGapLabels = {
  prefix: "AI flagged:",
  reasons: { "missing-source": "source not available", ambiguous: "ambiguous", "out-of-scope": "outside what was sent" },
};

export interface AiGapStepFacts {
  readonly gaps: readonly AiGapFact[];
  /** Maps a gap location (repo path, `path#L…`, id) to the Location that holds it; null = project root. */
  locate?(location: string): NavLocation | null;
  readonly labels?: Partial<Omit<AiGapLabels, "reasons">> & { readonly reasons?: Partial<AiGapLabels["reasons"]> };
}

/** The rows for a set of gaps. */
export function aiGapItems(facts: AiGapStepFacts): NextStepItem[] {
  const prefix = facts.labels?.prefix ?? AI_GAP_LABELS.prefix;
  return facts.gaps.map(g => {
    const location = facts.locate?.(g.location) ?? null;
    const reason = facts.labels?.reasons?.[g.reason] ?? AI_GAP_LABELS.reasons[g.reason];
    // An unplaced gap keeps its location in the text so it is still findable from the project root.
    const where = location ? "" : ` · ${g.location}`;
    return { location, kind: "ai-gap", text: `${prefix} ${g.question} (${reason})${where}`, severity: "info", origin: "ai-proposed" } as const;
  });
}

export const AI_GAP_STEPS: NextStepSource = {
  id: AI_GAP_SOURCE_ID,
  collect: facts => (facts.aiGaps ? aiGapItems(facts.aiGaps) : []),
};
