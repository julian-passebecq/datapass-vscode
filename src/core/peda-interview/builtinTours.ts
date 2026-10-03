/**
 * V5 PEDA2 (go/TOUR-PEDA-contract.md § 4): the three built-in tours, in memory, origin `datapass-guidance`, never
 * written (TOUR2's "Save a copy" writes a user tour):
 *  - `datapass.whole-picture` (general): the 5 spine steps, ref `project:whole-picture.<id>`, section `whole-picture`.
 *  - `datapass.learning` (learning): the same 5 steps; substeps = concept cards (`concept:`, `concept-cards`) then
 *    decision cards (`decision:`, `decision-cards`) of that step's families. No prompts.
 *  - `datapass.interview` (interview, the ONLY interview tour): `explain-project` (substeps objectives / volumetry /
 *    platforms), the 5 spine steps with the ranked notions as substeps, then `queries-worth-showing` (substeps = top N
 *    `showcase:here`). "Ask yourself" prompts are drawn by the card renderer in interview mode, not steps.
 * A card substep sits on its bound project span's node (first resolved view), else on its parent step's Location.
 * Deterministic for the same inputs. Pure (no `vscode`).
 */
import type { NavLocation } from "../navigation/navTypes";
import type { CodeSpan } from "../peda-cards/bind";
import type { CardEntry } from "../peda-cards/cardTypes";
import type { RankedNotion } from "./rank";
import { spineStepOf, type SpineStop } from "./spine";
import { TOUR_SCHEMA, type Tour, type TourDocument, type TourStep } from "./tourShape";

export const BUILTIN_TOUR_IDS = { wholePicture: "datapass.whole-picture", learning: "datapass.learning", interview: "datapass.interview" } as const;

export interface BuiltinTourInputs {
  readonly root: NavLocation;
  readonly spine: readonly SpineStop[];
  /** Every card entry of the catalog (learning tour). */
  readonly entries: readonly CardEntry[];
  /** Best project span of a concept / decision entry for the learning tour (null = none). */
  readonly spanOf: (ref: string) => CodeSpan | null;
  /** PEDA2 ranked notions (interview tour). */
  readonly notions: readonly RankedNotion[];
  /** Locations of the top "queries worth showing" (PEDA3), best first. */
  readonly queries: readonly NavLocation[];
  /** Ladder node of a code span (null = not on the ladder). */
  readonly locate: (span: CodeSpan) => NavLocation | null;
  /** First resolved view at a Location (contract § 2); the host passes `resolveViews(...)[0]`. */
  readonly viewAt: (location: NavLocation) => string;
}

const G = "datapass-guidance" as const;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function step(i: BuiltinTourInputs, id: string, location: NavLocation, explanationRef: string, section: string, substeps?: TourStep[]): TourStep {
  return { id, location, viewId: i.viewAt(location), explanationRef, origin: G, section, ...(substeps?.length ? { substeps } : {}) };
}

function cardStep(i: BuiltinTourInputs, ref: string, span: CodeSpan | null, parent: NavLocation, section: string): TourStep {
  const at = (span && i.locate(span)) ?? parent;
  return step(i, slug(ref), at, ref, section);
}

export function wholePictureTour(i: BuiltinTourInputs): Tour {
  return { id: BUILTIN_TOUR_IDS.wholePicture, titleRef: `guide:tour.${BUILTIN_TOUR_IDS.wholePicture}`, mode: "general",
    steps: i.spine.map(s => step(i, s.step, s.location, `project:whole-picture.${s.step}`, "whole-picture")) };
}

const famOrder = (e: CardEntry, kind: "concept" | "decision") => {
  const c = kind === "concept" ? e.card : e.decisionCard;
  return c ? `${c.family}\u0000${String(c.order).padStart(6, "0")}\u0000${e.id}` : e.id;
};

export function learningTour(i: BuiltinTourInputs): Tour {
  return { id: BUILTIN_TOUR_IDS.learning, titleRef: `guide:tour.${BUILTIN_TOUR_IDS.learning}`, mode: "learning",
    steps: i.spine.map(s => {
      const concepts = i.entries.filter(e => e.card && spineStepOf(e, "concept") === s.step).sort((a, b) => famOrder(a, "concept").localeCompare(famOrder(b, "concept")));
      const decisions = i.entries.filter(e => e.decisionCard && spineStepOf(e, "decision") === s.step).sort((a, b) => famOrder(a, "decision").localeCompare(famOrder(b, "decision")));
      const subs = [
        ...concepts.map(e => cardStep(i, `concept:${e.id}`, i.spanOf(`concept:${e.id}`), s.location, "concept-cards")),
        ...decisions.map(e => cardStep(i, `decision:${e.id}`, i.spanOf(`decision:${e.id}`), s.location, "decision-cards"))
      ];
      return step(i, s.step, s.location, `project:whole-picture.${s.step}`, "whole-picture", subs);
    }) };
}

export function interviewTour(i: BuiltinTourInputs): Tour {
  const explain = step(i, "explain-project", i.root, "project:explain", "explain-project",
    (["objectives", "volumetry", "platforms"] as const).map(t => step(i, t, i.root, `project:${t}`, t)));
  const spine = i.spine.map(s => step(i, s.step, s.location, `project:whole-picture.${s.step}`, "whole-picture",
    i.notions.filter(n => n.step === s.step).map(n => cardStep(i, n.ref, n.spans[0] ?? null, s.location, n.kind === "concept" ? "concept-cards" : "decision-cards"))));
  const queries = step(i, "queries-worth-showing", i.root, "project:queries-worth-showing", "query-showcase",
    i.queries.map((l, k) => step(i, `query-${k + 1}`, l, "showcase:here", "query-showcase")));
  return { id: BUILTIN_TOUR_IDS.interview, titleRef: `guide:tour.${BUILTIN_TOUR_IDS.interview}`, mode: "interview", steps: [explain, ...spine, queries] };
}

/** The three built-ins as one document (in memory; never written to `.datapass/tours.json`). */
export function builtinTours(i: BuiltinTourInputs, enabled: { readonly learning?: boolean; readonly interview?: boolean } = {}): TourDocument {
  return { schema: TOUR_SCHEMA, tours: [wholePictureTour(i), ...(enabled.learning === false ? [] : [learningTour(i)]), ...(enabled.interview === false ? [] : [interviewTour(i)])] };
}
