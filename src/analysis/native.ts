import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAnalyzerDispatcher, type AnalyzerPlugin, type DispatchHandle } from '@juliandatapass-group/analyzers';
import { digestsEqual, digestExactBytes, unwrap, type SourceAnchor } from '@juliandatapass-group/semantic-core';
import type { AnalysisRequest, AnalysisResult } from '@juliandatapass-group/analysis-protocol';
import type { WorkSession } from '../work/session';
import { selectedCapture, selectedRequest, sessionIdentity, editorOffsets, type SelectedCapture } from './capture';
import { collectDbtWorkspace, dbtSections, extractDbt } from './dbt';

/** Installed trusted host only; never obtain a module or executable from workspace settings. */
export interface NativeAnalysisBackend {
  readonly plugin: AnalyzerPlugin;
  readonly ruleCatalogDigest: AnalysisRequest['header']['ruleCatalogDigest'];
  acquire(root: string, relativePath: string, signal: AbortSignal): Promise<Uint8Array>;
  dispose(): Promise<void>;
}
const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** User-triggered selected-file analysis. Activation never scans, captures, or starts a parser. */
export class NativeAnalysisHost implements vscode.Disposable {
  private generation = 0;
  private handle?: DispatchHandle;
  private abort?: AbortController;
  private panel?: vscode.WebviewPanel;
  private current?: { uri: vscode.Uri; capture: SelectedCapture; result: AnalysisResult };
  private selectedUri?: string;
  private identityKey: string;
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('datapass.understanding');
  private readonly subscriptions: vscode.Disposable[] = [];
  private dispatcher?: ReturnType<typeof createAnalyzerDispatcher>;
  private backend?: NativeAnalysisBackend;
  private backendRoot?: string;
  private cleanupFailed = false;
  private disposed = false;
  private retirement: Promise<void> = Promise.resolve();
  constructor(private readonly session: WorkSession, private readonly backendFactory?: (root: string) => Promise<NativeAnalysisBackend>) {
    this.identityKey = this.projectKey();
    this.subscriptions.push(
      session.onDidChange(() => { const key = this.projectKey(); if (key !== this.identityKey) { this.identityKey = key; this.invalidate('Project changed. Analyze the selected file again.'); this.dispatcher?.clearCache(); } }),
      vscode.workspace.onDidChangeTextDocument(e => { if (e.document.uri.toString() === this.selectedUri) this.invalidate('Source changed. Analyze the selected file again.'); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate('Workspace changed. Analyze the selected file again.'); this.dispatcher?.clearCache(); })
    );
  }
  private projectKey(): string { return `${this.session.root?.toString() ?? ''}:${this.session.project.manifest?.project.id ?? ''}`; }
  private invalidate(message?: string): void {
    this.generation++; this.abort?.abort(); this.abort = undefined;
    void this.handle?.cancel(); this.handle = undefined; this.current = undefined; this.diagnostics.clear();
    if (message && this.panel) this.show(message);
  }
  private retireBackend(): Promise<void> {
    const dispatcher = this.dispatcher; const backend = this.backend;
    // Detach before any await: a failed replacement must never revive a disposed instance.
    this.dispatcher = undefined; this.backend = undefined; this.backendRoot = undefined;
    if (!dispatcher && !backend) return this.retirement;
    this.retirement = this.retirement.then(async () => {
      await dispatcher?.dispose(); await backend?.dispose();
    }).catch(() => {
      this.cleanupFailed = true;
      console.error('[DataPass native analysis] Backend cleanup failed; analysis is disabled until the extension host reloads.');
      throw new Error('backend-cleanup-failed');
    });
    return this.retirement;
  }
  dispose(): void {
    this.disposed = true; this.invalidate();
    // retireBackend records the trusted diagnostic and closes future use before rejection.
    void this.retireBackend().catch(() => undefined);
    this.panel?.dispose(); this.diagnostics.dispose(); for (const s of this.subscriptions) s.dispose();
  }
  async analyzeSelection(selectedEditor: vscode.TextEditor | null = vscode.window.activeTextEditor ?? null): Promise<void> {
    if (this.disposed) return;
    if (this.cleanupFailed) return this.show('Analysis disabled: backend cleanup failed. Reload the extension host before trying again.');
    const previous = this.handle;
    this.invalidate(); this.selectedUri = undefined;
    const generation = this.generation;
    await previous?.cancel();
    if (generation !== this.generation) return;
    const editor = selectedEditor;
    if (!vscode.workspace.isTrusted) return this.show('Analysis unavailable: trust this local workspace before analyzing selected source.');
    if (vscode.env.remoteName || !editor || editor.document.uri.scheme !== 'file') return this.show('Analysis unavailable: select a SQL file in a local workspace.');
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder || folder.uri.scheme !== 'file') return this.show('Analysis unavailable: the selected file must belong to a local workspace folder.');
    if (editor.document.languageId !== 'sql' && path.extname(editor.document.uri.fsPath).toLowerCase() !== '.sql') return this.show('Unsupported language. This candidate analyzes selected T-SQL files only.');
    if (!this.backendFactory) return this.show('Tool unavailable: the reviewed local SQL parser runtime is not installed or qualified for this extension host. No analysis was performed.');
    if (editor.document.isDirty) return this.show('Tool unsupported: this parser host currently accepts saved disk SQL only. Save the selected file before analyzing it; no analysis was performed.');
    const relative = path.relative(folder.uri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return this.show('Analysis unavailable: source is outside the selected workspace.');
    const identity = sessionIdentity(folder.uri.toString(), folder.uri.toString() === this.session.root?.toString() ? this.session.project.manifest?.project.id : undefined);
    const version = editor.document.version;
    this.selectedUri = editor.document.uri.toString();
    const abort = this.abort = new AbortController();
    const stillCurrent = () => !this.disposed && generation === this.generation && !abort.signal.aborted && editor.document.version === version && vscode.workspace.isTrusted;
    this.show('Analyzing selected T-SQL file… Source is parsed locally; SQL is not executed.');
    try {
      if (!this.backend || this.backendRoot !== folder.uri.fsPath) {
        await this.retireBackend();
        const backend = await this.backendFactory(folder.uri.fsPath);
        if (!stillCurrent()) { await backend.dispose(); return; }
        this.backend = backend; this.backendRoot = folder.uri.fsPath;
        this.dispatcher = createAnalyzerDispatcher([backend.plugin], { schedule(ms, callback) { const timer = setTimeout(callback, ms); return { cancel() { clearTimeout(timer); } }; } });
      }
      const backend = this.backend;
      // Even a dirty buffer requires host containment/reparse checks for its selected native path.
      const disk = await backend.acquire(folder.uri.fsPath, relative, abort.signal);
      if (!stillCurrent()) return;
      const capture = selectedCapture(identity, relative, editor.document.isDirty ? editor.document.getText() : disk);
      const input = selectedRequest(identity, capture, { pluginId: backend.plugin.id, version: backend.plugin.version, parserLockDigest: backend.plugin.parserLockDigest }, 'tsql', generation, backend.ruleCatalogDigest);
      const handle = this.handle = this.dispatcher!.dispatch(identity.id, input.request, input.captures);
      const outcome = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DataPass: Analyze selected SQL file', cancellable: true }, async (_progress, token) => {
        const cancellation = token.onCancellationRequested(() => this.invalidate('Analysis cancelled.'));
        try { return await handle.result; } finally { cancellation.dispose(); }
      });
      if (!stillCurrent()) return;
      if (outcome.status !== 'result') return this.show(`Analysis ${outcome.status}: ${outcome.code}. No result was accepted.`);
      if (outcome.response.kind !== 'result') return this.show(`Analysis unavailable: ${outcome.response.kind === 'error' ? outcome.response.code : 'nonterminal response'}.`);
      // Catch clean-file changes during parser execution without trusting editor refresh timing.
      if (capture.source === 'disk') {
        const fresh = await backend.acquire(folder.uri.fsPath, relative, abort.signal);
        if (!stillCurrent()) return;
        if (!digestsEqual(unwrap(digestExactBytes(fresh)), unwrap(digestExactBytes(capture.bytes)))) return this.invalidate('Source changed during analysis. Analyze the selected file again.');
      }
      this.current = { uri: editor.document.uri, capture, result: outcome.response };
      this.renderResult(editor.document);
    } catch (error) {
      if (stillCurrent()) this.show(this.cleanupFailed ? 'Analysis disabled: backend cleanup failed. Reload the extension host before trying again.' : error instanceof Error && error.message === 'host-runtime-unqualified'
        ? 'Tool unsupported: this extension-host runtime has not been qualified for the bundled parser. V3 explanations remain available. No analysis was performed.'
        : 'Analysis unavailable: source acquisition or the local parser failed its checks. No result was accepted.');
    }
  }
  private range(anchor: SourceAnchor, capture: SelectedCapture, doc: vscode.TextDocument): vscode.Range {
    const offsets = editorOffsets(anchor, capture, doc.getText());
    return new vscode.Range(doc.positionAt(offsets.start), doc.positionAt(offsets.end));
  }
  private renderResult(doc: vscode.TextDocument): void {
    const current = this.current; if (!current) return;
    const diagnostics: vscode.Diagnostic[] = [];
    for (const d of current.result.diagnostics) {
      if (!d.anchor) continue;
      try { const item = new vscode.Diagnostic(this.range(d.anchor, current.capture, doc), d.message, d.severity === 'error' ? vscode.DiagnosticSeverity.Error : d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information); item.source = 'DataPass'; item.code = d.code; diagnostics.push(item); } catch { /* A nonmatching editor never receives a source location. */ }
    }
    this.diagnostics.set(current.uri, diagnostics);
    this.show(`${current.result.entities.length} entities, ${current.result.claims.length} claims, ${current.result.edges.length} lineage edges. Static analysis only; no execution, approval, or rule evaluation is implied.`, current.result);
  }
  /** DBT3W: user-triggered static read of the workspace's dbt projects with their profiles.yml targets. dbt is never run. */
  async analyzeDbtProjects(): Promise<void> {
    if (this.disposed) return;
    this.invalidate();
    const generation = this.generation;
    if (!vscode.workspace.isTrusted) return this.show('Analysis unavailable: trust this local workspace before analyzing dbt projects.');
    const folder = (this.session.root && vscode.workspace.getWorkspaceFolder(this.session.root)) || vscode.workspace.workspaceFolders?.[0];
    if (vscode.env.remoteName || !folder || folder.uri.scheme !== 'file') return this.show('Analysis unavailable: open a local workspace folder.');
    const abort = this.abort = new AbortController();
    this.show('Reading dbt projects… Files are read statically; dbt is not run and no warehouse is contacted.');
    try {
      const files = await collectDbtWorkspace(folder.uri.fsPath, abort.signal);
      const result = await extractDbt(files, { cancelled: () => abort.signal.aborted });
      if (generation !== this.generation || this.disposed) return;
      if (!result) return this.show('No dbt project found: no dbt_project.yml in this workspace.');
      const { graph, gaps } = result.extraction;
      this.show(`${graph.nodes.length} nodes, ${graph.edges.length} lineage edges, ${gaps.length} coverage gaps. Static reading only; dbt was not run.`, undefined, dbtSections(result));
    } catch {
      if (generation === this.generation && !this.disposed) this.show('Analysis unavailable: the dbt projects could not be read. No result was accepted.');
    }
  }
  private show(message: string, result?: AnalysisResult, sections = ''): void {
    if (!this.panel) {
      const panel = this.panel = vscode.window.createWebviewPanel('datapass.nativeUnderstanding', 'DataPass: Native understanding', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: [] });
      panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.invalidate(); } });
      panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== 'object' || Object.keys(message).sort().join(',') !== 'index,type') return;
        const m = message as { type: unknown; index: unknown };
        if (m.type !== 'reveal' || !Number.isSafeInteger(m.index) || (m.index as number) < 0) return;
        const current = this.current; const generation = this.generation;
        const d = current?.result.diagnostics[m.index as number]; if (!current || !d?.anchor) return;
        const document = await vscode.workspace.openTextDocument(current.uri);
        if (generation !== this.generation) return;
        try { const range = this.range(d.anchor, current.capture, document); await vscode.window.showTextDocument(document, { selection: range, preserveFocus: true }); } catch { this.invalidate('Source no longer matches this result. Analyze the selected file again.'); }
      });
    }
    const names = new Map<string, string>();
    for (const c of result?.claims ?? []) {
      if (c.predicate === 'dataset.name' || c.predicate === 'field.identity') names.set(c.subjectId, c.value.name);
      else if (c.predicate === 'operation.kind') names.set(c.subjectId, c.value);
    }
    const name = (id: string) => names.get(id) ?? id;
    const gaps = result?.coverageGaps.slice(0, 200).map(g => `<li>${escape(g.reason)} — ${escape(g.nextAction)}</li>`).join('') ?? '';
    const diagnostics = result?.diagnostics.slice(0, 200).map((d, index) => `<li>${d.anchor ? `<button data-index="${index}">${escape(d.code)}</button>` : escape(d.code)}: ${escape(d.message)}</li>`).join('') ?? '';
    const claims = result?.claims.slice(0, 200).map(c => {
      const value = c.predicate === 'dataset.name' ? `${c.value.name} (${c.value.namespaceStatus})` : c.predicate === 'field.identity' ? `${name(c.value.datasetId)}.${c.value.name}` : c.predicate === 'operation.kind' ? c.value : `${name(c.value.fromId)} → ${name(c.value.toId)}`;
      return `<li><strong>${escape(value)}</strong> — ${escape(c.predicate)}, ${escape(c.method)}, confidence ${escape(c.confidence.level)}. ${escape(c.confidence.rationale)}</li>`;
    }).join('') ?? '';
    const edges = result?.edges.slice(0, 200).map(e => `<li>${escape(name(e.fromId))} → ${escape(name(e.toId))} — ${escape(e.granularity)}, ${escape(e.relation)}, ${escape(e.transform.kind)}</li>`).join('') ?? '';
    const nonce = randomBytes(18).toString('base64');
    this.panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px}button{color:var(--vscode-textLink-foreground);background:none;border:0;cursor:pointer}li{margin:8px 0}</style></head><body><h1>Native understanding</h1><p>${escape(message)}</p>${result ? `<h2>Coverage limits</h2><ul>${gaps || '<li>No additional coverage gaps reported. This is not a completeness guarantee.</li>'}</ul><h2>Diagnostics</h2><ul>${diagnostics || '<li>No diagnostics reported.</li>'}</ul><h2>Claims</h2><ul>${claims || '<li>No claims reported.</li>'}</ul><h2>Lineage links</h2><ul>${edges || '<li>No lineage links reported.</li>'}</ul><p>Each section displays at most 200 entries.</p>` : ''}${sections}<script nonce="${nonce}">const api=acquireVsCodeApi();document.addEventListener('click',e=>{const b=e.target.closest('button[data-index]');if(b)api.postMessage({type:'reveal',index:Number(b.dataset.index)})});</script></body></html>`;
  }
}

/** Bootstrap may settle the project and arrange views. Retain the explicit selection across it. */
export function selectedAnalysisCommand(host: NativeAnalysisHost, startup: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    const selected = vscode.window.activeTextEditor;
    await startup();
    await host.analyzeSelection(selected ?? null);
  };
}
