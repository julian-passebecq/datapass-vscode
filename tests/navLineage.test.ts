import { test } from "node:test";
import assert from "node:assert/strict";
import { collectLineage, nodesByEvidencePath, LINEAGE_PACK, type LineageGraphLike, type LineageLocator, type LineageEdgeLike, type LineageNodeLike } from "../src/core/navigation/bindings/lineage";
import { collectDataFlow, DATA_FLOW_PACK } from "../src/core/navigation/bindings/dataFlow";
import { bindingProvider, bindingSources } from "../src/core/navigation/bindings";
import { PACKS } from "../out/gen/packs";
import { NAV_LEVELS, type NavLocation } from "../src/core/navigation/navTypes";

const ev = (path: string) => [{ origin: "static" as const, locator: { kind: "file", path } }];
const node = (id: string, kind: string, path: string, parentId: string | null = null, origin: LineageNodeLike["origin"] = "static"): LineageNodeLike =>
  ({ id, kind, name: id, parentId, origin, evidence: ev(path) });
const edge = (kind: LineageEdgeLike["kind"], fromId: string, toId: string, extra: Partial<LineageEdgeLike> = {}): LineageEdgeLike =>
  ({ id: `e:${kind}:${fromId}:${toId}`, kind, fromId, toId, volumetry: null, origin: "static", evidence: [], ...extra });

// raw → [ingest task of job J, daily] → bronze → [silver.sql] → silver → [report] ; raw.col field of raw
const graph: LineageGraphLike = {
  schema: "datapass.lineage-graph/1", id: "datapass:lineage-graph:x", namespace: "t",
  nodes: [
    node("raw", "dataset", "src/ingest.py"), node("raw.col", "field", "src/ingest.py", "raw"),
    node("J", "job", "jobs/daily.yml"), node("ingest", "task", "src/ingest.py"),
    node("bronze", "dataset", "src/ingest.py"), node("silverSql", "task", "sql/silver.sql"),
    node("silver", "dataset", "sql/silver.sql"), node("report", "dashboard", "bi/report.pbix", null, "ai-proposed"),
  ],
  edges: [
    edge("reads", "raw.col", "ingest"), edge("writes", "ingest", "bronze", { volumetry: { rowsPerRun: 10, bytesPerRun: null, frequency: "0 2 * * *", basis: "theoretical" } }),
    edge("orchestrates", "J", "ingest"),
    edge("reads", "bronze", "silverSql"), edge("writes", "silverSql", "silver"),
    edge("reads", "silver", "report", { origin: "ai-proposed" }),
  ],
};
const loc = (level: NavLocation["level"], nodeId: string): NavLocation => ({ level, nodeId, artifactKind: "sql-script" });
const byPath: LineageLocator = { nodesAt: (l, g) => l.level === "project" ? g.nodes.map(n => n.id) : nodesByEvidencePath(g, l.nodeId) };

test("lineage: neighbourhood both ways, fields fold into their dataset, data-flow direction", () => {
  const r = collectLineage(graph, loc("artifact", "sql/silver.sql"), byPath, { depth: 2 });
  assert.ok(r.graph);
  assert.deepEqual(r.graph.focusIds, ["silver", "silverSql"]);
  const sides = Object.fromEntries(r.graph.nodes.map(n => [n.id, `${n.side}:${n.distance}`]));
  assert.equal(sides.bronze, "upstream:1");
  assert.equal(sides.ingest, "upstream:2");
  assert.equal(sides.report, "downstream:1");
  assert.equal(sides["raw.col"], undefined, "fields fold into their dataset");
  assert.ok(r.truncated, "raw is 3 hops up: cut is reported");
  assert.ok(r.holes.some(h => /cut at 2 hops/.test(h.reason)));
  assert.ok(r.graph.edges.every(e => e.kind !== "orchestrates"), "control edges are opt-in");
  assert.equal(r.origin, "ai-proposed", "summary carries the weakest origin");
});

test("lineage: upstream only, project-wide raw reached through a field edge", () => {
  const r = collectLineage(graph, loc("artifact", "bi/report.pbix"), byPath, { direction: "upstream", depth: 10 });
  assert.ok(r.graph);
  assert.ok(r.graph.nodes.some(n => n.id === "raw" && n.side === "upstream"));
  assert.ok(!r.graph.nodes.some(n => n.side === "downstream"));
  assert.ok(r.graph.edges.some(e => e.fromId === "raw" && e.toId === "ingest"), "field edge lifted to dataset");
  assert.equal(r.truncated, false);
});

