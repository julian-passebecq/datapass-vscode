import * as vscode from "vscode";
import { defaultProbeRunner, type ProbeRunner } from "../detection";
import { TOOLS, type ToolObservation } from "./tools";
import { cliVersion } from "../toolchain/versions";

const TTL_MS = 5 * 60_000;
let cache: { at: number; map: Map<string, ToolObservation> } | undefined;

/** Cached, timestamped tool probes. CLI probes are cheap `--version` calls with a timeout. */
export async function probeTools(force = false, runner: ProbeRunner = defaultProbeRunner): Promise<Map<string, ToolObservation>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.map;
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
      case "workspace-file": {
        const found = await vscode.workspace.findFiles(".vscode/mcp.json", undefined, 1);
        return { toolId: tool.id, state: found.length ? "present" : "absent", observedAt: now };
      }
      case "desktop-app":
        return { toolId: tool.id, state: "unknown", observedAt: now };
    }
  }));
  cache = { at: Date.now(), map: new Map(entries.map(e => [e.toolId, e])) };
  return cache.map;
}

export function invalidateToolProbes(): void {
  cache = undefined;
}
