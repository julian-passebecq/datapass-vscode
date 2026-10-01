/**
 * V5 EXPLAIN1 (TL-8) binding sources of an explainer export: what the project-level views already show, read
 * from the facts the session holds (project map, options file), shaped as the renderer's `BindingData`.
 * The audience filter runs first and is the only door: a confidential item never reaches a provider, an
 * unclassified one counts as internal (never assumed public, as in the DiagramCloud projection).
 * Navigation packages (NAVHOME1 `project-health`, NAVLIN1 `lineage`, NAVTODO1 `next-steps`) plug their own
 * providers in with `registerExplainSource`; a section whose source has no provider is skipped. Pure.
 */
import type { BindingData, Card, Row } from "../../webview/views/model";
import type { ComponentView, ProjectMap, SubprojectView } from "../project/projectMap";
import type { Decision, OptionsFile } from "../project/options";

export type ExplainAudience = "internal" | "public";

/** The facts an export reads, already filtered for the audience. */
export interface ExplainFacts {
  readonly audience: ExplainAudience;
  readonly map: ProjectMap;
  readonly options?: OptionsFile;
  /** Ids of the components left out for this audience (counted on the page, never named). */
  readonly omitted: readonly string[];
}

export type ExplainProvider = (facts: ExplainFacts, params: Readonly<Record<string, unknown>>) => BindingData[];

const providers = new Map<string, ExplainProvider>();
export function registerExplainSource(source: string, provider: ExplainProvider): void { providers.set(source, provider); }
export function explainProvider(source: string): ExplainProvider | undefined { return providers.get(source); }

/** Classification gate: confidential never; public audience = items explicitly public only. */
export function visibleTo(audience: ExplainAudience, classification: ComponentView["classification"]): boolean {
  const c = classification ?? "internal";
  if (c === "confidential") return false;
  return audience === "internal" || c === "public";
}

/** The project map as the audience may see it: hidden components, their relations and decisions touching them removed. */
export function filterFacts(audience: ExplainAudience, map: ProjectMap, options?: OptionsFile): ExplainFacts {
  const kept = new Set(map.components.filter(c => visibleTo(audience, c.classification)).map(c => c.id));
  const omitted = map.components.filter(c => !kept.has(c.id)).map(c => c.id).sort();
  const hidden = new Set(omitted);
  const subprojects = map.subprojects
    .map(s => ({ ...s, componentIds: s.componentIds.filter(id => kept.has(id)) }))
    .filter(s => s.componentIds.length || !s.implicit);
  const filtered: ProjectMap = {
    ...map,
    components: map.components.filter(c => kept.has(c.id)).map(c => ({ ...c, children: c.children.filter(id => kept.has(id)),
      incoming: c.incoming.filter(r => kept.has(r.source)), outgoing: c.outgoing.filter(r => kept.has(r.target)) })),
    relations: map.relations.filter(r => kept.has(r.source) && kept.has(r.target)),
    subprojects,
    // Map problems are diagnostics of the project files, not part of an explainer.
    problems: []
  };
  const decisions = options?.decisions.filter(d => !(d.concerns ?? []).some(id => hidden.has(id))) ?? [];
  return { audience, map: filtered, ...(options ? { options: { ...options, decisions } } : {}), omitted };
}

const groupOf = (map: ProjectMap, c: ComponentView): string =>
  c.subprojects.map(id => map.subprojects.find(s => s.id === id)?.title ?? id).join(", ");

const architecture: ExplainProvider = ({ map }) => {
  const rows: Row[] = map.components.map(c => ({ nodeId: c.id, cells: {
    component: c.label, kind: c.kind, group: groupOf(map, c), status: c.status ?? null,
    health: { value: c.health, origin: "static" } } }));
  return [{ source: "explain.architecture", origin: "declared", holes: [], columns: ["component", "kind", "group", "status", "health"], rows }];
};

const flows: ExplainProvider = ({ map }) => {
  const rows: Row[] = map.relations.map(r => ({ cells: { from: r.from, relation: r.relation, to: r.to, flow: r.flow } }));
  return [{ source: "explain.flows", origin: "declared", holes: [], columns: ["from", "relation", "to", "flow"], rows }];
};

const subprojectCard = (s: SubprojectView): Card => ({ id: s.id, title: s.title, origin: "static", fields: [
  ...(s.objective ? [{ label: "objective", value: { value: s.objective, origin: "declared" } }] : []),
  { label: "components", value: s.componentIds.length },
  { label: "files", value: `${s.summary.filesFound} / ${s.summary.filesExpected}` },
  { label: "operations", value: `${s.summary.opsReady} / ${s.summary.opsTotal}` },
  { label: "health", value: s.health }] });

const readiness: ExplainProvider = ({ map }) =>
  [{ source: "explain.readiness", origin: "static", holes: [], cards: map.subprojects.map(subprojectCard) }];

const nextSteps: ExplainProvider = ({ map }) => {
  const rows: Row[] = [
    ...(map.nextStep ? [{ cells: { where: map.project?.title ?? "", item: map.nextStep } }] : []),
    ...map.subprojects.filter(s => s.nextStep).map(s => ({ cells: { where: s.title, item: s.nextStep } })),
    ...map.components.filter(c => c.nextStep && c.health !== "ok").map(c => ({ nodeId: c.id, cells: { where: c.label, item: c.nextStep } }))
  ];
  return [{ source: "explain.next-steps", origin: "datapass-guidance", holes: [], columns: ["where", "item"], rows }];
};

const optionLabel = (d: Decision, id: string | undefined): string | null => id ? d.options.find(o => o.id === id)?.label ?? id : null;

const decisions: ExplainProvider = ({ options }) => {
  if (!options) return [{ source: "explain.decisions", origin: "declared", holes: [], cards: [] }];
  const cards: Card[] = options.decisions.map(d => ({ id: d.id, title: d.title, origin: "declared", fields: [
    ...(d.question ? [{ label: "question", value: d.question }] : []),
    { label: "current", value: optionLabel(d, d.current) },
    { label: "chosen", value: optionLabel(d, d.chosen) },
    ...(d.decidedOn || d.decidedBy ? [{ label: "decided", value: [d.decidedOn, d.decidedBy].filter(Boolean).join(" · ") }] : []),
    ...(d.rationale ? [{ label: "rationale", value: d.rationale }] : []),
    { label: "options", value: d.options.filter(o => !o.rejected).map(o => o.label).join(" · ") }] }));
  return [{ source: "explain.decisions", origin: "declared", holes: [], cards }];
};

registerExplainSource("explain.architecture", architecture);
registerExplainSource("explain.flows", flows);
registerExplainSource("explain.readiness", readiness);
registerExplainSource("explain.next-steps", nextSteps);
registerExplainSource("explain.decisions", decisions);
