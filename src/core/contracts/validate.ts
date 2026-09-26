/**
 * Structural + semantic validation of exchange envelopes, and request/result correlation.
 * Semantic rules are ported from contract_kit.py `validate` and `check_result`.
 *
 * Passing validation proves shape and internal consistency only. It does not prove
 * authorship, approval, scientific validity or that referenced evidence exists.
 */
import { parseStrictJson } from "../model/strictJson";
import { sha256Bytes } from "../model/ids";
import { jsonEqual } from "../model/deepEqual";
import { validateSchema, type SchemaIssue } from "./schemaDsl";
import {
  ENVELOPE_KINDS, SCHEMAS,
  type AppExchangePayload, type ArchitectureViewPayload, type AuthoritySnapshotPayload,
  type Envelope, type EnvelopeKind, type PublicationBriefPayload
} from "./envelopes";

export const MAX_ENVELOPE_BYTES = 1_048_576;

export class ContractError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
    this.name = "ContractError";
  }
}

export function envelopeKind(doc: unknown): EnvelopeKind | undefined {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const format = (doc as Record<string, unknown>).format;
  if (typeof format !== "string" || !format.startsWith("datapass.")) return undefined;
  const kind = format.slice("datapass.".length);
  return (ENVELOPE_KINDS as readonly string[]).includes(kind) ? kind as EnvelopeKind : undefined;
}

export function parseEnvelope(raw: string | Uint8Array): Envelope {
  const doc = parseStrictJson(raw, { maxBytes: MAX_ENVELOPE_BYTES });
  validateEnvelope(doc);
  return doc as Envelope;
}

export function validateEnvelope(doc: unknown): asserts doc is Envelope {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new ContractError("Envelope must be an object");
  const kind = envelopeKind(doc);
  if (!kind) throw new ContractError("Unsupported format");
  const issues = validateSchema(SCHEMAS[kind], doc);
  if (issues.length) throw new ContractError(`Invalid ${kind} envelope`, issues);

  const env = doc as Envelope;
  const sources = env.sources.map(s => s.id);
  if (new Set(sources).size !== sources.length) throw new ContractError("Duplicate source");

  switch (kind) {
    case "architecture-view": {
      const p = env.payload as unknown as ArchitectureViewPayload;
      const nodes = p.nodes.map(n => n.id);
      const edges = p.edges.map(e => e.id);
      if (new Set(nodes).size !== nodes.length || new Set(edges).size !== edges.length) throw new ContractError("Duplicate graph identity");
      const nodeSet = new Set(nodes);
      if (p.edges.some(e => !nodeSet.has(e.source) || !nodeSet.has(e.target))) throw new ContractError("Dangling graph endpoint");
      break;
    }
    case "app-exchange": {
      const p = env.payload as unknown as AppExchangePayload;
      if (p.direction === "request" && (p.resultState !== "not-run" || p.outputArtifacts.length || p.requestHash !== null)) {
        throw new ContractError("Request is not an execution result");
      }
      if (p.direction === "result" && (p.resultState === "not-run" || p.requestHash === null)) {
        throw new ContractError("Result must state its observed outcome");
      }
      if (p.resultState === "succeeded" && !p.executionEvidenceRef) throw new ContractError("Success needs evidence reference");
      const artifactIds = p.outputArtifacts.map(a => a.id);
      if (new Set(artifactIds).size !== artifactIds.length) throw new ContractError("Duplicate artifact identity");
      break;
    }
    case "authority-snapshot": {
      const p = env.payload as unknown as AuthoritySnapshotPayload;
      if (p.state === "empty" && p.recordRefs.length) throw new ContractError("Empty contains records");
      if ((p.state === "error" || p.state === "not-authorized") && p.recordRefs.length) {
        throw new ContractError("Failure cannot masquerade as records");
      }
      if (p.state === "partial" && !(p.omissions.length || p.nextCursorAvailable)) throw new ContractError("Partial coverage must be described");
      break;
    }
    case "publication-brief": {
      const p = env.payload as unknown as PublicationBriefPayload;
      const sourceSet = new Set(sources);
      const claimIds = p.claims.map(c => c.id);
      if (new Set(claimIds).size !== claimIds.length) throw new ContractError("Duplicate claim identity");
      for (const c of p.claims) {
        if (c.sourceRefs.some(ref => !sourceSet.has(ref))) throw new ContractError("Unknown claim source");
        if (p.releaseState === "reviewed-for-generation") {
          if (c.review !== "approved" || !c.sourceRefs.length || !c.allowedAudiences.includes(p.audience)) {
            throw new ContractError("Claim not reviewed for this audience");
          }
        }
      }
      if (p.audience === "public" && p.releaseState === "reviewed-for-generation") {
        if (env.classification !== "public" || env.sources.some(s => s.classification !== "public")) {
          throw new ContractError("Public brief has non-public sources");
        }
      }
      break;
    }
    case "io-contract":
      break;
  }
}

export interface CorrelationFailure {
  code: "not-app-exchange" | "direction" | "request-digest" | "cross-project" | "stale-base" | "wrong-context";
  message: string;
}

/**
 * Correlate a returned result with the exact frozen request bytes DataPass exported.
 * Never parse-and-reserialize the request before hashing: the digest is over the bytes.
 */
export function checkResult(requestBytes: Uint8Array, result: unknown): { request: Envelope<"app-exchange", AppExchangePayload>; result: Envelope<"app-exchange", AppExchangePayload> } {
  const request = parseEnvelope(requestBytes);
  validateEnvelope(result);
  const fail = (code: CorrelationFailure["code"], message: string): never => {
    const error = new ContractError(message) as ContractError & { code: string };
    error.code = code;
    throw error;
  };
  if (request.format !== "datapass.app-exchange" || result.format !== "datapass.app-exchange") fail("not-app-exchange", "Expected app-exchange envelopes");
  const rq = request.payload as unknown as AppExchangePayload;
  const rs = (result as Envelope).payload as unknown as AppExchangePayload;
  if (rq.direction !== "request" || rs.direction !== "result") fail("direction", "Request/result direction mismatch");
  if (rs.requestHash?.value !== sha256Bytes(requestBytes).value) fail("request-digest", "Request byte digest mismatch");
  if (request.projectRef !== result.projectRef || request.scopeRef !== result.scopeRef) fail("cross-project", "Stale or cross-project result");
  if (!jsonEqual(request.base, result.base)) fail("stale-base", "Stale or cross-project result");
  for (const key of ["correlationId", "appRef", "operation"] as const) {
    if (rq[key] !== rs[key]) fail("wrong-context", "Wrong request context");
  }
  if (!jsonEqual(rq.inputRefs, rs.inputRefs)) fail("wrong-context", "Wrong request context");
  return {
    request: request as unknown as Envelope<"app-exchange", AppExchangePayload>,
    result: result as unknown as Envelope<"app-exchange", AppExchangePayload>
  };
}
