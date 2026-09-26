import * as vscode from "vscode";
import { defaultProbeRunner, type ProbeRunner } from "../detection";
import { TOOLS, type ToolObservation } from "./tools";
import { cliVersion } from "../toolchain/versions";
import { mcpServerNames } from "../evidence/registration";

const TTL_MS = 5 * 60_000;
let cache: { at: number; map: Map<string, ToolObservation> } | undefined;

/** Cached, timestamped tool probes. CLI probes are cheap `--version` calls with a timeout. */
export async function probeTools(force = false, runner: ProbeRunner = defaultProbeRunner): Promise<Map<string, ToolObservation>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    // V1-STAB: workspace files are read again every time (local and cheap), so a new .vscode/mcp.json
    // shows on Re-inspect Project without waiting for the CLI probes' TTL.
    const now = new Date().toISOString();
    for (const tool of TOOLS.filter(t => t.kind === "workspace-file")) cache.map.set(tool.id, await probeWorkspaceFile(tool.id, now));
    return cache.map;
  }
  const now = new Date().toISOString();
  const entries = await Promise.all(TOOLS.map(async (tool): Promise<ToolObservation> => {
    switch (tool.kind) {
      case "extension": {
        for (const id of tool.extensionIds ?? []) {
          const ext = vscode.extensions.getExtension(id);
          if (ext) return { toolId: tool.id, state: "present", via: id, version: String(ext.packageJSON?.version ?? ""), observedAt: now };
        }
        return { toolId: tool.id, state: "absent", observedAt: now };
      }
      case "cli": {
        const cli = tool.cli!;
        const command = process.platform === "win32" && cli.windowsCommand ? cli.windowsCommand : cli.command;
        const r = await runner(command, cli.args, 2000);
        return { toolId: tool.id, state: r.ok ? "present" : "absent", via: command, version: r.ok ? cliVersion(r.output) : undefined, observedAt: now };
      }
      case "workspace-file":
        return probeWorkspaceFile(tool.id, now);
      case "desktop-app":
        return { toolId: tool.id, state: "unknown", observedAt: now };
    }
  }));
  cache = { at: Date.now(), map: new Map(entries.map(e => [e.toolId, e])) };
  return cache.map;
}

async function probeWorkspaceFile(toolId: string, now: string): Promise<ToolObservation> {
  const found = await vscode.workspace.findFiles(".vscode/mcp.json", undefined, 1);
  if (!found.length) return { toolId, state: "absent", observedAt: now };
  // D-22: the server names only, for the evidence chain's "registered" link.
  let entries: string[] | undefined;
  try { entries = mcpServerNames(new TextDecoder().decode(await vscode.workspace.fs.readFile(found[0]!))); } catch { entries = undefined; }
  return { toolId, state: "present", via: ".vscode/mcp.json", observedAt: now, ...(entries ? { entries } : {}) };
}

export function invalidateToolProbes(): void {
  cache = undefined;
}
