/**
 * 0.15 architecture options, project sheet, AI JSON exchange, backups, and the diagram's
 * orientation, lanes and folding. Synthetic project A only (no FOIL content).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOptions, applyPicks, concernedItems, currentPicks, decidedPicks, evaluatePicks, formatMoney, optionComponentRepositories, optionsProblems, parseOptions, picksFrom, scenarioPicks, type OptionsFile } from "../src/core/project/options";
import { optionsMarkdown, valueText } from "../src/core/project/optionsReport";
import { parseSheet, sheetFor, sheetProblems, volumeLine } from "../src/core/project/sheet";
import { checkIncoming, detectKind, exportForAi, extractJson, sensitiveFindings, AI_TASKS } from "../src/core/project/aiExchange";
import { backupFileName, backupsToPrune, parseBackupName } from "../src/core/project/backups";
import { crossCount, layoutGraph, sizeForWidthVertical } from "../src/core/project/layout";
import { buildDiagram, familyOf, levelOf, type DiagramComponent } from "../src/core/project/diagramModel";
import { buildProjectMap } from "../src/core/project/projectMap";
import { buildPreparationPack } from "../src/core/project/preparation";
import { COORDINATION_KEY } from "../src/core/project/resolve";
import { TOOLS, type ToolObservation } from "../src/core/capabilities/tools";
import { graphA, inputA, manifestA } from "./fixtures/v3/research";
import { optionsA, optionsAJson, sheetA, sheetAJson } from "./fixtures/v3/researchOptions";

const T = "2026-09-25T10:00:00Z";
const tools = (...present: string[]) => new Map<string, ToolObservation>(present.map(id => [id, { toolId: id, state: "present", observedAt: T }]));
/** Every probe answered: the listed tools present, the others absent (as in a real session). */
const probed = (...present: string[]) => new Map<string, ToolObservation>(TOOLS.map(t => [t.id, { toolId: t.id, state: present.includes(t.id) ? "present" : "absent", observedAt: T }]));
const withOptions = (patch: (o: Record<string, any>) => void) => { const o = optionsAJson() as Record<string, any>; patch(o); return JSON.stringify(o); };

// ------------------------------------------------------------------ parsing

test("options: the example parses; graph items inside options follow the graph's own rules", () => {
  const o = parseOptions(JSON.stringify(optionsAJson()));
  assert.equal(o.decisions.length, 3);
  assert.equal(o.scenarios?.length, 2);
  // An added component with a credential-shaped target is refused exactly like in graph.json.
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[1].options[1].changes.add[0].operations = [{ capability: "python.tests.run", target: { key: "AccountKey=abc" } }]; })), /credential/);
  // Unknown fields are errors, as everywhere else in DataPass files.
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].colour = "blue"; })), /Invalid options file/);
});

test("options: identities and references inside the file are checked", () => {
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].current = "nope"; })), /current "nope" is not one of its options/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].chosen = "nope"; })), /chosen "nope"/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[1].id = "archive"; })), /Duplicate decision id/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].options[1].values.speed = "fast"; })), /unknown criterion "speed"/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].options[1].values.setup = { note: "no text, no score" }; })), /needs a text or a score/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].options[1].values.setup = { score: 9 }; })), /values\.setup/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[1].options[1].requires = ["archive=ftp"]; })), /has no option "ftp"/);
  assert.throws(() => parseOptions(withOptions(o => { o.scenarios[0].picks = ["archive=gcs", "archive=blob"]; })), /picks decision "archive" twice/);
  assert.throws(() => parseOptions(withOptions(o => { o.scenarios[0].id = "current"; })), /reserved/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].options[1].docs = [{ label: "both", url: "https://x.example", path: "a.md" }]; })), /exactly one of url or path/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].options[1].changes.addRepositories = [{ key: "gcp", remote: { url: "https://user:pw@github.com/x/y" } }]; })), /without credentials/);
  assert.throws(() => parseOptions(withOptions(o => { o.decisions[0].options[1].costs[0].source = "http://insecure.example"; })), /Invalid options file/);
});

