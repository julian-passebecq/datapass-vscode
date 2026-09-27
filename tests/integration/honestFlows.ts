/**
 * V1-HONEST desktop flow, fixture v1-honest-doc-pipeline (the public doc-pipeline example, plus a
 * docs-only results folder declared planned, an empty localEnv, a pending id and tools scoped to the
 * cloud routes): a planned component is planned · partial in Details and Options, never ready; the
 * pending id and the cloud tools warn only when a cloud variant is selected; nothing is written.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";

const ONLY = ["v1-honest-doc-pipeline"];
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);

export function registerHonestFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const ws = () => vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const status = () => execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ws(), encoding: "utf8" });
  const serious = (pattern: RegExp) => api().readiness().checks.filter(c => c.severity !== "info" && pattern.test(`${c.id} ${c.message}`));

  test("V1-HONEST: planned adapters, route-scoped tools and pending ids are shown as incomplete, never ready", async () => {
    await waitFor("the options file", () => api().project().options, 20_000);
    const before = status();

    // F01: the docs-only results folder is planned · partial in Details, never "ready".
    await run("datapass.setSelectedVariant", "a-direct");
    await api().select({ subproject: "pipeline", component: "results" });
    const results = api().workbenchState().components.find(c => c.id === "results")!;
    assert.equal(results.health, "planned");
    assert.match(results.headline, /^planned · partial/);
    const pipeline = api().workbenchState().subprojects.find(s => s.id === "pipeline")!;
    assert.notEqual(pipeline.health, "ok", "a sub-project with a planned component is not green");
    // Options: the planned component is counted as planned.
    assert.ok((api().optionsAnalysis()?.current.support.planned ?? 0) >= 1, "Options count the planned component");

    // F04 + F08 on route A (local): the empty localEnv and the pending cloud id are valid; func/az never warn.
    assert.ok(api().project().manifest, "the v5 manifest with an empty localEnv, a pending id and route scopes loads");
    assert.deepEqual(api().workbenchState().problems.filter(p => /localEnv|identifiers|variants/.test(p.message)), []);
    const pendingA = api().readiness().identifiers.find(d => d.id === "function-app")!;
    assert.equal(pendingA.pending, true);
    assert.equal(pendingA.outOfRoute, true);
    assert.deepEqual(serious(/cli\.func|cli\.az|Function app name/), [], "route A is not blocked by cloud tools or ids");
    assert.equal(api().readiness().toolchain.summary.attention, api().readiness().toolchain.entries.filter(e => e.tool === "cli.git" && e.state === "missing").length);

    // Route B (Blob event + Function) needs them: the pending id now warns, and func/az are in route.
    await run("datapass.setSelectedVariant", "b-event");
    const r = api().readiness();
    assert.equal(r.identifiers.find(d => d.id === "function-app")?.outOfRoute, false);
    assert.equal(r.checks.find(c => c.id === "identifier.pending:function-app")?.severity, "warning");
    for (const tool of ["cli.func", "cli.az"]) assert.equal(r.toolchain.entries.find(e => e.tool === tool)?.outOfRoute, false, tool);
    record("honest.b", { checks: r.checks.filter(c => c.severity !== "info").map(c => c.id) });

    await run("datapass.setSelectedVariant", "current");
    assert.equal(status(), before, "no file written in the repository");
  }, ONLY);
}
