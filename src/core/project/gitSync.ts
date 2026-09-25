/**
 * "The AI finished; get its work" (V3, audit F12). Pure helpers around four explicit steps, each
 * a separate user action, none automatic:
 *
 *   Re-inspect   read local state again (no network)
 *   Check        `git fetch` the remote: see what is new, change nothing locally
 *   Get          fast-forward only (`git merge --ff-only @{u}`), after a confirmation listing the commits
 *   Push         never done by DataPass
 *
 * VS Code's Sync button pulls and pushes; DataPass does not use it. A diverged branch, local changes
 * to tracked files or a missing upstream send the user to Source Control instead.
 */
import type { RepoGitState } from "./resolve";
import type { ProjectMap } from "./projectMap";

export interface IncomingCommit { sha: string; author: string; date: string; subject: string }

const SEP = "\u001f";

/** Arguments for the incoming-commit log (HEAD..@{u}); parse with parseIncomingLog. */
export const INCOMING_LOG_ARGS = ["log", `--format=%H${SEP}%an${SEP}%aI${SEP}%s`, "-n", "30", "HEAD..@{u}"];

export function parseIncomingLog(stdout: string): IncomingCommit[] {
  return stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const [sha = "", author = "", date = "", ...rest] = line.split(SEP);
    return { sha, author, date, subject: rest.join(SEP) };
  }).filter(c => /^[0-9a-f]{7,64}$/.test(c.sha));
}

export type SyncVerdict =
  | { kind: "up-to-date" }
  | { kind: "can-fast-forward"; behind: number }
  | { kind: "local-changes"; behind: number; trackedChanges: number }
  | { kind: "diverged"; ahead: number; behind: number }
  | { kind: "ahead-only"; ahead: number }
  | { kind: "no-upstream" }
  | { kind: "not-a-repo" };

/** What "Get updates" may do for one repository, from its local state after a fetch. */
export function syncVerdict(git: (RepoGitState & { trackedChanges?: number }) | undefined): SyncVerdict {
  if (!git) return { kind: "not-a-repo" };
  if (!git.upstream) return { kind: "no-upstream" };
  const ahead = git.ahead ?? 0, behind = git.behind ?? 0;
  if (!behind) return ahead ? { kind: "ahead-only", ahead } : { kind: "up-to-date" };
  if (ahead) return { kind: "diverged", ahead, behind };
  if (git.trackedChanges) return { kind: "local-changes", behind, trackedChanges: git.trackedChanges };
  return { kind: "can-fast-forward", behind };
}

export function describeVerdict(v: SyncVerdict): string {
  switch (v.kind) {
    case "up-to-date": return "up to date with the remote (as of the last check)";
    case "can-fast-forward": return `${v.behind} new commit${v.behind === 1 ? "" : "s"} to get`;
    case "local-changes": return `${v.behind} new commit(s), but ${v.trackedChanges} local change(s) to tracked files: commit or stash them in Source Control first`;
    case "diverged": return `diverged (${v.ahead} local, ${v.behind} remote): merge or rebase in Source Control`;
    case "ahead-only": return `${v.ahead} local commit(s) not pushed (DataPass never pushes)`;
    case "no-upstream": return "no upstream branch: set one in Source Control";
    case "not-a-repo": return "not a Git repository";
  }
}

/** Paths from `git diff --name-status A B` (renames give the new path). */
export function parseNameStatus(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    out.push((parts[parts.length - 1] ?? "").replace(/\\/g, "/"));
  }
  return out;
}

/** Components whose expected files are among the changed paths of one repository. */
export function changedComponents(map: ProjectMap, repoKey: string, changedPaths: readonly string[]): Array<{ id: string; label: string; files: string[] }> {
  const changed = new Set(changedPaths);
  const out: Array<{ id: string; label: string; files: string[] }> = [];
  for (const c of map.components) {
    const a = c.artifacts;
    if (!a || a.repoKey !== repoKey) continue;
    const root = a.root === "." ? "" : `${a.root.replace(/\/+$/, "")}/`;
    const files = [...changed].filter(p => a.files.some(f => f.repoPath === p || (f.kind !== "file" && p.startsWith(`${f.repoPath}/`))) || (root && p.startsWith(root)));
    if (files.length) out.push({ id: c.id, label: c.label, files });
  }
  return out;
}
