/**
 * Git module (0.19): pull requests from the host's own CLI, read-only. Pure: argument builders and
 * strict parsers; the observer (src/work/gitObserver.ts) runs the commands.
 *
 *   GitHub        gh pr list -R owner/repo --state open|closed --json …   (gh signed in)
 *   Azure DevOps  az repos pr list … --status all -o json                 (az + its azure-devops extension)
 *   GitLab        glab mr list -R <repository URL> --all -F json          (glab signed in)
 *
 * Without the CLI the Git view shows the 0.16 web links instead. The CLI's JSON is untrusted: every
 * field is type-checked and bounded, and no URL is taken from it except a check's page on the same
 * repository. PR and merge-request pages are rebuilt from the repository's own web address.
 */
import type { GitHostRepo } from "../project/gitHosts";
import { clean, isBranchName, isSha } from "./porcelain";

export type CiState = "failing" | "running" | "passing" | "none" | "unknown";

export interface CiRollup {
  state: CiState;
  total: number;
  passed: number;
  running: number;
  /** Failed checks (name and, when it is a page of this repository, its URL). */
  failed: Array<{ name: string; url?: string }>;
}

export type ReviewState = "approved" | "changes-requested" | "review-required" | "none";

export interface PullRequest {
  number: number;
  title: string;
  head: string;
  draft: boolean;
  review: ReviewState;
  ci: CiRollup;
  /** GitHub's merge state (CLEAN, BLOCKED, BEHIND, DIRTY…), Azure DevOps' mergeStatus. */
  mergeState?: string;
  /** Rebuilt from the repository's web address, never taken from the CLI's output. */
  url: string;
  updatedAt?: string;
}

export interface ClosedPullRequest {
  number: number;
  title: string;
  head: string;
  state: "merged" | "closed";
  mergedAt?: string;
  url: string;
  mergeCommit?: string;
}

export interface HostPrs { source: "gh" | "az" | "glab"; open: PullRequest[]; closed: ClosedPullRequest[] }

export const MAX_PRS = 30;
const MAX_CHECKS = 200;

const GH_OPEN_FIELDS = "number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,mergeStateStatus,updatedAt";
const GH_CLOSED_FIELDS = "number,title,headRefName,state,mergedAt,mergeCommit";

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** `gh pr list` for a github.com repository, or undefined when its name cannot be passed safely. */
export function ghPrListArgs(h: GitHostRepo, state: "open" | "closed"): string[] | undefined {
  if (h.kind !== "github" || !h.owner || !OWNER.test(h.owner) || !REPO.test(h.name) || h.name === "." || h.name === "..") return undefined;
  return ["pr", "list", "--repo", `${h.owner}/${h.name}`, "--state", state, "--limit", String(MAX_PRS), "--json", state === "open" ? GH_OPEN_FIELDS : GH_CLOSED_FIELDS];
}

/** Tokens that stay literal inside double quotes for cmd.exe (az is az.cmd on Windows). */
export const CMD_SAFE = /^[A-Za-z0-9._:/=@ -]{1,300}$/;
const ADO_NAME = /^[A-Za-z0-9._ -]{1,100}$/;

/** `az repos pr list` for an Azure DevOps repository (active and completed pull requests). */
export function azPrListArgs(h: GitHostRepo): string[] | undefined {
  if (h.kind !== "azure-devops" || !h.org || !h.project) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(h.org) || !ADO_NAME.test(h.project) || !ADO_NAME.test(h.name)) return undefined;
  return ["repos", "pr", "list", "--organization", `https://dev.azure.com/${h.org}`, "--project", h.project, "--repository", h.name, "--status", "all", "--top", "50", "--output", "json", "--only-show-errors"];
}

/** `glab mr list` for a GitLab repository (its full https address names the host and the project). */
export function glabMrListArgs(h: GitHostRepo): string[] | undefined {
  if (h.kind !== "gitlab" || !/^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._\/-]{1,300}$/.test(h.web)) return undefined;
  return ["mr", "list", "--repo", h.web, "--all", "--per-page", "50", "--output", "json"];
}

