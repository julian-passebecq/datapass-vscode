import type { ProjectLadder, LadderEntry } from './ladder';
import type { NavLocation } from './navTypes';
import type { LineageGraphLike } from './bindings/lineage';

/** Extend the existing ladder with canonical graph IDs, retaining the one navigation service. */
export function withLineageLadder(base: ProjectLadder, graph?: LineageGraphLike): ProjectLadder {
  if (!graph) return base;
  const entries = new Map<string, LadderEntry>(), parents = new Map<string, NavLocation>(), children = new Map<string, NavLocation[]>();
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  for (const node of graph.nodes) {
    const location: NavLocation = { level: 'artifact', nodeId: node.id, artifactKind: 'other' };
    const source = node.evidence.find(e => e.locator)?.locator?.path, slash = source?.indexOf('/') ?? -1;
    const file = source && slash > 0 ? { repoKey: source.slice(0, slash), repoPath: source.slice(slash + 1) } : undefined;
    const sourceLocation = file && base.locate(file.repoKey, file.repoPath);
    const parentNode = node.parentId && byId.get(node.parentId);
    const parent = parentNode ? { level: 'artifact' as const, nodeId: parentNode.id, artifactKind: 'other' } : sourceLocation ?? base.root();
    const sourceEntry = sourceLocation && base.entry(sourceLocation);
    entries.set(node.id, { location, label: node.name, file, componentId: sourceEntry?.componentId, subprojectId: sourceEntry?.subprojectId });
    parents.set(node.id, parent);
    children.set(parent.nodeId, [...(children.get(parent.nodeId) ?? []), location]);
  }
  return { root: () => base.root(), locate: (...args) => base.locate(...args),
    entry: l => entries.get(l.nodeId) ?? base.entry(l), parent: l => parents.get(l.nodeId) ?? base.parent(l),
    children: l => [...base.children(l), ...(children.get(l.nodeId) ?? [])] };
}
