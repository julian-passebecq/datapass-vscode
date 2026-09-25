/**
 * V3 desktop flows (real VS Code, real Git, offline): the Project tree, the Workbench tab and the
 * Architecture / Details views, opening component files, the preparation pack, and the "the AI
 * pushed a commit; get it" loop (check for updates → get updates → the missing file is found).
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import type { DataPassTestApi } from "../../src/extension";
import { record, sleep, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
const v3Env = () => JSON.parse(process.env.DATAPASS_IT_V3 ?? "{}") as { aiClone: string; labClone: string; wrongClone: string; pipelineClone: string };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=AI assistant", "-c", "user.email=ai@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

export function registerV3Flows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const extract = () => api().projectMap().components.find(c => c.id === "extract")!;
  const fileState = (p: string) => extract().artifacts!.files.find(f => f.path === p)?.state;

  // ------------------------------------------------------------ v3-research

  test("v3: the project folder, repositories and expected files are observed on disk", async () => {
    await run("datapass.refreshProject");
    const map = api().projectMap();
    assert.equal(map.project?.id, "research-library");
    const repos = Object.fromEntries(map.repositories.map(r => [r.key, `${r.state}${r.source ? `:${r.source}` : ""}`]));
    assert.deepEqual(repos, { ".": "local:coordination", pipeline: "local:sibling-folder", lab: "unbound", infra: "planned" }, JSON.stringify(repos));
    assert.equal(fileState("function_app.py"), "found");
    assert.equal(fileState("requirements.txt"), "missing");
    assert.equal(extract().artifacts!.availability, "incomplete");
    assert.equal(map.components.find(c => c.id === "lab-bundle")!.artifacts!.availability, "unbound");
    assert.deepEqual(map.problems.filter(p => p.severity === "error"), []);
    record("v3Map", { repositories: repos, extract: extract().artifacts!.files.map(f => `${f.path}: ${f.state}`), next: map.nextStep });
  }, ["v3-research"]);

  test("v3: the Project tree renders sub-projects, components, files and repositories (unique ids)", async () => {
    const rows = await api().renderProjectTree();
    const ids = rows.map(r => r.id).filter((id): id is string => !!id);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "duplicate tree ids");
    assert.ok(rows.some(r => r.id === "sp:papers" && /files/.test(r.description ?? "")), "papers sub-project");
    const fileRow = rows.find(r => r.id === "sp:papers/c:extract/f:functions/extract/requirements.txt");
    assert.ok(fileRow, "requirements.txt row");
    assert.match(fileRow!.description ?? "", /missing/);
    assert.equal(fileRow!.command, "datapass.explainMissingFile");
    assert.equal(rows.find(r => r.id === "sp:papers/c:extract/f:functions/extract/function_app.py")?.command, "datapass.openComponentFile");
    assert.match(rows.find(r => r.id === "repo:lab")?.contextValue ?? "", /^repo\.unbound/);
    record("v3ProjectTree", rows.filter(r => r.depth <= 1).map(r => `${"  ".repeat(r.depth)}${r.label}${r.description ? ` — ${r.description}` : ""}`));
  }, ["v3-research"]);

  test("v3: one selection drives the Workbench, the Architecture panel and the Details side bar", async () => {
    await api().select({ component: "extract" });
    assert.deepEqual(api().selection(), { subproject: "papers", component: "extract" });
    const state = api().workbenchState();
    assert.deepEqual(state.selection, { subproject: "papers", component: "extract" });
    assert.deepEqual(state.diagram.nodeIds.sort(), ["adf", "cosmos", "extract", "pdf-archive", "review", "study-db"]);
    assert.ok(!JSON.stringify(state).includes(os.homedir()), "no absolute path reaches the webviews");
    // The views resolve in real VS Code: editor tab, bottom panel, secondary side bar.
    await run("datapass.openWorkbench");
    await run("datapass.architecture.focus");
    await run("datapass.details.focus");
    await run("datapass.arrangeWorkbench");
    await sleep(800);
    assert.ok(vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.input instanceof vscode.TabInputWebview)), "the Workbench tab is open");
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("v3: a found file opens in the editor; a missing one is explained, never created", async () => {
    await run("datapass.openComponentFile", "extract", "functions/extract/function_app.py");
    const opened = await waitFor("function_app.py editor", () => vscode.window.activeTextEditor?.document.uri.path.endsWith("/functions/extract/function_app.py"));
    assert.ok(opened);
    const ui = await withUi([{ dismiss: true }], () => run("datapass.openComponentFile", "extract", "functions/extract/requirements.txt"));
    assert.ok(ui.prompts.some(p => p.kind === "message" && p.modal && /requirements\.txt/.test(p.text ?? "") && /never creates an empty placeholder/.test(p.text ?? "")), JSON.stringify(ui.prompts));
    assert.equal(fileState("requirements.txt"), "missing");
    // Paths leaving the component's declared files are refused.
    const bad = await withUi([], () => run("datapass.openComponentFile", "extract", "../../outside.txt"), { allowErrors: true });
    assert.ok(bad.errors.some(e => /not one of the files expected/.test(e)), bad.errors.join(" / "));
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("v3: the preparation pack names the repository, folder and missing file, without local paths", async () => {
    const ui = await withUi([{ button: "Copy" }], () => run("datapass.preparationPack", { componentId: "extract", question: "prepare-missing" }));
    const pack = ui.clipboard;
    assert.match(pack, /# DataPass preparation pack — Research library \/ Papers pipeline \/ PDF extraction/);
    assert.match(pack, /repository `pipeline` \(github\.com\/example-org\/research-pipeline\), folder `functions\/extract`/);
    assert.match(pack, /\[missing\] `requirements\.txt`/);
    assert.ok(!pack.includes(v3Env().pipelineClone) && !pack.includes(os.homedir()) && !pack.includes(os.userInfo().username + path.sep), "no local path or user name");
    assert.ok(api().workModel().exchanges.some(e => e.kind === "ai-context" && /prepare-missing/.test(e.label)));
    record("v3Pack", { bytes: Buffer.byteLength(pack), head: pack.split("\n").slice(0, 3) });
  }, ["v3-research"]);

  test("v3: the AI pushes a commit; Check for updates sees it, Get updates fast-forwards, the file is found", async () => {
    const { aiClone, pipelineClone } = v3Env();
    mkdirSync(path.join(aiClone, "functions", "extract"), { recursive: true });
    writeFileSync(path.join(aiClone, "functions", "extract", "requirements.txt"), "azure-functions\npymupdf\n");
    git(aiClone, "add", "-A");
    git(aiClone, "commit", "-q", "-m", "Add requirements.txt for the extraction function");
    git(aiClone, "push", "-q", "origin", "main");
    const before = git(pipelineClone, "rev-parse", "HEAD").trim();
    // Check: fetch only. Then choose "Get updates" and confirm the list of commits.
    const ui = await withUi([{ button: "Get updates" }, { button: "Get updates" }], () => run("datapass.checkForUpdates"));
    assert.ok(ui.prompts.some(p => /Document pipeline: 1 new commit/.test(p.text ?? "")), JSON.stringify(ui.prompts.map(p => p.text)));
    assert.ok(ui.prompts.some(p => p.modal && /Add requirements\.txt for the extraction function/.test(p.text ?? "") && /Fast-forward only/.test(p.text ?? "")), "the confirmation lists the incoming commit");
    const after = git(pipelineClone, "rev-parse", "HEAD").trim();
    assert.notEqual(after, before, "the clone moved forward");
    assert.equal(fileState("requirements.txt"), "found");
    assert.equal(api().projectMap().repositories.find(r => r.key === "pipeline")!.git?.behind ?? 0, 0);
    assert.ok(ui.notices.some(n => /now present: requirements\.txt \(PDF extraction\)/.test(n)), ui.notices.join(" / "));
    record("v3Update", { before: before.slice(0, 7), after: after.slice(0, 7), notices: ui.notices });
  }, ["v3-research"]);

  test("v3: Get updates refuses anything that is not a clean fast-forward", async () => {
    const { aiClone, pipelineClone } = v3Env();
    writeFileSync(path.join(aiClone, "functions", "extract", "host.json"), JSON.stringify({ version: "2.0", logging: {} }, null, 2) + "\n");
    git(aiClone, "commit", "-q", "-am", "Tune host.json");
    git(aiClone, "push", "-q", "origin", "main");
    // A local change to a tracked file: DataPass must not merge over it.
    writeFileSync(path.join(pipelineClone, "functions", "extract", "host.json"), JSON.stringify({ version: "2.0", local: true }, null, 2) + "\n");
    await api().select({ component: "extract" });
    const ui = await withUi([{ dismiss: true }], () => run("datapass.checkForUpdates", "pipeline"));
    void ui;
    const refuse = await withUi([{ dismiss: true }], () => run("datapass.getUpdates", "pipeline"));
    assert.ok(refuse.prompts.some(p => /local change\(s\) to tracked files/.test(p.text ?? "")), JSON.stringify(refuse.prompts.map(p => p.text)));
    assert.match(git(pipelineClone, "status", "--porcelain"), /host\.json/, "the local change is untouched");
    git(pipelineClone, "checkout", "--", "functions/extract/host.json");
  }, ["v3-research"]);

  test("v3: Locate accepts a clone of the declared repository and refuses another one", async () => {
    const { labClone, wrongClone } = v3Env();
    const wrong = await withUi([{ open: [vscode.Uri.file(wrongClone)] }], () => run("datapass.locateRepository", "lab"), { allowErrors: true });
    assert.ok(wrong.errors.some(e => /does not trust a folder name/.test(e)), wrong.errors.join(" / "));
    assert.equal(api().projectMap().repositories.find(r => r.key === "lab")!.state, "unbound");
    await withUi([{ open: [vscode.Uri.file(labClone)] }], () => run("datapass.locateRepository", "lab"));
    const lab = await waitFor("lab located", () => api().projectMap().repositories.find(r => r.key === "lab" && r.state === "local"));
    assert.equal(lab.source, "local-binding");
    const bundle = api().projectMap().components.find(c => c.id === "lab-bundle")!;
    assert.equal(bundle.artifacts!.files.find(f => f.path === "databricks.yml")!.state, "found");
    assert.equal(bundle.artifacts!.availability, "generation-needed", "the generated campaign is still missing");
  }, ["v3-research"]);

  test("v3: repositories and component folders open in a new window through the seam", async () => {
    const ui = await withUi([], async () => {
      await run("datapass.openRepositoryWindow", "pipeline");
      await run("datapass.openComponentFolder", "extract");
    });
    assert.equal(ui.openedFolders.length, 2);
    assert.ok(ui.openedFolders[0]!.endsWith("/research-pipeline"), ui.openedFolders[0]);
    assert.ok(ui.openedFolders[1]!.endsWith("/research-pipeline/functions/extract"), ui.openedFolders[1]);
  }, ["v3-research"]);

  test("v3: results are recorded per component operation and target", async () => {
    const op = extract().operations.find(o => o.capability.id === "python.tests.run")!;
    await withUi([{ pick: "Worked" }, { input: "pytest passed" }], () => run("datapass.recordComponentResult", op.key));
    const rec = api().qualification().find(q => q.operationKey === op.key);
    assert.equal(rec?.result, "worked");
    assert.equal(rec?.componentId, "extract");
    assert.equal(extract().operations.find(o => o.key === op.key)!.lastResult?.stale, false);
  }, ["v3-research"]);

  test("v3: component checklists are separate from scope checklists", async () => {
    const key = extract().checklist[0]!.key;
    await withUi([{ pick: "Done" }], () => run("datapass.setProjectChecklist", key));
    assert.equal(extract().checklist[0]!.state, "done");
    assert.equal(api().projectMap().subprojects.find(s => s.id === "papers")!.checklist[0]!.state, "todo");
  }, ["v3-research"]);

  // ------------------------------------------------------------ v3-monorepo (not FOIL)

  test("v3 monorepo: a Python → PostgreSQL/Neon project needs no Azure, Mongo or FOIL", async () => {
    await run("datapass.refreshProject");
    const map = api().projectMap();
    assert.equal(map.project?.id, "catalog-import");
    assert.deepEqual(map.problems, []);
    assert.deepEqual(map.repositories.map(r => [r.key, r.state]), [[".", "local"]]);
    const clean = map.components.find(c => c.id === "clean")!;
    assert.equal(clean.artifacts!.availability, "complete");
    const db = map.components.find(c => c.id === "db")!;
    assert.equal(db.artifacts!.files.find(f => f.path === "*.sql")!.count, 2);
    assert.ok(map.components.every(c => c.operations.every(o => !["adf", "azure-functions", "cosmos", "mongodb", "mongo"].includes(o.capability.provider))));
    const rows = await api().renderProjectTree();
    assert.ok(rows.some(r => r.id === "sp:import"));
    record("v3Monorepo", rows.filter(r => r.depth <= 2).map(r => `${"  ".repeat(r.depth)}${r.label}${r.description ? ` — ${r.description}` : ""}`));
  }, ["v3-monorepo"]);

  test("v3 monorepo: project docs open from the project, undeclared ones are refused", async () => {
    await run("datapass.openDoc", { label: "How the import works", path: "docs/IMPORT.md" });
    await sleep(500);
    const refused = await withUi([], () => run("datapass.openDoc", { label: "x", path: "../../etc/passwd" }), { allowErrors: true });
    assert.ok(refused.errors.some(e => /not declared by the project/.test(e)));
    await run("workbench.action.closeAllEditors");
  }, ["v3-monorepo"]);
}
