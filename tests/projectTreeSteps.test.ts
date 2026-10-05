/**
 * V5 STEPBAR1 (CEO ARCHI REVIEW B1/B2): the Project lens lists no check nodes any more (they are in the
 * Steps view); the Readiness lens keeps them for one release; a found file carries its resourceUri
 * (VS Code's Git decorations) and no check icon; the `git` order groups found files as Tracked /
 * Untracked with ignored ones hidden. `vscode` is replaced by a small in-memory stub.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

class EventEmitter<T> {
  private ls = new Set<(e: T) => void>();
  event = (l: (e: T) => void) => { this.ls.add(l); return { dispose: () => this.ls.delete(l) }; };
  fire(e: T) { for (const l of this.ls) l(e); }
  dispose() { this.ls.clear(); }
}
class TreeItem { id?: string; description?: string; iconPath?: unknown; resourceUri?: { path: string }; tooltip?: unknown; command?: unknown; contextValue?: string; constructor(public label: string, public collapsibleState?: number) {} }
class ThemeIcon { static File = new ThemeIcon("file"); constructor(public id: string, public color?: unknown) {} }
class ThemeColor { constructor(public id: string) {} }
class MarkdownString { value = ""; appendMarkdown(s: string) { this.value += s; return this; } }
const settings: Record<string, unknown> = {};
const uri = (p: string) => ({ fsPath: p, path: p });
const vscodeStub = {
  EventEmitter, TreeItem, ThemeIcon, ThemeColor, MarkdownString,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: { file: uri, joinPath: (b: { path: string }, ...p: string[]) => uri([b.path, ...p].join("/")) },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() { /* none */ } }) },
  window: {},
  workspace: {
    isTrusted: true,
    onDidChangeConfiguration: () => ({ dispose() { /* none */ } }),
    getConfiguration: (section: string) => ({ get: <T>(k: string, d?: T) => (settings[`${section}.${k}`] as T) ?? d })
  }
};
const mod = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const resolve = mod._resolveFilename;
mod._resolveFilename = (r: string, ...a: unknown[]) => (r === "vscode" ? "vscode" : resolve.call(Module, r, ...a));
mod._cache["vscode"] = { id: "vscode", filename: "vscode", loaded: true, exports: vscodeStub };

/* eslint-disable @typescript-eslint/no-require-imports */
const { ProjectTreeProvider } = require("../src/views/projectTree") as typeof import("../src/views/projectTree");
const { groupByTracking, trackingOf, TrackingCache, parseTreeOrder } = require("../src/views/projectTreeGitOrder") as typeof import("../src/views/projectTreeGitOrder");
/* eslint-enable @typescript-eslint/no-require-imports */

const file = (repoPath: string, state: string) => ({ path: repoPath.split("/").pop()!, repoPath, kind: "file", state, optional: false, source: "declared", role: "code", requiredFor: ["build"] });
const COMPONENT = { id: "ingest", label: "Ingest", kind: "job", headline: "", nextStep: "", health: "ok", children: [], artifacts: { repoKey: "app", files: [file("src/ingest.py", "found"), file("src/new.py", "found"), file("src/out.log", "found"), file("src/schema.sql", "missing")] } };
const MAP = {
  nextStep: "Run the pipeline", components: [COMPONENT], relations: [],
  subprojects: [{ id: "main", title: "Main", componentIds: ["ingest"], implicit: false, summary: { filesFound: 3, filesExpected: 4, opsReady: 0, opsTotal: 0 }, health: "ok", nextStep: "", needs: { repositories: [], tools: [] } }],
  repositories: [{ key: "app", label: "App", state: "local", detail: "", usedBy: [] }], problems: []
};
const READINESS = {
  declared: true, files: [], keys: [{ name: "DB_NAME", state: "missing", definedIn: [], source: "vault" }], identifiers: [], companions: [], repositories: [],
  toolchain: { declared: true, entries: [], summary: { ok: 0, total: 0, attention: 0, notChecked: 0 } }, extensions: { state: "absent", expected: [], extra: [] },
  connections: [{ id: "az", kind: "sign-in", label: "Azure", state: "signed-out", detail: "signed out" }],
  checks: [{ id: "env.key.missing:DB_NAME", severity: "error", area: "environment", message: "DB_NAME is not set." }], summary: { errors: 1, warnings: 0, infos: 0, keysSet: 0 }
};
const session = {
  project: { root: uri("/w"), manifestExists: true, manifestErrors: [] },
  projectMap: () => MAP, readiness: () => READINESS, preview: () => undefined, variants: () => undefined, boardView: () => undefined,
  toolkitFileResults: () => [], projectRootCandidates: () => [], selection: () => ({}), repoFolder: (k: string) => (k === "app" ? uri("/w/app") : undefined),
  onDidChange: () => ({ dispose() { /* none */ } }), onDidChangeSelection: () => ({ dispose() { /* none */ } })
};
const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);
const CHECK_SECTIONS = ["env", "tools", "connections", "readiness"];

