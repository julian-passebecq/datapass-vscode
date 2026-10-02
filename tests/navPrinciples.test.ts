import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_PRINCIPLES, mergePrinciples, parsePrinciples, principleCards } from "../src/core/navigation/bindings/principles";
import { PRINCIPLE_CHECKS, checkDqGates, checkIdempotence, checkLayers, checkLineage, checkPartitioning, checkScd, runPrincipleCheck, type PrincipleFacts } from "../src/core/navigation/principles/checks";
import { PRINCIPLES_PACK, principleLinkCommand } from "../src/core/navigation/packs/principles";
import type { NavLocation } from "../src/core/navigation/navTypes";

const loc = (nodeId: string): NavLocation => ({ level: "artifact", nodeId, artifactKind: "spark-notebook" });
const all = { layers: true, lineage: true, writes: true, quality: true, partitions: true };

const facts: PrincipleFacts = {
  families: all,
  artifacts: [
    { location: loc("ingest"), layer: "bronze", reads: ["src.orders"], writes: [{ target: "stg_orders", mode: "append" }], lineageBound: true },
    { location: loc("clean"), layer: "silver", reads: ["stg_orders"], writes: [{ target: "int_orders", mode: "merge", keyed: true, partitionBy: ["order_date"] }], lineageBound: true, checkedTables: ["int_orders"] },
    { location: loc("report"), layer: "gold", reads: ["stg_orders"], writes: [{ target: "fct_orders", mode: "overwrite", rows: 50_000_000 }], lineageBound: false },
    { location: loc("dims"), layer: "gold", writes: [{ target: "dim_customer", mode: "overwrite", rows: 1000 }], checkedTables: ["dim_customer"] },
    { location: loc("loose"), writes: [{ target: "misc", mode: "unknown" }] },
  ],
};

test("built-in principles: six valid cards, each mapped to concepts and a known check, ≤ 60 words", () => {
  assert.equal(BUILT_IN_PRINCIPLES.cards.length, 6);
  assert.equal(BUILT_IN_PRINCIPLES.label, "DataPass guidance");
  for (const c of BUILT_IN_PRINCIPLES.cards) {
    assert.ok((PRINCIPLE_CHECKS as readonly string[]).includes(c.check), c.id);
    assert.ok(c.concepts.length > 0, c.id);
    assert.ok(c.text.split(/\s+/).length <= 60, `${c.id} too long`);
  }
});

test("layers: unassigned breaks, curated reading staging breaks, aliases map bronze/silver/gold", () => {
  const r = checkLayers(facts);
  assert.equal(r.status, "breaks");
  assert.deepEqual(r.breaks.map(b => b.location.nodeId).sort(), ["loose", "report"]);
  assert.deepEqual(r.applies.map(l => l.nodeId).sort(), ["clean", "dims", "ingest"]);
});

test("missing fact family gives unknown with a hole, never breaks", () => {
  const r = checkLayers({ ...facts, families: {} });
  assert.equal(r.status, "unknown");
  assert.match(r.holes[0]!.reason, /not available/);
  assert.equal(checkPartitioning({ ...facts, families: { writes: true } }).status, "unknown");
});

test("lineage, idempotence, dq gates", () => {
  assert.deepEqual(checkLineage(facts).breaks.map(b => b.location.nodeId).sort(), ["dims", "loose", "report"]);
  const idem = checkIdempotence(facts);
  assert.deepEqual(idem.breaks.map(b => b.location.nodeId), ["ingest"]);
  assert.ok(idem.holes.some(h => /misc/.test(h.reason)));
  const dq = checkDqGates(facts);
  assert.deepEqual(dq.breaks.map(b => b.location.nodeId).sort(), ["loose", "report"]);
  assert.ok(!dq.applies.some(l => l.nodeId === "ingest"), "staging is not a gate");
});

test("scd: overwritten dimension breaks; snapshot applies; no dimension is a hole", () => {
  assert.deepEqual(checkScd(facts).breaks.map(b => b.location.nodeId), ["dims"]);
  const snap = checkScd({ families: all, artifacts: [{ location: loc("snap"), snapshots: ["dim_customer"] }] });
  assert.equal(snap.status, "applies");
  const none = checkScd({ families: all, artifacts: [{ location: loc("x"), writes: [{ target: "t", mode: "overwrite" }] }] });
  assert.equal(none.status, "unknown");
});

test("partitioning: big unpartitioned breaks, unknown volume is a hole, threshold is a setting", () => {
  const r = checkPartitioning(facts);
  assert.deepEqual(r.breaks.map(b => b.location.nodeId), ["report"]);
  assert.deepEqual(r.applies.map(l => l.nodeId), ["clean"]);
  assert.equal(checkPartitioning(facts, { partitionRowThreshold: 100 }).breaks.length, 2);
});

test("unknown check id is a hole", () => {
  assert.equal(runPrincipleCheck("future", facts).status, "unknown");
});

test("cards: project scope keeps all six; 'here' scope filters to the subtree", () => {
  const p = principleCards({ facts });
  assert.equal(p.cards.length, 6);
  assert.ok(p.cards.every(c => c.origin === "datapass-guidance" && c.label === "DataPass guidance"));
  const here = principleCards({ facts, within: l => l.nodeId === "clean" });
  assert.ok(here.cards.length > 0);
  for (const c of here.cards) for (const l of [...c.applies, ...c.breaks.map(b => b.location)]) assert.equal(l.nodeId, "clean");
});

test("overrides replace, add and hide cards; invalid docs rejected", () => {
  const m = mergePrinciples(BUILT_IN_PRINCIPLES, { label: "Guide", cards: [
    { id: "lineage", title: "T", text: "x", check: "lineage", concepts: [] }, { id: "scd", hidden: true },
    { id: "new", title: "N", text: "y", check: "layers" }] });
  assert.equal(m.label, "Guide");
  assert.equal(m.cards.find(c => c.id === "lineage")!.title, "T");
  assert.ok(!m.cards.some(c => c.id === "scd"));
  assert.ok(m.cards.some(c => c.id === "new"));
  assert.equal(parsePrinciples({ schema: "x", cards: [] }), null);
});

test("pack: Principles at project, Principles here at artifact, links are go", () => {
  assert.deepEqual(PRINCIPLES_PACK.map(e => [e.level, e.views[0]!.id, e.views[0]!.layout]),
    [["project", "principles", "detail-card"], ["artifact", "principles-here", "detail-card"]]);
  assert.deepEqual(principleLinkCommand(loc("a")), { type: "go", location: loc("a") });
});

test("principles binding adapter: registered, guidance cards with unknown checks and a typed hole without facts", async () => {
  const { bindingProvider } = await import("../src/core/navigation/bindings");
  const p = bindingProvider("principles");
  assert.ok(p, "principles provider registered via *.binding.ts");
  const r = p!.provide({ location: { level: "project", nodeId: "p", artifactKind: "project" } });
  assert.equal(r.cards!.length, BUILT_IN_PRINCIPLES.cards.length);
  assert.ok(r.cards!.every(c => c.fields.some(f => f.label === "Status" && f.value === "unknown")));
  assert.ok(r.holes.some(h => /not in the binding context/.test(h.reason)));
});
