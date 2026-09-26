/**
 * V1-REF: what a clone's slow Git answers depend on, and a cache of those answers.
 *
 * A refresh asks each clone for its origin (`git config` / `git remote`) and whether some files are
 * tracked (`git ls-files`). Those answers only change when HEAD, the index or the repository's
 * config change, and all three can be read from disk without starting Git. The fingerprint below is
 * built from them; while it is unchanged the cached answers are reused. `git status` is not cached:
 * editing a file changes it without touching HEAD, the index or the config.
 *
 * Reads a few small files under the clone's Git folder (never runs Git, never writes); the session
 * (work/projectObserver.ts) decides when to ask Git.
 */
import * as path from "node:path";
import { promises as fsp } from "node:fs";
import type { GitAnswer } from "../project/observation";
import type { TrackingObservation } from "../project/resolve";

/** Git processes (status, config, ls-files) run at once during a refresh. */
export const GIT_CONCURRENCY = 4;
/** Above this many characters of paths, one `git ls-files -z` lists the whole index instead. */
export const LS_FILES_PATHSPEC_CHARS = 6000;

/** The folder a `.git` file points to (`gitdir: <path>`, relative to the clone), else undefined. */
export function gitDirFromFile(content: string, folder: string): string | undefined {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(content);
  return m ? path.resolve(folder, m[1]!) : undefined;
}

/** The ref HEAD points to (`ref: refs/heads/main`), undefined for a detached HEAD. */
export function headRef(head: string): string | undefined {
  const m = /^ref:\s*(\S+)\s*$/m.exec(head);
  return m && /^refs\/[^\0\\:]+$/.test(m[1]!) &&!m[1]!.split("/").includes("..") ? m[1] : undefined;
}

export interface FingerprintParts {
  /** Contents of HEAD. */
  head: string;
  /** Contents of the loose ref HEAD names, or "packed:<mtime>" when only packed-refs holds it. */
  ref?: string;
  /** mtime and size of the index; undefined when there is no index (a fresh clone of nothing). */
  index?: { mtimeMs: number; size: number };
  /** mtime of the config file(s): the clone's and, for a linked worktree, the common one. */
  configMtimeMs: number[];
}

export function fingerprintKey(p: FingerprintParts): string {
  return [
    p.head.trim(),
    p.ref?.trim() ?? "-",
    p.index ? `${p.index.mtimeMs}:${p.index.size}` : "no-index",
    p.configMtimeMs.join(",")
  ].join("|");
}

export interface CachedRepo {
  key: string;
  /** Answers of `git config --get remote.origin.url` and, when it failed, `git remote`. */
  config?: GitAnswer;
  remotes?: GitAnswer;
  /** Tracking of the paths already asked, by path. */
  tracking: Map<string, TrackingObservation>;
}

/** Answers per clone folder, dropped as soon as the clone's fingerprint changes. */
export class RepoCache {
  private readonly byFolder = new Map<string, CachedRepo>();
  constructor(private readonly max = 100) {}

  /** The entry for this folder and fingerprint (a fresh one when it changed or there was none). */
  entry(folder: string, key: string | undefined): CachedRepo {
    const id = path.resolve(folder);
    const hit = key !== undefined ? this.byFolder.get(id) : undefined;
    if (hit && hit.key === key) return hit;
    const fresh: CachedRepo = { key: key ?? "", tracking: new Map() };
    // Without a fingerprint nothing is kept: the next refresh asks Git again.
    if (key === undefined) return fresh;
    this.byFolder.delete(id);
    if (this.byFolder.size >= this.max) this.byFolder.delete(this.byFolder.keys().next().value!);
    this.byFolder.set(id, fresh);
    return fresh;
  }

  clear(): void { this.byFolder.clear(); }
  get size(): number { return this.byFolder.size; }
}

/**
 * One `git ls-files` call for all of a clone's paths: the paths themselves when they fit on a
 * command line, else the whole index (then read as a membership list by interpretLsFiles).
 */
export function lsFilesArgs(paths: readonly string[], maxChars = LS_FILES_PATHSPEC_CHARS): string[] {
  const chars = paths.reduce((n, p) => n + p.length + 3, 0);
  return chars <= maxChars ? ["ls-files", "-z", "--", ...paths] : ["ls-files", "-z"];
}

/** The clone's Git folder and fingerprint, read from disk without running Git (undefined: not known). */
export async function repoFingerprint(folder: string): Promise<{ gitDir: string; key: string } | undefined> {
  try {
    const dotGit = path.join(folder, ".git");
    const s = await fsp.lstat(dotGit);
    const gitDir = s.isDirectory() ? dotGit : s.isFile() ? gitDirFromFile(await fsp.readFile(dotGit, "utf8"), folder) : undefined;
    if (!gitDir) return undefined;
    let common = gitDir;
    try { common = path.resolve(gitDir, (await fsp.readFile(path.join(gitDir, "commondir"), "utf8")).trim()); } catch { /* not a linked worktree */ }
    const head = await fsp.readFile(path.join(gitDir, "HEAD"), "utf8");
    const refName = headRef(head);
    let ref: string | undefined;
    if (refName) {
      try { ref = await fsp.readFile(path.join(common, ...refName.split("/")), "utf8"); }
      catch { ref = `packed:${(await fsp.stat(path.join(common, "packed-refs")).catch(() => undefined))?.mtimeMs ?? "none"}`; }
    }
    const index = await fsp.stat(path.join(gitDir, "index")).catch(() => undefined);
    const configs = [...new Set([path.join(common, "config"), path.join(gitDir, "config.worktree")])];
    const configMtimeMs = await Promise.all(configs.map(c => fsp.stat(c).then(x => x.mtimeMs, () => 0)));
    return { gitDir, key: fingerprintKey({ head, ref, index: index ? { mtimeMs: index.mtimeMs, size: index.size } : undefined, configMtimeMs }) };
  } catch { return undefined; }
}
