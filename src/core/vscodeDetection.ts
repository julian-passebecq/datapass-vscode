import * as vscode from "vscode";
import type { ToolProbe } from "./types";

export function detectExtension(id: string, label: string): ToolProbe {
  const ext = vscode.extensions.getExtension(id);
  return {
    id,
    label,
    available: Boolean(ext),
    version: typeof ext?.packageJSON?.version === "string" ? ext.packageJSON.version : undefined,
    detail: ext ? (ext.isActive ? "Active" : "Installed") : "Not installed"
  };
}

/** First installed ID wins; later IDs are verified aliases (web/desktop variants, legacy IDs). */
export function detectAnyExtension(ids: string[], label: string, opts: { optional?: boolean; note?: string } = {}): ToolProbe {
  for (const id of ids) {
    const ext = vscode.extensions.getExtension(id);
    if (ext) {
      return {
        id: ids[0]!, label, available: true, optional: opts.optional,
        version: typeof ext.packageJSON?.version === "string" ? ext.packageJSON.version : undefined,
        detail: `${ext.isActive ? "Active" : "Installed"}${id !== ids[0] ? ` (as ${id})` : ""}${opts.note ? ` · ${opts.note}` : ""}`
      };
    }
  }
  return { id: ids[0]!, label, available: false, optional: opts.optional, detail: `Not installed${opts.note ? ` · ${opts.note}` : ""}` };
}

export async function commandAvailable(command: string): Promise<boolean> {
  const commands = new Set(await vscode.commands.getCommands(true));
  return commands.has(command);
}

export async function anyWorkspaceFile(globs: string[]): Promise<boolean> {
  for (const glob of globs) {
    const found = await vscode.workspace.findFiles(glob, "**/{node_modules,.git,dist,out}/**", 1);
    if (found.length > 0) return true;
  }
  return false;
}
