/**
 * EVPIN1 (§ V5 Track E): a verdict holds for the file state it was computed on. When it is computed,
 * DataPass stamps a pin {gitSha, artifactDigest} (Common `project-contracts` evidence-pin/1); later
 * the pin is compared with the file as it is now, and a changed or missing file makes the verdict
 * `stale`. Git is the version axis: nothing is snapshotted or restored. Pure (no `vscode`, no I/O):
 * the caller reads the bytes and runs `fileBlobArgs` (src/core/git/fileVersions.ts).
 * The contract (evidence-pin/1, pinned-verdict/1) is the vendored Common `project-contracts` (REPIN5, V5FREEZE1).
 */
import { createHash } from "node:crypto";
import {
  pinState, refreshPinnedVerdict, validatePinnedVerdict,
  type CurrentFileState, type EvidencePin, type PinState, type PinnedVerdict
} from "@juliandatapass-group/project-contracts";
import type { GitObjectId } from "@juliandatapass-group/semantic-core";

export type { CurrentFileState, EvidencePin, GitObjectId, PinState, PinnedVerdict };
export type VerdictValue = PinnedVerdict["verdict"];

/** A bare SHA as printed by `git hash-object` as a GitObjectId (40 hex → git-sha1, 64 hex → git-sha256); undefined otherwise. */
export function gitObjectId(sha: string): GitObjectId | undefined {
  return /^[0-9a-f]{40}$/.test(sha) ? { algorithm: "git-sha1", oid: sha } : /^[0-9a-f]{64}$/.test(sha) ? { algorithm: "git-sha256", oid: sha } : undefined;
}

/** The exact-bytes digest of a file's content. */
export function artifactDigest(bytes: Uint8Array): EvidencePin["artifactDigest"] {
  return { algorithm: "sha256", mode: "exact-bytes", value: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * The state of a file now: its bytes (`null` when the file is gone) and its Git blob id only when the host
 * ran `git hash-object` (`fileBlobArgs`); otherwise `null`. A SHA-1 of the working bytes is not the blob id on
 * CRLF/filtered checkouts, so it is never guessed: the exact-bytes digest decides freshness anyway.
 */
export function currentFileState(bytes: Uint8Array | null, gitSha: string | null = null): CurrentFileState | null {
  if (!bytes) return null;
  return { gitSha: (gitSha === null ? undefined : gitObjectId(gitSha)) ?? null, artifactDigest: artifactDigest(bytes) };
}

/** The pin stamped when a verdict is computed; `null` when the file could not be read (the verdict stays unpinned). */
export function stampPin(state: CurrentFileState | null): EvidencePin | null {
  if (!state?.artifactDigest) return null;
  return { gitSha: state.gitSha, artifactDigest: state.artifactDigest };
}

export interface VerdictInput {
  subjectKey: string;
  verdict: VerdictValue;
  evidenceIds: readonly string[];
  /** ISO 8601 instant in UTC (`…Z`). */
  computedAt: string;
}

/** A verdict stamped with the file state it was computed on; it is `current` by construction (or `unpinned`). */
export function pinVerdict(input: VerdictInput, state: CurrentFileState | null): PinnedVerdict {
  const pin = stampPin(state);
  const record = { ...input, evidenceIds: [...input.evidenceIds], pin, freshness: pin ? "current" : "unpinned" };
  const checked = validatePinnedVerdict(record);
  if (!checked.ok) throw new Error(`Invalid pinned verdict: ${checked.issues.map(i => `${i.code} at ${i.pointer || "/"}`).join("; ")}`);
  return checked.value;
}

/** The verdict's freshness against the file now (pure; the record is not changed). */
export function refreshVerdict(record: PinnedVerdict, now: CurrentFileState | null): PinnedVerdict {
  return refreshPinnedVerdict(record, now);
}

export { pinState };

const short = (sha: GitObjectId | null | undefined): string => (sha ? sha.oid.slice(0, 7) : "digest only");

/** The pin part of a Context provenance line: what the verdict was computed on, and whether it still holds. */
export function pinProvenanceText(record: Pick<PinnedVerdict, "pin" | "freshness">): { state: PinState; text: string; about: string } {
  const { pin, freshness } = record;
  if (!pin || freshness === "unpinned") {
    return { state: "unpinned", text: "unpinned", about: "No file state was recorded when this verdict was computed." };
  }
  const at = `${short(pin.gitSha)} · sha256 ${pin.artifactDigest.value.slice(0, 8)}`;
  return freshness === "stale"
    ? { state: "stale", text: `stale · computed on ${short(pin.gitSha)}`, about: `The file changed (or is gone) since this verdict was computed on ${at}; recompute it.` }
    : { state: "current", text: `pinned · ${short(pin.gitSha)}`, about: `Computed on ${at}; the file is unchanged.` };
}
