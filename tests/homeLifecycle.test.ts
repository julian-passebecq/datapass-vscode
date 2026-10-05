import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { buildSync } from 'esbuild';

test('closing or replacing Home while its state is loading never accesses the retired webview', async () => {
  const compiled = buildSync({ entryPoints: ['src/views/home.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false }).outputFiles[0]!.text;
  const mod = new Module('home-lifecycle-fixture');
  const disposable = () => ({ dispose() {} });
  (mod as any).require = (name: string) => name === 'vscode' ? { workspace: { onDidChangeConfiguration: disposable } } : require(name);
  (mod as any)._compile(compiled, 'home-lifecycle-fixture.cjs');
  const HomeHost = (mod.exports as any).HomeHost;
  for (const replacement of [false, true]) {
    const host = new HomeHost({}, { onDidChange: disposable }, { onDidChange: disposable }, () => true);
    let complete!: (state: unknown) => void;
    host.state = () => new Promise(resolve => { complete = resolve; });
    let accesses = 0;
    const panel = { visible: true, get webview() { accesses++; throw new Error('retired webview accessed'); } };
    host.panels.set('home', panel);
    const loading = host.render('home');
    host.panels.delete('home');
    if (replacement) host.panels.set('home', { dispose() {} });
    complete({});
    await loading;
    assert.equal(accesses, 0);
    host.dispose();
  }
});
