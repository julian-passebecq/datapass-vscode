import * as path from "node:path";
import { validateCompanionSections } from "./companions/companions";
import { validateModules, type ModuleSwitches } from "./modules";
import { validateResources, type BindingDecl, type ResourceDecl } from "./resources/resources";
import { unknownFields } from "./contracts/schemaKeys";
import { vetRelativePath } from "./exchange/pathSafety";
import { validateReadinessSections, type IdentifierDecl, type LocalEnvDecl } from "./readiness/readiness";
import type { ToolchainDecl } from "./toolchain/toolchain";
import type { ConnectionDecl } from "./toolchain/connections";
import { AZURE_HTTPS_WITH_ORG, AZURE_LEGACY_SSH } from "./project/gitHosts";
import manifestSchema from "../../schemas/datapass-project.schema.json";

export const DATAPASS_MANIFEST_PATH = ".datapass/project.json";
/** The newest manifest version this DataPass writes and reads. */
export const LATEST_MANIFEST_VERSION = 5;

export type RepositoryBinding = {
  /** Local clone, relative to the workspace or absolute. Optional for remote-only repos (v2). */
  path?: string;
  label?: string;
  /** v2: remote identity; a remote-only repository is valid and is never cloned automatically. */
  remote?: { url: string; branch?: string };
  management?: "local" | "remote-only";
  /** v3: the repository does not exist yet; operations needing its files stay blocked. */
  planned?: true;
  /** v3: what lives in this repository. */
  description?: string;
};

/** v3: a documentation file (in a repository) or page (https) to open from DataPass. */
export interface DocRef {
  label: string;
  path?: string;
  /** Repository key; omitted = the repository holding the manifest. */
  repoRef?: string;
  url?: string;
}

/** v3: a deployment environment. A review confirmed for one environment never applies to another. */
export interface EnvironmentDecl {
  id: string;
  title?: string;
  production?: boolean;
  description?: string;
}

export interface AppDescriptor {
  id: string;
  label?: string;
  appType: "streamlit" | "react" | "static-site" | "api" | "other";
  repoRef: string;
  entrypoint?: string;
  inputContracts?: string[];
  outputContracts?: string[];
  hosting?: { provider: string; url?: string };
  owner?: string;
}

export interface WorkScope {
  id: string;
  title: string;
  objective?: string;
  itemRefs?: string[];
  capabilityRefs?: string[];
  checklist?: Array<{ id: string; label: string; capabilityRef?: string }>;
  /** v3: default repository of this scope (sub-project) for its components. */
  repoRef?: string;
  /** v3 */
  docs?: DocRef[];
}

export interface DataPassProjectManifest {
  /** Optional URL of the JSON Schema (for editors and AI tools). */
  $schema?: string;
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  project: {
    id: string;
    title: string;
    profile?: string;
    description?: string;
    /** 0.20: dev · work · perso — the defaults of work orders (on/off) and who merges. The machine setting datapass.ai.projectTypes wins. */
    type?: "dev" | "work" | "perso";
  };
  repositories?: Record<string, RepositoryBinding>;
  platforms?: {
    fabric?: {
      workspaceName?: string;
      workspaceId?: string;
      toolboxRoot?: string;
      deployment?: {
        configPath?: string;
        repositoryDirectory?: string;
        targetEnvironment?: string;
      };
    };
    databricks?: {
      bundleRoot?: string;
      defaultTarget?: string;
    };
    grafana?: {
      generatorCommand?: string;
      watchPath?: string;
      /** Grafana stack base URL (https, or http://localhost). Navigation only, never a credential. */
      url?: string;
      /** Dashboards worth opening, optionally limited to scopes; `source` is the dashboard-as-code file. */
      dashboards?: Array<{ uid: string; title: string; scopes?: string[]; source?: string }>;
    };
    infrastructure?: {
      root?: string;
    };
    oracle?: {
      sshHost?: string;
    };
    airflow?: {
      mode?: "local-docker" | "oci-k3s" | "fabric-git-sync" | "fabric-workspace-git" | "managed-other";
      identity?: string;
      gitSyncRepo?: string;
      workspaceGitAlm?: boolean;
    };
    powerbi?: {
      projectRoot?: string;
    };
  };
  /** v2 */
  scopes?: WorkScope[];
  apps?: AppDescriptor[];
  domainPacks?: string[];
  graph?: string;
  links?: Array<{
    label: string;
    url: string;
  }>;
  /** v2: shared resources (declared once) and how each workload/scope uses them. */
  resources?: ResourceDecl[];
  bindings?: BindingDecl[];
  /** Per-project modules: `false` switches a module off; unlisted modules stay on. */
  modules?: ModuleSwitches;
  /** v3: deployment environments named by component operations. */
  environments?: EnvironmentDecl[];
  /** v3: project documentation. */
  docs?: DocRef[];
  /** v4: local env files and the variable NAMES the project needs (values are never declared or read). */
  localEnv?: LocalEnvDecl;
  /** v4: explicitly non-secret ids (account, subscription, workspace ids) the person may copy. Never secrets. v5: one value per environment (the ID map). */
  identifiers?: IdentifierDecl[];
  /** v5: the tools (by id), version ranges and where they run. DataPass compares them with what it probes; it installs nothing. */
  toolchain?: ToolchainDecl;
  /** v5: sign-ins and bindings the project needs; sign-ins are checked read-only on request, bindings are declared. */
  connections?: ConnectionDecl[];
  /** Optional companion apps. Their addresses are user settings; the manifest holds only stable ids. */
  companions?: {
    mongoku?: {
      /** Mongoku entity for the whole project. */
      entityId?: string;
      /** Per-scope entity (scope id or "project" → Mongoku entity id). */
      scopeEntities?: Record<string, string>;
    };
  };
}

