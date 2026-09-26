import assert from "node:assert/strict";
import test from "node:test";
import { prepareBrief, assessBriefTrust, assessOutputManifest, type LocalApproval } from "../src/core/publication/brief";
import { validateQuerySpec, bindParameters, querySpecHash, type QuerySpec } from "../src/core/authority/querySpec";
import { describeSnapshot } from "../src/core/authority/snapshot";
import { analyzePbip } from "../src/core/powerbi/pbipGraph";
import { projectToDiagramCloud } from "../src/core/diagramcloud/projection";
import { canonicalJson } from "../src/core/model/canonical";
import { sha256Bytes } from "../src/core/model/ids";
import type { BriefClaim, SourceRef } from "../src/core/contracts/envelopes";
import { validateDocument } from "./fixtures/diagramcloud/model";

const H = sha256Bytes("fixture");
const T = "2026-09-24T00:00:00Z";
const base = { scopeRevision: "r1", manifestHash: H, repositories: [] };
const src = (id: string, classification: SourceRef["classification"]): SourceRef => ({ id, authority: "synthetic", recordRef: id, revision: "1", observedAt: T, classification, snapshotHash: H });
const claim = (id: string, over: Partial<BriefClaim> = {}): BriefClaim => ({ id, statement: `Claim ${id}`, basis: "model-output", sourceRefs: ["s-public"], review: "approved", limitations: ["Model output, not measured"], allowedAudiences: ["public", "internal"], ...over });

test("public brief excludes internal/confidential sources instead of guessing a redaction", () => {
  const r = prepareBrief({ id: "brief-1", projectRef: "p", scopeRef: "s", base, createdAt: T, audience: "public", purpose: "Website", outputFormats: ["web"],
    sources: [src("s-public", "public"), src("s-internal", "internal"), src("s-conf", "confidential")],
    claims: [claim("ok"), claim("int", { sourceRefs: ["s-internal"] }), claim("conf", { sourceRefs: ["s-conf"], allowedAudiences: ["public"] }),
      claim("rej", { review: "rejected" }), claim("notpub", { allowedAudiences: ["internal"] })], assetRefs: [] });
  assert.deepEqual(r.envelope.payload.claims.map(c => c.id), ["ok"]);
  assert.deepEqual(r.excluded.map(e => e.claimId).sort(), ["conf", "int", "notpub", "rej"]);
  assert.ok(r.excluded.find(e => e.claimId === "conf")!.reason.includes("sanitized source projection"));
  assert.equal(r.envelope.payload.claims[0]!.statement, "Claim ok", "statements are never rewritten");
  assert.equal(r.envelope.payload.publication, "not-authorized");
  assert.deepEqual(r.envelope.sources.map(s => s.id), ["s-public"]);
});

test("an imported 'reviewed-for-generation' label is a claim; only a local approval of the exact bytes grants it", () => {
  const r = prepareBrief({ id: "brief-2", projectRef: "p", scopeRef: "s", base, createdAt: T, audience: "internal", purpose: "Review", outputFormats: ["pptx"], sources: [src("s-public", "public")], claims: [claim("a")], assetRefs: [] });
  const doc = JSON.parse(new TextDecoder().decode(r.bytes));
  doc.payload.releaseState = "reviewed-for-generation";
  const forged = new TextEncoder().encode(JSON.stringify(doc));
  assert.equal(assessBriefTrust(forged, []).state, "claimed-not-granted");
  const approval: LocalApproval = { subjectDigest: sha256Bytes(forged).value, audience: "internal", scope: "generation", approvedBy: "local-user", approvedAt: T };
  assert.equal(assessBriefTrust(forged, [approval]).state, "approved-for-generation");
  assert.equal(assessBriefTrust(forged, [{ ...approval, audience: "public" }]).state, "claimed-not-granted");
});

test("PPTX output manifest is 'received, not approved' and foreign claims quarantine it", () => {
  const r = prepareBrief({ id: "brief-3", projectRef: "p", scopeRef: "s", base, createdAt: T, audience: "internal", purpose: "Deck", outputFormats: ["pptx"], sources: [src("s-public", "public")], claims: [claim("a"), claim("b")], assetRefs: [] });
  const deck = new TextEncoder().encode("PPTX-BYTES");
  const manifest = { format: "datapass.output-manifest", briefHash: r.digest, generator: "external-ai", includedClaimIds: ["a"], outputs: [{ file: "deck.pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", byteHash: sha256Bytes(deck) }], omissions: [] };
  const ok = assessOutputManifest(r.bytes, JSON.stringify(manifest), new Map([["deck.pptx", deck]]));
  assert.equal(ok.status, "received-not-approved");
  assert.ok(ok.warnings.some(w => /b/.test(w)));
  assert.equal(assessOutputManifest(r.bytes, JSON.stringify({ ...manifest, includedClaimIds: ["a", "invented"] }), new Map()).status, "quarantined");
  assert.equal(assessOutputManifest(r.bytes, JSON.stringify({ ...manifest, briefHash: H }), new Map()).status, "quarantined");
});

