/**
 * Git module (0.19): what the Git view shows for each repository, and the deterministic "Needs you"
 * rules (handoff/v3/09 §6). Pure: the observer (src/work/gitObserver.ts) fills the reports from
 * read-only Git and host-CLI commands; this module only derives.
 *
 * Needs you, most urgent first:
 *   1 a PR whose CI failed
 *   2 a green PR (or one whose CI this host's CLI does not report) waiting for your review or merge
 *   3 a PR merged on the host but not pulled here
 *   4 uncommitted changes on the default branch of a main clone
 *   5 a worktree whose branch is merged or whose PR is closed (clean: cleanup candidate; dirty: work
 *     that might be lost)
 *   6 a branch with commits and no upstream, or ahead of it for more than a day (unpushed work)
 *   7 detached HEAD in a main clone
 *   (8, work orders without a PR, comes with pass AI-2)
 *
 * "Behind, with no local changes" is information, not "needs you". Nothing here deletes anything:
 * cleanup is a command the person copies and runs (Q7).
 */
import type { GitHostKind } from "../project/gitHosts";
import type { ClosedPullRequest, PullRequest } from "./hostPrs";
import { isBranchName, type StatusCounts } from "./porcelain";

export type RepoRole = "coordination" | "project" | "other";
export type RepoReportState = "ok" | "not-checked" | "not-a-repo" | "not-cloned" | "planned" | "wrong-remote" | "restricted";

export interface Unpushed { count: number; oldest?: string; noUpstream: boolean }

export interface WorktreeReport {
  /** Absolute path (extension host only; never sent to a webview). */
  path: string;
  /** Short display name: the path inside the repository, else the folder name. */
  name: string;
  branch?: string;
  detached: boolean;
  head?: string;
  locked: boolean;
  prunable: boolean;
  /** Undefined when its status could not be read (timeout, missing folder). */
  status?: { upstream?: string; ahead?: number; behind?: number } & StatusCounts;
  /** Its branch is merged into the default branch (Git sees it) or its PR is merged or closed on the host. */
  finished?: { how: "git-merged" | "pr-merged" | "pr-closed"; pr?: number };
  unpushed?: Unpushed;
}

/** Where the pull requests came from, or why they are not shown (the view then offers the web links). */
export type HostData =
  | { kind: "cli"; source: "gh" | "az" | "glab" }
  | { kind: "links"; reason: "not-installed" | "not-signed-in" | "failed" | "timeout" | "unsupported" | "not-checked"; tool?: string; detail?: string }
  | { kind: "no-host" };

export interface MergeInfo { number?: number; title: string; at?: string; url?: string; sha?: string }

export interface GitRepoReport {
  key: string;
  label: string;
  section: "project" | "other";
  role: RepoRole;
  state: RepoReportState;
  /** Why it is not checked, or the plain-language state of a repository that is not here. */
  detail?: string;
  host?: { kind: GitHostKind; label: string; web: string };
  /** Declared or observed remote identity (host/owner/repo). */
  remote?: string;
  branch?: string;
  detached?: boolean;
  head?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  lastFetch?: string;
  counts?: StatusCounts;
  defaultBranch?: string;
  worktrees: WorktreeReport[];
  /** Open pull requests; undefined when the host's CLI is not available (see hostData). */
  prs?: PullRequest[];
  closed?: ClosedPullRequest[];
  merges: MergeInfo[];
  hostData: HostData;
  unpushed?: Unpushed;
  /** The latest merged PR is not in this clone's default branch (fetched: its commit is here, only not merged). */
  mergeNotPulled?: { number: number; title: string; fetched: boolean };
  /** When this report's Git data was read. */
  checkedAt?: string;
}

export type NeedsYouKind = "ci-failed" | "pr-waiting" | "merged-not-pulled" | "dirty-default" | "worktree-cleanup" | "worktree-at-risk" | "unpushed" | "detached";
export type NeedsYouAction = "open-ci" | "open-pr" | "check-updates" | "get-updates" | "source-control" | "copy-cleanup" | "open-worktree";

