/**
 * Shared resources and workload bindings (V2.1 §7 "Resource and target binding"). Pure.
 *
 * A resource is declared once (an Oracle VM, a container host, a cluster). A binding says how one
 * workload/scope uses it: its folder on the host, repository, Compose file, the *names* of the
 * environment variables it needs and its processes. One VM can carry Wind and Hydro bindings with
 * different folders; rebooting or upgrading the VM affects both, and DataPass says so.
 *
 * Never stored: credentials, env values, private keys, user@host strings. SSH hosts are aliases
 * from the user's own ~/.ssh/config, so a manifest cannot point DataPass at an arbitrary machine.
 */
import { vetRelativePath } from "../exchange/pathSafety";
import type { DataPassProjectManifest } from "../projectManifestModel";

export const RESOURCE_KINDS = ["vm", "container-host", "kubernetes-cluster", "database", "workspace", "other"] as const;
export type ResourceKind = typeof RESOURCE_KINDS[number];

export interface ResourceDecl { id: string; kind: ResourceKind; title?: string; provider?: string; ssh?: { host: string } }
export interface BindingDecl {
  id: string;
  resource: string;
  /** Scope ids (or "project"); omitted = every scope. */
  scopes?: string[];
  /** Absolute folder on the host, e.g. /opt/foil/wind. */
  folder?: string;
  /** A repository key declared in `repositories`. */
  repository?: string;
  /** Compose file, relative to the folder. */
  compose?: string;
  /** Names of required environment variables. Never values. */
  env?: string[];
  processes?: string[];
}

const ID_RE = /^[a-z][a-z0-9_.-]{0,79}$/;
export const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HOST_FOLDER = /^\/[A-Za-z0-9._/@+-]{0,299}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PROCESS = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,59}$/;
const WHOLE_PROJECT = "project";
/** Built from the legacy platforms.oracle.sshHost when no resource declares that host. */
export const LEGACY_ORACLE_ID = "oracle-vm";

export function declaredResources(m: DataPassProjectManifest | undefined): ResourceDecl[] {
  const list = [...(m?.resources ?? [])];
  const legacy = m?.platforms?.oracle?.sshHost?.trim();
  if (legacy && SSH_ALIAS.test(legacy) && !list.some(r => r.ssh?.host === legacy) && !list.some(r => r.id === LEGACY_ORACLE_ID)) {
    list.push({ id: LEGACY_ORACLE_ID, kind: "vm", title: "Oracle VM", ssh: { host: legacy } });
  }
  return list;
}

const bindingApplies = (b: BindingDecl, scopeId: string) => scopeId === WHOLE_PROJECT || !b.scopes?.length || b.scopes.includes(scopeId);

export interface ResourceView {
  resource: ResourceDecl;
  /** Bindings of this resource that apply to the selected scope. */
  bindings: BindingDecl[];
  /** Other bindings on the same resource: a host-level change affects them too. */
  sharedWith: BindingDecl[];
}

/** Resources relevant to the selected scope; the whole project sees every resource. */
export function resourcesForScope(m: DataPassProjectManifest | undefined, scopeId: string): ResourceView[] {
  const bindings = m?.bindings ?? [];
  return declaredResources(m).flatMap(resource => {
    const own = bindings.filter(b => b.resource === resource.id);
    const applying = own.filter(b => bindingApplies(b, scopeId));
    // A resource with bindings, none of them for this scope, belongs to other scopes.
    if (own.length && !applying.length) return [];
    return [{ resource, bindings: applying, sharedWith: own.filter(b => !applying.includes(b)) }];
  });
}

/** Scope titles a set of bindings serves, for "also affects …" text. */
export function scopeTitles(m: DataPassProjectManifest | undefined, bindings: BindingDecl[]): string[] {
  const title = (id: string) => id === WHOLE_PROJECT ? "whole project" : m?.scopes?.find(s => s.id === id)?.title ?? id;
  return [...new Set(bindings.flatMap(b => b.scopes?.length ? b.scopes.map(title) : ["every scope"]))];
}

/** Remote-SSH target: authority `ssh-remote+<alias>` and an absolute folder ("/" when none). */
export function remoteTarget(resource: ResourceDecl, binding?: BindingDecl): { authority: string; path: string } | undefined {
  const host = resource.ssh?.host;
  if (!host || !SSH_ALIAS.test(host)) return undefined;
  const folder = binding?.folder && HOST_FOLDER.test(binding.folder) && !binding.folder.split("/").includes("..") ? binding.folder : "/";
  return { authority: `ssh-remote+${host}`, path: folder };
}

