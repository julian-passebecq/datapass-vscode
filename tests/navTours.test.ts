/**
 * V4-NAV NAVTOUR1: journey tours (`datapass.tours/1`), tours generated from facts, stepping, stale
 * holes, 'Jump to a box' fuzzy search and the Navigator `#tours` slot (pure parts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProjectMap, RelationView } from "../src/core/project/projectMap";
import { componentLocation, projectLadder } from "../src/core/navigation/projectLadder";
import { generateTours } from "../src/core/navigation/tours/generate";
import { fuzzyScore, jumpSearch } from "../src/core/navigation/tours/jump";
import {
  journeys, ladderLocations, locationKeys, mergeTours, nextStep, parseToursDoc, prevStep, serializeToursDoc, startTour, stepExists, stepTo,
  TOUR_STEP_TEXT_MAX, type Tour
} from "../src/core/navigation/tours/tours";
import { parseToursMessage, toursHtml, toursScript, TOURS_LABELS, type ToursModel } from "../src/views/navToursHtml";

type Flow = RelationView["flow"];
function mapOf(components: Record<string, string>, edges: [string, string, Flow][] = []): ProjectMap {
  const ids = Object.keys(components);
  return {
    project: { id: "demo", title: "Demo", schemaVersion: 1 },
    subprojects: [{ id: "main", title: "Main", componentIds: ids }],
    components: ids.map((id) => ({ id, label: components[id], description: `About ${components[id]}` })),
    relations: edges.map(([from, to, flow], i) => ({ id: `r${i}`, source: from, target: to, from, to, flow, relation: flow === "data" ? "feeds" : "orchestrates" }))
  } as unknown as ProjectMap;
}

const LAYERS = { landing: "Landing file", staging: "Staging", processed: "Processed", curated: "Curated", report: "Report" };

test("tours: lineage tour follows the data flow from the source, numbered in order", () => {
  const map = mapOf(LAYERS, [["landing", "staging", "data"], ["staging", "processed", "data"], ["processed", "curated", "data"], ["curated", "report", "data"]]);
  const tours = generateTours(map);
  assert.equal(tours.length, 1);
  const [t] = tours;
  assert.equal(t!.journey, "lineage");
  assert.equal(t!.origin, "generated");
  assert.deepEqual(t!.steps.map((s) => s.location.nodeId), ["landing", "staging", "processed", "curated", "report"]);
  assert.equal(t!.title, "Landing file → Report");
  assert.equal(t!.steps[0]!.text, "About Landing file");
});

test("tours: execution tour walks schedule → job → notebook, then the tables they produce", () => {
  const map = mapOf({ sched: "Nightly", job: "Job", nb: "Notebook", tbl: "Sales table" },
    [["sched", "job", "control"], ["job", "nb", "control"], ["nb", "tbl", "data"]]);
  const tours = generateTours(map);
  const exec = tours.find((t) => t.journey === "execution")!;
  assert.deepEqual(exec.steps.map((s) => s.location.nodeId), ["sched", "job", "nb", "tbl"]);
  assert.deepEqual(journeys(tours), ["lineage", "execution"]);
});

test("tours: no facts = no tour; cycles and dangling edges are safe", () => {
  assert.deepEqual(generateTours(mapOf(LAYERS)), []);
  const cyc = generateTours(mapOf({ a: "A", b: "B" }, [["a", "b", "data"], ["b", "a", "data"], ["a", "ghost", "data"]]));
  assert.equal(cyc.length, 1);
  assert.deepEqual(cyc[0]!.steps.map((s) => s.location.nodeId), ["a", "b"]);
});

test("tours: long descriptions are cut to the step text limit", () => {
  const map = mapOf({ a: "A", b: "B" }, [["a", "b", "data"]]);
  (map.components[0] as { description?: string }).description = "x".repeat(400);
  assert.equal(generateTours(map)[0]!.steps[0]!.text.length, TOUR_STEP_TEXT_MAX);
});

const FILE: Tour = { id: "onboard", title: "Onboarding", journey: "lineage", origin: "user", steps: [
  { location: componentLocation("staging"), viewId: "lineage", text: "Raw rows land here." },
  { location: componentLocation("gone"), text: "This box was removed." }] };

test("tours: tours.json round-trips; bad, generated-origin and duplicate tours are dropped with a problem", () => {
  const text = serializeToursDoc([FILE, { ...FILE, id: "gen", origin: "generated" }]);
  const back = parseToursDoc(text);
  assert.deepEqual(back.problems, []);
  assert.deepEqual(JSON.parse(JSON.stringify(back.tours)), [FILE]);
  const bad = parseToursDoc(JSON.stringify({ format: "datapass.tours", version: 1, tours: [
    FILE, FILE, { ...FILE, id: "g", origin: "generated" }, { ...FILE, id: "long", steps: [{ location: componentLocation("a"), text: "y".repeat(281) }] },
    { ...FILE, id: "loc", steps: [{ location: { level: "nowhere", nodeId: "a", artifactKind: "other" }, text: "" }] }, { ...FILE, id: "ai", origin: "ai-proposed" }] }));
  assert.deepEqual(bad.tours.map((t) => t.id), ["onboard", "ai"]);
  assert.equal(bad.problems.length, 4);
  assert.deepEqual(parseToursDoc("{nope").tours, []);
  assert.deepEqual(parseToursDoc(JSON.stringify({ format: "other", version: 1, tours: [] })).problems.length, 1);
  assert.deepEqual(parseToursDoc(undefined), { tours: [], problems: [] });
});

test("tours: merge keeps generated first and never lets a file tour shadow one", () => {
  const gen: Tour = { ...FILE, id: "gen.lineage.a", origin: "generated" };
  const merged = mergeTours([gen], [{ ...FILE, id: "gen.lineage.a" }, FILE]);
  assert.deepEqual(merged.map((t) => t.id), ["gen.lineage.a", "gen.lineage.a~file", "onboard"]);
});

test("tours: stepping clamps at both ends; a step whose node is gone is stale", () => {
  let c = startTour(FILE);
  c = prevStep(FILE, c);
  assert.equal(c.index, 0);
  c = nextStep(FILE, nextStep(FILE, c));
  assert.equal(c.index, 1);
  assert.equal(stepTo(FILE, c, -5).index, 0);
  const map = mapOf(LAYERS);
  const keys = locationKeys(ladderLocations(projectLadder(() => map)));
  assert.equal(stepExists(FILE.steps[0]!, keys), true);
  assert.equal(stepExists(FILE.steps[1]!, keys), false);
});

test("jump: every ladder Location is searchable by label, prefix beats scattered, kind matches weaker", () => {
  const map = mapOf(LAYERS);
  const ladder = projectLadder(() => map);
  const entries = ladderLocations(ladder).map((location) => ({ location, label: location.level === "project" ? "Demo" : location.level === "subproject" ? "Main" : (LAYERS as Record<string, string>)[location.nodeId]! }));
  assert.equal(entries.length, 7);
  assert.equal(jumpSearch(entries, "cur")[0]!.label, "Curated");
  assert.equal(jumpSearch(entries, "stg")[0]!.label, "Staging");
  assert.deepEqual(jumpSearch(entries, "zzz"), []);
  assert.ok(jumpSearch(entries, "subproject").some((h) => h.label === "Main"));
  assert.ok(fuzzyScore("rep", "Report") > fuzzyScore("rep", "Processed report"));
  assert.equal(jumpSearch(entries, "").length, 7);
});

test("slot: messages are validated", () => {
  assert.deepEqual(parseToursMessage({ type: "tour", action: "next" }), { type: "tour", action: "next" });
  assert.deepEqual(parseToursMessage({ type: "tour", action: "step", index: 2 }), { type: "tour", action: "step", index: 2 });
  assert.equal(parseToursMessage({ type: "tour", action: "step", index: -1 }), null);
  assert.equal(parseToursMessage({ type: "tour", action: "jump-query", query: "x".repeat(500) }), null);
  assert.equal(parseToursMessage({ type: "tour", action: "run" }), null);
  assert.equal(parseToursMessage({ type: "nav" }), null);
});

test("slot: html escapes data, marks stale and AI-proposed, numbers the steps", () => {
  const m: ToursModel = {
    labels: { ...TOURS_LABELS },
    journeys: [{ id: "lineage", label: "Data <lineage>", active: true }],
    tours: [{ id: "a", title: "A", origin: "generated", active: true }, { id: "b", title: "B", origin: "ai-proposed", active: false }],
    steps: [{ index: 0, label: "Landing", text: "x", stale: false, current: true }, { index: 1, label: "Gone", text: "", stale: true, current: false }],
    canPrev: false, canNext: true, jump: { query: "", hits: [] }, problems: []
  };
  const html = toursHtml(m);
  assert.ok(html.includes("Data &lt;lineage&gt;"));
  assert.ok(html.includes(TOURS_LABELS.aiProposed));
  assert.ok(html.includes(`data-tour-step="1" title="" disabled`));
  assert.ok(html.includes(`<span class="tour-n">1</span>`));
  assert.ok(html.includes(`data-tour-action="prev" disabled`));
  assert.ok(!/on(click|input)=/.test(html));
  assert.ok(toursHtml({ ...m, steps: [], tours: [] }).includes(TOURS_LABELS.none));
  assert.ok(toursScript("vscodeApi").includes("vscodeApi.postMessage"));
});

test("schema: the JSON schema and the validator agree on origins and limits", () => {
  const schema = JSON.parse(readFileSync("schemas/datapass-tours.schema.json", "utf8"));
  assert.deepEqual(schema.$defs.tour.properties.origin.enum, ["ai-proposed", "user"]);
  assert.equal(schema.$defs.step.properties.text.maxLength, TOUR_STEP_TEXT_MAX);
});
