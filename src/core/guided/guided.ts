/**
 * V5 TOUR2: guided mode over NAVTOUR1 tours (TL-11, TL-12c, go/TOUR-PEDA-contract.md). Pure part:
 * settings shape, the mode filter (Learning / Interview on one mechanism), 1–9 keys and wheel
 * stepping, the screen recorder behind "Save current path as tour", and "Add this screen to tour".
 * A screen = Location + view id (built-in or NAVCAT1 saved view): the base primitive of every step.
 * User tours are written to `.datapass/tours.json` (origin `user`, ids `user.<slug>`).
 */
import { sameLocation, type NavLocation } from "../navigation/navTypes";
import { flattenSteps, toursForMode } from "../navigation/tours/store";
import { TOUR_LIMITS, TOUR_SCHEMA_ID, type Tour, type TourDocument, type TourMode, type TourStep } from "../navigation/tours/tourTypes";

export const GUIDED_MODES = ["all", "learning", "interview"] as const;
export type GuidedMode = (typeof GUIDED_MODES)[number];

/** `datapass.guided.*` as read once per render (go/TOUR-PEDA-contract.md § 6). */
export interface GuidedSettings {
  readonly modes: Readonly<Record<TourMode, boolean>>;
  readonly panels: { readonly explanationBox: boolean; readonly cards: boolean; readonly miniMapHighlight: boolean };
  readonly disabledTours: readonly string[];
}
export const DEFAULT_GUIDED_SETTINGS: GuidedSettings = {
  modes: { learning: true, interview: true, general: true },
  panels: { explanationBox: true, cards: true, miniMapHighlight: true },
  disabledTours: []
};

/** Read the settings from a getter (`config.get`), keeping defaults for anything malformed. */
export function readGuidedSettings(get: (key: string) => unknown): GuidedSettings {
  const bool = (k: string, d: boolean) => (typeof get(k) === "boolean" ? (get(k) as boolean) : d);
  const D = DEFAULT_GUIDED_SETTINGS;
  const disabled = get("disabledTours");
  return {
    modes: { learning: bool("modes.learning.enabled", D.modes.learning), interview: bool("modes.interview.enabled", D.modes.interview), general: bool("modes.general.enabled", D.modes.general) },
    panels: { explanationBox: bool("panels.explanationBox", D.panels.explanationBox), cards: bool("panels.cards", D.panels.cards), miniMapHighlight: bool("panels.miniMapHighlight", D.panels.miniMapHighlight) },
    disabledTours: Array.isArray(disabled) ? disabled.filter((x): x is string => typeof x === "string") : []
  };
}

/** Modes a person can switch to: "all" always, Learning / Interview when enabled. */
export function availableModes(s: GuidedSettings): GuidedMode[] {
  return GUIDED_MODES.filter((m) => m === "all" || s.modes[m]);
}

/** Tours shown in a mode: mode filter (learning|interview + general), per-mode enable, disabled tours. */
export function visibleTours(tours: readonly Tour[], mode: GuidedMode, s: GuidedSettings): Tour[] {
  const effective: GuidedMode = mode !== "all" && !s.modes[mode] ? "all" : mode;
  return toursForMode(tours, effective, (m) => s.modes[m]).filter((t) => !s.disabledTours.includes(t.id));
}

/** Keys 1–9: the n-th top-level step (its index in the flattened list); anything else: null. */
export function keyToStepIndex(tour: Tour, key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const n = Number(key) - 1;
  const at = flattenSteps(tour.steps).findIndex((f) => f.path.length === 1 && f.path[0] === n);
  return at >= 0 ? at : null;
}

/** Wheel / scroll: one step per notch past the threshold; 0 = stay. */
export function wheelDelta(deltaY: number, threshold = 40): -1 | 0 | 1 {
  return deltaY >= threshold ? 1 : deltaY <= -threshold ? -1 : 0;
}

/** A screen: where the person stands and which view they look at. */
export interface Screen { readonly location: NavLocation; readonly viewId: string }
const sameScreen = (a: Screen, b: Screen) => a.viewId === b.viewId && sameLocation(a.location, b.location);

/** Screen recorder: appends a screen unless it repeats the last one; keeps the latest `limit`. */
export function recordScreen(path: readonly Screen[], s: Screen, limit: number = TOUR_LIMITS.steps): Screen[] {
  const last = path[path.length - 1];
  if (last && sameScreen(last, s)) return [...path];
  return [...path, s].slice(-limit);
}

/** `user.<slug>` not yet taken. */
export function userTourId(title: string, taken: ReadonlySet<string>): string {
  const base = `user.${title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "tour"}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function stepId(tour: Tour): string {
  const taken = new Set(flattenSteps(tour.steps).map((f) => f.step.id));
  let n = taken.size + 1;
  while (taken.has(`s${n}`)) n++;
  return `s${n}`;
}
const textKey = (tourId: string, sId: string) => `${tourId}.${sId}`.slice(0, 128).replace(/[^a-z0-9.-]/g, "-");
function screenStep(tourId: string, sId: string, s: Screen, text: string | undefined, texts: Record<string, string>): TourStep {
  const key = textKey(tourId, sId);
  if (text && text.trim()) texts[key] = text.trim().slice(0, TOUR_LIMITS.textLength);
  return { id: sId, location: s.location, viewId: s.viewId, explanationRef: `text:${key}`, origin: "user" };
}

/** "Save current path as tour": a new user tour from recorded screens (texts default to the box labels). */
export function saveScreensAsTour(doc: TourDocument, title: string, screens: readonly Screen[], textOf: (s: Screen) => string | undefined,
  mode?: TourMode): { document: TourDocument; tourId: string } {
  const id = userTourId(title, new Set(doc.tours.map((t) => t.id)));
  const texts: Record<string, string> = { ...(doc.texts ?? {}) };
  texts[`${id}.title`.slice(0, 128)] = title.trim().slice(0, TOUR_LIMITS.textLength) || id;
  const steps = screens.slice(0, TOUR_LIMITS.steps).map((s, i) => screenStep(id, `s${i + 1}`, s, textOf(s), texts));
  const tour: Tour = { id, titleRef: `text:${`${id}.title`.slice(0, 128)}`, ...(mode ? { mode } : {}), steps };
  return { document: { schema: TOUR_SCHEMA_ID, tours: [...doc.tours, tour], texts }, tourId: id };
}

/** "Add this screen to tour": append to a user tour (refused for a tour not in the file). */
export function addScreenToTour(doc: TourDocument, tourId: string, screen: Screen, text: string | undefined): TourDocument | null {
  const tour = doc.tours.find((t) => t.id === tourId);
  if (!tour || tour.steps.length >= TOUR_LIMITS.steps) return null;
  const texts: Record<string, string> = { ...(doc.texts ?? {}) };
  const step = screenStep(tourId, stepId(tour), screen, text, texts);
  return { ...doc, tours: doc.tours.map((t) => (t.id === tourId ? { ...t, steps: [...t.steps, step] } : t)), texts };
}
