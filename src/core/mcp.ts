import * as path from "node:path";

/**
 * `.vscode/mcp.json` (VS Code's workspace MCP registration file). 0.26 M1: DataPass edits it
 * losslessly. Every top-level key (`inputs`, …) and every unrelated server stays exactly as written;
 * only the one entry DataPass adds or replaces changes. A different host dialect (`mcpServers`) or
 * a file DataPass cannot preserve (comments, trailing commas) is refused, never read as empty.
 */

/** A local server started by VS Code (`type` omitted or "stdio"). Extra native keys are kept. */
export interface McpStdioServer {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string | number | null>;
  envFile?: string;
  cwd?: string;
  [key: string]: unknown;
}

/** A remote server VS Code connects to (`type` "http" or "sse", or a `url` without `type`). */
export interface McpRemoteServer {
  type?: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export type McpServerDefinition = McpStdioServer | McpRemoteServer;

/** The whole document: `servers` plus every other top-level key, untouched. */
export interface McpConfig {
  servers: Record<string, McpServerDefinition>;
  [key: string]: unknown;
}

export interface FabricMcpDefinition {
  serverName: string;
  server: McpStdioServer;
  executablePath: string;
  workingRoot: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function mcpServerKind(server: McpServerDefinition): "stdio" | "remote" {
  return server.type === "http" || server.type === "sse" || (server.type === undefined && typeof server.url === "string" && server.command === undefined)
    ? "remote" : "stdio";
}

function checkServer(name: string, raw: unknown): void {
  if (!isObject(raw)) throw new Error(`MCP server "${name}" must be an object.`);
  const type = raw.type;
  if (type !== undefined && type !== "stdio" && type !== "http" && type !== "sse") {
    throw new Error(`MCP server "${name}" has type "${String(type)}", which DataPass does not know. Nothing was changed.`);
  }
  if (type === "http" || type === "sse" || (type === undefined && raw.command === undefined && raw.url !== undefined)) {
    if (typeof raw.url !== "string" || !raw.url.trim()) throw new Error(`MCP server "${name}" (remote) must define url.`);
    if (raw.headers !== undefined && (!isObject(raw.headers) || Object.values(raw.headers).some(h => typeof h !== "string"))) {
      throw new Error(`MCP server "${name}" headers must be an object of strings.`);
    }
    return;
  }
  if (typeof raw.command !== "string" || !raw.command.trim()) throw new Error(`MCP server "${name}" must define command (or url for a remote server).`);
  if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some(arg => typeof arg !== "string"))) {
    throw new Error(`MCP server "${name}" args must be a string array.`);
  }
  if (raw.env !== undefined && !isObject(raw.env)) throw new Error(`MCP server "${name}" env must be an object.`);
  for (const key of ["cwd", "envFile"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") throw new Error(`MCP server "${name}" ${key} must be a string.`);
  }
}

/**
 * Validate a parsed `.vscode/mcp.json` and return a deep copy of the whole document (unknown keys
 * included). Throws on a different dialect or an invalid entry: the caller must then write nothing.
 */
export function parseMcpConfig(raw: unknown): McpConfig {
  if (!isObject(raw)) throw new Error("MCP configuration must be a JSON object.");
  if (raw.mcpServers !== undefined) {
    throw new Error("This file uses the top-level \"mcpServers\" format of another MCP host, not VS Code's \"servers\". DataPass does not convert it. Nothing was changed.");
  }
  if (raw.servers !== undefined && !isObject(raw.servers)) throw new Error("MCP configuration servers must be an object.");
  for (const [name, server] of Object.entries((raw.servers ?? {}) as Record<string, unknown>)) checkServer(name, server);
  const doc = clone(raw);
  return { ...doc, servers: (doc.servers ?? {}) as Record<string, McpServerDefinition> };
}

/** Add or replace one server; everything else (other servers, their fields, top-level keys) is kept. */
export function mergeMcpServer(existing: McpConfig, name: string, server: McpServerDefinition): McpConfig {
  if (!name.trim()) throw new Error("MCP server name is required.");
  checkServer(name, server);
  const doc = clone(existing);
  return { ...doc, servers: { ...doc.servers, [name]: clone(server) } };
}

export interface McpFileEdit {
  /** The full new file text. */
  text: string;
  /** The server already existed (the caller asks before replacing it). */
  replaces: boolean;
  /** The existing entry of that name, if any. */
  previous?: McpServerDefinition;
}

/**
 * Plan the edit of `.vscode/mcp.json` from its current text (undefined: no file yet). The text is
 * parsed as strict JSON; a file with comments or trailing commas is refused rather than rewritten,
 * because they could not be kept. The indentation of the existing file is reused.
 */
export function planMcpFileEdit(current: string | undefined, name: string, server: McpServerDefinition): McpFileEdit {
  let config: McpConfig = { servers: {} };
  let indent: string | number = 2;
  if (current !== undefined && current.trim()) {
    let raw: unknown;
    try {
      raw = JSON.parse(current.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error(".vscode/mcp.json is not plain JSON (comments or trailing commas?). DataPass cannot keep them, so it changed nothing: add the server with \"MCP: Add Server…\" or edit the file yourself.");
    }
    config = parseMcpConfig(raw);
    indent = /\n([ \t]+)"/.exec(current)?.[1] ?? 2;
  }
  const previous = config.servers[name];
  const next = mergeMcpServer(config, name, server);
  const eol = current?.includes("\r\n") ? "\r\n" : "\n";
  const bom = current?.startsWith("﻿") ? "﻿" : "";
  return { text: bom + JSON.stringify(next, null, indent).replace(/\n/g, eol) + eol, replaces: previous !== undefined, previous };
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
