/** One presentation of the declared portfolio and bounded observations, shared by Home and Inspector. */
import { scopeProjects, hubSummary, minimapRows, projectTargets, projectBom, repositoryFamilies, type HubState, type HubProject } from '../core/hub/projection';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const button = (action: string, label: string, data = '', disabled = false) => `<button type="button" data-hub-action="${action}" ${data}${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
const list = (rows: string[], empty: string) => rows.length ? `<ul>${rows.map(r => `<li>${r}</li>`).join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`;
export const HUB_STYLE = `
 .hub { min-width:0; } .hub nav,.hub-controls,.hub-tabs { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
 .hub select { background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:4px;max-width:100%;min-width:0; }
 .hub select:focus-visible { outline:1px solid var(--vscode-focusBorder); } .hub li { margin:6px 0;overflow-wrap:anywhere; }
 .hub-stats { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(110px,100%),1fr));gap:8px; }
 .hub-stats div,.hub-repo { border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:6px;padding:10px;min-width:0; }
 .hub-stats strong { display:block;font-size:20px; } .hub button[aria-pressed=true] { outline:1px solid var(--vscode-focusBorder); }
 .hub-minimap { border-left:2px solid var(--vscode-descriptionForeground);padding-left:8px; } .hub-minimap button { text-align:left;max-width:100%;overflow-wrap:anywhere; }
 .hub-origin { font-size:10px;color:var(--vscode-descriptionForeground); } .hub-inspector { padding:8px; }
`;
export const HUB_SCRIPT = `
 document.addEventListener('click', e => {
   const b = e.target instanceof Element ? e.target.closest('[data-hub-action]') : null;
   if (!b || b.disabled) return;
   vscode.postMessage({ type:'hub', action:b.dataset.hubAction, id:b.dataset.id, repository:b.dataset.repository, revision:b.dataset.revision, value:b.dataset.value });
 });
 document.addEventListener('change', e => {
   const s = e.target;
   if (s instanceof HTMLSelectElement && s.dataset.hubScope) vscode.postMessage({ type:'hub', action:'scope', field:s.dataset.hubScope, id:s.value });
 });
