import type { DataPassProjectManifest } from '../projectManifestModel';
import type { GitRepoReport } from '../git/gitReport';
import type { HeadCi } from './ci';
import type { FileSemanticDiff } from './semanticDiff';
import type { DagRow } from '../workOrders/dag';
import { effectiveBindings } from './model';
import { classifyPath } from './classify';
export interface HubRepository { key: string; label: string; git?: GitRepoReport; ci?: HeadCi; changedFiles: string[]; semantic: { path: string; diff: FileSemanticDiff }[]; gaps: string[]; components: string[]; recent?: string[]; topology?: { branch: string; head?: string; base?: string; relation: 'default' | 'same' | 'ahead' | 'behind' | 'diverged' | 'unknown' }[] }
export interface HubProject { id: string; title: string; company: string; program: string; root?: string; manifest?: DataPassProjectManifest; repositories: HubRepository[]; orders: DagRow[]; agents: { provider: string; order: string; repo: string; branch?: string; worktree?: string; status: string; origin: 'AGENT-REPORTED'; mr?: number; ci?: string; evidence: string[] }[]; gaps: string[]; coverage?: { UNDERSTOOD: number; PARTIAL: number; UNKNOWN: number; IGNORED: number }; readiness?: string; qualification: string; selectedEnvironment?: string }
export interface HubScope { company?: string; program?: string; project?: string; tab?: string; repository?: string }
export interface HubState { projects: HubProject[]; scope: HubScope; companies: string[]; programs: string[]; summary: ReturnType<typeof hubSummary>; attention: { project: string; repo?: string; message: string; origin: string }[]; minimap: boolean; inspector: boolean; minimapExpanded: boolean; observedAt?: string; gaps: string[]; companions: { lens?: string; cloud?: string; xray?: string }; selectedComponent?: string }
export function scopeProjects(projects: readonly HubProject[], scope: HubScope): HubProject[] { return projects.filter(p => (!scope.company || p.company === scope.company) && (!scope.program || p.program === scope.program) && (!scope.project || p.id === scope.project)); }
export function hubSummary(projects: readonly HubProject[]) {
  const repos = projects.flatMap(p => p.repositories); const orders = projects.flatMap(p => p.orders);
  return { projects: projects.length, active: projects.filter(p => p.orders.some(o => ['RUNNING', 'READY', 'EVIDENCE_RECEIVED'].includes(o.status))).length,
    repositories: repos.length, workOrders: orders.length, ready: orders.filter(o => o.status === 'READY').length,
    agents: new Set(projects.flatMap(p => p.agents.filter(a => a.status === 'running').map(a => `${p.id}:${a.provider}:${a.order}`))).size, prs: repos.reduce((n, r) => n + (r.git?.prs?.length ?? 0), 0),
    failedCi: repos.filter(r => r.ci?.status === 'FAIL').length, blockedCi: repos.filter(r => r.ci?.status === 'BLOCKED').length,
    unknownCi: repos.filter(r => !r.ci || r.ci.status === 'UNKNOWN').length, targets: projects.reduce((n, p) => n + (p.manifest?.hub?.providerTargets?.length ?? 0), 0) };
}
export function hubAttention(projects: readonly HubProject[]): HubState['attention'] {
  return projects.flatMap(p => [
    ...p.repositories.flatMap(r => [
      ...(['FAIL', 'BLOCKED'].includes(r.ci?.status ?? '') ? [{ project: p.id, repo: r.key, message: `Exact-HEAD CI ${r.ci!.status}`, origin: 'CI-OBSERVED' }] : []),
      ...(r.git?.counts?.conflicted ? [{ project: p.id, repo: r.key, message: `${r.git.counts.conflicted} conflicts`, origin: 'GIT-OBSERVED' }] : []),
      ...(r.git?.detached ? [{ project: p.id, repo: r.key, message: 'Detached HEAD', origin: 'GIT-OBSERVED' }] : []),
      ...(r.changedFiles.length ? [{ project: p.id, repo: r.key, message: `${r.changedFiles.length} changed files`, origin: 'GIT-OBSERVED' }] : []),
      ...r.gaps.map(message => ({ project: p.id, repo: r.key, message, origin: 'UNKNOWN' }))]),
    ...p.orders.filter(o => ['READY', 'BLOCKED', 'FAILED'].includes(o.status)).map(o => ({ project: p.id, message: `${o.id} ${o.status}${o.blockers.length ? ': ' + o.blockers.join('; ') : ''}`, origin: 'WORKORDER-POLICY' })),
    ...p.gaps.map(message => ({ project: p.id, message, origin: 'UNKNOWN' }))]);
}
export function repositoryFamilies(r: HubRepository) { const out: Record<string, number> = {}; for (const f of new Set(r.changedFiles)) { const kind = classifyPath(f); out[kind] = (out[kind] ?? 0) + 1; } return out; }
export function projectTargets(p: HubProject) { return p.manifest ? effectiveBindings(p.manifest, p.selectedEnvironment) : []; }
export function projectBom(p: HubProject) {
  return (p.manifest?.hub?.bom ?? []).map(b => {
    const repo = p.repositories.find(r => r.key === (b.repoRef ?? '.'));
    const match = !!b.sha && repo?.git?.head === b.sha;
    return { ...b, declaredState: b.state, observedSha: repo?.git?.head,
      observation: !repo?.git?.head || !b.sha ? 'UNKNOWN' : !match ? 'stale' : b.state === 'incompatible' ? 'incompatible' : b.state === 'qualified' ? 'current / qualification declared' : 'current',
      ci: match && repo?.ci && repo.ci.sha === b.sha ? repo.ci.status : 'UNKNOWN', origin: 'DECLARED + GIT/CI-OBSERVED' };
  });
}
/** Mini-orientation only: local refs/worktrees; no invented ancestry edges. */
export function minimapRows(p: HubProject) {
  return p.repositories.flatMap(r => {
    const g = r.git; if (!g) return [];
    const branches = [...new Set([g.defaultBranch, g.branch, ...g.worktrees.filter(w => !w.prunable).map(w => w.branch), ...p.agents.filter(a => a.repo === r.key && a.status === 'running').map(a => a.branch), ...(g.detached ? [`detached:${g.head ?? '?'}`] : []), ...g.worktrees.filter(w => w.detached).map(w => `detached:${w.head ?? '?'}`)].filter((v): v is string => !!v))];
    return branches.slice(0, 12).map(branch => {
      const current = g.branch === branch || g.detached === true && branch === `detached:${g.head ?? '?'}`;
      const topology = r.topology?.find(t => t.branch === branch);
      return { repository: r.key, label: r.label, branch, default: g.defaultBranch === branch, head: current ? g.head : topology?.head ?? g.worktrees.find(w => w.branch === branch || branch === `detached:${w.head}`)?.head,
      current, relation: topology?.relation ?? 'unknown', base: topology?.base, worktrees: g.worktrees.filter(w => w.branch === branch || branch === `detached:${w.head}`).length, mr: g.prs?.filter(pr => pr.head === branch).map(pr => ({ number: pr.number, state: pr.draft ? 'draft' : 'open', ci: pr.ci.state })) ?? [],
      agents: p.agents.filter(a => a.repo === r.key && a.branch === branch).map(a => a.order), conflicts: current ? g.counts?.conflicted ?? 0 : undefined, ci: current ? r.ci?.status ?? 'UNKNOWN' : 'UNKNOWN', origin: 'GIT-OBSERVED' as const };
    });
  });
}
