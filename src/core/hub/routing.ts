/** Companion IDs are optional fixed contracts; no arbitrary command/URL from the webview. */
import type { HubState } from './projection';
import { projectTargets, scopeProjects } from './projection';
export const HUB_COMPANIONS = { lens: ['datapassLens.revealRevision', 'tern.revealRevision'], cloud: ['cloudStudio.planDeployment', 'cloudStudio.workbench'], xray: ['xray.inspectEvidence', 'xray.inspectUri'] } as const;
export type HubCompanion = keyof typeof HUB_COMPANIONS;
export function safeCompanionChoices(commands: readonly string[]): HubState['companions'] { return Object.fromEntries(Object.entries(HUB_COMPANIONS).flatMap(([key, choices]) => { const command = choices.find(c => commands.includes(c)); return command ? [[key, command]] : []; })); }
export function hubHandoff(state: HubState, repository?: string, revision?: string) {
  const p = scopeProjects(state.projects, state.scope)[0];
  const r = p?.repositories.find(r => r.key === (repository ?? state.scope.repository)) ?? p?.repositories[0];
  // Revision must be an observed current/worktree HEAD. The caller revalidates the selection on every click.
  const heads = [r?.git?.head, ...r?.git?.worktrees.map(w => w.head) ?? [], ...r?.topology?.map(t => t.head) ?? []].filter(Boolean);
  if (revision && !heads.includes(revision)) throw new Error('Revision is not in current observed context');
  return { schema: 'datapass.hub-context/1', mode: 'inspect-or-plan', company: p?.manifest?.hub?.company?.id ?? p?.company, program: p?.manifest?.hub?.program?.id ?? p?.program, project: p?.id,
    repository: r?.key, repositoryUri: r?.git?.host?.web, revision: revision ?? r?.git?.head, worktree: r?.git?.worktrees.find(w => w.head === revision)?.name,
    component: state.selectedComponent, artifact: r?.changedFiles[0], environment: p?.selectedEnvironment,
    providerTargets: p && p.selectedEnvironment ? projectTargets(p).filter(b => b.repoRef === r?.key && b.enabled).flatMap(b => b.targets) : [],
    evidenceRefs: p?.orders.flatMap(o => o.evidence).slice(0, 50) ?? [],
    origins: ['DECLARED', ...(r?.git ? ['GIT-OBSERVED'] : []), ...(r?.ci?.observedAt ? ['CI-OBSERVED'] : [])], returnContext: { command: 'datapass.openHome', scope: state.scope } };
}
