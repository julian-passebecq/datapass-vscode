import type { BindingProvider, BindingGraph } from './index';
import { toGraphView } from './graphView';
import { projectSankey } from '../../project/intelligence';

/** Project-map projection, using the existing graph renderer and declared component IDs. */
export default { source: 'project-sankey', provide(ctx) {
  if (!ctx.projectMap?.project) return { origin: 'declared', holes: [{ kind: 'no-project', reason: 'Open a project first.' }] };
  const flows = projectSankey(ctx.projectMap);
  const nodes: BindingGraph['nodes'][number][] = flows.flatMap(f => [
    { id: `repo:${f.repo}`, label: f.label, origin: 'declared', kind: 'job' },
    ...f.components.map(c => ({ id: c.id, label: c.label, origin: 'declared', kind: 'job' }))
  ]);
  const edges = flows.flatMap(f => f.components.map(c => ({ source: `repo:${f.repo}`, target: c.id, label: 'configures', origin: 'declared' })));
  const base = toGraphView({ nodes, edges }, 'project-sankey');
  const graph = { ...base,
    groups: [{ id: 'repositories', label: 'Repositories', memberCount: flows.length, collapsed: false, color: 'repository' },
      { id: 'components', label: 'Components', memberCount: ctx.projectMap.components.length, collapsed: false, color: 'component' }],
    nodes: base.nodes.map(n => ({ ...n, groupId: n.id.startsWith('repo:') ? 'repositories' : 'components' })),
    edges: base.edges.map(e => ({ ...e, volumetry: { rowsPerRun: null, bytesPerRun: null, frequency: null, basis: 'theoretical' as const, measuredEdges: 0, flowEdges: 0, label: '1 declared component' }, style: { ...e.style, width: 8, arrow: 'none' as const } })) };
  return { origin: 'declared', graph, holes: flows.filter(f => !f.components.length).map(f => ({ kind: 'no-component', reason: `${f.label}: no component association declared.` })),
    rows: flows.map(f => ({ id: f.repo, label: f.label, origin: 'declared', weight: f.components.length, unit: 'declared components' })) };
} } satisfies BindingProvider;