test("lineage: holes, never guesses", () => {
  assert.equal(collectLineage(null, loc("project", "p"), byPath).graph, null);
  const none = collectLineage(graph, loc("artifact", "nope.sql"), byPath);
  assert.equal(none.graph, null);
  assert.match(none.holes[0]!.reason, /No lineage node/);
});

test("lineage: projector gets HOP projection narrowed to the neighbourhood", () => {
  let seen: any;
  const r = collectLineage(graph, loc("artifact", "bi/report.pbix"), byPath, { direction: "upstream", depth: 1 }, {
    projection: { project: (_g, p) => { seen = p; return { ok: true, value: { schema: "datapass.graph-view/1" } }; },
      projection: { id: "hop", filter: { nodeKinds: ["dataset"], includeIds: [], excludeIds: ["x"] } }, preset: {} },
  });
  assert.deepEqual(seen.filter.includeIds, ["report", "silver"]);
  assert.deepEqual(seen.filter.excludeIds, []);
  assert.deepEqual(seen.filter.nodeKinds, ["dataset"], "base filter kept");
  assert.deepEqual(r.graph?.view, { schema: "datapass.graph-view/1" });
  const bad = collectLineage(graph, loc("artifact", "bi/report.pbix"), byPath, {}, {
    projection: { project: () => ({ ok: false }), projection: { filter: {} }, preset: {} } });
  assert.equal(bad.graph?.view, null);
  assert.ok(bad.holes.some(h => /could not be projected/.test(h.reason)));
});

test("data-flow: project table with process, schedule and holes", () => {
  const r = collectDataFlow(graph, loc("project", "p"), byPath);
  const rows = r.rows.map(x => `${x.dataset}|${x.access}|${x.by}|${x.process ?? "-"}|${x.schedule ?? "-"}|${x.origin}`);
  assert.deepEqual(rows, [
    "bronze|write|ingest|J|0 2 * * *|static",
    "bronze|read|silverSql|-|-|static",
    "raw|read|ingest|J|-|static",
    "silver|write|silverSql|-|-|static",
    "silver|read|report|-|-|ai-proposed",
  ]);
  assert.equal(r.rows[0]!.scheduleOrigin, "theoretical");
  assert.ok(r.holes.some(h => /3 flow\(s\) with an unknown process/.test(h.reason)));
  assert.ok(r.holes.some(h => /4 flow\(s\) with an unknown schedule/.test(h.reason)));
  assert.equal(r.origin, "ai-proposed");
});

test("data-flow: Location scope and truncation", () => {
  const r = collectDataFlow(graph, loc("artifact", "sql/silver.sql"), byPath);
  assert.deepEqual([...new Set(r.rows.map(x => x.dataset))], ["bronze", "silver"]);
  const t = collectDataFlow(graph, loc("project", "p"), byPath, { max: 2 });
  assert.equal(t.rows.length, 2); assert.equal(t.total, 5); assert.ok(t.truncated);
  assert.match(collectDataFlow(graph, loc("artifact", "x"), byPath).holes[0]!.reason, /No lineage node/);
  assert.match(collectDataFlow(undefined, loc("project", "p"), byPath).holes[0]!.reason, /No lineage graph/);
});

test("catalog: views offered for every kind at every level, sources registered", () => {
  for (const pack of [LINEAGE_PACK, DATA_FLOW_PACK]) {
    assert.deepEqual(pack.map(e => e.level), [...NAV_LEVELS]);
    assert.ok(pack.every(e => e.artifactKind === "*"));
  }
  for (const e of [...LINEAGE_PACK, ...DATA_FLOW_PACK]) assert.ok(PACKS.includes(e));
  assert.ok(bindingSources().includes("lineage") && bindingSources().includes("data-flow"));
});

test("lineage/data-flow binding adapters: typed hole without a graph, graph and rows with one", () => {
  const lin = bindingProvider("lineage")!, flow = bindingProvider("data-flow")!;
  const at = loc("artifact", "sql/silver.sql");
  assert.match(lin.provide({ location: at }).holes[0]!.reason, /No lineage graph/);
  assert.match(flow.provide({ location: at }).holes[0]!.reason, /No lineage graph/);
  const ctx = { location: at, params: { depth: 2 }, lineageGraph: graph } as Parameters<typeof lin.provide>[0];
  const g = lin.provide(ctx);
  assert.ok(g.graph && g.graph.nodes.some(n => n.id === "bronze") && g.graph.edges.length > 0);
  const f = flow.provide(ctx);
  assert.ok(f.rows && f.rows.some(r => r.label === "silver"));
});
