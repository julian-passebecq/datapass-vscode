/**
 * Repository and artifact resolution (V3). Pure: the session observes the disk and Git, this
 * module turns declarations + observations into states a person can act on.
 *
 *   declared repository  ──►  local | unverified | wrong-remote | not-a-repo | missing | unbound | planned | restricted
 *   declared component   ──►  expected files ──►  found | missing | unbound | planned | unknown
 *
 * A declaration is an expectation. Only an observation says a file exists, and a repository whose
 * clone is not here is "unbound" (its files are unknown, never "missing"). A clone whose origin
 * could not be compared with the declared remote is "unverified" (0.22, F04): its files can be
 * browsed, but nothing that relies on its identity (Get updates, work orders) runs.
 */
import type { DataPassProjectManifest, RepositoryBinding } from "../projectManifestModel";
import type { ArtifactsDecl, GraphItem, ProjectGraph } from "../workspace/graph";
import { PHASES, type Phase } from "../capabilities/registry";
import { defaultProfileFor, guessRole, pathKind, PROFILE_INDEX, requiredPhases, type ArtifactProfile, type FileRole } from "./profiles";
import type { StatusCounts } from "../git/porcelain";
import { vetRelativePath } from "../exchange/pathSafety";
import { sha256Bytes } from "../model/ids";
import { remoteIdentity, repositoryName } from "./gitHosts";

/** Key of the repository holding the manifest when the manifest does not declare it. */
export const COORDINATION_KEY = ".";

// ------------------------------------------------------------------ remotes

/**
 * host/owner/repo, lowercased, without protocol, credentials or .git: the identity of a Git remote.
 * The https and ssh forms of one Azure DevOps repository (and its legacy visualstudio.com forms)
 * have the same identity (see gitHosts.ts).
 */
export function normalizeRemote(url: string | undefined): string | undefined {
  return remoteIdentity(url);
}

export function sameRemote(a: string | undefined, b: string | undefined): boolean {
  const x = normalizeRemote(a), y = normalizeRemote(b);
  return Boolean(x && y && x === y);
}

/** The repository's name (last path segment, original case): the folder name a clone usually gets. */
export function repoNameFromRemote(url: string | undefined): string | undefined {
  return repositoryName(url);
}

/**
 * Matcher for the last segment of a profile path: `*` (any characters but "/"), `?` (one) and
 * `{a,b}` (one of the alternatives, e.g. `*.{yml,yaml}`). Case-insensitive on Windows.
 */
export function globMatcher(pattern: string, caseInsensitive = process.platform === "win32"): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const close = pattern.indexOf("}", i);
      if (close < 0) { re += "\\{"; continue; }
      re += `(?:${pattern.slice(i + 1, close).split(",").map(a => a.replace(/[.+^${}()|[\]\\*?]/g, "\\$&")).join("|")})`;
      i = close;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, caseInsensitive ? "i" : "");
}

// ------------------------------------------------------------------ repositories

export type RepoState = "local" | "unverified" | "wrong-remote" | "not-a-repo" | "missing" | "unbound" | "planned" | "restricted";

/** A folder DataPass may read files from: a verified clone, an unverified one, or a plain folder. */
export const isBrowsable = (state: RepoState | undefined): boolean => state === "local" || state === "unverified" || state === "not-a-repo";

/** What the session saw for one repository key. Folders are absolute and never leave the session. */
export interface RepoObservation {
  key: string;
  folder?: string;
  source: "coordination" | "declared-path" | "local-binding" | "workspace-folder" | "sibling-folder" | "none";
  exists: boolean;
  isGitRepo?: boolean;
  /** Not inspected: Restricted Mode (untrusted workspace) never runs Git. */
  restricted?: boolean;
  git?: RepoGitState;
  /** Not located, but a folder of the repository's name is next to it: no Git origin, or another one (V1-STAB). */
  nearby?: { folderName: string; origin: "none" | "other" };
}

export interface RepoGitState {
  head?: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** Changed or untracked entries. */
  changes?: number;
  /** Changed tracked files only. */
  trackedChanges?: number;
  originUrl?: string;
  /**
   * 0.22 (F04): how the origin lookup went. "absent": Git answered and the clone has no origin;
   * "failed": Git could not answer (timeout, error). Undefined in older observations means "ok" when
   * originUrl is set.
   */
  originLookup?: "ok" | "absent" | "failed";
  /** When the remote was last fetched (FETCH_HEAD), ISO time. */
  lastFetch?: string;
  /** 0.19: the same status split for the Git view (staged, unstaged, untracked, conflicted). */
  counts?: StatusCounts;
}

