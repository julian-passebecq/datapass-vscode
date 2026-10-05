/** Performance regressions retain origin identity, workspace precedence and search exclusions. */
import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";
import type { GitRunner } from "../src/core/workspace/gitBase";
import type { DataPassProjectManifest } from "../src/core/projectManifestModel";
import { perfManifest, perfGraphJson } from "./fixtures/perf/foilSized";

const uri = (p: string, scheme = "file") => ({ scheme, fsPath: p, path: p, toString: () => `${scheme}:${p}` });
const folders: Array<{ uri: ReturnType<typeof uri> }> = [];
let searches = 0;
let results: ReturnType<typeof uri>[] = [];
const stub = {
  EventEmitter: class<T> {
    private listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(value: T) { for (const listener of this.listeners) listener(value); }
    dispose() { this.listeners.clear(); }
  },
  RelativePattern: class { constructor(readonly base: unknown, readonly pattern: string) {} },
  Uri: { file: uri, joinPath: (b: ReturnType<typeof uri>, ...p: string[]) => uri(path.join(b.fsPath, ...p), b.scheme) },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  extensions: { getExtension: () => undefined },
  workspace: {
    isTrusted: true,
    getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }),
    workspaceFolders: folders,
    findFiles: async () => { searches++; return results; },
    fs: {
      stat: async () => { throw Object.assign(new Error("permission denied"), { code: "NoPermissions" }); },
      readFile: async () => Buffer.from('{"servers":{"local":{"command":"example"}}}')
    }
  }
};
const mod = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const resolve = mod._resolveFilename;
mod._resolveFilename = (r, ...a) => r === "vscode" ? "vscode" : resolve.call(Module, r, ...a);
mod._cache.vscode = { id: "vscode", filename: "vscode", loaded: true, exports: stub };
const { locateRepositories, observeProject, pendingProjectObservation, repoCache } = require("../src/work/projectObserver") as typeof import("../src/work/projectObserver");
const { buildProjectMap } = require("../src/core/project/projectMap") as typeof import("../src/core/project/projectMap");
const { parseGraph } = require("../src/core/workspace/graph") as typeof import("../src/core/workspace/graph");
const { probeTools } = require("../src/core/capabilities/probe") as typeof import("../src/core/capabilities/probe");
const { readProjectFile } = require("../src/core/workspace/readFile") as typeof import("../src/core/workspace/readFile");
const { loadProjectContext } = require("../src/core/workspace/loader") as typeof import("../src/core/workspace/loader");
const { setProjectRoot } = require("../src/core/workspace/root") as typeof import("../src/core/workspace/root");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "datapass-observation-test-"));
  const names = ["hub", "one", "two", "one-copy"];
  for (const n of names) {
    const p = path.join(root, n, ".git", "refs", "heads");
    await fs.mkdir(p, { recursive: true });
    await fs.writeFile(path.join(root, n, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fs.writeFile(path.join(p, "main"), "a".repeat(40));
    await fs.writeFile(path.join(root, n, ".git", "config"), "");
  }
  folders.splice(0, folders.length, ...names.map(n => ({ uri: uri(path.join(root, n)) })));
  repoCache.clear();
  return { root, hub: uri(path.join(root, "hub")), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test("independent origin reads overlap, bind by identity, and retain the first matching workspace folder", async () => {
  const f = await fixture();
  try {
    let running = 0, peak = 0;
    const origins: string[] = [];
    const git: GitRunner = async (args, cwd) => {
      if (args[0] === "config") {
        origins.push(cwd); running++; peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 15)); running--;
        return { ok: true, stdout: `https://example.com/org/${path.basename(cwd).replace("-copy", "")}` };
      }
      return { ok: true, stdout: "# branch.oid " + "a".repeat(40) + "\n# branch.head main\n" };
    };
    const manifest: DataPassProjectManifest = { schemaVersion: 3, project: { id: "test", title: "Test" }, repositories: { a: { remote: { url: "https://example.com/org/one" } }, b: { remote: { url: "https://example.com/org/two" } } } };
    const r = await locateRepositories({ root: f.hub as never, manifest, trusted: true, git, localBindings: {}, cloneParents: [] });
    assert.equal(r.folders.get("a")?.fsPath, path.join(f.root, "one"));
    assert.equal(r.folders.get("b")?.fsPath, path.join(f.root, "two"));
    assert.ok(peak > 1 && peak <= 4, "independent origin reads must overlap within the existing cap");
    assert.equal(origins.filter(p => p === path.join(f.root, "one")).length, 1);
    let calls = 0;
    const restricted = await locateRepositories({ root: f.hub as never, manifest, trusted: false, git: async () => { calls++; throw new Error("must not run"); }, localBindings: {}, cloneParents: [] });
    assert.equal(calls, 0);
    assert.equal(restricted.repos.get("a")?.restricted, true);
  } finally { await f.cleanup(); }
});

test("real session paints pending only on startup/project switch and keeps checked clones during same-project refresh", async () => {
  const { WorkSession } = require("../src/work/session") as typeof import("../src/work/session");
  const f = await fixture();
  const originalStat = stub.workspace.fs.stat;
  const originalRead = stub.workspace.fs.readFile;
  const oldTrusted = stub.workspace.isTrusted;
  const state = new Map<string, unknown>();
  const memento = { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } };
  const session = new WorkSession({ extensionUri: f.hub, workspaceState: memento, globalState: memento } as never);
  try {
    stub.workspace.isTrusted = false; results = [];
    Object.assign(stub.workspace.fs, {
      stat: async (u: ReturnType<typeof uri>) => { const s = await fs.stat(u.fsPath); return { type: s.isDirectory() ? 2 : 1, size: s.size, mtime: s.mtimeMs }; },
      readFile: async (u: ReturnType<typeof uri>) => fs.readFile(u.fsPath)
    });
    const create = async (root: ReturnType<typeof uri>) => {
      await fs.mkdir(path.join(root.fsPath, ".datapass"));
      await fs.writeFile(path.join(root.fsPath, ".datapass", "project.json"), JSON.stringify({ schemaVersion: 3, project: { id: path.basename(root.fsPath), title: "Fixture" } }));
    };
    await create(f.hub);
    const paints: Array<{ step: string; source?: string; exists?: boolean }> = [];
    session.onDidPaint(step => { const obs = session.projectObservation()?.repos.get("."); paints.push({ step, source: obs?.source, exists: obs?.exists }); });
    await session.refresh();
    assert.equal(session.refreshStatus().phase, "settled");
    assert.deepEqual(paints.slice(0, 2), [
      { step: "first-paint", source: "none", exists: false }, { step: "settled", source: "coordination", exists: true }
    ]);
    await session.refresh();
    assert.equal(session.refreshStatus().phase, "settled");
    assert.deepEqual(paints.slice(2, 4), [
      { step: "first-paint", source: "coordination", exists: true }, { step: "settled", source: "coordination", exists: true }
    ], "a settings/background refresh cannot replace a checked clone with pending declarations");
    const next = uri(path.join(f.root, "two")); await create(next);
    folders.splice(0, folders.length, { uri: next });
    await session.refresh();
    assert.equal(session.root?.fsPath, next.fsPath);
    assert.deepEqual(paints.slice(4, 6), [
      { step: "first-paint", source: "none", exists: false }, { step: "settled", source: "coordination", exists: true }
    ], "a different project must not inherit another clone's verified identity");
  } finally {
    session.dispose(); stub.workspace.isTrusted = oldTrusted;
    stub.workspace.fs.stat = originalStat; stub.workspace.fs.readFile = originalRead;
    setProjectRoot(undefined); await f.cleanup();
  }
});

