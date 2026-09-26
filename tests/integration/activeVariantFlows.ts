/**
 * 0.25 (package V-A) desktop flows, fixture v25-doc-pipeline (the public example as a Git
 * repository, Advanced mode): the status-bar item names the active variant and its coding state;
 * switching A → B → C moves the Project tree, the diagram/Details state and Copy Context for My AI;
 * the choice is remembered on this machine and nothing is written in the repository.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import { execFileSync } from "node:child_process";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const ONLY = ["v25-doc-pipeline"];
const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);

export function registerActiveVariantFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const ws = () => vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const status = () => execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ws(), encoding: "utf8" });
  const treeHas = async (suffix: string) => (await api().renderProjectTree()).some(x => x.id?.endsWith(suffix) && !x.id.startsWith("variants:"));

  test("0.25 selected variant: switch A → B → C from the status bar; tree, Details and Copy Context follow; nothing is written", async () => {
    await waitFor("the options file", () => api().project().options, 20_000);
    const before = status();
    await run("datapass.setSelectedVariant", "current");
    await waitFor("the selected-variant status item", () => api().selectedVariant.statusVisible());
    assert.match(api().selectedVariant.statusText(), /^\$\(versions\) Variant: Current architecture · preview$/);

    // A — direct script: the current architecture's script is in the tree.
    await run("datapass.setSelectedVariant", "a-direct");
    assert.match(api().selectedVariant.statusText(), /Variant: A — direct script · preview/);
    assert.ok(await treeHas("f:orchestration/direct/run.py"), "A's script is in the tree");

    // B — the status-bar switcher (the quick pick), the way a person does it.
    await withUi([{ pick: "B — Blob event + Function" }], () => run("datapass.switchVariant"));
    assert.match(api().selectedVariant.statusText(), /Variant: B — Blob event \+ Function · preview/);
    assert.equal(api().selectedVariant.remembered()?.scenario, "b-event", "remembered on this machine");
    const r = await api().renderProjectTree();
    assert.match(r.find(x => x.id === "variants:selected")?.label ?? "", /B — Blob event \+ Function/);
    assert.ok(!(await treeHas("f:orchestration/direct/run.py")), "A's script left the tree");
    // Details and the diagram: the orchestration component is B's Function.
    await api().select({ subproject: "pipeline", component: "orchestrate" });
    const wb = api().workbenchState();
    assert.match(wb.preview?.title ?? "", /B — Blob event/);
    assert.ok(wb.preview?.components.some(c => c.id === "orchestrate" && /Blob-triggered Function/.test(c.label)), "Details shows B's component");

    // Copy Context for My AI names variant B and its coding state.
    const file = vscode.Uri.file(path.join(ws(), "processing", "process.py"));
    const ui = await withUi([{ input: "" }, { button: "Copy" }], () => run("datapass.copyFileContext", file, [file]));
    assert.match(ui.clipboard, /Selected variant \(preview on this machine — not a decision, not a deployment\): \*\*B — Blob event \+ Function\*\* · files: some files present .*Live route: not observed by DataPass\./);
    assert.ok(!api().readiness().repositories.some(x => x.key === "factory"), "B: no factory row in Readiness");
    // V1-STAB: a file of B's Function is owned by B's component, not the current architecture's.
    const fn = vscode.Uri.file(path.join(ws(), "orchestration", "blob-function", "function_app.py"));
    const own = await withUi([{ input: "" }, { button: "Copy" }], () => run("datapass.copyFileContext", fn, [fn]));
    assert.match(own.clipboard, /Component: Blob-triggered Function \(`orchestrate`, function, azure-functions\)/);

    // C — not coded (planned repository).
    await run("datapass.setSelectedVariant", "c-adf");
    assert.match(api().selectedVariant.statusText(), /Variant: C — Data Factory · preview/);
    // V1-STAB: Readiness follows the variant — C brings its planned factory repository, B does not.
    assert.ok(api().readiness().repositories.some(x => x.key === "factory"), "C's planned repository is in Readiness");
    record("activeVariant.c", { status: api().selectedVariant.statusText() });

    await run("datapass.setSelectedVariant", "current");
    assert.equal(api().selectedVariant.remembered(), undefined, "back to current forgets the entry");
    assert.equal(status(), before, "no file written in the repository");
  }, ONLY);
}
