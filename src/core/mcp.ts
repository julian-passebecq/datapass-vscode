import * as path from "node:path";

export interface McpServerDefinition {
  command: string;
  args?: string[];
}

export interface McpConfig {
  servers: Record<string, McpServerDefinition>;
}

export interface FabricMcpDefinition {
  serverName: string;
  server: McpServerDefinition;
  executablePath: string;
  workingRoot: string;
}

export function parseMcpConfig(raw: unknown): McpConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("MCP configuration must be a JSON object.");
  }
  const doc = raw as Record<string, unknown>;
  if (doc.servers === undefined) return { servers: {} };
  if (!doc.servers || typeof doc.servers !== "object" || Array.isArray(doc.servers)) {
    throw new Error("MCP configuration servers must be an object.");
  }

  const servers: Record<string, McpServerDefinition> = {};
  for (const [name, rawServer] of Object.entries(doc.servers as Record<string, unknown>)) {
    if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) {
      throw new Error(`MCP server "${name}" must be an object.`);
    }
    const server = rawServer as Record<string, unknown>;
    if (typeof server.command !== "string" || !server.command.trim()) {
      throw new Error(`MCP server "${name}" must define command.`);
    }
    if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(arg => typeof arg !== "string"))) {
      throw new Error(`MCP server "${name}" args must be a string array.`);
    }
    servers[name] = {
      command: server.command,
      args: server.args as string[] | undefined
    };
  }
  return { servers };
}

export function mergeMcpServer(
  existing: McpConfig,
  name: string,
  server: McpServerDefinition
): McpConfig {
  if (!name.trim()) throw new Error("MCP server name is required.");
  return {
    servers: {
      ...existing.servers,
      [name]: {
        command: server.command,
        args: server.args ? [...server.args] : undefined
      }
    }
  };
}

export function fabricToolboxMcpDefinition(
  itemId: string,
  toolboxRoot: string,
  platform: NodeJS.Platform = process.platform
): FabricMcpDefinition {
  const root = path.resolve(toolboxRoot);
  const python = platform === "win32"
    ? path.join(".venv", "Scripts", "python.exe")
    : path.join(".venv", "bin", "python");

  if (itemId === "semantic-model-mcp") {
    const workingRoot = path.join(root, "tools", "SemanticModelMCPServer");
    const executablePath = path.join(workingRoot, python);
    return {
      serverName: "semantic_model_mcp_server",
      executablePath,
      workingRoot,
      server: {
        command: executablePath,
        args: [path.join(workingRoot, "server.py")]
      }
    };
  }

  if (itemId === "fabric-management-mcp") {
    const workingRoot = path.join(root, "tools", "MicrosoftFabricMgmtMCPServer");
    const executablePath = path.join(workingRoot, python);
    return {
      serverName: "fabric-mgmt",
      executablePath,
      workingRoot,
      server: {
        command: executablePath,
        args: [path.join(workingRoot, "server.py")]
      }
    };
  }

  if (itemId === "dax-performance-mcp") {
    if (platform !== "win32") {
      throw new Error("DAX Performance Tuner MCP requires Windows according to its upstream setup.");
    }
    const workingRoot = path.join(root, "tools", "DAXPerformanceTunerMCPServer");
    const executablePath = path.join(
      workingRoot,
      "src",
      "DaxPerformanceTuner.Console",
      "bin",
      "Release",
      "net8.0-windows",
      "win-x64",
      "publish",
      "dax-performance-tuner.exe"
    );
    return {
      serverName: "dax-performance-tuner",
      executablePath,
      workingRoot,
      server: {
        command: executablePath,
        args: ["--start"]
      }
    };
  }

  throw new Error(`No MCP integration is registered for ${itemId}.`);
}