const obj = (v: unknown): Record<string, unknown> | undefined => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const str = (v: unknown, max = 200): string | undefined => typeof v === "string" && v.length <= 10_000 ? clean(v, max) : undefined;
const posInt = (v: unknown): number | undefined => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9 ? v : undefined;
const isoDate = (v: unknown): string | undefined => typeof v === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:?\d\d)?$/.test(v) ? v : undefined;
const branchOf = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.replace(/^refs\/heads\//, "") : undefined;
  return s && isBranchName(s) ? s : s ? clean(s, 200) : undefined;
};

function parseArray(stdout: string): unknown[] | undefined {
  if (stdout.length > 8 * 1024 * 1024) return undefined;
  try {
    const v: unknown = JSON.parse(stdout);
    return Array.isArray(v) ? v.slice(0, 100) : undefined;
  } catch { return undefined; }
}

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);

/** GitHub's statusCheckRollup (check runs and commit statuses) as one state. */
export function ciRollup(value: unknown, repoWeb: string): CiRollup {
  const out: CiRollup = { state: "none", total: 0, passed: 0, running: 0, failed: [] };
  if (!Array.isArray(value)) return out;
  for (const raw of value.slice(0, MAX_CHECKS)) {
    const c = obj(raw);
    if (!c) continue;
    const name = str(c.name ?? c.context ?? c.workflowName, 120) || "check";
    const page = typeof (c.detailsUrl ?? c.targetUrl) === "string" ? String(c.detailsUrl ?? c.targetUrl) : undefined;
    const url = page && page.startsWith(`${repoWeb}/`) && /^https:\/\/[^\s"<>]+$/.test(page) && page.length <= 500 ? page : undefined;
    out.total++;
    if (c.__typename === "StatusContext" || (c.state !== undefined && c.status === undefined)) {
      const s = String(c.state ?? "");
      if (s === "SUCCESS") out.passed++;
      else if (s === "FAILURE" || s === "ERROR") out.failed.push({ name, url });
      else out.running++;
      continue;
    }
    const status = String(c.status ?? "");
    const conclusion = String(c.conclusion ?? "");
    if (status !== "COMPLETED") out.running++;
    else if (FAILED_CONCLUSIONS.has(conclusion)) out.failed.push({ name, url });
    else out.passed++;
  }
  out.state = out.failed.length ? "failing" : out.running ? "running" : out.total ? "passing" : "none";
  return out;
}

const REVIEW: Record<string, ReviewState> = { APPROVED: "approved", CHANGES_REQUESTED: "changes-requested", REVIEW_REQUIRED: "review-required" };

/** `gh pr list --state open --json …` */
export function parseGhOpen(stdout: string, h: GitHostRepo): PullRequest[] | undefined {
  const rows = parseArray(stdout);
  if (!rows) return undefined;
  const out: PullRequest[] = [];
  for (const raw of rows) {
    const r = obj(raw);
    const number = posInt(r?.number);
    if (!r || !number) continue;
    const mergeState = typeof r.mergeStateStatus === "string" && /^[A-Z_]{1,30}$/.test(r.mergeStateStatus) ? r.mergeStateStatus : undefined;
    out.push({
      number, title: str(r.title) ?? `#${number}`, head: branchOf(r.headRefName) ?? "?", draft: r.isDraft === true,
      review: REVIEW[String(r.reviewDecision ?? "")] ?? "none", ci: ciRollup(r.statusCheckRollup, h.web),
      mergeState, url: `${h.web}/pull/${number}`, updatedAt: isoDate(r.updatedAt)
    });
    if (out.length >= MAX_PRS) break;
  }
  return out;
}

/** `gh pr list --state closed --json …` (closed includes merged). */
export function parseGhClosed(stdout: string, h: GitHostRepo): ClosedPullRequest[] | undefined {
  const rows = parseArray(stdout);
  if (!rows) return undefined;
  const out: ClosedPullRequest[] = [];
  for (const raw of rows) {
    const r = obj(raw);
    const number = posInt(r?.number);
    if (!r || !number) continue;
    const merged = r.state === "MERGED";
    const oid = obj(r.mergeCommit)?.oid;
    out.push({ number, title: str(r.title) ?? `#${number}`, head: branchOf(r.headRefName) ?? "?", state: merged ? "merged" : "closed", mergedAt: merged ? isoDate(r.mergedAt) : undefined, url: `${h.web}/pull/${number}`, mergeCommit: typeof oid === "string" && isSha(oid) ? oid : undefined });
    if (out.length >= MAX_PRS) break;
  }
  return out;
}

const UNKNOWN_CI: CiRollup = { state: "unknown", total: 0, passed: 0, running: 0, failed: [] };

/** `az repos pr list --status all -o json`. Build status is not in this list: CI stays "unknown" (the pipeline page shows it). */
export function parseAzPrs(stdout: string, h: GitHostRepo): HostPrs | undefined {
  const rows = parseArray(stdout);
  if (!rows) return undefined;
  const open: PullRequest[] = [], closed: ClosedPullRequest[] = [];
  for (const raw of rows) {
    const r = obj(raw);
    const number = posInt(r?.pullRequestId);
    if (!r || !number) continue;
    const title = str(r.title) ?? `!${number}`;
    const head = branchOf(r.sourceRefName) ?? "?";
    const url = `${h.web}/pullrequest/${number}`;
    if (r.status === "active" && open.length < MAX_PRS) {
      const votes = Array.isArray(r.reviewers) ? r.reviewers.slice(0, 50).map(v => obj(v)?.vote).filter((v): v is number => typeof v === "number") : [];
      const review: ReviewState = votes.some(v => v < 0) ? "changes-requested" : votes.some(v => v >= 5) ? "approved" : votes.length ? "review-required" : "none";
      const mergeState = typeof r.mergeStatus === "string" && /^[A-Za-z]{1,30}$/.test(r.mergeStatus) ? r.mergeStatus : undefined;
      open.push({ number, title, head, draft: r.isDraft === true, review, ci: UNKNOWN_CI, mergeState, url });
    } else if ((r.status === "completed" || r.status === "abandoned") && closed.length < MAX_PRS) {
      const commit = obj(r.lastMergeCommit)?.commitId;
      closed.push({ number, title, head, state: r.status === "completed" ? "merged" : "closed", mergedAt: r.status === "completed" ? isoDate(r.closedDate) : undefined, url, mergeCommit: typeof commit === "string" && isSha(commit) ? commit : undefined });
    }
  }
  return { source: "az", open, closed };
}

/** `glab mr list --all -F json` (GitLab API field names). Pipelines are not in this list: CI stays "unknown". */
export function parseGlabMrs(stdout: string, h: GitHostRepo): HostPrs | undefined {
  const rows = parseArray(stdout);
  if (!rows) return undefined;
  const open: PullRequest[] = [], closed: ClosedPullRequest[] = [];
  for (const raw of rows) {
    const r = obj(raw);
    const number = posInt(r?.iid);
    if (!r || !number) continue;
    const title = str(r.title) ?? `!${number}`;
    const head = branchOf(r.source_branch) ?? "?";
    const url = `${h.web}/-/merge_requests/${number}`;
    if (r.state === "opened" && open.length < MAX_PRS) {
      const pipeline = String(obj(r.head_pipeline)?.status ?? obj(r.pipeline)?.status ?? "");
      const ci: CiRollup = pipeline === "failed" ? { state: "failing", total: 1, passed: 0, running: 0, failed: [{ name: "pipeline" }] }
        : pipeline === "success" ? { state: "passing", total: 1, passed: 1, running: 0, failed: [] }
        : /^(running|pending|created|preparing|waiting_for_resource|scheduled)$/.test(pipeline) ? { state: "running", total: 1, passed: 0, running: 1, failed: [] }
        : UNKNOWN_CI;
      open.push({ number, title, head, draft: r.draft === true || r.work_in_progress === true, review: "none", ci, url, updatedAt: isoDate(r.updated_at) });
    } else if ((r.state === "merged" || r.state === "closed") && closed.length < MAX_PRS) {
      const sha = [r.squash_commit_sha, r.merge_commit_sha].find(s => typeof s === "string" && isSha(s)) as string | undefined;
      closed.push({ number, title, head, state: r.state === "merged" ? "merged" : "closed", mergedAt: r.state === "merged" ? isoDate(r.merged_at) : undefined, url, mergeCommit: sha });
    }
  }
  return { source: "glab", open, closed };
}

/** Merged pull requests, newest first. */
export function recentMerged(closed: readonly ClosedPullRequest[], max = 3): ClosedPullRequest[] {
  return closed.filter(p => p.state === "merged").sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? "")).slice(0, max);
}