export interface RepoView {
  key: string;
  label: string;
  description?: string;
  state: RepoState;
  coordination: boolean;
  /** Declared remote, shown as host/owner/repo. */
  remote?: string;
  remoteUrl?: string;
  branch?: string;
  source?: RepoObservation["source"];
  folderName?: string;
  git?: RepoGitState;
  /** Plain-language state. */
  detail: string;
  nextStep?: string;
  usedBy: string[];
}

function describeGit(g: RepoGitState | undefined): string {
  if (!g) return "not a Git repository";
  const parts = [g.branch === "(detached)" ? "detached" : g.branch ?? "?", g.head ? g.head.slice(0, 7) : "no commit"];
  parts.push(g.changes ? `${g.changes} change${g.changes === 1 ? "" : "s"}` : "clean");
  if (!g.upstream) parts.push("no upstream");
  else if (g.behind || g.ahead) parts.push([g.behind ? `${g.behind} to get` : "", g.ahead ? `${g.ahead} to push` : ""].filter(Boolean).join(", "));
  else parts.push("up to date as of the last check");
  return parts.join(" · ");
}

export function resolveRepositories(manifest: DataPassProjectManifest | undefined, observations: ReadonlyMap<string, RepoObservation>, coordinationKey: string, usage: ReadonlyMap<string, string[]> = new Map()): RepoView[] {
  const views: RepoView[] = [];
  const declared = Object.entries(manifest?.repositories ?? {});
  if (coordinationKey === COORDINATION_KEY) declared.unshift([COORDINATION_KEY, { label: "This repository (coordination)", management: "local", path: "." } as RepositoryBinding]);
  for (const [key, repo] of declared.slice(0, 60)) {
    const obs = observations.get(key);
    const coordination = key === coordinationKey;
    const remote = normalizeRemote(repo.remote?.url);
    const base = { key, label: repo.label ?? (coordination ? "Coordination repository" : key), description: repo.description, coordination, remote, remoteUrl: repo.remote?.url, branch: repo.remote?.branch, usedBy: usage.get(key) ?? [] };
    if (repo.planned) {
      views.push({ ...base, state: "planned", detail: "planned: this repository does not exist yet", nextStep: remote ? `Create ${remote} (empty), then clone it here.` : "Create this repository, then declare its remote URL." });
      continue;
    }
    if (obs?.restricted) { views.push({ ...base, state: "restricted", source: obs.source, folderName: folderName(obs.folder), detail: "not inspected in Restricted Mode", nextStep: "Trust this workspace to let DataPass read Git state." }); continue; }
    if (!obs || !obs.exists) {
      if (repo.path && !coordination) views.push({ ...base, state: "missing", detail: `not found at the declared path ${repo.path}`, nextStep: remote ? `Clone ${remote} there, or locate an existing clone.` : "Fix repositories." + key + ".path, or locate the folder." });
      else if (remote && obs?.nearby) views.push({ ...base, state: "unbound", detail: `folder ${obs.nearby.folderName} found, ${obs.nearby.origin === "none" ? "no remote" : "its remote is another repository"}: identity not verified`, nextStep: `If it is this repository, run Locate an Existing Clone… on it (DataPass then remembers it on this machine); otherwise clone ${remote}.` });
      else if (remote) views.push({ ...base, state: "unbound", detail: "not cloned on this machine (or not found next to this repository)", nextStep: `Clone ${remote}, or locate an existing clone.` });
      else views.push({ ...base, state: "missing", detail: "no local folder and no remote declared", nextStep: `Declare repositories.${key}.remote.url or a path.` });
      continue;
    }
    const common = { ...base, source: obs.source, folderName: folderName(obs.folder), git: obs.git };
    if (!obs.isGitRepo) { views.push({ ...common, state: "not-a-repo", detail: "folder found, but it is not a Git repository", nextStep: remote ? `Clone ${remote} instead, or run git init.` : undefined }); continue; }
    if (remote && obs.git?.originUrl && !sameRemote(obs.git.originUrl, repo.remote?.url)) {
      views.push({ ...common, state: "wrong-remote", detail: `this folder's origin is ${normalizeRemote(obs.git.originUrl) ?? "another repository"}, not ${remote}`, nextStep: "Locate the right clone; DataPass does not trust a folder name." });
      continue;
    }
    // A declared remote that could not be compared: browsing is fine, identity is not proven (F04).
    if (remote && !obs.git?.originUrl) {
      const failed = obs.git?.originLookup === "failed";
      views.push({ ...common, state: "unverified", detail: failed ? `unverified: Git could not read this folder's origin, so DataPass cannot confirm it is ${remote}` : `unverified: this folder has no origin, so DataPass cannot confirm it is ${remote}`, nextStep: failed ? "Retry (Refresh), or locate the right clone." : `Locate the right clone, or add the origin (git remote add origin <${remote} URL>) and refresh.` });
      continue;
    }
    views.push({ ...common, state: "local", detail: describeGit(obs.git), nextStep: obs.git?.behind ? `${obs.git.behind} new commit(s) on the remote: review and get them.` : undefined });
  }
  return views;
}