test("options: problems against the project are warnings, not parse errors", () => {
  const o = parseOptions(withOptions(o => {
    o.decisions[0].subproject = "nowhere";
    o.decisions[0].options[0].changes = { remove: ["adf"] }; // changes on the current option are ignored
    o.decisions[2].options[1].changes.remove = ["cosmos", "ghost"];
  }));
  const problems = optionsProblems(o, manifestA(), graphA());
  const text = problems.map(p => `${p.where}: ${p.message}`).join("\n");
  assert.match(text, /subproject "nowhere" is not a sub-project/);
  assert.match(text, /archive=blob: this is the current option/);
  assert.match(text, /removes "ghost", which is not a component/);
  assert.equal(problems.every(p => p.severity !== "error"), true);
  assert.deepEqual(concernedItems(optionsA().decisions[1]!).sort(), ["adf", "cosmos", "extract"]);
});

// ------------------------------------------------------------------ applying picks

test("options: applying picks changes a copy of the project, never the graph itself", () => {
  const graph = graphA();
  const before = JSON.stringify(graph);
  const o = optionsA();
  const d = applyPicks(manifestA(), graph, o, picksFrom(o, ["archive=gcs", "processing=bigquery"]));
  assert.equal(JSON.stringify(graph), before, "the real graph is untouched");
  assert.deepEqual(d.diff.added, ["bq-pages"]);
  assert.deepEqual(d.diff.replaced, ["pdf-archive"]);
  assert.deepEqual(d.diff.removed.sort(), ["adf", "cosmos", "extract"]);
  assert.equal(d.graph.items.find(i => i.id === "pdf-archive")?.provider, "google-cloud-storage");
  // Links of removed components go with them; the option's own links are added.
  assert.deepEqual(d.diff.removedRelations.sort(), ["r1", "r2", "r3", "r4"]);
  assert.deepEqual(d.diff.addedRelations.sort(), ["bq1", "bq2"]);
  // The new component joins the decision's sub-project; removed ones leave it.
  assert.deepEqual(d.manifest!.scopes!.find(s => s.id === "papers")!.itemRefs!.sort(), ["bq-pages", "pdf-archive", "review", "study-db"]);
  assert.deepEqual(d.problems, [], "gcs + bigquery is a coherent pair");
  assert.equal(d.changedBy["bq-pages"], "processing");
});

test("options: requires, excludes and conflicts are reported", () => {
  const o = optionsA();
  const alone = applyPicks(manifestA(), graphA(), o, picksFrom(o, ["processing=bigquery"]));
  assert.match(alone.problems.map(p => p.message).join("\n"), /requires Where do the PDFs live\?: Google Cloud Storage/);
  const both = applyPicks(manifestA(), graphA(), o, picksFrom(o, ["archive=gcs", "processing=bigquery", "staging=mongo-staging"]));
  const text = both.problems.map(p => p.message).join("\n");
  assert.match(text, /does not work with What extracts the pages\?: BigQuery/);
  assert.match(text, /"cosmos" is also changed by decision "processing"/);
  // An option's link to a component that another pick removed is reported, not drawn.
  assert.match(text, /link "m1" needs "extract"/);
});

test("options: picks from the current state, the decided state, scenarios and lists", () => {
  const o = parseOptions(withOptions(o => { o.decisions[2].chosen = "mongo-staging"; o.decisions[2].decidedOn = "2026-09-25"; }));
  assert.deepEqual([...currentPicks(o)], [["archive", "blob"], ["processing", "adf-function"], ["staging", "cosmos"]]);
  assert.equal(decidedPicks(o).get("staging"), "mongo-staging");
  assert.equal(scenarioPicks(o, "google")!.get("processing"), "bigquery");
  assert.equal(scenarioPicks(o, "nope"), undefined);
  // Unknown or malformed entries are ignored.
  assert.deepEqual([...picksFrom(o, ["archive=ftp", "bogus", "staging=mongo-staging"])], [["archive", "blob"], ["processing", "adf-function"], ["staging", "mongo-staging"]]);
});