const spec: QuerySpec = {
  format: "datapass.query-spec", version: "0.1-draft", id: "study-claims", revision: "1", purpose: "Study claims for one experiment", owner: "PM",
  sourceBinding: "foil-core", database: "core", collection: "study_claims", operation: "find",
  filter: { experimentId: { $param: "experiment" }, status: "accepted" }, projection: { _id: 1, claim: 1, source: 1 }, sort: { _id: 1 },
  limit: 50, maxTimeMS: 5000, maxBytes: 262144, parameters: [{ name: "experiment", type: "string" }], sensitivity: "internal"
};

test("QuerySpec: bounded find is accepted; write stages, JS and wildcards are rejected", () => {
  assert.deepEqual(validateQuerySpec(spec).issues, []);
  const bad = (over: Partial<QuerySpec> | Record<string, unknown>) => validateQuerySpec({ ...spec, ...over }).issues.length > 0;
  assert.ok(bad({ filter: { $where: "this.a > 1" } }));
  assert.ok(bad({ operation: "aggregate", pipeline: [{ $match: {} }, { $out: "x" }] }));
  assert.ok(bad({ operation: "aggregate", pipeline: [{ $merge: { into: "x" } }] }));
  assert.ok(bad({ operation: "aggregate", pipeline: [{ $group: { _id: null, x: { $accumulator: {} } } }] }));
  assert.ok(bad({ operation: "aggregate", pipeline: [{ $lookup: { from: "x", pipeline: [] } }] }));
  assert.ok(bad({ filter: { $expr: { $function: { body: "return 1" } } } }));
  assert.ok(bad({ collection: "*" }));
  assert.ok(bad({ projection: {} }));
  assert.ok(bad({ limit: 100000 }));
  assert.ok(bad({ filter: { a: { $param: "undeclared" } } }));
  assert.ok(bad({ eval: "db.dropDatabase()" }));
});

test("QuerySpec parameters are bound structurally and type-checked", () => {
  assert.deepEqual(bindParameters(spec, { experiment: "exp-1" }).filter, { experimentId: "exp-1", status: "accepted" });
  assert.throws(() => bindParameters(spec, { experiment: 5 }), /must be string/);
  assert.throws(() => bindParameters(spec, { other: "x" }), /Unknown parameter/);
  assert.equal(querySpecHash(spec).canonicalization, "datapass-sorted-json-v1");
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
});

test("snapshot presentation never turns an error into an empty success", () => {
  const env = (state: string, recordRefs: string[], asOf = T, omissions: string[] = []) => ({
    format: "datapass.authority-snapshot", contractVersion: "0.1-draft", id: "snap", projectRef: "p", scopeRef: "s", base, classification: "internal", createdAt: T, sources: [],
    payload: { querySpecRef: "q", querySpecHash: H, asOf, state, recordRefs, omissions, nextCursorAvailable: false, encoding: "mongodb-canonical-ejson", dataArtifactRef: null }
  }) as any;
  const now = new Date("2026-09-24T02:00:00Z");
  assert.equal(describeSnapshot(env("error", []), now).state, "error");
  assert.equal(describeSnapshot(env("error", []), now).usableAsContext, false);
  assert.equal(describeSnapshot(env("not-authorized", []), now).state, "not-authorized");
  assert.equal(describeSnapshot(env("empty", []), now).state, "empty");
  assert.equal(describeSnapshot(env("partial", ["a"], T, ["x"]), now).state, "partial");
  assert.equal(describeSnapshot(env("complete", ["a"], "2026-08-01T00:00:00Z"), now).state, "stale");
  assert.equal(describeSnapshot(env("complete", ["a"]), now, { knownQueryHashes: new Set(["0".repeat(64)]) }).state, "unverified-query");
});

