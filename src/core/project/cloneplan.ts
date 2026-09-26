/**
 * Open a Client Project (V1-ON): which repositories to clone, which are already on this computer,
 * and which are never cloned. Pure: the command observes the disk and Git (origins of folders),
 * this module turns the bridge's manifest and those observations into a plan a person confirms.
 *
 *   declared repository ──► present (a clone with the same remote identity, wherever it sits)
 *                         │  clone   (the target folder is free)
 *                         │  planned (never cloned: the repository does not exist yet)
 *                         │  no-remote (nothing to clone from)
 *                         └  conflict (the target folder holds something else, or lies outside the chosen folder)
 *
 * A clone is recognised by its origin's identity (gitHosts.remoteIdentity), never by its folder
 * name: https and SSH forms of one repository, and the five Azure DevOps forms, are the same.
 */
import * as nodePath from "node:path";
import type { DataPassProjectManifest } from "../projectManifestModel";
import { gitHostOf, remoteIdentity, remoteParts, repositoryName, GIT_HOST_LABELS } from "./gitHosts";

export type PathApi = Pick<typeof nodePath, "resolve" | "relative" | "isAbsolute" | "join" | "sep">;

/** What the command saw in one folder: whether it exists, whether it is a Git clone, and its origin. */
export interface FolderFact {
  folder: string;
  exists: boolean;
  isGitRepo?: boolean;
  origin?: string;
}

export type CloneState = "present" | "clone" | "planned" | "no-remote" | "conflict";

export interface CloneEntry {
  key: string;
  label: string;
  /** What lives in this repository (the manifest's description). */
  role?: string;
  remoteUrl?: string;
  state: CloneState;
  /** Where the clone is (present) or will be (clone). */
  folder?: string;
  detail: string;
  /** Ticked in the checkbox list: every repository to clone, except remote-only ones. */
  picked: boolean;
}

// ------------------------------------------------------------------ the bridge address

export interface BridgeAddress { url: string; identity: string; name: string; host: string }

/**
 * A pasted bridge address: GitHub, Azure DevOps or GitLab (any host), https or SSH. Returns a
 * reason when it is not a Git address DataPass clones from (http, file paths, option-like text).
 */
