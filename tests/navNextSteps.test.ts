/**
 * V4-NAV NAVTODO1: the 'next-steps' binding lists only existing facts, per Location, deduplicated and
 * bounded; the pack offers a table view everywhere, groups by lifecycle step then Location, and a row
 * click goes to its Location (and view).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { collectNextSteps, MAX_NEXT_STEPS, todoCount, type NextStepsFacts, type NextStepsLocator } from "../src/core/navigation/bindings/nextSteps";
import { groupNextSteps, nextStepCommands, NEXT_STEPS_PACK, NEXT_STEPS_VIEW_ID } from "../src/core/navigation/packs/nextSteps";
import { PACKS } from "../out/gen/packs";
import { NAV_LEVELS, type NavLadder, type NavLocation } from "../src/core/navigation/navTypes";

const root: NavLocation = { level: "project", nodeId: "p", artifactKind: "project" };
const sub = (id: string): NavLocation => ({ level: "subproject", nodeId: id, artifactKind: "subproject" });
const comp = (id: string): NavLocation => ({ level: "artifact", nodeId: id, artifactKind: "sql-script" });
const parents: Record<string, NavLocation> = { a: sub("s1"), b: sub("s2") };
const locator: NextStepsLocator = { root, component: id => comp(id), subproject: id => sub(id), repository: () => comp("a") };
const ladder: NavLadder = {
  root: () => root,
  parent: l => l.level === "artifact" ? parents[l.nodeId] ?? root : l.level === "subproject" ? root : null,
  children: () => [],
};

const component = (id: string, health: string, extra: object = {}) =>
  ({ id, health, nextStep: `do ${id}`, problems: [], checklist: [], ...extra }) as never;

const facts: NextStepsFacts = {
  map: {
    nextStep: "", problems: [{ severity: "error", where: "graph.json items.x", message: "bad ref" }],
    subprojects: [],
    components: [
      component("a", "blocked", { checklist: [{ key: "k", id: "c1", label: "Review SQL", state: "todo" }, { key: "k2", id: "c2", label: "Done", state: "done" }] }),
      component("b", "ok"),
    ],
  },
  readiness: { checks: [{ id: "x", severity: "warning", area: "environment", message: "KEY missing", nextStep: "set it" }],
    files: [{ id: "f", path: ".env", repoKey: "r", optional: false, state: "missing", git: "unknown", keysDefined: 0 }] },
  board: { cards: [
    { id: "T1", type: "bug", title: "fix", done: false, components: [{ id: "b", label: "B", known: true }], subprojects: [], overdue: false } as never,
    { id: "T2", type: "task", title: "old", done: true, components: [], subprojects: [], overdue: false } as never,
  ] },
  holes: [{ reason: "lineage: no parser for .ipynb" }, { reason: "lineage: no parser for .ipynb" }],
};

test("next-steps lists only existing facts, deduplicated, with origins", () => {
  const r = collectNextSteps(facts, locator);
  const texts = r.rows.map(x => `${x.kind}|${x.location.nodeId}|${x.text}`);
  assert.ok(texts.includes("readiness|a|do a"));
  assert.ok(!texts.some(t => t.includes("do b")), "healthy component adds nothing");
  assert.ok(texts.includes("check|a|Review SQL") && !texts.some(t => t.endsWith("|Done")));
  assert.ok(texts.includes("board|b|bug T1: fix") && !texts.some(t => t.includes("T2")));
  assert.ok(texts.includes("readiness|a|.env: missing"));
  assert.equal(r.rows.filter(x => x.kind === "hole").length, 1);
  assert.equal(r.rows[0]!.severity, "error");
  assert.equal(r.rows.find(x => x.kind === "board")!.viewId, "board");
  assert.equal(todoCount(r), r.total);
  assert.equal(r.countByLocation.get("artifact:a"), 3);
  assert.deepEqual(r.holes, []);
});

test("no facts = no rows and a typed hole", () => {
  const r = collectNextSteps({}, locator);
  assert.equal(r.rows.length, 0);
  assert.equal(r.holes.length, 1);
});

test("scope keeps the Location's subtree", () => {
  const r = collectNextSteps(facts, locator, { scope: sub("s2"), ladder });
  assert.deepEqual(r.rows.map(x => x.location.nodeId), ["b"]);
  assert.equal(collectNextSteps(facts, locator, { scope: root, ladder }).total, collectNextSteps(facts, locator).total);
});

test("bounded to 500", () => {
  const many: NextStepsFacts = { holes: Array.from({ length: 600 }, (_, i) => ({ reason: `h${i}` })) };
  const r = collectNextSteps(many, locator);
  assert.equal(r.rows.length, MAX_NEXT_STEPS);
  assert.equal(r.total, 600);
  assert.ok(r.truncated);
});

test("pack: table view everywhere, grouping by step then Location, click = go (+ view)", () => {
  assert.equal(NEXT_STEPS_PACK.length, NAV_LEVELS.length);
  assert.ok(NEXT_STEPS_PACK.every(e => e.artifactKind === "*" && e.views[0]!.layout === "table" && e.views[0]!.id === NEXT_STEPS_VIEW_ID));
  for (const e of NEXT_STEPS_PACK) assert.ok(PACKS.includes(e));
  const r = collectNextSteps(facts, locator, { processStep: l => l.nodeId === "a" ? "build" : l.nodeId === "b" ? "design" : null });
  const g = groupNextSteps(r.rows, { build: "Construire" });
  assert.deepEqual(g.map(x => x.step), ["design", "build", null]);
  assert.equal(g[1]!.label, "Construire");
  assert.equal(g[2]!.label, "Not placed in the lifecycle yet");
  const board = r.rows.find(x => x.kind === "board")!;
  assert.deepEqual(nextStepCommands(board), [{ type: "go", location: comp("b") }, { type: "view", viewId: "board" }]);
});

test("next-steps binding adapter: registered, scopes rows to the Location, typed hole for missing facts", async () => {
  const { bindingProvider } = await import("../src/core/navigation/bindings");
  const p = bindingProvider("next-steps");
  assert.ok(p, "next-steps provider registered via *.binding.ts");
  const map = {
    project: { id: "p", title: "P" },
    components: [
      { id: "a", health: "blocked", nextStep: "Fix a", problems: [], checklist: [] },
      { id: "b", health: "attention", nextStep: "Look at b", problems: [], checklist: [] },
    ],
    subprojects: [
      { id: "s1", health: "ready", nextStep: "", checklist: [], componentIds: ["a"] },
      { id: "s2", health: "ready", nextStep: "", checklist: [], componentIds: ["b"] },
    ],
    problems: [],
  } as unknown as import("../src/core/project/projectMap").ProjectMap;
  const all = p!.provide({ location: { level: "project", nodeId: "p", artifactKind: "project" }, projectMap: map });
  assert.deepEqual(all.rows!.map(r => r.label).sort(), ["Fix a", "Look at b"]);
  const s1 = p!.provide({ location: { level: "subproject", nodeId: "s1", artifactKind: "subproject" }, projectMap: map });
  assert.deepEqual(s1.rows!.map(r => r.label), ["Fix a"]);
  assert.ok(s1.holes.some(h => /not in the binding context/.test(h.reason)));
  const none = p!.provide({ location: { level: "project", nodeId: "p", artifactKind: "project" } });
  assert.equal(none.rows, undefined);
  assert.equal(none.holes.length, 1);
});
