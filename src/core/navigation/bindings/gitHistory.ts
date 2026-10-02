/**
 * V4-NAV NAVHIST1 — `git-history` binding: the recent commits of the current artifact's files, as rows
 * for the `diff-history` layout. Read-only: `git log --follow` (renames followed, bounded) and `git show`
 * through the existing `datapass-rev:` content provider. "Go back" opens an old revision read-only; nothing
 * ever checks out, fetches or writes. Pure: Git, URIs and editor commands are injected by the host.
 */
import * as path from "node:path";
import type { GitRunner } from "../../workspace/gitBase";
import type { ViewDef } from "../navTypes";
import { fileLogArgs, parseFileLog, relativeFromPrefix, type FileRevision, type RevRequest } from "../../git/fileVersions";

export const GIT_HISTORY_SOURCE = "git-history";
/** Rows across all the artifact's files, newest first. */
export const HISTORY_LIMIT = 100;
/** At most this many files of one artifact are read (one `git log` each). */
export const HISTORY_MAX_FILES = 20;

/** Texts shown by the view; replaceable by a ViewDef's params or a setting, never hard-coded in the layout. */
export interface GitHistoryLabels {
  restricted: string;
  noFiles: string;
  notInRepo: string;
  logFailed: string;
  noCommits: string;
  truncated: string;
  /** Tab title of the diff: {file} {sha} {subject}. */
  diffTitle: string;
  /** Note in a read-only revision's tab: {sha} {date}. */
  revisionNote: string;
}

export const DEFAULT_GIT_HISTORY_LABELS: GitHistoryLabels = {
  restricted: "Restricted Mode: trust this workspace before DataPass runs Git.",
  noFiles: "This artifact has no file on this computer.",
  notInRepo: "{file} is not in a Git repository.",
  logFailed: "Git could not read the history of {file}.",
  noCommits: "{file} has no commits yet.",
  truncated: "Only the newest {limit} commits are listed.",
  diffTitle: "{file} ({sha} ↔ working file)",
  revisionNote: "{sha} {date}"
};

export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** One file of the artifact, located in its repository. */
export interface HistoryFile { repo: string; rel: string; fsPath: string }

export interface GitHistoryRow {
  /** `<sha>:<working file>` — unique when one commit touched several files of the artifact. */
  id: string;
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  /** Repository-relative path at that revision (differs before a rename). */
  path: string;
  repo: string;
  /** Absolute path of the working file the row compares with. */
  file: string;
  pr?: number;
  /** § 34 origin: read from the repository, nothing executed. */
  origin: "static";
}

export interface GitHistoryResult {
  rows: GitHistoryRow[];
  holes: { reason: string }[];
  origin: "static";
}

export const HISTORY_ACTIONS = ["open-diff", "open-revision"] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** Built-in view offered on every artifact ("*" in the catalog); title and order are overridable. */
export const GIT_HISTORY_VIEW: ViewDef = {
  id: "history", title: "History", layout: "diff-history", bindings: [{ source: GIT_HISTORY_SOURCE, params: { limit: HISTORY_LIMIT } }],
  description: "Recent commits of this artifact's files: diff with the working file, or open an old version read-only."
};

