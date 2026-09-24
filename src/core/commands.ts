import * as path from "node:path";

/**
 * Quote one argument for the shell a copied command is pasted into. On Windows that is
 * PowerShell (VS Code's default Windows terminal): single quotes are literal there, so `$`
 * and backticks in names cannot expand, where cmd-style double quotes would interpolate.
 */
export function quoteShellArg(value: string, platform: NodeJS.Platform = process.platform): string {
  if (/\r|\n|\0/.test(value)) throw new Error("Command argument contains unsupported control characters.");
  if (platform === "win32") return quotePowerShellArg(value);
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Leave plain tokens bare (readable in every shell) and quote anything else. */
export function shellWord(value: string, platform: NodeJS.Platform = process.platform): string {
  const bare = platform === "win32" ? /^-?[A-Za-z0-9_][A-Za-z0-9_./\\:-]*$/ : /^-?[A-Za-z0-9_][A-Za-z0-9_./:-]*$/;
  return bare.test(value) ? value : quoteShellArg(value, platform);
}

/**
 * Run a tool inside a directory. POSIX shells get `cd … && …`. Windows gets a form that works
 * in Windows PowerShell 5.1 (which has no `&&`) and PowerShell 7, and that stops when the
 * directory is missing instead of running the tool somewhere else.
 */
export function inDirectory(directory: string, command: string, platform: NodeJS.Platform = process.platform): string {
  const dir = (platform === "win32" ? path.win32 : path.posix).resolve(directory);
  if (platform === "win32") return `Set-Location -LiteralPath ${quotePowerShellArg(dir)}; if ($?) { ${command} }`;
  return `cd ${quoteShellArg(dir, platform)} && ${command}`;
}

export function buildDatabricksBundleCommand(
  operation: "validate" | "deploy" | "run",
  projectRoot: string,
  target?: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (operation === "run") {
    if (!target?.trim()) throw new Error("A Databricks bundle run target is required.");
    return inDirectory(projectRoot, `databricks bundle run ${shellWord(target.trim(), platform)}`, platform);
  }
  return inDirectory(projectRoot, `databricks bundle ${operation}`, platform);
}

export function buildGrafanaPreviewCommand(
  generatorCommand: string,
  watchPath?: string,
  platform: NodeJS.Platform = process.platform
): string {
  const generator = generatorCommand.trim();
  if (!generator) throw new Error("Configure datapass.grafana.generatorCommand first.");
  if (/\r|\n|\0/.test(generator)) throw new Error("Generator command contains unsupported control characters.");
  const watch = watchPath?.trim();
  return [
    "gcx dev serve",
    "--script",
    quoteShellArg(generator, platform),
    watch ? `--watch ${quoteShellArg(watch, platform)}` : ""
  ].filter(Boolean).join(" ");
}

export function buildIaCCommand(
  tool: "tofu" | "terraform",
  operation: "validate" | "plan",
  root: string,
  platform: NodeJS.Platform = process.platform
): string {
  return inDirectory(root, `${tool} ${operation}`, platform);
}
export function quotePowerShellArg(value: string): string {
  if (/\r|\n|\0/.test(value)) throw new Error("PowerShell argument contains unsupported control characters.");
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildFabricSecurityAuditCommand(scriptPath: string, url: string, user?: string): string {
  const cleanUrl = url.trim();
  if (!/^https:\/\//i.test(cleanUrl)) {
    throw new Error("Fabric Security Audit requires a full https:// Fabric or Power BI URL.");
  }
  const parts = [
    "&",
    quotePowerShellArg(scriptPath),
    "-Url",
    quotePowerShellArg(cleanUrl),
    "-NoPrompt"
  ];
  const cleanUser = user?.trim();
  if (cleanUser) parts.push("-User", quotePowerShellArg(cleanUser));
  return parts.join(" ");
}

export interface FabricAssessmentInput {
  source: "synapse" | "databricks";
  workspace?: string;
  output: string;
  cloud?: "azure" | "aws";
}

export function buildFabricAssessmentCommand(
  input: FabricAssessmentInput,
  platform: NodeJS.Platform = process.platform
): string {
  if (input.source !== "synapse" && input.source !== "databricks") {
    throw new Error("Assessment source must be synapse or databricks.");
  }
  const output = sanitizeCommandValue(input.output, "Assessment output");
  const workspace = input.workspace?.trim();
  if (workspace) sanitizeCommandValue(workspace, "Assessment workspace");

  const parts = [
    "fat",
    "assess",
    "--source",
    input.source,
    "--mode",
    "full",
    "-o",
    quoteShellArg(output, platform)
  ];

  if (input.source === "databricks" && input.cloud) {
    parts.push("--cloud", input.cloud);
  }
  if (workspace) {
    parts.push("--ws", quoteShellArg(workspace, platform));
  }
  return parts.join(" ");
}

function sanitizeCommandValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (/\r|\n|\0/.test(trimmed)) throw new Error(`${label} contains unsupported control characters.`);
  return trimmed;
}

export type FabricCliOperation =
  | "auth-status"
  | "login"
  | "list-workspaces"
  | "get-workspace"
  | "list-workspace-items";

export function fabricCliArgs(
  operation: FabricCliOperation,
  workspaceName?: string
): string[] {
  switch (operation) {
    case "auth-status":
      return ["auth", "status"];
    case "login":
      return ["auth", "login"];
    case "list-workspaces":
      return ["ls"];
    case "get-workspace": {
      const workspace = sanitizeCommandValue(workspaceName || "", "Fabric workspace");
      const target = /\.workspace$/i.test(workspace) ? workspace : `${workspace}.Workspace`;
      return ["get", target];
    }
    case "list-workspace-items": {
      const workspace = sanitizeCommandValue(workspaceName || "", "Fabric workspace");
      const target = /\.workspace$/i.test(workspace) ? workspace : `${workspace}.Workspace`;
      return ["ls", target, "-l"];
    }
  }
}

export function buildFabricCliCommand(
  operation: FabricCliOperation,
  workspaceName?: string,
  platform: NodeJS.Platform = process.platform
): string {
  return ["fab", ...fabricCliArgs(operation, workspaceName).map(arg => shellWord(arg, platform))].join(" ");
}

export function buildFabricDeployCommand(
  configPath: string,
  targetEnvironment?: string,
  platform: NodeJS.Platform = process.platform
): string {
  const config = sanitizeCommandValue(configPath, "Fabric deployment config");
  const parts = ["fab", "deploy", "--config", quoteShellArg(config, platform)];
  const target = targetEnvironment?.trim();
  if (target) {
    sanitizeCommandValue(target, "Fabric target environment");
    parts.push("--target_env", quoteShellArg(target, platform));
  }
  return parts.join(" ");
}
