import { createHash } from "node:crypto";

/** Stable identifier shared with the V2.2 contract kit and DiagramCloud's native ID rule. */
export const ID_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/;
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export interface Sha256 {
  algorithm: "sha256";
  value: string;
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Byte digest of exact bytes. Never reserialize before hashing. */
export function sha256Bytes(bytes: Uint8Array | string): Sha256 {
  return { algorithm: "sha256", value: createHash("sha256").update(bytes).digest("hex") };
}

export function sameDigest(a: Sha256 | undefined | null, b: Sha256 | undefined | null): boolean {
  return Boolean(a && b && a.algorithm === b.algorithm && a.value === b.value);
}

/** Deterministic, readable ID suggestion; not an identity by itself. */
export function slugId(value: string, fallback = "item"): string {
  const s = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 80);
  return ID_PATTERN.test(s) ? s : fallback;
}

export function newLocalId(prefix: string, now = Date.now(), random = Math.random()): string {
  const suffix = `${now.toString(36)}${Math.floor(random * 1e8).toString(36)}`;
  return slugId(`${prefix}-${suffix}`, prefix);
}
