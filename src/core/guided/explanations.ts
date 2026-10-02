/**
 * V5 TOUR2: explanation refs of guided tours (go/TOUR-PEDA-contract.md § 3). A ref is `<scheme>:<key>`;
 * each scheme has one renderer. TOUR2 owns `text:` (the tour document's `texts`) and `guide:` (the label
 * pack, setting `datapass.guided.labels`); later packages add theirs with `registerExplanationScheme`
 * from their own surface file (PEDA1b `concept:`/`decision:`, PEDA3 `showcase:`, PEDA2 `project:`).
 * An unknown scheme or key is a typed hole ("explanation not found"), never invented text. Pure.
 */
import type { NavLocation } from "../navigation/navTypes";
import type { Tour, TourStep } from "../navigation/tours/tourTypes";

export interface ExplanationContext {
  readonly texts?: Readonly<Record<string, string>>;
  readonly guide: Readonly<Record<string, string>>;
  readonly tour?: Tour;
  readonly step?: TourStep;
  readonly location?: NavLocation;
}
/** A renderer returns the text, or undefined when it has none for this key (a hole). */
export type ExplanationRender = (key: string, ctx: ExplanationContext) => string | undefined;
export type Explanation = { readonly text: string } | { readonly hole: "unknown-scheme" | "unknown-key" | "malformed-ref" };

const REF = /^([a-z][a-z0-9-]*):(\S{1,240})$/;
const BUILTIN: ReadonlyMap<string, ExplanationRender> = new Map<string, ExplanationRender>([
  ["text", (key, ctx) => ctx.texts?.[key]],
  ["guide", (key, ctx) => ctx.guide[key]]
]);
const schemes = new Map<string, ExplanationRender>(BUILTIN);

/** Add a scheme (built-in ones cannot be replaced). Returns its disposer. */
export function registerExplanationScheme(scheme: string, render: ExplanationRender): { dispose(): void } {
  if (!/^[a-z][a-z0-9-]*$/.test(scheme) || BUILTIN.has(scheme)) throw new Error(`explanation scheme "${scheme}" cannot be registered`);
  schemes.set(scheme, render);
  return { dispose: () => { if (schemes.get(scheme) === render) schemes.delete(scheme); } };
}

export function resolveExplanation(ref: string, ctx: ExplanationContext): Explanation {
  const m = REF.exec(ref);
  if (!m) return { hole: "malformed-ref" };
  const render = schemes.get(m[1]!);
  if (!render) return { hole: "unknown-scheme" };
  let text: string | undefined;
  try { text = render(m[2]!, ctx); } catch { text = undefined; }
  return typeof text === "string" && text.length ? { text } : { hole: "unknown-key" };
}

export const explanationText = (e: Explanation): string | undefined => ("text" in e ? e.text : undefined);
