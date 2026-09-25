/**
 * 0.16 desktop flows for Git hosts and CI (real VS Code, real Git, offline): an Azure DevOps
 * repository declared with its https "{org}@" address is found as the clone whose origin is the
 * SSH address; GitHub Actions, Azure Pipelines and GitLab CI components find their files; each
 * repository's web pages (repository, pull requests, pipelines, boards) and each pipeline's runs
 * open through the browser seam after their address is shown. Nothing is contacted.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as path from "node:path";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
/** The browser seam records vscode.Uri#toString(true): percent-encoding is decoded there. */
const shown = (url: string) => decodeURI(url);

export function registerDevopsFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const comp = (id: string) => api().projectMap().components.find(c => c.id === id)!;

  test("0.16: one Azure DevOps repository whatever its address form; GitHub via SSH; GitLab not cloned", async () => {
    await run("datapass.refreshProject");
    assert.deepEqual(api().project().manifestErrors, [], "the https://{org}@dev.azure.com/… address is accepted");
    const map = api().projectMap();
    const repos = Object.fromEntries(map.repositories.map(r => [r.key, `${r.state}${r.source ? `:${r.source}` : ""}`]));
    assert.deepEqual(repos, { ".": "local:coordination", web: "local:sibling-folder", api: "local:sibling-folder", data: "unbound" }, JSON.stringify(repos));
    assert.equal(map.repositories.find(r => r.key === "api")?.remote, "dev.azure.com/example-org/shop%20platform/_git/orders-api");
    assert.deepEqual(map.problems.filter(p => p.severity === "error"), []);
    const state = api().workbenchState();
    const hosts = Object.fromEntries(state.repositories.map(r => [r.key, `${r.host ?? "-"}:${r.links.map(l => l.id).join(",")}`]));
    assert.deepEqual(hosts, { ".": "-:", web: "GitHub:repository,pull-requests,pipelines,boards", api: "Azure DevOps:repository,pull-requests,pipelines,boards", data: "GitLab:repository,pull-requests,pipelines,boards" });
    const rows = await api().renderProjectTree();
    for (const key of ["web", "api", "data"]) assert.match(rows.find(r => r.id === `repo:${key}`)?.contextValue ?? "", /\.web$/, key);
    record("devopsRepositories", repos);
  }, ["v3-devops"]);

  test("0.16: CI components find their files; the workflows pattern matches .yml and .yaml", async () => {
    const web = comp("web-ci");
    assert.equal(web.artifacts?.availability, "complete", web.headline);
    assert.equal(web.artifacts?.files[0]?.count, 2);
    assert.equal(comp("api-ci").artifacts?.entry?.state, "found");
    assert.equal(comp("data-ci").artifacts?.availability, "unbound");
    for (const id of ["web-ci", "api-ci", "data-ci"]) {
      const runs = comp(id).operations.find(o => o.capability.datapassActionId === "datapass.openCiRuns");
      assert.equal(runs?.result.status, "ready", `${id}: ${runs?.result.nextStep}`);
    }
    await run("workbench.action.closeAllEditors");
    await withUi([{ pick: "deploy.yaml" }], () => run("datapass.openComponentEntry", "web-ci"));
    await waitFor("deploy.yaml in the editor", () => vscode.window.activeTextEditor?.document.uri.fsPath.endsWith(path.join(".github", "workflows", "deploy.yaml")));
    await run("workbench.action.closeAllEditors");
    record("devopsTools", [...api().toolObservations().values()].filter(o => /github|gitlab|azure-pipelines|grafana/.test(o.toolId)).map(o => `${o.toolId}: ${o.state}`));
  }, ["v3-devops"]);

  test("0.16: a repository's pages on GitHub, Azure DevOps and GitLab open after their address is shown", async () => {
    const ado = await withUi([{ pick: "Pipelines" }, { button: "Open" }], () => run("datapass.openRepositoryWeb", "api"));
    assert.deepEqual(ado.opened, [shown("https://dev.azure.com/example-org/Shop%20Platform/_build")]);
    assert.ok(ado.prompts.some(p => p.modal && (p.text ?? "").includes("https://dev.azure.com/example-org/Shop%20Platform/_build")), "the exact address is shown first");
    const gh = await withUi([{ button: "Open" }], () => run("datapass.openRepositoryWeb", "web", "pull-requests"));
    assert.deepEqual(gh.opened, ["https://github.com/example-org/shop-web/pulls"]);
    const gl = await withUi([{ button: "Open" }], () => run("datapass.openRepositoryWeb", "data", "boards"));
    assert.deepEqual(gl.opened, ["https://gitlab.com/example-group/data/shop-data-jobs/-/issues"], "an uncloned repository still has its pages");
    const none = await withUi([], () => run("datapass.openRepositoryWeb", "."), { allowErrors: true });
    assert.ok(none.errors.some(e => /cannot build its web pages/.test(e)), none.errors.join(" / "));
  }, ["v3-devops"]);

  test("0.16: each pipeline's runs open on its host (the official extension's view when it is installed)", async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const actionsView = registered.has("workbench.view.extension.github-actions");
    const web = await withUi([...(actionsView ? [{ pick: "On github.com" }] : []), { button: "Open" }], () => run("datapass.openCiRuns", "web-ci"));
    assert.deepEqual(web.opened, ["https://github.com/example-org/shop-web/actions"]);
    // Already shown in this window: no second confirmation.
    const ado = await withUi([], () => run("datapass.openCiRuns", "api-ci"));
    assert.deepEqual(ado.opened, [shown("https://dev.azure.com/example-org/Shop%20Platform/_build")]);
    const gl = await withUi([{ button: "Open" }], () => run("datapass.openNativeTool", "data-ci"));
    assert.deepEqual(gl.opened, ["https://gitlab.com/example-group/data/shop-data-jobs/-/pipelines"], "the component's official tool routes to its runs");
    record("devopsGithubActionsView", actionsView);
  }, ["v3-devops"]);
}
