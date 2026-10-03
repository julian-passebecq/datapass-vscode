/**
 * V5 GITMR1: the repo set one workspace works across, and a read-only status per repo (AC-V2).
 *
 * Discovery reads three sources, in this order: the VS Code workspace folders, the Git submodules each of them declares
 * (`.gitmodules`), and the declared `.datapass/repos.json` of the workspace root (roles, ids, edges, pins). The result is a
 * `datapass.repo-set/1` document (GITSPI1). Remotes are kept credential-free; local and relative remotes are dropped.
 *
 * Git is only asked read-only questions, all through `gitReadOnly` (readOnly.ts, TL-4): `rev-parse --show-prefix`, `config --get`,
 * `symbolic-ref` and `status`, each with `--no-optional-locks` so not even the index is refreshed.
 * Nothing here checks out, fetches, pulls or pushes; ahead/behind is "as of the last fetch".
 */
import * as path from "node:path";
import type { GitRunner } from "../workspace/gitBase";
import { parseStatusV2 } from "../inventory/inventory";
import { Limiter } from "../git/run";
import { GIT_CONCURRENCY } from "../git/repoCache";
import { readOnlyGit } from "./readOnly";
import {
  REPO_EDGE_KINDS, REPO_SET_ROLES, REPO_SET_ROOT_PATH, REPO_SET_SCHEMA_ID, gitObjectId, integrityDigest, redactRemoteUrl, remoteHost,
  type RepoEdge, type RepoRemote, type RepoSet, type RepoSetRepo, type RepoSetRole, type RepoSetSource, type VendoredPin
} from "./repoSetContract";

/** Workspace-relative path of the declared repo set. */
export const REPOS_JSON_PATH = ".datapass/repos.json";
const GIT_TIMEOUT_MS = 10_000;
const MAX_REPOS = 500;
const SLUG = /^[a-z0-9][a-z0-9._-]*$/;

/** Why something found was left out of the set (shown as a hole, never guessed). */
export interface RepoSetIssue { readonly path: string; readonly reason: string }

export interface RepoSetDeps {
  /**
   * V5HOLE17: absent = discovery without any Git spawn (folders, `.gitmodules` and repos.json only; no remote or default
   * branch is read). The Git view uses that so its lanes appear at once; each lane's own check reads the clone.
   */
  readonly git?: GitRunner;
  /** File text, or undefined when it does not exist. */
  readonly readFile: (absPath: string) => Promise<string | undefined>;
}

/** One `[submodule "x"]` entry of a `.gitmodules` file. */
export interface GitSubmodule { readonly name: string; readonly path: string; readonly url: string | null }

/** `.gitmodules` (git-config syntax) → its submodules with a path. */
export function parseGitmodules(text: string): GitSubmodule[] {
  const out: GitSubmodule[] = [];
  let cur: { name: string; path?: string; url?: string } | undefined;
  const flush = () => { if (cur?.path) out.push({ name: cur.name, path: cur.path, url: cur.url ?? null }); };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+|\s+$/g, "");
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[\s*submodule\s+"([^"]+)"\s*\]$/.exec(line);
    if (section) { flush(); cur = { name: section[1]! }; continue; }
    if (line.startsWith("[")) { flush(); cur = undefined; continue; }
    const kv = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (!cur || !kv) continue;
    const value = kv[2]!.replace(/^"(.*)"$/, "$1");
    if (kv[1]!.toLowerCase() === "path") cur.path = value;
    else if (kv[1]!.toLowerCase() === "url") cur.url = value;
  }
  flush();
  return out;
}

/** A workspace-relative POSIX path, or undefined when it leaves the root or is not a plain relative path. */
export function workspaceRelative(root: string, target: string): string | undefined {
  const rel = path.relative(root, target).split(path.sep).join("/");
  if (rel === "") return REPO_SET_ROOT_PATH;
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return undefined;
  return rel;
}

/** A repo id from a path: lower-case slug of its last segment (the root uses the root folder's name). */
export function repoSlug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "").slice(0, 120);
  return s || "repo";
}

