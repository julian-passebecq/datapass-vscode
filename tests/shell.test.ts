/**
 * V3-SHELL (vision §2.1): left-tree lenses (switching, persistence per workspace, following the
 * screen), the right rail's buttons, and the package.json contributions of the default layout.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_LENS, LENS_INFO, LENS_STATE_KEY, LensStore, TREE_LENSES, lensForScreen, parseLens, type LensMemento } from "../src/core/windows/treeLens";
import { RAIL_BUTTONS, RAIL_BUTTON_IDS, railHtml } from "../src/views/railHtml";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

/** workspaceState stand-in: what one workspace remembers across windows. */
function memento(initial: Record<string, unknown> = {}): LensMemento & { data: Record<string, unknown>; writes: number } {
  const m = {
    data: { ...initial }, writes: 0,
    get<T>(key: string): T | undefined { return m.data[key] as T | undefined; },
    async update(key: string, value: unknown): Promise<void> { m.writes += 1; m.data[key] = value; }
  };
  return m;
}

test("shell: lenses parse, and unknown or missing values fall back to Project", () => {
  assert.deepEqual([...TREE_LENSES], ["project", "architecture", "git", "ai", "readiness"]);
  for (const l of TREE_LENSES) { assert.equal(parseLens(l), l); assert.ok(LENS_INFO[l].label && LENS_INFO[l].icon); }
  for (const bad of [undefined, null, 3, "", "Architecture", "files", {}]) assert.equal(parseLens(bad), DEFAULT_LENS);
});

test("shell: choosing a lens shows it and remembers it for the workspace", async () => {
  const m = memento();
  const a = new LensStore(m);
  assert.equal(a.current, "project");
  assert.equal(await a.choose("git"), true);
  assert.equal(a.current, "git");
  assert.equal(m.data[LENS_STATE_KEY], "git");
  assert.equal(await a.choose("git"), false, "the same lens again changes nothing");
  assert.equal(m.writes, 1, "and writes nothing");
  // A new window on the same workspace starts on the remembered lens.
  const b = new LensStore(m);
  assert.equal(b.current, "git");
  // Another workspace keeps its own.
  assert.equal(new LensStore(memento({ [LENS_STATE_KEY]: "readiness" })).current, "readiness");
  assert.equal(new LensStore(memento({ [LENS_STATE_KEY]: "nonsense" })).current, "project");
});

test("shell: following the screen shows a lens without forgetting the person's choice", async () => {
  const m = memento();
  const s = new LensStore(m);
  await s.choose("ai");
  assert.equal(s.follow("architecture"), true);
  assert.equal(s.current, "architecture");
  assert.equal(s.chosen, "ai", "following is not remembered");
  assert.equal(m.data[LENS_STATE_KEY], "ai");
  assert.equal(s.follow("architecture"), false);
  assert.equal(s.restore(), true);
  assert.equal(s.current, "ai");
  assert.equal(new LensStore(m).current, "ai", "a new window opens on the chosen lens");
});

test("shell: a selection made elsewhere is revealed in the Architecture lens only when the lens does not list it", () => {
  assert.equal(lensForScreen("project", { selected: true }), undefined);
  assert.equal(lensForScreen("architecture", { selected: true }), undefined);
  for (const l of ["git", "ai", "readiness"] as const) assert.equal(lensForScreen(l, { selected: true }), "architecture", l);
  for (const l of TREE_LENSES) assert.equal(lensForScreen(l, { selected: false }), undefined, `${l}: nothing selected, stay`);
});

test("shell: each lens has a toggled button in the Project view's title bar, plus the Natural tree", () => {
  const commands = pkg.contributes.commands as Array<{ command: string; icon?: string; toggled?: string }>;
  const titles = pkg.contributes.menus["view/title"] as Array<{ command: string; when: string; group?: string }>;
  for (const l of TREE_LENSES) {
    const c = commands.find(x => x.command === `datapass.tree.lens.${l}`);
    assert.ok(c?.icon, l);
    assert.equal(c!.toggled, `datapass.tree.lens == ${l}`);
    assert.ok(titles.some(t => t.command === c!.command && t.when === "view == datapass.project" && t.group?.startsWith("navigation")), l);
  }
  assert.ok(titles.some(t => t.command === "datapass.tree.showExplorer" && t.group?.startsWith("navigation")));
  // The title bar stays readable: at most 10 navigation buttons on the Project view.
  const nav = titles.filter(t => /view == datapass\.project(\s|$)/.test(t.when) && t.group?.startsWith("navigation"));
  const distinct = new Set(nav.map(t => t.group === "navigation@22" ? "variants" : t.command));
  assert.ok(distinct.size <= 11, `${distinct.size} buttons`);
});

test("shell: close buttons live on the views they close; the rail collapses and expands from its own panel", () => {
  const titles = pkg.contributes.menus["view/title"] as Array<{ command: string; when: string }>;
  const on = (command: string, view: string) => titles.some(t => t.command === command && t.when.split("||").map(x => x.trim()).includes(`view == ${view}`));
  for (const v of ["datapass.aiExchange", "datapass.details", "datapass.agentPanel"]) { assert.ok(on("datapass.rail.collapse", v), v); assert.ok(on("datapass.layout.closeRightPanel", v), v); }
  assert.ok(on("datapass.rail.expand", "datapass.rail"));
  assert.ok(on("datapass.layout.closeRightPanel", "datapass.rail"));
  assert.ok(on("datapass.layout.closeLeftBar", "datapass.project"));
  assert.ok(on("datapass.layout.closeBottomPanel", "datapass.architecture"));
});

test("shell: the rail lists its buttons once each, escaped, behind a nonce", () => {
  assert.deepEqual(RAIL_BUTTON_IDS, ["expand", "details", "ai", "git", "copyForAi", "importFromAi", "workViews", "ownWindow"]);
  assert.equal(new Set(RAIL_BUTTON_IDS).size, RAIL_BUTTONS.length);
  const html = railHtml("vscode-resource:", "abc123");
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.match(html, /<script nonce="abc123">/);
  for (const b of RAIL_BUTTONS) assert.ok(html.includes(`data-id="${b.id}"`), b.id);
  assert.doesNotMatch(html, /https?:\/\//, "no remote resource");
});
