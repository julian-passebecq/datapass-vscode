import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  GALAXY_DIAGRAMCLOUD_CONTRACTS,
  diagramCloudRealizationSnapshot,
  galaxyEntityId
} from "../src/core/diagramcloud/galaxyPublication";

const producerRevision = "1c8dc4ac796687cb7ede4d8acaf4d2717bc0446c";

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
    evidenceId: "galaxy:datapass-vscode:evidence:bridge-code-1c8dc4a",
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
  assert.equal(out.realization_claims[0]!.producer_app, "datapass-vscode");
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