function folderName(folder: string | undefined): string | undefined {
  return folder?.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
}

// ------------------------------------------------------------------ artifacts

export type FileState = "found" | "missing" | "unbound" | "planned" | "unknown";

/**
 * 0.22 (F02): how a file's content was identified. "sha256" is a digest of every byte; "stat" is
 * only size + modification time (a file too large for the byte budget), which two different
 * contents can share: it detects most edits but proves nothing.
 */
export type Fingerprint = { kind: "sha256"; value: string } | { kind: "stat"; size: number; mtimeMs: number };

/** 0.22 (F03): Git tracking of a file that must not be committed; "unknown" never counts as clean. */
export interface TrackingObservation { state: "tracked" | "untracked" | "unknown"; reason?: string }

export const fingerprintText = (f: Fingerprint): string => f.kind === "sha256" ? `sha256:${f.value}` : `stat:${f.size}:${f.mtimeMs}`;

/** What the session saw at `${repoKey}\0${repoPath}`. */
export interface FileObservation {
  state: "found" | "missing" | "unknown";
  kind?: "file" | "dir";
  /** Matches for a folder or wildcard. */
  count?: number;
  /** Content fingerprint (files asked to be hashed only). Absent with `hashError` when reading failed. */
  fingerprint?: Fingerprint;
  hashError?: string;
  /** Git tracking (checked only for files that must not be committed). */
  tracking?: TrackingObservation;
  detail?: string;
}

export const obsKey = (repoKey: string, repoPath: string) => `${repoKey}\u0000${repoPath}`;

export interface ExpectedFile {
  /** Relative to the component root, as declared. */
  path: string;
  /** Relative to the repository root. */
  repoPath: string;
  kind: "file" | "dir" | "glob";
  role: FileRole;
  requiredFor: Phase[];
  optional: boolean;
  source: "profile" | "declared" | "entry" | "generated";
  about?: string;
  generated?: { producer: string; how?: string };
  state: FileState;
  count?: number;
  fingerprint?: Fingerprint;
}

export type Availability = "none-declared" | "planned-repo" | "unbound" | "restricted" | "complete" | "incomplete" | "generation-needed" | "unknown";

export interface ArtifactView {
  repoKey: string;
  root: string;
  profile: ArtifactProfile;
  profileDeclared: boolean;
  entry?: ExpectedFile;
  files: ExpectedFile[];
  availability: Availability;
  summary: { expected: number; found: number; missing: number; generatedMissing: number; optionalMissing: number };
  /** Digest of the found files' fingerprints; changes whenever one of them changes. */
  digest?: string;
  /**
   * 0.22 (F02): "exact" when every found file was hashed; "weak" when one is only a size + time
   * stamp or could not be read. Anything that needs exact content (qualification results, approvals)
   * treats a weak digest as unknown.
   */
  digestStrength?: "exact" | "weak";
  mustNotCommit: Array<{ path: string; repoPath: string; why: string; tracked: boolean; tracking: TrackingObservation["state"]; trackingReason?: string }>;
  issues: string[];
}

/** Repository of a component: its own repoRef, then its scope's repoRef, then the coordination repository. */
export function componentRepoKey(item: GraphItem, scopeRepo: string | undefined, coordinationKey: string): string {
  return item.artifacts?.repoRef ?? item.repoRef ?? scopeRepo ?? coordinationKey;
}