export function parseProjectManifest(raw: unknown): DataPassProjectManifest {
  const errors = validateProjectManifest(raw);
  if (errors.length) throw new Error(errors.join(" "));
  return raw as DataPassProjectManifest;
}

export function validateProjectManifest(raw: unknown): string[] {
  const issues: string[] = [];
  if (!raw || typeof raw !== "object") return ["Project manifest must be an object."];
  const doc = raw as Record<string, unknown>;
  if (![1, 2, 3, 4, 5].includes(doc.schemaVersion as number)) issues.push(`schemaVersion must be 1, 2, 3, 4 or 5${typeof doc.schemaVersion === "number" && doc.schemaVersion > LATEST_MANIFEST_VERSION ? ` (this DataPass reads up to ${LATEST_MANIFEST_VERSION}; a newer DataPass may be needed)` : ""}.`);
  const v2 = doc.schemaVersion === 2 || doc.schemaVersion === 3 || doc.schemaVersion === 4 || doc.schemaVersion === 5;
  const v3 = doc.schemaVersion === 3 || doc.schemaVersion === 4 || doc.schemaVersion === 5;
  if (!v2) {
    for (const key of ["scopes", "apps", "domainPacks", "graph"]) {
      if (doc[key] !== undefined) issues.push(`${key} requires schemaVersion 2.`);
    }
  }
  if (!v3) {
    for (const key of ["environments", "docs"]) {
      if (doc[key] !== undefined) issues.push(`${key} requires schemaVersion 3.`);
    }
  }
  // Fields the editor schema does not know are refused here too: accepted-but-ignored JSON is worse than an error.
  for (const field of unknownFields(manifestSchema, raw)) issues.push(`${field} is not a known field of the project manifest.`);
  if (doc.$schema !== undefined && typeof doc.$schema !== "string") issues.push("$schema must be a string.");

  if (!doc.project || typeof doc.project !== "object") {
    issues.push("project is required.");
  } else {
    const project = doc.project as Record<string, unknown>;
    if (typeof project.id !== "string" || !project.id.trim()) issues.push("project.id is required.");
    if (typeof project.title !== "string" || !project.title.trim()) issues.push("project.title is required.");
    if (project.profile !== undefined && typeof project.profile !== "string") issues.push("project.profile must be a string.");
    if (project.type !== undefined && !["dev", "work", "perso"].includes(project.type as string)) issues.push("project.type must be dev, work or perso.");
  }

  if (doc.repositories !== undefined) {
    if (!doc.repositories || typeof doc.repositories !== "object" || Array.isArray(doc.repositories)) {
      issues.push("repositories must be an object.");
    } else {
      for (const [key, value] of Object.entries(doc.repositories as Record<string, unknown>)) {
        if (!value || typeof value !== "object") {
          issues.push(`repositories.${key} must be an object.`);
          continue;
        }
        const repo = value as Record<string, unknown>;
        const hasPath = typeof repo.path === "string" && Boolean(repo.path.trim());
        if (repo.path !== undefined && !hasPath) issues.push(`repositories.${key}.path must be a non-empty string.`);
        if (repo.label !== undefined && typeof repo.label !== "string") issues.push(`repositories.${key}.label must be a string.`);
        if (!v3 && (repo.planned !== undefined || repo.description !== undefined)) issues.push(`repositories.${key}.planned and .description require schemaVersion 3.`);
        if (repo.planned !== undefined && repo.planned !== true) issues.push(`repositories.${key}.planned can only be true.`);
        if (repo.planned === true && hasPath) issues.push(`repositories.${key} is planned (not created yet), so it cannot have a local path.`);
        if (repo.description !== undefined && (typeof repo.description !== "string" || repo.description.length > 500)) issues.push(`repositories.${key}.description must be a string of at most 500 characters.`);
        if (!v2) {
          if (!hasPath) issues.push(`repositories.${key}.path is required.`);
          if (repo.remote !== undefined || repo.management !== undefined) issues.push(`repositories.${key}.remote requires schemaVersion 2.`);
        } else {
          if (repo.remote !== undefined) {
            const remote = repo.remote as Record<string, unknown> | null;
            if (!remote || typeof remote !== "object" || typeof remote.url !== "string" || !isRemoteUrl(remote.url)) {
              issues.push(`repositories.${key}.remote.url must be an https:// or git@host:path URL without credentials (Azure DevOps: https://<organization>@dev.azure.com/<organization>/… is accepted).`);
            }
            if (remote && remote.branch !== undefined && (typeof remote.branch !== "string" || !/^[A-Za-z0-9._/-]{1,200}$/.test(remote.branch) || remote.branch.includes(".."))) {
              issues.push(`repositories.${key}.remote.branch is not a valid branch name.`);
            }
          }
          if (repo.management !== undefined && repo.management !== "local" && repo.management !== "remote-only") issues.push(`repositories.${key}.management must be local or remote-only.`);
          if (!hasPath && repo.remote === undefined && repo.planned !== true) issues.push(`repositories.${key} needs a path or a remote${v3 ? " (or planned: true)" : ""}.`);
          if (repo.management === "remote-only" && repo.remote === undefined) issues.push(`repositories.${key} is remote-only but has no remote.`);
        }
      }
    }
  }

  if (doc.platforms !== undefined && (!doc.platforms || typeof doc.platforms !== "object" || Array.isArray(doc.platforms))) {
    issues.push("platforms must be an object.");
  } else if (doc.platforms && typeof doc.platforms === "object" && !Array.isArray(doc.platforms)) {
    const platforms = doc.platforms as Record<string, unknown>;
    if (platforms.fabric !== undefined) {
      if (!platforms.fabric || typeof platforms.fabric !== "object" || Array.isArray(platforms.fabric)) {
        issues.push("platforms.fabric must be an object.");
      } else {
        const fabric = platforms.fabric as Record<string, unknown>;
        for (const key of ["workspaceName", "workspaceId", "toolboxRoot"]) {
          if (fabric[key] !== undefined && typeof fabric[key] !== "string") {
            issues.push(`platforms.fabric.${key} must be a string.`);
          }
        }
        if (fabric.deployment !== undefined) {
          if (!fabric.deployment || typeof fabric.deployment !== "object" || Array.isArray(fabric.deployment)) {
            issues.push("platforms.fabric.deployment must be an object.");
          } else {
            const deployment = fabric.deployment as Record<string, unknown>;
            for (const key of ["configPath", "repositoryDirectory", "targetEnvironment"]) {
              if (deployment[key] !== undefined && (typeof deployment[key] !== "string" || !String(deployment[key]).trim())) {
                issues.push(`platforms.fabric.deployment.${key} must be a non-empty string.`);
              }
            }
          }
        }
      }
    }
  }

  if (v2) issues.push(...validateV2Sections(doc));
  if (v3) issues.push(...validateV3Sections(doc));
  const declaredScopes = new Set(v2 && Array.isArray(doc.scopes) ? doc.scopes.map(s => (s as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === "string") : []);
  issues.push(...validateCompanionSections(doc, declaredScopes));
  issues.push(...validateModules(doc.modules));
  const repositoryKeys = new Set(doc.repositories && typeof doc.repositories === "object" ? Object.keys(doc.repositories as object) : []);
  issues.push(...validateResources(doc, declaredScopes, repositoryKeys));
  issues.push(...validateReadinessSections(doc, repositoryKeys));

  if (doc.links !== undefined) {
    if (!Array.isArray(doc.links)) {
      issues.push("links must be an array.");
    } else {
      doc.links.forEach((value, index) => {
        if (!value || typeof value !== "object") {
          issues.push(`links[${index}] must be an object.`);
          return;
        }
        const link = value as Record<string, unknown>;
        if (typeof link.label !== "string" || !link.label.trim()) issues.push(`links[${index}].label is required.`);
        if (typeof link.url !== "string" || !/^https:\/\//i.test(link.url)) issues.push(`links[${index}].url must be https://.`);
      });
    }
  }

  return issues;
}

const ID_RE = /^[a-z][a-z0-9_.-]{0,79}$/;

/**
 * https (no user:pass@) or git@host:path. The one user name accepted is Azure DevOps' own: the
 * organization, in the address its Clone button copies (https://{org}@dev.azure.com/{org}/…) and in
 * its legacy SSH address. Kept in step with the remote.url pattern of datapass-project.schema.json.
 */
export function isRemoteUrl(url: string): boolean {
  if (/^https:\/\/[^\s@/]+\/[^\s]+$/i.test(url)) return true;
  if (AZURE_HTTPS_WITH_ORG.test(url)) return true;
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9._%/-]+$/.test(url)) return true;
  return AZURE_LEGACY_SSH.test(url);
}

