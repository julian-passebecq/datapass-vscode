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
}

const EMPTY = sha256Bytes(new Uint8Array());

/** Fingerprint of uncommitted state. Clean trees always produce the hash of empty input. */
export function workingTreeFingerprint(statusPorcelain: string, diff: string): { dirty: boolean; hash: Sha256 } {
  if (!statusPorcelain.trim()) return { dirty: false, hash: EMPTY };
  return { dirty: true, hash: sha256Bytes(new TextEncoder().encode(`status\0${statusPorcelain}\0diff\0${diff}`)) };
}

export async function readRepoRevision(run: GitRunner, cwd: string): Promise<RepoRevision> {
  const head = await run(["rev-parse", "--verify", "HEAD"], cwd, 5000);
  if (!head.ok) return { revision: "unversioned", dirty: true, workingTreeHash: EMPTY };
  const status = await run(["status", "--porcelain=v1", "--untracked-files=normal"], cwd, 10000);
  const diff = status.ok && status.stdout.trim() ? await run(["diff", "HEAD", "--no-color", "--no-ext-diff"], cwd, 15000) : { ok: true, stdout: "" };
  const fp = workingTreeFingerprint(status.ok ? status.stdout : "status-unavailable", diff.ok ? diff.stdout : "diff-unavailable");
  return { revision: head.stdout.trim(), dirty: fp.dirty, workingTreeHash: fp.hash };
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
