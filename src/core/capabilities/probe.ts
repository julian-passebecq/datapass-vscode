import * as vscode from "vscode";
import { promises as fsp } from "node:fs";
import { defaultProbeRunner, type ProbeRunner } from "../detection";
import { TOOLS, type ToolDefinition, type ToolObservation } from "./tools";
import { cliVersion } from "../toolchain/versions";
import { mcpServerNames } from "../evidence/registration";
import { runBounded } from "../project/observation";

const TTL_MS = 5 * 60_000;
/** V1-REF: CLI probes running at once (each starts a process; the rest wait their turn). */
export const PROBE_CONCURRENCY = 6;
/** V5HOLE3: one cache entry per CLI tool, so a view needing one tool never starts the others. */
const cliCache = new Map<string, { at: number; obs: ToolObservation }>();
/** Probes in progress, per tool: a second request waits for it instead of starting the CLI again. */
const inflight = new Map<string, Promise<ToolObservation>>();

/** The ids of the tools probed by starting a process (`--version`-style, core/spawnAllowList.ts TOOL_PROBES). */
export const CLI_TOOL_IDS: ReadonlySet<string> = new Set(TOOLS.filter(t => t.kind === "cli").map(t => t.id));

/**
 * Timestamped tool probes. Extensions and workspace files are read every time (no process). V5HOLE3:
 * a CLI tool is probed only when its id is in `cliIds` (a view or a command that needs it asked for
 * it), never by default; the result is cached for five minutes unless `force`.
 */
export async function probeTools(force = false, cliIds: ReadonlySet<string> = new Set(), runner: ProbeRunner = defaultProbeRunner): Promise<Map<string, ToolObservation>> {
  const now = new Date().toISOString();
  const wanted = TOOLS.filter(t => t.kind !== "cli" || cliIds.has(t.id));
  const entries = await runBounded(wanted, PROBE_CONCURRENCY, async (tool): Promise<ToolObservation> => {
    switch (tool.kind) {
      case "extension": {
        for (const id of tool.extensionIds ?? []) {
          const ext = vscode.extensions.getExtension(id);
          if (ext) return { toolId: tool.id, state: "present", via: id, version: String(ext.packageJSON?.version ?? ""), observedAt: now };
        }
        return { toolId: tool.id, state: "absent", observedAt: now };
      }
      case "cli": return probeCli(tool, force, runner);
      case "workspace-file":
        return probeWorkspaceFile(tool.id, now);
      case "desktop-app":
        return { toolId: tool.id, state: "unknown", observedAt: now };
    }
  });
  return new Map(entries.map(e => [e.toolId, e]));
}

function probeCli(tool: ToolDefinition, force: boolean, runner: ProbeRunner): Promise<ToolObservation> {
  const hit = cliCache.get(tool.id);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.obs);
  const running = inflight.get(tool.id);
  if (running) return running;
  const run = (async (): Promise<ToolObservation> => {
    const cli = tool.cli!;
    const command = process.platform === "win32" && cli.windowsCommand ? cli.windowsCommand : cli.command;
    const r = await runner(command, cli.args, 2000);
    const obs: ToolObservation = { toolId: tool.id, state: r.ok ? "present" : "absent", via: command, version: r.ok ? cliVersion(r.output) : undefined, observedAt: new Date().toISOString() };
    cliCache.set(tool.id, { at: Date.now(), obs });
    return obs;
  })().finally(() => { if (inflight.get(tool.id) === run) inflight.delete(tool.id); });
  inflight.set(tool.id, run);
  return run;
}

async function probeWorkspaceFile(toolId: string, now: string): Promise<ToolObservation> {
  // The literal pattern names one file per workspace folder. Prove the common absence case
  // without launching a workspace-wide search (one search process per root on Windows).
  // Existing files and uncertain reads still use findFiles, preserving its exclusions/selection.
  const absent = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(async folder => {
    const uri = vscode.Uri.joinPath(folder.uri, ".vscode", "mcp.json");
    try {
      if (uri.scheme === "file") await fsp.stat(uri.fsPath);
      else await vscode.workspace.fs.stat(uri);
      return false;
    } catch (error) {
      const code = (error as { code?: string }).code;
      return code === "ENOENT" || code === "ENOTDIR" || code === "FileNotFound";
    }
  }));
  if (absent.every(Boolean)) return { toolId, state: "absent", observedAt: now };
  const found = await vscode.workspace.findFiles(".vscode/mcp.json", undefined, 1);
  if (!found.length) return { toolId, state: "absent", observedAt: now };
  // D-22: the server names only, for the evidence chain's "registered" link.
  let entries: string[] | undefined;
  try { entries = mcpServerNames(new TextDecoder().decode(await vscode.workspace.fs.readFile(found[0]!))); } catch { entries = undefined; }
  return { toolId, state: "present", via: ".vscode/mcp.json", observedAt: now, ...(entries ? { entries } : {}) };
}

export function invalidateToolProbes(): void {
  cliCache.clear();
}
