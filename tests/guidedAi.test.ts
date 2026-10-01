import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VIEW_CATALOG, resolveViews, type NavLocation } from "../src/core/navigation/navTypes";
import { checkIncoming, detectKind } from "../src/core/project/aiExchange";
import { checkTours, TOUR_SCHEMA_ID } from "../src/core/navigation/tours/tourTypes";
import { buildTourRequest, importTourAnswer, parseTopicPresets, presetGeneration, tourIdFor, type TourImportContext } from "../src/core/guided-ai/tourExchange";

const project: NavLocation = { level: "project", nodeId: "demo", artifactKind: "project" };
const bi: NavLocation = { level: "subproject", nodeId: "bi", artifactKind: "subproject" };
const report: NavLocation = { level: "artifact", nodeId: "sales-report", artifactKind: "other" };
const viewsAt = (l: NavLocation) => resolveViews(DEFAULT_VIEW_CATALOG, null, l.artifactKind, l.level);
const view = (l: NavLocation) => viewsAt(l)[0]!.id;
const ctx = (extra: Partial<TourImportContext> = {}): TourImportContext => ({ locations: [project, bi, report], viewsAt, ...extra });
const step = (location: NavLocation, more: Record<string, unknown> = {}) => ({ location, viewId: view(location), explanationRef: "text:s", origin: "ai-proposed", ...more });
const answer = (steps: unknown[], more: Record<string, unknown> = {}, texts: Record<string, string> = { s: "Why this screen.", title: "BI" }) =>
  ({ schema: TOUR_SCHEMA_ID, tours: [{ id: "ai.bi", titleRef: "text:title", steps, ...more }], texts });
const all = (s: any[]): any[] => s.flatMap((x) => [x, ...all(x.substeps ?? [])]);

test("guided-ai: a valid answer imports, with text keys prefixed by the tour id", () => {
  const r = importTourAnswer(answer([step(project), step(bi, { substeps: [step(report)] })]), ctx());
  const doc = JSON.parse(r.text);
  assert.deepEqual(r.tourIds, ["ai.bi"]);
  assert.equal(r.holes.length, 0);
  assert.equal(doc.tours[0].titleRef, "text:ai.bi.title");
  assert.deepEqual(all(doc.tours[0].steps).map((s) => s.explanationRef), ["text:ai.bi.s", "text:ai.bi.s", "text:ai.bi.s"]);
  assert.deepEqual(doc.texts, { "ai.bi.s": "Why this screen.", "ai.bi.title": "BI" });
  assert.equal(checkTours(doc).holes.length, 0);
});

test("guided-ai: an unknown Location or view becomes a hole, never a screen", () => {
  const ghost: NavLocation = { level: "artifact", nodeId: "invented-dashboard", artifactKind: "powerbi" };
  const r = importTourAnswer(answer([step(project), { ...step(bi), location: ghost }, { ...step(report), viewId: "no-such-view" }]), ctx());
  assert.deepEqual(r.holes.map((h) => h.kind), ["unknown-location", "unknown-view"]);
  assert.equal(JSON.parse(r.text).tours[0].steps.length, 1);
  assert.ok(r.warnings.some((w) => w.includes("invented-dashboard") && w.includes("hole")));
});

test("guided-ai: origin is stamped ai-proposed even when the answer claims otherwise", () => {
  const r = importTourAnswer(answer([step(project, { origin: "user" }), step(bi, { origin: "datapass-guidance", substeps: [step(report, { origin: "user" })] })]), ctx());
  assert.deepEqual(all(JSON.parse(r.text).tours[0].steps).map((s) => s.origin), ["ai-proposed", "ai-proposed", "ai-proposed"]);
  assert.ok(r.warnings.some((w) => w.includes("3 step(s) claimed another origin")));
});