const joinPath = (root: string, p: string) => {
  const r = root.replace(/\\/g, "/").replace(/^\.\/?/, "").replace(/\/+$/, "");
  const q = p.replace(/\\/g, "/").replace(/^\.\//, "");
  return r ? `${r}/${q}` : q;
};

/** The artifact declaration of an item, including the 0.1 shape (repoRef + path) as a one-file set. */
export function artifactsOf(item: GraphItem): ArtifactsDecl | undefined {
  if (item.artifacts) return item.artifacts;
  if (item.path) {
    const parts = item.path.replace(/\\/g, "/").split("/");
    const entry = parts.pop()!;
    return { repoRef: item.repoRef, root: parts.join("/") || ".", entry, profile: item.nativeType === "databricks.bundle" ? "databricks.bundle" : undefined };
  }
  return undefined;
}

/** Expected files of an item before observation (profile defaults merged with declarations). */
export function expectedFiles(item: GraphItem, decl: ArtifactsDecl): { profile: ArtifactProfile; profileDeclared: boolean; root: string; entry?: string; files: Omit<ExpectedFile, "state" | "count" | "fingerprint" | "repoPath">[]; issues: string[] } {
  const issues: string[] = [];
  const declaredProfile = decl.profile ? PROFILE_INDEX.get(decl.profile) : undefined;
  if (decl.profile && !declaredProfile) issues.push(`profile "${decl.profile}" is not known to this DataPass version; files are listed without conventions`);
  const profile = declaredProfile ?? defaultProfileFor(item.provider);
  const root = (decl.root ?? ".").replace(/\\/g, "/");
  if (!vetRelativePath(root === "." ? "x" : root).ok) issues.push(`root "${root}" is not a relative path inside the repository`);
  const entry = decl.entry ?? profile.entry;
  const byPath = new Map<string, Omit<ExpectedFile, "state" | "count" | "fingerprint" | "repoPath">>();
  const add = (f: Omit<ExpectedFile, "state" | "count" | "fingerprint" | "repoPath">) => byPath.set(f.path, { ...byPath.get(f.path), ...f });
  for (const pf of profile.files) add({ path: pf.path, kind: pathKind(pf.path), role: pf.role, requiredFor: [...requiredPhases(pf)], optional: Boolean(pf.optional), source: "profile", about: pf.about });
  for (const raw of decl.files ?? []) {
    const d = typeof raw === "string" ? { path: raw } : raw;
    const prev = byPath.get(d.path);
    const role = d.role ?? prev?.role ?? guessRole(d.path);
    const optional = d.optional ?? (prev ? prev.optional : false);
    add({ path: d.path, kind: pathKind(d.path), role, optional, requiredFor: d.requiredFor ? [...d.requiredFor] : [...requiredPhases({ role, optional })], source: prev ? prev.source : "declared", about: d.description ?? prev?.about });
  }
  if (entry) {
    const prev = byPath.get(entry);
    add({ path: entry, kind: pathKind(entry), role: "entry", optional: false, requiredFor: [...PHASES], source: prev?.source === "declared" ? "declared" : "entry", about: prev?.about ?? "Entry point of this component." });
  }
  for (const g of decl.generated ?? []) {
    add({ path: g.path, kind: pathKind(g.path) === "file" ? "file" : "dir", role: "other", optional: false, requiredFor: g.requiredFor ? [...g.requiredFor] : ["validate", "deploy", "run"], source: "generated", generated: { producer: g.producer, how: g.how }, about: `Generated by ${g.producer}; not committed as source.` });
  }
  // Entry first, then required, then optional; stable by path.
  const rank = (f: { role: FileRole; optional: boolean; source: string }) => (f.role === "entry" ? 0 : f.source === "generated" ? 2 : f.optional ? 3 : 1);
  const files = [...byPath.values()].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  for (const f of files) if (!vetRelativePath(f.path.replace(/\/\*\*$/, "/x").replace(/\*/g, "x")).ok) issues.push(`file "${f.path}" is not a relative path inside the component`);
  return { profile, profileDeclared: Boolean(declaredProfile), root, entry, files, issues };
}

export interface ArtifactPlanEntry { repoKey: string; repoPath: string; kind: "file" | "dir" | "glob"; hash: boolean; tracked: boolean }

/** Everything to observe for these items (deduplicated), given each item's repository key. */
export function artifactPlan(items: ReadonlyArray<{ item: GraphItem; repoKey: string }>): ArtifactPlanEntry[] {
  const out = new Map<string, ArtifactPlanEntry>();
  for (const { item, repoKey } of items) {
    const decl = artifactsOf(item);
    if (!decl) continue;
    const e = expectedFiles(item, decl);
    if (e.issues.some(i => i.startsWith("root"))) continue;
    out.set(obsKey(repoKey, e.root === "." ? "" : e.root), { repoKey, repoPath: e.root === "." ? "" : e.root.replace(/\/+$/, ""), kind: "dir", hash: false, tracked: false });
    for (const f of e.files) {
      const repoPath = joinPath(e.root, f.path).replace(/\/\*\*$/, "").replace(/\/$/, "");
      out.set(obsKey(repoKey, repoPath), { repoKey, repoPath, kind: f.kind, hash: f.kind === "file", tracked: false });
    }
    for (const m of e.profile.mustNotCommit ?? []) {
      const repoPath = joinPath(e.root, m.path);
      out.set(obsKey(repoKey, repoPath), { repoKey, repoPath, kind: "file", hash: false, tracked: true });
    }
  }
  return [...out.values()];
}

/** Expected files with their observed state. */
export function resolveArtifacts(item: GraphItem, decl: ArtifactsDecl, repoKey: string, repo: RepoView | undefined, obs: ReadonlyMap<string, FileObservation>): ArtifactView {
  const e = expectedFiles(item, decl);
  const repoState = repo?.state;
  const local = isBrowsable(repoState);
  const rootObs = obs.get(obsKey(repoKey, e.root === "." ? "" : e.root.replace(/\/+$/, "")));
  const files: ExpectedFile[] = e.files.map(f => {
    const repoPath = joinPath(e.root, f.path).replace(/\/\*\*$/, "").replace(/\/$/, "");
    if (!repo || repoState === "planned") return { ...f, repoPath, state: "planned" as const };
    if (repoState === "restricted") return { ...f, repoPath, state: "unknown" as const };
    if (!local) return { ...f, repoPath, state: "unbound" as const };
    const o = obs.get(obsKey(repoKey, repoPath));
    const state: FileState = !o ? "unknown" : o.state === "found" ? "found" : o.state === "missing" ? "missing" : "unknown";
    return { ...f, repoPath, state, count: o?.count, fingerprint: o?.fingerprint };
  });
  const required = files.filter(f => !f.optional);
  const summary = {
    expected: required.length,
    found: required.filter(f => f.state === "found").length,
    missing: required.filter(f => f.state === "missing" && f.source !== "generated").length,
    generatedMissing: required.filter(f => f.state === "missing" && f.source === "generated").length,
    optionalMissing: files.filter(f => f.optional && f.state === "missing").length
  };
  const availability: Availability =
    !repo || repoState === "planned" ? "planned-repo"
    : repoState === "restricted" ? "restricted"
    : !local ? "unbound"
    : files.some(f => !f.optional && f.state === "unknown") ? "unknown"
    : summary.missing ? "incomplete"
    : summary.generatedMissing ? "generation-needed"
    : required.length || files.length ? "complete"
    : "none-declared";
  // Every found file counts: a file that could not be hashed makes the digest weak, never smaller.
  const foundFiles = files.filter(f => f.state === "found" && f.kind === "file");
  const found = foundFiles.map(f => `${f.repoPath}\0${f.fingerprint ? fingerprintText(f.fingerprint) : "unread"}`).sort();
  const digest = local && found.length ? sha256Bytes(found.join("\n")).value.slice(0, 16) : undefined;
  const digestStrength = digest ? (foundFiles.every(f => f.fingerprint?.kind === "sha256") ? "exact" as const : "weak" as const) : undefined;
  const issues = [...e.issues];
  if (local && rootObs?.state === "missing" && e.root !== ".") issues.push(`the folder ${e.root} does not exist in this repository`);
  const mustNotCommit = (e.profile.mustNotCommit ?? []).map(m => {
    const repoPath = joinPath(e.root, m.path);
    const t = local ? obs.get(obsKey(repoKey, repoPath))?.tracking : undefined;
    const tracking = t?.state ?? "unknown";
    const trackingReason = t?.reason ?? (!local ? "the repository is not cloned here" : "not checked");
    return { path: m.path, repoPath, why: m.why, tracked: tracking === "tracked", tracking, trackingReason: tracking === "unknown" ? trackingReason : undefined };
  });
  for (const m of mustNotCommit) {
    if (m.tracked) issues.push(`${m.path} is committed to Git although it ${m.why}: remove it from the repository and rotate what it contains`);
    else if (m.tracking === "unknown" && local) issues.push(`could not check Git tracking of ${m.path} (${m.trackingReason}): it ${m.why}, so check it is not committed`);
  }
  return {
    repoKey, root: e.root, profile: e.profile, profileDeclared: e.profileDeclared,
    entry: e.entry ? files.find(f => f.path === e.entry) : undefined,
    files, availability, summary, digest, digestStrength, mustNotCommit, issues
  };
}
