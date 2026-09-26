/**
 * 0.21 toolkit catalogue: the built-in baseline, hub files layered over it (entry by entry, never
 * guessed), dated prices, recipes resolved against project facts and probes, `recipe` on board
 * items, the "Needs a newer DataPass" list, and the AI exchange of tools.json.
 */
import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import {
  baselineFile, baselineTools, buildCatalogue, hubToolchainTools, installLines, parseToolkitFile, priceText, recipeView, recipesUsing, toolsFor, TOOLKIT_SCHEMA,
  type RecipeFacts
} from "../src/core/toolkit/toolkit";
import { knownTools, buildToolchain } from "../src/core/toolchain/toolchain";
import { boardProblems, boardView, parseBoard } from "../src/core/project/board";
import { buildCardPack } from "../src/core/project/boardPack";
import { buildProjectMap } from "../src/core/project/projectMap";
import { checkIncoming, detectKind, exportForAi, AI_TASKS } from "../src/core/project/aiExchange";
import { emittedSchemaFiles } from "../src/core/contracts/schemaFiles";
import { toolkitState } from "../src/views/toolkitState";
import { hubRecipesJson, hubToolsJson } from "./fixtures/v3/toolkit";
import { boardSalesJson } from "./fixtures/v3/salesBi";
import { fileObsA, inputA } from "./fixtures/v3/research";
import { boardAJson } from "./fixtures/v3/researchBoard";

const V = "0.21.0";
const text = (v: unknown) => JSON.stringify(v, null, 2);
const hubFiles = () => [parseToolkitFile(text(hubToolsJson()), "hub/.datapass/toolkit/tools.json", V), parseToolkitFile(text(hubRecipesJson()), "hub/.datapass/toolkit/recipes/fabric.json", V)];
const facts = (f: Record<string, boolean> = {}, t: Record<string, "present" | "absent"> = {}): RecipeFacts => ({ facts: new Map(Object.entries(f)), tools: new Map(Object.entries(t)) });
const file = (extra: Record<string, unknown>) => text({ format: "datapass.toolkit", version: "1", ...extra });

test("toolkit: the built-in baseline is a valid toolkit file that dates every price and covers every known tool", () => {
  const b = baselineFile(V);
  assert.deepEqual(b.skipped, []);
  assert.equal(b.newer, undefined);
  const ids = new Set(b.tools.map(t => t.id));
  for (const id of knownTools().keys()) assert.ok(ids.has(id), `baseline has ${id}`);
  for (const t of b.tools) {
    assert.ok(t.priceModel, `${t.id} has a price model`);
    assert.equal(t.checkedAt, "2026-09-26", `${t.id} is dated`);
    for (const tier of t.tiers ?? []) assert.ok(tier.price.trim(), `${t.id} ${tier.name} has a price text`);
  }
  // Figures that could not be read on the official page stay unknown, never guessed.
  const gitlab = b.tools.find(t => t.id === "ext.gitlab")!;
  assert.match(gitlab.tiers!.find(x => x.name.startsWith("Premium"))!.price, /^unknown/);
  const catalogue = baselineTools(V);
  assert.equal(catalogue.get("cli.az")!.probe, true);
  assert.equal(catalogue.get("py.fabric-cicd")!.probe, false);
  assert.equal(catalogue.get("pack.powerbi-gbrueckl")!.kind, "extension-pack");
  assert.deepEqual(buildCatalogue([], V).problems, []);
});

