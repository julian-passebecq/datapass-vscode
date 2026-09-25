/**
 * DataPass "Git" tree (left side bar, under Project), 0.19 pass AI-1:
 *
 *   Needs you (n)            the deterministic rules of core/git/gitReport.ts, most urgent first
 *   <repository>             role · host · branch ↓behind ↑ahead · changes · PRs · last fetch
 *     Changes                staged · unstaged · untracked
 *     Worktrees (n)          branch · changes · merged / PR closed
 *     Pull requests (n)      #n title · CI ✓ ✗ ● · review
 *     Recent merges          #n title · when
 *   Other repositories in D:\PROJ (n)   optional, read when first expanded
 *
 * Every action is a route (Source Control, a new window, a web page, Check / Get updates, a copied
 * branch name or cleanup command); nothing here changes a repository. The view's badge counts the
 * project's "needs you" items.
 */
import * as vscode from "vscode";
import type { GitObserver } from "../work/gitObserver";
import { ago, ciMark, countsText, repoLine, type GitRepoReport, type NeedsYou, type WorktreeReport } from "../core/git/gitReport";
import type { PullRequest } from "../core/git/hostPrs";
import { repositoryWebLinks } from "../core/project/gitHosts";

export type GitNode =
  | { t: "message"; id: string; label: string; description?: string; icon: [string, string?]; tooltip?: string; command?: vscode.Command }
  | { t: "needs"; id: string; items: NeedsYou[] }
  | { t: "need"; id: string; n: NeedsYou }
  | { t: "repo"; id: string; r: GitRepoReport }
  | { t: "group"; id: string; r: GitRepoReport; kind: "worktrees" | "prs" | "merges" }
  | { t: "changes"; id: string; r: GitRepoReport }
  | { t: "worktree"; id: string; r: GitRepoReport; w: WorktreeReport }
  | { t: "pr"; id: string; r: GitRepoReport; pr: PullRequest }
  | { t: "merge"; id: string; r: GitRepoReport; i: number }
  | { t: "link"; id: string; r: GitRepoReport; linkId: "pull-requests" | "pipelines"; label: string; description?: string }
  | { t: "others"; id: string };

const icon = ([id, color]: [string, string?]) => new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);
const ERR = "problemsErrorIcon.foreground", WARN = "problemsWarningIcon.foreground", OK = "testing.iconPassed", MUTED = "disabledForeground";

const NEED_ICON: Record<string, [string, string?]> = {
  "ci-failed": ["error", ERR], "pr-waiting": ["git-pull-request", WARN], "merged-not-pulled": ["arrow-down", WARN], "dirty-default": ["diff", WARN],
  "worktree-cleanup": ["trash", WARN], "worktree-at-risk": ["warning", ERR], unpushed: ["cloud-upload", WARN], detached: ["debug-disconnect", WARN]
};
const CI_ICON: Record<string, [string, string?]> = { failing: ["error", ERR], running: ["sync", "charts.yellow"], passing: ["pass", OK], none: ["git-pull-request", undefined], unknown: ["git-pull-request", undefined] };
const REVIEW_TEXT: Record<string, string> = { approved: "approved", "changes-requested": "changes requested", "review-required": "review needed", none: "" };
const LINK_REASON: Record<string, string> = {
  "not-installed": "not installed", "not-signed-in": "not signed in (run its login command)", failed: "could not list them", timeout: "took more than 5 s",
  unsupported: "this address cannot be passed to it", "not-checked": "not checked"
};
const HOST_TOOL: Record<string, string> = { github: "gh", "azure-devops": "az", gitlab: "glab" };

