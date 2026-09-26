import * as path from "node:path";

export interface FabricDeploymentConfigInput {
  workspaceName?: string;
  workspaceId?: string;
  repositoryDirectory: string;
}

export function renderSafeFabricDeploymentConfig(input: FabricDeploymentConfigInput): string {
  const workspaceName = clean(input.workspaceName, "Fabric workspace name", false);
  const workspaceId = clean(input.workspaceId, "Fabric workspace ID", false);
  const repositoryDirectory = clean(input.repositoryDirectory, "Fabric repository directory", true);

  if (!workspaceName && !workspaceId) {
    throw new Error("Fabric deployment requires workspaceName or workspaceId.");
  }
  if (workspaceId && !isGuid(workspaceId)) {
    throw new Error("Fabric workspaceId must be a GUID.");
  }

  const lines = [
    "core:",
    workspaceId
      ? `  workspace_id: ${yamlString(workspaceId)}`
      : `  workspace: ${yamlString(workspaceName!)}`,
    `  repository_directory: ${yamlString(toPortablePath(repositoryDirectory!))}`,
    "",
    "publish:",
    "  skip: false",
    "",
    "# Safety baseline: do not remove orphaned workspace items automatically.",
    "unpublish:",
    "  skip: true",
    ""
  ];
  return lines.join("\n");
}

export function repositoryPathRelativeToConfig(configPath: string, repositoryPath: string): string {
  const relative = path.relative(path.dirname(path.resolve(configPath)), path.resolve(repositoryPath)) || ".";
  return toPortablePath(relative);
}

function clean(value: string | undefined, label: string, required: boolean): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    if (required) throw new Error(`${label} is required.`);
    return undefined;
  }
  if (/\r|\n|\0/.test(trimmed)) throw new Error(`${label} contains unsupported control characters.`);
  return trimmed;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
