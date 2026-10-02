/** V4-NAV NAVHOME1: `project-health` binding and the `home` view pack. Synthetic data only. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardTiles, isLocalUser, parseRecentLog, projectHealth, readRecentChanges, RECENT_LOG_ARGS, type ProjectHealthFacts
} from "../src/core/navigation/bindings/projectHealth";
import { HOME_PACK_VIEWS } from "../src/core/navigation/packs/home";
import { PACKS } from "../out/gen/packs";
import { LAYOUT_KINDS } from "../src/core/navigation/navTypes";

const comp = (id: string, health: string) => ({ id, health }) as never;
const card = (id: string, status: string, assignee?: string, done = false) =>
  ({ id, type: "task", title: `T ${id}`, status, done, assignee, components: [], subprojects: [], files: [], labels: [], links: [], overdue: false }) as never;
const pr = (number: number, ci: string, review = "none", draft = false) =>
  ({ number, title: `PR ${number}`, head: "h", draft, review, ci: { state: ci, total: 1, passed: 0, running: 0, failed: [] }, url: `https://x/${number}` }) as never;
const board = (cards: never[]) => ({
  board: { format: "datapass.board", version: "1", columns: [{ id: "todo" }, { id: "review" }, { id: "done", done: true }], items: [] } as never,
  view: { cards } as never
});

test("dashboardTiles: known ids, order kept, duplicates dropped, default when empty", () => {
  assert.deepEqual(dashboardTiles(["ci", "bogus", "ci", "drift"]), ["ci", "drift"]);
  assert.deepEqual(dashboardTiles([]), ["readiness", "open-items", "drift", "ci", "reviews"]);
  assert.deepEqual(dashboardTiles(undefined).length, 5);
});

test("no facts: every tile unknown, holes reported, no guess", () => {
  const r = projectHealth({});
  assert.ok(r.metrics.every(t => t.state === "unknown" && t.value === "—"));
  assert.ok(r.holes.some(h => h.reason.startsWith("drift")));
  assert.ok(r.holes.some(h => h.reason.startsWith("recent")));
  assert.equal(r.metrics.find(t => t.id === "ci")!.detail, "No cached CI status");
});

test("readiness, CI (cache only), reviews, awaiting", () => {
  const facts: ProjectHealthFacts = {
    map: { components: [comp("a", "ok"), comp("b", "blocked"), comp("c", "attention")], subprojects: [], problems: [] },
    prs: [{ repoKey: "r1", prs: { source: "glab", open: [pr(1, "passing"), pr(2, "failing", "review-required"), pr(3, "running", "review-required", true)], closed: [] } }],
    board: board([card("1", "review", "bob"), card("2", "review", "me@x.io"), card("3", "todo", "me"), card("4", "todo", "me", true)]),
    approvals: [{ id: "ap1", title: "Approve prod", requestedFrom: "me" }, { id: "ap2", title: "Other", requestedFrom: "eve" }],
    gitUser: { name: "Me", email: "me@x.io" },
    drift: { compared: 4, differing: 1 }
  };
  const r = projectHealth(facts, { titles: { ci: "Pipelines" } });
  const tile = (id: string) => r.metrics.find(m => m.id === id)!;
  const t = { readiness: tile("readiness"), ci: tile("ci"), drift: tile("drift"), reviews: tile("reviews") };
  assert.equal(t.readiness.value, "1/3"); assert.equal(t.readiness.state, "blocked"); assert.equal(t.readiness.go.filter, "blocked");
  assert.equal(t.ci.value, "failing"); assert.equal(t.ci.title, "Pipelines"); assert.equal(t.ci.origin, "observed");
  assert.equal(t.drift.value, "1");
  // reviews: 2 cards in review + 2 open approvals + 1 non-draft review-required PR
  assert.equal(t.reviews.value, "5");
  const kinds = r.awaiting.map(a => `${a.kind}:${a.id}`);
  assert.deepEqual(kinds, ["review:1", "approval:ap1", "pull-request:r1#2", "board:2", "board:3"]);
});

test("isLocalUser matches name, e-mail and handle", () => {
  const u = { name: "Ana Lee", email: "ana@corp.io" };
  assert.ok(isLocalUser("ana lee", u)); assert.ok(isLocalUser("ANA@corp.io", u)); assert.ok(isLocalUser("@ana", u));
  assert.ok(!isLocalUser("bob", u)); assert.ok(!isLocalUser(undefined, u)); assert.ok(!isLocalUser("ana", undefined));
});

test("recent: read-only bounded log args, parse, merge newest first, failed repo = hole", async () => {
  assert.equal(RECENT_LOG_ARGS[0], "log"); assert.ok(RECENT_LOG_ARGS.includes("-n20"));
  const rec = (sha: string, date: string, s: string) => `${sha}\u001fA\u001fa@x\u001f${date}\u001f${s}\u001e`;
  assert.equal(parseRecentLog(rec("zz", "d", "bad") + rec("abcdef1", "2026-10-01T00:00:00Z", "ok"), "r").length, 1);
  const runs: string[] = [];
  const out = await readRecentChanges(async (args, cwd) => {
    runs.push(cwd);
    if (cwd === "bad") return undefined;
    return cwd === "a" ? rec("aaaaaaa", "2026-09-01T00:00:00Z", "old") : rec("bbbbbbb", "2026-10-01T00:00:00Z", "new") + "\n";
  }, [{ repoKey: "A", folder: "a" }, { repoKey: "B", folder: "b" }, { repoKey: "C", folder: "bad" }]);
  assert.deepEqual(out.recent.map(c => c.subject), ["new", "old"]);
  assert.equal(out.holes.length, 1);
});

test("home pack: project level, three views, known layouts, registered", () => {
  assert.deepEqual(HOME_PACK_VIEWS.map(v => v.id), ["dashboard", "recent-changes", "awaiting-you"]);
  assert.ok(HOME_PACK_VIEWS.every(v => (LAYOUT_KINDS as readonly string[]).includes(v.layout)));
  assert.ok(PACKS.some(e => e.level === "project" && e.views === HOME_PACK_VIEWS));
  // every tile's go target is a view the pack (or another pack/catalog) names
  const r = projectHealth({});
  assert.ok(r.metrics.every(m => typeof m.go.viewId === "string" && m.go.viewId.length > 0));
});

test("project-health binding adapter: registered, tiles from the project map, typed holes for missing facts", async () => {
  const { bindingProvider } = await import("../src/core/navigation/bindings");
  const p = bindingProvider("project-health");
  assert.ok(p, "project-health provider registered via *.binding.ts");
  const root = { level: "project" as const, nodeId: "p", artifactKind: "project" };
  const map = { components: [{ health: "ok" }, { health: "blocked" }], subprojects: [], problems: [] } as unknown as import("../src/core/project/projectMap").ProjectMap;
  const m = p!.provide({ location: root, projectMap: map, params: { part: "metrics" } });
  assert.equal(m.metrics!.find(t => t.id === "readiness")!.value, "1/2");
  assert.ok(m.holes.some(h => /drift/.test(h.reason)));
  const recent = p!.provide({ location: root, params: { part: "recent" } });
  assert.deepEqual(recent.rows, []);
  assert.ok(recent.holes.some(h => /git log/.test(h.reason)));
  assert.match(p!.provide({ location: { level: "subproject", nodeId: "s", artifactKind: "subproject" } }).holes[0]!.reason, /project level/);
});
