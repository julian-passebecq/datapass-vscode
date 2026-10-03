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

/** Texts of the "Why & alternatives" tab body (data; `datapass.architectReview.labels` may carry them later). */
export interface WhyTextLabels {
  readonly origin: string; readonly confidence: string; readonly problem: string; readonly why: string;
  readonly alternatives: string; readonly tradeoffs: string; readonly openQuestions: string; readonly noLocation: string;
}
export const DEFAULT_WHY_TEXT_LABELS: WhyTextLabels = {
  origin: "Origin", confidence: "Confidence", problem: "Problem", why: "Why", alternatives: "Alternatives",
  tradeoffs: "Trade-offs", openQuestions: "Open questions", noLocation: "No location yet: navigate the project to see why it is built this way."
};

/** Plain text of the cards; every card states its origin and confidence (e.g. "ai-proposed", "unverified"). */
export function whyText(cards: readonly WhyCard[], t: WhyTextLabels = DEFAULT_WHY_TEXT_LABELS): string {
  return cards.map(c => [
    c.choice.summary,
    `${t.origin}: ${c.origin} · ${t.confidence}: ${c.confidence}`,
    c.problemSolved ? `${t.problem}: ${c.problemSolved}` : "",
    c.drivers.length ? `${t.why}:\n${c.drivers.map(d => `- ${d.constraint}${d.driver ? `: ${d.driver}` : ""}`).join("\n")}` : "",
    c.alternatives.length ? `${t.alternatives}:\n${c.alternatives.map(a => `- ${a.label}${a.costRisk ? ` (${a.costRisk})` : ""}${a.whyNotHere ? `: ${a.whyNotHere}` : ""}`).join("\n")}` : "",
    c.tradeoffs.length ? `${t.tradeoffs}:\n${c.tradeoffs.map(x => `- ${x}`).join("\n")}` : "",
    c.openQuestions.length ? `${t.openQuestions}:\n${c.openQuestions.map(q => `- ${q}`).join("\n")}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");
}

/**
 * The Context "why" tab provider (shape of `ContextSectionProvider`, kept structural to avoid an import cycle with
 * context/index): reads rationales from `source` (e.g. imported architect reviews) and resolves them with `resolveWhy`.
 */
export function whyProvider(
  source: () => readonly RationaleInput[] | Promise<readonly RationaleInput[]>,
  labels: WhyLabels = DEFAULT_WHY_LABELS,
  text: WhyTextLabels = DEFAULT_WHY_TEXT_LABELS
): { readonly tab: "why"; provide(input: { readonly location: NavLocation | null }): Promise<{ body: string; origin: string; holes: readonly { reason: string }[] }> } {
  return {
    tab: "why",
    async provide({ location }) {
      if (!location) return { body: "", origin: "none", holes: [{ reason: text.noLocation }] };
      const r = resolveWhy(location, await source(), {}, labels);
      return { body: whyText(r.cards, text), origin: r.cards.length ? r.origin : "none", holes: r.holes.map(h => ({ reason: h.reason })) };
    }
  };
}
