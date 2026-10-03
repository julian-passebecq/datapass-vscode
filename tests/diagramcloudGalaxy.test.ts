import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  GALAXY_DIAGRAMCLOUD_CONTRACTS,
  diagramCloudRealizationSnapshot,
  galaxyEntityId
} from "../src/core/diagramcloud/galaxyPublication";
import { DIAGRAMCLOUD_DEEP_LINK_ROUTE, resolveDiagramCloudDeepLink } from "../src/core/diagramcloud/galaxyLink";

const producerRevision = "58f7d2da51647c261c2b000416751ad570f64e32";

const build = () => diagramCloudRealizationSnapshot({
  snapshotId: "datapass-total-checks-20261003",
  productVersion: "1.1.0-rc.1",
  producerRevision,
  createdAt: "2026-10-03T01:30:00Z",
  reviewedAt: "2026-10-03T01:31:00Z",
  reviewedBy: "datapass-contract-test",
  humanConfirmed: true,
  intendedVisibility: "internal",
  projectId: "total-project-controls",
  projectTitle: "TotalEnergies project controls",
  projectRevision: 0,
  nodeId: "checks",
  nodeLabel: "SQL quality checks",
  claimId: "datapass-observed-checks-20261003",
  claim: "observed",
  observedAt: "2026-10-03T01:29:00Z",
  authority: "DataPass repository bridge",
  summary: "DataPass can identify the DiagramCloud SQL quality checks component at the recorded repository revision.",
  caveat: "This is contract interoperability evidence, not a runtime or production deployment verification.",
  evidence: {
    evidenceId: "galaxy:datapass_vscode:evidence:bridge-code-58f7d2d",
    kind: "repo_commit",
    sourceSystem: "github",
    locator: {
      repository: "julian-passebecq/datapass-vscode",
      commit: producerRevision,
      path: "src/core/diagramcloud/galaxyPublication.ts"
    },
    capturedAt: "2026-10-03T01:29:00Z",
    observedRevision: producerRevision,
    visibility: "internal",
    synthetic: false,
    reviewState: "reviewed",
    notes: "Cross-app V1G contract fixture; not a runtime/deployment claim."
  }
});

test("DataPass produces the pinned DiagramCloud Galaxy PublicationSnapshot fixture", () => {
  const expected = JSON.parse(readFileSync("tests/fixtures/diagramcloud/datapass-publication-snapshot.json", "utf8"));
  assert.deepEqual(build(), expected);
});

test("Galaxy identity points to DiagramCloud-owned stable project/node IDs", () => {
  const out = build();
  assert.equal(out.subject.entity_id, galaxyEntityId("diagramcloud", "project", "total-project-controls"));
  assert.equal(out.entities[1]!.entity_id, galaxyEntityId("diagramcloud", "node", "checks"));
  assert.equal(out.entities[1]!.owner_app, "diagramcloud");
  assert.equal(out.realization_claims[0]!.producer_app, "datapass_vscode");
  assert.deepEqual(out.contract_versions, [...GALAXY_DIAGRAMCLOUD_CONTRACTS]);
});

test("DataPass cannot publish a public snapshot without explicit human confirmation", () => {
  assert.throws(() => diagramCloudRealizationSnapshot({
    snapshotId: "public-refused",
    productVersion: "1.1.0-rc.1",
    producerRevision,
    createdAt: "2026-10-03T01:30:00Z",
    reviewedAt: "2026-10-03T01:31:00Z",
    humanConfirmed: false,
    intendedVisibility: "public",
    projectId: "total-project-controls",
    projectTitle: "TotalEnergies project controls",
    projectRevision: 0,
    nodeId: "checks",
    nodeLabel: "SQL quality checks",
    claimId: "claim",
    claim: "observed",
    observedAt: "2026-10-03T01:29:00Z",
    authority: "DataPass repository bridge",
    summary: "Observed mapping.",
    evidence: {
      evidenceId: "evidence",
      kind: "repo_commit",
      sourceSystem: "github",
      locator: { repository: "julian-passebecq/datapass-vscode" },
      capturedAt: "2026-10-03T01:29:00Z",
      visibility: "internal",
      synthetic: false,
      reviewState: "reviewed"
    }
  }), /public snapshot requires human confirmation/);
});