function validateV2Sections(doc: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const repoKeys = new Set(Object.keys((doc.repositories as Record<string, unknown> | undefined) ?? {}));
  const checkIdList = (value: unknown, where: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(v => typeof v !== "string" || !ID_RE.test(v))) issues.push(`${where} must be a list of ids.`);
  };
  if (doc.scopes !== undefined) {
    if (!Array.isArray(doc.scopes)) issues.push("scopes must be an array.");
    else {
      const seen = new Set<string>();
      doc.scopes.forEach((raw, i) => {
        const s = raw as Record<string, unknown>;
        if (!s || typeof s !== "object" || typeof s.id !== "string" || !ID_RE.test(s.id)) { issues.push(`scopes[${i}].id is required (lowercase id).`); return; }
        if (seen.has(s.id)) issues.push(`scopes[${i}].id is duplicated.`);
        if (s.id === "project") issues.push(`scopes[${i}].id "project" is reserved for the whole-project scope.`);
        seen.add(s.id);
        if (typeof s.title !== "string" || !s.title.trim()) issues.push(`scopes[${i}].title is required.`);
        if (s.objective !== undefined && typeof s.objective !== "string") issues.push(`scopes[${i}].objective must be a string.`);
        checkIdList(s.itemRefs, `scopes[${i}].itemRefs`);
        if (s.capabilityRefs !== undefined && (!Array.isArray(s.capabilityRefs) || s.capabilityRefs.some(c => typeof c !== "string"))) issues.push(`scopes[${i}].capabilityRefs must be strings.`);
        if (doc.schemaVersion !== 3 && doc.schemaVersion !== 4 && doc.schemaVersion !== 5 && (s.repoRef !== undefined || s.docs !== undefined)) issues.push(`scopes[${i}].repoRef and .docs require schemaVersion 3.`);
        if (s.repoRef !== undefined && (typeof s.repoRef !== "string" || !repoKeys.has(s.repoRef))) issues.push(`scopes[${i}].repoRef must name a declared repository.`);
        if (s.docs !== undefined) issues.push(...validateDocs(s.docs, `scopes[${i}].docs`, repoKeys, 20));
        if (s.checklist !== undefined) {
          if (!Array.isArray(s.checklist)) issues.push(`scopes[${i}].checklist must be an array.`);
          else s.checklist.forEach((c, j) => {
            const item = c as Record<string, unknown>;
            if (!item || typeof item.id !== "string" || !ID_RE.test(item.id) || typeof item.label !== "string") issues.push(`scopes[${i}].checklist[${j}] needs id and label.`);
          });
        }
      });
    }
  }
  if (doc.apps !== undefined) {
    if (!Array.isArray(doc.apps)) issues.push("apps must be an array.");
    else doc.apps.forEach((raw, i) => {
      const a = raw as Record<string, unknown>;
      if (!a || typeof a.id !== "string" || !ID_RE.test(a.id)) { issues.push(`apps[${i}].id is required (lowercase id).`); return; }
      if (!["streamlit", "react", "static-site", "api", "other"].includes(String(a.appType))) issues.push(`apps[${i}].appType is invalid.`);
      if (typeof a.repoRef !== "string" || !repoKeys.has(a.repoRef)) issues.push(`apps[${i}].repoRef must name a declared repository.`);
      checkIdList(a.inputContracts, `apps[${i}].inputContracts`);
      checkIdList(a.outputContracts, `apps[${i}].outputContracts`);
      const hosting = a.hosting as Record<string, unknown> | undefined;
      if (hosting !== undefined && (typeof hosting?.provider !== "string" || (hosting.url !== undefined && (typeof hosting.url !== "string" || !/^https:\/\//.test(hosting.url))))) {
        issues.push(`apps[${i}].hosting needs a provider and an https url.`);
      }
    });
  }
  if (doc.domainPacks !== undefined && (!Array.isArray(doc.domainPacks) || doc.domainPacks.some(p => typeof p !== "string" || !/^(builtin:[a-z][a-z0-9.-]+|[^/\\~][^\0]*\.json)$/.test(p) || p.includes("..")))) {
    issues.push("domainPacks must list builtin:<namespace> or workspace-relative .json paths.");
  }
  if (doc.graph !== undefined && (typeof doc.graph !== "string" || doc.graph.includes("..") || /^[/\\~]/.test(doc.graph))) issues.push("graph must be a workspace-relative path.");
  return issues;
}

function validateDocs(value: unknown, where: string, repoKeys: ReadonlySet<string>, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) return [`${where} must be an array of at most ${max} entries.`];
  const issues: string[] = [];
  value.forEach((raw, i) => {
    const d = raw as Record<string, unknown> | null;
    const at = `${where}[${i}]`;
    if (!d || typeof d !== "object" || Array.isArray(d)) { issues.push(`${at} must be an object.`); return; }
    if (typeof d.label !== "string" || !d.label.trim() || d.label.length > 120) issues.push(`${at}.label is required (at most 120 characters).`);
    const hasPath = d.path !== undefined, hasUrl = d.url !== undefined;
    if (hasPath === hasUrl) issues.push(`${at} needs exactly one of path (a file in a repository) or url (https).`);
    if (hasPath && (typeof d.path !== "string" || d.path.length > 400 || !vetRelativePath(d.path).ok)) issues.push(`${at}.path must be a relative path inside the repository.`);
    if (hasUrl && (typeof d.url !== "string" || !/^https:\/\/\S+$/.test(d.url))) issues.push(`${at}.url must be https://.`);
    if (d.repoRef !== undefined) {
      if (hasUrl) issues.push(`${at}.repoRef only applies to a path.`);
      else if (typeof d.repoRef !== "string" || !repoKeys.has(d.repoRef)) issues.push(`${at}.repoRef must name a declared repository.`);
    }
  });
  return issues;
}

function validateV3Sections(doc: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const repoKeys = new Set(Object.keys((doc.repositories as Record<string, unknown> | undefined) ?? {}));
  if (doc.environments !== undefined) {
    if (!Array.isArray(doc.environments) || doc.environments.length > 20) issues.push("environments must be an array of at most 20.");
    else {
      const seen = new Set<string>();
      doc.environments.forEach((raw, i) => {
        const e = raw as Record<string, unknown> | null;
        if (!e || typeof e !== "object" || typeof e.id !== "string" || !ID_RE.test(e.id)) { issues.push(`environments[${i}].id is required (lowercase id, e.g. dev).`); return; }
        if (seen.has(e.id)) issues.push(`environments[${i}].id "${e.id}" is duplicated.`);
        seen.add(e.id);
        if (e.title !== undefined && (typeof e.title !== "string" || !e.title.trim() || e.title.length > 120)) issues.push(`environments[${i}].title must be a non-empty string (at most 120).`);
        if (e.production !== undefined && typeof e.production !== "boolean") issues.push(`environments[${i}].production must be true or false.`);
        if (e.description !== undefined && (typeof e.description !== "string" || e.description.length > 500)) issues.push(`environments[${i}].description must be a string (at most 500).`);
      });
    }
  }
  if (doc.docs !== undefined) issues.push(...validateDocs(doc.docs, "docs", repoKeys, 50));
  return issues;
}

/**
 * In-memory migration to the latest version (v5). Pure: v4 is a superset of v3 (it adds localEnv
 * and identifiers) and v5 a superset of v4 (toolchain, connections, identifier kinds and values per
 * environment; a v4 identifier's single value stays valid), so this only moves the version. Writing
 * it is a separate, explicit, journaled action that keeps a backup copy.
 */
export function migrateManifestToLatest(m: DataPassProjectManifest): DataPassProjectManifest {
  const next = m.schemaVersion < 3 ? migrateManifestToV3(m) : structuredClone(m);
  next.schemaVersion = LATEST_MANIFEST_VERSION;
  return next;
}

/**
 * In-memory v1/v2 -> v3 migration. Pure: v3 is a superset, so this only moves the version (through
 * v2 for a v1 manifest). Writing it is a separate, explicit, journaled action.
 */
export function migrateManifestToV3(m: DataPassProjectManifest): DataPassProjectManifest {
  const next = m.schemaVersion === 1 ? migrateManifestToV2(m) : structuredClone(m);
  next.schemaVersion = 3;
  return next;
}

/**
 * In-memory v1 -> v2 migration. Pure: returns a new object and never mutates the input,
 * so the original manifest stays recoverable. Writing it is a separate, explicit action.
 */
export function migrateManifestToV2(v1: DataPassProjectManifest): DataPassProjectManifest {
  if (v1.schemaVersion !== 1) return structuredClone(v1);
  const next = structuredClone(v1) as DataPassProjectManifest;
  next.schemaVersion = 2;
  for (const repo of Object.values(next.repositories ?? {})) if (repo.path && !repo.management) repo.management = "local";
  if (v1.project.profile === "foil" && !next.domainPacks) next.domainPacks = ["builtin:foil.programme"];
  next.scopes ??= [];
  next.apps ??= [];
  return next;
}

/**
 * Modules of a manifest DataPass creates (0.16). Mongoku is frozen: it reads the project's files
 * (board.json, project.json) from GitHub and has no link with DataPass, so a new project starts
 * with its module off. Existing manifests keep their behaviour (an unlisted module stays on).
 */
export const NEW_MANIFEST_MODULES: ModuleSwitches = { mongoku: false };

export function genericProjectManifest(folderName = "data-project"): DataPassProjectManifest {
  return {
    schemaVersion: 1,
    project: {
      id: slug(folderName),
      title: folderName
    },
    modules: { ...NEW_MANIFEST_MODULES },
    repositories: {},
    platforms: {},
    links: []
  };
}

export function foilProjectManifest(): DataPassProjectManifest {
  return {
    schemaVersion: 1,
    project: {
      id: "foil",
      title: "FOIL",
      profile: "foil",
      description: "Foil'O renewable-energy engineering/data project profile."
    },
    modules: { ...NEW_MANIFEST_MODULES },
    repositories: {
      control: { path: "../foil-control-v1", label: "FOIL control" },
      databricks: { path: "../foil_databrick_dab", label: "FOIL Databricks" }
    },
    platforms: {
      fabric: {},
      databricks: { bundleRoot: "../foil_databrick_dab" },
      grafana: {},
      infrastructure: {},
      oracle: {}
    },
    links: []
  };
}

export function resolveManifestPath(root: string, configuredPath: string): string {
  return path.isAbsolute(configuredPath) ? path.normalize(configuredPath) : path.resolve(root, configuredPath);
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data-project";
}