test("toolkit: hub files layer over the baseline; built-in probes and kinds stay the extension's", () => {
  const files = hubFiles();
  for (const f of files) { assert.deepEqual(f.skipped, [], f.path); assert.equal(f.newer, undefined); }
  const c = buildCatalogue(files, V);
  assert.deepEqual(c.problems, []);
  assert.equal(c.hub, true);
  const studio = c.tools.get("ext.fabric-studio")!;
  assert.equal(studio.source, "built-in, changed by the hub");
  assert.ok(studio.changed.includes("maintainer") && studio.changed.includes("verified"));
  assert.ok(!studio.changed.includes("useWhen"), "same text as the baseline: not a change");
  assert.equal(studio.probe, true);
  assert.deepEqual(studio.extensionIds, ["GerhardBrueckl.fabricstudio"]);
  assert.equal(studio.priceModel, "included", "the baseline's price stays when the hub does not give one");
  const toolbox = c.tools.get("acc.fabric-toolbox")!;
  assert.equal(toolbox.source, "hub");
  assert.equal(toolbox.probe, false);
  assert.equal(priceText(toolbox).dated, "2026-09-26");
  assert.equal(c.tools.get("cli.pbi-tools")!.replacedBy, "py.fabric-cicd");
  assert.equal(c.recipes.size, 3);
  assert.equal(c.requests.length, 1);
  assert.equal(c.requests[0]!.title, "Probe the Tabular Editor 3 version");
  // A hub entry cannot turn a built-in tool into another kind (the kind decides the probe).
  const kindChange = parseToolkitFile(file({ tools: [{ id: "cli.az", kind: "learning", note: "x" }] }), "t.json", V);
  const c2 = buildCatalogue([kindChange], V);
  assert.equal(c2.tools.get("cli.az")!.kind, "cli");
  assert.equal(c2.tools.get("cli.az")!.probe, true);
  assert.deepEqual(c2.tools.get("cli.az")!.changed, ["note"]);
  // The first file wins on a duplicate id across files.
  const dup = buildCatalogue([...files, parseToolkitFile(file({ tools: [{ id: "acc.fabric-toolbox", label: "Other", kind: "cli" }] }), "b.json", V)], V);
  assert.equal(dup.tools.get("acc.fabric-toolbox")!.label, "Fabric Toolbox (Fabric CAT)");
  assert.ok(dup.problems.some(p => p.includes("already described")));
});

test("toolkit: bad entries are skipped with their reason, never guessed; bad files are refused", () => {
  const r = parseToolkitFile(file({
    tools: [
      { id: "cli.ok", label: "OK", kind: "cli" },
      { id: "cli.extra", label: "X", kind: "cli", secretField: 1 },
      { id: "cli.nodate", label: "X", kind: "cli", priceModel: "paid" },
      { id: "cli.token", label: "X", kind: "cli", links: { docs: "https://example.com/?token=abc" } },
      { id: "cli.http", label: "X", kind: "cli", links: { docs: "http://example.com/" } },
      { id: "cli.super", label: "X", kind: "cli", status: "superseded" },
      { id: "cli.cmd", label: "X", kind: "cli", install: [{ method: "command", command: "rm -rf /\nmore" }] },
      { id: "cli.date", label: "X", kind: "cli", priceModel: "free", checkedAt: "2026-02-30" },
      { id: "cli.ok", label: "Twice", kind: "cli" },
      { id: "Bad Id", label: "X", kind: "cli" }
    ],
    recipes: [{ id: "r.one", module: "develop", title: "R", routes: [{ id: "a", steps: ["x"] }, { id: "a", steps: ["y"] }] }]
  }), "t.json", V);
  assert.deepEqual(r.tools.map(t => t.id), ["cli.ok"]);
  assert.equal(r.skipped.length, 10);
  assert.ok(r.skipped.some(s => s.startsWith("tool cli.extra") && s.includes("not an allowed property")));
  assert.ok(r.skipped.some(s => s.startsWith("tool cli.nodate") && s.includes("checkedAt")));
  assert.ok(r.skipped.some(s => s.startsWith("tool cli.token") && s.includes("token")));
  assert.ok(r.skipped.some(s => s.startsWith("tool cli.super") && s.includes("replacedBy")));
  assert.ok(r.skipped.some(s => s.startsWith("tool cli.date") && s.includes("calendar")));
  assert.ok(r.skipped.some(s => s.includes("listed twice")));
  assert.ok(r.skipped.some(s => s.startsWith("recipe r.one") && s.includes("twice")));
  assert.throws(() => parseToolkitFile(file({ tools: [{ id: "cli.extra", label: "X", kind: "cli", secretField: 1 }] }), "t.json", V, true), /Invalid toolkit file/);
  assert.throws(() => parseToolkitFile(text({ format: "datapass.board", version: "1" }), "t.json", V), /Not a toolkit file/);
  assert.throws(() => parseToolkitFile(file({ newTopLevel: true }), "t.json", V), /not an allowed property/);
  assert.throws(() => parseToolkitFile(file({ version: "one" }), "t.json", V), /version/);
  assert.throws(() => parseToolkitFile("{\"format\":\"datapass.toolkit\",\"format\":\"x\"}", "t.json", V), /duplicate|Duplicate/);
});