export function needCommand(n: NeedsYou): vscode.Command {
  const project = n.section === "project";
  switch (n.action) {
    case "open-ci": return { command: "datapass.git.openCiRun", title: "Open the CI run", arguments: [n.repoKey, n.pr] };
    case "open-pr": return { command: "datapass.git.openPullRequest", title: "Open the pull request", arguments: [n.repoKey, n.pr] };
    case "check-updates": return project ? { command: "datapass.checkForUpdates", title: "Check for updates", arguments: [n.repoKey] } : { command: "datapass.git.fetchRepository", title: "Fetch", arguments: [n.repoKey] };
    case "get-updates": return project ? { command: "datapass.getUpdates", title: "Get updates", arguments: [n.repoKey] } : { command: "datapass.git.openSourceControl", title: "Source Control", arguments: [n.repoKey] };
    case "source-control": return { command: "datapass.git.openSourceControl", title: "Open in Source Control", arguments: [n.repoKey] };
    case "copy-cleanup": return { command: "datapass.git.copyCleanupCommand", title: "Copy the cleanup command", arguments: [n.repoKey, n.worktree] };
    case "open-worktree": return { command: "datapass.git.openInNewWindow", title: "Open the worktree in a new window", arguments: [n.repoKey, n.worktree] };
  }
}

