/**
 * V4-NAV NAVHIST1 — `git-history` binding on a scratch repository: rows of several files merged newest
 * first (renames followed), typed holes (restricted, not in a repository, no commits), the bound, and the
 * read-only opens (diff with the working file / old revision, never a checkout).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitRunner } from "../src/core/workspace/gitBase";
import {
  GIT_HISTORY_SOURCE, GIT_HISTORY_VIEW, historyOpen, mergeHistories, openHistoryRow, provideGitHistory, vetHistoryMessage, type GitHistoryRow
} from "../src/core/navigation/bindings/gitHistory";

const run = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
const commit = (cwd: string, msg: string, date: string) => {
  run(cwd, "add", "-A");
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return run(cwd, "rev-parse", "HEAD").trim();
};

const gitRunner: GitRunner = (args, cwd, timeout) => new Promise(resolve =>
  execFile("git", args, { cwd, timeout, encoding: "utf8" }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr })));

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "dp-navhist-"));
  run(dir, "init", "-q", "-b", "main");
  mkdirSync(path.join(dir, "jobs"));
  writeFileSync(path.join(dir, "jobs", "old.py"), "v1\n");
  writeFileSync(path.join(dir, "jobs", "conf.yml"), "a: 1\n");
  const a = commit(dir, "first", "2026-01-01T10:00:00Z");
  writeFileSync(path.join(dir, "jobs", "old.py"), "v2\n");
  const b = commit(dir, "second (#7)", "2026-01-02T10:00:00Z");
  renameSync(path.join(dir, "jobs", "old.py"), path.join(dir, "jobs", "job.py"));
  writeFileSync(path.join(dir, "jobs", "conf.yml"), "a: 2\n");
  const c = commit(dir, "rename and conf", "2026-01-03T10:00:00Z");
  writeFileSync(path.join(dir, "jobs", "fresh.py"), "new\n");
  return { dir, shas: [a, b, c], done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("git-history: the artifact's files merged newest first, one row per commit and file, renames followed", async () => {
  const s = scratch();
  try {
    const job = path.join(s.dir, "jobs", "job.py");
    const conf = path.join(s.dir, "jobs", "conf.yml");
    const r = await provideGitHistory(gitRunner, true, { files: [job, conf, job] });
    assert.equal(r.origin, "static");
    assert.deepEqual(r.holes, []);
    assert.equal(r.rows.length, 5); // job: 3 commits, conf: 2
    assert.equal(r.rows[0]!.sha, s.shas[2]);
    assert.ok(r.rows.every(x => x.origin === "static"));
    const jobRows = r.rows.filter(x => x.file === job);
    assert.deepEqual(jobRows.map(x => x.path), ["jobs/job.py", "jobs/old.py", "jobs/old.py"]);
    assert.equal(jobRows[1]!.pr, 7);
    assert.equal(new Set(r.rows.map(x => x.id)).size, 5);
  } finally { s.done(); }
});

test("git-history: holes, never a guess — restricted mode, no file, outside a repository, no commits", async () => {
  const s = scratch();
  const outside = mkdtempSync(path.join(tmpdir(), "dp-navhist-out-"));
  try {
    assert.match((await provideGitHistory(gitRunner, false, { files: [path.join(s.dir, "jobs", "job.py")] })).holes[0]!.reason, /Restricted/);
    assert.match((await provideGitHistory(gitRunner, true, { files: ["relative/x.py"] })).holes[0]!.reason, /no file/);
    writeFileSync(path.join(outside, "x.sql"), "select 1\n");
    const r = await provideGitHistory(gitRunner, true, { files: [path.join(outside, "x.sql"), path.join(s.dir, "jobs", "fresh.py")], labels: { noCommits: "nothing for {file}" } });
    assert.deepEqual(r.rows, []);
    assert.equal(r.holes.length, 2);
    assert.match(r.holes[0]!.reason, /x\.sql is not in a Git repository/);
    assert.equal(r.holes[1]!.reason, "nothing for jobs/fresh.py");
  } finally { s.done(); rmSync(outside, { recursive: true, force: true }); }
});

test("git-history: bounded, and a truncated list says so", async () => {
  const s = scratch();
  try {
    const r = await provideGitHistory(gitRunner, true, { files: [path.join(s.dir, "jobs", "job.py")], limit: 2 });
    assert.equal(r.rows.length, 2);
    assert.match(r.holes[0]!.reason, /newest 2 commits/);
    const file = { repo: "/r", rel: "a", fsPath: "/r/a" };
    const revs = Array.from({ length: 150 }, (_, i) => ({ sha: i.toString(16).padStart(40, "0"), author: "a", date: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`, subject: "s", path: "a" }));
    assert.equal(mergeHistories([{ file, revs }]).length, 100);
  } finally { s.done(); }
});

const row: GitHistoryRow = { id: "x", sha: "a".repeat(40), short: "aaaaaaa", date: "2026-01-02T10:00:00Z", author: "T", subject: "change", path: "jobs/old.py", repo: "/repo", file: "/repo/jobs/job.py", origin: "static" };

test("git-history: opens are read-only — diff with the working file, or the old revision; messages are vetted", async () => {
  const d = historyOpen(row, "open-diff");
  assert.equal(d.kind, "diff");
  if (d.kind === "diff") { assert.deepEqual(d.left, { repo: "/repo", sha: row.sha, path: "jobs/old.py" }); assert.equal(d.right, "/repo/jobs/job.py"); assert.equal(d.title, "job.py (aaaaaaa ↔ working file)"); }
  const o = historyOpen(row, "open-revision", { revisionNote: "rev {sha}" });
  assert.deepEqual(o, { kind: "revision", rev: { repo: "/repo", sha: row.sha, path: "jobs/old.py" }, note: "rev aaaaaaa" });
  const calls: unknown[][] = [];
  const opener = { revUri: (r: { sha: string }, n: string) => `rev:${r.sha.slice(0, 3)}:${n}`, fileUri: (p: string) => `file:${p}`, executeCommand: async (...a: unknown[]) => { calls.push(a); } };
  await openHistoryRow(opener, row, "open-diff");
  await openHistoryRow(opener, row, "open-revision");
  assert.deepEqual(calls.map(c => c[0]), ["vscode.diff", "vscode.open"]);
  assert.ok(!calls.flat().some(a => typeof a === "string" && /checkout/.test(a)));
  assert.deepEqual(vetHistoryMessage({ rowId: "x", action: "open-diff" }, [row]), { row, action: "open-diff" });
  assert.equal(vetHistoryMessage({ rowId: "x", action: "checkout" }, [row]), undefined);
  assert.equal(vetHistoryMessage({ rowId: "y", action: "open-diff" }, [row]), undefined);
  assert.equal(vetHistoryMessage(null, [row]), undefined);
});

test("git-history: built-in view uses the diff-history layout and the git-history source", () => {
  assert.equal(GIT_HISTORY_VIEW.layout, "diff-history");
  assert.equal(GIT_HISTORY_VIEW.bindings[0]!.source, GIT_HISTORY_SOURCE);
});

test("git-history is a self-registered binding that names its missing Git runner as a hole", async () => {
  const { bindingProvider } = await import("../src/core/navigation/bindings/index");
  const { GIT_HISTORY_UNWIRED } = await import("../src/core/navigation/bindings/gitHistory.binding");
  const p = bindingProvider("git-history");
  assert.ok(p);
  assert.deepEqual(p.provide({ location: { level: "artifact", nodeId: "a", artifactKind: "sql" } as never }).holes, [{ reason: GIT_HISTORY_UNWIRED }]);
});
