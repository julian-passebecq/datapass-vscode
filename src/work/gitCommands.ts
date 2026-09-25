/**
 * Git module commands (0.19, pass AI-1). Routes only, nothing destructive:
 *
 *   Refresh, Fetch all (plain `git fetch`, explicit), fetch one repository
 *   Open in Source Control, open a repository or worktree in a new window
 *   Open a PR or its CI run (web, or the GitHub Pull Requests / Actions views when installed)
 *   Open the host's pull-request or pipeline pages (0.16 links, when no host CLI answers)
 *   Copy a branch name, copy the cleanup command of a finished worktree (DataPass never deletes)
 *
 * Arguments come from tree items (a node) or from other views (repository key, PR number, worktree
 * path); each one is checked against the current observation before use.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import type { GitObserver } from "./gitObserver";
import { guarded, report, UserFacingError } from "./io";
import { openFolderWindow } from "../core/external";
import { clipboard } from "../core/clipboard";
import { cleanupCommand, type GitRepoReport, type WorktreeReport } from "../core/git/gitReport";
import { repositoryWebLinks, type WebLinkId } from "../core/project/gitHosts";
import { openWebPage } from "./gitHostCommands";
import type { GitNode } from "../views/gitTree";

const VIEW_PULL_REQUESTS = "workbench.view.extension.github-pull-requests";
const VIEW_GITHUB_ACTIONS = "workbench.view.extension.github-actions";

type Arg = unknown;
const str = (v: unknown, max = 1024) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : undefined);

/** The repository (and worktree / PR) a command is about, from a tree node or explicit arguments. */
function target(observer: GitObserver, a: Arg, b?: Arg): { r: GitRepoReport; w?: WorktreeReport; pr?: number } {
  const node = a && typeof a === "object" ? a as GitNode : undefined;
  let key: string | undefined, wt: string | undefined, pr: number | undefined;
  if (node) {
    switch (node.t) {
      case "repo": case "changes": case "group": key = node.r.key; break;
      case "worktree": key = node.r.key; wt = node.w.path; break;
      case "pr": key = node.r.key; pr = node.pr.number; break;
      case "merge": key = node.r.key; pr = node.r.merges[node.i]?.number; break;
      case "link": key = node.r.key; break;
      case "need": key = node.n.repoKey; wt = node.n.worktree; pr = node.n.pr; break;
      default: break;
    }
  } else {
    key = str(a, 300);
    wt = str(b);
    pr = num(b);
  }
  const r = key ? observer.report(key) : undefined;
  if (!r) throw new UserFacingError(key ? `Unknown repository "${key}" (refresh the Git view).` : "Choose a repository in the Git view.");
  const w = wt ? r.worktrees.find(x => x.path === wt) : undefined;
  if (wt && !w) throw new UserFacingError("That worktree is no longer listed (refresh the Git view).");
  return { r, w, pr };
}

