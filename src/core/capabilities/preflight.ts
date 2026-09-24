import type { CapabilityRecord } from "./registry";
import { TOOL_INDEX, type ToolObservation } from "./tools";

export type PreflightStatus = "ready" | "blocked" | "needs-review" | "needs-config" | "unsupported" | "unknown";

export interface PreflightItem {
  kind: "tool" | "fact" | "review" | "constraint";
  id: string;
  label: string;
  detail: string;
}

export interface PreflightResult {
  capabilityId: string;
  status: PreflightStatus;
  blockers: PreflightItem[];
  unknowns: PreflightItem[];
  pendingReviews: PreflightItem[];
  configIssues: PreflightItem[];
  optionalMissing: PreflightItem[];
  satisfied: PreflightItem[];
  warnings: string[];
  sideEffects: CapabilityRecord["sideEffects"];
  nextStep: string;
  fallback: string;
  evidenceNote: string;
}

export interface PreflightContext {
  tools: ReadonlyMap<string, ToolObservation>;
  facts: ReadonlyMap<string, string | boolean | undefined>;
  reviewsConfirmed: ReadonlySet<string>;
}

const label = (toolId: string) => TOOL_INDEX.get(toolId)?.label ?? toolId;

/**
 * Evaluate readiness for one operation. Optional tools never block. Unknown probes
 * (e.g. a Windows desktop app) are reported as unknown, never as absent.
 */
export function preflight(cap: CapabilityRecord, ctx: PreflightContext): PreflightResult {
  const blockers: PreflightItem[] = [], unknowns: PreflightItem[] = [], pendingReviews: PreflightItem[] = [];
  const configIssues: PreflightItem[] = [], optionalMissing: PreflightItem[] = [], satisfied: PreflightItem[] = [];

  for (const req of cap.requirements) {
    const states = req.anyOf.map(id => ctx.tools.get(id)?.state ?? "unknown");
    const present = req.anyOf.find((_, i) => states[i] === "present");
    const item: PreflightItem = { kind: "tool", id: req.anyOf.join("|"), label: req.anyOf.map(label).join(" or "), detail: req.why };
    if (present) satisfied.push({ ...item, label: label(present) });
    else if (req.need === "optional") optionalMissing.push(item);
    else if (states.some(s => s === "unknown")) unknowns.push(item);
    else blockers.push(item);
  }
  for (const f of cap.facts) {
    const value = ctx.facts.get(f.fact);
    const item: PreflightItem = { kind: "fact", id: f.fact, label: f.fact, detail: f.why };
    if (value === undefined || value === "" || value === false) blockers.push(item);
    else satisfied.push(item);
  }
  for (const c of cap.constraints) {
    if (Object.entries(c.when).every(([k, v]) => ctx.facts.get(k) === v)) {
      configIssues.push({ kind: "constraint", id: Object.keys(c.when).join("+"), label: c.outcome, detail: c.message });
    }
  }
  for (const r of cap.reviews) {
    const item: PreflightItem = { kind: "review", id: r.id, label: r.prompt, detail: "Confirm for this exact target before acting." };
    if (ctx.reviewsConfirmed.has(`${cap.id}:${r.id}`)) satisfied.push(item);
    else pendingReviews.push(item);
  }

  const status: PreflightStatus =
    configIssues.some(i => i.label === "unsupported") ? "unsupported"
    : blockers.length ? "blocked"
    : configIssues.length ? "needs-config"
    : unknowns.length ? "unknown"
    : pendingReviews.length ? "needs-review"
    : "ready";

  const first = blockers[0] ?? configIssues[0] ?? unknowns[0] ?? pendingReviews[0];
  const nextStep = !first
    ? cap.implementation === "implemented" && cap.datapassActionId
      ? `Run "${cap.label}" (${cap.actionMode}).`
      : `Open the native tool: ${cap.label}.`
    : first.kind === "tool" ? `Install or enable ${first.label}. ${first.detail}`
    : first.kind === "fact" ? `Declare ${first.label} in the project manifest. ${first.detail}`
    : first.kind === "constraint" ? first.detail
    : `Review: ${first.label}.`;

  return {
    capabilityId: cap.id, status, blockers, unknowns, pendingReviews, configIssues, optionalMissing, satisfied,
    warnings: [...cap.warnings, ...(cap.doesNotCover?.length ? [`Not covered by this route: ${cap.doesNotCover.join(", ")}.`] : [])],
    sideEffects: cap.sideEffects,
    nextStep,
    fallback: cap.fallback,
    evidenceNote: `Qualification: ${cap.qualification}. ${cap.implementation === "documented-only" ? "DataPass routes you to the native tool; it does not perform this operation." : "DataPass implements the listed action only."} Ready means prerequisites are present, not that the operation will succeed on this target.`
  };
}
