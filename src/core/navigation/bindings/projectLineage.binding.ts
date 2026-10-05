import { projectGraph, HOP_PROJECTION, DEFAULT_STYLE_PRESET } from '@juliandatapass-group/view-spi';
import { buildLineageGraph, type LineageGraph } from '@juliandatapass-group/lineage-core';
import { collectLineage, LINEAGE_TO_NAV_ORIGIN, weakestOrigin } from './lineage';
import { lineageLocatorFor } from './lineage.binding';
import { EVIDENCE_ORIGINS } from '../../project/intelligence';
import type { BindingProvider } from './index';

export const PROJECT_PROJECTIONS = {
  architecture: ['reads', 'writes', 'orchestrates', 'deploys', 'configures', 'serves', 'exposes'],
  data: ['reads', 'writes', 'derives'], columns: ['derives'], orchestration: ['orchestrates'], deployment: ['deploys', 'configures'],
  impact: ['reads', 'writes', 'derives', 'orchestrates', 'deploys', 'serves', 'exposes'], quality: ['tests'],
  environment: ['reads', 'writes', 'derives', 'orchestrates', 'deploys', 'configures', 'serves', 'tests', 'exposes']
} as const;

export default { source: 'project-lineage', provide(ctx) {
  const graph = ctx.lineageGraph;
  if (!graph) return { origin: 'static', holes: [{ kind: 'not-analyzed', reason: 'Analyze project locally to populate the shared static graph.' }] };
  const key = String(ctx.params?.projection ?? 'data') as keyof typeof PROJECT_PROJECTIONS;
  const kinds = PROJECT_PROJECTIONS[key] ?? PROJECT_PROJECTIONS.data;
  let edges = graph.edges.filter(e => (kinds as readonly string[]).includes(e.kind));
  const holes: { kind: string; reason: string }[] = [];
  let scopedIds: Set<string> | undefined;
  if (key === 'impact') {
    const cut = collectLineage(graph, ctx.location, lineageLocatorFor(ctx.projectMap), { direction: 'downstream', depth: 20, maxNodes: 1000, edgeKinds: [...kinds] });
    scopedIds = new Set(cut.graph?.nodes.map(n => n.id) ?? []);
    edges = edges.filter(e => scopedIds!.has(e.fromId) && scopedIds!.has(e.toId));
    holes.push(...cut.holes.map(h => ({ kind: 'impact-coverage', reason: h.reason })));
  }
  if (key === 'environment') {
    const env = ctx.selectedEnvironment, map = ctx.projectMap;
    const known = !!env && !!map?.environments.some(e => e.id === env);
    const paths = known ? map!.components.filter(c => c.operations.some(op => !op.environmentId || op.environmentId === env))
      .flatMap(c => c.artifacts?.files.map(f => `${c.artifacts!.repoKey}/${f.repoPath}`) ?? []) : [];
    scopedIds = new Set(graph.nodes.filter(n => n.evidence.some(ev => ev.locator && paths.includes(ev.locator.path))).map(n => n.id));
    edges = edges.filter(e => scopedIds!.has(e.fromId) && scopedIds!.has(e.toId));
    holes.push({ kind: 'environment-scope', reason: known ? `Declared applicability for ${env}. Unmapped source nodes are excluded; selected node remains as context. This is not an observed deployment.` : 'Select a declared environment in Project Home; environment applicability is not inferred.' });
  }
  const ids = new Set(edges.flatMap(e => [e.fromId, e.toId]));
  if (key === 'columns') for (const node of graph.nodes) if (node.kind === 'field') ids.add(node.id);
  if (key === 'architecture') for (const node of graph.nodes) if (node.kind !== 'field') ids.add(node.id);
  for (const id of scopedIds ?? []) ids.add(id);
  if (graph.nodes.some(n => n.id === ctx.location.nodeId)) ids.add(ctx.location.nodeId);
  // The host supplies a validated LG0 graph; the structural binding interface omits unused fields.
  const full = graph as LineageGraph;
  const edgeIds = new Set(edges.map(e => e.id));
  const cut = buildLineageGraph({ namespace: full.namespace, nodes: full.nodes, edges: full.edges.filter(e => edgeIds.has(e.id)) });
  if (!cut.ok) return { origin: 'static', holes: [{ kind: 'projection-failed', reason: 'Shared graph cut failed validation.' }] };
  const result = projectGraph(cut.value, { ...HOP_PROJECTION, id: `project-${key}`, filter: { ...HOP_PROJECTION.filter, edgeKinds: [...kinds], includeIds: [...ids].sort(), excludeIds: graph.nodes.filter(n => !ids.has(n.id)).map(n => n.id), dropIsolated: false } }, DEFAULT_STYLE_PRESET, { zoom: key === 'columns' ? 'very-micro' : 'micro' });
  if (!edges.length) holes.push({ kind: 'coverage-gap', reason: `No evidenced ${key} relationships have been extracted for this context.` });
  if (!result.ok) return { origin: 'static', holes: [{ kind: 'projection-failed', reason: 'Shared graph projection failed validation.' }] };
  return { origin: weakestOrigin(edges.flatMap(e => e.evidence.map(ev => LINEAGE_TO_NAV_ORIGIN[ev.origin]))), graph: result.value, holes,
    rows: edges.map(e => ({ id: e.id, label: e.kind, origin: LINEAGE_TO_NAV_ORIGIN[e.origin], from: e.fromId, to: e.toId,
      evidenceOrigins: [...new Set(e.evidence.map(ev => EVIDENCE_ORIGINS[ev.origin]))].join(', '), sources: e.evidence.flatMap(ev => ev.locator ? [ev.locator.path] : []).join(', ') })) };
} } satisfies BindingProvider;
