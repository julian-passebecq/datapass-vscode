/**
 * NAVWIRE1: the NavHost wiring. Every self-registered NAV surface plugs into the host, every view of
 * the catalog is reachable from the host (and drawn by the view host), the renderer accepts the host's
 * nav-state message (a7), and the generated index carries every *.layout/*.palette/*.binding file.
 * `vscode` is replaced by a small in-memory stub (no VS Code needed).
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ProjectMap } from "../src/core/project/projectMap";
import type { NavLadder, NavLocation, ViewCatalog } from "../src/core/navigation/navTypes";

// ---- vscode stub (installed before any module that imports `vscode` is required) ----
const commands = new Map<string, (...a: unknown[]) => unknown>();
const executed: string[] = [];
const panels: { title: string; webview: { html: string } }[] = [];
class EventEmitter<T> {
  private ls = new Set<(e: T) => void>();
  event = (l: (e: T) => void) => { this.ls.add(l); return { dispose: () => this.ls.delete(l) }; };
  fire(e: T) { for (const l of this.ls) l(e); }
  dispose() { this.ls.clear(); }
}
const noEvent = () => ({ dispose() { /* none */ } });
const vscodeStub = {
  EventEmitter,
  Disposable: class { constructor(private readonly fn: () => void) {} dispose() { this.fn(); } },
  ViewColumn: { One: 1, Two: 2 },
  Uri: { joinPath: (base: unknown, ...p: string[]) => (base && typeof base === "object" ? { scheme: "file", fsPath: join((base as { fsPath: string }).fsPath, ...p) } : [base, ...p].join("/")) },
  commands: {
    registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { commands.set(id, fn); return { dispose: () => commands.delete(id) }; },
    executeCommand: async (id: string) => { executed.push(id); }
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: async () => undefined,
    showQuickPick: async () => undefined,
    registerWebviewViewProvider: () => ({ dispose() { /* none */ } }),
    createWebviewPanel: (_t: string, title: string) => {
      const panel = { title, visible: true, viewColumn: 1, iconPath: undefined as unknown, webview: { html: "", cspSource: "vscode-resource:", onDidReceiveMessage: noEvent },
        onDidDispose: noEvent, onDidChangeViewState: noEvent, reveal() { /* shown */ }, dispose() { /* closed */ } };
      panels.push(panel);
      return panel;
    }
  },
  workspace: {
    workspaceFolders: undefined,
    onDidChangeConfiguration: noEvent,
    createFileSystemWatcher: () => ({ onDidChange: noEvent, onDidCreate: noEvent, onDidDelete: noEvent, dispose() { /* none */ } }),
    getConfiguration: () => ({ get: <T>(_k: string, d: T) => d })
  }
};
const mod = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const resolve = mod._resolveFilename;
mod._resolveFilename = (r: string, ...a: unknown[]) => (r === "vscode" ? "vscode" : resolve.call(Module, r, ...a));
mod._cache["vscode"] = { id: "vscode", filename: "vscode", loaded: true, exports: vscodeStub };

/* eslint-disable @typescript-eslint/no-require-imports */
const { registerNavigation } = require("../src/core/navigation/register") as typeof import("../src/core/navigation/register");
const { SURFACES, SURFACES_FILES } = require("../out/gen/surfaces") as typeof import("../out/gen/surfaces");
const { LAYOUTS, LAYOUTS_FILES } = require("../out/gen/layouts") as typeof import("../out/gen/layouts");
const { PALETTE, PALETTE_FILES } = require("../out/gen/palette") as typeof import("../out/gen/palette");
const { BINDINGS, BINDINGS_FILES } = require("../out/gen/bindings") as typeof import("../out/gen/bindings");
const { registeredLayouts } = require("../src/webview/views/renderer") as typeof import("../src/webview/views/renderer");
const { parseHostMessage } = require("../src/webview/views/model") as typeof import("../src/webview/views/model");
const { PALETTE_TIERS } = require("../src/core/experience/palette") as typeof import("../src/core/experience/palette");
const { bindingSources } = require("../src/core/navigation/bindings") as typeof import("../src/core/navigation/bindings");
const { PACKS_FILES } = require("../out/gen/packs") as typeof import("../out/gen/packs");
const { composeCatalog } = require("../src/core/navigation/viewPacks") as typeof import("../src/core/navigation/viewPacks");
const { DEFAULT_VIEW_CATALOG, sameLocation } = require("../src/core/navigation/navTypes") as typeof import("../src/core/navigation/navTypes");

const map = {
  project: { id: "p", title: "Demo", schemaVersion: 2 },
  subprojects: [{ id: "ingest", title: "Ingest", componentIds: ["nb1"], health: "ok", summary: { components: 1 }, nextStep: "none" }],
  components: [{ id: "nb1", label: "Load raw", kind: "notebook", headline: "ready", nextStep: "run", incoming: [], outgoing: [], children: [] }]
} as unknown as ProjectMap;

