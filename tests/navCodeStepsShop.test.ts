/**
 * V5HOLE15 (V5 acceptance row 05): on the `shop` fixture, "Pick a View Here…" on the ingest notebook then
 * "Steps" reads the notebook's Hop explanation through the NavHost (async, "loading" meanwhile), and once
 * read the `hop-steps` payload has the notebook's steps and the code-steps layout emits one `role=option`
 * row per step. A file without an explanation shows the typed hole text, never an empty list.
 * `vscode` is replaced by a small in-memory stub (no VS Code needed).
 */
import assert from "node:assert/strict";
import Module from "node:module";
import { join, resolve as resolvePath } from "node:path";
import test from "node:test";
import type { ProjectMap } from "../src/core/project/projectMap";
import type { VNode } from "../src/webview/views/model";

class EventEmitter<T> {
  private ls = new Set<(e: T) => void>();
  event = (l: (e: T) => void) => { this.ls.add(l); return { dispose: () => this.ls.delete(l) }; };
  fire(e: T) { for (const l of this.ls) l(e); }
  dispose() { this.ls.clear(); }
}
const noEvent = () => ({ dispose() { /* none */ } });
const win: { activeTextEditor?: unknown; activeNotebookEditor?: unknown; showQuickPick: (items: { label: string; id: string }[]) => Promise<unknown>; showInformationMessage: () => Promise<undefined> } = {
  showQuickPick: async () => undefined, showInformationMessage: async () => undefined
};
const vscodeStub = {
  EventEmitter, window: win,
  commands: { registerCommand: () => ({ dispose() { /* none */ } }), executeCommand: async () => undefined },
  workspace: { onDidChangeConfiguration: noEvent, getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }) }
};
const mod = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const resolve = mod._resolveFilename;
mod._resolveFilename = (r: string, ...a: unknown[]) => (r === "vscode" ? "vscode" : resolve.call(Module, r, ...a));
mod._cache["vscode"] = { id: "vscode", filename: "vscode", loaded: true, exports: vscodeStub };

/* eslint-disable @typescript-eslint/no-require-imports */
const { NavHost } = require("../src/core/navigation/navHost") as typeof import("../src/core/navigation/navHost");
const { resolveBindings } = require("../src/core/navigation/bindings") as typeof import("../src/core/navigation/bindings");
const { CODE_STEPS_LOADING, CODE_STEPS_NO_FILE } = require("../src/core/navigation/bindings/codeSteps") as typeof import("../src/core/navigation/bindings/codeSteps");
const { loadUnderstanding } = require("../src/core/understanding/load") as typeof import("../src/core/understanding/load");
const { codeStepsLayoutModel } = require("../src/webview/views/layouts/codeSteps.layout") as typeof import("../src/webview/views/layouts/codeSteps.layout");
const { toBindingData } = require("../src/views/navViewData") as typeof import("../src/views/navViewData");
/* eslint-enable @typescript-eslint/no-require-imports */

const SHOP = resolvePath(__dirname, "fixtures", "v5", "shop");
const NOTEBOOK = "fabric/ingest_orders.Notebook/notebook-content.py";
const file = (repoPath: string) => ({ path: repoPath, repoPath, kind: "file", role: "source", requiredFor: [], optional: false, source: "declared", state: "found" });
const shopMap = { coordinationKey: "shop", project: { id: "shop", title: "Shop" }, subprojects: [{ id: "lake", title: "Lakehouse", componentIds: ["ingest-orders"] }],
  components: [{ id: "ingest-orders", label: "ingest_orders", kind: "notebook", children: [], incoming: [], outgoing: [],
    artifacts: { repoKey: "shop", root: "", entry: file(NOTEBOOK), files: [file(NOTEBOOK)] } }] } as unknown as ProjectMap;

function host(understandingByPath: (key: string, p: string) => Promise<unknown>) {
  return new NavHost({
    projectMap: () => shopMap, selection: () => ({}), select: async () => undefined,
    onDidChange: new EventEmitter<unknown>().event, onDidChangeSelection: new EventEmitter<unknown>().event,
    understandingLocate: (uri: { fsPath: string }) => (uri.fsPath === join(SHOP, ...NOTEBOOK.split("/")) ? { repositoryKey: "shop", nativePath: NOTEBOOK } : undefined),
    understandingByPath
  } as never);
}

