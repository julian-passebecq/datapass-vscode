import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import {
  APPLICABLE_V1, PlanRejected, SIDECAR_PATH, applyApproved, buildBridgeContext, contextIssues, inspectSidecar, manifestRevision,
  parsePlan, planIssues, projectSummary, readSidecarDocument, reviewPlan, sidecarOutline, type AiPlanV1, type ContextInput, type CurrentState
} from "../src/core/diagramcloud/bridge";
import { applyWithJournal, type JournalFs } from "../src/core/exchange/journal";
import { sha256Bytes } from "../src/core/model/ids";
import { preflight } from "../src/core/capabilities/preflight";
import { CAPABILITY_INDEX } from "../src/core/capabilities/registry";
import type { DataPassProjectManifest } from "../src/core/projectManifestModel";

const ajv = new Ajv2020({ strict: false, validateFormats: false });
const canonicalContext = ajv.compile(JSON.parse(readFileSync("contracts/diagramcloud/datapass-ai-context-v1.schema.json", "utf8")));
const canonicalPlan = ajv.compile(JSON.parse(readFileSync("contracts/diagramcloud/datapass-ai-plan-v1.schema.json", "utf8")));
const sidecarBytes = new Uint8Array(readFileSync("tests/fixtures/diagramcloud/total.sidecar.json"));
const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));

const manifest: DataPassProjectManifest = {
  schemaVersion: 2,
  project: { id: "total-controls", title: "TotalEnergies project controls", profile: "portfolio" },
  repositories: {
    diagramcloud: { path: "C:\\Users\\julia\\repos\\diagramcloud", label: "DiagramCloud", remote: { url: "https://user:ghp_secret123@github.com/x/y.git" } },
    "Oracle Scripts": { path: "/home/julian/oracle" }
  },
  platforms: { fabric: { workspaceId: "11111111-2222-3333-4444-555555555555", workspaceName: "Prod WS" }, oracle: { sshHost: "oracle-prod.internal" } },
  scopes: [{ id: "validate-rows", title: "Validate schedule rows", objective: "SQL checks" }]
};
const manifestBytes = enc(manifest);
const fabricOp = { capability: CAPABILITY_INDEX.get("fabric.eventstream.deploy")!, result: preflight(CAPABILITY_INDEX.get("fabric.eventstream.deploy")!, { tools: new Map(), facts: new Map(), reviewsConfirmed: new Set() }) };
const input = (over: Partial<ContextInput> = {}): ContextInput => ({
  manifest, manifestBytes, scope: manifest.scopes![0]!, implicitScope: false,
  checklist: [
    { key: "validate-rows/run", id: "run-sql", label: "Run SQL quality checks", state: "done", note: "output in C:\\Users\\julia\\Desktop\\out.csv" },
    { key: "validate-rows/fix", id: "fix-dates", label: "Fix inverted dates", state: "problem" }
  ],
  operations: [fabricOp], problems: [], sidecar: inspectSidecar(sidecarBytes), repositoryCommit: "abc1234", generatedAt: "2026-09-24T21:00:00Z", ...over
});

function basePlan(over: Partial<AiPlanV1> = {}): AiPlanV1 {
  return {
    format: "datapass.ai-plan", schemaVersion: 1,
    base: { projectManifestRevision: manifestRevision(manifestBytes), diagramCloudRevision: 0 },
    scope: { id: "validate-rows", type: "workstream" }, summary: "Tighten the SQL task story.",
    operations: [
      { id: "op-title", target: "diagramcloud-document", action: "set-project-metadata", reviewLabel: "Rename the project", payload: { title: "TotalEnergies | controls" } },
      { id: "op-link", target: "diagramcloud-document", action: "link-node-workspace", reviewLabel: "Link Power BI to the controls screen", entityId: "powerbi", payload: { workspaceId: "controls-screen" } },
      { id: "op-item", target: "diagramcloud-document", action: "add-item", reviewLabel: "Add a KPI", payload: { id: "kpi-1" } },
      { id: "op-manifest", target: "project-manifest", action: "add-task", reviewLabel: "Add a task", payload: { title: "x" } }
    ],
    ...over
  };
}
const current = (over: Partial<CurrentState> = {}): CurrentState => ({
  manifestRevision: manifestRevision(manifestBytes), sidecar: inspectSidecar(sidecarBytes), sidecarDocument: readSidecarDocument(sidecarBytes), selectedScopeId: "validate-rows", ...over
});

// ---------------------------------------------------------------- contract conformance