/** Rows of every file, newest first, one per (commit, file), capped at `limit`. */
export function mergeHistories(perFile: readonly { file: HistoryFile; revs: readonly FileRevision[] }[], limit = HISTORY_LIMIT): GitHistoryRow[] {
  const seen = new Set<string>();
  const rows: GitHistoryRow[] = [];
  for (const { file, revs } of perFile) {
    for (const r of revs) {
      const id = `${r.sha}:${file.fsPath}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id, sha: r.sha, short: r.sha.slice(0, 7), date: r.date, author: r.author, subject: r.subject, path: r.path,
        repo: file.repo, file: file.fsPath, ...(r.pr !== undefined ? { pr: r.pr } : {}), origin: "static"
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
  return rows.slice(0, limit);
}

/** Locate a file in its repository: Git computes the prefix, so 8.3 paths or drive case cannot escape it. */
export async function locateFile(git: GitRunner, fsPath: string): Promise<HistoryFile | undefined> {
  const r = await git(["rev-parse", "--show-toplevel", "--show-prefix"], path.dirname(fsPath), 5000);
  const [top, prefix = ""] = r.stdout.split(/\r?\n/);
  if (!r.ok || !top?.trim()) return undefined;
  const rel = relativeFromPrefix(prefix, path.basename(fsPath));
  return rel ? { repo: path.normalize(top.trim()), rel, fsPath } : undefined;
}

export interface GitHistoryParams {
  /** Absolute paths of the artifact's files (the host resolves them from the NavLocation). */
  files: readonly string[];
  labels?: Partial<GitHistoryLabels>;
  limit?: number;
}

/** The binding provider: never a guess — a file that cannot be read becomes a hole with its reason. */
export async function provideGitHistory(git: GitRunner, trusted: boolean, params: GitHistoryParams): Promise<GitHistoryResult> {
  const L = { ...DEFAULT_GIT_HISTORY_LABELS, ...params.labels };
  const limit = Math.max(1, Math.min(HISTORY_LIMIT, params.limit ?? HISTORY_LIMIT));
  const holes: { reason: string }[] = [];
  if (!trusted) return { rows: [], holes: [{ reason: L.restricted }], origin: "static" };
  const files = [...new Set(params.files.filter(f => typeof f === "string" && path.isAbsolute(f)))].slice(0, HISTORY_MAX_FILES);
  if (!files.length) return { rows: [], holes: [{ reason: L.noFiles }], origin: "static" };
  const perFile: { file: HistoryFile; revs: FileRevision[] }[] = [];
  for (const fsPath of files) {
    const name = path.basename(fsPath);
    const file = await locateFile(git, fsPath);
    if (!file) { holes.push({ reason: fill(L.notInRepo, { file: name }) }); continue; }
    const log = await git(fileLogArgs(file.rel, limit), file.repo, 20000);
    if (!log.ok) { holes.push({ reason: fill(L.logFailed, { file: file.rel }) }); continue; }
    const revs = parseFileLog(log.stdout, file.rel, limit);
    if (!revs.length) { holes.push({ reason: fill(L.noCommits, { file: file.rel }) }); continue; }
    perFile.push({ file, revs });
  }
  const total = perFile.reduce((n, p) => n + p.revs.length, 0);
  const rows = mergeHistories(perFile, limit);
  if (total > rows.length || perFile.some(p => p.revs.length >= limit)) holes.push({ reason: fill(L.truncated, { limit }) });
  return { rows, holes, origin: "static" };
}

/** What the host opens for a row: never a checkout, always a read-only revision. */
export type HistoryOpen =
  | { kind: "diff"; left: RevRequest; leftNote: string; right: string; title: string }
  | { kind: "revision"; rev: RevRequest; note: string };

export function historyOpen(row: GitHistoryRow, action: HistoryAction, labels: Partial<GitHistoryLabels> = {}): HistoryOpen {
  const L = { ...DEFAULT_GIT_HISTORY_LABELS, ...labels };
  const rev: RevRequest = { repo: row.repo, sha: row.sha, path: row.path };
  const note = fill(L.revisionNote, { sha: row.short, date: row.date.slice(0, 10) });
  if (action === "open-revision") return { kind: "revision", rev, note };
  return { kind: "diff", left: rev, leftNote: note, right: row.file, title: fill(L.diffTitle, { file: path.basename(row.file), sha: row.short, subject: row.subject.slice(0, 60) }) };
}

/** A webview `select`/action message for a history row, validated (untrusted input). */
export function vetHistoryMessage(raw: unknown, rows: readonly GitHistoryRow[]): { row: GitHistoryRow; action: HistoryAction } | undefined {
  const m = raw as { rowId?: unknown; action?: unknown } | null;
  if (!m || typeof m !== "object" || typeof m.rowId !== "string" || typeof m.action !== "string") return undefined;
  if (!(HISTORY_ACTIONS as readonly string[]).includes(m.action)) return undefined;
  const row = rows.find(r => r.id === m.rowId);
  return row ? { row, action: m.action as HistoryAction } : undefined;
}

/** Host side, with editor commands injected: `vscode.diff` against the working file, or `vscode.open` read-only. */
export interface HistoryOpener<U> {
  revUri(req: RevRequest, note: string): U;
  fileUri(fsPath: string): U;
  executeCommand(id: string, ...args: unknown[]): Thenable<unknown> | Promise<unknown>;
}

export async function openHistoryRow<U>(o: HistoryOpener<U>, row: GitHistoryRow, action: HistoryAction, labels?: Partial<GitHistoryLabels>): Promise<void> {
  const what = historyOpen(row, action, labels);
  if (what.kind === "revision") await o.executeCommand("vscode.open", o.revUri(what.rev, what.note), { preview: true });
  else await o.executeCommand("vscode.diff", o.revUri(what.left, what.leftNote), o.fileUri(what.right), what.title, { preview: true });
}
