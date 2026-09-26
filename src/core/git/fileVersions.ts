/**
 * 0.22 package F — file versions, thin commands on native Git (D-18). Pure (no `vscode`): the git
 * arguments DataPass runs, the parsers of their output, and the read-only `datapass-rev:` URI that
 * shows a file at one revision. Nothing here checks out, fetches or writes.
 *
 *   Open Latest Version   the file at origin/<default branch> as of the last fetch
 *   Open Version…         one of the file's last 50 commits (`git log --follow`, renames included)
 *   Compare with Version… the working file against a chosen revision (VS Code's diff editor)
 *   Changed by the last update  files a fast-forward changed, per component, old..new
 */
import { vetRelativePath } from "../exchange/pathSafety";

export const LOG_LIMIT = 50;
const SEP = "\x1f";
const REC = "\x1e";

export interface FileRevision {
  sha: string;
  author: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
  /** Repository-relative path of the file at that revision (differs before a rename). */
  path: string;
  /** "(#123)" in a squash-merge subject: the pull request it came from. */
  pr?: number;
}

/** `git log` of one file, following renames; each record: header line, then the file's name at that commit. */
export function fileLogArgs(relPath: string): string[] {
  return ["log", "--follow", `-n`, String(LOG_LIMIT), `--format=${REC}%H${SEP}%an${SEP}%aI${SEP}%s`, "--name-only", "--", relPath];
}

export function parseFileLog(stdout: string, relPath: string): FileRevision[] {
  const out: FileRevision[] = [];
  for (const record of stdout.split(REC)) {
    const lines = record.split(/\r?\n/);
    const head = lines[0] ?? "";
    const [sha, author, date, ...rest] = head.split(SEP);
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) continue;
    const subject = rest.join(SEP).trim();
    const path = lines.slice(1).map(l => l.trim()).find(Boolean) ?? relPath;
    const pr = /\(#(\d{1,7})\)\s*$/.exec(subject)?.[1];
    out.push({ sha, author: (author ?? "").trim(), date: (date ?? "").trim(), subject, path, ...(pr ? { pr: Number(pr) } : {}) });
    if (out.length >= LOG_LIMIT) break;
  }
  return out;
}

/** Quick-pick row of a revision. */
export function revisionLabel(r: FileRevision): { label: string; description: string; detail?: string } {
  return {
    label: r.subject || "(no subject)",
    description: [r.sha.slice(0, 7), r.date.slice(0, 10), r.author, r.pr ? `from PR #${r.pr}` : undefined].filter(Boolean).join(" · "),
    ...(r.path ? { detail: r.path } : {})
  };
}

/**
 * Repository-relative path of a file from `git rev-parse --show-prefix` run in its folder (the folder's
 * path inside the repository, "" at the root) and the file name. Git computes the prefix itself, so
 * short (8.3) Windows paths, symlinks or drive-letter case cannot make a file look outside its
 * repository. Undefined when the result is not a safe relative path.
 */
export function relativeFromPrefix(prefix: string, fileName: string): string | undefined {
  const p = prefix.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!fileName || /[\\/]/.test(fileName)) return undefined;
  const vet = vetRelativePath(p ? `${p}/${fileName}` : fileName);
  return vet.ok ? vet.relative : undefined;
}

/** The remote default branch from `git symbolic-ref --short refs/remotes/origin/HEAD` ("origin/main"). */
export function defaultBranchRef(symbolicRef: string): string | undefined {
  const s = symbolicRef.trim();
  return /^origin\/[A-Za-z0-9._\/-]{1,200}$/.test(s) && !s.includes("..") ? s : undefined;
}
/** Tried in order when origin/HEAD is not set (a clone made by `git init` + `remote add`). */
export const DEFAULT_BRANCH_CANDIDATES = ["origin/main", "origin/master"] as const;

/**
 * The last fast-forward in `git reflog -n 20 --format=%H%x1f%gs HEAD`: the commit before it and after it.
 * DataPass's *Get updates* runs `git merge --ff-only @{u}` ("merge @{u}: Fast-forward"); `git pull` is
 * recognised too. Undefined when the newest entries hold no update.
 */
export function lastUpdateFromReflog(stdout: string): { from: string; to: string; how: string } | undefined {
  const rows = stdout.split(/\r?\n/).map(l => l.split(SEP)).filter(r => /^[0-9a-f]{40}$/.test(r[0] ?? ""));
  for (let i = 0; i < rows.length - 1; i += 1) {
    const how = rows[i]![1] ?? "";
    if (/^(merge .*: Fast-forward|pull\b.*: Fast-forward)/.test(how)) return { from: rows[i + 1]![0]!, to: rows[i]![0]!, how };
  }
  return undefined;
}
export const REFLOG_ARGS = ["reflog", "-n", "20", `--format=%H${SEP}%gs`, "HEAD"];

// ------------------------------------------------------------------ datapass-rev: URIs

export const REV_SCHEME = "datapass-rev";

export interface RevRequest {
  /** Absolute path of the repository root. */
  repo: string;
  sha: string;
  /** Repository-relative path at that revision. */
  path: string;
}

/** Vet a request before `git show <sha>:<path>`: a full or short hash, and a path that stays inside the repository. */
export function vetRevRequest(raw: unknown): RevRequest | undefined {
  const r = raw as Partial<RevRequest> | null;
  if (!r || typeof r !== "object" || typeof r.repo !== "string" || typeof r.sha !== "string" || typeof r.path !== "string") return undefined;
  if (!/^[0-9a-f]{7,40}$/.test(r.sha) || !r.repo || r.repo.length > 1024) return undefined;
  const vet = vetRelativePath(r.path);
  return vet.ok ? { repo: r.repo, sha: r.sha, path: vet.relative } : undefined;
}

/**
 * URI parts of a revision: the path ends with a readable name (the tab title), the query carries the
 * request. `note` goes in the title, e.g. "origin/main 1a2b3c4, fetched 26 Sep 02:10".
 */
export function revUriParts(req: RevRequest, note: string): { path: string; query: string } {
  const base = req.path.split("/").pop() ?? req.path;
  const safeNote = note.replace(/[\\/?#%]/g, " ").slice(0, 80);
  return { path: `/${base} (${safeNote})`, query: JSON.stringify(req) };
}

export function parseRevQuery(query: string): RevRequest | undefined {
  try { return vetRevRequest(JSON.parse(query)); } catch { return undefined; }
}

/** "26 Sep 02:10" (local time) for the tab title. */
export function shortTime(d: Date): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${d.getDate()} ${m} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