// ------------------------------------------------------------------ consequences

test("options: the analysis names new official tools, DataPass support, repositories and declared costs", () => {
  const input = { base: inputA({ tools: probed("ext.azure-functions", "cli.func", "ext.cosmosdb") }), options: optionsA() };
  const a = analyzeOptions(input);
  assert.deepEqual(a.scenarios.map(s => s.id), ["current", "google", "lean"]);
  const google = a.scenarios.find(s => s.id === "google")!.impact;
  assert.deepEqual(google.providersAdded.sort(), ["bigquery", "google-cloud-storage"]);
  assert.ok(google.providersRemoved.includes("azure-functions"));
  const newTools = google.tools.newlyNeeded.map(t => `${t.label}:${t.state}`);
  assert.ok(newTools.includes("Google Cloud Data Agent Kit:absent"), newTools.join(", "));
  assert.ok(google.tools.noLongerNeeded.some(t => t.label === "Azure Functions"), "the Functions extension is no longer needed");
  assert.ok(google.support.unsupported >= 2, "GCS and BigQuery have no DataPass operations");
  assert.deepEqual(google.costs.oneTime, { USD: 30 });
  assert.equal(google.costs.monthly.USD, 1.1 + 0 + 1.11 + 0);
  assert.equal(formatMoney(google.costs.monthly, "/month"), "≈ 2.21 USD/month");
  // Every option on its own.
  const script = a.byOption["processing=script"]!;
  assert.deepEqual(script.components.replaced.map(c => `${c.id}:${c.from}→${c.provider}`), ["extract:Azure Functions→Python"]);
  assert.deepEqual(script.components.removed.map(c => c.id), ["adf"]);
  assert.equal(a.byOption["archive=blob"]!.key, "archive=blob");
  assert.deepEqual(a.current.components.added, []);
  // Compatibility problems of scenarios reach the analysis.
  assert.ok(!a.problems.some(p => p.severity === "error"), a.problems.map(p => p.message).join("\n"));
});

test("options: an alternative's files are observed too, so a comparison can say they are already there", () => {
  const plan = optionComponentRepositories(optionsA(), manifestA(), COORDINATION_KEY);
  assert.deepEqual(plan.map(p => `${p.item.id}@${p.repoKey}`), ["extract@pipeline"]);
  const base = inputA();
  const { map } = evaluatePicks({ base, options: optionsA() }, picksFrom(optionsA(), ["processing=script"]), "x");
  const extract = map.components.find(c => c.id === "extract")!;
  assert.equal(extract.provider?.id, "python");
  assert.equal(extract.artifacts?.root, "scripts/extract");
  assert.equal(extract.artifacts?.files.find(f => f.path === "extract.py")?.state, "unknown", "not observed yet: unknown, never missing");
});

