/**
 * Pilot stage 1 commands (AI-4a): show the Pilot tab, switch pilot mode on (machine setting, never
 * a workspace), and Run it / Not now on a request. Arguments are untrusted and re-checked by the
 * service against the order list and the request files.
 */
import * as vscode from "vscode";
import { guarded } from "./io";
import type { PilotService } from "./pilot";

export function registerPilotCommands(context: vscode.ExtensionContext, pilot: PilotService, showTab: () => Promise<void>): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.pilot.show", async () => { await pilot.reload(); await showTab(); });
  reg("datapass.pilot.enable", async () => { await vscode.commands.executeCommand("workbench.action.openSettings", "datapass.pilot.enabled"); });
  reg("datapass.pilot.run", async (orderId?: unknown, n?: unknown) => pilot.run(orderId, n));
  reg("datapass.pilot.decline", async (orderId?: unknown, n?: unknown) => pilot.decline(orderId, n));
}
