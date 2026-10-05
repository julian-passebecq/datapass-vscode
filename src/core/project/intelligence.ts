/** Project intelligence is a projection of the existing manifest, map and LG0 graph. No I/O. */
import type { DataPassProjectManifest } from '../projectManifestModel';
import type { ProjectMap } from './projectMap';
import type { LinksFile } from './links';
import type { LineageGraph } from '@juliandatapass-group/lineage-core';

export type CoverageState = 'UNDERSTOOD' | 'PARTIAL' | 'UNKNOWN' | 'IGNORED';
export interface CoverageFile { repo: string; path: string; family: string; status: CoverageState; reasons: readonly string[] }
export interface ProjectIntelligence {
  graph: LineageGraph;
  files: readonly CoverageFile[];
  limits: readonly string[];
  analyzedAt: string;
}
export const EVIDENCE_ORIGINS = { static: 'static-parse', artifact: 'artifact-import', runtime: 'runtime-observed', 'ai-proposed': 'ai-proposed', 'ai-confirmed': 'ai-confirmed' } as const;

export function coverageSummary(report?: ProjectIntelligence) {
  const counts = { UNDERSTOOD: 0, PARTIAL: 0, UNKNOWN: 0, IGNORED: 0 };
  for (const file of report?.files ?? []) counts[file.status]++;
  const origins: Record<string, number> = {};
  // Count every provenance category once per edge, including weaker evidence on a merged edge.
  for (const edge of report?.graph.edges ?? []) for (const origin of new Set(edge.evidence.map(e => EVIDENCE_ORIGINS[e.origin]))) origins[origin] = (origins[origin] ?? 0) + 1;
  return { analyzed: !!report, counts, origins, gaps: report?.files.filter(f => f.status === 'UNKNOWN' || f.status === 'PARTIAL').slice(0, 20) ?? [], limits: report?.limits ?? [] };
}

export function environmentContext(map: ProjectMap, manifest?: DataPassProjectManifest, links?: LinksFile, selected?: string) {
  return map.environments.map(env => {
    const operations = map.components.flatMap(c => c.operations).filter(op => !op.environmentId || op.environmentId === env.id);
    return {
      ...env, selected: selected === env.id,
      identifiers: (manifest?.identifiers ?? []).flatMap(id => {
        const value = id.values ? id.values[env.id] : id.value;
        return value ? [{ id: id.id, label: id.label, provider: id.provider, value }] : [];
      }),
      links: links?.groups.flatMap((group, gi) => group.links.flatMap((link, li) => !link.environment || link.environment === env.id ? [{ label: link.label, group: gi, index: li }] : [])) ?? [],
      operations: operations.map(op => ({ key: op.key, component: op.componentId, label: op.label, phase: op.phase, target: op.target, readiness: op.result.status,
        prerequisites: [...op.result.blockers, ...op.result.unknowns, ...op.result.configIssues, ...op.result.pendingReviews].map(p => `${p.label}: ${p.detail}`),
        nextStep: op.result.nextStep, files: map.components.find(c => c.id === op.componentId)?.artifacts?.files.map(f => f.repoPath) ?? [] })),
      components: map.components.filter(c => c.operations.some(op => !op.environmentId || op.environmentId === env.id)).map(c => c.id),
      ready: operations.filter(op => op.result.status === 'ready').length, total: operations.length,
      bindings: (manifest?.bindings ?? []).filter(b => !('environment' in b) || b.environment === env.id),
      branches: Object.entries(manifest?.repositories ?? {}).flatMap(([repo, decl]) => decl.remote?.branch ? [{ repo, branch: decl.remote.branch }] : [])
    };
  });
}

/** Display declared scope groups without treating a scope or a Git branch as a shipped feature. */
export function projectThemes(map: ProjectMap, report?: ProjectIntelligence) {
  return map.subprojects.filter(s => !s.implicit).map(scope => {
    const components = map.components.filter(c => scope.componentIds.includes(c.id));
    const paths = new Set(components.flatMap(c => c.artifacts?.files.map(f => `${c.artifacts!.repoKey}/${f.repoPath}`) ?? []));
    return { id: scope.id, title: scope.title, objective: scope.objective, components: components.map(c => ({ id: c.id, label: c.label })),
      files: [...paths], lineageEdges: report?.graph.edges.filter(e => e.evidence.some(ev => ev.locator && paths.has(ev.locator.path))).length ?? 0,
      verification: components.flatMap(c => c.operations.flatMap(op => op.lastResult ? [{ label: op.label, result: op.lastResult.result, stale: op.lastResult.stale }] : [])) };
  });
}

/** Counts of declared components; deliberately independent of Git history or an effort estimate. */
export function projectSankey(map: ProjectMap) {
  return map.repositories.map(repo => ({ repo: repo.key, label: repo.label, components: map.components.filter(c => c.repoKey === repo.key).map(c => ({ id: c.id, label: c.label })), unit: 'components' as const }));
}

export function projectSourceExplanations(map: ProjectMap) {
  return map.components.filter(c => c.kind === 'notebook' || /\.ipynb$/i.test(c.artifacts?.entry?.repoPath ?? '')).map(c => ({
    id: c.id, label: c.label, files: c.artifacts?.files.map(f => `${c.artifacts!.repoKey}/${f.repoPath}`) ?? [],
    explanation: 'Declared notebook: cell-based source supports interactive, session-oriented authoring. A Spark Job Definition uses a packaged entry point and job configuration. Compare the local sources, imports, orchestration targets and deployment prerequisites before choosing a route. This is a source-level architectural comparison; no runtime speed, stage or task measurements are implied.',
    operations: c.operations.map(op => op.label)
  }));
}