interface Found {
  path: string; source: RepoSetSource; id?: string; role?: RepoSetRole;
  remote?: RepoRemote | null; defaultBranch?: string | null;
}

const remoteOf = (raw: string | null | undefined): RepoRemote | null => {
  const url = raw ? redactRemoteUrl(raw) : null;
  return url ? { url, host: remoteHost(url) } : null;
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * Discovers the repo set of a workspace. `root` is the workspace root (first folder, or the `.code-workspace` folder);
 * `folders` are the absolute workspace folders. Returns the set and what was left out.
 */
export async function discoverRepoSet(root: string, folders: readonly string[], deps: RepoSetDeps): Promise<{ set: RepoSet; issues: RepoSetIssue[] }> {
  const git = deps.git ? readOnlyGit(deps.git) : undefined;
  const issues: RepoSetIssue[] = [];
  const found = new Map<string, Found>();
  const add = (f: Found) => {
    const prev = found.get(f.path);
    if (!prev) { if (found.size < MAX_REPOS) found.set(f.path, f); else issues.push({ path: f.path, reason: `more than ${MAX_REPOS} repositories` }); return; }
    // The first source that found it stays; declared values (repos.json) win over discovered ones.
    for (const k of ["id", "role", "remote", "defaultBranch"] as const) if (f[k] !== undefined) (prev as unknown as Record<string, unknown>)[k] = f[k];
  };

  for (const folder of folders) {
    const rel = workspaceRelative(root, folder);
    if (!rel) { issues.push({ path: folder.split(path.sep).join("/"), reason: "workspace folder outside the workspace root" }); continue; }
    add({ path: rel, source: "workspace-folder" });
  }
  for (const folder of [...found.keys()]) {
    const base = folder === REPO_SET_ROOT_PATH ? root : path.join(root, folder);
    const text = await deps.readFile(path.join(base, ".gitmodules"));
    if (text === undefined) continue;
    for (const sm of parseGitmodules(text)) {
      const rel = workspaceRelative(root, path.join(base, sm.path));
      if (!rel || rel === REPO_SET_ROOT_PATH) { issues.push({ path: sm.path, reason: `submodule "${sm.name}" path leaves its repository` }); continue; }
      add({ path: rel, source: "submodule", remote: remoteOf(sm.url) });
    }
  }

  const declared = await readReposJson(root, deps, issues);
  for (const r of declared.repos) add(r);

  const repos: RepoSetRepo[] = [];
  const ids = new Set<string>();
  const sorted = [...found.values()].sort((a, b) => a.path === b.path ? 0 : a.path === REPO_SET_ROOT_PATH ? -1 : b.path === REPO_SET_ROOT_PATH ? 1 : a.path < b.path ? -1 : 1);
  // Declared ids first, so a discovered repo never takes a declared id.
  for (const f of sorted) if (f.id) ids.add(f.id);
  const named = sorted.map(f => {
    let id = f.id;
    if (!id) {
      const base = repoSlug(f.path === REPO_SET_ROOT_PATH ? path.basename(root) : f.path.slice(f.path.lastIndexOf("/") + 1));
      id = base; for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
      ids.add(id);
    }
    return { f, id };
  });
  // V5HOLE17: the repos are asked in parallel (each one's questions stay in order), not one after the other.
  repos.push(...await Promise.all(named.map(async ({ f, id }): Promise<RepoSetRepo> => {
    const abs = f.path === REPO_SET_ROOT_PATH ? root : path.join(root, f.path);
    // A plain folder inside another repo must not borrow that repo's remote: ask Git only at a repo's top level.
    const top = !!git && (f.remote === undefined || f.defaultBranch === undefined) && await isRepoTop(git, abs);
    const [origin, head] = top && git ? await Promise.all([
      f.remote === undefined ? gitLine(git, abs, ["config", "--get", "remote.origin.url"]) : Promise.resolve(undefined),
      f.defaultBranch === undefined ? gitLine(git, abs, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]) : Promise.resolve(undefined)
    ]) : [undefined, undefined];
    const remote = f.remote !== undefined ? f.remote : top ? remoteOf(origin) : null;
    const defaultBranch = f.defaultBranch !== undefined ? f.defaultBranch : top ? defaultBranchOf(head) : null;
    return { id, repositoryId: null, path: f.path, role: f.role ?? "other", remote, defaultBranch, source: f.source };
  })));

  const byId = new Set(repos.map(r => r.id));
  const edges: RepoEdge[] = []; const edgeKeys = new Set<string>();
  for (const e of declared.edges) {
    const key = `${e.kind}\u0000${e.from}\u0000${e.to}`;
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) { issues.push({ path: REPOS_JSON_PATH, reason: `edge ${e.from} → ${e.to} names an unknown repo` }); continue; }
    if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push(e); }
  }
  const pins: VendoredPin[] = []; const pinKeys = new Set<string>();
  for (const p of declared.pins) {
    const key = `${p.repo}\u0000${p.package}`;
    if (!byId.has(p.repo) || !byId.has(p.sourceRepo) || p.repo === p.sourceRepo) { issues.push({ path: REPOS_JSON_PATH, reason: `pin ${p.package} names an unknown repo` }); continue; }
    if (!pinKeys.has(key)) { pinKeys.add(key); pins.push(p); }
  }
  return { set: { schema: REPO_SET_SCHEMA_ID, repos, edges, pins }, issues };
}

