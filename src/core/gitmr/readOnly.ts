/**
 * V5 GITMR1 (TL-4, amended 13:00): the only way GITMR code talks to Git. `gitReadOnly(args)` accepts an argv from the
 * read-only allow-list and returns it prefixed with `--no-optional-locks` (not even the index is refreshed); anything else
 * throws. Allowed: status, log, rev-parse, for-each-ref, diff (always `--no-ext-diff`), ls-files, submodule status,
 * symbolic-ref (read form: one ref, no -d/-m) and `config --get <key>`. Never checkout, fetch, pull, push or any write.
 * This module never spawns: callers wrap the one allowed Git spawn helper (work/session.ts `gitRunner`, which asks
 * core/spawnAllowList.ts `checkSpawn` first) with `readOnlyGit`, so both allow-lists apply.
 */
import type { GitRunner } from "../workspace/gitBase";

/** Thrown for any argv outside the read-only allow-list. */
export class GitWriteRefused extends Error {
  constructor(readonly args: readonly string[], reason: string) {
    super(`git ${args.join(" ")}: refused (${reason})`);
    this.name = "GitWriteRefused";
  }
}

export const READ_ONLY_VERBS = ["status", "log", "rev-parse", "for-each-ref", "diff", "ls-files", "submodule", "symbolic-ref", "config"] as const;
const NO_LOCKS = "--no-optional-locks";
/** Flags that write a file or run an external program even under a read verb. */
const FORBIDDEN_FLAG = /^(?:--output(?:=|$)|-o$|--ext-diff$|--textconv$|--exec(?:-path)?(?:=|$)|--upload-pack|--receive-pack|-c$|--config-env)/;

/** The argv to run for a read-only question, or a `GitWriteRefused` throw. */
export function gitReadOnly(args: readonly string[]): string[] {
  const rest = args[0] === NO_LOCKS ? args.slice(1) : [...args];
  const [verb, ...tail] = rest;
  const refuse = (reason: string): never => { throw new GitWriteRefused(args, reason); };
  if (!verb || !(READ_ONLY_VERBS as readonly string[]).includes(verb)) refuse(`"${verb ?? ""}" is not a read-only verb`);
  const bad = tail.find(a => FORBIDDEN_FLAG.test(a));
  if (bad) refuse(`flag ${bad}`);
  const positionals = tail.filter(a => !a.startsWith("-"));
  switch (verb) {
    case "submodule":
      if (tail[0] !== "status") refuse("only `submodule status`");
      break;
    case "symbolic-ref":
      if (tail.some(a => /^(?:-d|--delete|-m)$/.test(a))) refuse("symbolic-ref may only read");
      if (positionals.length !== 1) refuse("symbolic-ref takes exactly one ref (two would write it)");
      break;
    case "config":
      if (tail.length !== 2 || tail[0] !== "--get" || tail[1]!.startsWith("-")) refuse("only `config --get <key>`");
      break;
    case "diff":
      if (!tail.includes("--no-ext-diff")) tail.unshift("--no-ext-diff");
      break;
  }
  return [NO_LOCKS, verb!, ...tail];
}

/** Wraps a runner so every call goes through `gitReadOnly` (a refused argv rejects without spawning anything). */
export function readOnlyGit(git: GitRunner): GitRunner {
  return (args, cwd, timeoutMs) => {
    let argv: string[];
    try { argv = gitReadOnly(args); } catch (e) { return Promise.reject(e); }
    return git(argv, cwd, timeoutMs);
  };
}

