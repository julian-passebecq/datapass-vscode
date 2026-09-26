/**
 * Git module (0.19, pass AI-1): parsers for the read-only Git commands the Git view runs. Pure.
 *
 *   git status --porcelain=v2 --branch --untracked-files=normal   → statusCounts / parseStatusV2
 *   git worktree list --porcelain                                  → parseWorktrees
 *   git log -3 --merges --first-parent --format=%H%x09%cI%x09%s    → parseMergeLog
 *   git for-each-ref --format=%(refname:short) --merged=<ref>      → parseRefList
 *
 * Everything here is untrusted text from a repository: branch names and paths are bounded, control
 * characters are dropped, and anything that does not have the documented shape is ignored.
 */

/** Staged, unstaged, untracked and conflicted entries of `git status --porcelain=v2`. */
export interface StatusCounts { staged: number; unstaged: number; untracked: number; conflicted: number }

export function statusCounts(stdout: string): StatusCounts {
  const out: StatusCounts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("? ")) out.untracked++;
    else if (line.startsWith("u ")) out.conflicted++;
    else if (/^[12] [A-Z.]{2} /.test(line)) {
      // XY: X is the index (staged) side, Y the working tree side; "." means unchanged.
      if (line[2] !== ".") out.staged++;
      if (line[3] !== ".") out.unstaged++;
    }
  }
  return out;
}

/** Printable, bounded text: no control characters (a branch or path name cannot move the cursor or fake a line). */
export function clean(text: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const isSha = (s: string | undefined): s is string => !!s && SHA.test(s);

export interface WorktreeEntry {
  /** Absolute path as Git prints it (forward slashes on Windows). */
  path: string;
  head?: string;
  /** Short branch name (refs/heads/ removed); undefined when detached or bare. */
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export const MAX_WORKTREES = 30;

/** `git worktree list --porcelain`: blocks separated by a blank line; the first block is the main worktree. */
export function parseWorktrees(stdout: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  for (const block of stdout.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const lines = block.split("\n").filter(Boolean);
    const first = lines[0];
    if (!first?.startsWith("worktree ")) continue;
    const path = first.slice(9);
    if (!path || path.length > 1024 || /[\u0000-\u001f]/.test(path)) continue;
    const w: WorktreeEntry = { path, detached: false, bare: false, locked: false, prunable: false };
    for (const l of lines.slice(1)) {
      if (l.startsWith("HEAD ")) { const h = l.slice(5).trim(); if (isSha(h)) w.head = h; }
      else if (l.startsWith("branch ")) { const b = l.slice(7).trim(); if (b.startsWith("refs/heads/") && b.length <= 250) w.branch = clean(b.slice(11), 250); }
      else if (l === "detached") w.detached = true;
      else if (l === "bare") w.bare = true;
      else if (l === "locked" || l.startsWith("locked ")) w.locked = true;
      else if (l === "prunable" || l.startsWith("prunable ")) w.prunable = true;
    }
    out.push(w);
    if (out.length >= MAX_WORKTREES + 1) break;
  }
  return out;
}

export interface MergeCommit { sha: string; date: string; subject: string }

/** `git log --merges --first-parent --format=%H%x09%cI%x09%s` (the fallback for recent merges without a host CLI). */
export function parseMergeLog(stdout: string, max = 3): MergeCommit[] {
  const out: MergeCommit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [sha = "", date = "", ...rest] = line.split("\t");
    if (!isSha(sha) || !/^\d{4}-\d\d-\d\dT/.test(date)) continue;
    out.push({ sha, date, subject: clean(rest.join("\t")) });
    if (out.length >= max) break;
  }
  return out;
}

/** One short ref name per line (`git for-each-ref --format=%(refname:short)`). */
export function parseRefList(stdout: string, max = 2000): Set<string> {
  const out = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const r = line.trim();
    if (r && r.length <= 250 && !/[\u0000-\u001f]/.test(r)) out.add(r);
    if (out.size >= max) break;
  }
  return out;
}

/** `git symbolic-ref --short refs/remotes/origin/HEAD` → "main" (from "origin/main"). */
export function parseDefaultBranch(stdout: string): string | undefined {
  const r = stdout.trim();
  const m = /^[^/\s]+\/(.+)$/.exec(r);
  return m && isBranchName(m[1]!) ? m[1] : undefined;
}

/** A branch name DataPass will put into a copied command or a Git argument. */
export function isBranchName(b: string): boolean {
  return /^[A-Za-z0-9._\/+-]{1,200}$/.test(b) && !b.startsWith("-") && !b.includes("..") && !b.endsWith(".lock") && !b.endsWith("/") && !b.startsWith("/");
}

/** Oldest line of `git log --format=%cI` output (newest first), or undefined. */
export function oldestDate(stdout: string): { count: number; oldest?: string } {
  const dates = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => /^\d{4}-\d\d-\d\dT/.test(l));
  return { count: dates.length, oldest: dates[dates.length - 1] };
}
