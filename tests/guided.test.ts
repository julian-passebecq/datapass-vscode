/**
 * V5 TOUR2: guided mode — tour stepping (keys, wheel), saved view resolution (NAVCAT1 overrides),
 * Learning / Interview filter and toggles, "Save current path" / "Add this screen" documents,
 * explanation schemes, and the read-only Present header.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectMap } from "../src/core/project/projectMap";
import { NavigationService } from "../src/core/navigation/navigationService";
import { DEFAULT_VIEW_CATALOG, type ViewOverrides } from "../src/core/navigation/navTypes";
import { componentLocation, projectLadder } from "../src/core/navigation/projectLadder";
import { ladderLocations, locationKey, loadTourFile, nextStep, startTour, stepStatus } from "../src/core/navigation/tours/store";
import { validateTourDocument, TOUR_SCHEMA_ID, type Tour } from "../src/core/navigation/tours/tourTypes";
import {
  addScreenToTour, availableModes, DEFAULT_GUIDED_SETTINGS, keyToStepIndex, readGuidedSettings, recordScreen, saveScreensAsTour, userTourId,
  visibleTours, wheelDelta, type Screen
} from "../src/core/guided/guided";
import { registerExplanationScheme, resolveExplanation } from "../src/core/guided/explanations";
import { guidedHtml, parseGuidedMessage } from "../src/views/guided/guidedHtml";
import { labelPack, toursHtml, type ToursModel } from "../src/views/navToursHtml";

const MAP = {
  project: { id: "demo", title: "Demo", schemaVersion: 1 },
  subprojects: [{ id: "main", title: "Main", componentIds: ["a", "b", "c"] }],
  components: ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase() })), relations: []
} as unknown as ProjectMap;
const step = (id: string, node: string, viewId = "detail", substeps?: Tour["steps"]): Tour["steps"][number] =>
  ({ id, location: componentLocation(node), viewId, explanationRef: `text:t.${id}`, origin: "user", ...(substeps ? { substeps } : {}) });
const FIXTURE: Tour = { id: "user.fixture", titleRef: "text:t.title", steps: [step("s1", "a"), step("s2", "b", "detail", [step("s2a", "c")]), step("s3", "c")] };

test("stepping: 1–9 reach top-level steps across sub-steps, wheel moves one step past the threshold", () => {
  assert.equal(keyToStepIndex(FIXTURE, "1"), 0);
  assert.equal(keyToStepIndex(FIXTURE, "3"), 3);
  assert.equal(keyToStepIndex(FIXTURE, "4"), null);
  assert.equal(keyToStepIndex(FIXTURE, "x"), null);
  assert.equal(wheelDelta(120), 1);
  assert.equal(wheelDelta(-120), -1);
  assert.equal(wheelDelta(10), 0);
  assert.equal(nextStep(FIXTURE, nextStep(FIXTURE, startTour(FIXTURE))).index, 2);
});

test("saved views: a NAVCAT1 saved view resolves as a step view; a hidden one becomes a hole", () => {
  const nav = new NavigationService(projectLadder(() => MAP), DEFAULT_VIEW_CATALOG);
  const saved: ViewOverrides = { schema: "datapass.view-overrides/1", entries: [{ artifactKind: "*", level: "artifact",
    add: [{ id: "user.my-screen", title: "My screen", layout: "table", bindings: [{ source: "evidence" }] }] }] };
  nav.setCatalog(DEFAULT_VIEW_CATALOG, saved);
  const ctx = { known: new Set(ladderLocations(nav.ladder).map(locationKey)), viewsAt: (l: Parameters<typeof nav.viewsAt>[0]) => nav.viewsAt(l) };
  assert.equal(stepStatus(step("s", "a", "user.my-screen"), ctx), "ok");
  const firstBuiltin = nav.viewsAt(componentLocation("a")).find((v) => v.id !== "user.my-screen")!.id;
  nav.setCatalog(DEFAULT_VIEW_CATALOG, { schema: "datapass.view-overrides/1", entries: [{ artifactKind: "*", level: "artifact", hidden: [firstBuiltin] }] });
  assert.equal(stepStatus(step("s", "a", firstBuiltin), ctx), "unknown-view");
  assert.equal(stepStatus(step("s", "a", "user.my-screen"), ctx), "unknown-view");
});

test("modes: Learning shows learning + general, Interview interview + general; toggles hide modes and tours", () => {
  const L: Tour = { ...FIXTURE, id: "l", mode: "learning" }, I: Tour = { ...FIXTURE, id: "i", mode: "interview" }, G: Tour = { ...FIXTURE, id: "g" };
  const S = DEFAULT_GUIDED_SETTINGS;
  assert.deepEqual(visibleTours([L, I, G], "learning", S).map((t) => t.id), ["l", "g"]);
  assert.deepEqual(visibleTours([L, I, G], "interview", S).map((t) => t.id), ["i", "g"]);
  assert.deepEqual(visibleTours([L, I, G], "all", S).map((t) => t.id), ["l", "i", "g"]);
  const off = readGuidedSettings((k) => ({ "modes.interview.enabled": false, disabledTours: ["g", 3], "panels.cards": "nope" } as Record<string, unknown>)[k]);
  assert.deepEqual(off.disabledTours, ["g"]);
  assert.equal(off.panels.cards, true);
  assert.deepEqual(availableModes(off), ["all", "learning"]);
  assert.deepEqual(visibleTours([L, I, G], "interview", off).map((t) => t.id), ["l"]);
});

test("save path / add screen: valid datapass.tour/1, user origin, text refs, unique ids, duplicates collapsed", () => {
  const a: Screen = { location: componentLocation("a"), viewId: "detail" }, b: Screen = { location: componentLocation("b"), viewId: "lineage" };
  let path = recordScreen([], a);
  path = recordScreen(recordScreen(path, a), b);
  assert.equal(path.length, 2);
  assert.equal(recordScreen(path, a, 2).length, 2);
  const base = loadTourFile(undefined).document;
  const { document, tourId } = saveScreensAsTour(base, "My Walk!", path, (s) => s.location.nodeId.toUpperCase(), "learning");
  assert.equal(tourId, "user.my-walk");
  assert.ok(validateTourDocument(document).ok);
  const t = document.tours[0]!;
  assert.equal(t.mode, "learning");
  assert.deepEqual(t.steps.map((s) => [s.viewId, s.origin, document.texts![s.explanationRef.slice(5)]]), [["detail", "user", "A"], ["lineage", "user", "B"]]);
  assert.equal(userTourId("My Walk!", new Set([tourId])), "user.my-walk-2");
  const added = addScreenToTour(document, tourId, a, "  again  ")!;
  assert.ok(validateTourDocument(added).ok);
  assert.equal(added.tours[0]!.steps.length, 3);
  assert.equal(added.tours[0]!.steps[2]!.id, "s3");
  assert.equal(added.texts![`${tourId}.s3`], "again");
  assert.equal(addScreenToTour(document, "nope", a, "x"), null);
  assert.equal(document.schema, TOUR_SCHEMA_ID);
});

test("explanations: text: and guide: built in, later schemes register, unknown = typed hole", () => {
  const ctx = { texts: { "t.s1": "Hello" }, guide: labelPack({}) };
  assert.deepEqual(resolveExplanation("text:t.s1", ctx), { text: "Hello" });
  assert.deepEqual(resolveExplanation("guide:mode.learning", ctx), { text: "Learning" });
  assert.deepEqual(resolveExplanation("concept:x", ctx), { hole: "unknown-scheme" });
  assert.deepEqual(resolveExplanation("text:none", ctx), { hole: "unknown-key" });
  assert.deepEqual(resolveExplanation("bad ref", ctx), { hole: "malformed-ref" });
  const d = registerExplanationScheme("concept", (key) => (key === "x" ? "A concept" : undefined));
  assert.deepEqual(resolveExplanation("concept:x", ctx), { text: "A concept" });
  d.dispose();
  assert.deepEqual(resolveExplanation("concept:x", ctx), { hole: "unknown-scheme" });
  assert.throws(() => registerExplanationScheme("text", () => "x"));
});

test("present: read-only strips edit controls and the jump field; messages are validated", () => {
  const labels = labelPack({});
  const m: ToursModel = { labels, journeys: [], tours: [], steps: [{ index: 0, number: "1", depth: 0, label: "A", preview: "", status: "ok", current: true }],
    explanation: "Why", explanationBox: false, canPrev: false, canNext: true, jump: { query: "", hits: [] } };
  const inner = toursHtml(m);
  assert.ok(!inner.includes("tour-text"));
  const edit = guidedHtml(inner, { labels, modes: ["all", "learning", "interview"], mode: "learning", presenting: false, canEdit: true });
  assert.ok(edit.includes(`data-guided-action="save-path"`) && edit.includes("tour-jump") && edit.includes(`aria-checked="true" data-guided-mode="learning"`));
  const show = guidedHtml(inner, { labels, modes: ["all"], mode: "all", presenting: true, canEdit: true });
  assert.ok(!show.includes("save-path") && !show.includes("add-screen") && !show.includes("tour-jump") && !show.includes("guided-modes"));
  assert.ok(show.includes(labels["ui.stopPresenting"]!));
  assert.deepEqual(parseGuidedMessage({ type: "guided", action: "key", key: "3" }), { type: "guided", action: "key", key: "3" });
  assert.equal(parseGuidedMessage({ type: "guided", action: "key", key: "0" }), null);
  assert.equal(parseGuidedMessage({ type: "guided", action: "mode", mode: "general" }), null);
  assert.deepEqual(parseGuidedMessage({ type: "guided", action: "wheel", deltaY: 1e9 }), { type: "guided", action: "wheel", deltaY: 10_000 });
});
