/**
 * V1-PERF runner, loaded by VS Code as the extension tests (scripts/perf.ts). Reads the
 * activation's own timings, times a second refresh, then runs `git fetch` in every repository of
 * the fixture and counts the refreshes it triggers. Writes one JSON report; asserts nothing (the
 * budgets are checked by scripts/perf.ts).
 */
import * as fs from "node:fs";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import type { DataPassTestApi } from "../../src/extension";

const EXTENSION_ID = "julian-passebecq.datapass-vscode";
/** Longer than the 1.5 s debounce of the file watchers, so every refresh a fetch causes is counted. */
const SETTLE_MS = 6000;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function run(): Promise<void> {
  const reportFile = process.env.DATAPASS_PERF_REPORT!;
  const { clones } = JSON.parse(process.env.DATAPASS_PERF ?? "{}") as { clones: string[] };
  try {
    const ext = vscode.extensions.getExtension<DataPassTestApi | undefined>(EXTENSION_ID);
    if (!ext) throw new Error(`${EXTENSION_ID} not found`);
    const api = await ext.activate();
    if (!api) throw new Error("activate() returned no test API");
    await api.startup();
    const start = api.perf();
    const map = api.projectMap();
    const t = performance.now();
    await api.refresh();
    const warmRefreshMs = performance.now() - t;
    // Let the startup's own follow-ups (views resolving, Git view) settle before counting.
    await wait(SETTLE_MS);
    const before = api.perf();
    for (const clone of clones) execFileSync("git", ["fetch", "-q"], { cwd: clone, stdio: "ignore" });
    await wait(SETTLE_MS);
    const after = api.perf();
    fs.writeFileSync(reportFile, JSON.stringify({
      ok: true,
      loadMs: start.loadMs, activateMs: start.activateMs, firstRefreshMs: start.firstRefreshMs, fullRefreshMs: start.fullRefreshMs,
      sessionFirstPaintMs: start.sessionFirstPaintMs, sessionSettledMs: start.sessionSettledMs, sessionSteps: start.sessionSteps, warmRefreshMs,
      components: map?.components.length ?? 0, repositories: map?.repositories.length ?? 0,
      fetch: {
        repositories: clones.length,
        sessionRefreshes: after.sessionRefreshes - before.sessionRefreshes,
        sessionChanges: after.sessionChanges - before.sessionChanges,
        gitChanges: after.gitChanges - before.gitChanges
      }
    }, null, 2));
  } catch (error) {
    fs.writeFileSync(reportFile, JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }, null, 2));
  }
}
