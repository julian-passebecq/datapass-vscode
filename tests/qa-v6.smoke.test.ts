import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { _electron, type ElectronApplication, type Frame } from 'playwright-core';
import { prepare, USER_DATA_DIR, EXTENSIONS_DIR, vscodeExecutable } from '../scripts/qa/prepare';
import { runStep, withTimeout } from '../scripts/qa/ui-run';
import { listProcesses, processTree, waitForExit } from '../scripts/qa/processTree';
import { fixture, cleanup } from './fixtures/qa/ui/runRoot';
import { intelligenceFiles } from './fixtures/v6/projectIntelligence';
import type { UiStep } from '../src/qa/ui/journey';

const vsix = process.env.DATAPASS_QA_VSIX;
test('V6 installed UI: dark/light/narrow/reload, environment, lineage, guided path and Sankey stay local', { skip: vsix ? false : 'set DATAPASS_QA_VSIX to a qualified package', timeout: 600_000 }, async () => {
  const { base, root, auto } = fixture();
  const keep = path.join(process.cwd(), 'out', 'qa-v6');
  fs.mkdirSync(keep, { recursive: true });
  let app: ElectronApplication | undefined;
  const results: unknown[] = [];
  let hostErrors: string[] = [];
  try {
    const project = path.join(root, 'doc-pipeline');
    for (const [file, text] of Object.entries(intelligenceFiles)) { const target = path.join(project, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
    const configFile = path.join(auto, 'datapass-codex-tests.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.workspace.repositories = [];
    fs.writeFileSync(configFile, JSON.stringify(config));
    const code = await vscodeExecutable(process.env.VSCODE_EXECUTABLE);
    const prepared = await prepare({ auto, root, vsix: vsix!, code });
    assert.equal(prepared.code, 0, prepared.reasons.join('\n'));
    const workspaceFile = prepared.workspaceFiles[0]!;
    const workspace = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
    workspace.settings ??= {};
    Object.assign(workspace.settings, { 'datapass.experience.preset': 'advanced', 'chat.disableAIFeatures': true, 'git.autofetch': false, 'extensions.autoCheckUpdates': false });
    fs.writeFileSync(workspaceFile, JSON.stringify(workspace));
    const extensions = path.join(root, EXTENSIONS_DIR);
    const installed = fs.readdirSync(extensions).find(n => n.startsWith('julian-passebecq.datapass-vscode-'))!;
    const spyLog = path.join(keep, 'boundary.jsonl');
    fs.writeFileSync(spyLog, '');
    const env: NodeJS.ProcessEnv = { ...process.env, DATAPASS_QA_SPY_LOG: spyLog, DATAPASS_QA_EXT_ROOT: path.join(extensions, installed) };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: code, args: ['--user-data-dir', path.join(root, USER_DATA_DIR), '--extensions-dir', extensions,
      '--extensionDevelopmentPath=' + path.join(process.cwd(), 'qa/v5/harness/spy'), '--disable-workspace-trust', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', '--new-window', workspaceFile], env: env as Record<string, string>, timeout: 120_000 });
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.locator('.monaco-workbench').waitFor({ timeout: 120_000 });
    const step = async (s: UiStep) => { const result = await runStep({ app: app!, page: async () => page, journeyId: 'V6UI', outDir: keep, folder: project }, s); results.push({ step: s, ...result }); assert.equal(result.status, 'PASS', JSON.stringify({ step: s, result })); };
    const home = async (selector = '[data-project-intelligence]'): Promise<Frame> => {
      const end = Date.now() + 30_000;
      do { for (const f of page.frames()) if (await f.locator(selector).isVisible().catch(() => false)) return f; await page.waitForTimeout(200); } while (Date.now() < end);
      throw new Error('Project Home frame did not appear');
    };
    await step({ kind: 'run', label: 'DataPass: Open Home' });
    await step({ kind: 'expect', text: 'Offline intelligence', timeoutMs: 60_000 });
    await step({ kind: 'run', label: 'Preferences: Color Theme' });
    await step({ kind: 'quickPick', text: 'Dark Modern' });
    await step({ kind: 'run', label: 'DataPass: Open Home' });
    let frame = await home();
    await frame.locator('[data-environment="sandbox-west"]').click();
    frame = await home('[data-environment="sandbox-west"][aria-pressed="true"]');
    await step({ kind: 'expect', text: 'sandbox-fixture', timeoutMs: 30_000 });
    assert.equal(await frame.locator('[data-companion]').count(), 0);
    await step({ kind: 'screenshot', name: 'home-dark' });
    await step({ kind: 'run', label: 'Preferences: Color Theme' });
    await step({ kind: 'quickPick', text: 'Light Modern' });
    await step({ kind: 'run', label: 'DataPass: Open Home' });
    frame = await home();
    await frame.locator('[data-environment="client-live"]').click();
    await step({ kind: 'expect', text: 'live-fixture', timeoutMs: 30_000 });
    await step({ kind: 'screenshot', name: 'home-light' });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(800, 800); });
    await step({ kind: 'screenshot', name: 'home-narrow' });
    // Native buttons keep keyboard activation in a narrow Home.
    frame = await home();
    await frame.locator('[data-environment="sandbox-west"]').focus();
    await page.keyboard.press('Enter');
    await step({ kind: 'expect', text: 'sandbox-fixture', timeoutMs: 30_000 });
    await step({ kind: 'run', label: 'Developer: Reload Window' });
    await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
    await step({ kind: 'run', label: 'DataPass: Open Home' });
    frame = await home();
    frame = await home('[data-environment="sandbox-west"][aria-pressed="true"]');
    await step({ kind: 'expect', text: 'Not analyzed', timeoutMs: 30_000 });
    await frame.locator('[data-action="intelligence.analyze"]').click();
    await step({ kind: 'expect', text: 'Project Home and Navigator now share this graph', timeoutMs: 120_000 });
    await step({ kind: 'run', label: 'DataPass: Open Project Lineage' });
    await step({ kind: 'expect', text: 'End-to-end data lineage', timeoutMs: 30_000 });
    await step({ kind: 'screenshot', name: 'lineage' });
    await step({ kind: 'run', label: 'DataPass: Pick a Tour…' });
    await step({ kind: 'quickPick', text: 'Project overview' });
    for (let i = 0; i < 3; i++) await step({ kind: 'run', label: 'DataPass: Next Tour Step' });
    await step({ kind: 'screenshot', name: 'guided-path-last-step' });
    await step({ kind: 'run', label: 'DataPass: Open Project Sankey' });
    await step({ kind: 'expect', text: 'Repository → component Sankey', timeoutMs: 30_000 });
    await step({ kind: 'screenshot', name: 'sankey' });
    const events = fs.readFileSync(spyLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(events.some(e => e.kind === 'harness'), 'network spy must be active');
    assert.deepEqual(events.filter(e => e.kind === 'net'), [], 'DataPass core must not request a provider or account');
  } finally {
    const pid = app?.process().pid;
    const tree = pid ? processTree(pid, listProcesses()) : [];
    if (app) await withTimeout(app.close().catch(() => undefined), 30_000);
    await waitForExit(tree);
    // Keep extension-host errors for inspection after the isolated profile is removed.
    const logs = path.join(root, USER_DATA_DIR, 'logs');
    if (fs.existsSync(logs)) fs.cpSync(logs, path.join(keep, 'logs'), { recursive: true });
    const inspect = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (/exthost|renderer/i.test(entry.name) && entry.name.endsWith('.log')) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        hostErrors.push(...lines.filter((line, i) => /\[error\]/.test(line) && /datapass/i.test(line)
          || /rejected promise not handled/i.test(line) && lines.slice(i, i + 12).some(part => /datapass/i.test(part))));
      }
    } };
    if (fs.existsSync(logs)) inspect(logs);
    fs.writeFileSync(path.join(keep, 'report.json'), JSON.stringify({ vsix, results, hostErrors }, null, 2));
    assert.ok(path.resolve(base).startsWith(path.resolve(path.dirname(base)) + path.sep + 'datapass-qa-'));
    cleanup(base);
    assert.deepEqual(hostErrors, [], 'installed V6 must have zero attributed extension-host errors');
  }
});
