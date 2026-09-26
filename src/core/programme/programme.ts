/**
 * Programme projection: filtered views over the project graph. Items are referenced, not
 * copied, and no authority moves into DataPass by appearing in a view.
 */
import type { DomainPack } from "../domainPacks/pack";
import { analyzeImpact, type DerivedOutput, type ImpactEntry } from "../impact/facets";
import type { GraphItem } from "../workspace/graph";

export interface ProgrammeView {
  id: string;
  title: string;
  description?: string;
  items: Array<Pick<GraphItem, "id" | "kind" | "label" | "authority"> & { state?: string }>;
  outputs: ImpactEntry[];
}

export const GENERIC_VIEWS: DomainPack["views"] = [
  { id: "data", title: "Data", itemKinds: ["dataset", "dataset-snapshot", "workflow", "dataflow", "notebook", "streaming-flow", "script"] },
  { id: "bi", title: "BI", itemKinds: ["semantic-model", "dashboard"] },
  { id: "apps", title: "Applications", itemKinds: ["application"] },
  { id: "deliverables", title: "Deliverables", itemKinds: ["report", "artifact-bundle"] },
  { id: "infrastructure", title: "Infrastructure", itemKinds: ["infrastructure-definition"] }
];

export function packOutputs(pack: DomainPack | undefined): DerivedOutput[] {
  return (pack?.outputs ?? []).map(o => ({ id: o.id, label: o.label, dependsOn: o.dependsOn }));
}

export function buildProgramme(items: GraphItem[], pack: DomainPack | undefined, impact: ImpactEntry[] = analyzeImpact(packOutputs(pack), new Map())): ProgrammeView[] {
  const views = pack?.views?.length ? pack.views : GENERIC_VIEWS;
  const outputView = new Map((pack?.outputs ?? []).map(o => [o.id, o.view]));
  return views.map(v => ({
    id: v.id,
    title: v.title,
    description: v.description,
    items: items
      .filter(i => (v.itemKinds ?? []).includes(i.kind) || (i.views ?? []).includes(v.id) || (v.tags ?? []).some(t => (i.tags ?? []).includes(t)))
      .map(i => ({ id: i.id, kind: i.kind, label: i.label, authority: i.authority })),
    outputs: impact.filter(e => outputView.get(e.outputId) === v.id)
  }));
}
