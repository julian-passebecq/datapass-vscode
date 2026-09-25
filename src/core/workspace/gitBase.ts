/**
 * Base revision capture for exchange envelopes. A base binds a request to the exact
 * repository state it was prepared from: HEAD commit plus a fingerprint of uncommitted
 * changes. Commands run with argv arrays (no shell) and never prompt for credentials.
 */
import { sha256Bytes, type Sha256 } from "../model/ids";

export type GitRunner = (args: string[], cwd: string, timeoutMs: number) => Promise<{ ok: boolean; stdout: string; stderr?: string }>;

export interface RepoRevision {
  revision: string;
  dirty: boolean;
  workingTreeHash: Sha256;
  /**
   * "partial" when some uncommitted content could not be fingerprinted (too many untracked files,
   * a git command failed, no Git at all). A partial fingerprint includes a one-off nonce, so it
   * never equals another capture: "unchanged" is only claimed when every byte was covered.
   */
  coverage: "complete" | "partial";
  /** Untracked (not ignored) files found; their content is part of the fingerprint. */
  untracked: number;
}

const EMPTY = sha256Bytes(new Uint8Array());
/** Untracked files whose content is hashed; beyond this the capture is partial. */
export const MAX_UNTRACKED_HASHED = 500;
const HASH_BATCH = 50;

const randomNonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Fingerprint of uncommitted state: porcelain status, the binary-safe diff of tracked files against
 * HEAD and the blob ids of untracked files. Clean trees always produce the hash of empty input.
 */
export function workingTreeFingerprint(statusPorcelain: string, diff: string, untrackedBlobs = ""): { dirty: boolean; hash: Sha256 } {
  if (!statusPorcelain.trim()) return { dirty: false, hash: EMPTY };
  return { dirty: true, hash: sha256Bytes(new TextEncoder().encode(`status\0${statusPorcelain}\0diff\0${diff}\0untracked\0${untrackedBlobs}`)) };
}

export async function readRepoRevision(run: GitRunner, cwd: string, nonce: () => string = randomNonce): Promise<RepoRevision> {
  const partialOnly = (revision: string, why: string): RepoRevision =>
    ({ revision, dirty: true, workingTreeHash: sha256Bytes(`partial\0${why}\0${nonce()}`), coverage: "partial", untracked: 0 });
  const head = await run(["rev-parse", "--verify", "HEAD"], cwd, 5000);
  if (!head.ok) return partialOnly("unversioned", "no-head");
  const revision = head.stdout.trim();
  const status = await run(["status", "--porcelain=v1", "--untracked-files=normal"], cwd, 10000);
  if (!status.ok) return partialOnly(revision, "status-unavailable");
  if (!status.stdout.trim()) return { revision, dirty: false, workingTreeHash: EMPTY, coverage: "complete", untracked: 0 };

  // --binary: a changed binary file changes the fingerprint (plain diff only says "Binary files differ").
  const diff = await run(["diff", "HEAD", "--binary", "--no-color", "--no-ext-diff"], cwd, 15000);
  // Untracked files are not in `git diff`: hash their bytes (blob ids), bounded.
  const others = await run(["ls-files", "--others", "--exclude-standard", "-z"], cwd, 10000);
  let partial = !diff.ok || !others.ok;
  const files = others.ok ? others.stdout.split("\0").filter(Boolean).sort() : [];
  if (files.length > MAX_UNTRACKED_HASHED) partial = true;
  const blobs: string[] = [];
  const hashed = files.slice(0, MAX_UNTRACKED_HASHED);
  for (let i = 0; i < hashed.length && !partial; i += HASH_BATCH) {
    const batch = hashed.slice(i, i + HASH_BATCH);
    const r = await run(["hash-object", "--", ...batch], cwd, 15000);
    const ids = r.ok ? r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
    if (!r.ok || ids.length !== batch.length || ids.some(id => !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(id))) { partial = true; break; }
    batch.forEach((f, j) => blobs.push(`${f}\0${ids[j]}`));
  }
  const fp = workingTreeFingerprint(status.stdout, diff.ok ? diff.stdout : "", blobs.join("\n") + (partial ? `\0partial\0${nonce()}` : ""));
  return { revision, dirty: true, workingTreeHash: fp.hash, coverage: partial ? "partial" : "complete", untracked: files.length };
}

/** Remote URLs accepted for `git ls-remote`: https or ssh, never with embedded credentials. */
export function safeRemoteUrl(url: string): string | undefined {
  const u = url.trim();
  if (/^https:\/\/[^\s/@:]+(:\d+)?\/[^\s]+$/.test(u)) return u;
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._\/-]+$/.test(u)) return u;
  if (/^ssh:\/\/git@[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._\/-]+$/.test(u)) return u;
  return undefined;
}

const BRANCH = /^[A-Za-z0-9._\/-]{1,200}$/;

export interface RemoteObservation {
  state: "observed" | "not-found" | "unreachable" | "rejected";
  url: string;
  ref: string;
  revision?: string;
  detail?: string;
  observedAt: string;
}

/**
 * Observe a remote revision without cloning. The result is a runtime observation of the
 * remote at a time; it says nothing about deployment state of any app built from it.
 */
export async function observeRemoteRevision(run: GitRunner, url: string, branch: string | undefined, now: string): Promise<RemoteObservation> {
  const safe = safeRemoteUrl(url);
  const ref = branch ?? "HEAD";
  if (!safe) return { state: "rejected", url: "<redacted>", ref, detail: "URL must be https/ssh without embedded credentials", observedAt: now };
  if (branch !== undefined && (!BRANCH.test(branch) || branch.startsWith("-") || branch.includes(".."))) {
    return { state: "rejected", url: safe, ref, detail: "invalid branch name", observedAt: now };
  }
  const target = branch ? `refs/heads/${branch}` : "HEAD";
  const r = await run(["ls-remote", "--", safe, target], "", 15000);
  if (!r.ok) return { state: "unreachable", url: safe, ref, detail: (r.stderr ?? "").split(/\r?\n/, 1)[0]?.slice(0, 200), observedAt: now };
  const line = r.stdout.split(/\r?\n/).find(l => l.trim());
  const sha = line?.split(/\s+/)[0];
  if (!sha || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return { state: "not-found", url: safe, ref, observedAt: now };
  return { state: "observed", url: safe, ref, revision: sha, observedAt: now };
}
