/** Declared hub context augments the existing project manifest, never a second project database. */
import type { EnvironmentDecl, DataPassProjectManifest } from '../projectManifestModel';
export interface ProviderTarget { id: string; label: string; cloudProvider: string; platform: string; service?: string; region?: string }
export interface RepositoryTargetBinding { repoRef: string; environment: string; targets: string[]; enabled?: boolean; branchStrategy?: string; deploymentMechanism?: string; sourceFolder?: string; components?: string[]; evidence?: string[] }
export interface HubDeclaration {
  company?: { id: string; label: string };
  program?: { id: string; label: string };
  dataZones?: { id: string; label: string }[];
  providerTargets?: ProviderTarget[];
  repositoryTargets?: RepositoryTargetBinding[];
  bom?: { id: string; repoRef?: string; version?: string; sha?: string; state: 'current' | 'candidate' | 'qualified' | 'stale' | 'incompatible'; evidence?: string[] }[];
  releases?: { id: string; label: string; version?: string; sha?: string; evidence?: string[] }[];
}
export const HUB_BOM_STATES = ['current', 'candidate', 'qualified', 'stale', 'incompatible'] as const;
export function hubDeclarationProblems(m: DataPassProjectManifest): string[] {
  const h = m.hub; if (!h) return [];
  const issues: string[] = [];
  const repos = new Set(['.', ...Object.keys(m.repositories ?? {})]);
  const envs = new Set(m.environments?.map(e => e.id));
  const targets = new Set(h.providerTargets?.map(t => t.id));
  for (const [name, entries] of [['providerTargets', h.providerTargets], ['dataZones', h.dataZones], ['bom', h.bom], ['releases', h.releases]] as const) {
    if (entries && new Set(entries.map(e => e.id)).size !== entries.length) issues.push(`hub.${name}: duplicate id`);
  }
  for (const b of h.repositoryTargets ?? []) {
    if (!repos.has(b.repoRef)) issues.push(`hub.repositoryTargets: unknown repository ${b.repoRef}`);
    if (!envs.has(b.environment)) issues.push(`hub.repositoryTargets: unknown environment ${b.environment}`);
    if (b.targets.some(t => !targets.has(t))) issues.push('hub.repositoryTargets: unknown target');
  }
  for (const b of h.bom ?? []) if (b.repoRef && !repos.has(b.repoRef)) issues.push(`hub.bom: unknown repository ${b.repoRef}`);
  return issues;
}
/** No fixed environment names or inference of production from spelling. Promotions form a DAG. */
export function environmentProblems(envs: readonly EnvironmentDecl[]): string[] {
  const issues: string[] = []; const byId = new Map(envs.map(e => [e.id, e]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) { issues.push(`environment promotion cycle at ${id}`); return; }
    if (visited.has(id)) return; visiting.add(id);
    const successors = [...new Set([...(byId.get(id)?.promotesTo ?? []), ...envs.filter(e => e.predecessors?.includes(id)).map(e => e.id)])];
    for (const next of successors) { if (!byId.has(next)) issues.push(`environment ${id}: unknown promotion ${next}`); else walk(next); }
    visiting.delete(id); visited.add(id);
  };
  for (const e of envs) {
    for (const p of e.predecessors ?? []) if (!byId.has(p)) issues.push(`environment ${e.id}: unknown predecessor ${p}`);
    walk(e.id);
  }
  return issues;
}
export function effectiveBindings(m: DataPassProjectManifest, environment?: string) {
  return (m.hub?.repositoryTargets ?? []).filter(b => !environment || b.environment === environment).map(b => ({ ...b,
    enabled: b.enabled !== false && m.environments?.find(e => e.id === b.environment)?.enabled !== false,
    providerTargets: b.targets.flatMap(id => m.hub?.providerTargets?.filter(t => t.id === id) ?? []), origin: 'DECLARED' as const
  }));
}
