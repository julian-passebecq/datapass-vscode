/** Lazy Hub adapter. Catalogs/manifests/orders remain the durable declarations; Git/CI are observations. */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { knownProjects } from './workbenchCommands';
import { readProjectManifest } from '../core/projectManifest';
import { readProjectFile } from '../core/workspace/readFile';
import { parseStrictJson } from '../core/model/strictJson';
import { readLocalBindings, type WorkSession } from './session';
import type { GitObserver } from './gitObserver';
import { orderDigest, machineSetting, workOrdersEnabled, type WorkOrderService, type LoadedOrder } from './workOrders';
import { resolveProjectType, workOrdersVerdict } from '../core/workOrders/projectType';
import { workOrderDag, nextReadyWork, type DagInput } from '../core/workOrders/dag';
import { parseWorkOrder, parseOrderState, parseOrderDag, WORK_ORDERS_DIR, ORDER_ID_RE } from '../core/workOrders/format';
import { draftOf } from './workOrderCommands';
import { hubSummary, hubAttention, scopeProjects, type HubState, type HubProject, type HubScope, type HubRepository } from '../core/hub/projection';
import { coverageSummary } from '../core/project/intelligence';
import { gitHostOf } from '../core/project/gitHosts';
import { headCiArgs, exactHeadCi, unknownHeadCi } from '../core/hub/ci';
import { vetRelativePath } from '../core/exchange/pathSafety';
import { fileSemanticDiff } from '../core/hub/semanticDiff';
import { classifyPath } from '../core/hub/classify';
import { sameFolder } from '../core/gitmr/lensTargets';
import { Limiter } from '../core/git/run';
import { safeCompanionChoices, hubHandoff, type HubCompanion } from '../core/hub/routing';
import { minimapRows } from '../core/hub/projection';
import { isSha, isBranchName } from '../core/git/porcelain';
import { scrubSecrets } from '../core/exchange/aiContext';

