/**
 * Desktop flows for 0.22 package D (format checks without execution), fixture v22-checks: a
 * native repository without any DataPass file, holding tests/fixtures/checks/bad. In real VS Code:
 * the broken databricks.yml shows in Problems, saving a fixed file clears its diagnostics, bundle
 * diagnostics offer the (copy-only) validate route, and nothing is run.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";

const root = () => vscode.workspace.workspaceFolders![0]!.uri;
const at = (rel: string) => vscode.Uri.joinPath(root(), ...rel.split("/"));
const ours = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).filter(d => d.source === "DataPass");
const codes = (uri: vscode.Uri) => ours(uri).map(d => String(d.code)).sort();

export function registerCheckFlows(_getApi: () => DataPassTestApi): void {
  const F = ["v22-checks"];

  test("checks: a broken databricks.yml (and friends) shows in Problems after Check This Repository", async () => {
    await vscode.commands.executeCommand("datapass.checkThisRepository");
    const bundle = await waitFor("databricks.yml diagnostics", () => ours(at("databricks.yml")).length >= 4 || undefined);
    assert.ok(bundle);
    assert.deepEqual(codes(at("databricks.yml")), ["dab.bundle-name", "dab.include", "dab.targets", "dab.targets"]);
    assert.deepEqual(codes(at("resources/jobs.yml")), ["dab.path", "dab.path", "dab.var"]);
    assert.deepEqual(codes(at("resources/broken.yml")), ["yaml.syntax"]);
    assert.deepEqual(codes(at("api/Dockerfile")), ["docker.copy-source", "docker.copy-source", "docker.from"]);
    assert.deepEqual(codes(at("compose.yaml")), ["compose.build-context", "compose.build-context", "compose.env-file"]);
    assert.deepEqual(codes(at("config.json")), ["json.syntax"]);
    const name = ours(at("databricks.yml")).find(d => d.code === "dab.bundle-name")!;
    assert.equal(name.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(name.range.start.line, 0);
    // Everything in Problems from DataPass, as the person sees it.
    const all = vscode.languages.getDiagnostics().flatMap(([u, ds]) => ds.filter(d => d.source === "DataPass").map(d => `${vscode.workspace.asRelativePath(u)}#${d.code}`));
    record("formatChecks", { problems: all.length, rules: [...new Set(all.map(a => a.split("#")[1]))].sort() });
  }, F);

  test("checks: bundle diagnostics offer the copy-only `databricks bundle validate` quick fix", async () => {
    await vscode.workspace.openTextDocument(at("resources/jobs.yml")); // the provider needs a text model
    await vscode.workspace.openTextDocument(at("api/Dockerfile"));
    const d = ours(at("resources/jobs.yml")).find(x => x.code === "dab.var")!;
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", at("resources/jobs.yml"), d.range);
    const fix = actions.find(a => a.title.includes("databricks bundle validate"));
    assert.ok(fix, `actions: ${actions.map(a => a.title).join(" | ")}`);
    assert.equal(fix.command?.command, "datapass.checks.copyBundleValidate");
    assert.equal(fix.command?.arguments?.[0], at("databricks.yml").toString());
    const docker = ours(at("api/Dockerfile"))[0]!;
    const none = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", at("api/Dockerfile"), docker.range);
    assert.ok(!none.some(a => a.title.includes("databricks bundle validate")), "only bundle diagnostics get the validate route");
  }, F);

  test("checks: saving a fixed file clears its diagnostics (on-save check)", async () => {
    const doc = await vscode.workspace.openTextDocument(at("resources/jobs.yml"));
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    const text = doc.getText().replace("${var.schema}", "${var.catalog}").replace("../src/missing_notebook", "../src/present").replace("            - whl: ../dist/*.whl\n", "            - pypi:\n                package: sales\n");
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await doc.save());
    // No command here: only the on-save listener can clear them (the document URI may differ in case from the folder).
    await waitFor("jobs.yml diagnostics cleared by the on-save check", () => ours(at("resources/jobs.yml")).length === 0 || undefined);
    // The bundle's own problems are untouched by fixing another file of it.
    assert.deepEqual(codes(at("databricks.yml")), ["dab.bundle-name", "dab.include", "dab.targets", "dab.targets"]);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }, F);

  test("checks: Check This File on a fixed JSON file clears it; a broken one comes back", async () => {
    await vscode.workspace.fs.writeFile(at("config.json"), Buffer.from('{ "name": "sales" }\n'));
    await vscode.commands.executeCommand("datapass.checkThisFile", at("config.json"));
    await waitFor("config.json cleared", () => ours(at("config.json")).length === 0 || undefined);
    await vscode.workspace.fs.writeFile(at("config.json"), Buffer.from('{ "name": }\n'));
    await vscode.commands.executeCommand("datapass.checkThisFile", at("config.json"));
    await waitFor("config.json broken again", () => ours(at("config.json")).length === 1 || undefined);
  }, F);
}
