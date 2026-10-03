/**
 * V5 GITMR1: local stub of the Common `datapass.repo-set/1` contract (GITSPI1, `project-contracts` v3).
 *
 * Same shapes and enumerations as the GITSPI1 row; once GITSPI1 is merged and vendored (`npm run sync:common`), these
 * types and `redactRemoteUrl` are replaced by imports from `@juliandatapass-group/project-contracts` and this file goes.
 * Pure data, no Git call. Absent optional values are wire `null`.
 */
export const REPO_SET_SCHEMA_ID = "datapass.repo-set/1" as const;
export const REPO_SET_ROLES = Object.freeze(["app", "common", "infra", "data", "docs", "other"] as const);
export type RepoSetRole = (typeof REPO_SET_ROLES)[number];
export const REPO_SET_SOURCES = Object.freeze(["workspace-folder", "submodule", "repos-json"] as const);
export type RepoSetSource = (typeof REPO_SET_SOURCES)[number];
export const REPO_EDGE_KINDS = Object.freeze(["vendors", "depends", "deploys", "lineage"] as const);
export type RepoEdgeKind = (typeof REPO_EDGE_KINDS)[number];
export const REPOSITORY_HOSTS = Object.freeze(["gitlab", "github", "azure-devops", "other"] as const);
export type RepositoryHost = (typeof REPOSITORY_HOSTS)[number];
/** Workspace-relative path of the workspace root itself. */
export const REPO_SET_ROOT_PATH = ".";

export interface RepoRemote { url: string; host: RepositoryHost }
export interface RepoSetRepo {
  id: string; repositoryId: string | null; path: string; role: RepoSetRole;
  remote: RepoRemote | null; defaultBranch: string | null; source: RepoSetSource;
}
export interface RepoEdge { from: string; to: string; kind: RepoEdgeKind; reason: string | null }
/** Git object id (project-contracts `gitObjectIdSchema`). */
export type GitObjectId = { algorithm: "git-sha1"; oid: string } | { algorithm: "git-sha256"; oid: string };
/** Exact-bytes integrity digest (semantic-core `integrityDigestSchema`). */
export interface IntegrityDigest { algorithm: "sha256"; mode: "exact-bytes"; value: string }
/** A vendored copy, pinned by source commit and (1 Oct ARCH rule) by package version and SHA-256 digest of the copy. */
export interface VendoredPin { repo: string; package: string; pinnedSha: GitObjectId; sourceRepo: string; version: string | null; digest: IntegrityDigest | null }
/** Wire header is `schema` (reviewed GITSPI1 shape, 13:20 wire fixes), not `schemaId`. */
export interface RepoSet { schema: typeof REPO_SET_SCHEMA_ID; repos: RepoSetRepo[]; edges: RepoEdge[]; pins: VendoredPin[] }

/** A full commit hash as a Git object id: 40 hex → git-sha1, 64 hex → git-sha256; anything else `null`. */
export function gitObjectId(raw: unknown): GitObjectId | null {
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    const id = gitObjectId(o.oid);
    return id && id.algorithm === o.algorithm ? id : null;
  }
  const hex = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[0-9a-f]{40}$/.test(hex) ? { algorithm: "git-sha1", oid: hex } : /^[0-9a-f]{64}$/.test(hex) ? { algorithm: "git-sha256", oid: hex } : null;
}

/** A SHA-256 of the exact bytes, from the prefixed form `sha256:<hex>` or the wire object; bare or other hashes are `null`. */
export function integrityDigest(raw: unknown): IntegrityDigest | null {
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    return o.algorithm === "sha256" && o.mode === "exact-bytes" ? integrityDigest(`sha256:${String(o.value)}`) : null;
  }
  const m = typeof raw === "string" ? /^sha256:([0-9a-fA-F]{64})$/.exec(raw.trim()) : null;
  return m ? { algorithm: "sha256", mode: "exact-bytes", value: m[1]!.toLowerCase() } : null;
}

/**
 * A raw remote URL in its credential-free form (GITSPI1 rule): userinfo, query and fragment dropped, `http:` → `https:`,
 * the scp form keeps its `git@` user. `null` for local paths and `file:` URLs.
 */
export function redactRemoteUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const scp = /^([^\s/@:]+@)?([^\s/@:]+):(?!\/\/)([^\s?#]+)/.exec(text);
  if (scp && !/^[A-Za-z]$/.test(scp[2]!)) return `git@${scp[2]}:${scp[3]}`;
  const url = /^(https?|ssh):\/\/(?:[^\s/?#@]*@)?([A-Za-z0-9.-]+)(:[0-9]+)?(\/[^\s?#]*)?(?:[?#].*)?$/i.exec(text);
  if (!url || !url[4] || url[4].length <= 1) return null;
  const scheme = url[1]!.toLowerCase() === "ssh" ? "ssh" : "https";
  return `${scheme}://${url[2]!.toLowerCase()}${url[3] ?? ""}${url[4]}`;
}

/** The hosting service of a redacted remote, by host name. */
export function remoteHost(url: string): RepositoryHost {
  const host = (/^[a-z]+:\/\/([^/:]+)/i.exec(url)?.[1] ?? /^git@([^:]+):/.exec(url)?.[1] ?? "").toLowerCase();
  if (/(^|\.)gitlab\./.test(host) || host === "gitlab.com") return "gitlab";
  if (host === "github.com" || /(^|\.)github\./.test(host)) return "github";
  if (host === "dev.azure.com" || host.endsWith(".visualstudio.com") || host === "ssh.dev.azure.com") return "azure-devops";
  return "other";
}