test("runtime validators agree with the canonical contract JSON Schemas", () => {
  const ctx = buildBridgeContext(input());
  const contextCases: unknown[] = [
    ctx,
    { ...ctx, extra: 1 },
    { ...ctx, format: "datapass.context" },
    { ...ctx, base: { projectManifestRevision: "" } },
    { ...ctx, base: { projectManifestRevision: "x", diagramCloudRevision: -1 } },
    { ...ctx, base: { projectManifestRevision: "x", diagramCloudRevision: "" } },
    { ...ctx, diagramCloud: { present: true, revision: "" } },
    { ...ctx, scope: { id: "s", type: "team" } },
    { ...ctx, platforms: [{ id: "p", label: "P", status: "ready" }] },
    { ...ctx, tasks: [{ id: "t", title: "T", status: "doing" }] },
    { ...ctx, repositories: [{ id: "r", label: "R", path: "/x" }] },
    { ...ctx, redactions: undefined }
  ];
  for (const [i, c] of contextCases.entries()) {
    const value = JSON.parse(JSON.stringify(c));
    assert.equal(contextIssues(value).length === 0, canonicalContext(value), `context case ${i}: runtime ${JSON.stringify(contextIssues(value))} vs canonical ${JSON.stringify(canonicalContext.errors)}`);
  }
  const plan = basePlan();
  const planCases: unknown[] = [
    plan,
    { ...plan, base: { projectManifestRevision: "x", diagramCloudRevision: null } },
    { ...plan, base: { projectManifestRevision: "x", diagramCloudRevision: "" } },
    { ...plan, operations: [{ ...plan.operations[0], payload: { accessToken: "x" } }] },
    { ...plan, operations: [{ ...plan.operations[0], payload: { clientSecret: "x" } }] },
    { ...plan, operations: [{ ...plan.operations[0], payload: Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`k${i}`, i])) }] },
    { ...plan, operations: [{ ...plan.operations[0], target: "cloud" }] },
    { ...plan, operations: [{ ...plan.operations[0], action: "delete-everything" }] },
    { ...plan, operations: [{ ...plan.operations[0], payload: [] }] },
    { ...plan, operations: [{ ...plan.operations[0], extra: true }] },
    { ...plan, summary: "" },
    { ...plan, format: "datapass.ai-context" },
    { ...plan, notes: "n".repeat(6001) }
  ];
  for (const [i, c] of planCases.entries()) {
    const value = JSON.parse(JSON.stringify(c));
    assert.equal(planIssues(value).length === 0, canonicalPlan(value), `plan case ${i}: runtime ${JSON.stringify(planIssues(value))} vs canonical ${JSON.stringify(canonicalPlan.errors)}`);
  }
});

// ---------------------------------------------------------------- sidecar

test("sidecar detection reads identity and revision only, and reports unreadable files", () => {
  assert.deepEqual(inspectSidecar(undefined), { present: false });
  const ok = inspectSidecar(sidecarBytes);
  assert.ok(ok.present && ok.ok);
  assert.equal(ok.documentId, "total-project-controls");
  assert.equal(ok.revision, 0);
  assert.equal(ok.hash, sha256Bytes(sidecarBytes).value);
  const broken = inspectSidecar(enc("{\"schemaVersion\":1,\"id\":\"Bad Id\",\"title\":\"x\"}"));
  assert.ok(broken.present && !broken.ok && /not a DiagramCloud id/.test(broken.error));
  const dup = inspectSidecar(enc("{\"schemaVersion\":1,\"id\":\"a\",\"id\":\"b\",\"title\":\"x\"}"));
  assert.ok(dup.present && !dup.ok, "duplicate keys are rejected by the strict parser");
});

// ---------------------------------------------------------------- AI context

test("AI context is contract-valid and carries no paths, URLs, hosts or binding values", () => {
  const ctx = buildBridgeContext(input());
  assert.ok(canonicalContext(ctx), JSON.stringify(canonicalContext.errors));
  const text = JSON.stringify(ctx);
  for (const leaked of ["julia", "julian", "ghp_secret123", "github.com/x", "oracle-prod.internal", "11111111-2222", "Prod WS", "out.csv"]) assert.ok(!text.includes(leaked), `leaked ${leaked}`);
  assert.equal(ctx.base.diagramCloudRevision, 0);
  assert.deepEqual(ctx.diagramCloud, { present: true, documentPath: SIDECAR_PATH, documentId: "total-project-controls", revision: 0 });
  assert.deepEqual(ctx.repositories.map(r => r.id), ["diagramcloud", "oracle-scripts"]);
  assert.deepEqual(ctx.platforms.map(p => [p.id, p.evidence]), [["fabric", "declared"], ["oracle", "declared"]]);
  assert.equal(ctx.platforms[0]!.status, "attention");
  assert.deepEqual(ctx.tasks.map(t => t.status), ["done", "blocked"]);
  assert.match(ctx.tasks[0]!.summary!, /User-reported.*<local-path>/);
});