function session() {
  const sel = new EventEmitter<unknown>();
  let selection: { subproject?: string; component?: string } = {};
  return {
    projectMap: () => map, selection: () => selection,
    select: async (s: { subproject?: string; component?: string }) => { selection = s; },
    onDidChange: new EventEmitter<unknown>().event, onDidChangeSelection: sel.event
  };
}
function context() { return { subscriptions: [] as { dispose(): void }[], extensionUri: "ext" } as never; }

/** Every location below the root, by `down` through the host (depth-first). */
function walk(ladder: NavLadder, from: NavLocation, out: NavLocation[] = []): NavLocation[] {
  out.push(from);
  for (const c of ladder.children(from)) walk(ladder, c, out);
  return out;
}

test("every self-registered NAV surface plugs into the host", () => {
  assert.ok(SURFACES.length > 0 && SURFACES.length === SURFACES_FILES.length);
  assert.ok(SURFACES_FILES.includes("src/views/navView.surface"));
  const ctx = context();
  const host = registerNavigation(ctx, session());
  for (const [i, surface] of SURFACES.entries()) {
    const own = context() as unknown as { subscriptions: unknown[] };
    const ret = surface(own as never, host);
    assert.ok(own.subscriptions.length > 0 || ret, `${SURFACES_FILES[i]} registers nothing`);
  }
  for (const id of ["datapass.navView.open", "datapass.nav.up", "datapass.nav.down", "datapass.nav.pickView"]) assert.ok(commands.has(id), id);
  assert.equal(host.projectMap(), map, "the host exposes the map its NavigationService ladder walks, not a copy");
  host.dispose();
});

test("every catalog view is reachable from the host and drawn by the view host", async () => {
  commands.clear(); panels.length = 0;
  const host = registerNavigation(context(), session());
  // The project ladder reaches project → subproject → component…
  const reached = walk(host.nav.ladder, host.nav.ladder.root());
  assert.deepEqual(reached.map(l => l.level), ["project", "subproject", "artifact"]);
  // …and a ladder with one artifact per catalog kind (NAVLOC1's granularity) reaches every catalog entry.
  const catalog: ViewCatalog = host.nav.catalog; // DEFAULT_VIEW_CATALOG + every *.pack.ts
  const root = host.nav.ladder.root();
  const sub: NavLocation = { level: "subproject", nodeId: "ingest", artifactKind: "subproject" };
  const below = catalog.entries.filter(e => e.level !== "project" && e.level !== "subproject" && e.artifactKind !== "*")
    .map((e, i): NavLocation => ({ level: e.level, nodeId: `n${i}`, artifactKind: e.artifactKind }));
  const ladder: NavLadder = {
    root: () => root,
    parent: l => (sameLocation(l, root) ? null : sameLocation(l, sub) ? root : sub),
    children: l => (sameLocation(l, root) ? [sub] : sameLocation(l, sub) ? below : [])
  };
  host.nav.setLadder(ladder);
  await commands.get("datapass.navView.open")!();
  const panel = panels.at(-1)!;
  const seen = new Set<string>();
  for (const loc of walk(ladder, root)) {
    host.nav.dispatch({ type: "go", location: loc });
    assert.ok(sameLocation(host.nav.state.location, loc), `cannot reach ${loc.level}/${loc.artifactKind}`);
    for (const v of host.nav.views()) {
      host.nav.dispatch({ type: "view", viewId: v.id });
      assert.equal(host.nav.state.viewId, v.id);
      assert.ok(panel.title.includes(v.title), `${loc.artifactKind}/${v.id} not drawn (title "${panel.title}")`);
      assert.ok(parseHostMessage(host.message()), `renderer drops nav-state at ${loc.artifactKind}/${v.id}`);
      seen.add(`${loc.level}|${loc.artifactKind}|${v.id}`);
    }
  }
  for (const e of catalog.entries.filter(x => x.artifactKind !== "*"))
    for (const v of e.views) assert.ok(seen.has(`${e.level}|${e.artifactKind}|${v.id}`), `unreachable: ${e.level}/${e.artifactKind}/${v.id}`);
  host.dispose();
});

test("a7: the renderer accepts the host's nav-state message (views carry their bindings)", () => {
  const host = registerNavigation(context(), session());
  const msg = parseHostMessage(JSON.parse(JSON.stringify(host.message())));
  assert.ok(msg && msg.type === "nav-state");
  assert.ok(msg.views.length > 0 && msg.views.every(v => Array.isArray(v.bindings)));
  host.dispose();
});

test("the generated index registers every layout, palette and binding file", () => {
  assert.ok(LAYOUTS.length >= LAYOUTS_FILES.length && LAYOUTS_FILES.length > 0);
  for (const l of LAYOUTS) assert.ok(registeredLayouts().includes(l.kind), l.kind);
  assert.ok(PALETTE.length >= PALETTE_FILES.length && PALETTE_FILES.length > 0);
  for (const entry of PALETTE) for (const [surface, cmds] of Object.entries(entry))
    for (const c of cmds) assert.equal(PALETTE_TIERS.get(`datapass.${c}`), surface, c);
  assert.ok(BINDINGS.length >= BINDINGS_FILES.length);
  for (const b of BINDINGS) assert.ok(bindingSources().includes(b.source), b.source);
});

