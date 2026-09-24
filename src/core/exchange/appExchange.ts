/**
 * External App Exchange: DataPass freezes request bytes, an external app/AI works on them,
 * and the returned result is correlated against those exact bytes before anything is staged.
 */
import { sha256Bytes, type Sha256 } from "../model/ids";
import { parseStrictJson } from "../model/strictJson";
import { observe, type Observation } from "../model/evidence";
import { CONTRACT_VERSION, type AppExchangePayload, type BaseRef, type Classification, type Envelope, type SourceRef } from "../contracts/envelopes";
import { checkResult, validateEnvelope, MAX_ENVELOPE_BYTES } from "../contracts/validate";

export interface AppRequestInput {
  id: string;
  projectRef: string;
  scopeRef: string;
  base: BaseRef;
  classification: Classification;
  createdAt: string;
  sources: SourceRef[];
  appRef: string;
  operation: AppExchangePayload["operation"];
  inputRefs: string[];
  correlationId?: string;
}

export interface FrozenRequest {
  envelope: Envelope<"app-exchange", AppExchangePayload>;
  bytes: Uint8Array;
  digest: Sha256;
}

/** Serialize once; those bytes are the request. The request never contains its own hash. */
export function buildAppRequest(input: AppRequestInput): FrozenRequest {
  const envelope: Envelope<"app-exchange", AppExchangePayload> = {
    format: "datapass.app-exchange",
    contractVersion: CONTRACT_VERSION,
    id: input.id,
    projectRef: input.projectRef,
    scopeRef: input.scopeRef,
    base: input.base,
    classification: input.classification,
    createdAt: input.createdAt,
    sources: input.sources,
    payload: {
      direction: "request",
      correlationId: input.correlationId ?? input.id,
      appRef: input.appRef,
      operation: input.operation,
      inputRefs: input.inputRefs,
      outputArtifacts: [],
      requestHash: null,
      resultState: "not-run",
      executionEvidenceRef: null
    }
  };
  validateEnvelope(envelope);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope, null, 2) + "\n");
  return { envelope, bytes, digest: sha256Bytes(bytes) };
}

export type ArtifactCheck = { artifactId: string; state: "verified" | "mismatch" | "not-supplied"; expected: string; actual?: string };

export interface ResultAssessment {
  status: "candidate" | "quarantined";
  reasons: string[];
  warnings: string[];
  result?: Envelope<"app-exchange", AppExchangePayload>;
  artifacts: ArtifactCheck[];
  observations: Observation[];
}

/**
 * Assess an imported result. Never throws for bad input: a wrong result is quarantined with
 * reasons and the accepted state is untouched. A candidate is still only a candidate.
 */
export function assessAppResult(
  requestBytes: Uint8Array,
  resultRaw: string | Uint8Array,
  suppliedArtifacts: ReadonlyMap<string, Uint8Array>,
  now: string
): ResultAssessment {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = parseStrictJson(resultRaw, { maxBytes: MAX_ENVELOPE_BYTES });
  } catch (error) {
    return quarantine([`Unparseable result: ${message(error)}`]);
  }
  let correlated;
  try {
    correlated = checkResult(requestBytes, parsed);
  } catch (error) {
    return quarantine([message(error)]);
  }
  const { request, result } = correlated;
  const p = result.payload;
  const requestInputs = new Set(request.payload.inputRefs);
  for (const artifact of p.outputArtifacts) {
    const undeclared = artifact.inputRefs.filter(ref => !requestInputs.has(ref));
    if (undeclared.length) warnings.push(`Artifact ${artifact.id} claims inputs not in the request: ${undeclared.join(", ")}`);
    if (artifact.producerRef !== p.appRef) warnings.push(`Artifact ${artifact.id} producer ${artifact.producerRef} differs from app ${p.appRef}`);
  }
  if (p.resultState === "failed") warnings.push("External app reported failure; outputs are retained as evidence only.");
  if (p.resultState === "partial") warnings.push("External app reported partial completion.");

  const artifacts: ArtifactCheck[] = p.outputArtifacts.map(a => {
    const bytes = suppliedArtifacts.get(a.id);
    if (!bytes) return { artifactId: a.id, state: "not-supplied", expected: a.byteHash.value };
    const actual = sha256Bytes(bytes).value;
    return { artifactId: a.id, state: actual === a.byteHash.value ? "verified" : "mismatch", expected: a.byteHash.value, actual };
  });
  const mismatched = artifacts.filter(a => a.state === "mismatch");
  const extra = [...suppliedArtifacts.keys()].filter(id => !p.outputArtifacts.some(a => a.id === id));

  const observations: Observation[] = [
    observe("file-received", result.id, "datapass", "clipboard/file import", now),
    observe("schema-validated", result.id, "datapass", "datapass.app-exchange/0.1-draft", now),
    observe("reported-by-external", result.id, p.appRef, `resultState=${p.resultState}`, now, p.executionEvidenceRef ?? undefined),
    ...artifacts.filter(a => a.state === "verified").map(a => observe("hash-verified", a.artifactId, "datapass", "sha256 of supplied bytes", now))
  ];

  const reasons: string[] = [];
  if (mismatched.length) reasons.push(`Artifact bytes do not match declared digests: ${mismatched.map(a => a.artifactId).join(", ")}`);
  if (extra.length) reasons.push(`Files supplied that the result does not declare: ${extra.join(", ")}`);
  return {
    status: reasons.length ? "quarantined" : "candidate",
    reasons,
    warnings,
    result,
    artifacts,
    observations
  };

  function quarantine(why: string[]): ResultAssessment {
    return { status: "quarantined", reasons: why, warnings, artifacts: [], observations: [observe("file-received", "unknown", "datapass", "import", now)] };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
