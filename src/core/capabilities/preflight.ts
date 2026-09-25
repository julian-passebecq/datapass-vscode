import type { CapabilityRecord } from "./registry";
import { TOOL_INDEX, type ToolObservation } from "./tools";
import { FACT_MANIFEST_FIELDS } from "../workspace/facts";
import { sha256Bytes } from "../model/ids";

export type PreflightStatus = "ready" | "blocked" | "needs-review" | "needs-config" | "unsupported" | "unknown";

export interface PreflightItem {
  kind: "tool" | "fact" | "review" | "constraint" | "file" | "repository" | "target";
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
  /** Digest of what this evaluation targets (operation, environment, declared target names, facts, files). */
  targetDigest: string;
  /** Review id → the exact confirmation key for this target; a key for another target never satisfies it. */
  reviewKeys: Record<string, string>;
}

/** What a fact looked like when it was not simply present: declared but not found, or not checkable. */
export interface FactNote {
  state: "missing" | "unknown";
  detail: string;
}

/** A requirement on the component's own sources (V3): a repository clone or an expected file. */
export interface SubjectRequirement {
  kind: "file" | "repository" | "target";
  id: string;
  label: string;
  state: "ok" | "missing" | "unknown";
  detail: string;
}

/**
 * The component operation being evaluated (V3). Without a subject, a capability is evaluated at
 * project level, as in v1/v2 manifests.
 */
export interface OperationSubject {
  /** component:capability@environment */
  key: string;
  environment?: string;
  /** Declared target names (never credentials): function app, bundle target, database… */
  target?: Readonly<Record<string, string>>;
  /** Digest of the component's observed files; a review of other files does not carry over. */
  artifactDigest?: string;
  requirements: SubjectRequirement[];
}

export interface PreflightContext {
  tools: ReadonlyMap<string, ToolObservation>;
  facts: ReadonlyMap<string, string | boolean | undefined>;
  reviewsConfirmed: ReadonlySet<string>;
  /** Why a fact is absent although something was declared, or why it could not be checked. */
  factNotes?: ReadonlyMap<string, FactNote>;
  subject?: OperationSubject;
}

const label = (toolId: string) => TOOL_INDEX.get(toolId)?.label ?? toolId;

/**
 * What a confirmation is bound to. Changing the environment, a declared target name, a fact the
 * operation depends on (workspace, bundle target…) or the component's files yields another digest,
 * so a review done for dev never satisfies prod, and a review of old files never covers new ones.
 */
export function targetDigest(cap: CapabilityRecord, ctx: Pick<PreflightContext, "facts" | "subject">): string {
  const s = ctx.subject;
  const target = s?.target ? Object.fromEntries(Object.entries(s.target).sort(([a], [b]) => a.localeCompare(b))) : null;
  const facts = cap.facts.map(f => [f.fact, ctx.facts.get(f.fact) ?? null]);
  return sha256Bytes(JSON.stringify({ op: s?.key ?? cap.id, environment: s?.environment ?? null, target, facts, files: s?.artifactDigest ?? null })).value.slice(0, 16);
}

export function reviewKey(cap: CapabilityRecord, reviewId: string, ctx: Pick<PreflightContext, "facts" | "subject">): string {
  return `${ctx.subject?.key ?? cap.id}:${reviewId}#${targetDigest(cap, ctx)}`;
}

/**
 * Evaluate readiness for one operation. Optional tools never block. Unknown probes
 * (e.g. a Windows desktop app) are reported as unknown, never as absent. A declared path is an
 * expectation: it satisfies nothing until the file was observed.
 */
export function preflight(cap: CapabilityRecord, ctx: PreflightContext): PreflightResult {
  const blockers: PreflightItem[] = [], unknowns: PreflightItem[] = [], pendingReviews: PreflightItem[] = [];
  const configIssues: PreflightItem[] = [], optionalMissing: PreflightItem[] = [], satisfied: PreflightItem[] = [];

  for (const req of ctx.subject?.requirements ?? []) {
    const item: PreflightItem = { kind: req.kind, id: req.id, label: req.label, detail: req.detail };
    if (req.state === "ok") satisfied.push(item);
    else if (req.state === "unknown") unknowns.push(item);
    else blockers.push(item);
  }
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
    const note = ctx.factNotes?.get(f.fact);
    const item: PreflightItem = { kind: "fact", id: f.fact, label: f.fact, detail: note ? `${f.why} ${note.detail}` : f.why };
    if (value === undefined || value === "" || value === false) (note?.state === "unknown" ? unknowns : blockers).push(item);
    else satisfied.push(item);
  }
  for (const c of cap.constraints) {
    if (Object.entries(c.when).every(([k, v]) => ctx.facts.get(k) === v)) {
      configIssues.push({ kind: "constraint", id: Object.keys(c.when).join("+"), label: c.outcome, detail: c.message });
    }
  }
  const reviewKeys: Record<string, string> = {};
  for (const r of cap.reviews) {
    const key = reviewKey(cap, r.id, ctx);
    reviewKeys[r.id] = key;
    const item: PreflightItem = { kind: "review", id: r.id, label: r.prompt, detail: "Confirm for this exact target before acting." };
    if (ctx.reviewsConfirmed.has(key)) satisfied.push(item);
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
    : first.kind === "fact" ? `Declare ${FACT_MANIFEST_FIELDS[first.id] ?? first.label} in the project manifest. ${first.detail}`
    : first.kind === "file" || first.kind === "repository" || first.kind === "target" ? first.detail
    : first.kind === "constraint" ? first.detail
    : `Review: ${first.label}.`;

  return {
    capabilityId: cap.id, status, blockers, unknowns, pendingReviews, configIssues, optionalMissing, satisfied,
    warnings: [...cap.warnings, ...(cap.doesNotCover?.length ? [`Not covered by this route: ${cap.doesNotCover.join(", ")}.`] : [])],
    sideEffects: cap.sideEffects,
    nextStep,
    fallback: cap.fallback,
    evidenceNote: `Qualification: ${cap.qualification}. ${cap.implementation === "documented-only" ? "DataPass routes you to the native tool; it does not perform this operation." : "DataPass implements the listed action only."} Ready means prerequisites are present, not that the operation will succeed on this target.`,
    targetDigest: targetDigest(cap, ctx),
    reviewKeys
  };
}
