import * as path from "node:path";
import { validateCompanionSections } from "./companions/companions";

export const DATAPASS_MANIFEST_PATH = ".datapass/project.json";

export type RepositoryBinding = {
  /** Local clone, relative to the workspace or absolute. Optional for remote-only repos (v2). */
  path?: string;
  label?: string;
  /** v2: remote identity; a remote-only repository is valid and is never cloned automatically. */
  remote?: { url: string; branch?: string };
  management?: "local" | "remote-only";
};

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
}

export interface DataPassProjectManifest {
  schemaVersion: 1 | 2;
  project: {
    id: string;
    title: string;
    profile?: string;
    description?: string;
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
  if (doc.schemaVersion !== 1 && doc.schemaVersion !== 2) issues.push("schemaVersion must be 1 or 2.");
  const v2 = doc.schemaVersion === 2;
  if (!v2) {
    for (const key of ["scopes", "apps", "domainPacks", "graph"]) {
      if (doc[key] !== undefined) issues.push(`${key} requires schemaVersion 2.`);
    }
  }

  if (!doc.project || typeof doc.project !== "object") {
    issues.push("project is required.");
  } else {
    const project = doc.project as Record<string, unknown>;
    if (typeof project.id !== "string" || !project.id.trim()) issues.push("project.id is required.");
    if (typeof project.title !== "string" || !project.title.trim()) issues.push("project.title is required.");
    if (project.profile !== undefined && typeof project.profile !== "string") issues.push("project.profile must be a string.");
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
        if (!v2) {
          if (!hasPath) issues.push(`repositories.${key}.path is required.`);
          if (repo.remote !== undefined || repo.management !== undefined) issues.push(`repositories.${key}.remote requires schemaVersion 2.`);
        } else {
          if (repo.remote !== undefined) {
            const remote = repo.remote as Record<string, unknown> | null;
            if (!remote || typeof remote !== "object" || typeof remote.url !== "string" || !isRemoteUrl(remote.url)) {
              issues.push(`repositories.${key}.remote.url must be an https:// or git@host:path URL without credentials.`);
            }
            if (remote && remote.branch !== undefined && (typeof remote.branch !== "string" || !/^[A-Za-z0-9._/-]{1,200}$/.test(remote.branch) || remote.branch.includes(".."))) {
              issues.push(`repositories.${key}.remote.branch is not a valid branch name.`);
            }
          }
          if (repo.management !== undefined && repo.management !== "local" && repo.management !== "remote-only") issues.push(`repositories.${key}.management must be local or remote-only.`);
          if (!hasPath && repo.remote === undefined) issues.push(`repositories.${key} needs a path or a remote.`);
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
  const declaredScopes = new Set(v2 && Array.isArray(doc.scopes) ? doc.scopes.map(s => (s as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === "string") : []);
  issues.push(...validateCompanionSections(doc, declaredScopes));

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

export function isRemoteUrl(url: string): boolean {
  if (/^https:\/\/[^\s@/]+\/[^\s]+$/i.test(url)) return true;           // no user:pass@ in https URLs
  return /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(url);
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

/**
 * In-memory v1 -> v2 migration. Pure: returns a new object and never mutates the input,
 * so the original manifest stays recoverable. Writing it is a separate, explicit action.
 */
export function migrateManifestToV2(v1: DataPassProjectManifest): DataPassProjectManifest {
  if (v1.schemaVersion === 2) return structuredClone(v1);
  const next = structuredClone(v1) as DataPassProjectManifest;
  next.schemaVersion = 2;
  for (const repo of Object.values(next.repositories ?? {})) if (repo.path && !repo.management) repo.management = "local";
  if (v1.project.profile === "foil" && !next.domainPacks) next.domainPacks = ["builtin:foil.programme"];
  next.scopes ??= [];
  next.apps ??= [];
  return next;
}

export function genericProjectManifest(folderName = "data-project"): DataPassProjectManifest {
  return {
    schemaVersion: 1,
    project: {
      id: slug(folderName),
      title: folderName
    },
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