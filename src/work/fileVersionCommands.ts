/**
 * 0.22 package F — file versions (D-18): three thin commands on native Git that VS Code lacks
 * without GitLens, plus the files the last update changed, per component.
 *
 *   DataPass: Open Latest Version       the file at origin/<default branch> as of the last fetch (never fetches)
 *   DataPass: Open Version…             one of its last 50 commits (renames followed), read-only
 *   DataPass: Compare with Version…     VS Code's diff editor, chosen revision ↔ working file
 *   DataPass: Changed by the Last Update  per component, each row opens the diff old..new
 *
 * Revisions open read-only through the `datapass-rev:` content provider (`git show <sha>:<path>`), so
 * they work with the Git extension disabled and the tab title says which revision it is. Nothing
 * checks out, fetches, pulls or writes. Git runs only in a trusted workspace, by absolute path.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { gitRunner } from "./session";
import { guarded, UserFacingError } from "./io";
import { changedComponents } from "../core/project/gitSync";
import {
  DEFAULT_BRANCH_CANDIDATES, defaultBranchRef, fileLogArgs, lastUpdateFromReflog, parseFileLog, parseRevQuery, REFLOG_ARGS,
  repoRelative, REV_SCHEME, revisionLabel, revUriParts, shortTime, type FileRevision, type RevRequest
} from "../core/git/fileVersions";

const git = async (args: string[], cwd: string, timeoutMs = 15000) => gitRunner(args, cwd, timeoutMs);

function requireTrust(): void {
  if (!vscode.workspace.isTrusted) throw new UserFacingError("Restricted Mode: trust this workspace before DataPass runs Git.");
}

/** Where a command's file comes from: an Explorer / editor URI, a Project tree file row, or the active editor. */
function fileArg(session: WorkSession, arg: unknown): vscode.Uri {
  if (arg instanceof vscode.Uri) return arg;
  const node = arg as { t?: string; c?: { artifacts?: { repoKey?: string } }; f?: { repoPath?: string } } | undefined;
  if (node?.t === "file" && node.c?.artifacts?.repoKey && node.f?.repoPath) {
    const folder = session.repoFolder(node.c.artifacts.repoKey);
    if (folder) return vscode.Uri.joinPath(folder, ...node.f.repoPath.split("/"));
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") return active;
  throw new UserFacingError("Open a file first (or right-click one in the Explorer).");
}

/** The repository holding a file, and the file's repository-relative path. */
async function locate(file: vscode.Uri): Promise<{ repo: string; rel: string }> {
  if (file.scheme !== "file") throw new UserFacingError("Versions are available for files on this computer only.");
  const top = await git(["rev-parse", "--show-toplevel"], path.dirname(file.fsPath), 5000);
  if (!top.ok || !top.stdout.trim()) throw new UserFacingError(`${path.basename(file.fsPath)} is not in a Git repository.`);
  const repo = path.normalize(top.stdout.trim());
  const rel = repoRelative(repo, file.fsPath);
  if (!rel) throw new UserFacingError(`${path.basename(file.fsPath)} is outside its repository.`);
  return { repo, rel };
}

export function revUri(req: RevRequest, note: string): vscode.Uri {
  const p = revUriParts(req, note);
  return vscode.Uri.from({ scheme: REV_SCHEME, path: p.path, query: p.query });
}

async function fileLog(repo: string, rel: string): Promise<FileRevision[]> {
  const r = await git(fileLogArgs(rel), repo, 20000);
  if (!r.ok) throw new UserFacingError(`Git could not read the history of ${rel}.`);
  return parseFileLog(r.stdout, rel);
}

async function pickRevision(repo: string, rel: string, title: string): Promise<FileRevision | undefined> {
  const revs = await fileLog(repo, rel);
  if (!revs.length) throw new UserFacingError(`${rel} has no commits yet.`);
  const picked = await vscode.window.showQuickPick(revs.map(r => ({ ...revisionLabel(r), rev: r })), { title, placeHolder: `${rel}: last ${revs.length} commit(s), newest first`, matchOnDescription: true });
  return picked?.rev;
}

/** When the repository was last fetched (mtime of FETCH_HEAD), if ever. */
async function fetchedAt(repo: string): Promise<Date | undefined> {
  const r = await git(["rev-parse", "--git-path", "FETCH_HEAD"], repo, 5000);
  if (!r.ok) return undefined;
  const p = path.resolve(repo, r.stdout.trim());
  try { return fs.statSync(p).mtime; } catch { return undefined; }
}

async function remoteDefault(repo: string): Promise<string | undefined> {
  const sym = await git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], repo, 5000);
  const fromHead = sym.ok ? defaultBranchRef(sym.stdout) : undefined;
  if (fromHead) return fromHead;
  for (const c of DEFAULT_BRANCH_CANDIDATES) if ((await git(["rev-parse", "--verify", "--quiet", `${c}^{commit}`], repo, 5000)).ok) return c;
  return undefined;
}