/** "Pick a View Here…" on the open ingest notebook, then "Steps" (or the generic "Code steps"). */
async function pickSteps(h: InstanceType<typeof NavHost>): Promise<string[]> {
  let offered: string[] = [];
  win.activeTextEditor = { document: { uri: { scheme: "file", fsPath: join(SHOP, ...NOTEBOOK.split("/")) } } };
  win.showQuickPick = async (items) => { offered = items.map(i => i.label); return items.find(i => i.label === "Steps") ?? items.find(i => i.label === "Code steps"); };
  try { await h.pickView(); } finally { win.activeTextEditor = undefined; win.showQuickPick = async () => undefined; }
  return offered;
}

function draw(h: InstanceType<typeof NavHost>): { data: ReturnType<typeof toBindingData>; node: VNode } {
  const view = h.nav.views().find(v => v.id === h.nav.state.viewId)!;
  assert.equal(view.layout, "code-steps");
  const data = toBindingData(resolveBindings(view, { location: h.nav.state.location, projectMap: shopMap, hop: l => h.hop(l) }));
  return { data, node: codeStepsLayoutModel({ view, data, labels: {}, location: h.nav.state.location }) };
}
const all = (n: VNode): VNode[] => [n, ...(n.children ?? []).flatMap(all)];
const text = (n: VNode): string => [n.text ?? "", ...(n.children ?? []).map(text)].join(" ");
const options = (n: VNode) => all(n).filter(x => x.attrs?.role === "option");
const loaded = (h: InstanceType<typeof NavHost>) => new Promise<void>(r => { const d = h.onDidLoadHop(() => { d.dispose(); r(); }); });

test("shop ingest notebook: Steps shows loading, then one option row per explained step (bronze.orders_raw)", async () => {
  const { entries } = await loadUnderstanding(SHOP, new Map([["shop", SHOP]]));
  const entry = entries.find(e => e.nativePath === NOTEBOOK);
  assert.ok(entry, "the shop fixture ships the ingest notebook's Hop explanation");
  assert.equal(entry.state, "ok", "the explanation matches the notebook bytes (not stale)");
  const h = host(async () => entry);
  try {
    const offered = await pickSteps(h);
    assert.ok(offered.includes("Steps") || offered.includes("Code steps"), `offered: ${offered.join(", ")}`);
    assert.deepEqual([h.nav.state.location.level, h.nav.state.location.nodeId], ["artifact", `shop:${NOTEBOOK}`]);
    const done = loaded(h);
    const pending = draw(h);
    assert.equal(options(pending.node).length, 0);
    assert.match(text(pending.node), new RegExp(CODE_STEPS_LOADING), "a pending read shows loading, not 'no explanation'");
    await done;
    const ready = draw(h);
    const steps = ready.data.find(d => d.steps !== undefined)?.steps as { steps: { id: string }[] } | undefined;
    assert.deepEqual(steps?.steps.map(s => s.id), ["read", "stamp", "write", "count"]);
    const rows = options(ready.node);
    assert.equal(rows.length, 4);
    assert.ok(rows.some(r => text(r).includes("bronze.orders_raw")), "the write step's row names bronze.orders_raw");
  } finally { h.dispose(); }
});

test("no explanation (or a failed read) redraws to the typed hole text, never an empty list", async () => {
  for (const read of [async () => undefined, async () => { throw new Error("unreadable"); }]) {
    const h = host(read);
    try {
      await pickSteps(h);
      const done = loaded(h);
      assert.match(text(draw(h).node), new RegExp(CODE_STEPS_LOADING));
      await done;
      const { node } = draw(h);
      assert.equal(options(node).length, 0);
      assert.ok(text(node).includes(CODE_STEPS_NO_FILE), `hole text shown: ${text(node)}`);
    } finally { h.dispose(); }
  }
});
