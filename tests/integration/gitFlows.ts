/**
 * 0.19 desktop flows for the Git module (real VS Code, real Git, a stub gh, offline): the Git view
 * lists the project's repositories, worktrees, PRs with CI and recent merges; "Needs you" follows
 * the deterministic rules in order and drives the badge and the Workbench's Git card; Fetch all is a
 * plain `git fetch` that merges nothing; routes open through the Test-mode seams; the cleanup
 * command is copied and nothing is deleted; other repositories under datapass.projectsFolders are
 * read when their section opens; the stub proves only read commands reach gh.
 */
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
interface Env { ghStub: string; projects: string; pipeline: string; fixA: string; wip: string; side: string; squash: string }
const env = (): Env => JSON.parse(process.env.DATAPASS_IT_V19 ?? "{}");
const head = (dir: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
const cfg = () => vscode.workspace.getConfiguration("datapass");
const real = (p: string) => fs.realpathSync.native(p).toLowerCase();

export function registerGitFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  /** A worktree's path as Git reports it (on Windows CI the temporary folder may be written in 8.3 form elsewhere). */
  const worktree = (branch: string) => api().git.observation().project.find(r => r.key === "pipeline")!.worktrees.find(w => w.branch === branch)!.path;
  const F = ["v19-git"];

  test("0.19: the Git view checks the repositories when it is shown (gh from the machine-level setting)", async () => {
    await cfg().update("git.ghPath", env().ghStub, vscode.ConfigurationTarget.Global);
    await cfg().update("projectsFolders", [env().projects], vscode.ConfigurationTarget.Global);
    await run("datapass.refreshProject");
    await run("datapass.git.focus");
    const o = await waitFor("the Git view's first check", () => { const x = api().git.observation(); return x.checkedAt && !x.checking && x.project.find(r => r.key === "pipeline")?.prs ? x : undefined; }, 30000);
    assert.deepEqual(o.project.map(r => `${r.key}:${r.state}`), [".:ok", "pipeline:ok", "infra:planned"]);
    const pipe = o.project.find(r => r.key === "pipeline")!;
    assert.deepEqual(pipe.hostData, { kind: "cli", source: "gh" });
    assert.deepEqual(pipe.prs!.map(p => [p.number, p.ci.state, p.url]), [[41, "passing", "https://github.com/example-org/research-pipeline/pull/41"], [38, "failing", "https://github.com/example-org/research-pipeline/pull/38"]], "PR pages are rebuilt, never taken from gh's output");
    assert.deepEqual(pipe.worktrees.map(w => [w.branch, w.finished?.how ?? "-", w.status ? w.status.untracked : "?"]), [["claude/fix-a", "pr-merged", 0], ["claude/wip", "-", 1]]);
    assert.equal(pipe.defaultBranch, "main");
    assert.deepEqual(pipe.merges.map(m => m.number), [36]);
    record("gitRepositories", o.project.map(r => ({ key: r.key, state: r.state, line: r.detail })));
  }, F);

  test("0.19: Needs you follows the rules in order, and drives the badge and the Workbench's Git card", async () => {
    const o = api().git.observation();
    const items = o.needsYou.map(n => `${n.rank}:${n.kind}:${n.repoKey}:${n.pr ?? (n.worktree ? path.basename(n.worktree) : "")}`);
    assert.deepEqual(items, [
      "1:ci-failed:pipeline:38",
      "2:pr-waiting:pipeline:41",
      "3:merged-not-pulled:pipeline:36",
      "4:dirty-default:.:",
      "5:worktree-cleanup:pipeline:fix-a",
      "6:unpushed:pipeline:wip"
    ]);
    assert.equal(o.needsYou.find(n => n.kind === "merged-not-pulled")!.action, "check-updates", "the merge commit is not even fetched yet");
    assert.equal(api().git.badge(), 6);
    const card = await waitFor("the Workbench's Git card", () => api().workbenchState().git);
    assert.deepEqual({ needsYou: card.needsYou, openPrs: card.openPrs, failing: card.failing, repositories: card.repositories }, { needsYou: 6, openPrs: 2, failing: 1, repositories: 3 });
    record("gitNeedsYou", items);
  }, F);

  test("0.19: the Git tree renders through the real provider, with unique IDs and routes on every item", async () => {
    const rows = await api().git.renderTree();
    const ids = rows.map(r => r.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, "tree item IDs are unique");
    const labels = rows.map(r => r.label);
    for (const l of ["Needs you (6)", "research-hub", "research-pipeline", "research-infra", "Worktrees (2)", "Pull requests (2)", "Recent merges", "#38 Fix lint", "#41 Green change", "#36 Retry the extraction"]) assert.ok(labels.some(x => x.includes(l)), `${l} in ${labels.join(" | ")}`);
    const need = rows.filter(r => r.contextValue?.startsWith("gitNeed."));
    assert.deepEqual(need.map(r => r.command), ["datapass.git.openCiRun", "datapass.git.openPullRequest", "datapass.checkForUpdates", "datapass.git.openSourceControl", "datapass.git.copyCleanupCommand", "datapass.git.openInNewWindow"]);
    const pipeRow = rows.find(r => r.id === "repo:pipeline")!;
    assert.match(pipeRow.description ?? "", /GitHub · main ✓ · 2 PRs \(1 ✗\) · fetched/);
    assert.match(rows.find(r => r.label.includes("claude/fix-a"))!.contextValue ?? "", /^gitWorktree\.cleanup/);
    const registered = new Set(await vscode.commands.getCommands(true));
    const dangling = rows.map(r => r.command).filter((c): c is string => !!c && !registered.has(c));
    assert.deepEqual(dangling, []);
  }, F);

  test("0.19: routes open the PR, the failing check, the worktree and Source Control; nothing is changed", async () => {
    const pr = await withUi([{ button: "Open" }], () => run("datapass.git.openPullRequest", "pipeline", 41));
    assert.deepEqual(pr.opened, ["https://github.com/example-org/research-pipeline/pull/41"]);
    const ci = await withUi([{ button: "Open" }], () => run("datapass.git.openCiRun", "pipeline", 38));
    assert.deepEqual(ci.opened, ["https://github.com/example-org/research-pipeline/actions/runs/1/job/2"], "the failing check's own page");
    const win = await withUi([], () => run("datapass.git.openInNewWindow", "pipeline", worktree("claude/wip")));
    assert.equal(win.openedFolders.length, 1);
    assert.equal(real(vscode.Uri.parse(win.openedFolders[0]!).fsPath), real(env().wip), win.openedFolders[0]);
    const branch = await withUi([], () => run("datapass.git.copyBranch", "pipeline", 38));
    assert.equal(branch.clipboard, "claude/fix-lint");
    await withUi([], () => run("datapass.git.openSourceControl", "pipeline"));
    const bad = await withUi([], () => run("datapass.git.openPullRequest", "pipeline", 999), { allowErrors: true });
    assert.ok(bad.errors.some(e => /not listed/.test(e)), bad.errors.join(" / "));
  }, F);

  test("0.19: the cleanup command is copied for you to run; DataPass deletes nothing", async () => {
    const ui = await withUi([], () => run("datapass.git.copyCleanupCommand", "pipeline", worktree("claude/fix-a")));
    const cmd = ui.clipboard;
    assert.match(cmd, /^git -C '.+research-pipeline' worktree remove '.+\/\.claude\/worktrees\/fix-a'\n# PR #36 was merged on the host \(squash or rebase\), so Git needs -D to delete the branch\ngit -C '.+' branch -D claude\/fix-a$/, cmd);
    assert.ok(fs.existsSync(env().fixA), "the worktree is still there");
    const branches = execFileSync("git", ["branch", "--list", "claude/fix-a"], { cwd: env().pipeline, encoding: "utf8" });
    assert.match(branches, /claude\/fix-a/, "and so is its branch");
    const refused = await withUi([], () => run("datapass.git.copyCleanupCommand", "pipeline", worktree("claude/wip")), { allowErrors: true });
    assert.ok(refused.errors.some(e => /not merged/.test(e)), refused.errors.join(" / "));
    assert.equal(refused.clipboard, "");
  }, F);

  test("0.19: Fetch all is a plain git fetch: the merged PR becomes Get updates, nothing is merged", async () => {
    const before = head(env().pipeline);
    await withUi([], () => run("datapass.git.fetchAll"));
    const o = await waitFor("the check after Fetch all", () => { const x = api().git.observation(); return !x.checking && x.needsYou.find(n => n.kind === "merged-not-pulled")?.action === "get-updates" ? x : undefined; }, 30000);
    const pipe = o.project.find(r => r.key === "pipeline")!;
    assert.equal(pipe.behind, 1);
    assert.equal(head(env().pipeline), before, "nothing was merged");
    assert.ok(pipe.lastFetch && Date.now() - Date.parse(pipe.lastFetch) < 120_000, "the last fetch time moved");
    const rows = await api().git.renderTree();
    assert.equal(rows.find(r => r.contextValue === "gitNeed.get-updates.project")?.command, "datapass.getUpdates");
  }, F);

  test("0.19: other repositories under datapass.projectsFolders are read when their section opens", async () => {
    assert.equal(api().git.observation().others, undefined, "not read before the section is opened");
    const o = await api().git.loadOthers();
    assert.deepEqual(o.others!.map(r => `${r.label}:${r.state}:${r.detached}`), ["side-project:ok:true"], "the project's own repositories are not repeated");
    assert.deepEqual(o.othersNeedsYou.map(n => n.kind), ["detached"]);
    assert.equal(api().git.badge(), 6, "other repositories do not change the project's badge");
    const rows = await api().git.renderTree(true);
    assert.ok(rows.some(r => r.id === "repo:other:0:side-project"), rows.map(r => r.id).join(" | "));
  }, F);

  test("0.19: without gh the Git view falls back to the host's web pages", async () => {
    await cfg().update("git.ghPath", path.join(path.dirname(env().ghStub), "missing-gh.exe"), vscode.ConfigurationTarget.Global);
    try {
      const o = await api().git.refresh(true);
      const pipe = o.project.find(r => r.key === "pipeline")!;
      assert.deepEqual(pipe.hostData, { kind: "links", reason: "not-installed", tool: "gh" });
      assert.equal(pipe.prs, undefined);
      assert.deepEqual(o.needsYou.map(n => n.kind), ["dirty-default", "unpushed"], "PR rules need the PR list; Git rules still apply");
      const rows = await api().git.renderTree();
      const link = rows.find(r => r.id === "repo:pipeline/link:pr")!;
      assert.equal(link.command, "datapass.git.openOnWeb");
      assert.match(link.description ?? "", /gh not installed/);
      const web = await withUi([{ button: "Open" }], () => run("datapass.git.openOnWeb", "pipeline", "pull-requests"));
      assert.deepEqual(web.opened, ["https://github.com/example-org/research-pipeline/pulls"]);
    } finally {
      await cfg().update("git.ghPath", env().ghStub, vscode.ConfigurationTarget.Global);
    }
  }, F);

  test("0.19: gh only ever received `auth status` and `pr list`", async () => {
    const calls = fs.readFileSync(env().ghStub + ".log", "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as string[]);
    assert.ok(calls.length >= 3, `${calls.length} calls`);
    for (const c of calls) assert.ok((c[0] === "auth" && c[1] === "status") || (c[0] === "pr" && c[1] === "list" && c.includes("--repo")), JSON.stringify(c));
    record("ghCalls", calls.length);
  }, F);
}