test("PBIP graph separates project, report and semantic model and reports broken bindings", async () => {
  const files = [
    "Sales.pbip", "Sales.Report/definition.pbir", "Sales.Report/definition/report.json", "Sales.Report/definition/version.json",
    "Sales.Report/definition/pages/p1/page.json", "Sales.Report/definition/pages/p2/page.json",
    "Sales.SemanticModel/definition.pbism", "Sales.SemanticModel/definition/model.tmdl", "Sales.SemanticModel/definition/tables/Orders.tmdl",
    "Sales.SemanticModel/definition/tables/Date.tmdl",
    "Old.Report/definition.pbir", "Old.Report/report.json"
  ];
  const json: Record<string, string> = {
    "Sales.pbip": JSON.stringify({ version: "1.0", artifacts: [{ report: { path: "Sales.Report" } }] }),
    "Sales.Report/definition.pbir": JSON.stringify({ version: "4.0", datasetReference: { byPath: { path: "../Sales.SemanticModel" }, byConnection: null } }),
    "Old.Report/definition.pbir": JSON.stringify({ version: "1.0", datasetReference: { byPath: { path: "../Gone.SemanticModel" } } })
  };
  const g = await analyzePbip(files, async p => json[p]);
  assert.deepEqual(g.entries, [{ pbip: "Sales.pbip", reports: ["Sales.Report"] }]);
  const sales = g.reports.find(r => r.folder === "Sales.Report")!;
  assert.equal(sales.format, "pbir");
  assert.equal(sales.pageCount, 2);
  assert.deepEqual(sales.datasetBinding, { kind: "byPath", semanticModelFolder: "Sales.SemanticModel", exists: true });
  assert.equal(g.reports.find(r => r.folder === "Old.Report")!.format, "pbir-legacy");
  const model = g.semanticModels[0]!;
  assert.equal(model.format, "tmdl");
  assert.deepEqual(model.tables, ["Date", "Orders"]);
  assert.deepEqual(model.consumers, ["Sales.Report"]);
  assert.ok(g.issues.some(i => /Gone.SemanticModel/.test(i)));
});

const items = [
  { id: "oracle-sim", kind: "application", label: "Oracle simulation", classification: "public" },
  { id: "event-hubs", kind: "resource", label: "Event Hubs", classification: "public" },
  { id: "eventhouse", kind: "dataset", label: "Eventhouse", classification: "internal" },
  { id: "budget-model", kind: "model", label: "Unit budget model", classification: "confidential" },
  { id: "unlabelled", kind: "study", label: "Study notes" }
] as any[];
const relations = [
  { id: "r1", source: "oracle-sim", target: "event-hubs", relation: "produces" },
  { id: "r2", source: "event-hubs", target: "eventhouse", relation: "consumes" },
  { id: "r3", source: "eventhouse", target: "oracle-sim", relation: "observedBy" },
  { id: "r4", source: "budget-model", target: "eventhouse", relation: "uses" }
] as any[];

test("DiagramCloud public projection contains only public elements and passes the real DiagramCloud validator", () => {
  const { document, sidecar } = projectToDiagramCloud({ documentId: "foil-r0", title: "FOIL R0", audience: "public", items, relations, semanticRevision: "sem-1", layoutRevision: "lay-1", streamRelations: new Set(["r1"]) });
  assert.doesNotThrow(() => validateDocument(document));
  assert.deepEqual(document.nodes.map(n => n.id), ["oracle-sim", "event-hubs"]);
  assert.ok(document.nodes.every(n => n.visibility === "public" && n.status === "idle"));
  assert.equal(document.edges.find(e => e.id === "r1")!.kind, "stream");
  assert.ok(sidecar.omitted.some(o => o.ref === "budget-model"));
  assert.ok(sidecar.omitted.some(o => o.ref === "unlabelled" && /unclassified/.test(o.reason)));
  assert.ok(!JSON.stringify(document).includes("Unit budget"));
  assert.ok(!JSON.stringify(document).includes("sem-1"), "semantic revision stays in the sidecar");
  assert.equal(sidecar.publication, "not-authorized");
});

test("DiagramCloud internal projection keeps a public root, a private view, allows data-flow cycles, and still validates", () => {
  const { document, sidecar } = projectToDiagramCloud({ documentId: "foil-r0-internal", title: "FOIL R0", audience: "internal", items, relations, semanticRevision: "s", layoutRevision: "l" });
  assert.doesNotThrow(() => validateDocument(document));
  assert.equal(document.views.find(v => v.id === document.rootViewId)!.visibility, "public");
  assert.ok(document.views.find(v => v.id === "internal")!.nodeIds.includes("eventhouse"));
  assert.ok(!document.nodes.some(n => n.id === "budget-model"), "confidential never leaves, even internally");
  assert.ok(sidecar.lossReport.some(l => /must not be uploaded publicly/.test(l)));
  const ids = new Set(document.edges.map(e => e.id));
  assert.ok(ids.has("r2") && ids.has("r3"), "feedback loop preserved");
});
