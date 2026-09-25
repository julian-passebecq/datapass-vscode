/**
 * Observe a V3 project on this machine: where each declared repository is cloned (declared path,
 * a folder the person located, an open workspace folder or a sibling folder whose Git origin is
 * that repository), its Git state, and which expected component files exist.
 *
 * Read-only: stat, directory listings, file bytes for content digests (bounded), and Git read
 * commands by absolute path. Nothing is executed from the project, nothing is fetched, and in
 * Restricted Mode (untrusted workspace) Git is not run at all.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import type { DataPassProjectManifest } from "../core/projectManifestModel";
import type { ProjectGraph } from "../core/workspace/graph";
import { componentRepositories } from "../core/project/projectMap";
import { artifactPlan, COORDINATION_KEY, obsKey, repoNameFromRemote, sameRemote, type FileObservation, type RepoObservation } from "../core/project/resolve";
import { parseStatusV2 } from "../core/inventory/inventory";
import { sha256Bytes } from "../core/model/ids";
import type { GitRunner } from "../core/workspace/gitBase";
import { resolveDeclared, statKind } from "./observe";

export interface ProjectObservation {
  coordinationKey: string;
  repos: Map<string, RepoObservation>;
  files: Map<string, FileObservation>;
  /** Repository key → folder (session-private, never exported). */
  folders: Map<string, vscode.Uri>;
  observedAt: string;
}

export interface ObserveOptions {
  root: vscode.Uri;
  manifest?: DataPassProjectManifest;
  graph?: ProjectGraph;
  trusted: boolean;
  git: GitRunner;
  /** Repository key → absolute folder chosen with "Locate clone" (machine-local). */
  localBindings: Readonly<Record<string, string>>;
  /** Extra parent folders where clones live (setting datapass.projectsFolders). */
  cloneParents: readonly string[];
}

const MAX_HASH_BYTES = 2 * 1024 * 1024;
const MAX_PLAN = 2000;

/** The declared repository whose path is the project folder itself, else the synthetic coordination key. */
export function coordinationKeyOf(manifest: DataPassProjectManifest | undefined, root: vscode.Uri): string {
  for (const [key, repo] of Object.entries(manifest?.repositories ?? {})) {
    if (!repo.path) continue;
    if (path.resolve(resolveDeclared(root, repo.path).fsPath) === path.resolve(root.fsPath)) return key;
  }
  return COORDINATION_KEY;
}

async function gitState(git: GitRunner, folder: string): Promise<{ isGitRepo: boolean; state?: RepoObservation["git"] }> {
  const status = await git(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], folder, 10000);
  if (!status.ok) return { isGitRepo: false };
  const origin = await git(["config", "--get", "remote.origin.url"], folder, 5000);
  const parsed = parseStatusV2(status.stdout);
  let lastFetch: string | undefined;
  const gitDir = await git(["rev-parse", "--git-dir"], folder, 5000);
  if (gitDir.ok) {
    const dir = gitDir.stdout.trim();
    try {
      const s = await vscode.workspace.fs.stat(vscode.Uri.file(path.resolve(folder, dir, "FETCH_HEAD")));
      lastFetch = new Date(s.mtime).toISOString();
    } catch { /* never fetched */ }
  }
  return { isGitRepo: true, state: { ...parsed, originUrl: origin.ok ? origin.stdout.trim() || undefined : undefined, lastFetch } };
}

