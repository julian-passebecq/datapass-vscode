/**
 * V4-NAV hub: the one place navigation surfaces plug into the NavigationService. Each surface
 * package adds exactly ONE line in `SURFACES` (`registerNavigator`, `registerNavViewHost`…) and
 * owns its own file; nothing else is shared. Activation calls `registerNavigation` once.
 */
import * as vscode from "vscode";
import { NavHost, type NavSession } from "./navHost";
import { registerProjectCards } from "../../views/peda-cards/cards.surface";

/** A surface receives the host (state, dispatch, labels) and returns what to dispose. */
export type NavSurface = (context: vscode.ExtensionContext, host: NavHost) => vscode.Disposable | readonly vscode.Disposable[] | void;

const SURFACES: readonly NavSurface[] = [
  // One line per surface package (merge order: handoff/PLAN.md § V4-NAV).
  registerProjectCards,
];

export function registerNavigation(context: vscode.ExtensionContext, session: NavSession): NavHost {
  const host = new NavHost(session);
  context.subscriptions.push(host, ...host.registerCommands());
  for (const surface of SURFACES) {
    const d = surface(context, host);
    if (d) context.subscriptions.push(...(Array.isArray(d) ? d : [d as vscode.Disposable]));
  }
  return host;
}
