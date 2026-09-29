import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { buildSync } from 'esbuild';
import { createAnalysisSession } from '@juliandatapass-group/analysis-protocol';
import { digestExactBytes, digestJson, unwrap } from '@juliandatapass-group/semantic-core';

const compiled = buildSync({ entryPoints: ['src/analysis/native.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false }).outputFiles[0]!.text;
const disposable = () => ({ dispose() {} });
function harness() {
  let documentListener: (event: any) => void = () => {};
  let messageListener: (message: unknown) => Promise<void> = async () => {};
  const uri = { scheme: 'file', fsPath: 'C:\\fixture\\q.sql', toString: () => 'file:///C:/fixture/q.sql' };
  const folder = { uri: { scheme: 'file', fsPath: 'C:\\fixture', toString: () => 'file:///C:/fixture' } };
  const document = { uri, version: 1, isDirty: false, languageId: 'sql', getText: () => "SELECT '😀';\r\n", positionAt: (offset: number) => ({ offset }) };
  let html = ''; let diagnosticItems: any[] = []; let reveals = 0;
  const panel = { webview: { get html() { return html; }, set html(value: string) { html = value; }, onDidReceiveMessage(callback: any) { messageListener = callback; return disposable(); } }, onDidDispose: disposable, dispose() {} };
  const vscode = {
    env: {}, ViewColumn: { Beside: 2 }, ProgressLocation: { Notification: 15 }, DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    Diagnostic: class { source?: string; code?: string; constructor(public range: any, public message: string, public severity: number) {} },
    Range: class { constructor(public start: any, public end: any) {} },
    languages: { createDiagnosticCollection: () => ({ clear() { diagnosticItems = []; }, set(_uri: any, items: any[]) { diagnosticItems = items; }, dispose() {} }) },
    workspace: { isTrusted: true, getWorkspaceFolder: () => folder, onDidChangeTextDocument(callback: any) { documentListener = callback; return disposable(); }, onDidChangeWorkspaceFolders: disposable, async openTextDocument() { return document; } },
    window: { activeTextEditor: { document }, createWebviewPanel: () => panel, async showTextDocument() { reveals++; }, async withProgress(_options: any, callback: any) { return callback({}, { onCancellationRequested: disposable }); } }
  };
  const loaded = new Module('native-ui-test') as Module & { _compile(source: string, file: string): void };
  loaded.require = ((id: string) => id === 'vscode' ? vscode : require(id)) as any;
  loaded._compile(compiled, 'native-ui-test.cjs');
  return { Host: loaded.exports.NativeAnalysisHost, command: loaded.exports.selectedAnalysisCommand, vscode, document, folder, session: { project: {}, onDidChange: disposable },
    edit() { document.version++; documentListener({ document }); }, get html() { return html; }, get diagnostics() { return diagnosticItems; }, get reveals() { return reveals; }, message: (value: unknown) => messageListener(value) };
}
const digest = unwrap(digestJson({ testOnly: true }));
function backend() {
  let complete!: () => void; let started!: () => void; let cancelled = 0; let acquired = 0;
  const running = new Promise<void>(resolve => { started = resolve; });
  const value = {
    ruleCatalogDigest: digest,
    async acquire() { acquired++; return Buffer.from("\uFEFFSELECT '😀';\r\n"); }, async dispose() {},
    plugin: { id: 'ui-test-only', version: '1', parserLockDigest: digest, dialects: ['tsql'], start(request: any, captures: any) {
      const session = unwrap(createAnalysisSession(request, captures));
      const text = captures[0].text as string; const bytes = Buffer.from(text);
      let settle!: (value: unknown) => void;
      const response = new Promise(resolve => { settle = resolve; });
      complete = () => settle({ schema: 'datapass.analysis-wire/1', kind: 'result', requestId: request.requestId, generation: request.generation, requestDigest: session.requestDigest, header: request.header,
        entities: [], claims: [], edges: [], evidence: [], coverageGaps: [], notebookCells: [], embeddedSources: [],
        diagnostics: [{ code: 'test-diagnostic', severity: 'warning', analyzerId: 'ui-test-only', message: '<script>not markup</script>', anchor: { artifactId: captures[0].artifactId, integrityDigest: unwrap(digestExactBytes(bytes)), encoding: 'utf-8', span: { start: Buffer.byteLength(text.slice(0, text.indexOf('😀'))), end: Buffer.byteLength(text.slice(0, text.indexOf('😀'))) + 4 } } }] });
      started(); return { response, async cancel() { cancelled++; complete(); } };
    } }
  };
  return { value, running, complete: () => complete(), get cancelled() { return cancelled; }, get acquired() { return acquired; } };
}
test('P1 UI consumes accepted exact anchors, escapes parser messages and rejects arbitrary webview commands', async () => {
  const h = harness(); const b = backend(); const host = new h.Host(h.session, async () => b.value);
  const run = host.analyzeSelection(); await b.running; b.complete(); await run;
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.diagnostics[0].range.start.offset, h.document.getText().indexOf('😀'));
  assert.match(h.html, /&lt;script&gt;not markup&lt;\/script&gt;/);
  await h.message({ type: 'execute', command: 'anything' }); await h.message({ type: 'reveal', index: -1 }); assert.equal(h.reveals, 0);
  await h.message({ type: 'reveal', index: 0 }); assert.equal(h.reveals, 1);
  host.dispose();
});
test('P1 edits cancel in-flight work and reject late replies; dirty/untrusted inputs never acquire source', async () => {
  const h = harness(); const b = backend(); const host = new h.Host(h.session, async () => b.value);
  const run = host.analyzeSelection(); await b.running; h.edit(); b.complete(); await run;
  assert.equal(h.diagnostics.length, 0); assert.match(h.html, /Source changed/); assert.ok(b.cancelled > 0);
  const before = b.acquired; h.document.isDirty = true; await host.analyzeSelection(); assert.match(h.html, /saved disk SQL only/); assert.equal(b.acquired, before);
  h.vscode.workspace.isTrusted = false; await host.analyzeSelection(); assert.match(h.html, /trust this local workspace/); assert.equal(b.acquired, before);
  host.dispose();
});
test('P1 failed backend replacement cannot revive a disposed backend when returning to the original root', async () => {
  const h = harness(); const first = backend(); const retry = backend(); let factories = 0; let retired = 0;
  first.value.dispose = async () => { retired++; };
  const host = new h.Host(h.session, async () => { factories++; if (factories === 2) throw new Error('fixture factory failure'); return factories === 1 ? first.value : retry.value; });
  const initial = host.analyzeSelection(); await first.running; first.complete(); await initial;
  h.folder.uri.fsPath = 'C:\\replacement'; h.document.uri.fsPath = 'C:\\replacement\\q.sql'; await host.analyzeSelection();
  assert.equal(retired, 1); assert.match(h.html, /unavailable/);
  h.folder.uri.fsPath = 'C:\\fixture'; h.document.uri.fsPath = 'C:\\fixture\\q.sql';
  const repeated = host.analyzeSelection(); await retry.running; retry.complete(); await repeated;
  assert.equal(factories, 3); assert.equal(h.diagnostics.length, 1); host.dispose();
});
test('P1 first command waits for project bootstrap and retains the explicitly selected editor', async () => {
  const h = harness(); const b = backend(); let ready!: () => void; let factories = 0;
  const startup = new Promise<void>(resolve => { ready = resolve; });
  const host = new h.Host(h.session, async () => { factories++; return b.value; });
  const run = h.command(host, () => startup)();
  await Promise.resolve(); assert.equal(factories, 0);
  h.vscode.window.activeTextEditor = undefined as any; ready();
  await b.running; b.complete(); await run;
  assert.equal(factories, 1); assert.equal(h.diagnostics.length, 1); host.dispose();
});