test("options: the Markdown comparison and the AI context carry declarations and DataPass's analysis, no local path", () => {
  const input = { base: inputA(), options: optionsA() };
  const analysis = analyzeOptions(input);
  const md = optionsMarkdown({ options: optionsA(), analysis, project: { id: "research-library", title: "Research library" }, purpose: "compare", decisionId: "processing", generatedAt: T, dataPassVersion: "0.14.0" });
  assert.match(md.text, /## What I am asking/);
  assert.match(md.text, /BigQuery object table \+ Document AI/);
  assert.match(md.text, /source https:\/\/cloud\.google\.com\/document-ai\/pricing, as of 2026-09-25/);
  assert.match(md.text, /New official tools \(DataPass\)/);
  assert.doesNotMatch(md.text, /[A-Za-z]:\\|\/home\//);
  const apply = optionsMarkdown({ options: optionsA(), analysis, purpose: "apply", decisionId: "staging", optionId: "mongo-staging", generatedAt: T, dataPassVersion: "0.14.0" });
  assert.match(apply.text, /set "current" of "staging" to "mongo-staging" and remove "chosen"/);
  assert.equal(valueText({ text: "portal", score: 4 }), "portal ●●●●○");
});

// ------------------------------------------------------------------ project sheet

test("sheet: datasets, formulas and runtimes are declarations shown with their component", () => {
  const s = parseSheet(JSON.stringify(sheetAJson()));
  assert.equal(s.datasets?.length, 3);
  const extract = sheetFor(s, "extract");
  assert.deepEqual(extract.datasets.map(d => d.id), ["pages"], "a dataset it produces");
  assert.deepEqual(extract.formulas.map(f => f.id), ["coverage"]);
  assert.deepEqual(extract.runtimes.map(r => r.id), ["func"]);
  assert.equal(volumeLine(s.datasets![1]!), "≈ 25,000 rows · ≈ 400 MB");
  assert.deepEqual(sheetProblems(s, manifestA(), graphA(), ["archive", "processing", "staging"]), []);
  const broken = parseSheet(JSON.stringify({ ...sheetAJson(), runtimes: [{ id: "vm", label: "VM", componentId: "nope", decisionRef: "nope" }] }));
  assert.equal(sheetProblems(broken, manifestA(), graphA(), []).length, 2);
  assert.throws(() => parseSheet(JSON.stringify({ ...sheetAJson(), runtimes: [{ id: "vm", label: "VM", access: "ssh ubuntu:password=hunter2@host" }] })), /looks like a credential/);
  assert.throws(() => parseSheet(JSON.stringify({ ...sheetAJson(), formulas: [{ id: "f", label: "F" }] })), /Invalid project sheet/);
});

// ------------------------------------------------------------------ AI exchange

test("AI exchange: the JSON is found in an answer, recognised and validated before anything is written", () => {
  const answer = "Here is the file:\n```json\n" + JSON.stringify(optionsAJson(), null, 2) + "\n```\nTell me if…";
  assert.equal(extractJson(answer).fenced, true);
  const incoming = checkIncoming(answer, { manifest: manifestA(), graph: graphA() }, "options");
  assert.equal(incoming.kind, "options");
  assert.equal(incoming.path, ".datapass/options.json");
  assert.ok(incoming.text.endsWith("}\n"));
  assert.equal(detectKind({ schemaVersion: 3, project: {} }), "manifest");
  assert.equal(detectKind({ format: "datapass.sheet" }), "sheet");
  assert.throws(() => checkIncoming(answer, {}, "sheet"), /Expected the project sheet/);
  assert.throws(() => checkIncoming("no json here", {}), /No JSON file found/);
  assert.throws(() => checkIncoming("```json\n{}\n```\n```json\n{}\n```", {}), /2 JSON blocks/);
  assert.throws(() => checkIncoming(JSON.stringify({ hello: 1 }), {}), /not a DataPass file/);
  // Invalid files are refused with the parser's own message.
  assert.throws(() => checkIncoming(withOptions(o => { o.decisions[0].current = "nope"; }), {}), /current "nope"/);
});

test("AI exchange: credentials and local paths are refused; web addresses are not local paths", () => {
  const leaky = withOptions(o => { o.decisions[0].options[0].note = "connection: AccountKey=abc123def456"; });
  assert.throws(() => checkIncoming(leaky, {}), /credential-shaped text/);
  const local = withOptions(o => { o.decisions[0].options[0].note = "copied from C:\\Users\\someone\\Downloads\\prices.xlsx"; });
  assert.throws(() => checkIncoming(local, {}), /a local path/);
  assert.deepEqual(sensitiveFindings('"source": "https://example.com/var/tmp/pricing"'), []);
  assert.equal(sensitiveFindings("/home/ubuntu/run.sh").length, 1);
});

test("AI exchange: the export carries the task, the rules and the current file", () => {
  const text = exportForAi("options", JSON.stringify(optionsAJson(), null, 2), AI_TASKS.options[0]!, { projectTitle: "Research library", dataPassVersion: "0.14.0", guideUrl: "https://github.com/julian-passebecq/datapass-vscode/blob/main/docs/PREPARING_A_PROJECT.md" });
  assert.match(text, /## What I am asking\nPropose realistic alternatives/);
  assert.match(text, /single ```json block/);
  assert.match(text, /```json\n\{/);
  assert.match(exportForAi("sheet", undefined, AI_TASKS.sheet[0]!, { dataPassVersion: "0.14.0" }), /does not exist yet/);
});

// ------------------------------------------------------------------ backups

test("backups: sortable names that keep the original path, pruning keeps the newest", () => {
  const n = backupFileName(".datapass/options.json", new Date(Date.UTC(2026, 8, 25, 14, 30, 12, 5)));
  assert.equal(n, "20260925-143012-005__.datapass~options.json");
  assert.deepEqual(parseBackupName(n), { at: "2026-09-25T14:30:12.005Z", target: ".datapass/options.json" });
  assert.equal(parseBackupName("20260925-143012-005__..~secret"), undefined);
  const names = Array.from({ length: 25 }, (_, i) => backupFileName(".datapass/options.json", new Date(Date.UTC(2026, 8, 1 + i))));
  const prune = backupsToPrune([...names, backupFileName(".datapass/sheet.json", new Date())], ".datapass/options.json", 20);
  assert.equal(prune.length, 5);
  assert.ok(prune.every(p => p < names[5]!), "the oldest go first");
});

// ------------------------------------------------------------------ layout and diagram

const flow = (pairs: Array<[string, string]>) => pairs.map(([from, to], i) => ({ id: `e${i}`, from, to, flow: "data" as const }));

test("layout: top to bottom puts layers in rows and flows downwards", () => {
  const edges = flow([["a", "b"], ["b", "c"], ["a", "d"]]);
  const L = layoutGraph(["a", "b", "c", "d"], edges, { direction: "TB" });
  const at = Object.fromEntries(L.nodes.map(n => [n.id, n]));
  assert.ok(at.a!.y < at.b!.y && at.b!.y < at.c!.y, "each layer is lower");
  assert.equal(at.b!.y, at.d!.y, "siblings share a row");
  assert.ok(L.edges.every(e => !e.backward));
  assert.equal(L.direction, "TB");
  assert.deepEqual(layoutGraph(["a", "b", "c", "d"], edges, { direction: "TB" }), L, "deterministic");
  assert.equal(crossCount(["a", "b", "c", "d"], edges), 2);
  assert.ok(sizeForWidthVertical(600, 2).nodeW >= 128);
});

test("layout: lanes keep each group together without overlapping", () => {
  const edges = flow([["a", "b"], ["c", "d"], ["b", "d"]]);
  const lanes = { of: { a: "azure", b: "azure", c: "google", d: "google" }, order: ["google", "azure"], labels: { azure: "Azure", google: "Google Cloud" } };
  for (const direction of ["LR", "TB"] as const) {
    const L = layoutGraph(["a", "b", "c", "d"], edges, { direction, lanes });
    assert.deepEqual(L.lanes.map(l => l.label), ["Google Cloud", "Azure"], "declared lane order");
    for (const n of L.nodes) {
      const lane = L.lanes.find(l => l.id === lanes.of[n.id as keyof typeof lanes.of])!;
      assert.ok(n.x >= lane.x && n.y >= lane.y && n.x + n.w <= lane.x + lane.w + 1 && n.y + n.h <= lane.y + lane.h + 1, `${direction}: ${n.id} inside its lane`);
    }
    for (const p of L.nodes) for (const q of L.nodes) if (p !== q) assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${direction}: ${p.id} and ${q.id} overlap`);
  }
});

test("diagram: grouping by cloud or level, folding a lane or a parent, preview marks", () => {
  const map = buildProjectMap(inputA());
  const comps = new Map<string, DiagramComponent>(map.components.map(c => [c.id, { id: c.id, label: c.label, providerId: c.providerId, kind: c.kind, subprojects: c.subprojects, repoKey: c.repoKey, parent: c.parent, children: c.children }]));
  const papers = map.subprojects.find(s => s.id === "papers")!;
  const edges = map.relations.filter(r => papers.componentIds.includes(r.from) && papers.componentIds.includes(r.to)).map(r => ({ id: r.id, from: r.from, to: r.to, flow: r.flow }));
  const labels = { subprojects: { papers: "Papers pipeline" }, repositories: { pipeline: "Document pipeline" } };
  const byCloud = buildDiagram({ components: comps, nodeIds: papers.componentIds, edges, groupBy: "cloud", collapsed: new Set(), labels });
  assert.deepEqual(byCloud.lanes.map(l => `${l.label}:${l.count}`), ["Azure:4", "MongoDB:1", "People (manual steps):1"]);
  assert.equal(familyOf("bigquery"), "google");
  assert.equal(levelOf("function"), "processing");
  // Folding the Azure lane draws one box; links inside it disappear, links out of it are merged.
  const folded = buildDiagram({ components: comps, nodeIds: papers.componentIds, edges, groupBy: "cloud", collapsed: new Set(["lane:azure"]), labels });
  const box = folded.nodes.find(n => n.id === "lane:azure")!;
  assert.equal(box.kind, "lane-group");
  assert.deepEqual(box.memberIds.sort(), ["adf", "cosmos", "extract", "pdf-archive"]);
  assert.deepEqual(folded.edges.map(e => `${e.from}->${e.to}`), ["lane:azure->review", "review->study-db"]);
  // A preview marks what an option adds, replaces or removes.
  const marked = buildDiagram({ components: comps, nodeIds: papers.componentIds, edges, groupBy: "none", collapsed: new Set(), labels, diff: { "pdf-archive": "replaced", cosmos: "removed" } });
  assert.equal(marked.nodes.find(n => n.id === "cosmos")!.diff, "removed");
  assert.deepEqual(marked.lanes, []);
  // Folding a parent hides its children inside its box.
  const nested = new Map(comps);
  nested.set("adf", { ...nested.get("adf")!, children: ["extract"] });
  nested.set("extract", { ...nested.get("extract")!, parent: "adf" });
  const fp = buildDiagram({ components: nested, nodeIds: papers.componentIds, edges, groupBy: "none", collapsed: new Set(["parent:adf"]), labels });
  const parent = fp.nodes.find(n => n.id === "adf")!;
  assert.equal(parent.kind, "parent");
  assert.deepEqual(parent.memberIds.sort(), ["adf", "extract"]);
  assert.ok(!fp.nodes.some(n => n.id === "extract"));
});

test("preparation pack: the component's sheet facts and the decisions that concern it", () => {
  const map = buildProjectMap(inputA());
  const pack = buildPreparationPack({ map, componentId: "extract", question: "prepare-missing", dataPassVersion: "0.14.0", generatedAt: T, sheet: sheetA(), options: optionsA() });
  assert.match(pack.text, /## Project sheet \(what the project declares\)/);
  assert.match(pack.text, /Data "Pages \(staging\)" \(collection in Cosmos staging\): ≈ 25,000 rows · ≈ 400 MB; columns that matter: sourceId:string \(partition\)/);
  assert.match(pack.text, /Formula "Page coverage": `coverage = pages_extracted \/ pages_total`; where pages_extracted \[pages\]/);
  assert.match(pack.text, /Runs on "Extraction function app": Azure Functions Flex Consumption, West Europe/);
  assert.match(pack.text, /What extracts the pages\?: current \*\*Data Factory \+ Azure Function \(Python\)\*\*; alternatives: BigQuery object table \+ Document AI, One Python script, run by hand/);
  const without = buildPreparationPack({ map, componentId: "extract", question: "prepare-missing", dataPassVersion: "0.14.0", generatedAt: T });
  assert.doesNotMatch(without.text, /Project sheet|Architecture decisions/);
  const sub = buildPreparationPack({ map, subprojectId: "papers", question: "review-architecture", dataPassVersion: "0.14.0", generatedAt: T, sheet: sheetA(), options: optionsA() });
  assert.match(sub.text, /Where do the PDFs live\?: current \*\*Azure Blob Storage\*\*/);
});
