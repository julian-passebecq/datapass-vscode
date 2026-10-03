/**
 * V5HOLE8 (V5 acceptance row 03): (a) a declared clone whose folder was deleted is a "missing clone", never "not a Git
 * repository"; (b) a repository's history is reachable from the Git view with no DataPass project (no .datapass/project.json).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { MISSING_CLONE_DETAIL, repoLine, statusFailureReport, type GitRepoReport } from "../src/core/git/gitReport";
import { DEFAULT_REPO_HISTORY_LABELS, historyTreeRows, parseRepoLog, repoHistoryLabels, repoLogArgs, REPO_TREE_HISTORY_LIMIT, type RepoLog } from "../src/core/gitmr/repoHistory";
import { gitReadOnly } from "../src/core/gitmr/readOnly";

const src = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("status failure: a deleted clone is a missing clone; a folder that is not a repository stays one", () => {
  assert.deepEqual(statusFailureReport({}, false), { state: "not-cloned", detail: MISSING_CLONE_DETAIL });
  assert.equal(MISSING_CLONE_DETAIL, "missing clone");
  assert.deepEqual(statusFailureReport({}, true), { state: "not-a-repo", detail: "not a Git repository" });
  // Timeouts and a missing git are reported as before, whatever the folder.
  assert.deepEqual(statusFailureReport({ timedOut: true }, false), { state: "not-checked", detail: "not checked (Git took more than 5 s)" });
  assert.deepEqual(statusFailureReport({ missing: true }, false), { state: "not-a-repo", detail: "git was not found on PATH" });
});

test("missing clone: the Git view line says so and never says up to date", () => {
  const r: GitRepoReport = { key: "repo-set:bi", label: "bi", section: "project", role: "project", worktrees: [], merges: [], hostData: { kind: "no-host" }, ...statusFailureReport({}, false) };
  const line = repoLine(r);
  assert.match(line, /missing clone/);
  assert.doesNotMatch(line, /up to date|not a Git repository/);
});

test("the observer checks the folder before calling a failed status 'not a Git repository'", () => {
  const obs = src("src/work/gitObserver.ts");
  assert.match(obs, /statusFailureReport\(status, exists\)/);
  assert.match(obs, /fs\.promises\.stat\(folder\)/);
  assert.doesNotMatch(obs, /status\.missing \? "git was not found on PATH" : "not a Git repository"/, "the old inline label is gone");
});

const log = (commits: { rev: string; message: string; files?: string[] }[], error?: string): RepoLog =>
  ({ repo: "transform", commits: commits.map(c => ({ rev: c.rev, author: "QA", date: "2026-01-02T10:00:00+00:00", message: c.message, files: c.files ?? [] })), ...(error ? { error } : {}) });

test("history rows: newest first, subject as label, short sha in the description, bounded", () => {
  const h = historyTreeRows(log([{ rev: "b".repeat(40), message: "transform: fct_orders", files: ["models/fct_orders.sql"] }, { rev: "a".repeat(40), message: "transform: stg_orders" }]));
  assert.equal(h.message, undefined);
  assert.deepEqual(h.rows.map(r => r.label), ["transform: fct_orders", "transform: stg_orders"]);
  assert.equal(h.rows[0]!.description, "bbbbbbb · QA · 2026-01-02");
  assert.match(h.rows[0]!.tooltip, /models\/fct_orders\.sql/);
  const many = historyTreeRows(log(Array.from({ length: REPO_TREE_HISTORY_LIMIT + 5 }, (_, i) => ({ rev: i.toString(16).padStart(40, "0"), message: `c${i}` }))));
  assert.equal(many.rows.length, REPO_TREE_HISTORY_LIMIT);
});

test("history rows: a failed log and an empty repository are messages (labels are settings)", () => {
  assert.deepEqual(historyTreeRows(log([], "fatal: bad")), { rows: [], message: `${DEFAULT_REPO_HISTORY_LABELS.logFailed}: fatal: bad` });
  assert.deepEqual(historyTreeRows(log([])), { rows: [], message: DEFAULT_REPO_HISTORY_LABELS.noCommits });
  const labels = repoHistoryLabels({ noCommits: "Rien encore", treeHistory: "Historique" });
  assert.equal(labels.treeHistory, "Historique");
  assert.equal(historyTreeRows(log([]), labels).message, "Rien encore");
});

test("the Git view offers the history under every observed repository, with no project gate", () => {
  const tree = src("src/views/gitTree.ts");
  const children = tree.slice(tree.indexOf("private repoChildren("), tree.indexOf("private linkRows("));
  assert.match(children, /kind: "history"/);
  assert.doesNotMatch(children, /projectMap|hasProject|\.datapass/, "history is not gated on a DataPass project");
  assert.match(tree, /this\.observer\.history\(r\.key\)/);
  assert.match(src("src/work/gitObserver.ts"), /gitReadOnly\(repoLogArgs\(limit\)\)/, "read-only allow-list applies");
  assert.ok(gitReadOnly(repoLogArgs(REPO_TREE_HISTORY_LIMIT)).includes("log"));
});

test("history rows from a real repository with no .datapass folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-v5hole8-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "stg_orders.sql"), "select 1\n"); git("add", "-A"); git("commit", "-q", "-m", "transform: stg_orders");
    fs.writeFileSync(path.join(dir, "fct_orders.sql"), "select 2\n"); git("add", "-A"); git("commit", "-q", "-m", "transform: fct_orders");
    assert.ok(!fs.existsSync(path.join(dir, ".datapass")));
    const out = git(...gitReadOnly(repoLogArgs(REPO_TREE_HISTORY_LIMIT)));
    const h = historyTreeRows({ repo: "transform", commits: parseRepoLog(out) });
    assert.deepEqual(h.rows.map(r => r.label), ["transform: fct_orders", "transform: stg_orders"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