test("view packs: the host's catalog is DEFAULT_VIEW_CATALOG + every *.pack.ts, packs append views without overriding", () => {
  assert.ok(Array.isArray(PACKS_FILES));
  const host = registerNavigation(context(), session());
  for (const e of DEFAULT_VIEW_CATALOG.entries) {
    const got = host.nav.catalog.entries.find(x => x.artifactKind === e.artifactKind && x.level === e.level);
    assert.deepEqual(got?.views.slice(0, e.views.length).map(v => v.id), e.views.map(v => v.id));
  }
  host.dispose();
  const erd = { id: "erd", title: "ERD", layout: "table" as const, bindings: [{ source: "schema-erd" }] };
  const composed = composeCatalog(DEFAULT_VIEW_CATALOG, [
    { artifactKind: "subproject", level: "subproject", views: [erd, { ...DEFAULT_VIEW_CATALOG.entries[1]!.views[0]!, title: "dup" }] },
    { artifactKind: "dbt-model", level: "artifact", views: [erd] }]);
  const sub = composed.entries.find(e => e.artifactKind === "subproject")!;
  assert.equal(sub.views.at(-1)!.id, "erd");
  assert.equal(sub.views.filter(v => v.id === DEFAULT_VIEW_CATALOG.entries[1]!.views[0]!.id).length, 1, "a base view id wins");
  assert.ok(composed.entries.some(e => e.artifactKind === "dbt-model" && e.views.some(v => v.id === "erd")));
  assert.equal(DEFAULT_VIEW_CATALOG.entries.find(e => e.artifactKind === "subproject")!.views.some(v => v.id === "erd"), false, "base not mutated");
});

test("a10: the host ladder takes artifact kinds from file heads read from the repository folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dp-a10-"));
  mkdirSync(join(dir, "nb")); mkdirSync(join(dir, "sql"));
  writeFileSync(join(dir, "nb", "load.ipynb"), JSON.stringify({ cells: [{ cell_type: "code", source: ["df = spark.read.parquet('raw')"] }], metadata: {} }));
  writeFileSync(join(dir, "sql", "orders.sql"), "select * from orders");
  const file = (repoPath: string) => ({ path: repoPath, repoPath, kind: "file", role: "source", requiredFor: [], optional: false, source: "declared", state: "found" });
  const comp = (id: string, entry: string) => ({ id, label: id, kind: "job", children: [], incoming: [], outgoing: [],
    artifacts: { repoKey: "lake", root: "", entry: file(entry), files: [file(entry)] } });
  const kindMap = { coordinationKey: "a10", project: { id: "p", title: "A10" },
    subprojects: [{ id: "s", title: "S", componentIds: ["nb", "q"] }], components: [comp("nb", "nb/load.ipynb"), comp("q", "sql/orders.sql")] } as unknown as ProjectMap;
  let selection: { subproject?: string; component?: string } = { subproject: "s", component: "nb" };
  const sel = new EventEmitter<unknown>();
  const host = registerNavigation(context(), {
    projectMap: () => kindMap, selection: () => selection, select: async (s) => { selection = s; },
    onDidChange: new EventEmitter<unknown>().event, onDidChangeSelection: sel.event,
    repoFolder: (k: string) => (k === "lake" ? { scheme: "file", fsPath: dir } : undefined) as never
  });
  const kinds = () => Object.fromEntries(host.nav.ladder.children({ level: "subproject", nodeId: "s", artifactKind: "subproject" }).map(c => [c.nodeId, c.artifactKind]));
  assert.equal(kinds().nb, "other", "before the head is read: no guess");
  assert.equal(kinds().q, "sql-script", "SQL is known from its path");
  assert.equal(host.nav.state.location.nodeId, "nb");
  for (let i = 0; i < 50 && kinds().nb === "other"; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(kinds().nb, "spark-notebook", "after the 4 KB head is read");
  assert.deepEqual([host.nav.state.location.nodeId, host.nav.state.location.artifactKind], ["nb", "spark-notebook"], "the location follows its new kind, not reset to the root");
  // A tree selection (kind-free) lands on the classified node; a file below the component maps back to it.
  selection = { subproject: "s", component: "q" }; sel.fire(undefined);
  assert.deepEqual([host.nav.state.location.nodeId, host.nav.state.location.artifactKind], ["q", "sql-script"]);
  host.nav.dispatch({ type: "down" });
  assert.equal(host.nav.state.location.nodeId, "lake:sql/orders.sql");
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(selection, { subproject: "s", component: "q" });
  host.dispose();
});