test("MCP absence avoids empty searches; existing/excluded files and uncertain reads retain search semantics", async () => {
  const f = await fixture();
  try {
    searches = 0; results = [];
    assert.equal((await probeTools()).get("ws.mcp")?.state, "absent");
    assert.equal(searches, 0);
    const mcp = path.join(f.root, "two", ".vscode", "mcp.json");
    await fs.mkdir(path.dirname(mcp)); await fs.writeFile(mcp, "{}");
    results = [uri(mcp)];
    assert.equal((await probeTools()).get("ws.mcp")?.state, "present");
    assert.equal(searches, 1);
    results = []; // A real findFiles exclusion still decides visibility.
    assert.equal((await probeTools()).get("ws.mcp")?.state, "absent");
    assert.equal(searches, 2);
    folders.splice(0, folders.length, { uri: uri("/remote/project", "remote") });
    results = [uri("/remote/project/.vscode/mcp.json", "remote")];
    assert.equal((await probeTools()).get("ws.mcp")?.state, "present");
    assert.equal(searches, 3, "permission failures must fall back rather than prove absence");
  } finally { await f.cleanup(); }
});

test("local project reads preserve exact bytes, size bounds, missing files and directory errors", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, "graph.json");
    const bytes = Buffer.from('{"items":[]}\n');
    await fs.writeFile(file, bytes);
    const read = await readProjectFile(uri(file) as never, bytes.length);
    assert.equal(read.kind, "ok");
    if (read.kind === "ok") assert.deepEqual(Buffer.from(read.bytes), bytes);
    assert.deepEqual(await readProjectFile(uri(file + ".missing") as never, 100), { kind: "absent" });
    const large = await readProjectFile(uri(file) as never, bytes.length - 1);
    assert.equal(large.kind === "error" && large.reason, "too-large");
    const dir = await readProjectFile(uri(f.root) as never, 100);
    assert.equal(dir.kind === "error" && dir.reason, "not-a-file");
    const remote = await readProjectFile(uri("/remote/file", "remote") as never, 100);
    assert.equal(remote.kind === "error" && remote.reason, "permission-denied");
  } finally { await f.cleanup(); }
});

