/**
 * V4-NAV: every navigation surface registers here, one line each (NAVSVC1 owns this file and passes
 * the NavigationService; until it merges, surfaces get no nav source and show their holes).
 */
import type * as vscode from "vscode";
import type { NavSource } from "./navStub";
import { registerContextView } from "../../views/contextView";

export function registerNavigationSurfaces(ctx: vscode.ExtensionContext, nav?: NavSource): void {
  registerContextView(ctx, nav);
}
