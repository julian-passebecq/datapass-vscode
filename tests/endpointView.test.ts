import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTraceTree, collectEndpoints, collectEndpointTrace, joinEndpoints, percentile, staticEndpoints,
  ENDPOINTS_PACK, TRACE_NODE_STATES, TRACE_NODE_STYLES, type ReplayBatchLike, type ReplayRunLike,
} from "../src/core/navigation/bindings/endpoints";
import type { LineageGraphLike, LineageLocator, LineageNodeLike } from "../src/core/navigation/bindings/lineage";
import { BINDING_SOURCES } from "../src/core/navigation/bindings";
import { VIEW_PACKS } from "../src/core/navigation/packs";
import { NAV_LEVELS, type NavLocation } from "../src/core/navigation/navTypes";

// Synthetic API (no client data): orders service with two routes in app/orders.py, users in app/users.py.
const ep = (id: string, name: string, path: string): LineageNodeLike =>
  ({ id, kind: "api-endpoint", name, parentId: null, origin: "static", evidence: [{ origin: "static", locator: { kind: "file", path } }] });
const graph: LineageGraphLike = {
  schema: "datapass.lineage-graph/1", id: "g", namespace: "t",
  nodes: [
    ep("ep:list", "orders GET /orders", "app/orders.py"), ep("ep:get", "orders GET /orders/{id}", "app/orders.py"),
    ep("ep:user", "users GET /users/{id}", "app/users.py"),
    { id: "ds", kind: "dataset", name: "db.orders", parentId: null, origin: "static", evidence: [] },
  ],
  edges: [],
};
const locator: LineageLocator = { nodesAt: (loc) => graph.nodes.filter(n => n.evidence.some(e => e.locator?.path === loc.nodeId)).map(n => n.id) };
const project: NavLocation = { level: "project", nodeId: "p", artifactKind: "project" };
const ordersFile: NavLocation = { level: "artifact", nodeId: "app/orders.py", artifactKind: "other" };
const usersFile: NavLocation = { level: "artifact", nodeId: "app/users.py", artifactKind: "other" };

const span = (traceId: string, spanId: string, parentSpanId: string | null, opts: {
  endpoint?: string; name?: string; ms?: number | null; status?: string; http?: number | null; clipped?: boolean; start?: number;
} = {}): ReplayRunLike => ({
  kind: "run", provider: "otel",
  binding: opts.endpoint ? { kind: "endpoint", id: opts.endpoint } : "unbound",
  subject: { displayName: opts.name ?? spanId, container: "orders" },
  native: { traceId, spanId, parentSpanId, spanName: opts.name ?? spanId, httpStatus: opts.http ?? null, clipped: opts.clipped ?? false },
  runId: `${traceId}:${spanId}`, jobType: "http-request", status: opts.status ?? "succeeded",
  startedAt: `2026-10-01T10:00:0${opts.start ?? 0}.000Z`, endedAt: opts.clipped ? null : "2026-10-01T10:00:09.000Z",
  durationMs: opts.clipped ? null : opts.ms ?? 10, failureReason: opts.status === "failed" ? "HTTP 500" : null,
});
const runs: ReplayRunLike[] = [
  span("t1", "a", null, { endpoint: "ep:list", name: "GET /orders", ms: 120, http: 200 }),
  span("t1", "a1", "a", { name: "SELECT orders", ms: 80, start: 1 }),
  span("t1", "a2", "a", { name: "GET /users/{id}", endpoint: "ep:user", ms: 20, start: 2 }),
  span("t2", "b", null, { endpoint: "ep:list", name: "GET /orders", ms: 40, http: 500, status: "failed" }),
  span("t3", "c", "lost-parent", { endpoint: "ep:list", name: "GET /orders", clipped: true }),
  span("t4", "d", null, { name: "GET /health", ms: 1 }),
];
const metric = { kind: "run", provider: "otel", binding: { kind: "endpoint", id: "ep:list" }, subject: {}, native: { metric: "http_requests_total", value: 3 },
  runId: "m", jobType: "metric:http_requests_total", status: "unknown", startedAt: null, endedAt: null, durationMs: null, failureReason: null };
const batch: ReplayBatchLike = { id: "batch-1", origin: "fixture", dataClass: "synthetic", observations: [...runs, metric] };

test("staticEndpoints parses the analyzers-api node name and keeps the evidence path", () => {
  const eps = staticEndpoints(graph);
  assert.deepEqual(eps.map(e => e.id), ["ep:list", "ep:get", "ep:user"]);
  assert.deepEqual([eps[1]!.service, eps[1]!.method, eps[1]!.route, eps[1]!.path], ["orders", "GET", "/orders/{id}", "app/orders.py"]);
});

test("percentile is nearest-rank", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
});

test("join: observed endpoints get latency/errors, others stay static, metric samples are ignored", () => {
  const r = joinEndpoints(staticEndpoints(graph), [batch], { includeUnbound: true });
  const list = r.rows.find(x => x.id === "ep:list")!;
  assert.equal(list.state, "observed");
  assert.equal(list.origin, "observed");
  assert.equal(list.synthetic, true);
  assert.deepEqual({ ...list.replay!, errorRate: Math.round(list.replay!.errorRate! * 100) },
    { requests: 3, errors: 1, errorRate: 33, p50Ms: 40, p95Ms: 120, maxMs: 120, clipped: 1, traceIds: ["t1", "t2", "t3"] });
  const get = r.rows.find(x => x.id === "ep:get")!;
  assert.equal(get.state, "static");
  assert.equal(get.replay, null);
  assert.equal(get.origin, "static");
  const only = r.rows.filter(x => x.state === "observed-only").map(x => x.name);
  assert.deepEqual(only, ["GET /health", "SELECT orders"]);
  assert.ok(r.holes.some(h => /match no static endpoint/.test(h.reason)));
  assert.deepEqual(r.batches, ["batch-1"]);
});

