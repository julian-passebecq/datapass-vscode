import type { NavLocation } from "../navTypes";
import { fillLabel, strongestOrigin, type ContextHole, type SectionResult, type ValueOrigin } from "./facts";

/**
 * NAVCTX2 "why / alternatives": the `decision-rationale/1` entries (Common packages/decision-rationale, RATIO1) whose subjects
 * cover the location, strongest origin first (owner, confirmed AI, proposed AI, Git inference). Nothing is written here:
 * no rationale = a typed hole that offers "ask the AI" (NAVAIX1).
 *
 * `RationaleInput` is the subset of `DecisionRationale` this section reads, kept structural until NAVSVC1 vendors the package.
 */
export const RATIONALE_ORIGIN_RANK: Readonly<Record<string, number>> = { "owner-stated": 0, "ai-confirmed": 1, "ai-proposed": 2, "static-inferred": 3 };

export interface RationaleInput {
  readonly id: string;
  readonly decisionPoint: string | null;
  readonly subjects: readonly { readonly kind: string; readonly id: string }[];
  readonly choice: { readonly option: string | null; readonly summary: string };
  readonly problemSolved: string;
  readonly why: readonly { readonly constraint: string; readonly driver: string }[];
  readonly alternatives: readonly { readonly option: string | null; readonly label: string; readonly whenBetter: string; readonly costRisk: string; readonly whyNotHere: string }[];
  readonly tradeoffs: readonly string[];
  readonly confidence: string;
  readonly origin: "static-inferred" | "ai-proposed" | "ai-confirmed" | "owner-stated";
  readonly openQuestions?: readonly string[];
}

export interface WhyCard {
  readonly rationaleId: string;
  readonly decisionPoint: string | null;
  readonly choice: RationaleInput["choice"];
  readonly problemSolved: string;
  readonly drivers: RationaleInput["why"];
  readonly alternatives: RationaleInput["alternatives"];
  readonly tradeoffs: readonly string[];
  readonly confidence: string;
  readonly origin: ValueOrigin;
  readonly openQuestions: readonly string[];
}

export interface WhyLabels { readonly none: string }
export const DEFAULT_WHY_LABELS: WhyLabels = { none: "No rationale yet for {node}: ask the AI" };

export interface WhyScope {
  /** Repository paths of the location (its file, notebook…); a `path` subject covers a path equal to it or under it. */
  readonly paths?: readonly string[];
}

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

export function coversLocation(r: RationaleInput, location: NavLocation, scope: WhyScope = {}): boolean {
  const paths = (scope.paths ?? []).map(norm);
  return r.subjects.some(s => s.kind === "path"
    ? paths.some(p => { const sp = norm(s.id); return p === sp || p.startsWith(`${sp}/`); })
    : s.id === location.nodeId);
}

export function resolveWhy(
  location: NavLocation,
  rationales: readonly RationaleInput[],
  scope: WhyScope = {},
  labels: WhyLabels = DEFAULT_WHY_LABELS
): SectionResult<WhyCard> {
  const cards: WhyCard[] = rationales
    .filter(r => coversLocation(r, location, scope))
    .sort((a, b) => (RATIONALE_ORIGIN_RANK[a.origin] ?? 9) - (RATIONALE_ORIGIN_RANK[b.origin] ?? 9) || a.id.localeCompare(b.id))
    .map(r => ({
      rationaleId: r.id, decisionPoint: r.decisionPoint, choice: r.choice, problemSolved: r.problemSolved, drivers: r.why,
      alternatives: r.alternatives, tradeoffs: r.tradeoffs, confidence: r.confidence, origin: r.origin, openQuestions: r.openQuestions ?? []
    }));
  const holes: ContextHole[] = cards.length === 0 ? [{ reason: fillLabel(labels.none, { node: location.nodeId }), fill: "ask-ai" }] : [];
  return { cards, holes, origin: strongestOrigin(cards.map(c => c.origin)) };
}
