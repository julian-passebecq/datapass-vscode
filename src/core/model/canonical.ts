/**
 * "datapass-sorted-json-v1": DataPass's own named canonicalization for hashing its own
 * records (e.g. QuerySpecs). Object keys sorted by UTF-16 code units, no whitespace, JSON
 * number formatting from ECMAScript. It is NOT RFC 8785/JCS and NOT FOIL's Python case_hash.
 */
import { sha256Bytes, type Sha256 } from "./ids";

export const CANONICAL_ALGORITHM = "datapass-sorted-json-v1";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nonfinite numbers cannot be canonicalized");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  throw new Error(`Cannot canonicalize ${typeof value}`);
}

export function canonicalDigest(value: unknown): Sha256 & { canonicalization: typeof CANONICAL_ALGORITHM } {
  return { ...sha256Bytes(canonicalJson(value)), canonicalization: CANONICAL_ALGORITHM };
}
