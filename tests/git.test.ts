/**
 * 0.19 Git module (pass AI-1): porcelain v2 and worktree parsers, gh / az / glab JSON, the Needs you
 * rules, the copied cleanup command, and hostile inputs (control characters, foreign URLs, option-like
 * names, cmd.exe metacharacters). Synthetic repositories only.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isBranchName, oldestDate, parseDefaultBranch, parseMergeLog, parseRefList, parseWorktrees, statusCounts, clean, MAX_WORKTREES } from "../src/core/git/porcelain";
import { azPrListArgs, ciRollup, ghPrListArgs, glabMrListArgs, parseAzPrs, parseGhClosed, parseGhOpen, parseGlabMrs, recentMerged, MAX_PRS, type PullRequest } from "../src/core/git/hostPrs";
import { ago, cleanupCommand, gitSummary, needsYou, repoLine, type GitRepoReport, type WorktreeReport } from "../src/core/git/gitReport";
import { cmdLine, Limiter } from "../src/core/git/run";
import { resolveCommandOrScript } from "../src/core/exec";
import { gitHostOf } from "../src/core/project/gitHosts";

const SHA1 = "a".repeat(40), SHA2 = "b".repeat(40), SHA3 = "c".repeat(40);
const NOW = Date.parse("2026-09-25T18:00:00Z");
const GH = gitHostOf("https://github.com/example-org/research-pipeline")!;
const ADO = gitHostOf("https://example-org@dev.azure.com/example-org/shop%20platform/_git/orders-api")!;
const GL = gitHostOf("https://gitlab.com/example-group/data/etl")!;

// ------------------------------------------------------------------ porcelain v2 and worktrees

test("statusCounts splits staged, unstaged, untracked and conflicted entries", () => {
  const out = [
    "# branch.oid " + SHA1, "# branch.head main", "# branch.upstream origin/main", "# branch.ab +1 -2",
    "1 M. N... 100644 100644 100644 " + SHA1 + " " + SHA2 + " staged.txt",
    "1 .M N... 100644 100644 100644 " + SHA1 + " " + SHA1 + " unstaged.txt",
    "1 MM N... 100644 100644 100644 " + SHA1 + " " + SHA2 + " both.txt",
    "2 R. N... 100644 100644 100644 " + SHA1 + " " + SHA1 + " R100 new.txt\told.txt",
    "u UU N... 100644 100644 100644 100644 " + SHA1 + " " + SHA2 + " " + SHA3 + " conflict.txt",
    "? untracked.txt", "? other.txt", "! ignored.log"
  ].join("\n");
  assert.deepEqual(statusCounts(out), { staged: 3, unstaged: 2, untracked: 2, conflicted: 1 });
  assert.deepEqual(statusCounts("# branch.oid " + SHA1 + "\r\n# branch.head main\r\n"), { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
});

test("parseWorktrees reads the main worktree, branches, detached, locked, prunable and bare entries", () => {
  const out = [
    `worktree D:/PROJ/research-hub\nHEAD ${SHA1}\nbranch refs/heads/main`,
    `worktree D:/PROJ/research-hub/.claude/worktrees/fix-a\nHEAD ${SHA2}\nbranch refs/heads/claude/fix-a`,
    `worktree D:/PROJ/elsewhere/review\nHEAD ${SHA3}\ndetached\nlocked reason: on a USB disk`,
    `worktree D:/PROJ/gone\nHEAD ${SHA3}\nbranch refs/heads/old\nprunable gitdir file points to non-existent location`,
    "worktree D:/PROJ/bare.git\nbare"
  ].join("\n\n") + "\n";
  const w = parseWorktrees(out);
  assert.equal(w.length, 5);
  assert.deepEqual(w[1], { path: "D:/PROJ/research-hub/.claude/worktrees/fix-a", head: SHA2, branch: "claude/fix-a", detached: false, bare: false, locked: false, prunable: false });
  assert.equal(w[2]!.detached, true); assert.equal(w[2]!.locked, true); assert.equal(w[2]!.branch, undefined);
  assert.equal(w[3]!.prunable, true);
  assert.equal(w[4]!.bare, true);
});

test("parseWorktrees drops hostile paths and bounds the list", () => {
  const evil = `worktree D:/x\u0007\u001b[31mred\nHEAD ${SHA1}\nbranch refs/heads/x`;
  const tagged = `worktree D:/ok\nHEAD nothex\nbranch refs/tags/v1`;
  const w = parseWorktrees([`worktree D:/main\nHEAD ${SHA1}\nbranch refs/heads/main`, evil, tagged].join("\n\n"));
  assert.deepEqual(w.map(x => x.path), ["D:/main", "D:/ok"], "a path with control characters is not listed");
  assert.equal(w[1]!.head, undefined, "a HEAD that is not a SHA is ignored");
  assert.equal(w[1]!.branch, undefined, "only refs/heads/ are branches");
  const many = Array.from({ length: 80 }, (_, i) => `worktree D:/w${i}\nHEAD ${SHA1}\nbranch refs/heads/b${i}`).join("\n\n");
  assert.equal(parseWorktrees(many).length, MAX_WORKTREES + 1);
});

test("merge log, ref lists, default branch, branch names and dates", () => {
  const log = `${SHA1}\t2026-09-25T10:00:00+02:00\tMerge pull request #12 from x/y\n${SHA2}\tnot-a-date\tbad\nzzz\t2026-09-25T10:00:00Z\tbad sha\n`;
  assert.deepEqual(parseMergeLog(log), [{ sha: SHA1, date: "2026-09-25T10:00:00+02:00", subject: "Merge pull request #12 from x/y" }]);
  assert.deepEqual([...parseRefList("main\nclaude/fix-a\n\nx\u0000y\n")], ["main", "claude/fix-a"]);
  assert.equal(parseDefaultBranch("origin/main\n"), "main");
  assert.equal(parseDefaultBranch("origin/release/2026\n"), "release/2026");
  assert.equal(parseDefaultBranch("garbage"), undefined);
  for (const good of ["main", "claude/fix-a", "feature/x.y", "v1+2"]) assert.equal(isBranchName(good), true, good);
  for (const bad of ["-rf", "--exec=calc", "a..b", "x.lock", "a b", "a;rm", "/abs", "end/", "", "é"]) assert.equal(isBranchName(bad), false, bad);
  assert.deepEqual(oldestDate("2026-09-25T10:00:00Z\n2026-09-20T10:00:00Z\n"), { count: 2, oldest: "2026-09-20T10:00:00Z" });
  assert.equal(clean("a\u202Eevil\u0007 name  "), "aevil name");
});

// ------------------------------------------------------------------ host CLIs

test("gh arguments name the repository explicitly; unsafe names give no command", () => {
  assert.deepEqual(ghPrListArgs(GH, "open"), ["pr", "list", "--repo", "example-org/research-pipeline", "--state", "open", "--limit", "30", "--json", "number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,mergeStateStatus,updatedAt"]);
  assert.equal(ghPrListArgs(GH, "closed")!.at(-1), "number,title,headRefName,state,mergedAt,mergeCommit");
  assert.equal(ghPrListArgs({ ...GH, owner: "-R" }, "open"), undefined);
  assert.equal(ghPrListArgs({ ...GH, name: ".." }, "open"), undefined);
  assert.equal(ghPrListArgs(ADO, "open"), undefined);
  assert.deepEqual(azPrListArgs(ADO)?.slice(0, 9), ["repos", "pr", "list", "--organization", "https://dev.azure.com/example-org", "--project", "shop platform", "--repository", "orders-api"]);
  assert.equal(azPrListArgs({ ...ADO, project: "a&calc" }), undefined);
  assert.deepEqual(glabMrListArgs(GL), ["mr", "list", "--repo", "https://gitlab.com/example-group/data/etl", "--all", "--per-page", "50", "--output", "json"]);
});

test("CI rollup: failures win, then running, then passing; only this repository's pages are kept", () => {
  const web = GH.web;
  const runs = (xs: object[]) => ciRollup(xs, web);
  assert.equal(runs([]).state, "none");
  assert.equal(runs([{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }, { __typename: "CheckRun", name: "skip", status: "COMPLETED", conclusion: "SKIPPED" }]).state, "passing");
  assert.equal(runs([{ __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: "" }, { __typename: "CheckRun", name: "a", status: "COMPLETED", conclusion: "SUCCESS" }]).state, "running");
  const failing = runs([
    { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: `${web}/actions/runs/1/job/2` },
    { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: "https://evil.example/phish" },
    { __typename: "StatusContext", context: "ci/legacy", state: "ERROR", targetUrl: `${web}.evil.example/x` },
    { __typename: "StatusContext", context: "deploy", state: "PENDING" }
  ]);
  assert.equal(failing.state, "failing");
  assert.deepEqual(failing.failed, [{ name: "lint", url: `${web}/actions/runs/1/job/2` }, { name: "e2e", url: undefined }, { name: "ci/legacy", url: undefined }]);
  assert.equal(failing.running, 1);
  assert.equal(runs("not an array" as unknown as object[]).state, "none");
});

test("gh open PRs: URLs are rebuilt, text is cleaned, bad rows are skipped, the list is bounded", () => {
  const rows = [
    { number: 38, title: "Fix lint\u001b[2J", headRefName: "claude/fix-lint", isDraft: false, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", updatedAt: "2026-09-25T16:00:00Z", url: "https://evil.example/pull/38", statusCheckRollup: [{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" }] },
    { number: -1, title: "negative" }, { number: "7", title: "string number" }, null, "text",
    { number: 41, title: "Green", headRefName: "--upload-pack=calc", isDraft: true, reviewDecision: "APPROVED", mergeStateStatus: "clean; rm", statusCheckRollup: [] }
  ];
  const prs = parseGhOpen(JSON.stringify(rows), GH)!;
  assert.equal(prs.length, 2);
  assert.deepEqual({ ...prs[0], ci: prs[0]!.ci.state }, { number: 38, title: "Fix lint[2J", head: "claude/fix-lint", draft: false, review: "review-required", ci: "failing", mergeState: "BLOCKED", url: "https://github.com/example-org/research-pipeline/pull/38", updatedAt: "2026-09-25T16:00:00Z" });
  assert.equal(prs[1]!.mergeState, undefined, "a merge state outside A-Z_ is dropped");
  assert.equal(prs[1]!.draft, true);
  assert.equal(parseGhOpen("{not json", GH), undefined);
  assert.equal(parseGhOpen(JSON.stringify({ number: 1 }), GH), undefined);
  const many = Array.from({ length: 90 }, (_, i) => ({ number: i + 1, title: `t${i}`, headRefName: `b${i}` }));
  assert.equal(parseGhOpen(JSON.stringify(many), GH)!.length, MAX_PRS);
});

test("gh closed PRs: merged versus closed, merge commits checked, newest merges first", () => {
  const rows = [
    { number: 11, title: "old", headRefName: "a", state: "MERGED", mergedAt: "2026-09-20T10:00:00Z", mergeCommit: { oid: SHA1 } },
    { number: 12, title: "new", headRefName: "claude/fix-a", state: "MERGED", mergedAt: "2026-09-25T10:00:00Z", mergeCommit: { oid: "not-a-sha" } },
    { number: 13, title: "dropped", headRefName: "claude/abandon", state: "CLOSED", mergedAt: null }
  ];
  const closed = parseGhClosed(JSON.stringify(rows), GH)!;
  assert.deepEqual(closed.map(p => [p.number, p.state, p.mergeCommit]), [[11, "merged", SHA1], [12, "merged", undefined], [13, "closed", undefined]]);
  assert.deepEqual(recentMerged(closed).map(p => p.number), [12, 11]);
});

test("az and glab lists: open versus closed, review votes, URLs from the repository address", () => {
  const az = parseAzPrs(JSON.stringify([
    { pullRequestId: 5, title: "Add orders index", sourceRefName: "refs/heads/feature/index", status: "active", isDraft: false, mergeStatus: "succeeded", reviewers: [{ vote: 10 }, { vote: 0 }] },
    { pullRequestId: 6, title: "Rejected", sourceRefName: "refs/heads/x", status: "active", reviewers: [{ vote: -10 }] },
    { pullRequestId: 4, title: "Done", sourceRefName: "refs/heads/feature/done", status: "completed", closedDate: "2026-09-24T09:00:00Z", lastMergeCommit: { commitId: SHA2 } },
    { pullRequestId: 3, title: "Abandoned", sourceRefName: "refs/heads/y", status: "abandoned" }
  ]), ADO)!;
  assert.deepEqual(az.open.map(p => [p.number, p.head, p.review, p.ci.state, p.url]), [
    [5, "feature/index", "approved", "unknown", "https://dev.azure.com/example-org/shop%20platform/_git/orders-api/pullrequest/5"],
    [6, "x", "changes-requested", "unknown", "https://dev.azure.com/example-org/shop%20platform/_git/orders-api/pullrequest/6"]
  ]);
  assert.deepEqual(az.closed.map(p => [p.number, p.state, p.mergeCommit]), [[4, "merged", SHA2], [3, "closed", undefined]]);
  const gl = parseGlabMrs(JSON.stringify([
    { iid: 9, title: "ETL retries", source_branch: "retries", state: "opened", draft: false, head_pipeline: { status: "failed" }, web_url: "https://evil.example" },
    { iid: 8, title: "Merged", source_branch: "m", state: "merged", merged_at: "2026-09-23T08:00:00Z", squash_commit_sha: SHA3 }
  ]), GL)!;
  assert.equal(gl.open[0]!.url, "https://gitlab.com/example-group/data/etl/-/merge_requests/9");
  assert.equal(gl.open[0]!.ci.state, "failing");
  assert.deepEqual(gl.closed.map(p => [p.number, p.mergeCommit]), [[8, SHA3]]);
});

// ------------------------------------------------------------------ Needs you

const pr = (over: Partial<PullRequest>): PullRequest => ({ number: 1, title: "t", head: "h", draft: false, review: "none", ci: { state: "passing", total: 1, passed: 1, running: 0, failed: [] }, url: `${GH.web}/pull/1`, ...over });
const repo = (over: Partial<GitRepoReport>): GitRepoReport => ({
  key: "pipeline", label: "research-pipeline", section: "project", role: "project", state: "ok", worktrees: [], merges: [], hostData: { kind: "cli", source: "gh" },
  host: { kind: "github", label: "GitHub", web: GH.web }, branch: "main", detached: false, head: SHA1, upstream: "origin/main", ahead: 0, behind: 0,
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }, defaultBranch: "main", prs: [], lastFetch: "2026-09-25T17:56:00Z", ...over
});
const wt = (over: Partial<WorktreeReport>): WorktreeReport => ({ path: "D:/PROJ/research-pipeline/.claude/worktrees/fix-a", name: ".claude/worktrees/fix-a", branch: "claude/fix-a", detached: false, head: SHA2, locked: false, prunable: false, status: { upstream: "origin/claude/fix-a", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }, ...over });

test("Needs you: every rule, most urgent first", () => {
  const reports: GitRepoReport[] = [
    repo({
      prs: [
        pr({ number: 38, ci: { state: "failing", total: 2, passed: 1, running: 0, failed: [{ name: "lint" }] } }),
        pr({ number: 41 }),
        pr({ number: 42, draft: true }),
        pr({ number: 43, ci: { state: "running", total: 1, passed: 0, running: 1, failed: [] } }),
        pr({ number: 44, review: "changes-requested" })
      ],
      mergeNotPulled: { number: 37, title: "sheet volumes", fetched: false },
      counts: { staged: 1, unstaged: 2, untracked: 0, conflicted: 0 },
      worktrees: [
        wt({ finished: { how: "pr-merged", pr: 36 } }),
        wt({ path: "D:/w2", name: "w2", branch: "claude/dirty", finished: { how: "pr-closed", pr: 35 }, status: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 } }),
        wt({ path: "D:/w3", name: "w3", branch: "claude/new", status: undefined }),
        wt({ path: "D:/w4", name: "w4", branch: "claude/local", unpushed: { count: 2, oldest: "2026-09-25T17:00:00Z", noUpstream: true } })
      ]
    }),
    repo({ key: ".", label: "research-hub", role: "coordination", detached: true, branch: undefined, head: SHA3, unpushed: undefined }),
    repo({ key: "lab", label: "research-lab", branch: "feature/x", ahead: 3, unpushed: { count: 3, oldest: "2026-09-23T09:00:00Z", noUpstream: false } }),
    repo({ key: "infra", label: "research-infra", state: "not-cloned", prs: undefined })
  ];
  const items = needsYou(reports, NOW);
  assert.deepEqual(items.map(i => [i.rank, i.kind, i.repoKey, i.pr ?? i.worktree ?? ""]), [
    [1, "ci-failed", "pipeline", 38],
    [2, "pr-waiting", "pipeline", 41],
    [3, "merged-not-pulled", "pipeline", 37],
    [4, "dirty-default", "pipeline", ""],
    [5, "worktree-cleanup", "pipeline", "D:/PROJ/research-pipeline/.claude/worktrees/fix-a"],
    [5, "worktree-at-risk", "pipeline", "D:/w2"],
    [6, "unpushed", "pipeline", "D:/w4"],
    [6, "unpushed", "lab", ""],
    [7, "detached", ".", ""]
  ]);
  assert.match(items[0]!.text, /PR #38 CI failed \(lint\)/);
  assert.equal(items[2]!.action, "check-updates");
  assert.equal(needsYou([repo({ mergeNotPulled: { number: 1, title: "x", fetched: true } })])[0]!.action, "get-updates");
  const summary = gitSummary(reports, items);
  assert.deepEqual({ ...summary, top: undefined }, { repositories: 4, checked: 3, needsYou: 9, openPrs: 5, failing: 1, oldestFetch: "2026-09-25T17:56:00Z", top: undefined });
});

test("Needs you: behind with no changes, fresh worktrees, recent unpushed work and other branches stay information", () => {
  const calm = [
    repo({ behind: 4 }),
    repo({ key: "b", branch: "feature/y", counts: { staged: 0, unstaged: 3, untracked: 1, conflicted: 0 } }),
    repo({ key: "c", ahead: 1, unpushed: { count: 1, oldest: "2026-09-25T12:00:00Z", noUpstream: false } }),
    repo({ key: "d", worktrees: [wt({}), wt({ path: "D:/l", locked: true, finished: { how: "git-merged" } })] })
  ];
  assert.deepEqual(needsYou(calm, NOW), []);
});

test("CI not reported by the host CLI still asks for a review; a PR with no checks too", () => {
  const items = needsYou([repo({ prs: [pr({ number: 5, ci: { state: "unknown", total: 0, passed: 0, running: 0, failed: [] } }), pr({ number: 6, ci: { state: "none", total: 0, passed: 0, running: 0, failed: [] } })] })]);
  assert.deepEqual(items.map(i => i.text), ["PR #5 is open (CI not reported here): review and merge", "PR #6 has no checks: review and merge"]);
});

test("cleanup command: -d when Git sees the merge, -D with a reason for squash merges and closed PRs, nothing otherwise", () => {
  const repoDir = "D:\\PROJ\\research-pipeline";
  assert.equal(cleanupCommand(repoDir, wt({ finished: { how: "git-merged" } })),
    "git -C 'D:/PROJ/research-pipeline' worktree remove 'D:/PROJ/research-pipeline/.claude/worktrees/fix-a'\ngit -C 'D:/PROJ/research-pipeline' branch -d claude/fix-a");
  const squash = cleanupCommand(repoDir, wt({ finished: { how: "pr-merged", pr: 36 } }))!;
  assert.match(squash, /# PR #36 was merged on the host \(squash or rebase\)/);
  assert.match(squash, /branch -D claude\/fix-a$/);
  assert.match(cleanupCommand(repoDir, wt({ finished: { how: "pr-closed", pr: 35 } }))!, /closed without merging/);
  assert.equal(cleanupCommand(repoDir, wt({})), undefined, "not finished");
  assert.equal(cleanupCommand(repoDir, wt({ finished: { how: "git-merged" }, locked: true })), undefined, "locked");
  assert.equal(cleanupCommand(repoDir, wt({ finished: { how: "git-merged" }, status: { staged: 0, unstaged: 0, untracked: 1, conflicted: 0 } })), undefined, "dirty");
  assert.equal(cleanupCommand(repoDir, wt({ finished: { how: "git-merged" }, status: undefined })), undefined, "not checked");
  assert.equal(cleanupCommand(repoDir, wt({ finished: { how: "git-merged" }, path: "D:/it's/here" })), undefined, "a quote cannot be escaped safely");
  assert.equal(cleanupCommand(repoDir, wt({ finished: { how: "git-merged" }, path: "D:/a`b" })), undefined, "a PowerShell escape character");
  const odd = cleanupCommand(repoDir, wt({ finished: { how: "git-merged" }, branch: "--delete-all" }))!;
  assert.doesNotMatch(odd, /branch/, "an option-like branch name is never put into a command");
});

test("repository line and relative times", () => {
  assert.equal(repoLine(repo({ behind: 2, ahead: 1, counts: { staged: 0, unstaged: 3, untracked: 0, conflicted: 0 }, prs: [pr({ ci: { state: "failing", total: 1, passed: 0, running: 0, failed: [{ name: "x" }] } }), pr({ number: 2 })] }), NOW),
    "GitHub · main ↓2 ↑1 · 3 changes · 2 PRs (1 ✗) · fetched 4 min ago");
  assert.equal(repoLine(repo({ role: "coordination", upstream: undefined, lastFetch: undefined, prs: undefined }), NOW), "coordination · GitHub · main (no upstream) · never fetched");
  assert.equal(repoLine(repo({ detached: true, branch: undefined, head: SHA3 }), NOW), "GitHub · detached ccccccc · fetched 4 min ago");
  assert.equal(repoLine(repo({ state: "not-cloned", detail: "not cloned here" }), NOW), "GitHub · not cloned here");
  assert.equal(ago("2026-09-23T18:00:00Z", NOW), "2 d ago");
  assert.equal(ago("garbage", NOW), undefined);
});

// ------------------------------------------------------------------ running commands

test("at most four commands run at once, and every one runs", async () => {
  const lim = new Limiter(4);
  let active = 0, peak = 0, done = 0;
  await Promise.all(Array.from({ length: 25 }, (_, i) => lim.run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, i % 3));
    active--; done++;
  })));
  assert.equal(peak, 4);
  assert.equal(done, 25);
  await assert.rejects(lim.run(async () => { throw new Error("boom"); }));
  assert.equal(await lim.run(async () => 7), 7, "a failing command frees its slot");
});

test("az.cmd runs through cmd.exe only with quoted tokens of a strict character set", () => {
  const script = "C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd";
  assert.equal(cmdLine(script, ["repos", "pr", "list", "--project", "shop platform"]), `""${script}" "repos" "pr" "list" "--project" "shop platform""`);
  for (const bad of ["a&calc", "%PATH%", "a\"b", "x|y", "a^b", "<in", "new\nline", "!x!"]) assert.equal(cmdLine(script, ["repos", bad]), undefined, bad);
  assert.equal(cmdLine("az.cmd", ["x"]), undefined, "a relative script path");
  assert.equal(cmdLine("C:\\tools\\az.bat", ["x"]), undefined, "only .cmd");
  assert.equal(cmdLine("C:\\t&calc\\az.cmd", ["x"]), undefined);
});

test("az resolves to its .cmd from absolute PATH entries on Windows only; an executable wins", () => {
  const env = { PATH: "C:\\Azure\\wbin;.;relative\\dir;C:\\bin" };
  const files = new Set(["C:\\Azure\\wbin\\az.cmd", ".\\az.exe", "relative\\dir\\az.exe"]);
  assert.deepEqual(resolveCommandOrScript("az", env, "win32", p => files.has(p)), { path: "C:\\Azure\\wbin\\az.cmd", script: true });
  files.add("C:\\bin\\az.exe");
  assert.deepEqual(resolveCommandOrScript("az", env, "win32", p => files.has(p)), { path: "C:\\bin\\az.exe", script: false });
  assert.equal(resolveCommandOrScript("az", { PATH: "/usr/bin" }, "linux", () => false), undefined);
  assert.equal(resolveCommandOrScript("..\\az", env, "win32", () => true), undefined);
});