test("empty replay → static only with a hole note", () => {
  const r = joinEndpoints(staticEndpoints(graph), []);
  assert.ok(r.rows.every(x => x.state === "static" && x.replay === null));
  assert.equal(r.holes.length, 1);
  assert.match(r.holes[0]!.reason, /statically only/);
  assert.equal(r.synthetic, false);
});

test("collectEndpoints scopes to the Location; unbound rows only at project level", () => {
  const file = collectEndpoints(ordersFile, graph, locator, [batch]);
  assert.deepEqual(file.rows.map(x => x.id), ["ep:list", "ep:get"]);
  const top = collectEndpoints(project, graph, locator, [batch]);
  assert.equal(top.rows.filter(x => x.state === "observed-only").length, 2);
  const none = collectEndpoints(ordersFile, null, locator, [batch]);
  assert.equal(none.rows.length, 0);
  assert.match(none.holes[0]!.reason, /lineage graph/);
  const empty = collectEndpoints({ level: "artifact", nodeId: "x.py", artifactKind: "other" }, graph, locator, []);
  assert.ok(empty.holes.some(h => /No API endpoint/.test(h.reason)));
});

test("trace tree: pass for bound spans, replay for unbound, clipped for cut/orphaned, failed flag kept", () => {
  const ids = new Set(["ep:list", "ep:get", "ep:user"]);
  const t1 = buildTraceTree(runs, "t1", ids);
  assert.equal(t1.truncated, false);
  assert.equal(t1.roots.length, 1);
  const root = t1.roots[0]!;
  assert.equal(root.state, "pass");
  assert.deepEqual(root.children.map(c => [c.label, c.state]), [["SELECT orders", "replay"], ["GET /users/{id}", "pass"]]);
  const t2 = buildTraceTree(runs, "t2", ids).roots[0]!;
  assert.equal(t2.state, "pass");
  assert.equal(t2.failed, true);
  assert.equal(t2.httpStatus, 500);
  assert.equal(buildTraceTree(runs, "t3", ids).roots[0]!.state, "clipped");
});

test("trace tree: depth / width / node limits produce pruned nodes with counts", () => {
  const wide: ReplayRunLike[] = [span("w", "r", null, { endpoint: "ep:list" })];
  for (let i = 0; i < 5; i++) wide.push(span("w", `c${i}`, "r", { start: i }));
  wide.push(span("w", "g", "c0", {}));
  const narrow = buildTraceTree(wide, "w", new Set(["ep:list"]), { maxChildren: 2 });
  assert.equal(narrow.truncated, true);
  const kids = narrow.roots[0]!.children;
  assert.deepEqual(kids.map(k => k.state), ["replay", "replay", "pruned"]);
  assert.equal(kids[2]!.prunedCount, 3);
  const shallow = buildTraceTree(wide, "w", new Set(["ep:list"]), { maxDepth: 1 }).roots[0]!;
  assert.deepEqual(shallow.children.map(k => [k.state, k.prunedCount]), [["pruned", 6]]);
  const tiny = buildTraceTree(wide, "w", new Set(["ep:list"]), { maxNodes: 2 }).roots[0]!;
  assert.equal(tiny.children.length, 2);
  assert.deepEqual([tiny.children[1]!.state, tiny.children[1]!.prunedCount], ["pruned", 4]);
});

test("collectEndpointTrace picks the slowest trace through the Location, holes otherwise", () => {
  assert.equal(collectEndpointTrace(project, graph, locator, [batch]).traceId, "t1");
  const users = collectEndpointTrace(usersFile, graph, locator, [batch]);
  assert.equal(users.traceId, "t1");
  assert.equal(users.origin, "observed");
  assert.equal(users.synthetic, true);
  assert.equal(collectEndpointTrace(project, graph, locator, [batch], { traceId: "t2" }).roots[0]!.failed, true);
  assert.match(collectEndpointTrace(project, graph, locator, []).holes[0]!.reason, /No replayed traces/);
  assert.match(collectEndpointTrace(project, graph, locator, [batch], { traceId: "zz" }).holes[0]!.reason, /not in the replay/);
  const noGraph = collectEndpointTrace(project, null, null, [batch]);
  assert.ok(noGraph.roots.length && noGraph.roots[0]!.state === "replay");
  assert.ok(noGraph.holes.some(h => /lineage graph/.test(h.reason)));
});

test("catalog: endpoints pack registered at every level, one style per trace state", () => {
  assert.ok(VIEW_PACKS.includes(ENDPOINTS_PACK));
  assert.ok(BINDING_SOURCES.includes("endpoints") && BINDING_SOURCES.includes("endpoint-trace"));
  assert.deepEqual(ENDPOINTS_PACK.map(e => e.level), [...NAV_LEVELS]);
  assert.deepEqual(ENDPOINTS_PACK[0]!.views.map(v => [v.id, v.layout]), [["endpoints", "table"], ["endpoint-trace", "graph"]]);
  assert.deepEqual(Object.keys(TRACE_NODE_STYLES).sort(), [...TRACE_NODE_STATES].sort());
});