test("public snapshots cannot carry internal evidence even after human confirmation", () => {
  assert.throws(() => diagramCloudRealizationSnapshot({
    snapshotId: "public-private-evidence",
    productVersion: "1.1.0-rc.1",
    producerRevision,
    createdAt: "2026-10-03T01:30:00Z",
    reviewedAt: "2026-10-03T01:31:00Z",
    humanConfirmed: true,
    intendedVisibility: "public",
    projectId: "total-project-controls",
    projectTitle: "TotalEnergies project controls",
    projectRevision: 0,
    nodeId: "checks",
    nodeLabel: "SQL quality checks",
    claimId: "claim-public",
    claim: "observed",
    observedAt: "2026-10-03T01:29:00Z",
    authority: "DataPass repository bridge",
    summary: "Observed mapping.",
    evidence: {
      evidenceId: "galaxy:datapass_vscode:evidence:internal",
      kind: "repo_commit",
      sourceSystem: "github",
      locator: { repository: "julian-passebecq/datapass-vscode" },
      capturedAt: "2026-10-03T01:29:00Z",
      visibility: "internal",
      synthetic: false,
      reviewState: "reviewed"
    }
  }), /public snapshot cannot include non-public evidence/);
});

test("verified claims refuse synthetic evidence and links refuse embedded credentials", () => {
  const common = {
    snapshotId: "guarded",
    productVersion: "1.1.0-rc.1",
    producerRevision,
    createdAt: "2026-10-03T01:30:00Z",
    reviewedAt: "2026-10-03T01:31:00Z",
    humanConfirmed: true,
    intendedVisibility: "internal" as const,
    projectId: "total-project-controls",
    projectTitle: "TotalEnergies project controls",
    projectRevision: 0,
    nodeId: "checks",
    nodeLabel: "SQL quality checks",
    claimId: "claim-guarded",
    observedAt: "2026-10-03T01:29:00Z",
    authority: "DataPass repository bridge",
    summary: "Observed mapping.",
    evidence: {
      evidenceId: "galaxy:datapass_vscode:evidence:synthetic",
      kind: "test_run" as const,
      sourceSystem: "ci" as const,
      locator: { run_id: "42" },
      capturedAt: "2026-10-03T01:29:00Z",
      visibility: "internal" as const,
      synthetic: true,
      reviewState: "reviewed" as const
    }
  };
  assert.throws(() => diagramCloudRealizationSnapshot({ ...common, claim: "verified" }), /synthetic evidence cannot back a verified claim/);
  assert.throws(() => diagramCloudRealizationSnapshot({ ...common, claim: "observed", evidence: { ...common.evidence, synthetic: false }, openUri: "https://user:pw@example.com/run" }), /without embedded credentials/);
});


test("DataPass resolves the registered DiagramCloud project/view/node deep-link route", () => {
  assert.equal(DIAGRAMCLOUD_DEEP_LINK_ROUTE.route_id, "diagramcloud.project-view-node/1");
  assert.equal(
    resolveDiagramCloudDeepLink("https://diagramcloud.example/app/?old=1#x", { project: "total-project-controls", view: "validation", node: "checks" }),
    "https://diagramcloud.example/app/?project=total-project-controls&view=validation&node=checks"
  );
  assert.equal(
    resolveDiagramCloudDeepLink("https://diagramcloud.example", { project: "total-project-controls" }),
    "https://diagramcloud.example/?project=total-project-controls"
  );
  assert.throws(() => resolveDiagramCloudDeepLink("https://diagramcloud.example", { project: "<script>" }), /stable ID/);
  assert.throws(() => resolveDiagramCloudDeepLink("https://user:pw@diagramcloud.example", { project: "total-project-controls" }), /without embedded credentials/);
});
