/**
 * V4-NAV NAVTOUR1: journey tours on `datapass.tour/1` (go/TOUR-PEDA-contract.md), tours generated from
 * facts, stepping over sub-steps, live holes, text refs, 'Jump to a box' and the `#tours` slot (pure parts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProjectMap, RelationView } from "../src/core/project/projectMap";
import type { NavLocation } from "../src/core/navigation/navTypes";
import { componentLocation, projectLadder } from "../src/core/navigation/projectLadder";
import { generateTours } from "../src/core/navigation/tours/generate";
import { fuzzyScore, jumpSearch } from "../src/core/navigation/tours/jump";
import {
  flattenSteps, journeys, ladderLocations, loadTourFile, locationKey, mergeTours, nextStep, prevStep, resolveRef, serializeTourFile,
  startTour, stepStatus, stepTo, tourOrigin, toursForMode
} from "../src/core/navigation/tours/store";
import { TOUR_JSON_SCHEMA, type Tour } from "../src/core/navigation/tours/tourTypes";
import { labelPack, parseToursMessage, toursHtml, toursScript, uiLabel, type ToursModel } from "../src/views/navToursHtml";

type Flow = RelationView["flow"];
function mapOf(components: Record<string, string>, edges: [string, string, Flow][] = []): ProjectMap {
  const ids = Object.keys(components);
  return {
    project: { id: "demo", title: "Demo", schemaVersion: 1 },
    subprojects: [{ id: "main", title: "Main", componentIds: ids }],
    components: ids.map((id) => ({ id, label: components[id] })),
    relations: edges.map(([from, to, flow], i) => ({ id: `r${i}`, source: from, target: to, from, to, flow, relation: flow === "data" ? "feeds" : "orchestrates" }))
  } as unknown as ProjectMap;
}
const VIEWS = { viewsAt: (l: NavLocation) => (l.nodeId === "noview" ? [] : [{ id: "detail" }, { id: "lineage" }]) };
const LAYERS = { landing: "Landing file", staging: "Staging", processed: "Processed", curated: "Curated", report: "Report" };
const ids = (t: Tour) => flattenSteps(t.steps).map((f) => f.step.location.nodeId);

test("generate: lineage tour follows the data flow, guide refs per stage, first offered view", () => {
  const map = mapOf(LAYERS, [["landing", "staging", "data"], ["staging", "processed", "data"], ["processed", "curated", "data"], ["curated", "report", "data"]]);
  const [t, ...rest] = generateTours(map, VIEWS);
  assert.equal(rest.length, 0);
  assert.equal(t!.id, "datapass.journey.lineage.1");
  assert.equal(t!.journey, "lineage");
  assert.equal(t!.mode, "general");
  assert.equal(t!.titleRef, "guide:journey.lineage");
  assert.deepEqual(ids(t!), ["landing", "staging", "processed", "curated", "report"]);
  assert.deepEqual(t!.steps.map((s) => s.explanationRef.split(".").pop()), ["source", "flow", "flow", "flow", "end"]);
  assert.ok(t!.steps.every((s) => s.viewId === "detail" && s.origin === "datapass-guidance"));
});

test("generate: execution tour walks schedule → job → notebook, then the produced tables", () => {
  const map = mapOf({ sched: "Nightly", job: "Job", nb: "Notebook", tbl: "Sales" }, [["sched", "job", "control"], ["job", "nb", "control"], ["nb", "tbl", "data"]]);
  const tours = generateTours(map, VIEWS);
  const exec = tours.find((t) => t.journey === "execution")!;
  assert.deepEqual(ids(exec), ["sched", "job", "nb", "tbl"]);
  assert.deepEqual(exec.steps.map((s) => s.explanationRef), ["trigger", "unit", "unit", "output"].map((s) => `guide:journey.execution.${s}`));
  assert.deepEqual(journeys(tours), ["lineage", "execution"]);
});

test("generate: no facts = no tour; cycles, dangling edges and view-less Locations are safe", () => {
  assert.deepEqual(generateTours(mapOf(LAYERS), VIEWS), []);
  const cyc = generateTours(mapOf({ a: "A", b: "B" }, [["a", "b", "data"], ["b", "a", "data"], ["a", "ghost", "data"]]), VIEWS);
  assert.equal(cyc.length, 1);
  assert.deepEqual(ids(cyc[0]!), ["a", "b"]);
  assert.deepEqual(generateTours(mapOf({ a: "A", noview: "N" }, [["a", "noview", "data"]]), VIEWS), []);
});

const USER: Tour = { id: "onboard", titleRef: "text:onboard.title", mode: "learning", steps: [
  { id: "s1", location: componentLocation("staging"), viewId: "lineage", explanationRef: "text:onboard.s1", origin: "user",
    substeps: [{ id: "s1a", location: componentLocation("processed"), viewId: "detail", explanationRef: "concept:x", origin: "ai-proposed" }] },
  { id: "s2", location: componentLocation("gone"), viewId: "detail", explanationRef: "guide:journey.lineage.end", origin: "user" },
  { id: "s3", location: componentLocation("curated"), viewId: "hidden", explanationRef: "text:missing", origin: "user" }] };
const DOC = { schema: "datapass.tour/1", tours: [USER], texts: { "onboard.title": "Onboarding", "onboard.s1": "Raw rows land here." } };

test("store: tours.json loads leniently, built-ins are never written, a built-in id in the file is a hole", () => {
  const loaded = loadTourFile(JSON.stringify(DOC));
  assert.deepEqual(loaded.holes, []);
  assert.equal(loaded.document.tours[0]!.id, "onboard");
  const builtin: Tour = { id: "datapass.journey.lineage.1", titleRef: "guide:journey.lineage", steps: [] };
  const merged = mergeTours([builtin], loadTourFile(JSON.stringify({ ...DOC, tours: [USER, { ...USER, id: builtin.id }] })));
  assert.deepEqual(merged.document.tours.map((t) => t.id), [builtin.id, "onboard"]);
  assert.deepEqual(merged.holes.map((h) => h.kind), ["duplicate-tour"]);
  const text = serializeTourFile(merged.document, new Set([builtin.id]));
  assert.deepEqual(JSON.parse(text).tours.map((t: Tour) => t.id), ["onboard"]);
  assert.deepEqual(loadTourFile("{nope").holes.map((h) => h.kind), ["malformed-document"]);
  assert.deepEqual(loadTourFile(undefined).document.tours, []);
  const bad = loadTourFile(JSON.stringify({ schema: "datapass.tour/1", tours: [{ id: "x", titleRef: "text:t", steps: [{ location: { level: "nowhere" } }] }] }));
  assert.deepEqual(bad.holes.map((h) => h.kind), ["malformed-location"]);
});

test("store: numbering covers sub-steps, stepping clamps, holes are live (missing box, hidden view)", () => {
  assert.deepEqual(flattenSteps(USER.steps).map((f) => f.number), ["1", "1.1", "2", "3"]);
  let c = prevStep(USER, startTour(USER));
  assert.equal(c.index, 0);
  for (let i = 0; i < 9; i++) c = nextStep(USER, c);
  assert.equal(c.index, 3);
  assert.equal(stepTo(USER, -2).index, 0);
  const map = mapOf(LAYERS);
  const ctx = { known: new Set(ladderLocations(projectLadder(() => map)).map(locationKey)), viewsAt: () => [{ id: "detail" }, { id: "lineage" }] };
  assert.deepEqual(flattenSteps(USER.steps).map((f) => stepStatus(f.step, ctx)), ["ok", "ok", "unknown-location", "unknown-view"]);
  assert.equal(tourOrigin(USER), "ai-proposed");
});

test("store: refs resolve text: and guide:, anything else is a hole; modes filter learning/interview + general", () => {
  const guide = labelPack({ "journey.lineage.end": "Custom end" });
  assert.equal(resolveRef("text:onboard.s1", DOC.texts, guide), "Raw rows land here.");
  assert.equal(resolveRef("guide:journey.lineage.end", undefined, guide), "Custom end");
  assert.equal(resolveRef("guide:journey.lineage", undefined, guide), "Data lineage");
  assert.equal(resolveRef("concept:x", DOC.texts, guide), undefined);
  assert.equal(resolveRef("text:missing", DOC.texts, guide), undefined);
  const g: Tour = { ...USER, id: "g", mode: undefined }, iv: Tour = { ...USER, id: "iv", mode: "interview" };
  assert.deepEqual(toursForMode([USER, g, iv], "learning").map((t) => t.id), ["onboard", "g"]);
  assert.deepEqual(toursForMode([USER, g, iv], "interview").map((t) => t.id), ["g", "iv"]);
  assert.deepEqual(toursForMode([USER, g, iv], "all", (m) => m !== "interview").map((t) => t.id), ["onboard", "g"]);
});

test("jump: every ladder Location is searchable by label, prefix beats scattered, kind matches weaker", () => {
  const map = mapOf(LAYERS);
  const labels: Record<string, string> = { demo: "Demo", main: "Main", ...LAYERS };
  const entries = ladderLocations(projectLadder(() => map)).map((location) => ({ location, label: labels[location.nodeId]! }));
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

test("slot: html escapes data, numbers sub-steps, marks holes and AI-proposed, words come from the pack", () => {
  const labels = labelPack({ "ui.next": "Onward" });
  const m: ToursModel = {
    labels, journeys: [{ id: "lineage", label: "Data <lineage>", active: true }, { id: "execution", label: "Execution", active: false }],
    tours: [{ id: "a", title: "A", active: true }, { id: "b", title: "B", badge: "ai-proposed", active: false }],
    steps: [{ index: 0, number: "1", depth: 0, label: "Landing", preview: "x", status: "ok", current: true },
      { index: 1, number: "1.1", depth: 1, label: "Gone", preview: "", status: "unknown-location", current: false }],
    explanation: null, canPrev: false, canNext: true, jump: { query: "", hits: [] }
  };
  const html = toursHtml(m);
  assert.ok(html.includes("Data &lt;lineage&gt;"));
  assert.ok(html.includes(uiLabel(labels, "aiProposed")));
  assert.ok(html.includes(uiLabel(labels, "unknownLocation")));
  assert.ok(html.includes(uiLabel(labels, "noExplanation")));
  assert.ok(html.includes(`<span class="tour-n">1.1</span>`) && html.includes("depth-1"));
  assert.ok(html.includes(`data-tour-action="prev" disabled`) && html.includes("Onward"));
  assert.ok(!/on(click|input)=/.test(html));
  assert.ok(toursHtml({ ...m, steps: [], tours: [] }).includes(uiLabel(labels, "none")));
  assert.ok(toursScript("vscodeApi").includes("vscodeApi.postMessage"));
});

test("schema: schemas/datapass-tour.schema.json is generated from TOUR_JSON_SCHEMA", () => {
  assert.deepEqual(JSON.parse(readFileSync("schemas/datapass-tour.schema.json", "utf8")), JSON.parse(JSON.stringify(TOUR_JSON_SCHEMA)));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.contributes.jsonValidation.some((v: { url: string; fileMatch: string[] }) => v.url === "./schemas/datapass-tour.schema.json" && v.fileMatch.includes("**/.datapass/tours.json")));
});

test("Navigator slot: tours CSS and script land inside the Navigator page under its nonce", async () => {
  const { navigatorHtml } = await import("../src/views/navigatorHtml");
  const { toursCss } = await import("../src/views/navToursHtml");
  const h = navigatorHtml("vscode-resource:", "N0NCE", { css: toursCss(), script: toursScript("vscode") });
  const script = h.slice(h.indexOf('<script nonce="N0NCE">'), h.indexOf("</script>"));
  assert.ok(script.includes('document.getElementById("tours")'), "tours script inside the nonce script");
  assert.ok(script.indexOf("tours") < script.indexOf('postMessage({ type: "ready" })'), "slot listener set before ready");
  assert.ok(h.slice(h.indexOf("<style>"), h.indexOf("</style>")).includes(".tour-step"));
  assert.ok(!navigatorHtml("vscode-resource:", "N0NCE").includes(".tour-step"), "no slot = no extra");
});
