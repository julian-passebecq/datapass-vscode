/**
 * V4-NAV NAVTOUR1: tours in the standalone (`datapass.tour/1`, go/TOUR-PEDA-contract.md). Built-in tours
 * (generated from facts, origin `datapass-guidance`) live in memory; user and AI-proposed tours live in
 * `.datapass/tours.json` (versioned). Loading is lenient (`checkTours`, holes never thrown); a step
 * whose node or view no longer exists stays in place and is shown as a hole, never guessed.
 * Numbering, stepping over sub-steps, text refs (`text:` / `guide:`), mode filter. Pure (no `vscode`).
 */
import type { NavLadder, NavLocation } from "../navTypes";
import {
  checkTours, TOUR_SCHEMA_ID, type Tour, type TourDocument, type TourHole, type TourMode, type TourStep
} from "./tourTypes";

export const TOURS_FILE = [".datapass", "tours.json"] as const;
/** Preview clamp of an explanation in the step list (the box shows the full text). */
export const STEP_PREVIEW_MAX = 280;

export interface LoadedTours { readonly document: TourDocument; readonly holes: readonly TourHole[] }

/** Parse `.datapass/tours.json` (absent = empty). Structure only: Location/view existence is checked live (`stepStatus`). */
export function loadTourFile(text: string | undefined): LoadedTours {
  if (text === undefined) return { document: { schema: TOUR_SCHEMA_ID, tours: [] }, holes: [] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { document: { schema: TOUR_SCHEMA_ID, tours: [] }, holes: [{ kind: "malformed-document", pointer: "" }] }; }
  return checkTours(raw);
}

/** The file text: never the built-in tours (they are regenerated). */
export function serializeTourFile(doc: TourDocument, builtinIds: ReadonlySet<string>): string {
  const tours = doc.tours.filter((t) => !builtinIds.has(t.id));
  const out: TourDocument = { schema: TOUR_SCHEMA_ID, tours, ...(doc.texts && Object.keys(doc.texts).length ? { texts: doc.texts } : {}) };
  return JSON.stringify(out, null, 2) + "\n";
}

/** Built-ins first; a file tour reusing a built-in id is dropped with a `duplicate-tour` hole. */
export function mergeTours(builtin: readonly Tour[], file: LoadedTours): LoadedTours {
  const ids = new Set(builtin.map((t) => t.id));
  const holes = [...file.holes];
  const kept = file.document.tours.filter((t, i) => {
    if (!ids.has(t.id)) return true;
    holes.push({ kind: "duplicate-tour", pointer: `/tours/${i}`, tourId: t.id });
    return false;
  });
  return { document: { ...file.document, tours: [...builtin, ...kept] }, holes };
}

/** TL-12c: Learning shows learning + general, Interview shows interview + general; general shows all. */
export function toursForMode(tours: readonly Tour[], mode: TourMode | "all", enabled: (m: TourMode) => boolean = () => true): Tour[] {
  return tours.filter((t) => {
    const m = t.mode ?? "general";
    if (!enabled(m)) return false;
    return mode === "all" || m === mode || m === "general";
  });
}

/** Journeys in first-seen order (journey buttons); tours without one are grouped under `""`. */
export function journeys(tours: readonly Tour[]): string[] {
  return [...new Set(tours.map((t) => t.journey ?? ""))];
}

/** The strongest origin of a tour for its badge: ai-proposed > user > datapass-guidance. */
export function tourOrigin(t: Tour): TourStep["origin"] {
  const all = flattenSteps(t.steps).map((f) => f.step.origin);
  return all.includes("ai-proposed") ? "ai-proposed" : all.includes("user") ? "user" : "datapass-guidance";
}

/** A step in reading order with its number path ([2, 0] → "3.1"). */
export interface FlatStep { readonly step: TourStep; readonly path: readonly number[]; readonly number: string }
export function flattenSteps(steps: readonly TourStep[], parent: readonly number[] = []): FlatStep[] {
  return steps.flatMap((step, i) => {
    const path = [...parent, i];
    return [{ step, path, number: path.map((n) => n + 1).join(".") }, ...flattenSteps(step.substeps ?? [], path)];
  });
}

/** Tour cursor over the flattened steps (sub-steps included). Pure; clamps at both ends. */
export interface TourCursor { readonly tourId: string; readonly index: number }
export const startTour = (t: Tour): TourCursor => ({ tourId: t.id, index: 0 });
export function stepTo(t: Tour, index: number): TourCursor {
  return { tourId: t.id, index: Math.max(0, Math.min(flattenSteps(t.steps).length - 1, index)) };
}
export const nextStep = (t: Tour, c: TourCursor): TourCursor => stepTo(t, c.index + 1);
export const prevStep = (t: Tour, c: TourCursor): TourCursor => stepTo(t, c.index - 1);

/** Every Location reachable on the ladder from the root (bounded, cycle-safe). */
export function ladderLocations(ladder: NavLadder, limit = 5000): NavLocation[] {
  const out: NavLocation[] = [];
  const seen = new Set<string>();
  const queue = [ladder.root()];
  while (queue.length && out.length < limit) {
    const l = queue.shift()!;
    const key = locationKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    queue.push(...ladder.children(l));
  }
  return out;
}
export const locationKey = (l: NavLocation): string => `${l.level}\u0000${l.nodeId}`;

/** Live check of a step against the project: its node, then its view at that node. */
export type StepStatus = "ok" | "unknown-location" | "unknown-view";
export interface StepContext { readonly known: ReadonlySet<string>; readonly viewsAt: (l: NavLocation) => readonly { readonly id: string }[] }
export function stepStatus(s: TourStep, ctx: StepContext): StepStatus {
  if (!ctx.known.has(locationKey(s.location))) return "unknown-location";
  return ctx.viewsAt(s.location).some((v) => v.id === s.viewId) ? "ok" : "unknown-view";
}

/**
 * Resolve a `<scheme>:<key>` ref this package knows: `text:` → document texts, `guide:` → label pack.
 * Other schemes (concept:, project:, …) belong to later packages: `undefined` = typed hole in the UI.
 */
export function resolveRef(ref: string, texts: Readonly<Record<string, string>> | undefined, guide: Readonly<Record<string, string>>): string | undefined {
  const at = ref.indexOf(":");
  const scheme = ref.slice(0, at), key = ref.slice(at + 1);
  if (scheme === "text") return texts?.[key];
  if (scheme === "guide") return guide[key];
  return undefined;
}

export const clampPreview = (s: string): string => (s.length > STEP_PREVIEW_MAX ? `${s.slice(0, STEP_PREVIEW_MAX - 1)}…` : s);