test("selection reveal never uses a subproject cached before a project refresh", async () => {
  const changed = new EventEmitter<void>();
  const selected = new EventEmitter<void>();
  let currentMap = MAP;
  const tree = new ProjectTreeProvider({ ...session, projectMap: () => currentMap,
    selection: () => ({ subproject: "main" }), onDidChange: changed.event,
    onDidChangeSelection: selected.event } as never);
  const revealed: string[] = [];
  tree.attach({ visible: true, selection: [],
    onDidChangeVisibility: () => ({ dispose() {} }), onDidChangeSelection: () => ({ dispose() {} }),
    reveal: async (node: { id: string }) => { revealed.push(node.id); } } as never);
  try {
    await tree.getChildren();
    selected.fire();
    assert.deepEqual(revealed, ["sp:main"], "a current rendered subproject still follows selection");
    revealed.length = 0;
    currentMap = { ...MAP, subprojects: [] };
    changed.fire();
    selected.fire();
    await tree.getChildren();
    selected.fire();
    assert.deepEqual(revealed, [], "a removed subproject must not be handed to VS Code reveal during or after refresh");
  } finally { tree.dispose(); changed.dispose(); selected.dispose(); }
});

test("Project lens: no check nodes (readiness, tools, sign-ins); the Readiness lens keeps them", async () => {
  const tree = new ProjectTreeProvider(session as never);
  const roots = await tree.getChildren() as { id: string }[];
  assert.deepEqual(ids(roots), ["lens", "next", "sp:main", "repositories"]);
  for (const id of CHECK_SECTIONS) assert.ok(!ids(roots).includes(id), `no ${id} in the Project lens`);
  tree.setLenses({ current: "readiness", chosen: "readiness" } as never);
  const ready = ids(await tree.getChildren() as { id: string }[]);
  for (const id of ["env", "connections", "readiness"]) assert.ok(ready.includes(id), `${id} in the Readiness lens`);
  tree.dispose();
});

test("Project lens: a found file carries its resourceUri and no check icon; an absent one keeps one small state", async () => {
  const tree = new ProjectTreeProvider(session as never);
  const roots = await tree.getChildren() as never[];
  const comps = await tree.getChildren(roots[2]) as never[];
  const files = await tree.getChildren(comps[0]) as never[];
  const items = files.map((f) => tree.getTreeItem(f) as unknown as TreeItem);
  const found = items.find((i) => i.label === "ingest.py")!;
  assert.equal(found.resourceUri?.path, "/w/app/src/ingest.py");
  assert.equal(found.iconPath, ThemeIcon.File);
  assert.equal(found.description, undefined);
  const missing = items.find((i) => i.label === "schema.sql")!;
  assert.equal(missing.resourceUri, undefined);
  assert.match(String(missing.description), /missing/);
  tree.dispose();
});

test("git order: per repository, Tracked then Untracked, ignored hidden, every file with its resourceUri", async () => {
  const asked: string[][] = [];
  const tree = new ProjectTreeProvider(session as never);
  // The provider's own cache, fed by a fake Git (tracked: ingest.py; untracked not ignored: new.py; out.log ignored).
  (tree as unknown as { tracking: InstanceType<typeof TrackingCache> }).tracking = new TrackingCache(async (args) => {
    asked.push(args);
    return { ok: true, stdout: args.includes("--others") ? "src/new.py\0" : "src/ingest.py\0" };
  });
  settings["datapass.tree.order"] = "git";
  try {
    let roots = await tree.getChildren() as { id: string }[];
    assert.deepEqual(ids(roots), ["lens", "next", "git-order:app", "repositories"]);
    await new Promise((r) => setTimeout(r, 10));
    roots = await tree.getChildren() as { id: string }[];
    const groups = await tree.getChildren(roots[2] as never) as { id: string; label: string }[];
    assert.deepEqual(groups.map((g) => g.label), ["Tracked", "Untracked"]);
    const tracked = (await tree.getChildren(groups[0] as never) as never[]).map((f) => tree.getTreeItem(f) as unknown as TreeItem);
    const untracked = (await tree.getChildren(groups[1] as never) as never[]).map((f) => tree.getTreeItem(f) as unknown as TreeItem);
    assert.deepEqual(tracked.map((i) => i.resourceUri?.path), ["/w/app/src/ingest.py"]);
    assert.deepEqual(untracked.map((i) => i.resourceUri?.path), ["/w/app/src/new.py"]);
    assert.equal(asked.length, 2, "one tracked + one untracked call per clone");
    assert.ok(asked.every((a) => a[0] === "ls-files"), "read-only ls-files only");
  } finally { delete settings["datapass.tree.order"]; tree.dispose(); }
});

test("git order (pure): failed answers are 'unknown', never hidden; order setting defaults to architecture", () => {
  const paths = ["a.py", "b.py", "c.log"];
  const t = trackingOf(paths, { ok: true, stdout: "a.py\0" }, { ok: true, stdout: "b.py\0" }, false);
  assert.deepEqual([...t.values()], ["tracked", "untracked", "ignored"]);
  const failed = trackingOf(paths, { ok: false, stdout: "", stderr: "boom" }, { ok: true, stdout: "" }, false);
  assert.ok([...failed.values()].every((s) => s === "unknown"));
  const g = groupByTracking(paths.map((repoPath) => ({ repoPath })), (f) => t.get(f.repoPath));
  assert.deepEqual([g.tracked.length, g.untracked.length, g.unknown.length], [1, 1, 0]);
  assert.equal(parseTreeOrder(undefined), "architecture");
  assert.equal(parseTreeOrder("git"), "git");
});
