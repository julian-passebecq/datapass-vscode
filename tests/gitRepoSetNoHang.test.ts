/**
 * V5HOLE14 (V5 acceptance row 03): a repo-set workspace whose root is not a repository, two clones (ingest, transform)
 * and one deleted clone (bi). The Git view must leave "Checking the repositories…" within a bounded time: every
 * repository check settles (missing clone, not a repository, or a real status). `vscode` is an in-memory stub; Git is real.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

class EventEmitter<T> {
  private ls = new Set<(e: T) => void>();
  event = (l: (e: T) => void) => { this.ls.add(l); return { dispose: () => this.ls.delete(l) }; };
  fire(e: T) { for (const l of this.ls) l(e); }
  dispose() { this.ls.clear(); }
}
class TreeItem { constructor(public label: string, public collapsibleState?: number) {} }
class ThemeIcon { static File = new ThemeIcon("file"); constructor(public id: string, public color?: unknown) {} }
class ThemeColor { constructor(public id: string) {} }
const uri = (p: string) => ({ fsPath: p, path: p });
const workspace = {
  isTrusted: true,
  workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
  onDidChangeConfiguration: () => ({ dispose() { /* none */ } }),
  getConfiguration: () => ({ get: <T>(_k: string, d?: T) => d })
};
const vscodeStub = {
  EventEmitter, TreeItem, ThemeIcon, ThemeColor, MarkdownString: class { value = ""; appendMarkdown(s: string) { this.value += s; return this; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: { file: uri, joinPath: (b: { path: string }, ...p: string[]) => uri([b.path, ...p].join("/")) },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() { /* none */ } }) },
  window: {}, workspace
};
const mod = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const resolve = mod._resolveFilename;
mod._resolveFilename = (r: string, ...a: unknown[]) => (r === "vscode" ? "vscode" : resolve.call(Module, r, ...a));
mod._cache["vscode"] = { id: "vscode", filename: "vscode", loaded: true, exports: vscodeStub };

/* eslint-disable @typescript-eslint/no-require-imports */
const { GitObserver } = require("../src/work/gitObserver") as typeof import("../src/work/gitObserver");
const { GitTreeProvider } = require("../src/views/gitTree") as typeof import("../src/views/gitTree");
/* eslint-enable @typescript-eslint/no-require-imports */

const BOUND_MS = 15_000;

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-v5hole14-"));
  for (const name of ["ingest", "transform"]) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "a.sql"), "select 1\n"); git("add", "-A"); git("commit", "-q", "-m", `${name}: first`);
  }
  fs.mkdirSync(path.join(root, ".datapass"));
  fs.writeFileSync(path.join(root, ".datapass", "repos.json"), JSON.stringify({ repos: [
    { path: "ingest", id: "ingest", role: "data", defaultBranch: "main" },
    { path: "transform", id: "transform", role: "data", defaultBranch: "main" },
    { path: "bi", id: "bi", role: "bi", defaultBranch: "main" }
  ] }));
  return root;
}

test("repo-set with a non-repo root and a deleted clone: the Git view leaves 'checking' in bounded time", { timeout: BOUND_MS + 5_000 }, async () => {
  const root = fixture();
  // The root is not a repository: stop Git from walking up into whatever holds the temp folder.
  const prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(root);
  workspace.workspaceFolders = [root, path.join(root, "ingest"), path.join(root, "transform"), path.join(root, "bi")].map(f => ({ uri: { fsPath: f } }));
  const session = { projectMap: () => ({ repositories: [] }), projectObservation: () => undefined, repoFolder: () => undefined };
  const observer = new GitObserver(session as never);
  const tree = new GitTreeProvider(observer);
  const orig = observer.runner; const cwds: string[] = [];
  observer.runner = (t, a, c, ms) => { cwds.push(c); return orig(t, a, c, ms); };
  try {
    let timer: NodeJS.Timeout | undefined;
    const bounded = new Promise<"timeout">(r => { timer = setTimeout(() => r("timeout"), BOUND_MS); });
    const done = await Promise.race([observer.refresh().then(() => "done" as const), bounded]);
    clearTimeout(timer);
    assert.equal(done, "done", `refresh did not settle within ${BOUND_MS} ms`);
    const o = observer.observation();
    assert.equal(o.checking, false);
    const byLabel = new Map(o.project.map(r => [r.label, r]));
    assert.equal(byLabel.get("ingest")?.state, "ok");
    assert.equal(byLabel.get("transform")?.state, "ok");
    assert.equal(byLabel.get("bi")?.state, "not-cloned");
    assert.equal(byLabel.get("bi")?.detail, "missing clone");
    assert.equal(byLabel.get(path.basename(root))?.state, "not-a-repo");
    const roots = await tree.getChildren();
    assert.ok(!roots.some(n => n.id === "checking"), "the view no longer says Checking the repositories…");
    assert.ok(!cwds.some(c => path.basename(c) === "bi"), "no Git spawn in the deleted clone");
  } finally {
    tree.dispose(); observer.dispose();
    if (prevCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may still hold the folder */ }
  }
});

test("one repository whose Git never answers is 'not checked'; the others are shown and checking ends", { timeout: 20_000 }, async () => {
  const root = fixture();
  const prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(root);
  workspace.workspaceFolders = [root, path.join(root, "ingest"), path.join(root, "transform"), path.join(root, "bi")].map(f => ({ uri: { fsPath: f } }));
  const session = { projectMap: () => ({ repositories: [] }), projectObservation: () => undefined, repoFolder: () => undefined };
  const observer = new GitObserver(session as never);
  observer.repoDeadlineMs = 3_000;
  const orig = observer.runner;
  // A check that never settles (the Windows execFile case): ingest's Git hangs forever.
  observer.runner = (t, a, c, ms) => path.basename(c) === "ingest" ? new Promise(() => { /* never */ }) : orig(t, a, c, ms);
  try {
    const started = Date.now();
    await observer.refresh();
    assert.ok(Date.now() - started < 15_000);
    const o = observer.observation();
    assert.equal(o.checking, false);
    const byLabel = new Map(o.project.map(r => [r.label, r]));
    assert.equal(byLabel.get("ingest")?.state, "not-checked");
    assert.equal(byLabel.get("transform")?.state, "ok");
    assert.equal(byLabel.get("bi")?.detail, "missing clone");
  } finally {
    observer.dispose();
    if (prevCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may still hold the folder */ }
  }
});

test("settleWithin: a promise that never settles gives the fallback in bounded time", async () => {
  const { settleWithin } = await import("../src/core/git/run");
  assert.equal(await settleWithin(new Promise<string>(() => { /* never */ }), 50, () => "fallback"), "fallback");
  assert.equal(await settleWithin(Promise.resolve("value"), 1_000, () => "fallback"), "value");
  assert.equal(await settleWithin(Promise.reject(new Error("x")), 1_000, () => "fallback"), "fallback");
});
