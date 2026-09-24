/**
 * PublicationBrief preparation. Claims are selected for an audience by rule, never rewritten:
 * DataPass does not guess redactions. Anything it cannot include is listed with the reason.
 * Releasing a brief for generation needs a local human approval for the exact bytes/audience;
 * an imported "approved" label is only a claim.
 */
import { sha256Bytes, type Sha256 } from "../model/ids";
import { parseStrictJson } from "../model/strictJson";
import { validateEnvelope } from "../contracts/validate";
import { CONTRACT_VERSION, type Audience, type BaseRef, type BriefClaim, type Envelope, type PublicationBriefPayload, type SourceRef } from "../contracts/envelopes";

export interface PrepareBriefInput {
  id: string; projectRef: string; scopeRef: string; base: BaseRef; createdAt: string;
  audience: Audience; purpose: string; outputFormats: PublicationBriefPayload["outputFormats"];
  claims: BriefClaim[]; sources: SourceRef[]; assetRefs: string[];
}

export interface Exclusion { claimId: string; reason: string }

const AUDIENCE_MAY_SEE: Record<Audience, ReadonlySet<SourceRef["classification"]>> = {
  public: new Set(["public"]),
  "named-reviewers": new Set(["public", "internal"]),
  internal: new Set(["public", "internal"])
};

export function prepareBrief(input: PrepareBriefInput): { envelope: Envelope<"publication-brief", PublicationBriefPayload>; bytes: Uint8Array; digest: Sha256; excluded: Exclusion[]; missingApprovals: string[] } {
  const sources = new Map(input.sources.map(s => [s.id, s]));
  const excluded: Exclusion[] = [];
  const included: BriefClaim[] = [];
  for (const c of input.claims) {
    if (c.review === "rejected") { excluded.push({ claimId: c.id, reason: "claim was rejected in review" }); continue; }
    if (!c.allowedAudiences.includes(input.audience)) { excluded.push({ claimId: c.id, reason: `not cleared for audience ${input.audience}` }); continue; }
    const missing = c.sourceRefs.filter(r => !sources.has(r));
    if (missing.length) { excluded.push({ claimId: c.id, reason: `unknown sources: ${missing.join(", ")}` }); continue; }
    const tooSensitive = c.sourceRefs.map(r => sources.get(r)!).filter(s => !AUDIENCE_MAY_SEE[input.audience].has(s.classification));
    if (tooSensitive.length) {
      excluded.push({ claimId: c.id, reason: `source ${tooSensitive.map(s => `${s.id} (${s.classification})`).join(", ")} is not releasable to ${input.audience}; create and approve a sanitized source projection first` });
      continue;
    }
    if (!c.sourceRefs.length && c.basis !== "target") { excluded.push({ claimId: c.id, reason: "unsourced claim; label it as a question/hypothesis instead" }); continue; }
    included.push(c);
  }
  const usedSources = [...new Set(included.flatMap(c => c.sourceRefs))].map(id => sources.get(id)!);
  const envelope: Envelope<"publication-brief", PublicationBriefPayload> = {
    format: "datapass.publication-brief", contractVersion: CONTRACT_VERSION,
    id: input.id, projectRef: input.projectRef, scopeRef: input.scopeRef, base: input.base,
    classification: input.audience === "public" ? "public" : "internal",
    createdAt: input.createdAt, sources: usedSources,
    payload: {
      audience: input.audience, purpose: input.purpose, outputFormats: input.outputFormats,
      claims: included, assetRefs: input.assetRefs, releaseState: "draft", publication: "not-authorized"
    }
  };
  validateEnvelope(envelope);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope, null, 2) + "\n");
  return { envelope, bytes, digest: sha256Bytes(bytes), excluded, missingApprovals: included.filter(c => c.review !== "approved").map(c => c.id) };
}

export interface LocalApproval {
  subjectDigest: string;
  audience: Audience;
  scope: "generation" | "publication";
  approvedBy: "local-user";
  approvedAt: string;
  note?: string;
}

export type BriefTrust =
  | { state: "draft" }
  | { state: "approved-for-generation"; approval: LocalApproval }
  | { state: "claimed-not-granted"; reason: string };

/** The imported label is a claim; only a local approval for the exact digest+audience grants it. */
export function assessBriefTrust(bytes: Uint8Array, approvals: LocalApproval[]): BriefTrust {
  const doc = parseStrictJson(bytes) as Envelope<"publication-brief", PublicationBriefPayload>;
  validateEnvelope(doc);
  const digest = sha256Bytes(bytes).value;
  const approval = approvals.find(a => a.subjectDigest === digest && a.audience === doc.payload.audience && a.scope === "generation");
  if (approval) return { state: "approved-for-generation", approval };
  if (doc.payload.releaseState === "reviewed-for-generation") return { state: "claimed-not-granted", reason: "The file says reviewed-for-generation, but no local approval exists for these exact bytes and audience." };
  return { state: "draft" };
}

// ---- Output manifests returned by external PPTX/document/website tools ----

export interface OutputManifest {
  format: "datapass.output-manifest";
  briefHash: { algorithm: "sha256"; value: string };
  generator: string;
  includedClaimIds: string[];
  outputs: Array<{ file: string; mediaType: string; byteHash: { algorithm: "sha256"; value: string } }>;
  omissions: string[];
}

export interface OutputAssessment {
  status: "received-not-approved" | "quarantined";
  reasons: string[];
  warnings: string[];
  fileChecks: Array<{ file: string; state: "verified" | "mismatch" | "not-supplied" }>;
}

export function assessOutputManifest(briefBytes: Uint8Array, manifestRaw: string | Uint8Array, files: ReadonlyMap<string, Uint8Array>): OutputAssessment {
  const reasons: string[] = [], warnings: string[] = [];
  let m: OutputManifest;
  try {
    m = parseStrictJson(manifestRaw) as OutputManifest;
    if (m?.format !== "datapass.output-manifest" || !Array.isArray(m.outputs) || !Array.isArray(m.includedClaimIds)) throw new Error("Not a datapass.output-manifest");
  } catch (error) {
    return { status: "quarantined", reasons: [error instanceof Error ? error.message : String(error)], warnings, fileChecks: [] };
  }
  const brief = parseStrictJson(briefBytes) as Envelope<"publication-brief", PublicationBriefPayload>;
  if (m.briefHash?.value !== sha256Bytes(briefBytes).value) reasons.push("Output was generated from a different brief (hash mismatch).");
  const known = new Set(brief.payload.claims.map(c => c.id));
  const foreign = m.includedClaimIds.filter(id => !known.has(id));
  if (foreign.length) reasons.push(`Output includes claims not in the brief: ${foreign.join(", ")}`);
  const omitted = [...known].filter(id => !m.includedClaimIds.includes(id));
  if (omitted.length) warnings.push(`Claims in the brief not reported as used: ${omitted.join(", ")}`);
  const fileChecks = m.outputs.map(o => {
    const bytes = files.get(o.file);
    if (!bytes) return { file: o.file, state: "not-supplied" as const };
    return { file: o.file, state: sha256Bytes(bytes).value === o.byteHash?.value ? "verified" as const : "mismatch" as const };
  });
  if (fileChecks.some(f => f.state === "mismatch")) reasons.push("An output file does not match its declared hash.");
  warnings.push("A matching brief hash does not prove numbers and qualifications were rendered correctly; review the document itself.");
  return { status: reasons.length ? "quarantined" : "received-not-approved", reasons, warnings, fileChecks };
}