export interface NeedsYou {
  rank: number;
  kind: NeedsYouKind;
  repoKey: string;
  section: "project" | "other";
  repoLabel: string;
  text: string;
  detail: string;
  action: NeedsYouAction;
  pr?: number;
  worktree?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const changes = (c: StatusCounts | undefined) => c ? c.staged + c.unstaged + c.untracked + c.conflicted : 0;

export function needsYou(reports: readonly GitRepoReport[], now = Date.now()): NeedsYou[] {
  const out: NeedsYou[] = [];
  const add = (r: GitRepoReport, n: Omit<NeedsYou, "repoKey" | "section" | "repoLabel">) => out.push({ ...n, repoKey: r.key, section: r.section, repoLabel: r.label });
  for (const r of reports) {
    if (r.state !== "ok") continue;
    for (const pr of r.prs ?? []) {
      if (pr.ci.state === "failing") {
        const names = pr.ci.failed.map(f => f.name).slice(0, 3).join(", ");
        add(r, { rank: 1, kind: "ci-failed", text: `PR #${pr.number} CI failed${names ? ` (${names})` : ""}`, detail: `${pr.title} · ${pr.head}`, action: "open-ci", pr: pr.number });
      } else if (!pr.draft && pr.review !== "changes-requested" && pr.ci.state !== "running") {
        const how = pr.ci.state === "passing" ? "is green" : pr.ci.state === "none" ? "has no checks" : "is open (CI not reported here)";
        add(r, { rank: 2, kind: "pr-waiting", text: `PR #${pr.number} ${how}: review and merge`, detail: `${pr.title} · ${pr.head}${pr.review === "approved" ? " · approved" : ""}`, action: "open-pr", pr: pr.number });
      }
    }
    if (r.mergeNotPulled) {
      const m = r.mergeNotPulled;
      add(r, { rank: 3, kind: "merged-not-pulled", text: `PR #${m.number} merged on ${r.host?.label ?? "the host"}, not pulled here`, detail: `${m.title} · ${m.fetched ? "fetched: Get updates" : "not fetched yet: Check for updates"}`, action: m.fetched ? "get-updates" : "check-updates", pr: m.number });
    }
    const n = changes(r.counts);
    if (n && !r.detached && r.branch && r.branch === r.defaultBranch) {
      add(r, { rank: 4, kind: "dirty-default", text: `${plural(n, "uncommitted file")} on ${r.branch}`, detail: countsText(r.counts!), action: "source-control" });
    }
    for (const w of r.worktrees) {
      if (!w.finished) continue;
      const how = w.finished.how === "pr-closed" ? `PR #${w.finished.pr} closed` : w.finished.pr ? `PR #${w.finished.pr} merged` : "merged";
      if (!w.status) continue;
      const dirty = changes(w.status);
      if (dirty) add(r, { rank: 5, kind: "worktree-at-risk", text: `worktree ${w.name}: ${how}, ${plural(dirty, "change")} not committed`, detail: `${w.branch ?? "detached"} · work that might be lost: open it`, action: "open-worktree", worktree: w.path });
      else if (w.locked) continue;
      else add(r, { rank: 5, kind: "worktree-cleanup", text: `worktree ${w.name}: ${how}, clean`, detail: `${w.branch ?? "detached"} · copy the cleanup command`, action: "copy-cleanup", worktree: w.path });
    }
    const unpushed = (u: Unpushed | undefined, ahead: number | undefined) =>
      !!u && u.count > 0 && (u.noUpstream || ((ahead ?? 0) > 0 && !!u.oldest && now - Date.parse(u.oldest) > DAY_MS));
    if (!r.detached && unpushed(r.unpushed, r.ahead)) {
      add(r, { rank: 6, kind: "unpushed", text: `${r.branch}: ${plural(r.unpushed!.count, "commit")} ${r.unpushed!.noUpstream ? "never pushed (no upstream)" : "not pushed for more than a day"}`, detail: "unpushed work: push it from Source Control", action: "source-control" });
    }
    for (const w of r.worktrees) {
      if (w.finished || w.detached || !unpushed(w.unpushed, w.status?.ahead)) continue;
      add(r, { rank: 6, kind: "unpushed", text: `worktree ${w.name}: ${plural(w.unpushed!.count, "commit")} ${w.unpushed!.noUpstream ? "never pushed" : "not pushed for more than a day"}`, detail: `${w.branch} · unpushed work`, action: "open-worktree", worktree: w.path });
    }
    if (r.detached) add(r, { rank: 7, kind: "detached", text: `detached HEAD at ${r.head?.slice(0, 7) ?? "?"}`, detail: "the main clone is on no branch: switch to a branch in Source Control", action: "source-control" });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export function countsText(c: StatusCounts): string {
  const parts = [c.staged ? `${c.staged} staged` : "", c.unstaged ? `${c.unstaged} unstaged` : "", c.untracked ? `${c.untracked} untracked` : "", c.conflicted ? `${c.conflicted} conflicted` : ""].filter(Boolean);
  return parts.join(" · ") || "clean";
}

/** "4 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const CI_MARK: Record<string, string> = { failing: "✗", running: "●", passing: "✓", none: "–", unknown: "?" };
export const ciMark = (pr: PullRequest) => CI_MARK[pr.ci.state] ?? "?";

/** One line for the repository row: role · host · branch and sync · changes · last fetch. */
export function repoLine(r: GitRepoReport, now = Date.now()): string {
  const parts: string[] = [r.role === "coordination" ? "coordination" : "", r.host?.label ?? ""];
  if (r.state !== "ok") return [...parts, r.detail ?? r.state].filter(Boolean).join(" · ");
  let branch = r.detached ? `detached ${r.head?.slice(0, 7) ?? ""}`.trim() : r.branch ?? "?";
  if (!r.detached) {
    if (!r.upstream) branch += " (no upstream)";
    else if (r.behind || r.ahead) branch += `${r.behind ? ` ↓${r.behind}` : ""}${r.ahead ? ` ↑${r.ahead}` : ""}`;
    else branch += " ✓";
  }
  parts.push(branch);
  const n = changes(r.counts);
  if (n) parts.push(plural(n, "change"));
  const failing = (r.prs ?? []).filter(p => p.ci.state === "failing").length;
  if (r.prs?.length) parts.push(`${plural(r.prs.length, "PR")}${failing ? ` (${failing} ✗)` : ""}`);
  const fetched = ago(r.lastFetch, now);
  parts.push(fetched ? `fetched ${fetched}` : "never fetched");
  return parts.filter(Boolean).join(" · ");
}

export interface GitSummary {
  repositories: number;
  checked: number;
  needsYou: number;
  openPrs: number;
  failing: number;
  /** The oldest last-fetch time among the checked repositories (the one to worry about). */
  oldestFetch?: string;
  top?: string;
}

export function gitSummary(reports: readonly GitRepoReport[], items: readonly NeedsYou[]): GitSummary {
  const checked = reports.filter(r => r.state === "ok");
  const prs = checked.flatMap(r => r.prs ?? []);
  const fetches = checked.map(r => r.lastFetch).filter((t): t is string => !!t).sort();
  return {
    repositories: reports.length, checked: checked.length, needsYou: items.length,
    openPrs: prs.length, failing: prs.filter(p => p.ci.state === "failing").length,
    oldestFetch: fetches[0], top: items[0] ? `${items[0].repoLabel}: ${items[0].text}` : undefined
  };
}

/** Paths and names DataPass puts between single quotes in a copied command (bash and PowerShell). */
const QUOTABLE = /^[^'\u0000-\u001f`]{1,1000}$/;

/**
 * The cleanup commands for a finished, clean worktree, to copy and run yourself. `-d` when Git sees
 * the branch merged; `-D` when only the host says so (a squash merge is not an ancestor), with a
 * comment saying why. Undefined when a path or branch cannot be quoted safely, or the worktree is
 * locked or dirty.
 */
export function cleanupCommand(repoFolder: string, w: WorktreeReport): string | undefined {
  if (!w.finished || w.locked || !w.status || changes(w.status)) return undefined;
  const repo = repoFolder.replace(/\\/g, "/"), path = w.path.replace(/\\/g, "/");
  if (!QUOTABLE.test(repo) || !QUOTABLE.test(path)) return undefined;
  const lines = [`git -C '${repo}' worktree remove '${path}'`];
  if (w.branch && isBranchName(w.branch)) {
    if (w.finished.how === "git-merged") lines.push(`git -C '${repo}' branch -d ${w.branch}`);
    else if (w.finished.how === "pr-merged") lines.push(`# PR #${w.finished.pr} was merged on the host (squash or rebase), so Git needs -D to delete the branch`, `git -C '${repo}' branch -D ${w.branch}`);
    else lines.push(`# PR #${w.finished.pr} was closed without merging: delete the branch only if you do not need its commits`, `git -C '${repo}' branch -D ${w.branch}`);
  }
  return lines.join("\n");
}
