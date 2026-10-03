import { ID_PATTERN } from "../model/ids";

export const GALAXY_DIAGRAMCLOUD_CONTRACTS = [
  "galaxy.entity/1",
  "galaxy.evidence-ref/1",
  "galaxy.version-handshake/1",
  "galaxy.publication-snapshot/1",
  "galaxy.deep-link/1"
] as const;

export type GalaxyRealizationState = "observed" | "verified" | "partial" | "not_observed";

export interface GalaxyEntityV1 {
  schema_version: 1;
  entity_id: string;
  owner_app: string;
  entity_type: string;
  local_id: string;
  revision?: string;
  display_name?: string;
  aliases: string[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface GalaxyEvidenceRefV1 {
  schema_version: 1;
  evidence_id: string;
  kind: "repo_commit" | "pipeline" | "test_run" | "runtime_receipt" | "document" | "file" | "url" | "manual_observation" | "screenshot" | "dataset_snapshot" | "other";
  source_system: "github" | "gitlab" | "atlas" | "filesystem" | "drive" | "ci" | "runtime" | "manual" | "other";
  locator: Record<string, string | number | boolean | null | string[]>;
  captured_at: string;
  observed_revision?: string;
  integrity?: string;
  visibility: "public" | "internal" | "private";
  synthetic: boolean;
  review_state: "unreviewed" | "reviewed" | "qualified";
  qualification_level?: "DECLARED" | "IMPLEMENTED" | "BUILD_VERIFIED" | "PACKAGE_VERIFIED" | "E2E_VERIFIED" | "MANUAL_QUALIFIED" | "GALAXY_QUALIFIED";
  producer_app?: string;
  notes?: string;
}

export interface GalaxyPublicationSnapshotV1 {
  schema_version: 1;
  snapshot_id: string;
  producer: { app_id: "datapass_vscode"; product_version?: string; source_revision?: string };
  subject: GalaxyEntityV1;
  created_at: string;
  review: {
    state: "reviewed";
    reviewed_at: string;
    reviewed_by?: string;
    human_confirmed: boolean;
    intended_visibility: "public" | "internal";
  };
  entities: Array<GalaxyEntityV1 & { label: string; summary?: string; kind?: string; visibility: "public" | "internal" }>;
  relationships: Array<{
    relationship_id?: string;
    from_entity_id: string;
    to_entity_id: string;
    type: string;
    evidence_ref_ids: string[];
  }>;
  evidence_refs: GalaxyEvidenceRefV1[];
  realization_claims: Array<{
    claim_id: string;
    subject_entity_id: string;
    state: GalaxyRealizationState;
    observed_at?: string;
    producer_app?: "datapass_vscode";
    authority?: string;
    summary: string;
    caveat?: string;
    open_uri?: string;
    evidence_ref_ids: string[];
    review_state: "unreviewed" | "reviewed" | "qualified";
  }>;
  contract_versions: string[];
}

export const galaxyEntityId = (ownerApp: string, entityType: string, localId: string): string =>
  `galaxy:${ownerApp}:${entityType}:${encodeURIComponent(localId)}`;

const assertDiagramCloudId = (value: string, label: string): void => {
  if (!ID_PATTERN.test(value)) throw new Error(`${label} must be a DiagramCloud stable ID`);
};

const iso = (value: string, label: string): string => {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error(`${label} must be an ISO timestamp with timezone`);
  return new Date(time).toISOString();
};

const assertOpenUri = (value: string): void => {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("openUri must be an http(s) or vscode URI"); }
  if (!["http:", "https:", "vscode:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("openUri must be an http(s) or vscode URI without embedded credentials");
  }
};

const diagramEntity = (type: "project" | "node", localId: string, revision: string, label: string): GalaxyEntityV1 => {
  assertDiagramCloudId(localId, type);
  return {
    schema_version: 1,
    entity_id: galaxyEntityId("diagramcloud", type, localId),
    owner_app: "diagramcloud",
    entity_type: type,
    local_id: localId,
    revision,
    display_name: label,
    aliases: [],
    metadata: {}
  };
};

/**
 * DataPass -> DiagramCloud V1G realization handoff.
 *
 * DataPass does not author DiagramCloud review state. It publishes a reviewed source-side snapshot.
 * DiagramCloud then stages the claim through its own revision-guarded patch + human review lifecycle.
 */
export function diagramCloudRealizationSnapshot(input: {
  snapshotId: string;
  productVersion: string;
  producerRevision: string;
  createdAt: string;
  reviewedAt: string;
  reviewedBy?: string;
  humanConfirmed: boolean;
  intendedVisibility: "public" | "internal";
  projectId: string;
  projectTitle: string;
  projectRevision: number | string;
  nodeId: string;
  nodeLabel: string;
  claimId: string;
  claim: GalaxyRealizationState;
  observedAt: string;
  authority: string;
  summary: string;
  caveat?: string;
  openUri?: string;
  evidence: {
    evidenceId: string;
    kind: GalaxyEvidenceRefV1["kind"];
    sourceSystem: GalaxyEvidenceRefV1["source_system"];
    locator: GalaxyEvidenceRefV1["locator"];
    capturedAt: string;
    observedRevision?: string;
    integrity?: string;
    visibility: GalaxyEvidenceRefV1["visibility"];
    synthetic: boolean;
    reviewState: GalaxyEvidenceRefV1["review_state"];
    qualificationLevel?: GalaxyEvidenceRefV1["qualification_level"];
    notes?: string;
  };
}): GalaxyPublicationSnapshotV1 {
  if (!input.snapshotId || input.snapshotId.length > 300) throw new Error("snapshotId must be 1..300 chars");
  if (!input.claimId || input.claimId.length > 200) throw new Error("claimId must be 1..200 chars");
  if (!input.authority || input.authority.length > 160) throw new Error("authority must be 1..160 chars");
  if (!input.summary || input.summary.length > 500) throw new Error("summary must be 1..500 chars");
  if (input.caveat && input.caveat.length > 1000) throw new Error("caveat must be <=1000 chars");
  if (input.openUri) assertOpenUri(input.openUri);
  if (input.intendedVisibility === "public" && !input.humanConfirmed) throw new Error("public snapshot requires human confirmation");
  if (input.intendedVisibility === "public" && input.evidence.visibility !== "public") throw new Error("public snapshot cannot include non-public evidence");
  if (input.intendedVisibility === "public" && input.evidence.reviewState === "unreviewed") throw new Error("public snapshot cannot include unreviewed evidence");
  if (input.claim === "verified" && input.evidence.synthetic) throw new Error("synthetic evidence cannot back a verified claim");

  const revision = String(input.projectRevision);
  const project = diagramEntity("project", input.projectId, revision, input.projectTitle);
  const node = diagramEntity("node", input.nodeId, revision, input.nodeLabel);
  const evidence: GalaxyEvidenceRefV1 = {
    schema_version: 1,
    evidence_id: input.evidence.evidenceId,
    kind: input.evidence.kind,
    source_system: input.evidence.sourceSystem,
    locator: input.evidence.locator,
    captured_at: iso(input.evidence.capturedAt, "evidence.capturedAt"),
    ...(input.evidence.observedRevision ? { observed_revision: input.evidence.observedRevision } : {}),
    ...(input.evidence.integrity ? { integrity: input.evidence.integrity } : {}),
    visibility: input.evidence.visibility,
    synthetic: input.evidence.synthetic,
    review_state: input.evidence.reviewState,
    ...(input.evidence.qualificationLevel ? { qualification_level: input.evidence.qualificationLevel } : {}),
    producer_app: "datapass_vscode",
    ...(input.evidence.notes ? { notes: input.evidence.notes } : {})
  };

  return {
    schema_version: 1,
    snapshot_id: input.snapshotId,
    producer: {
      app_id: "datapass_vscode",
      product_version: input.productVersion,
      source_revision: input.producerRevision
    },
    subject: project,
    created_at: iso(input.createdAt, "createdAt"),
    review: {
      state: "reviewed",
      reviewed_at: iso(input.reviewedAt, "reviewedAt"),
      ...(input.reviewedBy ? { reviewed_by: input.reviewedBy } : {}),
      human_confirmed: input.humanConfirmed,
      intended_visibility: input.intendedVisibility
    },
    entities: [
      { ...project, label: input.projectTitle, kind: "project", visibility: input.intendedVisibility },
      { ...node, label: input.nodeLabel, kind: "node", visibility: input.intendedVisibility }
    ],
    relationships: [{
      relationship_id: galaxyEntityId("datapass_vscode", "relationship", `${input.projectId}:${input.nodeId}`),
      from_entity_id: project.entity_id,
      to_entity_id: node.entity_id,
      type: "describes_component",
      evidence_ref_ids: [evidence.evidence_id]
    }],
    evidence_refs: [evidence],
    realization_claims: [{
      claim_id: input.claimId,
      subject_entity_id: node.entity_id,
      state: input.claim,
      observed_at: iso(input.observedAt, "observedAt"),
      producer_app: "datapass_vscode",
      authority: input.authority,
      summary: input.summary,
      ...(input.caveat ? { caveat: input.caveat } : {}),
      ...(input.openUri ? { open_uri: input.openUri } : {}),
      evidence_ref_ids: [evidence.evidence_id],
      review_state: input.evidence.reviewState
    }],
    contract_versions: [...GALAXY_DIAGRAMCLOUD_CONTRACTS]
  };
}
