/**
 * Materialization (V4 MAT1, brief § 27): the provenance stamp every generated native file carries.
 * Pure.
 *
 * A stamp names where a file came from (source logical id + revision), what made it (generator +
 * version), where it is meant to go (target platform, native kind, environment) and what it contained
 * when it was generated (content hash). There is no timestamp: the same candidate at the same revision
 * always produces byte-identical files, so Git shows only real changes.
 *
 * Placement:
 *   - a format that allows comments (Python) carries the stamp inline, as one comment line;
 *   - every other file (JSON: .platform, pipeline-content.json, SparkJobDefinitionV1.json) gets a
 *     sidecar under `.datapass/provenance/<path>.provenance.json`, outside the Fabric item folder so
 *     the native deployment tool (fabric-cicd, Fabric Git) never publishes it as an item part.
 *
 * The evidence origin of a stamped file is always "generated" (§ 34): a stamp proves what DataPass
 * wrote, never that the item was deployed or ran.
 */
import { createHash } from "node:crypto";

export const PROVENANCE_SCHEMA = "datapass.provenance/v1";
export const GENERATOR_NAME = "datapass-materialize";
export const GENERATOR_VERSION = "1.0.0";

export type TargetPlatform = "fabric";
export type NativeKind = "notebook" | "spark-job-definition" | "data-pipeline";

export interface ProvenanceStamp {
  schema: typeof PROVENANCE_SCHEMA;
  /** Logical id of the architecture candidate (or its node) the file was generated from. */
  sourceLogicalId: string;
  /** Exact revision of that source (a Git SHA or a candidate digest). */
  sourceRevision: string;
  generator: { name: string; version: string };
  targetPlatform: TargetPlatform;
  nativeKind: NativeKind;
  /** Deployment environment the file was generated for (dev, test, prod…). */
  environment: string;
  /** `sha256:<hex>` of the file body without its inline stamp line, LF line endings. */
  contentHash: string;
  evidenceOrigin: "generated";
}

export type StampInput = Omit<ProvenanceStamp, "schema" | "generator" | "contentHash" | "evidenceOrigin"> & {
  generator?: { name: string; version: string };
};

/** Line endings normalised to LF, so a checkout with core.autocrlf does not change the hash. */
export function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(normalizeContent(content), "utf8").digest("hex")}`;
}

export function makeStamp(input: StampInput, body: string): ProvenanceStamp {
  // Fixed key order: the stamp is serialised as-is and must be byte-stable.
  return {
    schema: PROVENANCE_SCHEMA,
    sourceLogicalId: input.sourceLogicalId,
    sourceRevision: input.sourceRevision,
    generator: input.generator ?? { name: GENERATOR_NAME, version: GENERATOR_VERSION },
    targetPlatform: input.targetPlatform,
    nativeKind: input.nativeKind,
    environment: input.environment,
    contentHash: contentHash(body),
    evidenceOrigin: "generated"
  };
}

// --- Inline placement (comment line) --------------------------------------------------------------

const INLINE_PREFIX = "# datapass-provenance: ";

/** Whether a file of this path can carry its stamp inline. */
export function supportsInlineStamp(filePath: string): boolean {
  return /\.py$/i.test(filePath);
}

/** The single comment line that carries the stamp inside a Python file. */
export function inlineStampLine(stamp: ProvenanceStamp): string {
  return `${INLINE_PREFIX}${JSON.stringify(stamp)}`;
}

/** Splits a Python file into its stamp (if any) and its body (the file without the stamp line). */
export function readInlineStamp(content: string): { stamp?: ProvenanceStamp; body: string } {
  const lines = normalizeContent(content).split("\n");
  const index = lines.findIndex(l => l.startsWith(INLINE_PREFIX));
  if (index < 0) return { body: normalizeContent(content) };
  const stamp = parseStamp(lines[index]!.slice(INLINE_PREFIX.length));
  lines.splice(index, 1);
  return { stamp, body: lines.join("\n") };
}

// --- Sidecar placement ----------------------------------------------------------------------------

export const SIDECAR_ROOT = ".datapass/provenance";

/** Where the sidecar of a generated file lives (repository-relative, forward slashes). */
export function sidecarPath(filePath: string): string {
  return `${SIDECAR_ROOT}/${filePath.replace(/\\/g, "/")}.provenance.json`;
}

export function renderSidecar(stamp: ProvenanceStamp): string {
  return `${JSON.stringify(stamp, null, 2)}\n`;
}

// --- Parsing and verification ---------------------------------------------------------------------

/** Parses a stamp from untrusted text; undefined when it does not have the documented shape. */
export function parseStamp(text: string): ProvenanceStamp | undefined {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return undefined; }
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const gen = r.generator as Record<string, unknown> | undefined;
  const str = (v: unknown, max = 300): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
  if (r.schema !== PROVENANCE_SCHEMA || !str(r.sourceLogicalId) || !str(r.sourceRevision) || !str(r.environment, 64)) return undefined;
  if (!gen || !str(gen.name, 100) || !str(gen.version, 50)) return undefined;
  if (r.targetPlatform !== "fabric" || !isNativeKind(r.nativeKind)) return undefined;
  if (typeof r.contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(r.contentHash) || r.evidenceOrigin !== "generated") return undefined;
  return {
    schema: PROVENANCE_SCHEMA,
    sourceLogicalId: r.sourceLogicalId,
    sourceRevision: r.sourceRevision,
    generator: { name: gen.name, version: gen.version },
    targetPlatform: "fabric",
    nativeKind: r.nativeKind,
    environment: r.environment,
    contentHash: r.contentHash,
    evidenceOrigin: "generated"
  };
}

function isNativeKind(v: unknown): v is NativeKind {
  return v === "notebook" || v === "spark-job-definition" || v === "data-pipeline";
}

export type StampVerdict =
  /** Stamp present and the body still hashes to it. */
  | "intact"
  /** Stamp present but the body changed since generation: a manual edit, the file is detached (§ 28). */
  | "detached"
  /** No readable stamp: not a DataPass-generated file (or its stamp was removed). */
  | "unstamped";

/**
 * Checks a file against its stamp. `sidecar` is the sidecar text for files stamped beside
 * themselves; inline files ignore it.
 */
export function verifyStamp(filePath: string, content: string, sidecar?: string): { verdict: StampVerdict; stamp?: ProvenanceStamp } {
  if (supportsInlineStamp(filePath)) {
    const { stamp, body } = readInlineStamp(content);
    if (!stamp) return { verdict: "unstamped" };
    return { verdict: contentHash(body) === stamp.contentHash ? "intact" : "detached", stamp };
  }
  const stamp = sidecar === undefined ? undefined : parseStamp(sidecar);
  if (!stamp) return { verdict: "unstamped" };
  return { verdict: contentHash(content) === stamp.contentHash ? "intact" : "detached", stamp };
}