export function validateResources(doc: Record<string, unknown>, declaredScopes: ReadonlySet<string>, repositoryKeys: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const v2 = doc.schemaVersion === 2 || doc.schemaVersion === 3 || doc.schemaVersion === 4;
  if (!v2) {
    for (const key of ["resources", "bindings"]) if (doc[key] !== undefined) issues.push(`${key} requires schemaVersion 2.`);
    return issues;
  }
  const resourceIds = new Set<string>();
  if (doc.resources !== undefined) {
    if (!Array.isArray(doc.resources) || doc.resources.length > 50) issues.push("resources must be an array of at most 50.");
    else doc.resources.forEach((raw, i) => {
      const r = raw as Record<string, unknown>;
      const at = `resources[${i}]`;
      if (!r || typeof r !== "object" || Array.isArray(r)) { issues.push(`${at} must be an object.`); return; }
      for (const k of Object.keys(r)) if (!["id", "kind", "title", "provider", "ssh"].includes(k)) issues.push(`${at}.${k} is not allowed (never put credentials in the manifest).`);
      if (typeof r.id !== "string" || !ID_RE.test(r.id)) issues.push(`${at}.id is required (lowercase id).`);
      else if (resourceIds.has(r.id)) issues.push(`${at}.id is duplicated.`);
      else resourceIds.add(r.id);
      if (!(RESOURCE_KINDS as readonly string[]).includes(String(r.kind))) issues.push(`${at}.kind must be one of ${RESOURCE_KINDS.join(", ")}.`);
      if (r.title !== undefined && (typeof r.title !== "string" || !r.title.trim() || r.title.length > 120)) issues.push(`${at}.title must be text of at most 120 characters.`);
      if (r.provider !== undefined && (typeof r.provider !== "string" || !/^[A-Za-z0-9 ._-]{1,40}$/.test(r.provider))) issues.push(`${at}.provider must be a short name (e.g. oci, azure).`);
      if (r.ssh !== undefined) {
        const s = r.ssh as Record<string, unknown> | null;
        if (!s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).some(k => k !== "host")) issues.push(`${at}.ssh may only contain host.`);
        else if (typeof s.host !== "string" || !SSH_ALIAS.test(s.host)) issues.push(`${at}.ssh.host must be an alias from your ~/.ssh/config (no user@, port or key).`);
      }
    });
  }
  const bindingIds = new Set<string>();
  if (doc.bindings !== undefined) {
    if (!Array.isArray(doc.bindings) || doc.bindings.length > 200) issues.push("bindings must be an array of at most 200.");
    else doc.bindings.forEach((raw, i) => {
      const b = raw as Record<string, unknown>;
      const at = `bindings[${i}]`;
      if (!b || typeof b !== "object" || Array.isArray(b)) { issues.push(`${at} must be an object.`); return; }
      for (const k of Object.keys(b)) if (!["id", "resource", "scopes", "folder", "repository", "compose", "env", "processes"].includes(k)) issues.push(`${at}.${k} is not allowed (never put credentials or env values in the manifest).`);
      if (typeof b.id !== "string" || !ID_RE.test(b.id)) issues.push(`${at}.id is required (lowercase id).`);
      else if (bindingIds.has(b.id)) issues.push(`${at}.id is duplicated.`);
      else bindingIds.add(b.id);
      if (typeof b.resource !== "string" || !resourceIds.has(b.resource)) issues.push(`${at}.resource must name a declared resource.`);
      if (b.scopes !== undefined) {
        if (!Array.isArray(b.scopes)) issues.push(`${at}.scopes must be an array.`);
        else b.scopes.forEach((s, j) => { if (typeof s !== "string" || (s !== WHOLE_PROJECT && !declaredScopes.has(s))) issues.push(`${at}.scopes[${j}] must name a declared scope or "${WHOLE_PROJECT}".`); });
      }
      if (b.folder !== undefined && (typeof b.folder !== "string" || !HOST_FOLDER.test(b.folder) || b.folder.split("/").includes(".."))) issues.push(`${at}.folder must be an absolute folder on the host, e.g. /opt/app (letters, digits, . _ - / @ +).`);
      if (b.repository !== undefined && (typeof b.repository !== "string" || !repositoryKeys.has(b.repository))) issues.push(`${at}.repository must name a declared repository.`);
      if (b.compose !== undefined && (typeof b.compose !== "string" || !vetRelativePath(b.compose).ok)) issues.push(`${at}.compose must be a relative path.`);
      if (b.env !== undefined) {
        if (!Array.isArray(b.env) || b.env.length > 100) issues.push(`${at}.env must be a list of variable names.`);
        else b.env.forEach((e, j) => {
          if (typeof e !== "string" || !ENV_NAME.test(e)) issues.push(`${at}.env[${j}] must be a variable NAME only${typeof e === "string" && e.includes("=") ? " — values never go in the manifest" : ""}.`);
        });
      }
      if (b.processes !== undefined && (!Array.isArray(b.processes) || b.processes.length > 50 || b.processes.some(p => typeof p !== "string" || !PROCESS.test(p)))) issues.push(`${at}.processes must be a list of short process names.`);
    });
  }
  return issues;
}