test("parallel disk/tracking observations retain deleted tracked secrets and failed Git answers", async () => {
  const f = await fixture();
  try {
    const manifest: DataPassProjectManifest = { schemaVersion: 3, project: { id: "test", title: "Test" }, repositories: { a: { path: "../one" } } };
    const graph = { items: [{ id: "f", kind: "function", provider: "azure-functions", artifacts: { repoRef: "a", profile: "azure-functions.python", root: "components/f" } }], relations: [] };
    const run = (ok: boolean) => observeProject({
      root: f.hub as never, manifest, graph: graph as never, trusted: true, localBindings: {}, cloneParents: [],
      git: async args => args[0] === "ls-files" ? { ok, stdout: ok ? "components/f/local.settings.json\0" : "", stderr: ok ? "" : "unavailable" }
        : args[0] === "config" ? { ok: true, stdout: "https://example.com/org/one" } : { ok: true, stdout: "# branch.head main\n" }
    });
    const deleted = (await run(true)).files.get("a\0components/f/local.settings.json");
    assert.equal(deleted?.state, "missing");
    assert.equal(deleted?.tracking?.state, "tracked", "absence on disk must never imply untracked");
    repoCache.clear();
    const failed = (await run(false)).files.get("a\0components/f/local.settings.json");
    assert.equal(failed?.state, "missing");
    assert.equal(failed?.tracking?.state, "unknown");
  } finally { await f.cleanup(); }
});

