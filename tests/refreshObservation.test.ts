/** Performance regressions retain origin identity, workspace precedence and search exclusions. */
import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";
import type { GitRunner } from "../src/core/workspace/gitBase";
import type { DataPassProjectManifest } from "../src/core/projectManifestModel";

const uri = (p: string, scheme = "file") => ({ scheme, fsPath: p, path: p, toString: () => `${scheme}:${p}` });
const folders: Array<{ uri: ReturnType<typeof uri> }> = [];
let searches = 0;
let results: ReturnType<typeof uri>[] = [];
const stub = {
  Uri: { file: uri, joinPath: (b: ReturnType<typeof uri>, ...p: string[]) => uri(path.join(b.fsPath, ...p), b.scheme) },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  extensions: { getExtension: () => undefined },
  workspace: {
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
const { locateRepositories, observeProject, repoCache } = require("../src/work/projectObserver") as typeof import("../src/work/projectObserver");
const { probeTools } = require("../src/core/capabilities/probe") as typeof import("../src/core/capabilities/probe");
const { readProjectFile } = require("../src/core/workspace/readFile") as typeof import("../src/core/workspace/readFile");

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
