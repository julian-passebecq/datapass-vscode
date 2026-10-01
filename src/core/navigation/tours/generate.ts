/**
 * V4-NAV NAVTOUR1: built-in journey tours generated from facts only (go/TOUR-PEDA-contract.md § 4).
 * - `lineage`: along the data flow (a file lands → staging → processed → curated → report), from each
 *   data source (no incoming data edge) down its downstream chain;
 * - `execution`: along the execution units (schedule → job/pipeline → notebook → table), from each
 *   control root down what it invokes/orchestrates, then the tables those units produce.
 * Facts = the project map's typed relations (§ 34 graph); no facts = no tour, nothing is guessed.
 * Tours: id `datapass.journey.<journey>.<n>`, mode general, origin `datapass-guidance`, title and
 * explanations are `guide:` refs (`journey.<journey>`, `journey.<journey>.<stage>`) resolved from the
 * label pack (setting `datapass.guided.labels`). Each step takes the first view its Location offers;
 * a Location offering none is not a step. Pure.
 */
import type { ProjectMap, RelationView } from "../../project/projectMap";
import type { NavLocation } from "../navTypes";
import { componentLocation } from "../projectLadder";
import { TOUR_LIMITS, type Tour, type TourStep } from "./tourTypes";

export const GENERATED_JOURNEYS = ["lineage", "execution"] as const;
export type GeneratedJourney = (typeof GENERATED_JOURNEYS)[number];
/** Stage of a step in its journey (the `guide:journey.<journey>.<stage>` key). */
export const JOURNEY_STAGES = { lineage: ["source", "flow", "end"], execution: ["trigger", "unit", "output"] } as const;

export interface GenerateContext {
  /** How a component id becomes a Location (the host's ladder may know a finer artifact kind). */
  readonly locate?: (componentId: string) => NavLocation;
  /** Views a Location offers (catalog + saved views); the step takes the first. */
  readonly viewsAt: (l: NavLocation) => readonly { readonly id: string }[];
}

export function generateTours(map: ProjectMap, ctx: GenerateContext): Tour[] {
  const ids = new Set(map.components.map((c) => c.id));
  const known = (r: RelationView) => ids.has(r.from) && ids.has(r.to) && r.from !== r.to;
  const data = map.relations.filter((r) => r.flow === "data" && known(r));
  const control = map.relations.filter((r) => r.flow === "control" && known(r));
  return [...journeyTours("lineage", data, [], ctx), ...journeyTours("execution", control, data, ctx)];
}

/** One tour per root of `edges`; `tail` edges extend from the reached units (execution → produced tables). */
function journeyTours(journey: GeneratedJourney, edges: readonly RelationView[], tail: readonly RelationView[], ctx: GenerateContext): Tour[] {
  if (!edges.length) return [];
  const out = adjacency(edges), outTail = adjacency(tail);
  const hasIn = new Set(edges.map((r) => r.to));
  const nodes = [...new Set(edges.flatMap((r) => [r.from, r.to]))];
  const locate = ctx.locate ?? componentLocation;
  const covered = new Set<string>();
  const tours: Tour[] = [];
  // Roots first; a pure cycle has none, so its first node (map order) starts it.
  for (const root of [...nodes.filter((n) => !hasIn.has(n)), ...nodes]) {
    if (covered.has(root)) continue;
    const walked = walk(root, out);
    const seen = new Set(walked);
    const produced: string[] = [];
    for (const n of walked) for (const t of outTail.get(n) ?? []) if (!seen.has(t)) { seen.add(t); produced.push(t); }
    for (const n of seen) covered.add(n);
    const stages = JOURNEY_STAGES[journey];
    const path = [...walked.map((id, i) => ({ id, stage: i === 0 ? stages[0] : journey === "lineage" && i === walked.length - 1 ? stages[2] : stages[1] })),
      ...produced.map((id) => ({ id, stage: stages[2] }))];
    const steps: TourStep[] = [];
    for (const { id, stage } of path.slice(0, TOUR_LIMITS.steps)) {
      const location = locate(id);
      const view = ctx.viewsAt(location)[0];
      if (!view) continue;
      steps.push({ id: `${steps.length + 1}`, location, viewId: view.id, explanationRef: `guide:journey.${journey}.${stage}`, origin: "datapass-guidance" });
    }
    if (steps.length < 2) continue;
    tours.push({ id: `datapass.journey.${journey}.${tours.length + 1}`, titleRef: `guide:journey.${journey}`, mode: "general", journey, steps });
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