export class GitTreeProvider implements vscode.TreeDataProvider<GitNode>, vscode.Disposable {
  static readonly viewType = "datapass.git";
  private readonly emitter = new vscode.EventEmitter<GitNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly observer: GitObserver) {
    this.subs.push(observer.onDidChange(() => this.emitter.fire(undefined)));
  }

  dispose(): void { for (const s of this.subs) s.dispose(); this.emitter.dispose(); }

  async getChildren(node?: GitNode): Promise<GitNode[]> {
    const o = this.observer.observation();
    if (!node) return this.roots();
    switch (node.t) {
      case "needs": return node.items.slice(0, 50).map((n, i) => ({ t: "need", id: `${node.id}/${i}:${n.kind}:${n.repoKey}:${n.pr ?? n.worktree ?? ""}`, n }));
      case "repo": return this.repoChildren(node.r);
      case "group": {
        const r = node.r;
        if (node.kind === "worktrees") return r.worktrees.map(w => ({ t: "worktree" as const, id: `${node.id}/${w.path}`, r, w }));
        if (node.kind === "prs") return (r.prs ?? []).map(pr => ({ t: "pr" as const, id: `${node.id}/${pr.number}`, r, pr }));
        return r.merges.map((_, i) => ({ t: "merge" as const, id: `${node.id}/${i}`, r, i }));
      }
      case "others": {
        if (!this.observer.othersLoaded()) await this.observer.loadOthers();
        const others = this.observer.observation().others ?? [];
        const items = this.observer.observation().othersNeedsYou;
        if (!others.length) return [{ t: "message", id: "others:none", label: o.otherFolders.length ? "No other Git repository in these folders" : "Set datapass.projectsFolders (for example D:\\PROJ) to list your other repositories", icon: ["info"], command: o.otherFolders.length ? undefined : { command: "workbench.action.openSettings", title: "Settings", arguments: ["datapass.projectsFolders"] } }];
        return [...(items.length ? [{ t: "needs" as const, id: "others:needs", items }] : []), ...others.map(r => ({ t: "repo" as const, id: `repo:${r.key}`, r }))];
      }
      default: return [];
    }
  }

  private roots(): GitNode[] {
    const o = this.observer.observation();
    if (o.restricted) return [{ t: "message", id: "restricted", label: "Restricted Mode: DataPass does not run Git", description: "trust this workspace", icon: ["shield", MUTED], tooltip: "Git can run programs a repository configures (hooks, fsmonitor), so DataPass runs no Git in an untrusted workspace.", command: { command: "workbench.trust.manage", title: "Manage Workspace Trust" } }];
    const nodes: GitNode[] = [];
    if (!o.project.length) {
      nodes.push(o.checking
        ? { t: "message", id: "checking", label: "Checking the repositories…", icon: ["sync~spin"] }
        : { t: "message", id: "empty", label: "No project repository: open a DataPass project, or use Other repositories below", icon: ["info"] });
    } else {
      if (o.needsYou.length) nodes.push({ t: "needs", id: "needs", items: o.needsYou });
      else nodes.push({ t: "message", id: "calm", label: "Nothing needs you", description: o.checking ? "checking…" : o.checkedAt ? `checked ${ago(o.checkedAt) ?? ""}` : undefined, icon: ["check", OK] });
      nodes.push(...o.project.map(r => ({ t: "repo" as const, id: `repo:${r.key}`, r })));
    }
    if (vscode.workspace.getConfiguration("datapass").get<boolean>("git.showOtherRepositories", true)) nodes.push({ t: "others", id: "others" });
    return nodes;
  }

  private repoChildren(r: GitRepoReport): GitNode[] {
    const out: GitNode[] = [];
    if (r.state !== "ok") {
      if (r.host && r.state !== "planned") out.push(...this.linkRows(r));
      return out;
    }
    const n = r.counts ? r.counts.staged + r.counts.unstaged + r.counts.untracked + r.counts.conflicted : 0;
    if (n) out.push({ t: "changes", id: `repo:${r.key}/changes`, r });
    if (r.worktrees.length) out.push({ t: "group", id: `repo:${r.key}/worktrees`, r, kind: "worktrees" });
    if (r.prs) out.push({ t: "group", id: `repo:${r.key}/prs`, r, kind: "prs" });
    else if (r.host) out.push(...this.linkRows(r));
    if (r.merges.length) out.push({ t: "group", id: `repo:${r.key}/merges`, r, kind: "merges" });
    return out;
  }

  private linkRows(r: GitRepoReport): GitNode[] {
    const d = r.hostData;
    const why = d.kind === "links" ? `${d.tool ?? HOST_TOOL[r.host!.kind]} ${LINK_REASON[d.reason] ?? d.reason}${d.detail ? `: ${d.detail}` : ""}` : undefined;
    const links = repositoryWebLinks(r.host!.web);
    const pr = links.find(l => l.id === "pull-requests"), pipes = links.find(l => l.id === "pipelines");
    return [
      ...(pr ? [{ t: "link" as const, id: `repo:${r.key}/link:pr`, r, linkId: "pull-requests" as const, label: `${pr.label} on ${r.host!.label}`, description: why }] : []),
      ...(pipes ? [{ t: "link" as const, id: `repo:${r.key}/link:ci`, r, linkId: "pipelines" as const, label: `${pipes.label} on ${r.host!.label}` }] : [])
    ];
  }

  getTreeItem(n: GitNode): vscode.TreeItem {
    const None = vscode.TreeItemCollapsibleState.None;
    switch (n.t) {
      case "message": {
        const item = new vscode.TreeItem(n.label, None);
        item.id = n.id; item.description = n.description; item.iconPath = icon(n.icon); item.tooltip = n.tooltip ?? n.label; item.command = n.command;
        return item;
      }
      case "needs": {
        const item = new vscode.TreeItem(`Needs you (${n.items.length})`, vscode.TreeItemCollapsibleState.Expanded);
        item.id = n.id; item.iconPath = icon(["bell-dot", WARN]); item.contextValue = "gitNeeds";
        item.tooltip = "Most urgent first: failed CI, green PRs waiting, merges not pulled, uncommitted changes on the default branch, finished worktrees, unpushed work, detached HEAD.";
        return item;
      }
      case "need": {
        const x = n.n;
        const item = new vscode.TreeItem(`${x.repoLabel}  ${x.text}`, None);
        item.id = n.id; item.description = x.detail; item.iconPath = icon(NEED_ICON[x.kind] ?? ["circle-filled"]);
        item.command = needCommand(x); item.tooltip = `${x.repoLabel}: ${x.text}\n${x.detail}\nClick: ${item.command.title}`;
        item.contextValue = `gitNeed.${x.action}${x.section === "project" ? ".project" : ""}`;
        return item;
      }
      case "repo": {
        const r = n.r;
        const item = new vscode.TreeItem(r.label, r.state === "ok" || r.host ? vscode.TreeItemCollapsibleState.Collapsed : None);
        item.id = n.id; item.description = repoLine(r);
        const failing = (r.prs ?? []).some(p => p.ci.state === "failing");
        item.iconPath = icon(r.state !== "ok" ? (r.state === "planned" ? ["circle-large-outline", MUTED] : r.state === "not-cloned" ? ["cloud", MUTED] : r.state === "restricted" ? ["shield", MUTED] : ["warning", WARN])
          : failing ? ["repo", ERR] : r.detached || (r.behind ?? 0) > 0 ? ["repo", WARN] : ["repo", OK]);
        item.tooltip = [
          `${r.label}${r.remote ? ` — ${r.remote}` : ""}`,
          r.state === "ok" ? `Branch: ${r.detached ? `detached at ${r.head?.slice(0, 7)}` : r.branch}${r.upstream ? ` → ${r.upstream}` : " (no upstream)"}` : r.detail,
          r.state === "ok" ? `Default branch: ${r.defaultBranch}` : "",
          r.counts ? `Changes: ${countsText(r.counts)}` : "",
          r.state === "ok" ? `Last fetch: ${ago(r.lastFetch) ?? "never"} (DataPass never fetches by itself: use Fetch all)` : "",
          r.hostData.kind === "cli" ? `Pull requests from ${r.hostData.source}` : r.hostData.kind === "links" ? `Pull requests: web links (${r.hostData.tool ?? ""} ${LINK_REASON[r.hostData.reason] ?? ""})` : ""
        ].filter(Boolean).join("\n");
        const web = r.host && repositoryWebLinks(r.host.web).length && r.state !== "planned";
        item.contextValue = `gitRepo.${r.section}.${r.state}${(r.behind ?? 0) > 0 ? ".behind" : ""}${web ? ".web" : ""}${r.branch ? ".branch" : ""}`;
        return item;
      }
      case "changes": {
        const c = n.r.counts!;
        const item = new vscode.TreeItem(`${c.staged + c.unstaged + c.untracked + c.conflicted} uncommitted change(s)`, None);
        item.id = n.id; item.description = countsText(c); item.iconPath = icon(["diff", c.conflicted ? ERR : WARN]);
        item.command = { command: "datapass.git.openSourceControl", title: "Open in Source Control", arguments: [n.r.key] };
        item.tooltip = "Open the repository in Source Control to review, commit or stash them.";
        return item;
      }
      case "group": {
        const r = n.r;
        const count = n.kind === "worktrees" ? r.worktrees.length : n.kind === "prs" ? r.prs?.length ?? 0 : r.merges.length;
        const label = n.kind === "worktrees" ? `Worktrees (${count})` : n.kind === "prs" ? `Pull requests (${count})` : "Recent merges";
        const item = new vscode.TreeItem(label, count ? vscode.TreeItemCollapsibleState.Collapsed : None);
        item.id = n.id;
        item.iconPath = icon(n.kind === "worktrees" ? ["list-tree"] : n.kind === "prs" ? ["git-pull-request"] : ["git-merge"]);
        if (n.kind === "prs") {
          const failing = (r.prs ?? []).filter(p => p.ci.state === "failing").length, running = (r.prs ?? []).filter(p => p.ci.state === "running").length;
          item.description = count ? [failing ? `${failing} ✗` : "", running ? `${running} ●` : "", r.hostData.kind === "cli" ? `via ${r.hostData.source}` : ""].filter(Boolean).join(" · ") : "no open pull request";
        } else if (n.kind === "worktrees") {
          const finished = r.worktrees.filter(w => w.finished).length;
          item.description = finished ? `${finished} finished` : undefined;
        } else item.description = ago(r.merges[0]?.at);
        item.contextValue = `gitGroup.${n.kind}`;
        return item;
      }
      case "worktree": {
        const w = n.w;
        const dirty = w.status ? w.status.staged + w.status.unstaged + w.status.untracked + w.status.conflicted : 0;
        const item = new vscode.TreeItem(w.branch ?? (w.detached ? `detached ${w.head?.slice(0, 7) ?? ""}` : "?"), None);
        item.id = n.id;
        const state = !w.status ? (w.prunable ? "folder missing (prunable)" : "not checked") : dirty ? `${dirty} change(s)` : "clean";
        const fin = w.finished ? (w.finished.how === "pr-closed" ? `PR #${w.finished.pr} closed` : w.finished.pr ? `PR #${w.finished.pr} merged` : "merged") : "";
        const sync = w.status?.upstream ? `${w.status.behind ? `↓${w.status.behind}` : ""}${w.status.ahead ? `↑${w.status.ahead}` : ""}` : w.branch ? "no upstream" : "";
        item.description = [w.name, state, sync, fin, w.locked ? "locked" : ""].filter(Boolean).join(" · ");
        item.iconPath = icon(w.finished ? (dirty ? ["warning", ERR] : ["trash", WARN]) : dirty ? ["diff", WARN] : ["folder", undefined]);
        item.tooltip = `${w.path}\n${item.description}${w.finished && !dirty && !w.locked ? "\nFinished and clean: copy the cleanup command (DataPass never deletes a worktree)." : ""}`;
        item.command = { command: "datapass.git.openInNewWindow", title: "Open in a new window", arguments: [n.r.key, w.path] };
        item.contextValue = `gitWorktree${w.finished && !dirty && !w.locked && w.status ? ".cleanup" : ""}${w.branch ? ".branch" : ""}`;
        return item;
      }
      case "pr": {
        const pr = n.pr;
        const item = new vscode.TreeItem(`#${pr.number} ${pr.title}`, None);
        item.id = n.id;
        item.description = [pr.head, `CI ${ciMark(pr)}`, pr.draft ? "draft" : "", REVIEW_TEXT[pr.review] ?? "", pr.mergeState === "DIRTY" ? "conflicts" : pr.mergeState === "BEHIND" ? "behind" : "", ago(pr.updatedAt)].filter(Boolean).join(" · ");
        item.iconPath = icon(CI_ICON[pr.ci.state] ?? ["git-pull-request"]);
        item.tooltip = `#${pr.number} ${pr.title}\n${pr.head}${pr.ci.total ? `\nChecks: ${pr.ci.passed} passed, ${pr.ci.running} running, ${pr.ci.failed.length} failed${pr.ci.failed.length ? ` (${pr.ci.failed.map(f => f.name).join(", ")})` : ""}` : pr.ci.state === "unknown" ? "\nCI: not reported by this CLI (open the pipelines page)" : "\nNo checks"}\n${pr.url}`;
        item.command = { command: "datapass.git.openPullRequest", title: "Open the pull request", arguments: [n.r.key, pr.number] };
        item.contextValue = `gitPr${pr.ci.state === "failing" ? ".failing" : ""}`;
        return item;
      }
      case "merge": {
        const m = n.r.merges[n.i]!;
        const item = new vscode.TreeItem(`${m.number ? `#${m.number} ` : ""}${m.title}`, None);
        item.id = n.id; item.description = [ago(m.at), m.sha?.slice(0, 7)].filter(Boolean).join(" · "); item.iconPath = icon(["git-merge"]);
        item.tooltip = `${m.title}${m.at ? `\nmerged ${m.at}` : ""}${m.url ? `\n${m.url}` : ""}`;
        if (m.number) item.command = { command: "datapass.git.openPullRequest", title: "Open the pull request", arguments: [n.r.key, m.number] };
        return item;
      }
      case "link": {
        const item = new vscode.TreeItem(n.label, None);
        item.id = n.id; item.description = n.description; item.iconPath = icon(["link-external"]);
        item.tooltip = `${n.label}${n.description ? `\n(${n.description})` : ""}\nOpens in your browser after you see the address.`;
        item.command = { command: "datapass.git.openOnWeb", title: "Open on the web", arguments: [n.r.key, n.linkId] };
        return item;
      }
      case "others": {
        const o = this.observer.observation();
        const folders = o.otherFolders;
        const item = new vscode.TreeItem(`Other repositories${folders.length ? ` in ${folders.map(f => f.replace(/[\\/]+$/, "")).join(", ")}` : ""}`, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = n.id; item.iconPath = icon(["folder-library"]);
        item.description = o.others ? `${o.others.length}${o.othersNeedsYou.length ? ` · ${o.othersNeedsYou.length} need you` : ""}` : "read when opened";
        item.tooltip = "Git repositories directly under datapass.projectsFolders (at most 60), besides this project's. Read when you open this section.";
        item.contextValue = "gitOthers";
        return item;
      }
    }
  }
}
