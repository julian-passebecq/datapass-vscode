import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { _electron, type ElectronApplication, type Frame } from 'playwright-core';
import { prepare, USER_DATA_DIR, EXTENSIONS_DIR, vscodeExecutable } from '../scripts/qa/prepare';
import { runStep, withTimeout } from '../scripts/qa/ui-run';
import { listProcesses, processTree, waitForExit } from '../scripts/qa/processTree';
import { fixture, cleanup } from './fixtures/qa/ui/runRoot';
import { setupHubFixture } from './fixtures/v6/setupHub';
import type { UiStep } from '../src/qa/ui/journey';

const vsix = process.env.DATAPASS_QA_VSIX;
test('Hub installed UI: portfolio/project/Git/inspector, dark/light/narrow, hide/show and reload persistence', { skip: vsix ? false : 'set DATAPASS_QA_VSIX to a qualified package', timeout: 600_000 }, async () => {
  const { base, root, auto } = fixture();
  const vsixSha256 = createHash('sha256').update(fs.readFileSync(vsix!)).digest('hex');
  const keep = path.join(process.cwd(), 'out', 'qa-hub');
  fs.mkdirSync(keep, { recursive: true });
  let app: ElectronApplication | undefined;
  const results: unknown[] = [];
  let hostErrors: string[] = [];
  try {
    const project = path.join(root, 'doc-pipeline');
    const hubSetup=setupHubFixture(project,path.join(base,'hub-tools')); 
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
    // Presentation mode is a machine-scoped preference: use only this isolated profile.
    const userSettingsFile = path.join(root, USER_DATA_DIR, 'User', 'settings.json');
    const userSettings = fs.existsSync(userSettingsFile) ? JSON.parse(fs.readFileSync(userSettingsFile, 'utf8')) : {};
    Object.assign(userSettings, { 'datapass.git.ghPath':hubSetup.env.DATAPASS_IT_HUB_CI, 'datapass.experience.preset': 'advanced', 'chat.disableAIFeatures': true, 'git.autofetch': false, 'extensions.autoCheckUpdates': false });
    fs.mkdirSync(path.dirname(userSettingsFile), { recursive: true });
    fs.writeFileSync(userSettingsFile, JSON.stringify(userSettings));
    const extensions = path.join(root, EXTENSIONS_DIR);
    const installed = fs.readdirSync(extensions).find(n => n.startsWith('julian-passebecq.datapass-vscode-'))!;
    const spyLog = path.join(keep, 'boundary.jsonl');
    fs.writeFileSync(spyLog, '');
    const env: NodeJS.ProcessEnv = { ...process.env, ...hubSetup.env, DATAPASS_QA_SPY_LOG: spyLog, DATAPASS_QA_EXT_ROOT: path.join(extensions, installed) };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: code, args: ['--user-data-dir', path.join(root, USER_DATA_DIR), '--extensions-dir', extensions,
      '--extensionDevelopmentPath=' + path.join(process.cwd(), 'qa/v5/harness/spy'), '--disable-workspace-trust', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', '--new-window', workspaceFile], env: env as Record<string, string>, timeout: 120_000 });
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.locator('.monaco-workbench').waitFor({ timeout: 120_000 });
    const step = async (s: UiStep) => { const result = await runStep({ app: app!, page: async () => page, journeyId: 'V6UI', outDir: keep, folder: project }, s); results.push({ step: s, ...result }); assert.equal(result.status, 'PASS', JSON.stringify({ step: s, result })); };
    const home = async (selector = '[data-enterprise-hub]'): Promise<Frame> => {
      const end = Date.now() + 30_000;
      do { for (const f of page.frames()) if (await f.locator(selector).isVisible().catch(() => false)) return f; await page.waitForTimeout(200); } while (Date.now() < end);
      throw new Error('Project Home frame did not appear');
    };
    const graph = async (title: string): Promise<Frame> => {
      const end = Date.now() + 30_000;
      do { for (const f of page.frames()) {
        const ready = await f.locator('.nv-graph-node').first().isVisible().catch(() => false);
        if (ready && (await f.locator('body').innerText().catch(() => '')).includes(title)) return f;
      } await page.waitForTimeout(200); } while (Date.now() < end);
      throw new Error(`Graph nodes did not paint for ${title}`);
    };
    await step({kind:'run',label:'DataPass: Open Portfolio'});
    let frame=await home();
    assert.equal(await frame.locator('[data-hub-action="project"]').count(),2);
    await step({kind:'screenshot',name:'portfolio'});
    await frame.locator('[data-hub-action="project"][data-id="enterprise-hub"]').click();
    frame=await home('[data-hub-action="project"][data-id="enterprise-hub"][aria-pressed="true"]');
    await frame.locator('[data-hub-action="tab"][data-id="git"]').click();
    frame=await home('[data-hub-tab="git"]');
    await frame.locator('[data-hub-action="refreshCI"]').click();
    await step({kind:'expect',text:'Exact-HEAD CI',timeoutMs:60000});
    const end=Date.now()+180000;let texts:string[]=[];
    while(Date.now()<end){
      try {
        frame=await home('[data-hub-tab="git"]');
        texts=await Promise.all(['app','api','dbt'].map(id=>frame.locator(`[data-hub-repository="${id}"]`).innerText()));
        if(texts[0]!.includes('FAIL') && texts[1]!.includes('BLOCKED') && texts[2]!.includes('detached HEAD'))break;
      } catch(error) { if(!/detached/.test(String(error)))throw error; }
      await page.waitForTimeout(300);
    }
    assert.match(texts[0] ?? '',/FAIL/);assert.match(texts[1] ?? '',/BLOCKED/);assert.match(texts[2] ?? '',/detached HEAD/);
    await step({kind:'screenshot',name:'project-git'});
    await step({kind:'run',label:'DataPass: Show Context Inspector'});
    let inspector=await home('[data-hub-inspector]');
    assert.match(await inspector.locator('[data-hub-inspector]').innerText(),/CI-OBSERVED/);
    assert.ok(await inspector.locator('[data-hub-action="revision"]').count()>=3);
    await step({kind:'screenshot',name:'inspector-dark'});
    await inspector.locator('[data-hub-action="setting"][data-id="minimapExpanded"]').click();
    inspector=await home('[data-hub-action="setting"][data-id="minimapExpanded"][data-value="true"]');
    await step({kind:'run',label:'DataPass: Hide Context Inspector'});
    await step({kind:'run',label:'DataPass: Show Context Inspector'});
    inspector=await home('[data-hub-action="setting"][data-id="minimapExpanded"][data-value="true"]');
    await step({kind:'run',label:'Preferences: Color Theme'});await step({kind:'quickPick',text:'Light Modern'});
    await step({kind:'screenshot',name:'hub-light'});
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0]!.setSize(800,800);});
    frame=await home('[data-hub-tab="git"]');
    for(const f of [frame,await home('[data-hub-inspector]')]){const w=await f.evaluate(()=>({content:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));assert.ok(w.content<=w.viewport+1,JSON.stringify(w));}
    await step({kind:'screenshot',name:'hub-narrow'});
    await step({kind:'run',label:'Developer: Reload Window'});await page.locator('.monaco-workbench').waitFor({timeout:60000});
    await step({kind:'run',label:'DataPass: Open Home'});
    frame=await home('[data-hub-tab="git"]');assert.equal(await frame.locator('[data-hub-action="project"][data-id="enterprise-hub"][aria-pressed="true"]').count(),1);
    await step({kind:'run',label:'DataPass: Show Context Inspector'});
    inspector=await home('[data-hub-action="setting"][data-id="minimapExpanded"][data-value="true"]');
    await inspector.locator('[data-hub-action="setting"][data-id="minimapExpanded"]').focus();await page.keyboard.press('Enter');
    inspector=await home('[data-hub-action="setting"][data-id="minimapExpanded"][data-value="false"]');
    await inspector.locator('[data-hub-action="setting"][data-id="minimap"][data-value="false"]').click();
    inspector=await home('[data-hub-action="setting"][data-id="minimap"][data-value="true"]');
    await inspector.locator('[data-hub-action="setting"][data-id="minimap"][data-value="true"]').click();
    await step({kind:'screenshot',name:'hub-reloaded'});
    const events = fs.readFileSync(spyLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(events.some(e => e.kind === 'harness'), 'network spy must be active');
    assert.deepEqual(events.filter(e => e.kind === 'net'), [], 'DataPass core must not request a provider or account');
  } catch (error) {
    if (app) { const page = await app.firstWindow().catch(() => undefined); if (page) {
      await page.screenshot({ path: path.join(keep, 'failure.png') }).catch(() => undefined);
      const frames = await Promise.all(page.frames().map(f => f.locator('body').innerText({ timeout: 2000 }).catch(() => 'detached')));
      fs.writeFileSync(path.join(keep, 'failure-frames.json'), JSON.stringify(frames.map(text => text.slice(0, 12000)), null, 2));
    } }
    throw error;
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
    fs.writeFileSync(path.join(keep, 'report.json'), JSON.stringify({ vsix, vsixSha256, results, hostErrors }, null, 2));
    assert.ok(path.resolve(base).startsWith(path.resolve(path.dirname(base)) + path.sep + 'datapass-qa-'));
    cleanup(base);
    assert.deepEqual(hostErrors, [], 'installed V6 must have zero attributed extension-host errors');
  }
});