export async function observeProject(o: ObserveOptions): Promise<ProjectObservation> {
  const coordinationKey = coordinationKeyOf(o.manifest, o.root);
  const repos = new Map<string, RepoObservation>();
  const folders = new Map<string, vscode.Uri>();
  const originCache = new Map<string, string | undefined>();
  const originOf = async (folder: string) => {
    if (!o.trusted) return undefined;
    if (!originCache.has(folder)) {
      const r = await o.git(["config", "--get", "remote.origin.url"], folder, 5000);
      originCache.set(folder, r.ok ? r.stdout.trim() || undefined : undefined);
    }
    return originCache.get(folder);
  };
  const exists = async (fsPath: string) => (await statKind(vscode.Uri.file(fsPath))) === "dir";

  const declared: Array<[string, { path?: string; remote?: { url: string }; planned?: true }]> = Object.entries(o.manifest?.repositories ?? {});
  if (coordinationKey === COORDINATION_KEY) declared.unshift([COORDINATION_KEY, { path: "." }]);
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath).filter(f => path.resolve(f) !== path.resolve(o.root.fsPath));
  const parents = [...new Set([path.dirname(o.root.fsPath), ...o.cloneParents])];

  for (const [key, repo] of declared.slice(0, 60)) {
    if (repo.planned) continue;
    let folder: string | undefined;
    let source: RepoObservation["source"] = "none";
    if (key === coordinationKey) { folder = o.root.fsPath; source = "coordination"; }
    else if (o.localBindings[key] && await exists(o.localBindings[key]!)) { folder = o.localBindings[key]; source = "local-binding"; }
    else if (repo.path) {
      const p = resolveDeclared(o.root, repo.path).fsPath;
      if (await exists(p)) { folder = p; source = "declared-path"; }
    } else if (repo.remote?.url && o.trusted) {
      // Auto-discovery by identity: an open folder or a sibling folder whose origin is this remote.
      const name = repoNameFromRemote(repo.remote.url);
      const candidates = [...workspaceFolders.map(f => ({ f, s: "workspace-folder" as const })), ...(name ? parents.map(p => ({ f: path.join(p, name), s: "sibling-folder" as const })) : [])];
      for (const c of candidates) {
        if (!(await exists(c.f))) continue;
        if (sameRemote(await originOf(c.f), repo.remote.url)) { folder = c.f; source = c.s; break; }
      }
    }
    // Untrusted: an origin cannot be verified without Git, so an unlocated clone is "not inspected", not "not cloned".
    if (!folder) { repos.set(key, { key, source: "none", exists: false, restricted: !o.trusted || undefined }); continue; }
    folders.set(key, vscode.Uri.file(folder));
    if (!o.trusted) { repos.set(key, { key, folder, source, exists: true, restricted: true }); continue; }
    const g = await gitState(o.git, folder);
    repos.set(key, { key, folder, source, exists: true, isGitRepo: g.isGitRepo, git: g.state });
  }

  // Expected files of every component, in the repository that holds them.
  const files = new Map<string, FileObservation>();
  const plan = artifactPlan(componentRepositories(o.manifest, o.graph, coordinationKey)).slice(0, MAX_PLAN);
  const tracked = new Map<string, string[]>();
  await Promise.all(plan.map(async entry => {
    const base = folders.get(entry.repoKey);
    if (!base) return;
    const k = obsKey(entry.repoKey, entry.repoPath);
    files.set(k, await observeEntry(base, entry.repoPath, entry.kind, entry.hash));
    if (entry.tracked && o.trusted) (tracked.get(entry.repoKey) ?? tracked.set(entry.repoKey, []).get(entry.repoKey)!).push(entry.repoPath);
  }));
  // Files that must never be committed: ask Git whether they are tracked.
  for (const [key, paths] of tracked) {
    const folder = folders.get(key)!.fsPath;
    const r = await o.git(["ls-files", "--", ...paths], folder, 10000);
    const listed = new Set(r.ok ? r.stdout.split(/\r?\n/).map(l => l.trim().replace(/\\/g, "/")).filter(Boolean) : []);
    for (const p of paths) {
      const k = obsKey(key, p);
      files.set(k, { ...(files.get(k) ?? { state: "missing" }), tracked: listed.has(p) });
    }
  }
  return { coordinationKey, repos, files, folders, observedAt: new Date().toISOString() };
}

function wildcard(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${esc}$`, process.platform === "win32" ? "i" : "");
}

async function observeEntry(base: vscode.Uri, repoPath: string, kind: "file" | "dir" | "glob", hash: boolean): Promise<FileObservation> {
  const segs = repoPath.split("/").filter(Boolean);
  if (kind === "glob") {
    const pattern = segs.pop() ?? "*";
    const dir = segs.length ? vscode.Uri.joinPath(base, ...segs) : base;
    try {
      const re = wildcard(pattern);
      const count = (await vscode.workspace.fs.readDirectory(dir)).filter(([n, t]) => t & vscode.FileType.File && re.test(n)).length;
      return count ? { state: "found", count } : { state: "missing" };
    } catch (e) {
      return e instanceof vscode.FileSystemError && e.code === "FileNotFound" ? { state: "missing" } : { state: "unknown", detail: "folder could not be listed" };
    }
  }
  const uri = segs.length ? vscode.Uri.joinPath(base, ...segs) : base;
  const k = await statKind(uri);
  if (k === "missing") return { state: "missing" };
  if (k === "error") return { state: "unknown", detail: "could not be read" };
  if (k === "symlink") return { state: "unknown", detail: "symbolic link (not followed)" };
  if (kind === "dir") {
    if (k !== "dir") return { state: "missing", detail: "a file, not a folder" };
    const n = await filesBelow(uri, 5, 400);
    return n > 0 ? { state: "found", kind: "dir", count: n } : { state: "missing", detail: "the folder is empty" };
  }
  if (k !== "file") return { state: "missing", detail: "a folder, not a file" };
  if (!hash) return { state: "found", kind: "file" };
  try {
    const s = await vscode.workspace.fs.stat(uri);
    if (s.size > MAX_HASH_BYTES) return { state: "found", kind: "file", sha256: `size:${s.size}:mtime:${s.mtime}` };
    return { state: "found", kind: "file", sha256: sha256Bytes(await vscode.workspace.fs.readFile(uri)).value };
  } catch { return { state: "found", kind: "file" }; }
}

/** Number of files below a folder (stops early; symlinks are not followed). */
async function filesBelow(dir: vscode.Uri, depth: number, budget: number): Promise<number> {
  let count = 0;
  const queue: Array<[vscode.Uri, number]> = [[dir, 0]];
  while (queue.length && budget > 0) {
    const [u, d] = queue.shift()!;
    let entries: [string, vscode.FileType][];
    try { entries = await vscode.workspace.fs.readDirectory(u); } catch { continue; }
    for (const [name, type] of entries) {
      if (--budget <= 0) break;
      if (type & vscode.FileType.SymbolicLink) continue;
      if (type & vscode.FileType.File) { count++; if (count >= 50) return count; }
      else if (type & vscode.FileType.Directory && d < depth && name !== ".git" && name !== "node_modules") queue.push([vscode.Uri.joinPath(u, name), d + 1]);
    }
  }
  return count;
}