export function parseBridgeUrl(input: string): BridgeAddress | { error: string } {
  const url = input.trim().replace(/^git clone\s+/i, "").trim();
  if (!url) return { error: "Paste the Git address of the bridge repository." };
  if (/\s/.test(url) || url.startsWith("-")) return { error: "A Git address has no spaces and does not start with '-'." };
  if (/^http:\/\//i.test(url)) return { error: "Use the https address (http sends your sign-in in clear)." };
  if (!/^(https:\/\/|ssh:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)/i.test(url)) return { error: "Paste an https or SSH address (GitHub, Azure DevOps or GitLab), as the host's Clone button shows it." };
  const parts = remoteParts(url);
  const identity = remoteIdentity(url);
  const name = repositoryName(url);
  if (!parts || !identity || !name) return { error: "This address has no repository path." };
  const kind = gitHostOf(url)?.kind;
  return { url, identity, name, host: kind ? GIT_HOST_LABELS[kind] : parts.host };
}

// ------------------------------------------------------------------ locating clones

const inside = (parent: string, child: string, p: PathApi) => {
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !p.isAbsolute(rel));
};
const sameFolder = (a: string, b: string, p: PathApi) => {
  const n = (x: string) => p.resolve(x).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/** The clone of `url` among the observed folders (same remote identity), preferring `preferred`. */
export function locateClone(url: string | undefined, facts: readonly FolderFact[], preferred?: string, p: PathApi = nodePath): string | undefined {
  const id = remoteIdentity(url);
  if (!id) return undefined;
  const matches = facts.filter(f => f.exists && f.isGitRepo && remoteIdentity(f.origin) === id);
  return (preferred && matches.find(f => sameFolder(f.folder, preferred, p)) || matches[0])?.folder;
}

/** Where the bridge goes: an existing clone of it in the chosen folder, or `<parent>/<name>` when free. */
export function planBridge(bridge: BridgeAddress, parent: string, facts: readonly FolderFact[], p: PathApi = nodePath): { state: "present" | "clone" | "conflict"; folder: string; detail: string } {
  const target = p.join(parent, bridge.name);
  const found = locateClone(bridge.url, facts, target, p);
  if (found) return { state: "present", folder: found, detail: "already cloned" };
  const fact = facts.find(f => sameFolder(f.folder, target, p));
  if (fact?.exists) return { state: "conflict", folder: target, detail: fact.isGitRepo ? `${target} is a clone of another repository${fact.origin ? ` (${remoteIdentity(fact.origin) ?? fact.origin})` : ""}` : `${target} exists and is not a Git clone` };
  return { state: "clone", folder: target, detail: `clone into ${target}` };
}

/** The folder a declared repository is expected in: its declared path (relative to the bridge), else `<parent>/<name>`. */
export function expectedFolder(repo: { path?: string; remote?: { url: string } }, bridgeFolder: string, parent: string, p: PathApi = nodePath): string | undefined {
  if (repo.path) return p.isAbsolute(repo.path) ? p.resolve(repo.path) : p.resolve(bridgeFolder, repo.path);
  const name = repositoryName(repo.remote?.url);
  return name ? p.join(parent, name) : undefined;
}

/**
 * Folders the command must look at before planning: each repository's expected folder. The command
 * adds the chosen folder's sub-folders, so a clone under another name is found too.
 */
export function candidateFolders(manifest: DataPassProjectManifest, bridgeFolder: string, parent: string, p: PathApi = nodePath): string[] {
  const out: string[] = [];
  for (const repo of Object.values(manifest.repositories ?? {})) {
    if (repo.planned) continue;
    const f = expectedFolder(repo, bridgeFolder, parent, p);
    if (f && !out.some(o => sameFolder(o, f, p))) out.push(f);
  }
  return out;
}

// ------------------------------------------------------------------ the plan

export function planClones(manifest: DataPassProjectManifest, o: { bridgeFolder: string; bridgeUrl: string; parent: string; facts: readonly FolderFact[] }, p: PathApi = nodePath): CloneEntry[] {
  const bridgeId = remoteIdentity(o.bridgeUrl);
  const entries: CloneEntry[] = [];
  const claimed: string[] = [o.bridgeFolder];
  for (const [key, repo] of Object.entries(manifest.repositories ?? {})) {
    const base = { key, label: repo.label ?? key, role: repo.description, remoteUrl: repo.remote?.url };
    if (repo.planned) { entries.push({ ...base, state: "planned", detail: "planned: the repository does not exist yet, never cloned", picked: false }); continue; }
    const url = repo.remote?.url;
    const id = remoteIdentity(url);
    // The bridge itself, declared among the repositories.
    if ((id && id === bridgeId) || repo.path === ".") { entries.push({ ...base, state: "present", folder: o.bridgeFolder, detail: "the bridge repository", picked: false }); continue; }
    const expected = expectedFolder(repo, o.bridgeFolder, o.parent, p);
    const found = locateClone(url, o.facts.filter(f => !claimed.some(c => sameFolder(c, f.folder, p))), expected, p);
    if (found) { claimed.push(found); entries.push({ ...base, state: "present", folder: found, detail: `already cloned in ${found}`, picked: false }); continue; }
    if (url && (!id || !/^(https:\/\/|ssh:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)/i.test(url) || url.startsWith("-"))) { entries.push({ ...base, state: "conflict", detail: `the declared address is not an https or SSH Git address: ${url}`, picked: false }); continue; }
    if (!url) {
      const fact = expected ? o.facts.find(f => sameFolder(f.folder, expected, p)) : undefined;
      entries.push(fact?.exists
        ? { ...base, state: "present", folder: expected, detail: `folder ${expected} (no remote declared: not verified)`, picked: false }
        : { ...base, state: "no-remote", detail: "no remote address declared: nothing to clone from", picked: false });
      if (fact?.exists) claimed.push(expected!);
      continue;
    }
    if (!expected || !inside(o.parent, expected, p)) { entries.push({ ...base, state: "conflict", folder: expected, detail: `its declared folder ${expected ?? "?"} is outside ${o.parent}: clone it yourself`, picked: false }); continue; }
    const fact = o.facts.find(f => sameFolder(f.folder, expected, p));
    if (fact?.exists) {
      entries.push({ ...base, state: "conflict", folder: expected, detail: fact.isGitRepo ? `${expected} is a clone of another repository${fact.origin ? ` (${remoteIdentity(fact.origin) ?? "unknown origin"})` : " (no origin)"}` : `${expected} exists and is not a Git clone`, picked: false });
      continue;
    }
    claimed.push(expected);
    entries.push({ ...base, state: "clone", folder: expected, detail: `clone into ${expected}`, picked: repo.management !== "remote-only" });
  }
  return entries;
}

/** Folders of the company workspace: the bridge first, then every repository on this computer, in manifest order. */
export function workspaceRoots(bridgeFolder: string, entries: readonly CloneEntry[], p: PathApi = nodePath): string[] {
  const out = [bridgeFolder];
  for (const e of entries) if (e.state === "present" && e.folder && !out.some(o => sameFolder(o, e.folder!, p))) out.push(e.folder);
  return out;
}

/** One line per repository for the summary. */
export function planSummary(entries: readonly CloneEntry[]): { present: number; toClone: number; planned: number; blocked: number } {
  return {
    present: entries.filter(e => e.state === "present").length,
    toClone: entries.filter(e => e.state === "clone").length,
    planned: entries.filter(e => e.state === "planned").length,
    blocked: entries.filter(e => e.state === "conflict" || e.state === "no-remote").length
  };
}

// ------------------------------------------------------------------ clone failures

/** Whether Git's message says the host refused or asked for a sign-in (so the person signs in, then retries). */
export function isAuthFailure(stderr: string): boolean {
  return /authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \(publickey|access denied|\b40[13]\b|repository not found|not authorized|invalid credentials|could not read from remote repository|host key verification failed/i.test(stderr);
}

/** The host's own message, without Git's progress lines: the last meaningful lines of stderr. */
export function hostMessage(stderr: string, maxLines = 6): string {
  const lines = stderr.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(Cloning into|remote: (Counting|Compressing|Enumerating|Total)|Receiving objects|Resolving deltas)/i.test(l));
  return lines.slice(-maxLines).join("\n") || "Git gave no message.";
}
