/**
 * V3-HOME (pure parts): the project links format (validator, editor schema, limits), the Home state
 * (tiles by skill area, fixed action table, hidden surfaces, no-links how-to, architecture preview)
 * and the rendered page (escaped, CSP with nonce, messages carry ids only), and work views that
 * keep the Home tab.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { linkUrlProblem, linksProblems, LINKS_MAX_BYTES, MAX_LINKS, parseLinks } from "../src/core/project/links";
import { emittedSchemaFiles } from "../src/core/contracts/schemaFiles";
import { buildProjectMap } from "../src/core/project/projectMap";
import { boardView } from "../src/core/project/board";
import { HOME_ACTIONS, homeState, LINKS_HOW_TO, type HomeInput } from "../src/views/homeState";
import { homeHtml } from "../src/views/homeHtml";
import { describeView, parseWorkViews, viewProblem, type WorkView } from "../src/core/windows/workViews";
import { fileObsA, inputA } from "./fixtures/v3/research";
import { optionsA } from "./fixtures/v3/researchOptions";
import { boardA } from "./fixtures/v3/researchBoard";
import { linksAJson } from "./fixtures/v3/researchLinks";

const text = (x: unknown) => JSON.stringify(x);
const bad = (mutate: (x: any) => void, re: RegExp) => {
  const x = linksAJson() as any;
  mutate(x);
  assert.throws(() => parseLinks(text(x)), re);
};

test("links: the example is valid; https, http on localhost, queries without secrets are accepted", () => {
  const f = parseLinks(text(linksAJson()));
  assert.equal(f.groups.length, 3);
  for (const ok of ["https://adb-1.2.azuredatabricks.net/?o=1", "http://localhost:8501/", "http://127.0.0.1:3000/x", "http://[::1]:8080/", "https://app.fabric.microsoft.com/groups/abc?experience=data-engineering"]) {
    assert.equal(linkUrlProblem(ok), undefined, ok);
  }
  assert.deepEqual(linksProblems(f, ["dev", "prod"]), []);
});

test("links: the validator refuses http, credentials, tokens, other schemes, unknown kinds and oversized files", () => {
  assert.match(linkUrlProblem("http://example.com/dash")!, /https/);
  assert.match(linkUrlProblem("http://localhost.evil.com/")!, /https/);
  assert.match(linkUrlProblem("https://user:pw@example.com/")!, /user name or password/);
  assert.match(linkUrlProblem("https://acct.blob.core.windows.net/c/x?sv=2024&sig=abc")!, /token or a signature/);
  assert.match(linkUrlProblem("https://example.com/?access_token=abc")!, /token/);
  assert.match(linkUrlProblem("https://example.com/#access_token=abc")!, /token/);
  assert.match(linkUrlProblem("javascript:alert(1)")!, /https/);
  assert.match(linkUrlProblem("file:///C:/x")!, /https/);
  assert.match(linkUrlProblem("https://exa mple.com/")!, /spaces/);
  assert.match(linkUrlProblem("https://example.com/\u202e")!, /control/);
  bad(x => { x.groups[0].links[0].url = "http://adb.example.net/"; }, /https/);
  bad(x => { x.groups[0].links[0].url = "https://me:secret@adb.example.net/"; }, /user name or password/);
  bad(x => { x.groups[0].links[0].kind = "monitoring"; }, /Invalid links file/);
  bad(x => { x.groups[0].links[0].extra = 1; }, /is not an allowed property/);
  bad(x => { x.version = 2; }, /Invalid links file/);
  bad(x => { x.groups[0].links = []; }, /at least 1 items/);
  bad(x => { x.groups[1].id = "workspaces"; }, /Duplicate group id/);
  bad(x => { x.groups[0].links[0].url = `https://example.com/${"a".repeat(2100)}`; }, /Invalid links file/);
  bad(x => { x.groups = Array.from({ length: 6 }, (_, i) => ({ title: `G${i}`, links: Array.from({ length: 60 }, (__, j) => ({ label: `L${j}`, url: `https://example.com/${j}`, kind: "docs" })) })); }, new RegExp(`at most ${MAX_LINKS}`));
  assert.throws(() => parseLinks(" ".repeat(LINKS_MAX_BYTES + 1)), /bytes|large|size/i);
  // Warnings, not errors: an environment the manifest does not declare.
  const f = parseLinks(text(linksAJson()));
  assert.match(linksProblems(f, ["dev"])[0]!, /environment "prod" is not declared/);
});

test("links: the editor schema refuses what the runtime refuses and is committed", () => {
  const schema = new Ajv2020({ strict: false, validateFormats: false }).compile(emittedSchemaFiles()["schemas/datapass-links.schema.json"] as object);
  assert.ok(schema(linksAJson()), JSON.stringify(schema.errors));
  for (const mutate of [(x: any) => { x.groups[0].links[0].kind = "grafana"; }, (x: any) => { x.groups[0].extra = 1; }, (x: any) => { delete x.groups[0].links[0].url; }, (x: any) => { x.groups[0].links[0].url = "ftp://x.example.com/"; }]) {
    const x = linksAJson() as any;
    mutate(x);
    assert.equal(schema(x), false);
    assert.throws(() => parseLinks(text(x)));
  }
  assert.deepEqual(JSON.parse(readFileSync("schemas/datapass-links.schema.json", "utf8")), emittedSchemaFiles()["schemas/datapass-links.schema.json"], "committed schema is up to date (npm run schemas)");
});

const input = (over: Partial<HomeInput> = {}): HomeInput => {
  const map = buildProjectMap(inputA());
  return {
    hasProject: true, map, board: boardView(boardA(), { map, files: fileObsA(), options: optionsA(), today: "2026-09-25" }),
    links: parseLinks(text(linksAJson())), optionsDecisions: optionsA().decisions.length, workOrdersEnabled: false,
    layouts: [{ id: "papers", name: "Papers review", detail: "Extraction · 2 groups, 3 files" }], shows: () => true, ...over
  };
};

test("home: tiles grouped by skill area, each action in the fixed table, Hop marked coming", () => {
  const s = homeState(input());
  assert.deepEqual(s.areas.map(a => a.title), ["Build & understand", "Deliver", "Run & reach"]);
  assert.deepEqual(s.areas.flatMap(a => a.tiles.map(t => t.id)), ["architecture", "understand", "git", "ai", "board", "readiness", "links"]);
  for (const t of s.areas.flatMap(a => a.tiles)) for (const a of t.actions) assert.ok(HOME_ACTIONS[a.id], `${t.id}: ${a.id} is in the table`);
  const hop = s.areas[0]!.tiles[1]!;
  assert.equal(hop.coming, true);
  assert.deepEqual(hop.actions, []);
  assert.match(s.areas[0]!.tiles[0]!.summary, /components? in 2 sub-projects/);
  assert.equal(s.links.count, 7);
  assert.match(s.areas[2]!.tiles[1]!.summary, /7 links in 3 groups/);
  const ai = s.areas[1]!.tiles[1]!;
  assert.match(ai.actions.find(a => a.id === "ai.workOrders")!.disabled!, /off on this computer/);
  assert.ok(s.preview && s.preview.lanes.length >= 1 && s.preview.components > 0);
  // Every command the table names is an existing command of package.json (the Home adds none behind its tiles, except its own pages).
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const contributed = new Set<string>((pkg.contributes.commands as Array<{ command: string }>).map(c => c.command));
  const views = new Set<string>(Object.values(pkg.contributes.views as Record<string, Array<{ id: string }>>).flat().map(v => `${v.id}.focus`));
  for (const [id, a] of Object.entries(HOME_ACTIONS)) assert.ok(contributed.has(a.command) || views.has(a.command), `${id}: ${a.command}`);
});

test("home: hidden surfaces disable their action; no links shows the how-to; no project offers to open one", () => {
  const hidden = homeState(input({ shows: s => s !== "view.git" }));
  assert.match(hidden.areas[1]!.tiles[0]!.actions[0]!.disabled!, /Hidden in this DataPass mode/);
  const none = homeState(input({ links: undefined }));
  assert.equal(none.links.state, "none");
  assert.equal(none.areas[2]!.tiles[1]!.summary, LINKS_HOW_TO);
  assert.match(LINKS_HOW_TO, /No links declared/);
  assert.deepEqual(none.areas[2]!.tiles[1]!.actions.map(a => a.id), ["links.page"]);
  const broken = homeState(input({ links: undefined, linksError: "Invalid links file: $.groups[0] bad" }));
  assert.equal(broken.links.state, "error");
  assert.equal(broken.areas[2]!.tiles[1]!.attention, true);
  const empty = buildProjectMap({ ...inputA(), manifest: undefined, graph: undefined });
  const noProject = homeState(input({ hasProject: false, map: empty, board: undefined, links: undefined, layouts: [] }));
  assert.equal(noProject.project, undefined);
  assert.equal(noProject.preview, undefined);
  assert.match(noProject.areas[0]!.tiles[0]!.actions[0]!.disabled!, /Open a DataPass project/);
  assert.match(homeHtml(noProject, "home", "vscode-resource:", "N0NCE"), /data-action="project.open"/);
});

test("home page: escaped text, CSP with the nonce, buttons carry ids only (never a command or a URL)", () => {
  const s = homeState(input({ layouts: [{ id: "x", name: "<img src=x onerror=alert(1)>", detail: "d" }] }));
  const html = homeHtml(s, "home", "vscode-resource:", "N0NCE");
  assert.match(html, /script-src 'nonce-N0NCE'/);
  assert.match(html, /<script nonce="N0NCE">/);
  assert.ok(!html.includes("<img src=x"), "names are escaped");
  assert.ok(!/"datapass\.[a-z]/i.test(html), "no command id in the page");
  assert.ok(!html.includes("https://"), "the Home lists no link addresses");
  assert.match(html, /data-layout="x"/);
  assert.match(html, /data-action="layout.save"/);
  const links = homeHtml(s, "links", "vscode-resource:", "N0NCE");
  assert.ok(!links.includes("https://adb-"), "the links page shows hosts, not full addresses");
  assert.match(links, /adb-1234567890123456\.7\.azuredatabricks\.net/);
  assert.match(links, /data-group="1" data-index="1"/);
  assert.match(links, /on this computer/);
  const none = homeHtml(homeState(input({ links: undefined })), "links", "vscode-resource:", "N0NCE");
  assert.match(none, /No links declared/);
});

test("work views: the Home tab is saved like the Workbench tab (at most once) and described", () => {
  const v: WorkView = {
    id: "home-left", name: "Home left", savedAt: "2026-09-27T10:00:00.000Z",
    editors: { layout: { orientation: 0, groups: [{ size: 0.4 }, { size: 0.6 }] }, groups: [{ tabs: [{ home: true }] }, { tabs: [{ workbench: true }, { repo: ".", path: "README.md" }] }] }
  };
  const file = parseWorkViews(JSON.stringify({ format: "datapass.work-views", version: "1", views: [v] }));
  assert.equal(file.views[0]!.editors!.groups[0]!.tabs[0]!.hasOwnProperty("home"), true);
  assert.match(describeView(v), /Home tab/);
  assert.match(describeView(v), /1 file\b/);
  const twice: WorkView = { ...v, editors: { ...v.editors!, groups: [{ tabs: [{ home: true }] }, { tabs: [{ home: true }] }] } };
  assert.match(viewProblem(twice)!, /Home appears twice/);
  assert.throws(() => parseWorkViews(JSON.stringify({ format: "datapass.work-views", version: "1", views: [{ ...v, editors: { ...v.editors!, groups: [{ tabs: [{ home: false }] }, { tabs: [] }] } }] })), /Invalid views\.json/);
});
