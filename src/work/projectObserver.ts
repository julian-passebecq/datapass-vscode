/**
 * Observe a V3 project on this machine: where each declared repository is cloned (declared path,
 * a folder the person located, an open workspace folder or a sibling folder whose Git origin is
 * that repository), its Git state, and which expected component files exist.
 *
 * Read-only: stat, directory listings, file bytes for content digests (bounded: 16 reads at once,
 * a byte budget per refresh, larger files identified by size and time only and marked so), and Git
 * read commands by absolute path. Nothing is executed from the project, nothing is fetched, and in
 * Restricted Mode (untrusted workspace) Git is not run at all.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { createReadStream, promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import type { DataPassProjectManifest } from "../core/projectManifestModel";
import type { GraphItem, ProjectGraph } from "../core/workspace/graph";
import { componentRepositories } from "../core/project/projectMap";
import { artifactPlan, COORDINATION_KEY, globMatcher, obsKey, repoNameFromRemote, sameRemote, type FileObservation, type Fingerprint, type RepoObservation, type TrackingObservation } from "../core/project/resolve";
import { ByteBudget, gitRead, HASH_BYTE_BUDGET, hashMode, incompleteness, interpretLsFiles, interpretOrigin, MAX_PLANNED_ENTRIES, OBSERVE_CONCURRENCY, runBounded, type Incompleteness } from "../core/project/observation";
import { parseStatusV2 } from "../core/inventory/inventory";
import { statusCounts } from "../core/git/porcelain";
import { sha256Bytes } from "../core/model/ids";
import type { GitRunner } from "../core/workspace/gitBase";
import { lsFilesArgs, RepoCache, repoFingerprint, GIT_CONCURRENCY, type CachedRepo } from "../core/git/repoCache";
import { readDirectory, resolveDeclared, statKind } from "./observe";

/**
 * V1-REF: origin and tracking answers per clone, kept while HEAD, the index and the config are
 * unchanged (one per extension host; `git status` is still asked on every refresh).
 */
export const repoCache = new RepoCache();

/** The cache entry of a clone for its current fingerprint. */
async function cacheEntry(folder: string): Promise<{ entry: CachedRepo; gitDir?: string }> {
  const fp = await repoFingerprint(folder);
  return { entry: repoCache.entry(folder, fp?.key), gitDir: fp?.gitDir };
}

/** `git config --get remote.origin.url` (and `git remote` when it failed), once per fingerprint. */
async function originAnswers(git: GitRunner, folder: string, entry: CachedRepo): Promise<Pick<CachedRepo, "config" | "remotes">> {
  if (entry.config) return { config: entry.config, remotes: entry.remotes };
  const config = await gitRead(git, ["config", "--get", "remote.origin.url"], folder, 5000);
  // A failed `config --get` also means "no such key": `git remote` tells the two apart (F04).
  const remotes = config.ok ? undefined : await gitRead(git, ["remote"], folder, 5000);
  // A timeout or a failed start is not an answer worth keeping.
  if (config.ok || remotes?.ok) { entry.config = config; entry.remotes = remotes; }
  return { config, remotes };
}

export interface ProjectObservation {
  coordinationKey: string;
  repos: Map<string, RepoObservation>;
  files: Map<string, FileObservation>;
  /** Repository key → folder (session-private, never exported). */
  folders: Map<string, vscode.Uri>;
  observedAt: string;
  /** 0.22 (F05): what this refresh did not inspect fully, shown as "inspection incomplete (n skipped)". */
  incomplete?: Incompleteness;
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
  /** 0.15: components of architecture alternatives, observed too (their files may already exist). */
  extraItems?: ReadonlyArray<{ item: GraphItem; repoKey: string }>;
  /** 0.16: files the board's cards name (repository-relative, vetted by the caller). */
  extraFiles?: ReadonlyArray<{ repoKey: string; repoPath: string }>;
  /** V1-REF: called as each step ends ("repositories", "files", "tracking"), for the timings. */
  mark?: (step: string) => void;
}


/** The declared repository whose path is the project folder itself, else the synthetic coordination key. */
export function coordinationKeyOf(manifest: DataPassProjectManifest | undefined, root: vscode.Uri): string {
  for (const [key, repo] of Object.entries(manifest?.repositories ?? {})) {
    if (!repo.path) continue;
    if (path.resolve(resolveDeclared(root, repo.path).fsPath) === path.resolve(root.fsPath)) return key;
  }
  return COORDINATION_KEY;
}

