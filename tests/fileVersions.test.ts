/**
 * 0.22 package F — file versions: the pure parsers fed with real `git` output from a scratch
 * repository (renames followed, a file with no history, a revision where the file did not exist,
 * a path with spaces, no origin/<default>), the last update read from the reflog, and the
 * `datapass-rev:` requests that refuse a path escaping the repository.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defaultBranchRef, fileLogArgs, lastUpdateFromReflog, LOG_LIMIT, parseFileLog, parseRevQuery, REFLOG_ARGS, repoRelative,
  revisionLabel, revUriParts, vetRevRequest
} from "../src/core/git/fileVersions";

const run = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
const commit = (cwd: string, msg: string) => { run(cwd, "add", "-A"); run(cwd, "commit", "-q", "-m", msg); return run(cwd, "rev-parse", "HEAD").trim(); };

function scratch(): { dir: string; shas: string[]; done: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "dp-versions-"));
  run(dir, "init", "-q", "-b", "main");
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "old name.py"), "v1\n");
  const a = commit(dir, "first version");
  writeFileSync(path.join(dir, "src", "old name.py"), "v2\n");
  const b = commit(dir, "second version (#12)");
  renameSync(path.join(dir, "src", "old name.py"), path.join(dir, "src", "new name.py"));
  const c = commit(dir, "rename");
  writeFileSync(path.join(dir, "untouched.txt"), "x\n");
  return { dir, shas: [a, b, c], done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("file versions: git log --follow is parsed newest first, with the path before a rename and the PR of a squash merge", () => {
  const s = scratch();
  try {
    const revs = parseFileLog(run(s.dir, ...fileLogArgs("src/new name.py")), "src/new name.py");
    assert.deepEqual(revs.map(r => r.sha), [...s.shas].reverse());
    assert.deepEqual(revs.map(r => r.path), ["src/new name.py", "src/old name.py", "src/old name.py"]);
    assert.equal(revs[1]!.pr, 12);
    assert.equal(revs[0]!.pr, undefined);
    assert.match(revs[0]!.date, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(revs[2]!.author, "T");
    const label = revisionLabel(revs[1]!);
    assert.equal(label.label, "second version (#12)");
    assert.match(label.description, /^[0-9a-f]{7} · \d{4}-\d{2}-\d{2} · T · from PR #12$/);
    // The first revision's content is the first version (what Open Version… shows).
    assert.equal(run(s.dir, "show", `${revs[2]!.sha}:${revs[2]!.path}`), "v1\n");
    // A revision where the file did not exist yet: git show fails (the provider says so).
    assert.throws(() => execFileSync("git", ["cat-file", "-e", `${s.shas[0]}:src/new name.py`], { cwd: s.dir, stdio: "ignore" }));
  } finally { s.done(); }
});

test("file versions: a file with no history, an empty output and noise give no revision; the limit holds", () => {
  const s = scratch();
  try {
    assert.deepEqual(parseFileLog(run(s.dir, ...fileLogArgs("untouched.txt")), "untouched.txt"), []);
    assert.deepEqual(parseFileLog("", "x"), []);
    assert.deepEqual(parseFileLog("\x1enot-a-sha\x1fa\x1fb\x1fc\n\nx\n", "x"), []);
    const many = Array.from({ length: 70 }, (_, i) => `\x1e${i.toString(16).padStart(40, "0")}\x1fA\x1f2026-09-26T00:00:00+02:00\x1fs${i}\n\nf\n`).join("");
    assert.equal(parseFileLog(many, "f").length, LOG_LIMIT);
    assert.ok(fileLogArgs("a b.py").includes("--follow"));
    assert.equal(fileLogArgs("a b.py").at(-1), "a b.py", "the path is one argument after --, spaces included");
  } finally { s.done(); }
});

test("file versions: repository-relative paths; a file outside the repository is refused", () => {
  assert.equal(repoRelative("D:/work/repo", "D:\\work\\repo\\src\\new name.py", true), "src/new name.py");
  assert.equal(repoRelative("d:/Work/Repo", "D:\\work\\repo\\a.txt", true), "a.txt");
  assert.equal(repoRelative("/home/u/repo", "/home/u/repo/a.txt", false), "a.txt");
  assert.equal(repoRelative("/home/u/repo", "/home/u/repo-other/a.txt", false), undefined);
  assert.equal(repoRelative("/home/u/repo", "/home/u/elsewhere/a.txt", false), undefined);
  assert.equal(repoRelative("/home/u/repo", "/home/u/repo", false), undefined);
});

test("file versions: the latest version needs origin/<default>; without it DataPass says so and fetches nothing", () => {
  const s = scratch();
  try {
    assert.equal(defaultBranchRef("origin/main\n"), "origin/main");
    assert.equal(defaultBranchRef("origin/release/2026\n"), "origin/release/2026");
    assert.equal(defaultBranchRef(""), undefined);
    assert.equal(defaultBranchRef("origin/../../x"), undefined);
    assert.equal(defaultBranchRef("main; rm -rf"), undefined);
    // No remote at all: symbolic-ref fails and no candidate resolves.
    assert.throws(() => execFileSync("git", ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { cwd: s.dir, stdio: "ignore" }));
    assert.throws(() => execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"], { cwd: s.dir, stdio: "ignore" }));
  } finally { s.done(); }
});

test("file versions: the last update is the newest fast-forward in the reflog", () => {
  const up = mkdtempSync(path.join(tmpdir(), "dp-versions-up-"));
  try {
    run(up, "init", "-q", "-b", "main");
    writeFileSync(path.join(up, "a.txt"), "1\n");
    commit(up, "one");
    const clone = path.join(up, "..", `${path.basename(up)}-clone`);
    run(up, "clone", "-q", up, clone);
    writeFileSync(path.join(up, "a.txt"), "2\n");
    const two = commit(up, "two");
    run(clone, "fetch", "-q", "origin");
    const before = run(clone, "rev-parse", "HEAD").trim();
    assert.equal(lastUpdateFromReflog(run(clone, ...REFLOG_ARGS)), undefined, "a clone alone is no update");
    run(clone, "merge", "--ff-only", "@{u}");
    const u = lastUpdateFromReflog(run(clone, ...REFLOG_ARGS));
    assert.deepEqual({ from: u?.from, to: u?.to }, { from: before, to: two });
    assert.match(u!.how, /Fast-forward/);
    rmSync(clone, { recursive: true, force: true });
  } finally { rmSync(up, { recursive: true, force: true }); }
});

test("file versions: datapass-rev requests refuse a path escaping the repository or a bad revision", () => {
  const ok = { repo: "D:/work/repo", sha: "a".repeat(40), path: "src/new name.py" };
  assert.deepEqual(vetRevRequest(ok), ok);
  assert.deepEqual(vetRevRequest({ ...ok, sha: "abc1234" })?.sha, "abc1234");
  for (const bad of [
    { ...ok, path: "../other/secret.txt" }, { ...ok, path: "src/../../x" }, { ...ok, path: "/etc/passwd" }, { ...ok, path: "C:\\x" },
    { ...ok, sha: "HEAD" }, { ...ok, sha: "a;b" }, { ...ok, sha: "--output=x" }, { ...ok, repo: "" }, null, "x", { ...ok, path: 3 }
  ]) assert.equal(vetRevRequest(bad), undefined, JSON.stringify(bad));
  const parts = revUriParts(ok, "origin/main abcdef1, fetched 26 Sep 02:10");
  assert.equal(parts.path, "/new name.py (origin main abcdef1, fetched 26 Sep 02:10)");
  assert.deepEqual(parseRevQuery(parts.query), ok);
  assert.equal(parseRevQuery("{not json"), undefined);
  assert.equal(parseRevQuery(JSON.stringify({ ...ok, path: "../x" })), undefined);
});
