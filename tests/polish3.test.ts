/**
 * V1.1.x-POLISH-3 (Julian's check of 1.1.0-rc.1): the lens is named where it can be seen without
 * hovering (tree row, status bar, one-time hint), the rail folds down to VS Code's minimum width,
 * and the separate Git view hides while the Git lens repeats it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GIT_VIEW_WHEN, LENS_INFO, LENS_ROW_COMMAND, LENS_ROW_ID, TREE_LENSES, lensRow, lensStatus, shouldHintTree } from "../src/core/windows/treeLens";
import { RAIL_BUTTON_VIEW, RAIL_PANEL_VIEWS, SOLO_CONTEXT_KEY, soloContext, soloHideKey, soloWhenSuffix } from "../src/core/windows/railSolo";
import { AUX_BAR_MIN_WIDTH, EXPAND_STEPS, FOLD_STEPS, NARROW_FOCUSED, RESIZE_STEP, WIDEN_FOCUSED, widthAfterFold } from "../src/core/windows/railFold";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("polish-3: the tree's first row names the lens shown and switches it", () => {
  for (const l of TREE_LENSES) {
    const r = lensRow(l);
    assert.equal(r.id, LENS_ROW_ID);
    assert.equal(r.command, LENS_ROW_COMMAND);
    assert.equal(r.label, `Showing: ${LENS_INFO[l].label} ▾`);
    assert.equal(r.icon, LENS_INFO[l].icon);
    for (const o of TREE_LENSES.filter(x => x !== l)) assert.ok(r.description.includes(LENS_INFO[o].label), `${l} offers ${o}`);
    assert.ok(!r.description.includes(`${LENS_INFO[l].label},`), "the lens shown is not offered again");
  }
  assert.ok(pkg.contributes.commands.some((c: { command: string }) => c.command === LENS_ROW_COMMAND), "the row's command is contributed");
});

test("polish-3: the status bar names the lens from any view", () => {
  for (const l of TREE_LENSES) {
    const s = lensStatus(l);
    assert.equal(s.text, `$(list-tree) DataPass tree: ${LENS_INFO[l].label}`);
    assert.match(s.tooltip, /Click to open the DataPass side bar/);
  }
});

test("polish-3: the hint shows once, only for an open project whose tree is off screen", () => {
  assert.equal(shouldHintTree({ readable: true, treeVisible: false, shown: false }), true);
  assert.equal(shouldHintTree({ readable: true, treeVisible: false, shown: true }), false, "never twice");
  assert.equal(shouldHintTree({ readable: true, treeVisible: true, shown: false }), false, "the tree is already on screen");
  assert.equal(shouldHintTree({ readable: false, treeVisible: false, shown: false }), false, "no DataPass project");
});

test("polish-3: the separate Git view hides while the Git lens repeats it", () => {
  const view = pkg.contributes.views.datapass.find((v: { id: string }) => v.id === "datapass.git");
  assert.equal(view.when, GIT_VIEW_WHEN);
  assert.match(view.when, /datapass\.tree\.lens != git/);
  // The Git commands stay: the view's title and item menus are unchanged.
  const titles = pkg.contributes.menus["view/title"] as Array<{ when: string }>;
  assert.ok(titles.some(t => t.when.includes("view == datapass.git")));
});

test("polish-3: the fold reaches VS Code's minimum from any usual width; Expand gives a readable panel back", () => {
  for (const start of [300, 990, 1600]) assert.equal(widthAfterFold(start), AUX_BAR_MIN_WIDTH, `${start} px`);
  assert.ok(FOLD_STEPS > 10, "more than the 10 steps rc.1 allowed");
  assert.equal(AUX_BAR_MIN_WIDTH + EXPAND_STEPS * RESIZE_STEP, 470);
  // rc.1 used the width commands, which recent VS Code applies to the editor (the left side bar moved instead).
  assert.equal(NARROW_FOCUSED, "workbench.action.decreaseViewSize");
  assert.equal(WIDEN_FOCUSED, "workbench.action.increaseViewSize");
});

test("polish-3: each rail button unfolds its own view alone (not the whole stack, AI first)", () => {
  assert.deepEqual(RAIL_BUTTON_VIEW, { details: "details", ai: "aiExchange", airflow: "airflowDag" });
  const full = soloContext(undefined);
  assert.equal(full[SOLO_CONTEXT_KEY], false);
  for (const v of RAIL_PANEL_VIEWS) assert.equal(full[soloHideKey(v)], false, `${v} shows in the full panel`);
  for (const solo of RAIL_PANEL_VIEWS) {
    const k = soloContext(solo);
    assert.equal(k[SOLO_CONTEXT_KEY], true);
    for (const v of RAIL_PANEL_VIEWS) assert.equal(k[soloHideKey(v)], v !== solo, `${solo} alone: ${v}`);
  }
});

test("polish-3: the solo keys are in the panel views' when clauses; a solo view folds back or brings the full panel", () => {
  const views = pkg.contributes.views["datapass-details"] as Array<{ id: string; when: string }>;
  for (const v of RAIL_PANEL_VIEWS) assert.ok(views.find(x => x.id === `datapass.${v}`)!.when.endsWith(soloWhenSuffix(v)), v);
  const titles = pkg.contributes.menus["view/title"] as Array<{ command: string; when: string }>;
  const on = (command: string, clause: string) => titles.some(t => t.command === command && t.when.split("||").map(x => x.trim()).includes(clause));
  assert.ok(on("datapass.rail.collapse", "view == datapass.airflowDag"));
  for (const v of ["aiExchange", "details", "airflowDag"]) assert.ok(on("datapass.rail.expand", `view == datapass.${v} && datapass.rail.solo`), v);
});
