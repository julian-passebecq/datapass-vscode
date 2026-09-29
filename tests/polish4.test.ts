/**
 * V1.1.x-POLISH-4 (Julian's check of 1.1.0-rc.1, remaining remarks): the DataPass activity-bar icon can
 * be brought back and reads at its size, code zoom is one click (or one key) away, "Appearance…" gathers
 * the theme settings, and a Home button restores the project layout.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_BAR_HINT, APPEARANCE_IDS, HOME_LAYOUT_NAME, HOME_RESTORE_COMMAND, HOME_STATUS, SHOW_CONTAINER_COMMAND, ZOOM_COMMANDS, ZOOM_KEYS,
  activityBarHidden, appearanceItems, isAppearanceId, projectLayout, settingScope, zoomStatus, zoomedFontSize
} from "../src/core/experience/ergonomics";
import { HOME_ACTIONS, homeState, type HomeInput } from "../src/views/homeState";
import { homeHtml, homeTools } from "../src/views/homeHtml";
import { buildProjectMap } from "../src/core/project/projectMap";
import { inputA } from "./fixtures/v3/research";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const commands = new Set((pkg.contributes.commands as Array<{ command: string }>).map(c => c.command));
const viewTitle = pkg.contributes.menus["view/title"] as Array<{ command: string; when: string; group?: string }>;

test("polish-4: the activity-bar icon is one bold, simple shape, used by every DataPass container", () => {
  const svg = readFileSync("resources/datapass.svg", "utf8");
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.equal((svg.match(/<path/g) ?? []).length, 1, "one path");
  assert.match(svg, /fill="currentColor"/, "VS Code tints it with the theme");
  assert.match(svg, /fill-rule="evenodd"/);
  assert.ok(svg.length < 400, "a simple shape (the 1.0 icon had sixteen thin squares)");
  // The ring is thick enough to read at 24 px: the outer D and its hole leave ≥ 3 px on every side.
  const d = /d="([^"]+)"/.exec(svg)![1]!;
  assert.match(d, /^M3 2\.5h8a9\.5 9\.5 0 0 1 0 19H3v-19Z/);
  assert.match(d, /Zm3\.8 3\.8v11\.4H11a5\.7 5\.7 0 0 0 0-11\.4H6\.8Z/, "the hole starts at (6.8, 6.3)");
  const containers = pkg.contributes.viewsContainers as Record<string, Array<{ id: string; icon: string }>>;
  for (const list of Object.values(containers)) for (const c of list) assert.equal(c.icon, "resources/datapass.svg", c.id);
  assert.equal(SHOW_CONTAINER_COMMAND, `workbench.view.extension.${containers.activitybar![0]!.id}`);
});

test("polish-4: \"Show DataPass in the Activity Bar\" is listed in every mode and says how to keep the icon", () => {
  assert.ok(commands.has("datapass.showInActivityBar"));
  const palette = pkg.contributes.menus.commandPalette as Array<{ command: string; when?: string }>;
  assert.equal(palette.find(e => e.command === "datapass.showInActivityBar"), undefined, "no when clause: every mode");
  assert.match(ACTIVITY_BAR_HINT, /right-click the Activity Bar/);
  assert.match(ACTIVITY_BAR_HINT, /tick DataPass/);
  assert.equal(activityBarHidden("hidden", undefined), true);
  assert.equal(activityBarHidden("default", false), true, "the older setting");
  for (const l of ["default", "top", "bottom", undefined]) assert.equal(activityBarHidden(l, true), false, String(l));
});

test("polish-4: A− / A+ / reset step VS Code's editor.fontSize by one pixel, between 6 and 40", () => {
  assert.equal(zoomedFontSize(14, "bigger"), 15);
  assert.equal(zoomedFontSize(14, "smaller"), 13);
  assert.equal(zoomedFontSize(12.5, "bigger"), 13, "a half size goes to the next whole one");
  assert.equal(zoomedFontSize(12.5, "smaller"), 12);
  assert.equal(zoomedFontSize(40, "bigger"), 40);
  assert.equal(zoomedFontSize(6, "smaller"), 6);
  assert.equal(zoomedFontSize(undefined, "bigger"), 15, "VS Code's default is 14");
  assert.equal(zoomedFontSize("x", "smaller"), 13);
  assert.equal(zoomedFontSize(18, "reset"), undefined, "reset removes the value");
  const s = zoomStatus(15);
  assert.deepEqual([s.smaller, s.size, s.bigger], ["$(zoom-out)", "$(text-size) 15", "$(zoom-in)"]);
  assert.match(s.tooltip, /Alt\+-/);
  assert.match(s.tooltip, /Ctrl\+= \/ Ctrl\+- zoom the whole window/);
  assert.equal(zoomStatus(undefined).size, "$(text-size) 14");
});

test("polish-4: the zoom keys are contributed, avoid VS Code's window zoom and AltGr (Ctrl+Alt) combinations", () => {
  const keys = pkg.contributes.keybindings as Array<{ command: string; key: string; mac?: string }>;
  for (const [step, command] of Object.entries(ZOOM_COMMANDS)) {
    assert.ok(commands.has(command), command);
    const k = keys.find(x => x.command === command);
    assert.equal(k?.key, ZOOM_KEYS[step as keyof typeof ZOOM_KEYS], command);
    if (step === "reset") assert.equal(k, undefined, "Alt+0 is VS Code's \"last editor in group\": reset has no key");
  }
  for (const k of keys) {
    assert.doesNotMatch(k.key, /^ctrl\+(=|-|\+|numpad_add|numpad_subtract|0|numpad0)$/, "VS Code's own zoom");
    assert.notEqual(k.key, "alt+0", "VS Code's last editor in group");
    assert.doesNotMatch(k.key, /ctrl\+alt|alt\+ctrl/, "Ctrl+Alt is AltGr on French keyboards");
  }
});

test("polish-4: Appearance lists the theme, the overlay, its colours, the tree icons, the diagram style and the code size", () => {
  const items = appearanceItems({ themeName: "Light Modern", canToggleTheme: true, overlay: true, coloredIcons: false, diagramTheme: "microsoft", fontSize: 13 });
  const ids = items.filter(i => i.id).map(i => i.id);
  assert.deepEqual([...ids].sort(), [...APPEARANCE_IDS].sort(), "every choice once");
  assert.equal(items.find(i => i.id === "theme.pick")?.description, "Light Modern");
  assert.match(items.find(i => i.id === "overlay.toggle")!.label, /Hide the DataPass overlay/);
  assert.match(items.find(i => i.id === "tree.colors")!.label, /Coloured tree icons/);
  assert.equal(items.find(i => i.id === "font.pick")?.description, "now 13 px");
  assert.ok(items.some(i => i.separator), "grouped");
  const off = appearanceItems({ canToggleTheme: false, overlay: false, coloredIcons: true, diagramTheme: "vscode" });
  assert.ok(!off.some(i => i.id === "theme.toggle"), "no light/dark toggle on an older VS Code");
  assert.match(off.find(i => i.id === "overlay.toggle")!.label, /Show the DataPass overlay/);
  assert.match(off.find(i => i.id === "tree.colors")!.label, /Neutral tree icons/);
  assert.equal(isAppearanceId("overlay.toggle"), true);
  assert.equal(isAppearanceId("workbench.action.quit"), false, "a command name is not a choice");
  assert.equal(settingScope(undefined), "user");
  assert.equal(settingScope({ workspaceValue: false }), "workspace");
  assert.equal(settingScope({ workspaceValue: false, workspaceFolderValue: true }), "folder");
  assert.ok(commands.has("datapass.appearance"));
  assert.ok(viewTitle.some(m => m.command === "datapass.appearance" && m.when === "view == datapass.project"), "in the tree's … menu");
});

test("polish-4: Home restores the layout named Home, else the startup one, else the last applied, else none", () => {
  const views = [{ id: "a", name: "Review" }, { id: "b", name: "home" }, { id: "c", name: "Morning" }];
  assert.deepEqual(projectLayout({ views, startup: "Morning", lastApplied: "a" }), { id: "b", why: "home" });
  const noHome = views.filter(v => v.id !== "b");
  assert.deepEqual(projectLayout({ views: noHome, startup: "morning", lastApplied: "a" }), { id: "c", why: "startup" });
  assert.deepEqual(projectLayout({ views: noHome, startup: "c" }), { id: "c", why: "startup" }, "by id too");
  assert.deepEqual(projectLayout({ views: noHome, startup: "home", lastApplied: "a" }), { id: "a", why: "last" }, "\"home\" opens the Home page only");
  assert.equal(projectLayout({ views: noHome, lastApplied: "gone" }), undefined);
  assert.equal(projectLayout({ views: [] }), undefined);
  assert.equal(HOME_LAYOUT_NAME, "Home");
});

test("polish-4: the Home button is in the status bar text and in the tree's and the rail's title bars", () => {
  assert.ok(commands.has(HOME_RESTORE_COMMAND));
  assert.match(HOME_STATUS.text, /^\$\(home\) Home$/);
  const entry = viewTitle.find(m => m.command === HOME_RESTORE_COMMAND)!;
  assert.equal(entry.group, "navigation@0", "first button");
  for (const v of ["datapass.project", "datapass.rail", "datapass.aiExchange", "datapass.details", "datapass.agentPanel", "datapass.airflowDag"]) {
    assert.ok(entry.when.split(" || ").includes(`view == ${v}`), v);
  }
});

test("polish-4: the Home page has the toolbar (Home, Appearance, A− size A+, reset, icon) and names the Home layout", () => {
  for (const id of ["home.restore", "appearance.open", "font.smaller", "font.bigger", "font.reset", "activityBar.show", "layout.saveHome"]) {
    assert.ok(HOME_ACTIONS[id], id);
    assert.ok(commands.has(HOME_ACTIONS[id]!.command), `${id} → ${HOME_ACTIONS[id]!.command}`);
  }
  assert.deepEqual(HOME_ACTIONS["layout.saveHome"]!.args, ["Home"]);
  const map = buildProjectMap(inputA());
  const input = (over: Partial<HomeInput> = {}): HomeInput => ({ hasProject: true, map, workOrdersEnabled: false, layouts: [], shows: () => true, ...over });
  const withSize = homeHtml(homeState(input({ codeFontSize: 16, homeLayout: "My <home>" })), "home", "vscode-resource:", "N0NCE");
  assert.match(withSize, /data-tools/);
  assert.match(withSize, /Code 16 px/);
  for (const id of ["home.restore", "appearance.open", "font.smaller", "font.bigger", "font.reset", "activityBar.show", "layout.saveHome"]) assert.match(withSize, new RegExp(`data-action="${id.replace(".", "\\.")}"`), id);
  assert.match(withSize, /restores the layout <strong>My &lt;home&gt;<\/strong>/, "escaped");
  const none = homeHtml(homeState(input()), "home", "vscode-resource:", "N0NCE");
  assert.match(none, /Save a layout named "Home"/);
  assert.match(homeTools(homeState(input())), /Code 14 px/, "VS Code's default when unset");
});
