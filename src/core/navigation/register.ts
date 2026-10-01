/**
 * V4-NAV hub: the one place navigation surfaces plug into the NavigationService. Each surface
 * package owns one `*.surface.ts` file under src/ whose default export is a `NavSurface`; the build
 * collects them into out/gen/surfaces.ts (scripts/gen-registry.mjs, NAVWIRE1), so no package edits
 * this file. Activation calls `registerNavigation` once.
 */
import * as vscode from "vscode";
import { SURFACES } from "../../../out/gen/surfaces";
import { NavHost, type NavSession } from "./navHost";

/** A surface receives the host (state, dispatch, labels) and returns what to dispose. */
export type NavSurface = (context: vscode.ExtensionContext, host: NavHost) => vscode.Disposable | readonly vscode.Disposable[] | void;

export function registerNavigation(context: vscode.ExtensionContext, session: NavSession): NavHost {
  const host = new NavHost(session);
  context.subscriptions.push(host, ...host.registerCommands());
  for (const surface of SURFACES) {
    const d = surface(context, host);
    if (d) context.subscriptions.push(...(Array.isArray(d) ? d : [d as vscode.Disposable]));
  }
  return host;
}
