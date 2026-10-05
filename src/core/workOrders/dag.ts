/** Dependency readiness is a projection of existing orders/state. Agent reports cannot qualify work. */
import type { WorkOrder, OrderState } from './format';
export const DAG_STATES = ['DRAFT', 'READY', 'BLOCKED', 'RUNNING', 'EVIDENCE_RECEIVED', 'FAILED', 'QUALIFIED', 'DONE', 'SUPERSEDED'] as const;
export type DagStatus = typeof DAG_STATES[number];
export interface OrderDag { requires?: string[]; produces?: string[]; unblocks?: string[]; related?: string[]; supersedes?: string[]; acceptance?: string[]; evidence?: string[]; priority?: number; draft?: boolean }
export interface DagQualification { at: string; digest: string; acceptance: string[]; evidence: string[]; by: 'person' }
export interface DagInput { order: WorkOrder; state?: OrderState; problem?: string; resultStatus?: string; policyAllowed: boolean; digest?: string }
export interface DagRow { id: string; project: string; title: string; scope?: string; status: DagStatus; qualified?: boolean; priority: number; blockers: string[]; requires: string[]; produces: string[]; unblocks: string[]; related: string[]; supersedes: string[]; acceptance: string[]; evidence: string[] }
export function workOrderDag(inputs: readonly DagInput[]): DagRow[] {
  const byId = new Map(inputs.map(i => [i.order.id, i])); const memo = new Map<string, DagRow>(); const active = new Set<string>();
  const duplicated = new Set(inputs.filter(i => inputs.filter(j => j.order.id === i.order.id).length > 1).map(i => i.order.id));
  const requirements = (i: DagInput) => [...new Set([...(i.order.dag?.requires ?? []), ...inputs.filter(p => p.order.dag?.unblocks?.includes(i.order.id)).map(p => p.order.id)])];
  const row = (id: string): DagRow => {
    const cached = memo.get(id); if (cached) return cached;
    const i = byId.get(id)!; const d = i.order.dag ?? {}; const requires = requirements(i);
    const r: DagRow = { id, project: i.order.project.id, title: i.order.title, scope: i.order.scope.subproject, status: 'BLOCKED', priority: d.priority ?? 0, blockers: [], requires,
      produces: d.produces ?? [], unblocks: d.unblocks ?? [], related: d.related ?? [], supersedes: d.supersedes ?? [], acceptance: d.acceptance ?? [], evidence: d.evidence ?? [] };
    if (active.has(id)) { r.blockers.push('dependency cycle'); return r; }
    active.add(id);
    if (i.problem) r.blockers.push(i.problem);
    if (duplicated.has(id)) r.blockers.push('ambiguous duplicate order id');
    for (const dep of requires) {
      if (!byId.has(dep)) r.blockers.push(`requires ${dep}: missing`);
      else { const p = row(dep); if (!p.qualified || !['QUALIFIED', 'DONE'].includes(p.status)) r.blockers.push(`requires ${dep}: ${p.status}${p.status === 'DONE' && !p.qualified ? ' (qualification missing)' : ''}${p.blockers.some(b => b.includes('cycle')) ? ' (dependency cycle)' : ''}`); }
    }
    const q = i.state?.qualification;
    const qualified = !!q && q.by === 'person' && q.digest === i.digest && r.acceptance.length > 0 && r.acceptance.every(a => q.acceptance.includes(a)) && q.evidence.length > 0;
    r.qualified = qualified && r.blockers.length === 0;
    if (inputs.some(p => p.order.dag?.supersedes?.includes(id))) r.status = 'SUPERSEDED';
    else if (!r.blockers.length && i.state?.status === 'done' && (!d.acceptance?.length || qualified)) r.status = 'DONE';
    else if (!r.blockers.length && qualified) { r.status = 'QUALIFIED'; r.evidence = [...new Set([...r.evidence, ...q!.evidence])]; }
    else if (r.blockers.length) r.status = 'BLOCKED';
    else if (i.resultStatus === 'failed' || i.resultStatus === 'blocked') r.status = i.resultStatus === 'failed' ? 'FAILED' : 'BLOCKED';
    else if (i.resultStatus) r.status = 'EVIDENCE_RECEIVED';
    else if (i.state?.status === 'launched') r.status = 'RUNNING';
    else if (d.draft || i.state?.status === 'abandoned') r.status = 'DRAFT';
    else if (!i.policyAllowed) { r.status = 'BLOCKED'; r.blockers.push('existing WorkOrder policy does not permit work'); }
    else r.status = 'READY';
    active.delete(id); memo.set(id, r); return r;
  };
  return inputs.map(i => row(i.order.id));
}
export function nextReadyWork(rows: readonly DagRow[], scope?: { project?: string; subproject?: string }): DagRow | undefined {
  return rows.filter(r => r.status === 'READY' && (!scope?.project || r.project === scope.project) && (!scope?.subproject || r.scope === scope.subproject))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
}
