/**
 * V4-NAV NAVTOUR1: built-in tours generated from facts only. Two journeys:
 * - `lineage`: along the data flow (a file lands → staging → processed → curated → report), from each
 *   data source (no incoming data edge) down its downstream chain;
 * - `execution`: along the execution units (schedule → job/pipeline → notebook → table), from each
 *   control root (no incoming control edge) down what it invokes/orchestrates, then the tables those
 *   units produce.
 * Facts are the project map's typed relations (§ 34 graph); no facts = no tour, nothing is guessed.
 * Journey ids are stable keys; their display names are settings (`datapass.tours.journeyLabels`).
 * Step text is the component's own description/headline (data, never a hard-coded phrase). Pure.
 */
import type { ComponentView, ProjectMap, RelationView } from "../../project/projectMap";
import type { NavLocation } from "../navTypes";
import { componentLocation } from "../projectLadder";
import { TOUR_MAX_STEPS, TOUR_STEP_TEXT_MAX, type Tour, type TourStep } from "./tours";

export const GENERATED_JOURNEYS = ["lineage", "execution"] as const;
export type GeneratedJourney = (typeof GENERATED_JOURNEYS)[number];

/** How a component id becomes a Location (the host's ladder may know a finer artifact kind). */
export type Locate = (componentId: string) => NavLocation;

export function generateTours(map: ProjectMap, locate: Locate = componentLocation): Tour[] {
  const byId = new Map(map.components.map((c) => [c.id, c]));
  const known = (r: RelationView) => byId.has(r.from) && byId.has(r.to) && r.from !== r.to;
  const data = map.relations.filter((r) => r.flow === "data" && known(r));
  const control = map.relations.filter((r) => r.flow === "control" && known(r));
  return [
    ...journeyTours("lineage", data, [], byId, locate),
    ...journeyTours("execution", control, data, byId, locate)
  ];
}

/** One tour per root of `edges`; `tail` edges extend the walk from the last reached units (execution → produced tables). */
function journeyTours(journey: GeneratedJourney, edges: readonly RelationView[], tail: readonly RelationView[],
  byId: ReadonlyMap<string, ComponentView>, locate: Locate): Tour[] {
  if (!edges.length) return [];
  const out = adjacency(edges);
  const outTail = adjacency(tail);
  const hasIn = new Set(edges.map((r) => r.to));
  const nodes = [...new Set(edges.flatMap((r) => [r.from, r.to]))];
  // Roots first; a pure cycle has none, so its first node (map order) starts it.
  const roots = nodes.filter((n) => !hasIn.has(n));
  const covered = new Set<string>();
  const tours: Tour[] = [];
  for (const root of [...roots, ...nodes]) {
    if (covered.has(root)) continue;
    const path = walk(root, out);
    const units = new Set(path);
    for (const n of [...path]) for (const t of outTail.get(n) ?? []) if (!units.has(t)) { units.add(t); path.push(t); }
    for (const n of path) covered.add(n);
    const steps = path.slice(0, TOUR_MAX_STEPS).map((id) => step(byId.get(id)!, locate));
    if (steps.length < 2) continue;
    const first = byId.get(path[0]!)!.label, last = byId.get(path[steps.length - 1]!)!.label;
    tours.push({ id: `gen.${journey}.${safeId(root)}`, title: `${first} → ${last}`, journey, origin: "generated", steps });
  }
  return tours;
}

function adjacency(edges: readonly RelationView[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of edges) {
    const list = m.get(r.from) ?? [];
    if (!list.includes(r.to)) list.push(r.to);
    m.set(r.from, list);
  }
  return m;
}

/** Depth-first preorder from `root` (cycle-safe): the numbered order of the steps. */
function walk(root: string, out: ReadonlyMap<string, readonly string[]>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    order.push(n);
    stack.push(...[...(out.get(n) ?? [])].reverse());
  }
  return order;
}

function step(c: ComponentView, locate: Locate): TourStep {
  const text = (c.description ?? c.headline ?? "").trim();
  return { location: locate(c.id), text: text.length > TOUR_STEP_TEXT_MAX ? `${text.slice(0, TOUR_STEP_TEXT_MAX - 1)}…` : text };
}

const safeId = (id: string): string => id.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 100);
