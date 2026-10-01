/**
 * V4-NAV NAVTOUR1: journey tours (`datapass.tours/1`, schemas/datapass-tours.schema.json). A tour is
 * a numbered path of Locations on the NAV ladder, each step with an optional view and a short text.
 * Built-in tours are generated from facts (generate.ts); user and AI-proposed tours live in
 * `.datapass/tours.json` (AI-proposed ones arrive through the AI exchange and stay marked). A step
 * whose node no longer exists is a stale hole: shown, never guessed. Pure (no `vscode`).
 */
import { validateNavLocation, type NavLadder, type NavLocation } from "../navTypes";

export const TOURS_FORMAT = "datapass.tours";
export const TOURS_VERSION = 1;
export const TOUR_ORIGINS = ["generated", "ai-proposed", "user"] as const;
export type TourOrigin = (typeof TOUR_ORIGINS)[number];
export const TOUR_STEP_TEXT_MAX = 280;
export const TOUR_MAX_STEPS = 200;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface TourStep { readonly location: NavLocation; readonly viewId?: string; readonly text: string }
export interface Tour {
  readonly id: string; readonly title: string; readonly journey: string;
  readonly origin: TourOrigin; readonly steps: readonly TourStep[];
}
export interface ToursDoc { readonly format: typeof TOURS_FORMAT; readonly version: typeof TOURS_VERSION; readonly tours: readonly Tour[] }
export interface ToursParse { readonly tours: Tour[]; readonly problems: string[] }

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Validate one step; null = rejected (with a problem). */
function parseStep(raw: unknown, where: string, problems: string[]): TourStep | null {
  if (!raw || typeof raw !== "object") { problems.push(`${where}: not an object`); return null; }
  const s = raw as Record<string, unknown>;
  const loc = validateNavLocation(s.location);
  if (!loc.ok) { problems.push(`${where}.location: invalid`); return null; }
  if (s.viewId !== undefined && !str(s.viewId, 128)) { problems.push(`${where}.viewId: invalid`); return null; }
  const text = typeof s.text === "string" ? s.text : "";
  if (text.length > TOUR_STEP_TEXT_MAX) { problems.push(`${where}.text: longer than ${TOUR_STEP_TEXT_MAX}`); return null; }
  return { location: loc.value, ...(s.viewId !== undefined ? { viewId: s.viewId as string } : {}), text };
}

/** Validate one tour; `origin` "generated" is reserved for built-in tours and refused in the file. */
export function parseTour(raw: unknown, where: string, problems: string[], fileOnly = true): Tour | null {
  if (!raw || typeof raw !== "object") { problems.push(`${where}: not an object`); return null; }
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || !ID.test(t.id)) { problems.push(`${where}.id: invalid`); return null; }
  if (!str(t.title, 120)) { problems.push(`${where}.title: invalid`); return null; }
  if (!str(t.journey, 64)) { problems.push(`${where}.journey: invalid`); return null; }
  if (!TOUR_ORIGINS.includes(t.origin as TourOrigin) || (fileOnly && t.origin === "generated")) { problems.push(`${where}.origin: invalid`); return null; }
  if (!Array.isArray(t.steps) || !t.steps.length || t.steps.length > TOUR_MAX_STEPS) { problems.push(`${where}.steps: 1..${TOUR_MAX_STEPS} expected`); return null; }
  const steps: TourStep[] = [];
  for (let i = 0; i < t.steps.length; i++) {
    const s = parseStep(t.steps[i], `${where}.steps[${i}]`, problems);
    if (!s) return null;
    steps.push(s);
  }
  return { id: t.id, title: t.title as string, journey: t.journey as string, origin: t.origin as TourOrigin, steps };
}

/** Parse `.datapass/tours.json`; bad tours are dropped with a problem, the rest load. */
export function parseToursDoc(text: string | undefined): ToursParse {
  if (text === undefined) return { tours: [], problems: [] };
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return { tours: [], problems: ["tours.json: not JSON"] }; }
  const d = doc as Record<string, unknown> | null;
  if (!d || d.format !== TOURS_FORMAT || d.version !== TOURS_VERSION || !Array.isArray(d.tours)) {
    return { tours: [], problems: [`tours.json: expected format ${TOURS_FORMAT} version ${TOURS_VERSION}`] };
  }
  const problems: string[] = [];
  const tours: Tour[] = [];
  const seen = new Set<string>();
  d.tours.forEach((raw, i) => {
    const t = parseTour(raw, `tours[${i}]`, problems);
    if (!t) return;
    if (seen.has(t.id)) { problems.push(`tours[${i}].id: duplicate ${t.id}`); return; }
    seen.add(t.id);
    tours.push(t);
  });
  return { tours, problems };
}

/** The file text for user/AI tours (generated tours are never written). */
export function serializeToursDoc(tours: readonly Tour[]): string {
  const doc: ToursDoc = { format: TOURS_FORMAT, version: TOURS_VERSION, tours: tours.filter((t) => t.origin !== "generated") };
  return JSON.stringify({ $schema: "../schemas/datapass-tours.schema.json", ...doc }, null, 2) + "\n";
}

/** Generated tours first, then the file's; a file tour with a generated id keeps both (file id suffixed). */
export function mergeTours(generated: readonly Tour[], file: readonly Tour[]): Tour[] {
  const ids = new Set(generated.map((t) => t.id));
  return [...generated, ...file.map((t) => (ids.has(t.id) ? { ...t, id: `${t.id}~file` } : t))];
}

/** Journeys in first-seen order (the Navigator's journey buttons). */
export function journeys(tours: readonly Tour[]): string[] {
  return [...new Set(tours.map((t) => t.journey))];
}

/** Every Location reachable on the ladder from the root (bounded, cycle-safe). */
export function ladderLocations(ladder: NavLadder, limit = 5000): NavLocation[] {
  const out: NavLocation[] = [];
  const seen = new Set<string>();
  const queue = [ladder.root()];
  while (queue.length && out.length < limit) {
    const l = queue.shift()!;
    const key = `${l.level}\u0000${l.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    queue.push(...ladder.children(l));
  }
  return out;
}

/** Does the step's node still exist on the ladder? (Stale steps are holes.) */
export function stepExists(step: TourStep, known: ReadonlySet<string>): boolean {
  return known.has(`${step.location.level}\u0000${step.location.nodeId}`);
}
export const locationKeys = (ls: readonly NavLocation[]): Set<string> => new Set(ls.map((l) => `${l.level}\u0000${l.nodeId}`));

/** Tour position: which tour, which step (0-based). Pure stepping; clamps at the ends. */
export interface TourCursor { readonly tourId: string; readonly index: number }
export function startTour(tour: Tour): TourCursor { return { tourId: tour.id, index: 0 }; }
export function stepTo(tour: Tour, cursor: TourCursor, index: number): TourCursor {
  return { tourId: tour.id, index: Math.max(0, Math.min(tour.steps.length - 1, index)) };
}
export const nextStep = (tour: Tour, c: TourCursor): TourCursor => stepTo(tour, c, c.index + 1);
export const prevStep = (tour: Tour, c: TourCursor): TourCursor => stepTo(tour, c, c.index - 1);