const KEY = 'datapass.enterpriseHub';
export class EnterpriseHub implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>(); readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private projects: HubProject[] = []; private gaps: string[] = []; private definitions?: Promise<void>;
  private observedAt?: string; private refreshing?: Promise<void>;
  private generation = 0;
  private declarationKey = '';
  private inputs?: Promise<DagInput[]>;
  constructor(private readonly context: vscode.ExtensionContext, readonly session: WorkSession, readonly git: GitObserver, readonly orders: WorkOrderService) {
    this.declarationKey = this.currentDeclarationKey();
    this.subs.push(session.onDidChange(() => {
      // Probe/readiness progress must not discard an in-flight Git observation.
      const key = this.currentDeclarationKey();
      if (key !== this.declarationKey) {
        this.declarationKey = key; this.generation++; this.definitions = undefined; this.inputs = undefined;
        void vscode.commands.executeCommand('setContext', 'datapass.hub.inspectorHidden', !this.setting('inspector'));
      }
      this.emitter.fire();
    }), git.onDidChange(() => this.emitter.fire()), orders.onDidChange(() => { this.inputs = undefined; this.emitter.fire(); }), session.onDidChangeSelection(() => this.emitter.fire()), vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('datapass.hub') || e.affectsConfiguration('datapass.ai')) { this.inputs = undefined; this.emitter.fire(); }
      if (e.affectsConfiguration('datapass.hub.inspector')) void vscode.commands.executeCommand('setContext', 'datapass.hub.inspectorHidden', !this.setting('inspector'));
    }));
    // No filesystem scan, Git call, network read or timer at activation.
  }
  dispose(): void { this.subs.forEach(s => s.dispose()); this.emitter.dispose(); }
  private currentDeclarationKey(): string { return JSON.stringify([this.session.root?.toString(), this.session.project.manifest, this.session.project.manifestErrors]); }
  private key(name: string) { return `${KEY}:${this.session.root?.toString()}:${name}`; }
  scope(): HubScope { return this.context.workspaceState.get<HubScope>(this.key('scope')) ?? {}; }
  async select(scope: HubScope): Promise<void> {
    await this.load();
    if (scope.project && !this.projects.some(p => p.id === scope.project)) throw new Error('Unknown Hub project');
    if (scope.company && !this.projects.some(p => p.company === scope.company)) throw new Error('Unknown Hub company');
    if (scope.program && !this.projects.some(p => p.program === scope.program)) throw new Error('Unknown Hub program');
    if (scope.tab && !['overview', 'architecture', 'lineage', 'work', 'git', 'cloud', 'evidence', 'decisions'].includes(scope.tab)) throw new Error('Unknown Hub tab');
    if (scope.repository && !this.projects.find(p => p.id === scope.project)?.repositories.some(r => r.key === scope.repository)) throw new Error('Unknown Hub repository');
    if (scope.project && !scopeProjects(this.projects, scope).length) throw new Error('Project is outside selected company/program');
    await this.context.workspaceState.update(this.key('scope'), scope); this.emitter.fire();
  }
  setting(name: 'minimap' | 'inspector' | 'minimapExpanded'): boolean {
    return this.context.workspaceState.get<boolean>(this.key(name)) ?? vscode.workspace.getConfiguration('datapass.hub').get<boolean>(name, true);
  }
  async setSetting(name: 'minimap' | 'inspector' | 'minimapExpanded', value: boolean): Promise<void> {
    await this.context.workspaceState.update(this.key(name), value);
    if (name === 'inspector') await vscode.commands.executeCommand('setContext', 'datapass.hub.inspectorHidden', !value);
    this.emitter.fire();
  }
  private load(): Promise<void> { return this.definitions ??= this.loadDefinitions().catch(e => { this.gaps = [`Hub declarations unavailable: ${e instanceof Error ? e.message : 'read failed'}`]; }); }
  private async loadDefinitions(): Promise<void> {
    const generation = this.generation;
    const root = this.session.root; const known = await knownProjects(this.session, false); const gaps = [...known.errors];
    const declarations = [
      ...(root ? [{ id: this.session.project.manifest?.project.id, title: this.session.project.manifest?.project.title ?? 'Current project', folder: root.fsPath, company: undefined as string | undefined, program: undefined as string | undefined, manifest: undefined as string | undefined }] : []),
      ...known.entries.filter(e => e.localFolder).map(e => ({ id: e.id, title: e.title, folder: e.localFolder, company: e.organization, program: e.program, manifest: e.manifest })),
      ...known.recent.map(e => ({ id: undefined, title: e.title, folder: e.folder, company: undefined as string | undefined, program: undefined as string | undefined, manifest: undefined as string | undefined })),
      ...known.entries.filter(e => !e.localFolder).map(e => ({ id: e.id, title: e.title, folder: e.localFolder, company: e.organization, program: e.program, manifest: e.manifest }))
    ];
    const projects: HubProject[] = []; const seen = new Set<string>(); const previous = this.projects;
    for (const entry of declarations.slice(0, 50)) {
      if (entry.folder && seen.has(path.resolve(entry.folder).toLowerCase())) continue;
      if (entry.folder) seen.add(path.resolve(entry.folder).toLowerCase());
      const current = !!root && !!entry.folder && sameFolder(root.fsPath, entry.folder);
      const read = entry.folder ? current ? { manifest: this.session.project.manifest, errors: this.session.project.manifestErrors } : await readProjectManifest(vscode.Uri.file(entry.folder), entry.manifest) : undefined;
      const m = read?.manifest; const id = m?.project.id ?? entry.id ?? `unavailable:${projects.length}`;
      if (projects.some(p => p.id === id)) { if (entry.folder) gaps.push(`Duplicate project id ${id}; not merged across sources`); continue; }
      const catalog = known.entries.find(e => e.id === id);
      const old = previous.find(p => p.id === id && p.root === entry.folder);
      const bindings = entry.folder ? await readLocalBindings(vscode.Uri.file(entry.folder)) : {};
      const repositories: HubRepository[] = [{ key: '.', label: m?.project.title ?? entry.title, changedFiles: [], semantic: [], gaps: [], components: [] }, ...Object.entries(m?.repositories ?? {}).filter(([key, r]) => key !== '.' && r.path !== '.').map(([key, r]) => ({ key, label: r.label ?? key, changedFiles: [], semantic: [], gaps: [], components: [] }))];
      for (const r of repositories) { const prior = old?.repositories.find(p => p.key === r.key); if (prior) Object.assign(r, prior); }
      // Local bindings are read from the existing model; resolved paths stay in this host adapter.
      this.bindings.set(id, bindings);
      projects.push({ id, title: m?.project.title ?? entry.title, company: m?.hub?.company?.label ?? entry.company ?? catalog?.organization ?? 'Unassigned company', program: m?.hub?.program?.label ?? entry.program ?? catalog?.program ?? 'Unassigned program', root: entry.folder, manifest: m, repositories, orders: [], agents: [], gaps: !m ? [...(read?.errors ?? []), 'Project manifest unavailable; live state unknown'] : [], qualification: 'UNKNOWN',
        ...(current ? { coverage: coverageSummary(this.session.projectIntelligence()).analyzed ? coverageSummary(this.session.projectIntelligence()).counts : undefined, readiness: `${this.session.projectMap().summary.opsReady}/${this.session.projectMap().summary.opsTotal} operations locally ready`, selectedEnvironment: this.session.selectedEnvironment() } : {}) });
    }
    if (declarations.length > 50) gaps.push('Portfolio bounded to 50 declared/recent projects');
    if (generation === this.generation) { this.projects = projects; this.gaps = gaps; }
  }
  private bindings = new Map<string, Record<string, string>>();
  private folder(p: HubProject, r: HubRepository): string | undefined {
    if (!p.root) return undefined; if (r.key === '.') return p.root;
    const decl = p.manifest?.repositories?.[r.key]; const value = this.bindings.get(p.id)?.[r.key] ?? decl?.path;
    return value ? path.resolve(p.root, value) : undefined;
  }
  private async orderInputs(p: HubProject): Promise<DagInput[]> {
    const current = p.root && this.session.root && sameFolder(p.root, this.session.root.fsPath);
    if (current) return this.orders.list().flatMap((l: LoadedOrder) => l.order ? [{ order: l.order, state: l.stateProblem ? undefined : l.state, problem: l.stateProblem, resultStatus: l.result.state === 'valid' ? l.result.checked.result.status : undefined, policyAllowed: this.orders.verdict().allowed, digest: l.digestNow }] : []);
    if (!p.root) return [];
    const dir = vscode.Uri.joinPath(vscode.Uri.file(p.root), ...WORK_ORDERS_DIR.split('/')); let entries: [string, vscode.FileType][];
    try { entries = await vscode.workspace.fs.readDirectory(dir); } catch { return []; }
    const out: DagInput[] = [];
    for (const [id, kind] of entries.filter(([id, kind]) => ORDER_ID_RE.test(id) && kind === vscode.FileType.Directory).slice(0, 100)) {
      try { const orderRead = await readProjectFile(vscode.Uri.joinPath(dir, id, 'order.json'), 256 * 1024); if (orderRead.kind !== 'ok') continue;
        const order = parseWorkOrder(orderRead.bytes); const stateRead = await readProjectFile(vscode.Uri.joinPath(dir, id, 'state.json'), 256 * 1024);
        const state = stateRead.kind === 'ok' ? parseOrderState(stateRead.bytes, id) : undefined;
        const policy = workOrdersVerdict({ machineEnabled: workOrdersEnabled(), trusted: vscode.workspace.isTrusted, hasProject: !!p.manifest, type: resolveProjectType(p.manifest?.project.type, machineSetting('ai.projectTypes'), p.id).type, moduleSwitch: p.manifest?.modules?.workOrders });
        out.push({ order, state, problem: !state ? 'WorkOrder state unavailable' : undefined, digest: await orderDigest(vscode.Uri.joinPath(dir, id)), policyAllowed: policy.allowed });
      } catch { p.gaps.push(`WorkOrder ${id} cannot be read`); }
    }
    return out;
  }
  async state(): Promise<HubState> {
    await this.load(); const inputs = await (this.inputs ??= Promise.all(this.projects.map(p => this.orderInputs(p))).then(x => x.flat())); const rows = workOrderDag(inputs);
    for (const p of this.projects) {
      p.orders = rows.filter(r => r.project === p.id);
      p.agents = inputs.filter(i => i.order.project.id === p.id && i.state?.launches.length).flatMap(i => i.order.repositories.map(r => ({ provider: i.order.agent.tool, order: i.order.id, repo: r.ref === 'coordination' ? '.' : r.ref, branch: r.branch,
        status: i.resultStatus ?? (i.state?.status === 'launched' ? 'running' : i.state?.status ?? 'unknown'), origin: 'AGENT-REPORTED' as const,
        worktree: p.repositories.find(repo => repo.key === (r.ref === 'coordination' ? '.' : r.ref))?.git?.worktrees.find(w => w.branch === r.branch)?.name,
        mr: p.root && this.session.root && sameFolder(p.root, this.session.root.fsPath) ? this.orders.get(i.order.id)?.outputs.find(o => o.ref === r.ref)?.pr?.number : undefined,
        ci: p.repositories.find(repo => repo.key === (r.ref === 'coordination' ? '.' : r.ref))?.git?.branch === r.branch ? p.repositories.find(repo => repo.key === (r.ref === 'coordination' ? '.' : r.ref))?.ci?.status : 'UNKNOWN', evidence: i.order.dag?.evidence ?? [] })));
      p.qualification = p.orders.length && p.orders.every(o => o.qualified && ['QUALIFIED', 'DONE'].includes(o.status)) ? 'WorkOrders qualified (not deployment)' : 'UNKNOWN / open work';
      if (p.root && this.session.root && sameFolder(p.root, this.session.root.fsPath)) { p.selectedEnvironment = this.session.selectedEnvironment(); const coverage = coverageSummary(this.session.projectIntelligence()); p.coverage = coverage.analyzed ? coverage.counts : undefined; p.readiness = `${this.session.projectMap().summary.opsReady}/${this.session.projectMap().summary.opsTotal} operations locally ready`; }
    }
    const scope = this.scope(); const scoped = scopeProjects(this.projects, scope);
    const commands = await vscode.commands.getCommands(true);
    const selected = scoped[0];
    return { projects: this.projects, scope, companies: [...new Set(this.projects.map(p => p.company))], programs: [...new Set(this.projects.filter(p => !scope.company || p.company === scope.company).map(p => p.program))], summary: hubSummary(scoped), attention: hubAttention(scoped), minimap: this.setting('minimap'), inspector: this.setting('inspector'), minimapExpanded: this.setting('minimapExpanded'), observedAt: this.observedAt, gaps: this.gaps, companions: safeCompanionChoices(commands), selectedComponent: selected?.root && this.session.root && sameFolder(selected.root, this.session.root.fsPath) ? this.session.selection().component : undefined };
  }
  async refresh(online = false): Promise<void> {
    if (this.refreshing) return this.refreshing;
    return this.refreshing = this.doRefresh(online).finally(() => { this.refreshing = undefined; this.emitter.fire(); });
  }
  private async doRefresh(online: boolean): Promise<void> {
    this.definitions = undefined; this.inputs = undefined;
    await this.load(); if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before Git/CI observation');
    const limiter = new Limiter(4); const root = this.session.root?.toString(); const generation = this.generation;
    await Promise.all(scopeProjects(this.projects, this.scope()).flatMap(p => p.repositories.map(r => limiter.run(async () => {
      const folder = this.folder(p, r); const remote = p.manifest?.repositories?.[r.key]?.remote?.url;
      const git = await this.git.hubReport({ key: `hub:${p.id}:${r.key}`, label: r.label, folder, remoteUrl: remote }, online);
      if (root !== this.session.root?.toString() || generation !== this.generation) return; r.git = git; r.gaps = []; r.changedFiles = []; r.semantic = []; r.topology = [];
      r.ci = unknownHeadCi(git.head ?? '', online ? 'No supported host/login or HEAD' : 'CI not requested (offline local observation)');
      if (git.state !== 'ok' || !folder || !git.head) { r.gaps.push(git.detail ?? 'Repository not observed'); return; }
      const changed = await this.git.hubRead('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], folder);
      if (changed.ok) { const entries = changed.stdout.split('\0'); for (let i = 0; i < entries.length; i++) { const item = entries[i]!; if (item.length < 4) continue; const rel = item.slice(3); if (vetRelativePath(rel).ok) r.changedFiles.push(rel); if (/[RC]/.test(item.slice(0, 2))) i++; } }
      else r.gaps.push('Changed file list unavailable');
      if (r.changedFiles.length > 500) r.gaps.push('Changed file summary bounded to 500 entries'); r.changedFiles = r.changedFiles.slice(0, 500);
      const map = p.root && this.session.root && sameFolder(p.root, this.session.root.fsPath) ? this.session.projectMap() : undefined;
      r.components = map?.components.filter(c => c.repoKey === r.key && r.changedFiles.some(f => c.artifacts?.files.some(a => a.repoPath === f))).map(c => c.id) ?? [];
      for (const f of r.changedFiles.slice(0, 8)) {
        if (/^\.?env|credentials|secrets|profiles\.ya?ml|local\.settings|\.npmrc/i.test(path.basename(f))) { r.gaps.push(`${f}: credential/config contents excluded`); continue; }
        const before = await this.git.hubRead('git', ['show', `${git.head}:${f}`], folder);
        const tracked = before.ok ? true : await this.git.hubRead('git', ['ls-tree', '--name-only', git.head, '--', f], folder);
        if (!before.ok && (tracked === true || !tracked.ok || tracked.stdout.trim())) { r.gaps.push(`${f}: before side unavailable`); continue; }
        let after;
        try {
          const canonicalRoot = await fs.realpath(folder); const file = path.join(folder, f);
          if ((await fs.lstat(file)).isSymbolicLink()) { r.gaps.push(`${f}: linked source excluded`); continue; }
          const canonical = await fs.realpath(file); const rel = path.relative(canonicalRoot, canonical);
          if (rel.startsWith('..') || path.isAbsolute(rel) || canonical.toLowerCase() !== path.resolve(file).toLowerCase()) { r.gaps.push(`${f}: linked/outside source excluded`); continue; }
          after = await readProjectFile(vscode.Uri.file(file), 128 * 1024);
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { r.gaps.push(`${f}: source read unavailable`); continue; } }
        if (before.stdout.length > 128 * 1024) { r.gaps.push(`${f}: semantic diff byte limit`); continue; }
        if (after?.kind === 'error') { r.gaps.push(`${f}: unreadable after side`); continue; }
        try { r.semantic.push({ path: f, diff: fileSemanticDiff(f, classifyPath(f), before.ok ? scrubSecrets(before.stdout) : null, after?.kind === 'ok' ? scrubSecrets(new TextDecoder('utf-8', { fatal: true }).decode(after.bytes)) : null) }); }
        catch { r.gaps.push(`${f}: semantic parse unavailable`); }
      }
      if (r.changedFiles.length > 8) r.gaps.push('Semantic content comparison bounded to first 8 changed files');
      const host = gitHostOf(remote ?? (git.host?.web)); const query = host && headCiArgs(host, git.head);
      if (online && host && query) { const res = await this.git.hubRead(query.tool, query.args, folder); try { r.ci = res.ok ? exactHeadCi(host.kind, git.head, parseStrictJson(res.stdout, { maxBytes: 2 * 1024 * 1024 }), new Date().toISOString()) : unknownHeadCi(git.head, 'CI host read unavailable; configure existing host CLI login'); } catch { r.ci = unknownHeadCi(git.head, 'Invalid/bounded CI response'); } }
      const log = await this.git.hubRead('git', ['log', '-5', '--format=%h %s'], folder); r.recent = log.ok ? log.stdout.split(/\r?\n/).filter(Boolean).map(s => s.slice(0, 240)) : [];
      const defaultRef = git.defaultBranch && isBranchName(git.defaultBranch) ? await this.git.hubRead('git', ['rev-parse', '--verify', `refs/heads/${git.defaultBranch}`], folder) : undefined;
      const defaultSha = defaultRef?.ok && isSha(defaultRef.stdout.trim()) ? defaultRef.stdout.trim() : undefined;
      for (const row of minimapRows(p).filter(row => row.repository === r.key)) {
        let head = row.head;
        if (!head && isBranchName(row.branch)) { const ref = await this.git.hubRead('git', ['rev-parse', '--verify', `refs/heads/${row.branch}`], folder); if (ref.ok && isSha(ref.stdout.trim())) head = ref.stdout.trim(); }
        const base = head && defaultSha ? await this.git.hubRead('git', ['merge-base', defaultSha, head], folder) : undefined;
        const baseSha = base?.ok && isSha(base.stdout.trim()) ? base.stdout.trim() : undefined;
        r.topology.push({ branch: row.branch, head, base: baseSha, relation: row.default ? 'default' : !baseSha ? 'unknown' : head === defaultSha ? 'same' : baseSha === defaultSha ? 'ahead' : baseSha === head ? 'behind' : 'diverged' });
      }
      const final = await this.git.hubRead('git', ['rev-parse', '--verify', 'HEAD'], folder, true);
      if (!final.ok || final.stdout.trim() !== git.head || generation !== this.generation) { r.ci = unknownHeadCi(git.head, 'Observation changed during refresh; refresh again'); r.gaps.push('Observation may be stale'); }
    }))));
    this.observedAt = new Date().toISOString();
  }
  async nextReady(): Promise<void> { const state = await this.state(); const next = nextReadyWork(state.projects.flatMap(p => p.orders), { project: state.scope.project, subproject: this.session.selection().subproject });
    if (!next) { void vscode.window.showInformationMessage('No READY WorkOrder in this scope; dependencies and policy remain enforced.'); return; }
    const p = state.projects.find(p => p.id === next.project);
    if (!p?.root || !this.session.root || !sameFolder(p.root, this.session.root.fsPath)) { if (p?.root) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(p.root), { forceNewWindow: true }); return; }
    await this.orders.select(next.id); await vscode.commands.executeCommand('datapass.workOrders.show', next.id);
  }
  async handle(m: Record<string, unknown>): Promise<void> {
    if (typeof m.action !== 'string') throw new Error('Unknown Hub action');
    const id = typeof m.id === 'string' && m.id.length <= 160 ? m.id : undefined;
    const scope = this.scope();
    if (m.action === 'scope') {
      if (m.field === 'company') return this.select({ company: id || undefined, tab: scope.tab });
      if (m.field === 'program') return this.select({ company: scope.company, program: id || undefined, tab: scope.tab });
      throw new Error('Unknown Hub scope');
    }
    if (m.action === 'project' && id) { await this.select({ ...scope, project: id, repository: undefined }); await vscode.commands.executeCommand('datapass.openHome'); return; }
    if (m.action === 'tab' && id) return this.select({ ...scope, tab: id });
    if (m.action === 'portfolio') { await this.select({ company: scope.company, program: scope.program }); await vscode.commands.executeCommand('datapass.openPortfolio'); return; }
    if (m.action === 'refresh') return this.refresh();
    if (m.action === 'refreshCI') return this.refresh(true);
    if (m.action === 'setting' && ['minimap','inspector','minimapExpanded'].includes(id ?? '') && ['true','false'].includes(String(m.value))) return this.setSetting(id as 'minimap'|'inspector'|'minimapExpanded', m.value === 'true');
    if (m.action === 'showInspector') { await this.setSetting('inspector',true); await vscode.commands.executeCommand('datapass.hubInspector.focus'); return; }
    if (m.action === 'hideInspector') return this.setSetting('inspector',false);
    if (m.action === 'nextReady') return this.nextReady();
    const state = await this.state(); const project = scopeProjects(state.projects,state.scope)[0];
    if (m.action === 'companion' || m.action === 'revision') {
      const key = m.action === 'revision' ? 'lens' : id;
      if (!['lens','cloud','xray'].includes(key ?? '')) throw new Error('Unknown Hub companion');
      const command = state.companions[key as HubCompanion];
      if (!command) { void vscode.window.showInformationMessage(`${key} unavailable. Install a compatible companion; the observed summary remains available.`); return; }
      const repository = typeof m.repository === 'string' ? m.repository : undefined;
      if (repository && !project?.repositories.some(r => r.key === repository)) throw new Error('Unknown repository');
      const payload = hubHandoff(state, repository, typeof m.revision === 'string' ? m.revision : undefined);
      if (!payload.project) throw new Error('Select a project first');
      await vscode.commands.executeCommand(command,payload); return;
    }
    const current = project?.root && this.session.root && sameFolder(project.root,this.session.root.fsPath);
    if (['deep','order','createOrder','editDag','qualify'].includes(m.action) && !current) {
      if (project?.root) await vscode.commands.executeCommand('vscode.openFolder',vscode.Uri.file(project.root),{forceNewWindow:true});
      else void vscode.window.showInformationMessage('Bind/open this project locally to use its deep tools.');
      return;
    }
    if (m.action === 'deep' && id) {
      const commands: Record<string,string> = { architecture:'datapass.openWorkbench',lineage:'datapass.intelligence.lineage',decisions:'datapass.openOptions' };
      if (!commands[id]) throw new Error('Unknown deep route');
      await vscode.commands.executeCommand(commands[id]); return;
    }
    if (m.action === 'order' && id && project?.orders.some(o => o.id === id)) { await this.orders.select(id); await vscode.commands.executeCommand('datapass.workOrders.show',id); return; }
    if (m.action === 'createOrder') { await vscode.commands.executeCommand('datapass.workOrders.new'); return; }
    if (m.action === 'editDag' || m.action === 'qualify') {
      const policy = this.orders.verdict(); if (!policy.allowed) throw new Error(policy.why);
      const order = this.orders.selected(); if (!order?.order) throw new Error('Select a WorkOrder first');
      if (m.action === 'editDag') {
        const text = await vscode.window.showInputBox({title:'WorkOrder DAG revision',value:JSON.stringify(order.order.dag ?? {}),prompt:'requires / produces / unblocks / related / supersedes / acceptance / evidence / priority; creates a reviewed revision',validateInput:raw=>{try{parseOrderDag(parseStrictJson(raw,{maxBytes:16*1024}));return undefined;}catch(e){return e instanceof Error ? e.message : 'Invalid DAG';}}});
        if (!text) return;
        const draft = draftOf(order.order,this.session); draft.dag=parseOrderDag(parseStrictJson(text,{maxBytes:16*1024})); draft.revises=order.id;
        await vscode.commands.executeCommand('datapass.workOrders.new',draft); return;
      }
      const acceptance = order.order.dag?.acceptance ?? [];
      if (!acceptance.length) throw new Error('Declare DAG acceptance criteria before qualification');
      const blockers = project?.orders.find(o => o.id === order.id)?.blockers ?? [];
      if (blockers.length) throw new Error(`Resolve qualification blockers: ${blockers.join('; ')}`);
      const picked = await vscode.window.showQuickPick(acceptance.map(label => ({label})),{canPickMany:true,title:'Person qualification: select every criterion you verified'});
      if (!picked || picked.length !== acceptance.length) return;
      const evidence = await vscode.window.showInputBox({title:'Verified evidence references (one per semicolon)',prompt:'Record reviewed evidence; an agent assertion alone is insufficient',validateInput:v => {
        const refs = v.split(';').map(s => s.trim()).filter(Boolean);
        return !refs.length || refs.length > 50 || v.length > 2000 || refs.some(r => r.length > 500) || scrubSecrets(v) !== v ? 'Provide up to 50 non-secret references, at most 500 characters each (2000 total)' : undefined;
      }});
      if (!evidence) return;
      const digest = await orderDigest(order.folder);
      await this.orders.updateState(order.id,async s => {
        const actual = await readProjectFile(vscode.Uri.joinPath(order.folder,'order.json'),256*1024);
        if (actual.kind !== 'ok' || JSON.stringify(parseWorkOrder(actual.bytes)) !== JSON.stringify(order.order) || await orderDigest(order.folder) !== digest) throw new Error('WorkOrder changed during qualification; review it again');
        return { ...s, qualification:{at:new Date().toISOString(),digest,acceptance,evidence:evidence.split(';').map(s => s.trim()).filter(Boolean),by:'person'} };
      }); this.inputs = undefined; this.emitter.fire(); return;
    }
    throw new Error('Unknown Hub action');
  }
}
