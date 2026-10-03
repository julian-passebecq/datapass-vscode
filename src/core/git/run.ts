/**
 * Git module (0.19): how the observer runs commands, kept pure for the unit tests — at most four at
 * once, and the one way a Windows batch script (az.cmd) may be started through cmd.exe.
 */
import { CMD_SAFE } from "./hostPrs";

/** At most `max` commands at once. */
export class Limiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    // A released slot is handed straight to the next waiter, so a newcomer can never slip in between.
    if (this.active < this.max) this.active++;
    else await new Promise<void>(resolve => this.queue.push(resolve));
    try { return await fn(); } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active--;
    }
  }
}

/**
 * A batch script (az.cmd) through cmd.exe, with every token double-quoted. Only tokens of a strict
 * character set are accepted, so nothing cmd.exe would interpret (%, ^, &, |, <, >, quotes) can reach it.
 */
export function cmdLine(script: string, args: readonly string[]): string | undefined {
  if (!/^[A-Za-z]:\\[A-Za-z0-9 ._()\\-]{1,300}\.cmd$/i.test(script)) return undefined;
  if (!args.every(a => CMD_SAFE.test(a))) return undefined;
  return `""${script}" ${args.map(a => `"${a}"`).join(" ")}"`;
}


/** DESKHARD3: a command that timed out is asked once more with at least this long (CI load, a slow first start). */
export const RETRY_TIMEOUT_MS = 20_000;

/**
 * Run once with `timeoutMs`; when that attempt timed out (and only then), run once more with at
 * least RETRY_TIMEOUT_MS. A real answer (success or failure) is never retried, so a refusal stays a
 * refusal; a second timeout is returned as is and the caller says "not checked", never "no".
 */
export async function retryOnTimeout<R extends { ok: boolean; timedOut?: boolean }>(run: (timeoutMs: number) => Promise<R>, timeoutMs: number, retryMs = RETRY_TIMEOUT_MS): Promise<R> {
  const first = await run(timeoutMs);
  if (first.ok || !first.timedOut) return first;
  return run(Math.max(timeoutMs, retryMs));
}

/**
 * V5HOLE14: how long past its own timeout a spawned command may take to report. On Windows, `execFile` calls back only
 * when stdout/stderr close; a grandchild that inherited them keeps them open after the timeout killed the parent, and the
 * check would never settle. Past this grace the caller resolves "timed out" itself.
 */
export const SPAWN_GRACE_MS = 2_000;

/** `p`, or `fallback()` when `p` has not settled within `ms` (a rejection also gives the fallback). Never hangs. */
export function settleWithin<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false;
    const finish = (v: T) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => finish(fallback()), ms);
    p.then(finish, () => finish(fallback()));
  });
}
