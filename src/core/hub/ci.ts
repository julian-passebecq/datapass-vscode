/** Fixed read-only host requests and exact-HEAD CI projection. No credential handling here. */
import type { GitHostRepo } from '../project/gitHosts';
import { isSha } from '../git/porcelain';
export type HeadCiStatus = 'PASS' | 'FAIL' | 'RUNNING' | 'BLOCKED' | 'UNKNOWN';
export interface HeadCi { status: HeadCiStatus; sha: string; observedAt?: string; origin: 'CI-OBSERVED'; detail: string; pipelines: { id: string; sha: string; status: HeadCiStatus }[] }
export function headCiArgs(host: GitHostRepo, sha: string): { tool: 'gh' | 'glab' | 'az'; args: string[] } | undefined {
  if (!isSha(sha)) return undefined;
  if (host.kind === 'gitlab' && host.web.startsWith('https://gitlab.com/')) return { tool: 'glab', args: ['api', '--method', 'GET', '--hostname', 'gitlab.com', `projects/${encodeURIComponent(host.web.slice('https://gitlab.com/'.length))}/pipelines?sha=${sha}&per_page=20`] };
  if (host.kind === 'github' && host.owner) return { tool: 'gh', args: ['run', 'list', '--repo', `${host.owner}/${host.name}`, '--commit', sha, '--limit', '20', '--json', 'databaseId,headSha,status,conclusion,name,workflowName'] };
  if (host.kind === 'azure-devops' && host.org && host.project) return { tool: 'az', args: ['pipelines', 'build', 'list', '--organization', `https://dev.azure.com/${host.org}`, '--project', host.project, '--top', '20', '--output', 'json'] };
  return undefined;
}
export function unknownHeadCi(sha: string, detail: string): HeadCi { return { sha, status: 'UNKNOWN', detail, pipelines: [], origin: 'CI-OBSERVED' }; }
export function exactHeadCi(host: GitHostRepo['kind'], sha: string, raw: unknown, at: string): HeadCi {
  if (!Array.isArray(raw)) return unknownHeadCi(sha, 'Invalid CI response');
  const rows = raw.flatMap((v: unknown) => {
    if (!v || typeof v !== 'object') return []; const p = v as Record<string, any>;
    const head = p.sha ?? p.headSha ?? p.sourceVersion; if (head !== sha || !isSha(head)) return [];
    const id = p.id ?? p.databaseId; if (typeof id !== 'number' && typeof id !== 'string') return [];
    const value = host === 'github' ? (p.status === 'completed' ? p.conclusion : p.status) : host === 'azure-devops' ? (p.status === 'completed' ? p.result : p.status) : p.status;
    const status: HeadCiStatus = ['success', 'succeeded'].includes(value) ? 'PASS' : ['failed', 'failure', 'timed_out'].includes(value) ? 'FAIL' : ['running', 'in_progress', 'inProgress', 'pending', 'created', 'queued', 'notStarted'].includes(value) ? 'RUNNING' : ['manual', 'blocked', 'action_required', 'waiting_for_resource'].includes(value) ? 'BLOCKED' : 'UNKNOWN';
    return [{ id: String(id).slice(0, 80), sha: head, status, group: String(p.workflowName ?? p.definition?.id ?? `${p.ref ?? ''}/${p.source ?? ''}`), ordinal: Number(id) || 0 }];
  });
  const latest = new Map<string, typeof rows[number]>(); for (const r of rows) if (!latest.has(r.group) || latest.get(r.group)!.ordinal < r.ordinal) latest.set(r.group, r);
  const pipelines = [...latest.values()].map(({ id, sha, status }) => ({ id, sha, status }));
  const statuses = pipelines.map(p => p.status);
  const status: HeadCiStatus = statuses.includes('FAIL') ? 'FAIL' : statuses.includes('BLOCKED') ? 'BLOCKED' : statuses.includes('RUNNING') ? 'RUNNING' : statuses.length && statuses.every(s => s === 'PASS') && raw.length < 20 ? 'PASS' : 'UNKNOWN';
  return { sha, status, observedAt: at, origin: 'CI-OBSERVED', pipelines, detail: raw.length >= 20 ? 'Bounded CI response; completeness unknown' : pipelines.length ? 'Latest reported pipelines/workflows for this exact HEAD; not deployment qualification' : 'No CI evidence for this exact HEAD' };
}