test("toolkit: a file for a newer DataPass or a newer format says so", () => {
  const newerFormat = parseToolkitFile(text({ format: "datapass.toolkit", version: "2", tools: [{ id: "cli.a", label: "A", kind: "cli", futureField: 1 }] }), "t.json", V);
  assert.equal(newerFormat.newer?.what, "format");
  assert.equal(newerFormat.tools.length, 0);
  const newerApp = parseToolkitFile(file({ requires: { datapass: ">=0.30.0" }, tools: [{ id: "cli.a", label: "A", kind: "cli" }, { id: "cli.b", label: "B", kind: "cli", futureField: 1 }] }), "t.json", V);
  assert.equal(newerApp.newer?.what, "datapass");
  assert.match(newerApp.newer!.text, /0\.30\.0/);
  assert.deepEqual(newerApp.tools.map(t => t.id), ["cli.a"]);
  assert.equal(newerApp.skipped.length, 1);
  assert.throws(() => parseToolkitFile(file({ requires: { datapass: ">=0.30.0" } }), "t.json", V, true), /requires DataPass/);
  assert.equal(parseToolkitFile(file({ requires: { datapass: ">=0.21.0" } }), "t.json", V).newer, undefined);
  const s = toolkitState(buildCatalogue([newerApp], V), [newerApp], facts(), undefined, "win32");
  assert.equal(s.newerFiles, 1);
});

test("toolkit: recipe routes are resolved against project facts and this computer's probes", () => {
  const c = buildCatalogue(hubFiles(), V);
  const bulk = c.recipes.get("fabric.item-definition.bulk-edit")!;
  const bound = recipeView(bulk, c, facts({ "fabric.gitBinding": true }, { "cli.git": "present", "cli.fab": "absent" }));
  assert.equal(bound.routes[0]!.applies, "yes");
  assert.equal(bound.suggested, "git");
  assert.equal(bound.routes[1]!.applies, "no", "the Fabric CLI is not installed");
  assert.equal(bound.routes[2]!.applies, "yes", "a route without condition whose tool is not probed applies");
  const unbound = recipeView(bulk, c, facts({ "fabric.gitBinding": false }, { "cli.fab": "present" }));
  assert.equal(unbound.routes[0]!.applies, "no");
  assert.equal(unbound.suggested, "fab");
  const unknown = recipeView(bulk, c, facts());
  assert.equal(unknown.routes[0]!.applies, "unknown");
  assert.match(unknown.routes[0]!.condition!, /not checked/);
  assert.equal(unknown.routes[1]!.steps[0]!.copy, "fab export <ws>.Workspace/<item>.CopyJob -o <folder>");
  assert.match(unknown.routes[1]!.tools[0]!.price, /needs a paid service/);
  assert.deepEqual(recipesUsing(c, ["py.fabric-cicd"]), ["fabric.deploy.fabric-cicd"]);
  assert.deepEqual(toolsFor(c, { extensionIds: ["fabric.vscode-fabric"] }).map(t => t.id), ["ext.fabric"]);
});

