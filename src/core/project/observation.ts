/**
 * The pure rules behind observing a project on this machine (0.22, FOIL review F02–F05): how many
 * reads run at once, how many bytes are hashed, how a Git answer becomes "tracked", "untracked" or
 * "unknown", and how an origin lookup becomes "ok", "absent" or "failed". The session
 * (work/projectObserver.ts) does the reading; this module decides what the answers mean.
 */
import type { RepoGitState, TrackingObservation } from "./resolve";

export interface GitAnswer { ok: boolean; stdout: string; stderr?: string }

/** At most this many file observations run at once. */
export const OBSERVE_CONCURRENCY = 16;
/** At most this many expected files are observed per refresh; the rest are reported as skipped. */
export const MAX_PLANNED_ENTRIES = 2000;
/** Files up to this size are read in one go; larger ones are streamed while the budget lasts. */
export const MAX_INLINE_HASH_BYTES = 2 * 1024 * 1024;
/** A single file larger than this is never hashed (size + time only). */
export const MAX_STREAM_HASH_BYTES = 64 * 1024 * 1024;
/** Total bytes hashed per refresh. */
export const HASH_BYTE_BUDGET = 256 * 1024 * 1024;
/** Paths per `git ls-files` call (command-line length). */
export const LS_FILES_BATCH = 50;

/** Run `fn` over `items` with at most `limit` calls in flight; results keep the input order. */
export async function runBounded<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** A shared byte budget: `take` reserves bytes and says whether they fit. */
export class ByteBudget {
  private used = 0;
  /** Files that did not fit (identified by size and time only). */
  denied = 0;
  constructor(readonly total: number) {}
  take(bytes: number): boolean {
    if (this.used + bytes > this.total) { this.denied++; return false; }
    this.used += bytes;
    return true;
  }
  get spent(): number { return this.used; }
}

/** How a file is identified given its size: read whole, streamed, or size + time only. */
export function hashMode(size: number, budget: ByteBudget): "inline" | "stream" | "stat" {
  if (size > MAX_STREAM_HASH_BYTES) { budget.denied++; return "stat"; }
  if (!budget.take(size)) return "stat";
  return size <= MAX_INLINE_HASH_BYTES ? "inline" : "stream";
}

/** Why an observation is incomplete, as the person reads it. */
export interface Incompleteness { skipped: number; reasons: string[] }

export function incompleteness(o: { planned: number; max: number; statOnly: number }): Incompleteness | undefined {
  const reasons: string[] = [];
  const skipped = Math.max(0, o.planned - o.max);
  if (skipped) reasons.push(`${skipped} expected file(s) beyond the first ${o.max} were not inspected`);
  if (o.statOnly) reasons.push(`${o.statOnly} large file(s) identified by size and date only (not hashed)`);
  return reasons.length ? { skipped, reasons } : undefined;
}

export function incompleteText(i: Incompleteness): string {
  return `inspection incomplete (${i.skipped} skipped)${i.reasons.length ? `: ${i.reasons.join("; ")}` : ""}`;
}

/**
 * The origin of a clone from `git config --get remote.origin.url` and, when that failed, `git remote`
 * (which tells "no origin" from "Git could not answer"). `git config --get` exits 1 for a missing key,
 * so its failure alone proves nothing.
 */
export function interpretOrigin(config: GitAnswer, remotes?: GitAnswer): Pick<RepoGitState, "originUrl" | "originLookup"> {
  const url = config.ok ? config.stdout.trim() : "";
  if (url) return { originUrl: url, originLookup: "ok" };
  if (config.ok) return { originLookup: "absent" };
  if (!remotes?.ok) return { originLookup: "failed" };
  const names = remotes.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return { originLookup: names.includes("origin") ? "failed" : "absent" };
}

/**
 * Tracking of `paths` from one `git ls-files -z -- <paths>` answer. A failed call, or output that
 * does not end with the NUL terminator (cut short), leaves every path "unknown" with the reason:
 * never "untracked".
 */
export function interpretLsFiles(paths: readonly string[], answer: GitAnswer | undefined, caseInsensitive = process.platform === "win32"): Map<string, TrackingObservation> {
  const out = new Map<string, TrackingObservation>();
  const unknown = (reason: string) => { for (const p of paths) out.set(p, { state: "unknown", reason }); return out; };
  if (!answer) return unknown("Git was not run");
  if (!answer.ok) return unknown(`git ls-files failed${answer.stderr ? `: ${answer.stderr.split(/\r?\n/, 1)[0]!.slice(0, 120)}` : ""}`);
  if (answer.stdout.length && !answer.stdout.endsWith("\0")) return unknown("git ls-files output was cut short");
  const norm = (p: string) => { const q = p.replace(/\\/g, "/").replace(/^\.\//, ""); return caseInsensitive ? q.toLowerCase() : q; };
  const listed = new Set(answer.stdout.split("\0").filter(Boolean).map(norm));
  for (const p of paths) out.set(p, { state: listed.has(norm(p)) ? "tracked" : "untracked" });
  return out;
}

/** `paths` in groups for `git ls-files` calls. */
export function batches<T>(items: readonly T[], size = LS_FILES_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