/** True when `dir` is the top level of a Git work tree (`rev-parse --show-prefix` is empty there). */
async function isRepoTop(git: GitRunner, dir: string): Promise<boolean> {
  try { const r = await git(["rev-parse", "--show-prefix"], dir, GIT_TIMEOUT_MS); return r.ok && r.stdout.trim() === ""; } catch { return false; }
}

async function gitLine(git: GitRunner, cwd: string, args: string[]): Promise<string | undefined> {
  try { const r = await git(args, cwd, GIT_TIMEOUT_MS); return r.ok ? r.stdout.split(/\r?\n/)[0]!.trim() || undefined : undefined; } catch { return undefined; }
}
const defaultBranchOf = (ref: string | undefined): string | null => {
  const b = ref?.replace(/^origin\//, "");
  return b && /^[^\s~^:?*[\\]+$/.test(b) && !b.includes("..") ? b : null;
};

/** `.datapass/repos.json`: `{ repos: [{ path, id?, role?, remote?, defaultBranch? }], edges?: [...], pins?: [{ repo, package, pinnedSha, sourceRepo, version?, digest? }] }`.
 * `pinnedSha`: full commit hash or `{algorithm, oid}`; `digest`: `sha256:<hex>` or `{algorithm, mode, value}` (wire objects). */
async function readReposJson(root: string, deps: RepoSetDeps, issues: RepoSetIssue[]): Promise<{ repos: Found[]; edges: RepoEdge[]; pins: VendoredPin[] }> {
  const out = { repos: [] as Found[], edges: [] as RepoEdge[], pins: [] as VendoredPin[] };
  const text = await deps.readFile(path.join(root, ...REPOS_JSON_PATH.split("/")));
  if (text === undefined) return out;
  let doc: unknown;
  try { doc = JSON.parse(text.replace(/^﻿/, "")); } catch { issues.push({ path: REPOS_JSON_PATH, reason: "not valid JSON" }); return out; }
  if (!isObj(doc) || !Array.isArray(doc.repos)) { issues.push({ path: REPOS_JSON_PATH, reason: "no repos list" }); return out; }
  doc.repos.forEach((r, i) => {
    const at = `${REPOS_JSON_PATH}#/repos/${i}`;
    const p = isObj(r) ? str(r.path) : undefined;
    const rel = p ? workspaceRelative(root, path.resolve(root, p)) : undefined;
    if (!isObj(r) || !rel) { issues.push({ path: at, reason: "repo without a path inside the workspace" }); return; }
    const id = str(r.id); const role = str(r.role);
    if (id !== undefined && !SLUG.test(id)) issues.push({ path: at, reason: `id "${id}" is not a slug` });
    if (role !== undefined && !(REPO_SET_ROLES as readonly string[]).includes(role)) issues.push({ path: at, reason: `unknown role "${role}"` });
    const remoteRaw = str(r.remote);
    if (remoteRaw && !redactRemoteUrl(remoteRaw)) issues.push({ path: at, reason: "remote is not a shareable URL" });
    out.repos.push({
      path: rel, source: "repos-json",
      id: id && SLUG.test(id) ? id : undefined,
      role: role && (REPO_SET_ROLES as readonly string[]).includes(role) ? role as RepoSetRole : undefined,
      remote: remoteRaw ? remoteOf(remoteRaw) : undefined,
      defaultBranch: str(r.defaultBranch) ? defaultBranchOf(str(r.defaultBranch)) : undefined
    });
  });
  for (const e of Array.isArray(doc.edges) ? doc.edges : []) {
    if (!isObj(e) || !str(e.from) || !str(e.to) || !(REPO_EDGE_KINDS as readonly string[]).includes(String(e.kind))) { issues.push({ path: REPOS_JSON_PATH, reason: "edge needs from, to and a known kind" }); continue; }
    out.edges.push({ from: str(e.from)!, to: str(e.to)!, kind: e.kind as RepoEdge["kind"], reason: str(e.reason)?.slice(0, 256) ?? null });
  }
  for (const p of Array.isArray(doc.pins) ? doc.pins : []) {
    const pinnedSha = isObj(p) ? gitObjectId(p.pinnedSha) : null;
    if (!isObj(p) || !str(p.repo) || !str(p.package) || !str(p.sourceRepo) || !pinnedSha) { issues.push({ path: REPOS_JSON_PATH, reason: "pin needs repo, package, sourceRepo and a full SHA" }); continue; }
    const digest = p.digest === undefined || p.digest === null ? null : integrityDigest(p.digest);
    if (p.digest !== undefined && p.digest !== null && !digest) issues.push({ path: REPOS_JSON_PATH, reason: `pin ${str(p.package)} digest is not sha256:<hex>` });
    out.pins.push({ repo: str(p.repo)!, package: str(p.package)!.slice(0, 256), pinnedSha, sourceRepo: str(p.sourceRepo)!,
      version: str(p.version)?.slice(0, 256) ?? null, digest });
  }
  return out;
}

/** Read-only status of one repo of the set. Ahead/behind is against the upstream as of the last fetch. */
export interface RepoSetStatus {
  readonly id: string; readonly path: string;
  readonly state: "ok" | "not-a-repo";
  readonly branch?: string; readonly upstream?: string;
  readonly ahead?: number; readonly behind?: number;
  /** Changed or untracked entries. */
  readonly dirty?: number;
}

/** The status of every repo of the set, at most GIT_CONCURRENCY Git processes at once, in set order. */
export async function repoSetStatus(set: RepoSet, root: string, runner: GitRunner): Promise<RepoSetStatus[]> {
  const git = readOnlyGit(runner);
  const limiter = new Limiter(GIT_CONCURRENCY);
  return Promise.all(set.repos.map(r => limiter.run(async (): Promise<RepoSetStatus> => {
    const cwd = r.path === REPO_SET_ROOT_PATH ? root : path.join(root, r.path);
    if (!await isRepoTop(git, cwd)) return { id: r.id, path: r.path, state: "not-a-repo" };
    let res: { ok: boolean; stdout: string } | undefined;
    try { res = await git(["status", "--porcelain=v2", "--branch"], cwd, GIT_TIMEOUT_MS); } catch { res = undefined; }
    if (!res?.ok) return { id: r.id, path: r.path, state: "not-a-repo" };
    const s = parseStatusV2(res.stdout);
    return { id: r.id, path: r.path, state: "ok", branch: s.branch, upstream: s.upstream, ahead: s.ahead, behind: s.behind, dirty: s.changes ?? 0 };
  })));
}