test("toolkit: price summaries, install lines and hub tools in the toolchain", () => {
  assert.equal(priceText({ priceModel: "free", checkedAt: "2026-09-26" }).text, "Free");
  assert.equal(priceText({ priceModel: "freemium", tiers: [{ name: "Free", price: "USD 0" }, { name: "Pro", price: "USD 10 / month" }] }).text, "Free tier · paid from USD 10 / month");
  assert.equal(priceText({ priceModel: "paid", tiers: [{ name: "Pro", price: "unknown" }] }).text, "Paid");
  assert.equal(priceText({ priceModel: "freemium", tiers: [{ name: "Free", price: "$0" }, { name: "Launch", price: "USD 0.106 / CU-hour" }] }).text, "Free tier · paid from USD 0.106 / CU-hour");
  assert.equal(priceText({ priceModel: "freemium", tiers: [{ name: "Pro", price: "from USD 19/month" }] }).text, "Free tier · paid from USD 19/month");
  assert.equal(priceText({ priceModel: "unknown" }).text, "Price unknown");
  assert.equal(priceText({}).text, "Price not recorded");
  const c = buildCatalogue(hubFiles(), V);
  assert.deepEqual(installLines(c.tools.get("ext.fabric-studio")!, "win32").map(l => l.copy ?? l.text), ["code --install-extension GerhardBrueckl.fabricstudio", "Part of the extension pack pack.powerbi-gbrueckl"]);
  assert.deepEqual(installLines(c.tools.get("ext.tmdl")!, "linux").map(l => l.copy), ["code --install-extension analysis-services.TMDL"]);
  const view = buildToolchain({ toolchain: { tools: [{ tool: "acc.fabric-toolbox" }, { tool: "cli.nothing" }] }, tools: new Map(), platform: "win32", hubTools: hubToolchainTools(c) });
  assert.equal(view.entries[0]!.state, "not-checked");
  assert.match(view.entries[0]!.detail, /hub's toolkit/);
  assert.equal(view.entries[1]!.state, "unknown-tool");
});

test("toolkit: recipe on board items (board contract, version 1)", () => {
  const b = parseBoard(text(boardSalesJson()));
  assert.equal(b.items[0]!.recipe, "fabric.item-definition.bulk-edit");
  assert.equal(b.items[0]!.route, "git");
  const routeOnly = boardSalesJson() as { items: Array<Record<string, unknown>> };
  delete routeOnly.items[0]!.recipe;
  assert.throws(() => parseBoard(text(routeOnly)), /needs the recipe/);
  const bad = boardSalesJson() as { items: Array<Record<string, unknown>> };
  bad.items[0]!.recipe = "Not An Id";
  assert.throws(() => parseBoard(text(bad)), /Invalid board/);
  const c = buildCatalogue(hubFiles(), V);
  const wrong = parseBoard(text({ ...boardSalesJson(), items: [{ id: "a", type: "task", title: "A", status: "todo", recipe: "fabric.nope" }, { id: "b", type: "task", title: "B", status: "todo", recipe: "powerbi.pbip-git", route: "cloud" }] }));
  const problems = boardProblems(wrong, undefined, undefined, undefined, c.recipes).map(p => p.message);
  assert.ok(problems.some(m => m.includes("fabric.nope") && m.includes("not a recipe")));
  assert.ok(problems.some(m => m.includes("route \"cloud\"")));
  assert.equal(boardProblems(wrong, undefined, undefined, undefined, undefined).length, 0, "no toolkit read: nothing to check against");
  // The editor schema accepts the fields too.
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  assert.ok(ajv.compile(emittedSchemaFiles()["schemas/datapass-board.schema.json"] as object)(boardSalesJson()));
  const toolkit = ajv.compile(emittedSchemaFiles()["schemas/datapass-toolkit.schema.json"] as object);
  assert.ok(toolkit(hubToolsJson()), JSON.stringify(toolkit.errors));
  assert.ok(toolkit(hubRecipesJson()), JSON.stringify(toolkit.errors));
  assert.equal(emittedSchemaFiles()["schemas/datapass-toolkit.schema.json"] !== undefined && TOOLKIT_SCHEMA !== undefined, true);
});

test("toolkit: a card's AI pack carries its recipe; the board view keeps the card's recipe", () => {
  const json = boardAJson() as { items: Array<Record<string, unknown>> };
  json.items[0]!.recipe = "fabric.item-definition.bulk-edit";
  json.items[0]!.route = "fab";
  const board = parseBoard(text(json));
  const map = buildProjectMap(inputA());
  const v = boardView(board, { map, files: fileObsA(), today: "2026-09-26" });
  const card = v.cards.find(x => x.id === json.items[0]!.id)!;
  assert.deepEqual(card.recipe, { id: "fabric.item-definition.bulk-edit", route: "fab" });
  const c = buildCatalogue(hubFiles(), V);
  const pack = buildCardPack({ board, card, map, question: "implement", dataPassVersion: V, generatedAt: "t", recipe: recipeView(c.recipes.get("fabric.item-definition.bulk-edit")!, c, facts()) });
  assert.ok(pack.sections.includes("Recipe the card follows (toolkit)"));
  assert.match(pack.text, /Route "Fabric CLI" \(`fab`, the card's route/);
  assert.match(pack.text, /fab export <ws>\.Workspace/);
  assert.doesNotMatch(pack.text, /Route "Git integration/, "only the card's route");
  const missing = buildCardPack({ board, card, map, question: "implement", dataPassVersion: V, generatedAt: "t" });
  assert.match(missing.text, /not in the toolkit DataPass read/);
});

test("toolkit: the AI exchange copies and imports tools.json strictly", () => {
  assert.equal(detectKind(hubToolsJson()), "toolkit");
  const ok = checkIncoming("```json\n" + text(hubToolsJson()) + "\n```", { dataPassVersion: V });
  assert.equal(ok.kind, "toolkit");
  assert.equal(ok.path, ".datapass/toolkit/tools.json");
  assert.ok(ok.warnings.some(w => w.includes("datapassRequests")));
  const bad = hubToolsJson() as { tools: Array<Record<string, unknown>> };
  bad.tools[1]!.inventedField = "x";
  assert.throws(() => checkIncoming(text(bad), { dataPassVersion: V }), /Invalid toolkit file/);
  const secret = hubToolsJson() as { tools: Array<Record<string, unknown>> };
  secret.tools[1]!.note = "AccountKey=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ==";
  assert.throws(() => checkIncoming(text(secret), { dataPassVersion: V }), /sensitive/);
  assert.throws(() => checkIncoming(text({ ...hubToolsJson(), requires: { datapass: ">=9.0.0" } }), { dataPassVersion: V }), /requires DataPass/);
  const out = exportForAi("toolkit", text(hubToolsJson()), AI_TASKS.toolkit[0]!, { dataPassVersion: V });
  assert.match(out, /Never invent a price/);
  assert.match(out, /toolkit\/tools\.json/);
});

test("toolkit: the Workbench state names tools per component and keeps links on the extension side", () => {
  const c = buildCatalogue(hubFiles(), V);
  const s = toolkitState(c, hubFiles(), facts({}, { "ext.fabric-studio": "present" }), buildProjectMap(inputA()), "win32");
  const studio = s.tools.find(t => t.id === "ext.fabric-studio")!;
  assert.equal(studio.state, "present");
  assert.deepEqual(studio.links.map(l => l.id).sort(), ["marketplace", "repo"]);
  assert.ok(!JSON.stringify(studio.links).includes("https://"), "the webview gets link ids, not addresses");
  assert.ok(studio.recipes.includes("fabric.item-definition.bulk-edit"));
  assert.equal(s.requests.length, 1);
  assert.equal(s.files.length, 2);
  assert.ok(Object.keys(s.components).length > 0, "the research library's Azure components have catalogue tools");
});
