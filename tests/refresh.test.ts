/**
 * V1-REF progressive refresh: the per-clone cache (fingerprint from HEAD, the ref, the index and the
 * config, read without running Git), one `git ls-files` per clone, and the bounded runner the
 * probes and Git reads share. Synthetic repositories in a temporary folder only.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fingerprintKey, gitDirFromFile, headRef, lsFilesArgs, LS_FILES_PATHSPEC_CHARS, RepoCache, repoFingerprint } from "../src/core/git/repoCache";
import { interpretLsFiles, runBounded } from "../src/core/project/observation";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=DataPass test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, stdio: "pipe" }).toString();

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-ref-"));
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "one");
  return dir;
}
const cleanup = (dir: string) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
/** Some file systems keep mtimes to the second: wait past it so a rewrite is visible. */
const tick = () => new Promise(r => setTimeout(r, 1100));

test("the .git file of a linked worktree or submodule points to its Git folder", () => {
  assert.equal(gitDirFromFile("gitdir: ../main/.git/worktrees/x\n", path.resolve("/p/wt")), path.resolve("/p/main/.git/worktrees/x"));
  assert.equal(gitDirFromFile("gitdir: /abs/.git/modules/m", path.resolve("/p/wt")), path.resolve("/abs/.git/modules/m"));
  assert.equal(gitDirFromFile("not a git file", "/p"), undefined);
});

test("HEAD names a ref, or none when detached; a hostile ref is refused", () => {
  assert.equal(headRef("ref: refs/heads/main\n"), "refs/heads/main");
  assert.equal(headRef("0123456789abcdef0123456789abcdef01234567\n"), undefined);
  assert.equal(headRef("ref: refs/../../config\n"), undefined);
  assert.equal(headRef("ref: HEAD\n"), undefined);
  assert.equal(headRef("ref: refs\\..\\..\\config\n"), undefined);
  assert.equal(headRef("ref: refs/heads/..\\..\\x\n"), undefined);
});

test("the fingerprint changes with HEAD, the ref, the index and the config", () => {
  const base = { head: "ref: refs/heads/main\n", ref: "aaa\n", index: { mtimeMs: 1, size: 10 }, configMtimeMs: [5] };
  const k = fingerprintKey(base);
  assert.equal(fingerprintKey({ ...base }), k);
  assert.notEqual(fingerprintKey({ ...base, head: "ref: refs/heads/other\n" }), k);
  assert.notEqual(fingerprintKey({ ...base, ref: "bbb\n" }), k);
  assert.notEqual(fingerprintKey({ ...base, index: { mtimeMs: 2, size: 10 } }), k);
  assert.notEqual(fingerprintKey({ ...base, index: undefined }), k);
  assert.notEqual(fingerprintKey({ ...base, configMtimeMs: [6] }), k);
});

test("the cache keeps answers while the fingerprint holds and drops them when it changes", () => {
  const cache = new RepoCache(2);
  const e = cache.entry("/r1", "k1");
  e.config = { ok: true, stdout: "https://example.invalid/r1\n" };
  e.tracking.set(".env", { state: "untracked" });
  assert.equal(cache.entry("/r1", "k1"), e, "same fingerprint: same answers");
  const changed = cache.entry("/r1", "k2");
  assert.notEqual(changed, e);
  assert.equal(changed.config, undefined);
  assert.equal(changed.tracking.size, 0);
  // Without a fingerprint nothing is kept.
  const none = cache.entry("/r3", undefined);
  none.config = { ok: true, stdout: "x" };
  assert.equal(cache.entry("/r3", undefined).config, undefined);
  // Bounded: the oldest folder leaves first.
  cache.entry("/r4", "k");
  cache.entry("/r5", "k");
  assert.equal(cache.size, 2);
});

test("one ls-files call per clone: the paths when they fit, else the whole index", () => {
  assert.deepEqual(lsFilesArgs([".env", "local.settings.json"]), ["ls-files", "-z", "--", ".env", "local.settings.json"]);
  const many = Array.from({ length: 400 }, (_, i) => `components/c${i}/local.settings.json`);
  assert.ok(many.join("").length > LS_FILES_PATHSPEC_CHARS);
  assert.deepEqual(lsFilesArgs(many), ["ls-files", "-z"]);
  // The whole index read as a membership list gives the same answers as the pathspec call.
  const listing = { ok: true, stdout: "a.txt\0components/c1/local.settings.json\0src/x.py\0" };
  const t = interpretLsFiles(["components/c1/local.settings.json", "components/c2/local.settings.json"], listing);
  assert.equal(t.get("components/c1/local.settings.json")?.state, "tracked");
  assert.equal(t.get("components/c2/local.settings.json")?.state, "untracked");
  // Cut short or failed: unknown, never untracked.
  assert.equal(interpretLsFiles(["x"], { ok: true, stdout: "a.txt\0b" }).get("x")?.state, "unknown");
  assert.equal(interpretLsFiles(["x"], { ok: false, stdout: "" }).get("x")?.state, "unknown");
});

test("a real clone's fingerprint: stable at rest, new after a commit, git add or a config change", async () => {
  const dir = tempRepo();
  try {
    const a = await repoFingerprint(dir);
    assert.ok(a, "fingerprint read");
    assert.equal(path.resolve(a!.gitDir), path.resolve(dir, ".git"));
    assert.equal((await repoFingerprint(dir))!.key, a!.key, "unchanged at rest");
    // Editing a file without staging it keeps the fingerprint: `git status` is never cached.
    fs.writeFileSync(path.join(dir, "a.txt"), "edited\n");
    assert.equal((await repoFingerprint(dir))!.key, a!.key);

    await tick();
    git(dir, "add", "a.txt");
    const b = await repoFingerprint(dir);
    assert.notEqual(b!.key, a!.key, "git add rewrites the index");

    git(dir, "commit", "-q", "-m", "two");
    const c = await repoFingerprint(dir);
    assert.notEqual(c!.key, b!.key, "a commit moves the branch");

    await tick();
    git(dir, "remote", "add", "origin", "https://example.invalid/r.git");
    assert.notEqual((await repoFingerprint(dir))!.key, c!.key, "a new origin changes the config");

    // Packed refs only (after gc): still a fingerprint.
    git(dir, "pack-refs", "--all");
    assert.ok(await repoFingerprint(dir));
  } finally { cleanup(dir); }
});

test("a linked worktree is fingerprinted through its .git file; a plain folder has none", async () => {
  const dir = tempRepo();
  const wt = `${dir}-wt`;
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-plain-"));
  try {
    git(dir, "worktree", "add", "-q", "-b", "side", wt);
    const f = await repoFingerprint(wt);
    assert.ok(f);
    assert.equal(fs.realpathSync(path.dirname(path.dirname(f!.gitDir))), fs.realpathSync(path.join(dir, ".git")));
    assert.notEqual(f!.key, (await repoFingerprint(dir))!.key);
    assert.equal(await repoFingerprint(plain), undefined);
  } finally { cleanup(wt); cleanup(dir); cleanup(plain); }
});

test("a bounded run keeps the input order and never exceeds its cap", async () => {
  let running = 0, peak = 0;
  const out = await runBounded([5, 1, 4, 2, 3, 0], 2, async n => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, n * 3));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.equal(peak, 2);
});
