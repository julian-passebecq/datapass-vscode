/**
 * V3-GITDIAG (vision §2.3 "supercharged Git"): change sets drawn on the diagram blocks whose files
 * they touch. Pure (no `vscode`): the git arguments, the parsers of their `-z` output, the mapping of
 * change sets onto components and the per-block badge. Read-only: nothing here fetches or writes.
 *
 *   Local changes   uncommitted (`git status`) + committed but not pushed (`@{u}...HEAD`), per repository
 *   Pull request    an open PR of the Git view whose branch is already fetched: `origin/<base>...origin/<head>`
 *
 * Bounded: the first MAX_FILES changed files of each change set, MAX_PRS_PER_REPO PRs per repository.
 */
import type { ProjectMap } from "../project/projectMap";
import { changedComponents } from "../project/gitSync";
import type { CiState } from "./hostPrs";
import { isBranchName } from "./porcelain";

export const MAX_FILES = 200;
export const MAX_PRS_PER_REPO = 20;

export const LOCAL_STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
export const UNPUSHED_ARGS = ["diff", "--name-status", "-z", "-M", "@{u}...HEAD"];

/** `git diff` of a pull request: its fetched branch against the merge base with the default branch. */
export function prDiffArgs(defaultBranch: string, head: string): string[] | undefined {
  if (!isBranchName(defaultBranch) || !isBranchName(head)) return undefined;
  return ["diff", "--name-status", "-z", "-M", `refs/remotes/origin/${defaultBranch}...refs/remotes/origin/${head}`];
}

const clip = (paths: string[], max: number) => ({ files: [...new Set(paths)].slice(0, max), truncated: new Set(paths).size > max });

/** Paths of `git status --porcelain=v1 -z` (a rename gives both the new and the old path). */
export function porcelainPaths(stdout: string, max = MAX_FILES): { files: string[]; truncated: boolean } {
  const parts = stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i]!;
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    out.push(e.slice(3).replace(/\\/g, "/"));
    // Renames and copies carry the original path as the next NUL-separated field.
    if (/[RC]/.test(xy) && parts[i + 1]) { out.push(parts[i + 1]!.replace(/\\/g, "/")); i += 1; }
  }
  return clip(out.filter(Boolean), max);
}

/** Paths of `git diff --name-status -z` (a rename or copy gives both paths). */
export function nameStatusPaths(stdout: string, max = MAX_FILES): { files: string[]; truncated: boolean } {
  const parts = stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i] ?? "";
    if (!/^[ACDMRTUXB]\d*$/.test(status)) { i += 1; continue; }
    const two = /^[RC]/.test(status);
    for (const p of parts.slice(i + 1, i + (two ? 3 : 2))) if (p) out.push(p.replace(/\\/g, "/"));
    i += two ? 3 : 2;
  }
  return clip(out, max);
}

export type ChangeSetKind = "local" | "pr";

export interface ChangeSet {
  repoKey: string;
  repoLabel: string;
  kind: ChangeSetKind;
  /** "local:<repo>" or "pr:<repo>#<n>". */
  key: string;
  title: string;
  number?: number;
  ci?: CiState;
  /** Repository-relative paths (old and new path of a rename), at most MAX_FILES. */
  files: string[];
  truncated: boolean;
  /** A short sentence about what the set holds ("3 uncommitted · 2 commits not pushed"). */
  detail?: string;
}

/** The worst state of a block's change sets; local changes have no CI. */
export type BadgeState = "failing" | "running" | "unknown" | "passing" | "none" | "local";
const RANK: Record<BadgeState, number> = { failing: 5, running: 4, unknown: 3, passing: 2, none: 1, local: 0 };

export interface BlockChangeSet { key: string; kind: ChangeSetKind; repoKey: string; title: string; number?: number; state: BadgeState; files: string[] }
export interface BlockGit { count: number; worst: BadgeState; sets: BlockChangeSet[] }
export interface DiagramGit {
  byComponent: Record<string, BlockGit>;
  /** Change sets (or parts of them) that touch no component, for the legend's count. */
  outside: Array<{ key: string; title: string; files: number }>;
}

export function setState(s: Pick<ChangeSet, "kind" | "ci">): BadgeState {
  return s.kind === "local" ? "local" : s.ci ?? "unknown";
}

export function worstState(states: readonly BadgeState[]): BadgeState {
  return states.reduce<BadgeState>((w, s) => (RANK[s] > RANK[w] ? s : w), "local");
}

/** Maps each change set onto the components of its repository whose files it touches. */
export function mapChangeSets(map: Pick<ProjectMap, "components">, sets: readonly ChangeSet[]): DiagramGit {
  const byComponent: Record<string, BlockGit> = {};
  const outside: DiagramGit["outside"] = [];
  for (const s of sets) {
    const hits = changedComponents(map as ProjectMap, s.repoKey, s.files);
    const placed = new Set(hits.flatMap(h => h.files));
    const rest = s.files.filter(f => !placed.has(f)).length;
    if (rest) outside.push({ key: s.key, title: s.title, files: rest });
    for (const h of hits) {
      const b = (byComponent[h.id] ??= { count: 0, worst: "local", sets: [] });
      b.sets.push({ key: s.key, kind: s.kind, repoKey: s.repoKey, title: s.title, number: s.number, state: setState(s), files: h.files.slice(0, 50) });
      b.count = b.sets.length;
      b.worst = worstState(b.sets.map(x => x.state));
    }
  }
  return { byComponent, outside };
}

const STATE_TEXT: Record<BadgeState, string> = { failing: "CI failing", running: "CI running", unknown: "CI unknown", passing: "CI passing", none: "no CI", local: "on this computer" };
export const badgeStateText = (s: BadgeState) => STATE_TEXT[s];

/** The badge's tooltip: one line per change set (the hover list). */
export function badgeTitle(b: BlockGit): string {
  const lines = b.sets.slice(0, 12).map(s => `${s.kind === "pr" ? `PR #${s.number}` : "Local"} — ${s.title} (${STATE_TEXT[s.state]}, ${s.files.length} file${s.files.length === 1 ? "" : "s"})`);
  if (b.sets.length > 12) lines.push(`… and ${b.sets.length - 12} more`);
  return `Git: ${b.count} change set${b.count === 1 ? "" : "s"} touch this block\n${lines.join("\n")}\nClick to open one.`;
}