test("directory observations preserve counts, exclude links, reuse overlapping listings and refresh after edits", async () => {
  const f = await fixture();
  const port = fs as unknown as { readdir: (...args: unknown[]) => Promise<unknown> };
  const original = port.readdir;
  let reads = 0;
  try {
    const component = path.join(f.root, "one", "components", "f");
    const nested = path.join(component, "nested");
    await fs.mkdir(nested, { recursive: true });
    for (let i = 0; i < 25; i++) await fs.writeFile(path.join(nested, `${i}.py`), "pass\n");
    const outside = path.join(f.root, "external");
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, "excluded.py"), "pass\n");
    await fs.symlink(outside, path.join(component, "link"), process.platform === "win32" ? "junction" : "dir");
    port.readdir = async (...args) => { if (String(args[0]) === nested) reads++; return original.apply(fs, args); };
    const manifest: DataPassProjectManifest = { schemaVersion: 3, project: { id: "test", title: "Test" }, repositories: { a: { path: "../one" } } };
    const graph = { items: [{ id: "f", kind: "function", provider: "azure-functions", artifacts: { repoRef: "a", profile: "azure-functions.python", root: "components/f", files: ["nested/*.py"] } }], relations: [] };
    const run = () => observeProject({ root: f.hub as never, manifest, graph: graph as never, trusted: false, localBindings: {}, cloneParents: [], git: async () => { throw new Error("no Git"); } });
    assert.equal((await run()).files.get("a\0components/f")?.count, 25);
    assert.equal(reads, 1, "component walk and nested glob share this refresh's listing");
    await fs.writeFile(path.join(nested, "new.py"), "pass\n");
    assert.equal((await run()).files.get("a\0components/f")?.count, 26);
    assert.equal(reads, 2, "another refresh must read the edited directory again");
  } finally { port.readdir = original; await f.cleanup(); }
});

test("first tree presents pending checks honestly, without missing files or ready identity-dependent operations", () => {
  const manifest = perfManifest();
  const graph = parseGraph(JSON.stringify(perfGraphJson()));
  const pending = pendingProjectObservation(uri("/project") as never, manifest, true);
  const map = buildProjectMap({ manifest, graph, coordinationKey: pending.coordinationKey,
    repoObservations: pending.repos, fileObservations: pending.files, tools: new Map(), toolsPending: true,
    facts: new Map(), reviewsConfirmed: new Set(), checklist: {}, qualification: [] });
  assert.equal(map.components.length, 60);
  assert.equal(map.repositories.length, 8);
  assert.ok(map.repositories.every(r => r.state === "unverified" && /in progress/.test(r.detail)));
  assert.ok(map.components.every(c => c.artifacts?.files.every(f => f.state === "unknown")));
  assert.ok(map.components.flatMap(c => c.operations).filter(op => op.capability.localFiles !== false)
    .every(op => op.result.status !== "ready"), "operations needing a local clone remain blocked");
  assert.equal(pending.folders.size, 0, "pending state cannot authorize actions on a clone");
  const restricted = pendingProjectObservation(uri("/project") as never, manifest, false);
  assert.ok([...restricted.repos.values()].every(r => r.restricted && !r.pending));
});

test("parallel companion reads retain strict errors and reject unsafe graph paths", async () => {
  const f = await fixture();
  try {
    setProjectRoot(f.hub as never);
    const dir = path.join(f.hub.fsPath, ".datapass");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(perfManifest()));
    await fs.writeFile(path.join(dir, "graph.json"), JSON.stringify(perfGraphJson()));
    await fs.writeFile(path.join(dir, "options.json"), '{"duplicate":1,"duplicate":2}');
    const ctx = await loadProjectContext(f.hub as never);
    assert.equal(ctx.graph?.items.length, 60);
    assert.ok(ctx.optionsError);
    assert.equal(ctx.options, undefined);
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify({ ...perfManifest(), graph: "../outside.json" }));
    const bad = await loadProjectContext(f.hub as never);
    assert.equal(bad.manifest, undefined);
    assert.ok(bad.manifestErrors.length);
    assert.match(bad.manifestErrors.join(" "), /graph|relative|\.\./);
    assert.equal(bad.graph?.items.length, 60, "invalid manifest retains the existing safe default graph read");
  } finally { setProjectRoot(undefined); await f.cleanup(); }
});
