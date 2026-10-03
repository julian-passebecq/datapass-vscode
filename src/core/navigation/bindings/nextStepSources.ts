/**
 * NAVTODO1 extension point: extra Next-steps sources beyond the built-in facts of `nextSteps.ts`. A source reads
 * its own optional field of the facts and returns items; `collectNextSteps` dedupes, scopes and sorts them like
 * every other row. Adding a source = its facts field below + one line in NEXT_STEP_SOURCES. Pure (no `vscode`).
 */
import type { NavLocation } from "../navTypes";
import type { NavOrigin } from "./origin";
import type { NextStepKind, NextStepSeverity, NextStepsLocator } from "./nextSteps";
import { AI_GAP_STEPS, type AiGapStepFacts } from "./aiGapSteps";
import { STALE_EVIDENCE_STEPS, type StaleEvidenceStepFacts } from "./staleEvidenceSteps";

export interface NextStepItem {
  /** null = project root. */
  readonly location: NavLocation | null;
  readonly kind: NextStepKind;
  readonly text: string;
  readonly severity: NextStepSeverity;
  readonly origin: NavOrigin;
  readonly viewId?: string;
}

/** One optional field per registered source (absent = the source adds nothing). */
export interface NextStepSourceFacts {
  /** XGAP1: gaps flagged by AI-exchange answers. */
  readonly aiGaps?: AiGapStepFacts;
  /** TODOSTALE1: pinned verdicts (EVPIN1) and their files now. */
  readonly staleEvidence?: StaleEvidenceStepFacts;
}

export interface NextStepSource {
  readonly id: string;
  collect(facts: NextStepSourceFacts, locator: NextStepsLocator): readonly NextStepItem[];
}

export const NEXT_STEP_SOURCES: readonly NextStepSource[] = [
  AI_GAP_STEPS,
  STALE_EVIDENCE_STEPS,
];