async function exists(repo: string, sha: string, rel: string): Promise<boolean> {
  return (await git(["cat-file", "-e", `${sha}:${rel}`], repo, 5000)).ok;
}

/** Read-only content of `datapass-rev:` URIs; refuses anything but a vetted revision of a known repository. */
class RevisionProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly allowed: (repo: string) => boolean) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const req = parseRevQuery(uri.query);
    if (!req) return "DataPass: this revision link is not valid.";
    if (!vscode.workspace.isTrusted) return "DataPass: Restricted Mode — Git is not run in an untrusted workspace.";
    if (!this.allowed(req.repo)) return "DataPass: this repository is not open in this window.";
    const r = await git(["show", `${req.sha}:${req.path}`], req.repo, 20000);
    return r.ok ? r.stdout : `DataPass: ${req.path} does not exist at ${req.sha.slice(0, 7)}.`;
  }
}

export interface LastUpdateRow { repoKey: string; component?: string; status: string; path: string; from: string; to: string; repo: string }

/** Files the last fast-forward of each cloned repository changed, grouped by component. */
export async function lastUpdateRows(session: WorkSession): Promise<LastUpdateRow[]> {
  requireTrust();
  const map = session.projectMap();
  const rows: LastUpdateRow[] = [];
  for (const r of map.repositories.filter(x => x.state === "local")) {
    const folder = session.repoFolder(r.key)?.fsPath;
    if (!folder) continue;
    const log = await git(REFLOG_ARGS, folder, 5000);
    const upd = log.ok ? lastUpdateFromReflog(log.stdout) : undefined;
    if (!upd) continue;
    const diff = await git(["diff", "--name-status", "--no-renames", upd.from, upd.to], folder, 15000);
    if (!diff.ok) continue;
    const files = diff.stdout.split(/\r?\n/).map(l => l.split("\t")).filter(p => p.length >= 2 && p[1]).map(p => ({ status: p[0]!.charAt(0), path: p[1]! }));
    const byFile = new Map<string, string>();
    for (const c of changedComponents(map, r.key, files.map(f => f.path))) for (const f of c.files) if (!byFile.has(f)) byFile.set(f, c.label);
    for (const f of files) rows.push({ repoKey: r.key, component: byFile.get(f.path), status: f.status, path: f.path, from: upd.from, to: upd.to, repo: folder });
  }
  return rows;
}

const STATUS: Record<string, string> = { A: "added", M: "modified", D: "deleted", T: "type changed" };

