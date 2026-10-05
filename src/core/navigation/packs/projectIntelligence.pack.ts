import type { ViewCatalog } from '../navTypes';
import { NAV_LEVELS } from '../navTypes';
const views = [ ['architecture', 'Project architecture'], ['data', 'End-to-end data lineage'], ['columns', 'Column lineage'],
  ['orchestration', 'Orchestration'], ['deployment', 'Deployment context'], ['impact', 'Impact'], ['quality', 'Quality / tests'], ['environment', 'Environment context']
].map(([projection, title]) => ({ id: `project-${projection}`, title: title!, layout: 'graph' as const, bindings: [{ source: 'project-lineage', params: { projection } }] }));
export default NAV_LEVELS.map(level => ({ artifactKind: '*', level, views: [...views,
  { id: 'project-sankey', title: 'Repository → component Sankey', layout: 'graph', bindings: [{ source: 'project-sankey' }] }] })) satisfies ViewCatalog['entries'];
