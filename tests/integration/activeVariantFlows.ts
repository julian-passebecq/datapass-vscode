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

  test("0.25 active variant: switch A → B → C from the status bar; tree, Details and Copy Context follow; nothing is written", async () => {
    await waitFor("the options file", () => api().project().options, 20_000);
    const before = status();
    await run("datapass.setActiveVariant", "current");
    await waitFor("the active-variant status item", () => api().activeVariant.statusVisible());
    assert.match(api().activeVariant.statusText(), /\$\(versions\) Current architecture · coded/);

    // A — direct script: the current architecture's script is in the tree.
    await run("datapass.setActiveVariant", "a-direct");
    assert.match(api().activeVariant.statusText(), /A — direct script · coded/);
    assert.ok(await treeHas("f:orchestration/direct/run.py"), "A's script is in the tree");

    // B — the status-bar switcher (the quick pick), the way a person does it.
    await withUi([{ pick: "B — Blob event + Function" }], () => run("datapass.switchVariant"));
    assert.match(api().activeVariant.statusText(), /B — Blob event \+ Function · partly coded/);
    assert.equal(api().activeVariant.remembered()?.scenario, "b-event", "remembered on this machine");
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
    assert.match(ui.clipboard, /Active variant \(this machine's working choice, not a decision\): \*\*B — Blob event \+ Function\*\* — coding state: partly coded/);

    // C — not coded (planned repository).
    await run("datapass.setActiveVariant", "c-adf");
    assert.match(api().activeVariant.statusText(), /C — Data Factory · not coded/);
    record("activeVariant.c", { status: api().activeVariant.statusText() });

    await run("datapass.setActiveVariant", "current");
    assert.equal(api().activeVariant.remembered(), undefined, "back to current forgets the entry");
    assert.equal(status(), before, "no file written in the repository");
  }, ONLY);
}
