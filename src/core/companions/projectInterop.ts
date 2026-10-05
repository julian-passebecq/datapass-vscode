import type { ProjectMap } from '../project/projectMap';
import type { ProjectIntelligence } from '../project/intelligence';

/** Navigation/planning commands only. DataPass never executes a deployment through these contracts. */
export const PROJECT_COMPANION_COMMANDS = {
  deployment: 'cloudStudio.planDeployment', resource: 'cloudStudio.revealResource',
  uri: 'xray.inspectUri', evidence: 'xray.inspectEvidence', revision: 'tern.revealRevision'
} as const;
export type ProjectCompanionAction = keyof typeof PROJECT_COMPANION_COMMANDS;
export interface ProjectCompanionPayload {
  schema: 'datapass.project-navigation/1';
  projectId: string;
  environment?: string;
  graphId?: string;
  canonicalIds: readonly string[];
  sourceRefs: readonly { repo: string; path: string }[];
  revisions: readonly { repo: string; sha: string; branch?: string }[];
  provenance: 'static-parse' | 'declared';
  mode: 'inspect-or-plan';
}
export function projectCompanionPayload(map: ProjectMap, report?: ProjectIntelligence, environment?: string): ProjectCompanionPayload {
  return { schema: 'datapass.project-navigation/1', projectId: map.project?.id ?? map.coordinationKey,
    environment, graphId: report?.graph.id, canonicalIds: report?.graph.nodes.slice(0, 50).map(n => n.id) ?? [],
    sourceRefs: report?.files.filter(f => f.status !== 'IGNORED').slice(0, 50).map(f => ({ repo: f.repo, path: f.path })) ?? [],
    revisions: map.repositories.flatMap(r => r.git?.head ? [{ repo: r.key, sha: r.git.head, branch: r.git.branch }] : []),
    provenance: report ? 'static-parse' : 'declared', mode: 'inspect-or-plan' };
}
export function availableProjectCompanions(commands: readonly string[]): ProjectCompanionAction[] {
  return (Object.keys(PROJECT_COMPANION_COMMANDS) as ProjectCompanionAction[]).filter(key => commands.includes(PROJECT_COMPANION_COMMANDS[key]));
}
