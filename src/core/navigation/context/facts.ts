/**
 * Inputs and outputs shared by the Context sections (NAVCTX2): the facts DataPass already holds for a location and the
 * binding-provider result shape of go/NAV-contract.md (`{ cards, holes, origin }`). Pure types, no vscode.
 */

/** § 34 origins a value can carry; never a guess. */
export const VALUE_ORIGINS = ["static", "theoretical", "static-inferred", "ai-proposed", "ai-confirmed", "owner-stated", "observed", "datapass-guidance"] as const;
export type ValueOrigin = (typeof VALUE_ORIGINS)[number];

/**
 * One fact already known about a location (from the scan, the evidence chain, runtime observation…).
 * `kind` is an open vocabulary (`source.sql`, `deploy.pipeline`, `observe.run`, `detector:<id>`, `concept:<id>` …).
 */
export interface NavFact {
  readonly kind: string;
  readonly origin: ValueOrigin;
  readonly detail?: string;
  readonly source?: string;
}

/** What would fill a hole: an action the surface can offer (e.g. NAVAIX1 "ask the AI"). */
export type HoleFill = "ask-ai" | "scan" | "open-code" | "run-observe" | "add-catalogue-entry";

export interface ContextHole { readonly reason: string; readonly fill?: HoleFill }

export interface SectionResult<C> {
  readonly cards: readonly C[];
  readonly holes: readonly ContextHole[];
  /** Origin of the section as a whole: the strongest card origin, or `static` when DataPass only found an absence. */
  readonly origin: ValueOrigin;
}

/** Strongest first: what the owner said beats observation, beats AI, beats DataPass's own inference, beats theory. */
export const ORIGIN_STRENGTH: readonly ValueOrigin[] = ["owner-stated", "observed", "ai-confirmed", "static", "static-inferred", "ai-proposed", "datapass-guidance", "theoretical"];

export function strongestOrigin(origins: readonly ValueOrigin[]): ValueOrigin {
  let best: ValueOrigin = "static";
  let rank = Number.POSITIVE_INFINITY;
  for (const o of origins) { const r = ORIGIN_STRENGTH.indexOf(o); if (r >= 0 && r < rank) { rank = r; best = o; } }
  return best;
}

/** Fills `{name}` placeholders of a data-driven label. */
export const fillLabel = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