test("AI context without a sidecar reports it absent with a null revision", () => {
  const ctx = buildBridgeContext(input({ sidecar: { present: false }, implicitScope: true }));
  assert.ok(canonicalContext(ctx));
  assert.equal(ctx.base.diagramCloudRevision, null);
  assert.deepEqual(ctx.diagramCloud, { present: false, documentPath: SIDECAR_PATH, revision: null });
  assert.equal(ctx.scope.type, "project");
  assert.match(projectSummary(ctx, { present: false }), /no \.datapass\/diagramcloud\.json yet/);
});

// ---------------------------------------------------------------- AI plan

test("plan parsing rejects invalid JSON, schema violations and secret-shaped payload keys", () => {
  assert.throws(() => parsePlan("{not json"), PlanRejected);
  assert.throws(() => parsePlan(enc({ ...basePlan(), operations: [{ ...basePlan().operations[0], payload: { apiToken: "x" } }] })), (e: unknown) => e instanceof PlanRejected && e.details.some(d => /secret-shaped/.test(d)));
  assert.throws(() => parsePlan(enc({ ...basePlan(), extra: 1 })), PlanRejected);
  assert.equal(parsePlan(enc(basePlan())).operations.length, 4);
});

test("review marks only V1 actions with valid payloads as applicable", () => {
  const review = reviewPlan(basePlan(), current());
  assert.deepEqual(review.conflicts, []);
  assert.deepEqual(review.operations.map(r => [r.op.id, r.applicable]), [["op-title", true], ["op-link", true], ["op-item", false], ["op-manifest", false]]);
  assert.match(review.operations[2]!.reason, /no V1 payload shape/);
  assert.match(review.operations[3]!.reason, /not applied from AI plans in V1/);
  assert.deepEqual(Object.keys(APPLICABLE_V1), ["set-project-metadata", "link-node-workspace"]);
  const bad = reviewPlan(basePlan({ operations: [
    { id: "a", target: "diagramcloud-document", action: "link-node-workspace", reviewLabel: "x", entityId: "ghost", payload: { workspaceId: "controls-screen" } },
    { id: "b", target: "diagramcloud-document", action: "link-node-workspace", reviewLabel: "x", entityId: "powerbi", payload: { workspaceId: "ghost-screen" } },
    { id: "c", target: "diagramcloud-document", action: "set-project-metadata", reviewLabel: "x", payload: { title: "ok", rootViewId: "x" } },
    { id: "d", target: "diagramcloud-document", action: "set-project-metadata", reviewLabel: "x", payload: { title: "t".repeat(161) } }
  ] }), current());
  assert.ok(bad.operations.every(r => !r.applicable), JSON.stringify(bad.operations.map(r => r.reason)));
});

test("review reports revision conflicts for a changed manifest, a changed sidecar or a missing sidecar", () => {
  assert.match(reviewPlan(basePlan(), current({ manifestRevision: manifestRevision(enc("{}")) })).conflicts.join(), /manifest changed/);
  assert.match(reviewPlan(basePlan({ base: { projectManifestRevision: manifestRevision(manifestBytes), diagramCloudRevision: 3 } }), current()).conflicts.join(), /revision 0.*revision 3/);
  assert.match(reviewPlan(basePlan(), current({ sidecar: { present: false }, sidecarDocument: undefined })).conflicts.join(), /revision none.*revision 0/);
  const dup = basePlan(); dup.operations.push({ ...dup.operations[0]! });
  assert.match(reviewPlan(dup, current()).conflicts.join(), /Duplicate operation id/);
  assert.match(reviewPlan(basePlan({ scope: { id: "other", type: "task" } }), current()).warnings.join(), /targets scope "other"/);
});

