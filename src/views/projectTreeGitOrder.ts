/**
 * V5 STEPBAR1 (CEO ARCHI REVIEW B2): the `git` order of the Project lens (setting `datapass.tree.order`).
 * The files the project expects and finds are listed per repository as Git sees them: Tracked, then
 * Untracked; ignored files are hidden. Every file row carries its `resourceUri`, so VS Code's own Git
 * decorations (M / A / U, colours) show on it: DataPass adds no decoration provider of its own.
 *
 * Read-only Git: `git ls-files -z -- <paths>` (tracked) and `git ls-files -z --others --exclude-standard
 * -- <paths>` (untracked, not ignored), one pair per clone, never in Restricted Mode. A failed or
 * cut-short answer leaves files "unknown" (listed apart), never "ignored" (so never hidden by mistake).
 */
import { lsFilesArgs } from "../core/git/repoCache";
import { interpretLsFiles, type GitAnswer } from "../core/project/observation";

export const TREE_ORDERS = ["architecture", "git"] as const;
export type TreeOrder = (typeof TREE_ORDERS)[number];
export const parseTreeOrder = (v: unknown): TreeOrder => (v === "git" ? "git" : "architecture");

export type FileTracking = "tracked" | "untracked" | "ignored" | "unknown";

/** One answer pair → each path's state. Listed by the first = tracked; by the second = untracked; by neither = ignored. */
export function trackingOf(paths: readonly string[], tracked: GitAnswer | undefined, others: GitAnswer | undefined, caseInsensitive?: boolean): Map<string, FileTracking> {
  const t = interpretLsFiles(paths, tracked, caseInsensitive);
  const o = interpretLsFiles(paths, others, caseInsensitive);
  const out = new Map<string, FileTracking>();
  for (const p of paths) {
    const a = t.get(p)?.state, b = o.get(p)?.state;
    out.set(p, a === "tracked" ? "tracked" : a === "unknown" || b === "unknown" ? "unknown" : b === "tracked" ? "untracked" : "ignored");
  }
  return out;
}

export interface GitOrderGroups<F> { readonly tracked: F[]; readonly untracked: F[]; readonly unknown: F[] }

/** Files of one repository in the lens' groups; ignored ones dropped. Sorted by path inside a group. */
export function groupByTracking<F extends { repoPath: string }>(files: readonly F[], state: (f: F) => FileTracking | undefined): GitOrderGroups<F> {
  const g: GitOrderGroups<F> = { tracked: [], untracked: [], unknown: [] };
  for (const f of [...files].sort((a, b) => a.repoPath.localeCompare(b.repoPath))) {
    const s = state(f) ?? "unknown";
    if (s !== "ignored") g[s].push(f);
  }
  return g;
}

export type GitRead = (args: string[], cwd: string, timeoutMs: number) => Promise<GitAnswer>;

/** The per-repository answers, kept until `reset()` (the session changed); `load` asks Git once per clone. */
export class TrackingCache {
  private readonly known = new Map<string, Map<string, FileTracking>>();
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private readonly git: GitRead) {}

  get(repoKey: string, repoPath: string): FileTracking | undefined { return this.known.get(repoKey)?.get(repoPath); }
  has(repoKey: string): boolean { return this.known.has(repoKey); }
  reset(): void { this.known.clear(); }

  load(repoKey: string, folder: string, paths: readonly string[]): Promise<void> {
    const key = `${repoKey}\u0000${folder}`;
    const running = this.pending.get(key);
    if (running) return running;
    const p = (async () => {
      const args = lsFilesArgs([...paths]);
      const spec = args.includes("--") ? args.slice(args.indexOf("--")) : [];
      const [tracked, others] = await Promise.all([this.git(args, folder, 10000), this.git(["ls-files", "-z", "--others", "--exclude-standard", ...spec], folder, 10000)]);
      this.known.set(repoKey, trackingOf(paths, tracked, others));
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
}
