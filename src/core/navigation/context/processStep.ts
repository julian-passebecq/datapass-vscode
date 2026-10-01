import type { NavLocation } from "../navTypes";
import { fillLabel, strongestOrigin, type ContextHole, type NavFact, type SectionResult } from "./facts";

/**
 * NAVCTX2 process step: where the location stands in the lifecycle Understand → Design → Build → Deploy → Observe → Optimize,
 * read only from the facts present. Shown in the Context panel, never in the left tree. Which fact kinds prove a step is data
 * (`DEFAULT_PROCESS_STEP_RULES`, overridable); a step with no proving fact is a typed hole saying what would fill it.
 */
export const PROCESS_STEPS = ["understand", "design", "build", "deploy", "observe", "optimize"] as const;
export type ProcessStep = (typeof PROCESS_STEPS)[number];

export interface ProcessStepRule {
  readonly step: ProcessStep;
  /** A fact proves the step when its kind equals one of these, or starts with one ending in `.` or `:`. */
  readonly factKinds: readonly string[];
  /** Restrict the rule to these artifact kinds; absent or `*` = any. */
  readonly artifactKinds?: readonly string[];
  readonly fill: ContextHole["fill"];
}

export const DEFAULT_PROCESS_STEP_RULES: readonly ProcessStepRule[] = [
  { step: "understand", factKinds: ["source.", "lineage.", "inventory."], fill: "scan" },
  { step: "design", factKinds: ["rationale.", "decision.", "schema.", "model."], fill: "ask-ai" },
  { step: "build", factKinds: ["code.", "test.", "git.commit"], fill: "open-code" },
  { step: "deploy", factKinds: ["deploy.", "pipeline.", "iac.", "fabric-item."], fill: "scan" },
  { step: "observe", factKinds: ["observe.", "run.", "metric."], fill: "run-observe" },
  { step: "optimize", factKinds: ["perf.", "detector:", "finding."], fill: "run-observe" }
];

export interface ProcessStepLabels {
  readonly steps: Readonly<Record<ProcessStep, string>>;
  readonly missing: string;
  readonly none: string;
}

export const DEFAULT_PROCESS_STEP_LABELS: ProcessStepLabels = {
  steps: { understand: "Understand", design: "Design", build: "Build", deploy: "Deploy", observe: "Observe", optimize: "Optimize" },
  missing: "{step}: no fact yet",
  none: "No lifecycle fact for this location yet"
};

export interface ProcessStepCard {
  readonly step: ProcessStep;
  readonly title: string;
  readonly reached: boolean;
  /** The location's current step: the furthest step reached. */
  readonly current: boolean;
  readonly facts: readonly NavFact[];
}

export const factMatches = (kind: string, patterns: readonly string[]): boolean =>
  patterns.some(p => kind === p || ((p.endsWith(".") || p.endsWith(":")) && kind.startsWith(p)));

export function resolveProcessStep(
  location: NavLocation,
  facts: readonly NavFact[],
  rules: readonly ProcessStepRule[] = DEFAULT_PROCESS_STEP_RULES,
  labels: ProcessStepLabels = DEFAULT_PROCESS_STEP_LABELS
): SectionResult<ProcessStepCard> & { readonly current: ProcessStep | null } {
  const applies = (r: ProcessStepRule): boolean => !r.artifactKinds || r.artifactKinds.includes("*") || r.artifactKinds.includes(location.artifactKind);
  const byStep = PROCESS_STEPS.map(step => {
    const stepRules = rules.filter(r => r.step === step && applies(r));
    const proving = facts.filter(f => stepRules.some(r => factMatches(f.kind, r.factKinds)));
    return { step, proving, fill: stepRules.find(r => r.fill)?.fill };
  });
  let currentIndex = -1;
  byStep.forEach((s, i) => { if (s.proving.length > 0) currentIndex = i; });
  const cards: ProcessStepCard[] = byStep.map((s, i) => ({
    step: s.step, title: labels.steps[s.step], reached: s.proving.length > 0, current: i === currentIndex, facts: s.proving
  }));
  const holes: ContextHole[] = currentIndex < 0
    ? [{ reason: labels.none, fill: "scan" }]
    : byStep.filter(s => s.proving.length === 0).map(s => ({ reason: fillLabel(labels.missing, { step: labels.steps[s.step] }), ...(s.fill ? { fill: s.fill } : {}) }));
  return {
    cards, holes,
    current: currentIndex < 0 ? null : PROCESS_STEPS[currentIndex] ?? null,
    origin: strongestOrigin(byStep.flatMap(s => s.proving.map(f => f.origin)))
  };
}
