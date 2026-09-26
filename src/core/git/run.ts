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