async function gitState(git: GitRunner, folder: string): Promise<{ isGitRepo: boolean; state?: RepoObservation["git"] }> {
  const [status, { entry, gitDir }] = await Promise.all([
    gitRead(git, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], folder, 10000),
    cacheEntry(folder)
  ]);
  if (!status.ok) return { isGitRepo: false };
  const { config, remotes } = await originAnswers(git, folder, entry);
  const origin = interpretOrigin(config!, remotes);
  const parsed = parseStatusV2(status.stdout);
  // V1-REF: the Git folder is read from disk; Git is asked only when that read could not tell.
  let dir = gitDir;
  if (!dir) {
    const r = await git(["rev-parse", "--git-dir"], folder, 5000);
    if (r.ok) dir = path.resolve(folder, r.stdout.trim());
  }
  let lastFetch: string | undefined;
  if (dir) {
    try { lastFetch = new Date((await fsp.stat(path.join(dir, "FETCH_HEAD"))).mtimeMs).toISOString(); } catch { /* never fetched */ }
  }
  return { isGitRepo: true, state: { ...parsed, counts: statusCounts(status.stdout), ...origin, lastFetch } };
}

export async function observeProject(o: ObserveOptions): Promise<ProjectObservation> {
  const { coordinationKey, repos, folders } = await locateRepositories(o);
  o.mark?.("repositories");

  // Expected files of every component, in the repository that holds them.
  const files = new Map<string, FileObservation>();
  const plan = artifactPlan([...componentRepositories(o.manifest, o.graph, coordinationKey), ...(o.extraItems ?? [])]);
  const planned = new Set(plan.map(e => obsKey(e.repoKey, e.repoPath)));
  for (const f of o.extraFiles ?? []) {
    const repoPath = f.repoPath.replace(/\/+$/, "");
    if (!repoPath || planned.has(obsKey(f.repoKey, repoPath))) continue;
    planned.add(obsKey(f.repoKey, repoPath));
    plan.push({ repoKey: f.repoKey, repoPath, kind: f.repoPath.endsWith("/") ? "dir" : "file", hash: false, tracked: false });
  }
  // Bounded (F05): a fixed number of reads in flight, a byte budget, and what was left out is said.
  const plannedCount = plan.length;
  plan.splice(MAX_PLANNED_ENTRIES);
  const budget = new ByteBudget(HASH_BYTE_BUDGET);
  const tracked = new Map<string, string[]>();
  await runBounded(plan, OBSERVE_CONCURRENCY, async entry => {
    const base = folders.get(entry.repoKey);
    if (!base) return;
    const k = obsKey(entry.repoKey, entry.repoPath);
    files.set(k, await observeEntry(base, entry.repoPath, entry.kind, entry.hash, budget));
    if (entry.tracked && o.trusted) (tracked.get(entry.repoKey) ?? tracked.set(entry.repoKey, []).get(entry.repoKey)!).push(entry.repoPath);
  });
  o.mark?.("files");
  // Files that must never be committed: ask Git whether they are tracked, in one call per clone
  // (V1-REF), the answers kept while the clone's fingerprint is unchanged. A failed or cut-short
  // answer leaves them "unknown", never "untracked" (F03), and is not kept.
  await runBounded([...tracked], GIT_CONCURRENCY, async ([key, paths]) => {
    const folder = folders.get(key)!.fsPath;
    const { entry } = await cacheEntry(folder);
    const ask = paths.filter(p => !entry.tracking.has(p));
    const answers = ask.length ? interpretLsFiles(ask, await o.git(lsFilesArgs(ask), folder, 10000)) : new Map<string, TrackingObservation>();
    for (const [p, t] of answers) if (t.state !== "unknown") entry.tracking.set(p, t);
    for (const p of paths) {
      const k = obsKey(key, p);
      files.set(k, { ...(files.get(k) ?? { state: "missing" }), tracking: answers.get(p) ?? entry.tracking.get(p)! });
    }
  });
  o.mark?.("tracking");
  const incomplete = incompleteness({ planned: plannedCount, max: MAX_PLANNED_ENTRIES, statOnly: budget.denied });
  return { coordinationKey, repos, files, folders, observedAt: new Date().toISOString(), incomplete };
}

export type LocateOptions = Pick<ObserveOptions, "root" | "manifest" | "trusted" | "git" | "localBindings" | "cloneParents">;

/**
 * Where each declared repository is cloned on this machine: the project folder itself, a folder the
 * person located, a declared path, or an open / sibling folder whose Git origin is that repository.
 * Also used for projects that are not open in this window (the company workspace file, 0.17).
 */
