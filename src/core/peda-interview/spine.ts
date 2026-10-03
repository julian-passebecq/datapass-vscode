/**
 * V5 PEDA2 (Julian addendum 2, go/TOUR-PEDA-contract.md § 4): "The whole picture", the 5-question spine of every
 * guided / interview tour — how does the data arrive, where does it live, how does it change, what makes it run,
 * why trust the result. Each step resolves to the project's best Location (the fact node with the most relations,
 * then the smallest id), the project root when none (the box then shows a hole). Card families hang under a step
 * by the family → step maps below (data, not logic). Pure (no `vscode`).
 */
import type { ProjectMap } from "../project/projectMap";
import { componentLocation, projectLocation } from "../navigation/projectLadder";
import type { NavLocation } from "../navigation/navTypes";
import type { CardEntry, ConceptCardFamily, DecisionCardFamily } from "../peda-cards/cardTypes";
import { WHOLE_PICTURE_STEP_IDS, type WholePictureStepId } from "./tourShape";

export { WHOLE_PICTURE_STEP_IDS, type WholePictureStepId };

export const CONCEPT_FAMILY_STEP: Readonly<Record<ConceptCardFamily, WholePictureStepId>> = {
  ingestion: "arrive", storage: "live", transformation: "change", "spark-sql": "change", "sql-technique": "change",
  orchestration: "run", quality: "trust"
};
export const DECISION_FAMILY_STEP: Readonly<Record<DecisionCardFamily, WholePictureStepId>> = {
  storage: "live", "data-modeling": "change", "recovery-change": "run", "quality-performance": "trust"
};

/** The spine step of a card entry: its concept card's family first, else its decision card's. */
export function spineStepOf(entry: CardEntry, kind: "concept" | "decision" = entry.card ? "concept" : "decision"): WholePictureStepId | undefined {
  if (kind === "concept" && entry.card) return CONCEPT_FAMILY_STEP[entry.card.family];
  if (kind === "decision" && entry.decisionCard) return DECISION_FAMILY_STEP[entry.decisionCard.family];
  return undefined;
}

/** A project node that answers one spine question (from the project map, lineage, analyzers). */
export interface SpineNode {
  readonly step: WholePictureStepId;
  readonly location: NavLocation;
  readonly label: string;
  /** Higher = more central (relations, readers, writers). */
  readonly weight: number;
}

/** Component kind → spine step (data). A word of the component's label or description in `SPINE_TAGS` wins over its kind. */
export const SPINE_KINDS: Readonly<Record<string, WholePictureStepId>> = {
  "streaming-flow": "arrive", dataset: "live", "dataset-snapshot": "live", "semantic-model": "live",
  notebook: "change", script: "change", dataflow: "change", package: "change", model: "change",
  workflow: "run", "infrastructure-definition": "run"
};
export const SPINE_TAGS: Readonly<Record<string, WholePictureStepId>> = {
  ingestion: "arrive", ingest: "arrive", source: "arrive", landing: "arrive", cdc: "arrive", connector: "arrive",
  storage: "live", lakehouse: "live", warehouse: "live", bronze: "live", silver: "live", gold: "live",
  transformation: "change", transform: "change", dbt: "change",
  orchestration: "run", schedule: "run", pipeline: "run", airflow: "run",
  quality: "trust", test: "trust", tests: "trust", lineage: "trust", monitoring: "trust", evidence: "trust"
};

/** Spine nodes of the project map: one per component with a known step, weighted by its relations. */
export function spineNodesFromMap(map: ProjectMap): SpineNode[] {
  const out: SpineNode[] = [];
  for (const c of map.components) {
    const step = tagStep(c.label, c.description ?? "") ?? SPINE_KINDS[c.kind];
    if (step) out.push({ step, location: componentLocation(c.id), label: c.label, weight: c.incoming.length + c.outgoing.length });
  }
  return out;
}

function tagStep(...texts: readonly string[]): WholePictureStepId | undefined {
  for (const t of texts) for (const w of t.toLowerCase().split(/[^a-z0-9-]+/)) if (SPINE_TAGS[w]) return SPINE_TAGS[w];
  return undefined;
}

export interface SpineStop { readonly step: WholePictureStepId; readonly location: NavLocation; readonly label: string | null; readonly hole: boolean }

/** The best Location of each spine step; the project root (hole) when no node answers it. Deterministic. */
export function spineStops(nodes: readonly SpineNode[], root: NavLocation): SpineStop[] {
  return WHOLE_PICTURE_STEP_IDS.map(step => {
    const best = nodes.filter(n => n.step === step)
      .sort((a, b) => b.weight - a.weight || (a.location.nodeId < b.location.nodeId ? -1 : a.location.nodeId > b.location.nodeId ? 1 : 0))[0];
    return best ? { step, location: best.location, label: best.label, hole: false } : { step, location: root, label: null, hole: true };
  });
}

export const rootOf = (map: ProjectMap): NavLocation => projectLocation(map);

/** Ladder node of a code span: the component whose artifact root holds the file (longest root wins), else null. */
export function locateInMap(map: ProjectMap): (span: { readonly repositoryKey: string; readonly path: string }) => NavLocation | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\/+|\/+$/g, "");
  return span => {
    const path = norm(span.path);
    let best: { id: string; len: number } | null = null;
    for (const c of map.components) {
      const a = c.artifacts;
      if (!a || a.repoKey !== span.repositoryKey) continue;
      const root = norm(a.root);
      if (root && path !== root && !path.startsWith(`${root}/`)) continue;
      if (!best || root.length > best.len || (root.length === best.len && c.id < best.id)) best = { id: c.id, len: root.length };
    }
    return best ? componentLocation(best.id) : null;
  };
}
