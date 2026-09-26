/**
 * V1-ON desktop flows (real VS Code, real Git, offline "GitHub on disk"): DataPass: Open a Client
 * Project… from an empty window clones the bridge and the missing repository, finds the one already
 * cloned under another name and address form, never clones the planned one, writes the company
 * workspace file and opens it; a second run clones nothing. Then the window it opens: 3 roots, and
 * Standard mode lands on the Architecture panel.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DataPassTestApi } from "../../src/extension";
import type { OpenClientProjectResult } from "../../src/work/openClientProject";
import { parseWorkspaceFile, workspaceFolderPaths } from "../../src/core/windows/company";
import { record, test, waitFor } from "./harness";
import { bindUi, withUi } from "./ui";

const env = () => JSON.parse(process.env.DATAPASS_IT_V26 ?? "{}") as { clients: string };
const real = (p: string) => fs.realpathSync.native(p).toLowerCase();
const originOf = (dir: string) => fs.readFileSync(path.join(dir, ".git", "config"), "utf8").match(/\[remote "origin"\][^[]*?url = (.+)/)?.[1]?.trim();

export function registerOpenClientProjectFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();

  test("V1-ON: one command clones the bridge and the missing repository, locates the existing clone, skips the planned one, writes and opens the company workspace", async () => {
    bindUi(api());
    const clients = env().clients;
    let result: OpenClientProjectResult | undefined;
    const ui = await withUi([
      { input: "https://github.com/acme/acme-bridge.git" },
      { open: [vscode.Uri.file(clients)] },
      { pick: "Pipeline" }
    ], async () => { result = await vscode.commands.executeCommand<OpenClientProjectResult>("datapass.openClientProject"); });
    assert.ok(result, `the command returned nothing; prompts: ${JSON.stringify(ui.prompts)}`);
    const pick = ui.prompts.find(p => p.kind === "pick");
    assert.deepEqual(pick?.options, ["Pipeline"], "only the missing, non-planned repository is offered");
    assert.equal(result.bridgeCloned, true);
    assert.deepEqual(result.cloned, ["pipeline"]);
    assert.deepEqual(result.present, ["lab"]);
    assert.deepEqual(result.planned, ["portal"]);
    assert.deepEqual(result.blocked, []);
    assert.equal(result.opened, true);
    assert.ok(!fs.existsSync(path.join(clients, "portal")), "a planned repository is never cloned");
    assert.ok(!fs.existsSync(path.join(clients, "lab")), "the existing clone (my-lab, SSH address) is not cloned again");
    assert.equal(originOf(path.join(clients, "acme-bridge")), "https://github.com/acme/acme-bridge.git");
    assert.equal(originOf(path.join(clients, "pipeline")), "https://dev.azure.com/acme-org/Data/_git/pipeline", "the clone keeps the host's address, not the local rewrite");

    const file = path.join(clients, "Acme.code-workspace");
    assert.equal(real(result.workspaceFile!), real(file));
    const parsed = parseWorkspaceFile(fs.readFileSync(file, "utf8"));
    assert.deepEqual(parsed.folders.map(f => f.path), ["acme-bridge", "my-lab", "pipeline"]);
    assert.equal(parsed.company, "Acme");
    assert.deepEqual(workspaceFolderPaths(file, parsed.folders).map(real), ["acme-bridge", "my-lab", "pipeline"].map(n => real(path.join(clients, n))));
    assert.deepEqual(ui.openedFolders.map(u => real(vscode.Uri.parse(u).fsPath)), [real(file)], "the company workspace is opened");
    record("openClientProject.first", { ...result, bridge: path.basename(result.bridge), workspaceFile: path.basename(file) });
  }, ["v26-open-client"]);

  test("V1-ON: a second run (SSH address of the bridge) finds everything present and clones nothing", async () => {
    bindUi(api());
    const clients = env().clients;
    const before = fs.readFileSync(path.join(clients, "Acme.code-workspace"), "utf8");
    let result: OpenClientProjectResult | undefined;
    const ui = await withUi([
      { input: "git@github.com:acme/acme-bridge.git" },
      { open: [vscode.Uri.file(clients)] }
    ], async () => { result = await vscode.commands.executeCommand<OpenClientProjectResult>("datapass.openClientProject"); });
    assert.ok(result);
    assert.equal(result.bridgeCloned, false);
    assert.deepEqual(result.cloned, []);
    assert.deepEqual([...result.present].sort(), ["lab", "pipeline"]);
    assert.equal(result.workspaceWritten, false, "the workspace file is unchanged");
    assert.equal(fs.readFileSync(path.join(clients, "Acme.code-workspace"), "utf8"), before);
    assert.ok(!ui.prompts.some(p => p.kind === "pick"), "nothing to tick");
    assert.ok(ui.notices.some(n => /all 2 repositories are present/i.test(n)), ui.notices.join(" / "));
    assert.deepEqual(fs.readdirSync(clients).sort(), ["Acme.code-workspace", "acme-bridge", "my-lab", "pipeline"]);
  }, ["v26-open-client"]);

  test("V1-ON: a clone failure stops with the host's own message and a Retry; nothing else is cloned", async () => {
    bindUi(api());
    let result: OpenClientProjectResult | undefined;
    const ui = await withUi([
      { input: "https://github.com/acme/does-not-exist.git" },
      { open: [vscode.Uri.file(env().clients)] },
      { dismiss: true }
    ], async () => { result = await vscode.commands.executeCommand<OpenClientProjectResult>("datapass.openClientProject"); }, { allowErrors: true });
    assert.equal(result, undefined);
    const failure = ui.prompts.find(p => p.kind === "message" && /Could not clone/.test(p.text ?? ""));
    assert.ok(failure, JSON.stringify(ui.prompts));
    assert.deepEqual(failure.options, ["Retry"]);
    assert.match(failure.text ?? "", /does-not-exist|not found|does not appear/i, "Git's own message is shown");
    assert.ok(!fs.existsSync(path.join(env().clients, "does-not-exist")), "no half-cloned folder is left behind");
  }, ["v26-open-client"]);

  test("V1-ON: the opened company workspace has the 3 roots and lands on the Architecture panel (Standard)", async () => {
    assert.ok(!process.env.DATAPASS_IT_V26_MISSING, process.env.DATAPASS_IT_V26_MISSING);
    await api().startup();
    await api().experience.ready();
    const roots = (vscode.workspace.workspaceFolders ?? []).map(f => path.basename(f.uri.fsPath));
    assert.deepEqual(roots, ["acme-bridge", "my-lab", "pipeline"]);
    assert.equal(api().experience.current().preset, "standard");
    assert.equal(await api().experience.landed(), true, "Standard lands on the architecture panel");
    await waitFor("the architecture panel is shown", () => api().windowInfo().panes.includes("architecture"));
    assert.equal(api().windowInfo().company, "Acme");
    record("openClientProject.window", { roots, panes: api().windowInfo().panes });
  }, ["v26-open-client-window"]);
}