`;
function companionButtons(s: HubState) {
  return (['lens', 'cloud', 'xray'] as const).map(id => button('companion', {lens:'Open in Lens',cloud:'Open in Cloud',xray:'Inspect in X-Ray'}[id], `data-id="${id}"`, !s.companions[id]) + (!s.companions[id] ? `<span class="muted">${esc(id)} unavailable — install a compatible companion</span>` : '')).join(' ');
}
export function minimapHtml(s: HubState, p?: HubProject): string {
  if (!s.minimap) return `<h2>Git Minimap · hidden</h2>${button('setting','Show minimap','data-id="minimap" data-value="true"')}`;
  const rows = p ? minimapRows(p) : [];
  return `<section data-hub-minimap><h2>Git Minimap</h2><div class="actions">${button('setting',s.minimapExpanded ? 'Collapse' : 'Expand',`data-id="minimapExpanded" data-value="${!s.minimapExpanded}"`)}${button('setting','Hide minimap','data-id="minimap" data-value="false"')}</div>
    ${s.minimapExpanded ? `<div class="hub-minimap">${list(rows.map(r => `${button('revision', `${r.default ? '●' : '↳'} ${r.branch.startsWith('detached:') ? 'detached HEAD' : r.branch} ${r.current ? '· HEAD' : ''}`, `data-repository="${esc(r.repository)}"${r.head ? ` data-revision="${esc(r.head)}"` : ''}`)}<p>${esc(r.label)} · ${esc(r.head?.slice(0,12) ?? 'revision unknown')} · ${esc(r.relation)}${r.base ? ` · base ${esc(r.base.slice(0,12))}` : ''} · ${r.worktrees} worktrees · CI ${esc(r.ci)}${r.conflicts ? ` · ${r.conflicts} conflicts` : ''}</p><p>${r.mr.map(m => `#${m.number} ${esc(m.state)} (PR CI ${esc(m.ci)}, revision not attested)`).join(' · ')}${r.agents.length ? ` · agents ${r.agents.map(esc).join(', ')} (AGENT-REPORTED)` : ''}</p>`), 'Refresh local Git to observe refs/worktrees. No ancestry is inferred from branch names.')}</div>` : ''}</section>`;
}
function gitHtml(p: HubProject, s: HubState) {
  return p.repositories.map(r => {
    const g = r.git;
    return `<section class="hub-repo" data-hub-repository="${esc(r.key)}"><h3>${esc(r.label)}</h3><p class="hub-origin">GIT-OBSERVED · ${esc(g?.checkedAt ?? 'not observed')}</p>
    <p>${esc(g?.branch ?? (g?.detached ? 'detached HEAD' : 'branch unknown'))} · ${esc(g?.head?.slice(0,12) ?? 'revision unknown')} · upstream ${esc(g?.upstream ?? 'unknown')} ↑${esc(g?.ahead ?? '?')} ↓${esc(g?.behind ?? '?')}</p>
    <p>${g?.counts ? `${g.counts.staged} staged · ${g.counts.unstaged} unstaged · ${g.counts.untracked} untracked · ${g.counts.conflicted} conflicted${!Object.values(g.counts).some(Boolean) ? ' · clean' : ' · dirty'}` : 'Working tree UNKNOWN'} · ${g?.worktrees.length ?? '?'} worktrees</p>
    <p>Exact-HEAD CI <strong>${esc(r.ci?.status ?? 'UNKNOWN')}</strong> · ${esc(r.ci?.sha.slice(0,12))} <span class="hub-origin">CI-OBSERVED ${esc(r.ci?.observedAt)}</span></p><p>${esc(r.ci?.detail)}</p>
    ${list(g?.prs?.map(pr => `#${pr.number} ${esc(pr.title)} · ${esc(pr.head)} · ${pr.draft ? 'draft' : 'open'} · PR CI ${esc(pr.ci.state)} (revision not attested)`) ?? [], 'PR/MR evidence not observed; use Refresh Git + CI with the existing host CLI login.')}
    <h4>Changed artifact families</h4><p>${Object.entries(repositoryFamilies(r)).map(([k,n]) => `${esc(k)} ${n}`).join(' · ') || 'None observed'}</p>
    ${list(r.semantic.map(f => `${esc(f.path)} · ${esc(f.diff.status)} · ${esc(JSON.stringify(f.diff.changes ?? []).slice(0,1200))}`), 'No bounded semantic content comparison available.')}
    <h4>Impact</h4><p>${r.components.length ? r.components.map(esc).join(', ') + ' (declared components touching observed paths)' : 'Component impact UNKNOWN; no matched declared source association.'} ${r.semantic.length ? 'Semantic summaries describe source changes, not runtime execution.' : ''}</p>
    <h4>Recent changes</h4>${list(r.recent?.map(esc) ?? [], 'Not observed')}${list(r.gaps.map(esc), 'No reported observation gap.')}
    ${button('companion','Open in Lens',`data-id="lens" data-repository="${esc(r.key)}"`, !s.companions.lens)}</section>`;
  }).join('');
}
function cloudHtml(p: HubProject) {
  return `<h3>Environments</h3>${list((p.manifest?.environments ?? []).map(e => `<strong>${esc(e.label ?? e.title ?? e.id)}</strong> (${esc(e.id)}) · ${e.enabled === false ? 'disabled' : 'enabled'} · production ${e.production === true} · ephemeral ${e.ephemeral === true} · ${esc(e.classification ?? 'unclassified')} · owner ${esc(e.owner ?? 'unspecified')} · region policy ${esc(e.regionPolicy ?? 'unspecified')}<br>predecessors: ${(e.predecessors ?? []).map(esc).join(', ') || 'none'} → promotes to ${(e.promotesTo ?? []).map(esc).join(', ') || 'none'}`), 'No environment declared.')}
    <h3>Data zones (separate axis)</h3><p>${p.manifest?.hub?.dataZones?.map(z => `${esc(z.label)} (${esc(z.id)})`).join(' → ') || 'None declared'}</p>
    <h3>Repository → environment / provider targets</h3>${list(projectTargets(p).map(b => `<strong>${esc(b.repoRef)} → ${esc(b.environment)}</strong> · ${b.enabled ? 'enabled' : 'disabled'} <span class="hub-origin">DECLARED</span><br>${b.providerTargets.map(t => `${esc(t.label)} · cloud ${esc(t.cloudProvider)} · platform ${esc(t.platform)} · service ${esc(t.service ?? 'unspecified')} · region ${esc(t.region ?? 'unspecified')}`).join('<br>')}<br>Git host: ${esc(p.repositories.find(r => r.key === b.repoRef)?.git?.host?.label ?? 'unknown')} · strategy ${esc(b.branchStrategy ?? 'unspecified')} · deploy ${esc(b.deploymentMechanism ?? 'unspecified')} · source ${esc(b.sourceFolder ?? 'unspecified')} · components ${(b.components ?? []).map(esc).join(', ')}<br>Evidence: ${(b.evidence ?? []).map(esc).join(', ') || 'none'}`), 'No target bindings declared. Git host does not establish cloud runtime.')}`;
}
function workHtml(p: HubProject) {
  return `<div class="actions">${button('nextReady','Next READY WorkOrder')}${button('createOrder','Create WorkOrder')}${button('editDag','Edit selected WorkOrder DAG')}${button('qualify','Qualify selected WorkOrder')}</div>
    ${list(p.orders.map(o => `${button('order', o.id, `data-id="${esc(o.id)}"`)} <strong>${esc(o.status)}</strong> · ${esc(o.title)} · priority ${o.priority}<br>requires ${o.requires.map(esc).join(', ') || 'none'} · produces ${o.produces.map(esc).join(', ') || 'none'} · unblocks ${o.unblocks.map(esc).join(', ') || 'none'}<br>related ${o.related.map(esc).join(', ') || 'none'} · supersedes ${o.supersedes.map(esc).join(', ') || 'none'}<br>acceptance ${o.acceptance.map(esc).join('; ') || 'none'} · evidence ${o.evidence.map(esc).join('; ') || 'none'}${o.blockers.length ? `<p class="warn">${o.blockers.map(esc).join('; ')}</p>` : ''}`), 'No active WorkOrder declared.')}
    <h3>Agents</h3>${list(p.agents.map(a => `${esc(a.provider)} · ${esc(a.order)} · ${esc(a.repo)} · ${esc(a.branch ?? 'branch unknown')} / ${esc(a.worktree ? a.worktree + ' (GIT-OBSERVED)' : 'worktree unknown')} · ${esc(a.status)} <span class="hub-origin">${a.origin}</span><br>MR ${esc(a.mr ?? 'unknown')} · CI ${esc(a.ci ?? 'UNKNOWN')} (CI-OBSERVED only when exact HEAD exists) · evidence ${a.evidence.map(esc).join(', ') || 'none'}`), 'No agent launch recorded.')}`;
}
export function hubHtml(s: HubState, portfolio = false): string {
  const projects = scopeProjects(s.projects, s.scope);
  const p = projects.find(p => p.id === s.scope.project) ?? projects[0];
  const select = (field: 'company'|'program', entries: string[]) => `<label>${field}<select data-hub-scope="${field}"><option value="">All ${field === 'company' ? 'companies' : 'programs'}</option>${entries.map(id => `<option value="${esc(id)}"${s.scope[field] === id ? ' selected' : ''}>${esc(id)}</option>`).join('')}</select></label>`;
  const stats = hubSummary(projects);
  const tab = s.scope.tab ?? 'overview';
  let body = '';
  if (p) {
    if (tab === 'git') body = gitHtml(p,s) + minimapHtml(s,p);
    else if (tab === 'cloud') body = cloudHtml(p) + companionButtons(s);
    else if (tab === 'work') body = workHtml(p);
    else if (tab === 'evidence') body = `<h3>Evidence / qualification</h3><p>${esc(p.qualification)}</p>${list(p.orders.flatMap(o => o.evidence.map(e => `${esc(o.id)} · ${esc(e)} · ${o.qualified ? 'VERIFIED EVIDENCE (person, order digest)' : 'DECLARED / unqualified'}`)), 'No qualified WorkOrder evidence.')}<p class="hub-origin">Observed ${esc(s.observedAt ?? 'never')} · Git and CI describe observed revisions; agent assertions do not unlock dependencies.</p>${list(p.gaps.map(esc), 'No reported declaration gap.')}`;
    else if (['architecture','lineage','decisions'].includes(tab)) body = `<p>Open the existing ${esc(tab)} workspace for this project.</p>${button('deep', {architecture:'Open architecture',lineage:'Open lineage',decisions:'Open decisions'}[tab]!, `data-id="${tab}"`)}<p class="muted">Selecting another project opens its workspace before using its deep tools.</p>`;
    else body = `<h3>${esc(p.title)}</h3><p>${esc(p.company)} / ${esc(p.program)} · project ${esc(p.id)} · selected environment ${esc(p.selectedEnvironment ?? 'none')}</p><p>${p.repositories.length} repositories · ${p.orders.filter(o => !['DONE','SUPERSEDED'].includes(o.status)).length} open WorkOrders · ${new Set(p.agents.filter(a => a.status === 'running').map(a => a.order)).size} active agents · ${esc(p.readiness ?? 'Readiness not observed in this workspace')} · ${esc(p.qualification)}</p><p>Lineage coverage: ${p.coverage ? Object.entries(p.coverage).map(([k,n]) => `${n} ${esc(k)}`).join(' · ') : 'Not analyzed in this workspace'}</p>${cloudHtml(p)}
    <h3>Version BOM</h3>${list(projectBom(p).map(b => `${esc(b.id)} · version ${esc(b.version ?? 'unspecified')} · declared ${esc(b.declaredState)} · SHA ${esc(b.sha?.slice(0,12) ?? 'unspecified')} · observed ${esc(b.observation)} · CI ${esc(b.ci)}<br>Evidence ${(b.evidence ?? []).map(esc).join(', ') || 'none'}`), 'No program/project BOM declared.')}
    <h3>Releases</h3>${list((p.manifest?.hub?.releases ?? []).map(r => `${esc(r.label)} · ${esc(r.version ?? 'version unspecified')} · ${esc(r.sha?.slice(0,12) ?? 'SHA unspecified')} <span class="hub-origin">DECLARED</span>`), 'No release declared.')}${companionButtons(s)}`;
  }
  return `<section class="hub" data-enterprise-hub><h2>${portfolio ? 'Enterprise / Portfolio' : 'Project Hub'}</h2><div class="hub-controls">${select('company',s.companies)}${select('program',s.programs)}${button('portfolio','Portfolio')}${button('refresh','Refresh local Git')}${button('refreshCI','Refresh Git + CI')}${button('showInspector','Show Context Inspector')}${button('nextReady','Next READY WorkOrder')}</div>
    <div class="hub-stats">${Object.entries(stats).map(([label,n]) => `<div><strong>${n}</strong>${esc(label)}</div>`).join('')}</div>
    <h3>Projects</h3><div class="actions">${projects.map(p => button('project',`${p.title} · ${p.orders.some(o => o.status === 'RUNNING') ? 'ACTIVE' : p.orders.some(o => o.status === 'READY') ? 'READY' : 'UNKNOWN'}`,`data-id="${esc(p.id)}" aria-pressed="${s.scope.project === p.id}"`)).join('')}</div>
    ${p ? `<nav class="hub-tabs" aria-label="Project Hub">${['overview','architecture','lineage','work','git','cloud','evidence','decisions'].map(t => button('tab',t[0]!.toUpperCase()+t.slice(1),`data-id="${t}" aria-pressed="${tab === t}"`)).join('')}</nav><div data-hub-tab="${esc(tab)}">${body}</div>` : '<p>No project in this scope.</p>'}
    <h3>Next attention</h3>${list(s.attention.slice(0,30).map(a => `${esc(a.project)}${a.repo ? '/'+esc(a.repo) : ''}: ${esc(a.message)} <span class="hub-origin">${esc(a.origin)}</span>`), 'No observed attention item. Unobserved Git/CI remains UNKNOWN.')}${list(s.gaps.map(esc),'')}<p class="hub-origin">Observation ${esc(s.observedAt ?? 'not requested')} · projection of existing catalog / manifests / WorkOrders</p></section>`;
}
export function inspectorHtml(s: HubState) {
  const p = scopeProjects(s.projects,s.scope)[0];
  return `<section class="hub hub-inspector" data-hub-inspector><h3>Context</h3><p>${esc(p?.company ?? 'No company')} / ${esc(p?.title ?? 'No project')}</p><p>Component ${esc(s.selectedComponent ?? 'none')} · environment ${esc(p?.selectedEnvironment ?? 'none')}</p><h3>Evidence</h3><p>DECLARED · GIT-OBSERVED · CI-OBSERVED · AGENT-REPORTED are separate origins.</p><p>Freshness: ${esc(s.observedAt ?? 'not observed')}</p><p>${esc(p?.qualification ?? 'UNKNOWN')}</p><h3>Actions</h3><div class="actions">${companionButtons(s)}${button('createOrder','Create WorkOrder')}${button('hideInspector','Hide inspector')}</div>${minimapHtml(s,p)}</section>`;
}
