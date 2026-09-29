/** One installed-VSIX, no-bridge SQL journey; existing VS Code executable only, no download. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright-core';
import { cli } from './qa/prepare';

async function main(): Promise<void> {
  const [code, vsix, fixtureRoot, outputRoot] = process.argv.slice(2).map(p => resolve(p));
  if (!code || !vsix || !fixtureRoot || !outputRoot) throw new Error('Usage: qualify-native-ui <existing-code> <vsix> <qualified-no-bridge-fixture> <new-output-root>');
  const profile = join(outputRoot, 'profile'); const extensions = join(outputRoot, 'extensions');
  mkdirSync(join(profile, 'User'), { recursive: true }); mkdirSync(extensions, { recursive: true });
  writeFileSync(join(profile, 'User/settings.json'), JSON.stringify({ 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'workbench.startupEditor': 'none', 'datapass.experience.preset': 'advanced' }));
  cli(code, ['--user-data-dir', profile, '--extensions-dir', extensions, '--install-extension', vsix, '--force']);
  const installed = cli(code, ['--user-data-dir', profile, '--extensions-dir', extensions, '--list-extensions', '--show-versions']);
  if (!installed.includes('julian-passebecq.datapass-vscode@1.1.0-rc.1')) throw new Error('Candidate is not installed in isolated profile');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: code, args: ['--user-data-dir', profile, '--extensions-dir', extensions, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--new-window', fixtureRoot, join(fixtureRoot, 'join-filter.sql')], env, timeout: 120000 });
  let passed = false;
  try {
    const page = await app.firstWindow({ timeout: 60000 });
    await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60000 });
    await page.getByRole('tab', { name: /join-filter.sql/ }).first().click({ timeout: 30000 });
    await page.keyboard.press('Control+Shift+P');
    const input = page.locator('.quick-input-widget input.input'); await input.fill('>DataPass: Analyze Selected SQL File');
    const command = page.locator('.quick-input-widget:visible .monaco-list-row', { hasText: 'DataPass: Analyze Selected SQL File' }).first();
    await command.waitFor({ state: 'visible', timeout: 30000 }); await command.click();
    let content = '';
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const body = await frame.locator('body').innerText({ timeout: 1000 }).catch(() => '');
        if (body.includes('Native understanding')) { content = body; if (body.includes('Lineage links') || /unavailable|unsupported|disabled/i.test(body)) break; }
      }
      if (content.includes('Lineage links') || /unavailable|unsupported|disabled/i.test(content)) break; await page.waitForTimeout(250);
    }
    await page.screenshot({ path: join(outputRoot, 'native-sql.png') });
    if (!content.includes('14 entities, 27 claims, 14 lineage edges') || !content.includes('customers') || !content.includes('orders') || content.includes('tool-unavailable')) throw new Error(`SQL UI did not show the qualified result: ${content.slice(0, 500)}`);
    // A real unsupported construct produces an anchored diagnostic; exercise source navigation.
    await page.keyboard.press('Control+P'); await input.fill('star.sql');
    await page.locator('.quick-input-widget:visible .monaco-list-row', { hasText: 'star.sql' }).first().click();
    await page.getByRole('tab', { name: /star.sql/ }).first().click();
    await page.keyboard.press('Control+Shift+P'); await input.fill('>DataPass: Analyze Selected SQL File');
    await page.locator('.quick-input-widget:visible .monaco-list-row', { hasText: 'DataPass: Analyze Selected SQL File' }).first().click();
    let navigated = false; const navigationDeadline = Date.now() + 60000;
    while (Date.now() < navigationDeadline) {
      for (const frame of page.frames()) {
        const button = frame.locator('button[data-index]').first();
        if (await button.isVisible().catch(() => false)) { await button.click(); navigated = true; break; }
      }
      if (navigated) break; await page.waitForTimeout(250);
    }
    if (!navigated) throw new Error('No source-bound diagnostic was rendered for SELECT *');
    const selection = page.locator('[id="status.editor.selection"]');
    await selection.getByText(/selected/).waitFor({ timeout: 15000 });
    await page.screenshot({ path: join(outputRoot, 'diagnostic-source.png') });
    writeFileSync(join(outputRoot, 'report.json'), JSON.stringify({ schema: 'datapass.p1-installed-ui/1', outcome: 'pass', vsixSha256: createHash('sha256').update(readFileSync(vsix)).digest('hex'), installed: installed.trim(), checks: ['isolated-profile-installed-VSIX', 'no-bridge-selected-SQL', 'native-command', 'real-LPAC-parser', 'named-claims-and-lineage-view', 'real-diagnostic-source-click'], limitations: ['Trusted Windows context and existing VS Code build only', 'Saved disk SQL only', 'No DQ1 or dirty-buffer qualification'] }, null, 2) + '\n');
    passed = true;
  } finally {
    await app.close();
    if (!passed) writeFileSync(join(outputRoot, 'failed.json'), JSON.stringify({ outcome: 'failed', vsixSha256: createHash('sha256').update(readFileSync(vsix)).digest('hex') }));
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'UI qualification failed'); process.exitCode = 1; });