test("apply writes only approved operations, bumps the revision once and keeps everything else", () => {
  const review = reviewPlan(basePlan(), current());
  const out = applyApproved(sidecarBytes, review, new Set(["op-link"]));
  assert.equal(out.revision, 1);
  assert.deepEqual(out.applied, ["op-link"]);
  const before = JSON.parse(new TextDecoder().decode(sidecarBytes)), after = JSON.parse(new TextDecoder().decode(out.bytes));
  assert.equal(after.title, before.title, "unapproved title change must not be applied");
  assert.equal(after.nodes.find((n: { id: string }) => n.id === "powerbi").experienceWorkspaceId, "controls-screen");
  assert.equal(after.revision, 1);
  delete after.nodes.find((n: { id: string }) => n.id === "powerbi").experienceWorkspaceId; after.revision = before.revision;
  assert.deepEqual(after, before);
  assert.ok(new TextDecoder().decode(out.bytes).endsWith("}\n"));
  const both = applyApproved(sidecarBytes, review, new Set(["op-title", "op-link"]));
  assert.equal(JSON.parse(new TextDecoder().decode(both.bytes)).title, "TotalEnergies | controls");
  assert.equal(both.revision, 1);
});

test("apply refuses conflicts, non-applicable approvals and an empty approval", () => {
  const review = reviewPlan(basePlan(), current());
  assert.throws(() => applyApproved(sidecarBytes, review, new Set(["op-item"])), /cannot be applied/);
  assert.throws(() => applyApproved(sidecarBytes, review, new Set()), /No operation was approved/);
  const conflicted = reviewPlan(basePlan(), current({ manifestRevision: "sha256:other" }));
  assert.throws(() => applyApproved(sidecarBytes, conflicted, new Set(["op-title"])), PlanRejected);
});

test("the journaled write refuses a sidecar that changed between review and apply", async () => {
  const files = new Map<string, Uint8Array>([[SIDECAR_PATH, sidecarBytes]]);
  const fs: JournalFs = { read: async p => files.get(p), write: async (p, b) => { files.set(p, b); }, remove: async p => { files.delete(p); } };
  const review = reviewPlan(basePlan(), current());
  const out = applyApproved(sidecarBytes, review, new Set(["op-title"]));
  const edited = enc(new TextDecoder().decode(sidecarBytes).replace("\"revision\": 0", "\"revision\": 5"));
  files.set(SIDECAR_PATH, edited); // DiagramCloud saved meanwhile
  await assert.rejects(applyWithJournal(fs, ".datapass/local/journal/t.json", "t", "2026-09-24T21:00:00Z", [{ target: SIDECAR_PATH, bytes: out.bytes, expectedBaseHash: sha256Bytes(sidecarBytes).value }]), /Base changed since review/);
  assert.equal(files.get(SIDECAR_PATH), edited);
  files.set(SIDECAR_PATH, sidecarBytes);
  await applyWithJournal(fs, ".datapass/local/journal/t.json", "t", "2026-09-24T21:00:00Z", [{ target: SIDECAR_PATH, bytes: out.bytes, expectedBaseHash: sha256Bytes(sidecarBytes).value }]);
  assert.equal(inspectSidecar(files.get(SIDECAR_PATH)).present && (inspectSidecar(files.get(SIDECAR_PATH)) as { revision: number }).revision, 1);
});

test("applied bytes equal DiagramCloud's own serialization of the result (golden file from DiagramCloud)", () => {
  const plan = basePlan({ base: { projectManifestRevision: manifestRevision(manifestBytes), diagramCloudRevision: 0 }, operations: [
    { id: "a", target: "diagramcloud-document", action: "set-project-metadata", reviewLabel: "r", payload: { title: "Renamed by plan", summary: "New summary" } },
    { id: "b", target: "diagramcloud-document", action: "link-node-workspace", reviewLabel: "r", entityId: "powerbi", payload: { workspaceId: "controls-screen" } }
  ] });
  const out = applyApproved(sidecarBytes, reviewPlan(plan, current()), new Set(["a", "b"]));
  assert.equal(new TextDecoder().decode(out.bytes), readFileSync("tests/fixtures/diagramcloud/total.after-plan.sidecar.json", "utf8"));
});

test("the outline for AI instructions carries only node/workspace IDs and titles", () => {
  const outline = sidecarOutline(readSidecarDocument(sidecarBytes));
  assert.ok(outline.nodes.some(n => n.id === "powerbi"));
  assert.deepEqual(outline.workspaces.map(w => w.id), ["controls-screen", "quality-screen", "foil-screen", "manifest-screen", "galaxy-screen", "remix-screen"]);
  const text = JSON.stringify(outline);
  assert.ok(!text.includes("SELECT") && !text.includes("data:image"), "no code or embedded images");
});