export function registerGitCommands(context: vscode.ExtensionContext, session: WorkSession, observer: GitObserver): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));

  reg("datapass.git.refresh", async () => {
    await session.refresh();
    await observer.refresh(true);
    if (observer.othersLoaded()) await observer.loadOthers(true);
  });

  reg("datapass.git.fetchAll", async () => {
    if (!vscode.workspace.isTrusted) throw new UserFacingError("Restricted Mode: trust this workspace before DataPass runs Git.");
    const repos = observer.observation().project.filter(r => r.state === "ok");
    if (!repos.length) throw new UserFacingError("No cloned repository to fetch.");
    const results = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "DataPass: git fetch (nothing is merged or deleted)" },
      progress => observer.fetchAll(label => progress.report({ message: label })));
    const failed = results.filter(r => !r.ok);
    report("Fetch all", [...results.map(r => `${r.label}: ${r.ok ? "fetched" : `could not fetch (${r.detail})`}`), "Plain git fetch: remote branches updated, nothing merged, nothing pruned. Use Get updates to fast-forward."]);
    if (failed.length) void vscode.window.showWarningMessage(`Fetched ${results.length - failed.length} of ${results.length}: ${failed.map(f => f.label).join(", ")} could not be fetched (see the DataPass Work output).`);
    else void vscode.window.showInformationMessage(`Fetched ${results.length} repositor${results.length === 1 ? "y" : "ies"}. Nothing was merged.`);
  });

  reg("datapass.git.fetchRepository", async (a?: Arg) => {
    const { r } = target(observer, a);
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DataPass: git fetch ${r.label}` }, () => observer.fetchOne(r.key));
    if (r.section === "project") await session.refresh();
    if (r.section === "other") await observer.loadOthers(); else await observer.refresh();
    if (!res.ok) throw new UserFacingError(`${r.label}: could not fetch (${res.detail}).`);
    void vscode.window.showInformationMessage(`${r.label} fetched. Nothing was merged.`);
  });

  reg("datapass.git.openSourceControl", async (a?: Arg, b?: Arg) => {
    const { r, w } = target(observer, a, b);
    const folder = w?.path ?? observer.folderOf(r.key);
    if (!folder) throw new UserFacingError(`${r.label} is not cloned here.`);
    // The built-in Git extension adds the repository to Source Control without opening a window.
    const commands = new Set(await vscode.commands.getCommands(true));
    if (commands.has("git.openRepository")) await vscode.commands.executeCommand("git.openRepository", folder);
    await vscode.commands.executeCommand("workbench.view.scm");
  });

  reg("datapass.git.openInNewWindow", async (a?: Arg, b?: Arg) => {
    const { r, w } = target(observer, a, b);
    const folder = w?.path ?? observer.folderOf(r.key);
    if (!folder) throw new UserFacingError(`${r.label} is not cloned here.`);
    await openFolderWindow(vscode.Uri.file(folder));
  });

  reg("datapass.git.copyBranch", async (a?: Arg, b?: Arg) => {
    const { r, w, pr } = target(observer, a, b);
    const branch = pr ? r.prs?.find(p => p.number === pr)?.head : w ? w.branch : r.branch;
    if (!branch) throw new UserFacingError("No branch here (detached HEAD).");
    await clipboard.writeText(branch);
    void vscode.window.showInformationMessage(`Copied the branch name: ${branch}`);
  });

  reg("datapass.git.copyCleanupCommand", async (a?: Arg, b?: Arg) => {
    const { r, w } = target(observer, a, b);
    const folder = observer.folderOf(r.key);
    if (!w || !folder) throw new UserFacingError("Choose a finished worktree in the Git view.");
    const cmd = cleanupCommand(folder, w);
    if (!cmd) throw new UserFacingError(!w.finished ? "This worktree's branch is not merged and its PR is not closed: keep it." : w.locked ? "This worktree is locked: unlock it first (git worktree unlock)." : !w.status ? "Its state could not be read: refresh the Git view." : "This worktree has uncommitted changes: open it and commit or discard them first.");
    await clipboard.writeText(cmd);
    void vscode.window.showInformationMessage("Cleanup command copied. Paste it in a terminal and run it yourself: DataPass never deletes a worktree or a branch.", { detail: cmd, modal: false });
  });

  reg("datapass.git.openPullRequest", async (a?: Arg, b?: Arg) => {
    const { r, pr } = target(observer, a, b);
    const open = pr ? r.prs?.find(p => p.number === pr) : undefined;
    const merged = pr ? r.closed?.find(p => p.number === pr) : undefined;
    const url = open?.url ?? merged?.url;
    if (!url || !r.host || !url.startsWith(`${r.host.web}/`)) throw new UserFacingError(pr ? `PR #${pr} is not listed for ${r.label} (refresh the Git view).` : "Choose a pull request in the Git view.");
    if (r.host.kind === "github" && (await vscode.commands.getCommands(true)).includes(VIEW_PULL_REQUESTS)) {
      const pick = await vscode.window.showQuickPick([
        { label: "$(link-external) On github.com", description: url, id: "web" },
        { label: "$(git-pull-request) In VS Code", description: "GitHub Pull Requests extension", id: "view" }
      ], { title: `PR #${pr} of ${r.label}` });
      if (!pick) return;
      if (pick.id === "view") { await vscode.commands.executeCommand(VIEW_PULL_REQUESTS); return; }
    }
    await openWebPage(session, url, `Pull request #${pr} of ${r.label} on ${r.host.label}`, "Built from the repository's address and the PR number.");
  });

  reg("datapass.git.openCiRun", async (a?: Arg, b?: Arg) => {
    const { r, pr } = target(observer, a, b);
    const p = pr ? r.prs?.find(x => x.number === pr) : undefined;
    if (!p || !r.host) throw new UserFacingError(pr ? `PR #${pr} is not listed for ${r.label}.` : "Choose a pull request in the Git view.");
    const failed = p.ci.failed.find(f => f.url);
    const url = failed?.url ?? (r.host.kind === "github" ? `${p.url}/checks` : r.host.kind === "gitlab" ? `${p.url}/pipelines` : p.url);
    if (r.host.kind === "github" && (await vscode.commands.getCommands(true)).includes(VIEW_GITHUB_ACTIONS)) {
      const pick = await vscode.window.showQuickPick([
        { label: "$(link-external) On github.com", description: url, id: "web" },
        { label: "$(github-action) In VS Code", description: "GitHub Actions extension", id: "view" }
      ], { title: `CI of PR #${p.number}${failed ? ` (${failed.name} failed)` : ""}` });
      if (!pick) return;
      if (pick.id === "view") { await vscode.commands.executeCommand(VIEW_GITHUB_ACTIONS); return; }
    }
    await openWebPage(session, url, `CI of PR #${p.number} of ${r.label}${failed ? ` (${failed.name})` : ""}`, "A check page of this repository, or the PR's checks.");
  });

  reg("datapass.git.openOnWeb", async (a?: Arg, b?: Arg) => {
    const node = a && typeof a === "object" ? a as GitNode : undefined;
    const { r } = target(observer, a);
    const linkId = (node?.t === "link" ? node.linkId : str(b, 40)) as WebLinkId | undefined;
    if (!r.host) throw new UserFacingError(`${r.label}: its remote is not on GitHub, Azure DevOps or GitLab.`);
    const links = repositoryWebLinks(r.host.web);
    const link = links.find(l => l.id === linkId) ?? (await vscode.window.showQuickPick(links.map(l => ({ label: l.label, description: l.url, l })), { title: `${r.label} on ${r.host.label}` }))?.l;
    if (!link) return;
    await openWebPage(session, link.url, `${link.label} of ${r.label} on ${r.host.label}`, "Built from the repository's remote address.");
  });
}