export function registerFileVersionCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const allowed = (repo: string) => {
    const norm = (p: string) => path.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
    const known = [...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath), ...session.projectMap().repositories.map(r => session.repoFolder(r.key)?.fsPath).filter((p): p is string => !!p)];
    // A repository is allowed when it is (or contains) an open folder or a project repository.
    return known.some(k => norm(k) === norm(repo) || norm(k).startsWith(`${norm(repo)}${path.sep}`.toLowerCase()) || norm(repo).startsWith(`${norm(k)}${path.sep}`.toLowerCase()));
  };
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(REV_SCHEME, new RevisionProvider(allowed)));

  reg("datapass.fileVersions.openLatest", async (arg?: unknown) => {
    requireTrust();
    const { repo, rel } = await locate(fileArg(session, arg));
    const ref = await remoteDefault(repo);
    if (!ref) throw new UserFacingError("No origin/<default branch> in this clone yet. Run Check for Updates (a plain git fetch) first; DataPass does not fetch by itself.");
    const sha = (await git(["rev-parse", ref], repo, 5000)).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new UserFacingError(`Git could not resolve ${ref}.`);
    if (!(await exists(repo, sha, rel))) throw new UserFacingError(`${rel} does not exist in ${ref} (as of the last fetch).`);
    const at = await fetchedAt(repo);
    await vscode.commands.executeCommand("vscode.open", revUri({ repo, sha, path: rel }, `${ref} ${sha.slice(0, 7)}, ${at ? `fetched ${shortTime(at)}` : "never fetched"}`), { preview: true });
  });

  reg("datapass.fileVersions.openVersion", async (arg?: unknown) => {
    requireTrust();
    const { repo, rel } = await locate(fileArg(session, arg));
    const rev = await pickRevision(repo, rel, "DataPass: Open Version");
    if (!rev) return;
    await vscode.commands.executeCommand("vscode.open", revUri({ repo, sha: rev.sha, path: rev.path }, `${rev.sha.slice(0, 7)} ${rev.date.slice(0, 10)}`), { preview: true });
  });

  reg("datapass.fileVersions.compare", async (arg?: unknown) => {
    requireTrust();
    const file = fileArg(session, arg);
    const { repo, rel } = await locate(file);
    const rev = await pickRevision(repo, rel, "DataPass: Compare with Version");
    if (!rev) return;
    const left = revUri({ repo, sha: rev.sha, path: rev.path }, `${rev.sha.slice(0, 7)}`);
    await vscode.commands.executeCommand("vscode.diff", left, file, `${path.basename(rel)} (${rev.sha.slice(0, 7)} ↔ working file)`);
  });

  reg("datapass.fileVersions.lastUpdate", async () => {
    const rows = await lastUpdateRows(session);
    if (!rows.length) { void vscode.window.showInformationMessage("No update recorded yet: Get Updates fast-forwards a repository, then its changes are listed here."); return; }
    const items: Array<vscode.QuickPickItem & { row?: LastUpdateRow }> = [];
    let group = "";
    for (const r of [...rows].sort((a, b) => (a.component ?? "~").localeCompare(b.component ?? "~") || a.path.localeCompare(b.path))) {
      const g = r.component ?? "Other files";
      if (g !== group) { items.push({ label: g, kind: vscode.QuickPickItemKind.Separator }); group = g; }
      items.push({ label: r.path, description: `${STATUS[r.status] ?? r.status} · ${r.repoKey} · ${r.from.slice(0, 7)}..${r.to.slice(0, 7)}`, row: r });
    }
    const pick = await vscode.window.showQuickPick(items, { title: "DataPass: Changed by the Last Update", placeHolder: "Pick a file to see what the update changed", matchOnDescription: true });
    const r = pick?.row;
    if (!r) return;
    const before = revUri({ repo: r.repo, sha: r.from, path: r.path }, `before ${r.from.slice(0, 7)}`);
    const after = revUri({ repo: r.repo, sha: r.to, path: r.path }, `after ${r.to.slice(0, 7)}`);
    if (r.status === "A") await vscode.commands.executeCommand("vscode.open", after);
    else if (r.status === "D") await vscode.commands.executeCommand("vscode.open", before);
    else await vscode.commands.executeCommand("vscode.diff", before, after, `${path.basename(r.path)} (${r.from.slice(0, 7)} ↔ ${r.to.slice(0, 7)})`);
  });
}