export async function locateRepositories(o: LocateOptions): Promise<Pick<ProjectObservation, "coordinationKey" | "repos" | "folders">> {
  const coordinationKey = coordinationKeyOf(o.manifest, o.root);
  const repos = new Map<string, RepoObservation>();
  const folders = new Map<string, vscode.Uri>();
  // One lookup per folder even when several repositories consider it at once (V1-REF: kept in repoCache too).
  const originCache = new Map<string, Promise<string | undefined>>();
  const originOf = (folder: string): Promise<string | undefined> => {
    if (!o.trusted) return Promise.resolve(undefined);
    const id = path.resolve(folder);
    if (!originCache.has(id)) originCache.set(id, cacheEntry(folder).then(async ({ entry }) => {
      const { config } = await originAnswers(o.git, folder, entry);
      return config?.ok ? config.stdout.trim() || undefined : undefined;
    }));
    return originCache.get(id)!;
  };
  const exists = async (fsPath: string) => (await statKind(vscode.Uri.file(fsPath))) === "dir";

  const declared: Array<[string, { path?: string; remote?: { url: string }; planned?: true }]> = Object.entries(o.manifest?.repositories ?? {});
  if (coordinationKey === COORDINATION_KEY) declared.unshift([COORDINATION_KEY, { path: "." }]);
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath).filter(f => path.resolve(f) !== path.resolve(o.root.fsPath));
  const parents = [...new Set([path.dirname(o.root.fsPath), ...o.cloneParents])];

  // V1-REF: repositories are looked at side by side, a few Git processes at a time; the maps keep the declared order.
  const found = await runBounded(declared.slice(0, 60), GIT_CONCURRENCY, async ([key, repo]): Promise<{ repo: RepoObservation; folder?: vscode.Uri } | undefined> => {
    if (repo.planned) return undefined;
    let folder: string | undefined;
    let source: RepoObservation["source"] = "none";
    let nearby: RepoObservation["nearby"];
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
        const origin = await originOf(c.f);
        if (sameRemote(origin, repo.remote.url)) { folder = c.f; source = c.s; break; }
        // A sibling of the right name that is not this remote is never bound; it is only named (V1-STAB).
        if (c.s === "sibling-folder" && !nearby) nearby = { folderName: path.basename(c.f), origin: origin ? "other" : "none" };
      }
    }
    // Untrusted: an origin cannot be verified without Git, so an unlocated clone is "not inspected", not "not cloned".
    if (!folder) return { repo: { key, source: "none", exists: false, restricted: !o.trusted || undefined, ...(nearby ? { nearby } : {}) } };
    if (!o.trusted) return { repo: { key, folder, source, exists: true, restricted: true }, folder: vscode.Uri.file(folder) };
    const g = await gitState(o.git, folder);
    return { repo: { key, folder, source, exists: true, isGitRepo: g.isGitRepo, git: g.state }, folder: vscode.Uri.file(folder) };
  });
  for (const f of found) {
    if (!f) continue;
    repos.set(f.repo.key, f.repo);
    if (f.folder) folders.set(f.repo.key, f.folder);
  }
  return { coordinationKey, repos, folders };
}

async function observeEntry(base: vscode.Uri, repoPath: string, kind: "file" | "dir" | "glob", hash: boolean, budget: ByteBudget): Promise<FileObservation> {
  const segs = repoPath.split("/").filter(Boolean);
  if (kind === "glob") {
    const pattern = segs.pop() ?? "*";
    const dir = segs.length ? vscode.Uri.joinPath(base, ...segs) : base;
    try {
      const re = globMatcher(pattern);
      const count = (await readDirectory(dir)).filter(([n, t]) => t & vscode.FileType.File && re.test(n)).length;
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
  // F02: a digest of every byte, or a size + time stamp that says it is one; a failed read says so.
  try {
    const onDisk = uri.scheme === "file";
    const s = onDisk ? await fsp.stat(uri.fsPath).then(x => ({ size: x.size, mtime: x.mtimeMs })) : await vscode.workspace.fs.stat(uri);
    const stat: Fingerprint = { kind: "stat", size: s.size, mtimeMs: s.mtime };
    const mode = hashMode(s.size, budget);
    if (mode === "stat" || (mode === "stream" && !onDisk)) return { state: "found", kind: "file", fingerprint: stat };
    const value = mode === "inline" ? sha256Bytes(onDisk ? await fsp.readFile(uri.fsPath) : await vscode.workspace.fs.readFile(uri)).value : await streamSha256(uri.fsPath);
    return { state: "found", kind: "file", fingerprint: { kind: "sha256", value } };
  } catch (e) {
    const code = e instanceof vscode.FileSystemError ? e.code : (e as NodeJS.ErrnoException)?.code;
    return { state: "found", kind: "file", hashError: code ? `could not be read (${code})` : "could not be read" };
  }
}

function streamSha256(fsPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(fsPath).on("data", chunk => h.update(chunk)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/** Number of files below a folder (stops early; symlinks are not followed). */
async function filesBelow(dir: vscode.Uri, depth: number, budget: number): Promise<number> {
  let count = 0;
  const queue: Array<[vscode.Uri, number]> = [[dir, 0]];
  while (queue.length && budget > 0) {
    const [u, d] = queue.shift()!;
    let entries: [string, vscode.FileType][];
    try { entries = await readDirectory(u); } catch { continue; }
    for (const [name, type] of entries) {
      if (--budget <= 0) break;
      if (type & vscode.FileType.SymbolicLink) continue;
      if (type & vscode.FileType.File) { count++; if (count >= 50) return count; }
      else if (type & vscode.FileType.Directory && d < depth && name !== ".git" && name !== "node_modules") queue.push([vscode.Uri.joinPath(u, name), d + 1]);
    }
  }
  return count;
}
