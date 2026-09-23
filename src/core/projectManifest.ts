import * as path from "node:path";
import * as vscode from "vscode";

export const DATAPASS_MANIFEST_PATH = ".datapass/project.json";

export interface DataPassProjectManifest {
  schemaVersion: 1;
  project: {
    id: string;
    title: string;
    profile?: string;
    description?: string;
  };
  repositories?: Record<string, {
    path: string;
    label?: string;
  }>;
  platforms?: {
    fabric?: {
      workspaceName?: string;
      workspaceId?: string;
      toolboxRoot?: string;
    };
    databricks?: {
      bundleRoot?: string;
      defaultTarget?: string;
    };
    grafana?: {
      generatorCommand?: string;
      watchPath?: string;
    };
    infrastructure?: {
      root?: string;
    };
    oracle?: {
      sshHost?: string;
    };
  };
  links?: Array<{
    label: string;
    url: string;
  }>;
}

export interface ManifestReadResult {
  exists: boolean;
  uri?: vscode.Uri;
  manifest?: DataPassProjectManifest;
  errors: string[];
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
  if (doc.schemaVersion !== 1) issues.push("schemaVersion must be 1.");

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
        if (typeof repo.path !== "string" || !repo.path.trim()) issues.push(`repositories.${key}.path is required.`);
        if (repo.label !== undefined && typeof repo.label !== "string") issues.push(`repositories.${key}.label must be a string.`);
      }
    }
  }

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

export async function readProjectManifest(): Promise<ManifestReadResult> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return { exists: false, errors: [] };
  const uri = vscode.Uri.joinPath(root, ".datapass", "project.json");

  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    return { exists: false, uri, errors: [] };
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const errors = validateProjectManifest(raw);
    return errors.length
      ? { exists: true, uri, errors }
      : { exists: true, uri, manifest: raw as DataPassProjectManifest, errors: [] };
  } catch (error) {
    return {
      exists: true,
      uri,
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

export async function writeProjectManifest(manifest: DataPassProjectManifest): Promise<vscode.Uri> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) throw new Error("Open a workspace folder before creating a DataPass project manifest.");
  const dir = vscode.Uri.joinPath(root, ".datapass");
  const uri = vscode.Uri.joinPath(dir, "project.json");
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n"));
  return uri;
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
