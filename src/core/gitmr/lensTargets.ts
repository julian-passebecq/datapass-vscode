/**
 * V5 GITMR2 (PM 30 ruling, CEO review B3: one repo-status surface): the GITMR1 repo set feeds the Git lens. Each repo-set
 * repository the project map does not already list becomes a project row of the Git view (status, branch, ahead/behind,
 * worktrees, PRs: the lens's own read). Pure: the observer discovers the set and passes the folders it already shows.
 */
import * as path from "node:path";
import { REPO_SET_ROOT_PATH, type RepoSet, type RepoSetRole } from "./repoSetContract";

/** Key prefix of a Git-lens row that comes from the repo set (never collides with project-map repository keys). */
export const REPO_SET_KEY_PREFIX = "repo-set:";

export interface RepoSetLensTarget {
  readonly key: string;
  readonly label: string;
  readonly role: RepoSetRole;
  readonly folder: string;
  readonly remoteUrl?: string;
  readonly defaultHint?: string;
  /**
   * V5HOLE17: only a workspace folder (not declared in repos.json, no submodule): when it is not a Git repository it is no
   * lane at all, so a workspace outside any repository shows the view's "no repository" state.
   */
  readonly optional?: boolean;
}

/** Folder identity for comparisons (case-insensitive on Windows). */
export function sameFolder(a: string, b: string): boolean {
  const n = (p: string) => path.resolve(p).replace(/[\/]+$/, "");
  return process.platform === "win32" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

/** Repo-set repositories not already shown (by folder), in repo-set order. The label is the folder name (root: the root's). */
export function repoSetLensTargets(set: Pick<RepoSet, "repos">, root: string, shown: readonly string[]): RepoSetLensTarget[] {
  const out: RepoSetLensTarget[] = [];
  for (const r of set.repos) {
    const folder = r.path === REPO_SET_ROOT_PATH ? root : path.join(root, ...r.path.split("/"));
    if (shown.some(f => sameFolder(f, folder)) || out.some(t => sameFolder(t.folder, folder))) continue;
    out.push({
      key: `${REPO_SET_KEY_PREFIX}${r.id}`, label: path.basename(folder) || r.id, role: r.role, folder,
      ...(r.remote ? { remoteUrl: r.remote.url } : {}), ...(r.defaultBranch ? { defaultHint: r.defaultBranch } : {}),
      ...(r.source === "workspace-folder" && r.role === "other" ? { optional: true } : {})
    });
  }
  return out;
}
