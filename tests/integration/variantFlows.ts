/**
 * 0.23 variants (package G) desktop flows, fixture v3-research (Advanced mode): the Project tree
 * shows the selected architecture; *All variants* lists every option's components and files tagged
 * with the option and its coding state; previewing a scenario changes the filtered tree; nothing is
 * written in any repository.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import type { DataPassTestApi } from "../../src/extension";
import { record, test } from "./harness";

const ONLY = ["v3-research"];
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const SCRIPT_FILE = "scripts/extract/extract.py";

export function registerVariantFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const hub = () => vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const status = (dir: string) => execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
  const rows = () => api().renderProjectTree();

  test("0.23 variants: the tree shows the selected architecture; All variants lists the others tagged; a preview changes the list; nothing is written", async () => {
    const pipeline = path.join(path.dirname(hub()), "research-pipeline");
    const before = { hub: status(hub()), pipeline: status(pipeline) };
    await api().setPreview(undefined);
    await run("datapass.showSelectedArchitecture");

    // Current architecture: the script option's files are not in the tree.
    let r = await rows();
    const selected = r.find(x => x.id === "variants:selected");
    assert.ok(selected, "the tree says which architecture it shows");
    assert.match(selected.label, /Selected architecture: current/);
    assert.ok(!r.some(x => x.id?.endsWith(`f:${SCRIPT_FILE}`) || x.id?.includes(`:${SCRIPT_FILE}`)), "another option's file is hidden by default");
    assert.ok(r.some(x => x.id?.endsWith("f:functions/extract/function_app.py")), "the current architecture's files are listed");

    // All variants: every option, its components and files, tagged with the option and its state.
    await run("datapass.showAllVariants");
    r = await rows();
    const option = r.find(x => x.id === "variants:o:processing=script");
    assert.ok(option, "the script option is listed");
    assert.match(option.description ?? "", /not coded/);
    const file = r.find(x => x.id === `variants:f:processing=script:extract:pipeline:${SCRIPT_FILE}`);
    assert.ok(file, `the script's entry file is listed: ${r.filter(x => x.id?.startsWith("variants:f:")).map(x => x.id).slice(0, 5).join(", ")}`);
    assert.match(file.description ?? "", /missing · One Python script, run by hand/);
    assert.match(r.find(x => x.id === "variants:o:staging=mongo-staging")?.description ?? "", /coded/, "a removal-only option is coded");
    assert.ok(r.some(x => x.id === "variants:r:staging=mongo-staging:cosmos"), "what it removes is listed");

    // Preview "lean" (the script): the filtered tree now holds the script's files.
    await run("datapass.showSelectedArchitecture");
    await api().setPreview({ scenario: "lean" });
    r = await rows();
    assert.match(r.find(x => x.id === "variants:selected")?.label ?? "", /Archi 3 — lean first batch/);
    assert.ok(r.some(x => x.id?.endsWith(`f:${SCRIPT_FILE}`) && !x.id.startsWith("variants:")), "the previewed architecture's files are in the tree");
    assert.ok(!r.some(x => x.id?.endsWith("f:functions/extract/function_app.py") && !x.id.startsWith("variants:")), "the replaced Function's files are not");
    record("variants.lean", { selected: r.find(x => x.id === "variants:selected")?.description });

    await api().setPreview(undefined);
    assert.equal(status(hub()), before.hub, "no file written in the bridge repository");
    assert.equal(status(pipeline), before.pipeline, "no file written in the native repository");
  }, ONLY);
}