test("guided-ai: excluded sections stay empty; the request's generation wins over the answer's", () => {
  const requested = { "ai.bi": { generation: { exclude: ["volumetry"] }, mode: "interview" as const } };
  const steps = [step(project, { section: "objectives", substeps: [step(bi, { section: "volumetry" })] }), step(report, { section: "volumetry" }), step(bi)];
  const r = importTourAnswer(answer(steps, { generation: { include: ["volumetry"] } }), ctx({ requested }));
  const t = JSON.parse(r.text).tours[0];
  assert.deepEqual(t.generation, { exclude: ["volumetry"] });
  assert.equal(t.mode, "interview");
  assert.deepEqual(t.steps.map((s: any) => s.location.nodeId), ["demo", "bi"]);
  assert.equal(t.steps[0].substeps, undefined);
  assert.ok(r.warnings.some((w) => w.includes("changed the requested generation")));
  assert.ok(r.warnings.some((w) => w.includes("2 step(s) in an excluded")));
});

test("guided-ai: with include, only steps of an included section stay (unsectioned ones too)", () => {
  const requested = { "ai.bi": { generation: { include: ["objectives"] } } };
  const r = importTourAnswer(answer([step(project, { section: "objectives" }), step(bi), step(report, { section: "platforms" })], { generation: { include: ["objectives"] } }), ctx({ requested }));
  assert.deepEqual(JSON.parse(r.text).tours[0].steps.map((s: any) => s.location.nodeId), ["demo"]);
});

test("guided-ai: merge keeps other tours and texts, and never replaces a person's tour", () => {
  const mine = { schema: TOUR_SCHEMA_ID, texts: { "other.x": "kept" },
    tours: [{ id: "ai.bi", titleRef: "text:other.x", steps: [step(project, { origin: "user", explanationRef: "text:other.x" })] }, { id: "other", titleRef: "text:other.x", steps: [] }] };
  const r = importTourAnswer(answer([step(bi)]), ctx({ currentText: JSON.stringify(mine) }));
  const doc = JSON.parse(r.text);
  assert.deepEqual(doc.tours.map((t: any) => t.id), ["ai.bi", "other", "ai.bi.2"]);
  assert.equal(doc.texts["other.x"], "kept");
  assert.equal(doc.texts["ai.bi.2.s"], "Why this screen.");
  assert.throws(() => importTourAnswer(answer([step(bi)]), ctx({ currentText: '{"format":"datapass.tours","version":1,"tours":[]}' })), /will not overwrite/);
});

test("guided-ai: the exchange recognises a tour answer and returns the merged tours.json", () => {
  const raw = "Here is the tour:\n```json\n" + JSON.stringify(answer([step(project)])) + "\n```";
  assert.equal(detectKind(answer([])), "tour");
  const f = checkIncoming(raw, { tour: ctx() });
  assert.equal(f.kind, "tour");
  assert.equal(f.path, ".datapass/tours.json");
  assert.equal(checkTours(JSON.parse(f.text)).holes.length, 0);
  assert.throws(() => checkIncoming(raw, {}), /guided tours are off|no project/);
});

test("guided-ai: request lists real Locations, views and the generation; topics are data", () => {
  const { presets, problems } = parseTopicPresets([
    { id: "interview", label: "Interview", mode: "interview", include: ["objectives"], exclude: ["sample-output"] },
    { id: "interview", label: "dup" }, { id: "Bad Id", label: "x" }
  ]);
  assert.equal(presets.length, 1);
  assert.equal(problems.length, 2);
  assert.deepEqual(presetGeneration(presets[0]!), { include: ["objectives"], exclude: ["sample-output"] });
  assert.equal(tourIdFor("bi", ["ai.bi"]), "ai.bi.2");
  const text = buildTourRequest({ tourId: "ai.interview", topic: presets[0]!, dataPassVersion: "0.0.0-test",
    locations: [project, bi].map((location) => ({ location, label: location.nodeId, views: viewsAt(location).map((v) => ({ id: v.id, title: v.title })) })) });
  assert.match(text, /"nodeId":"bi"/);
  assert.match(text, /\{"include":\["objectives"\],"exclude":\["sample-output"\]\}/);
  assert.match(text, /"origin": "ai-proposed"/);
  assert.ok(text.includes(`\`${view(bi)}\``));
});
