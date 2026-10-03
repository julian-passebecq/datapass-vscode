/**
 * V5 GITMR3: the navigation surface of cross-repository impact and Common pin drift. Wired by `crossRepo.surface.ts` (NAVWIRE1 generated registry):
 * adds the two catalog views (titles from `datapass.crossRepoImpact.labels`) and the command
 * `datapass.gitmr.pinDrift`, which checks every vendored Common manifest of the workspace against Common main in the
 * local Common clone (read-only git, no fetch) and writes the report to an output channel.
 */
import * as vscode from "vscode";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NavSurface } from "../../core/navigation/register";
import { CROSS_REPO_LABELS_SETTING, crossRepoLabels, withCrossRepoViews } from "../../core/gitmr/crossRepoImpact";
import { VENDOR_MANIFEST_PATH, classifyPins, formatPinDriftText, packageDirs, parseVendorManifest, readCommonFacts, resolveCommonMain, type Pin } from "../../core/gitmr/pinDrift";
import { gitRunner } from "../../work/session";

export const PIN_DRIFT_COMMAND = "datapass.gitmr.pinDrift";

/** Workspace folders and their direct sub-folders (a multi-repo workspace root holds its repos one level down). */
function candidateDirs(): string[] {
  const out: string[] = [];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    out.push(f.uri.fsPath);
    try { for (const d of readdirSync(f.uri.fsPath, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules") out.push(join(f.uri.fsPath, d.name)); } catch { /* unreadable */ }
  }
  return out;
}

function packageManifests(dir: string): { dir: string; json: string }[] {
  const root = join(dir, "packages");
  if (!existsSync(root)) return [];
  const out: { dir: string; json: string }[] = [];
  for (const d of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, d.name, "package.json");
    if (d.isDirectory() && existsSync(p)) { try { out.push({ dir: d.name, json: readFileSync(p, "utf8") }); } catch { /* unreadable */ } }
  }
  return out;
}

async function runPinDrift(channel: vscode.OutputChannel): Promise<void> {
  const dirs = candidateDirs();
  const consumers: { dir: string; pins: Pin[] }[] = [];
  for (const dir of dirs) {
    const file = join(dir, VENDOR_MANIFEST_PATH);
    if (!existsSync(file)) continue;
    try { consumers.push({ dir, pins: parseVendorManifest(JSON.parse(readFileSync(file, "utf8")), dir).pins }); } catch { channel.appendLine(`${dir}: ${VENDOR_MANIFEST_PATH} unreadable`); }
  }
  channel.clear(); channel.show(true);
  if (!consumers.length) { channel.appendLine(`No ${VENDOR_MANIFEST_PATH} in the workspace.`); return; }
  const names = [...new Set(consumers.flatMap(c => c.pins.map(p => p.name)))];
  const common = dirs.map(dir => ({ dir, map: packageDirs(packageManifests(dir), names) })).sort((a, b) => Object.keys(b.map).length - Object.keys(a.map).length)[0];
  if (!common || !Object.keys(common.map).length) { channel.appendLine("No local Common clone in the workspace: pin drift unknown (no remote call is made)."); return; }
  const main = await resolveCommonMain(gitRunner, common.dir, null);
  if (!main) { channel.appendLine(`${common.dir}: no main branch in the local Common clone.`); return; }
  for (const c of consumers) {
    const facts = await readCommonFacts(gitRunner, common.dir, main, c.pins, common.map);
    channel.appendLine(formatPinDriftText(classifyPins(c.pins, facts), vscode.workspace.asRelativePath(c.dir)));
  }
}

export const registerCrossRepoViews: NavSurface = (_context, host) => {
  const apply = () => host.nav.setCatalog(withCrossRepoViews(host.nav.catalog, crossRepoLabels(vscode.workspace.getConfiguration("datapass").get(CROSS_REPO_LABELS_SETTING))));
  apply();
  // The output channel is created on the first run of the command, not at activation.
  let channel: vscode.OutputChannel | undefined;
  return [
    { dispose: () => channel?.dispose() },
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(`datapass.${CROSS_REPO_LABELS_SETTING}`)) apply(); }),
    vscode.commands.registerCommand(PIN_DRIFT_COMMAND, () => runPinDrift(channel ??= vscode.window.createOutputChannel("DataPass pin drift")))
  ];
};
