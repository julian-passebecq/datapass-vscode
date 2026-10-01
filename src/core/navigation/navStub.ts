/**
 * V4-NAV wave 1: a standalone copy of the navigation contract (go/NAV-contract.md) so surface
 * packages build before NAVSPI1/NAVSVC1 merge. Delete it when NAVSVC1 re-exports the vendored
 * view-spi types. Pure (no `vscode`).
 */
export const NAV_LEVELS = ["project", "subproject", "artifact", "step", "operation"] as const; // coarse → fine
export type NavLevel = (typeof NAV_LEVELS)[number];
export interface NavLocation { readonly level: NavLevel; readonly nodeId: string; readonly artifactKind: string }
export interface NavState {
  readonly location: NavLocation; readonly viewId: string | null;
  readonly back: readonly NavLocation[]; readonly forward: readonly NavLocation[];
}
export type NavCommand = { type: "up" } | { type: "down"; childId?: string } | { type: "left" } | { type: "right" }
  | { type: "home" } | { type: "back" } | { type: "forward" } | { type: "go"; location: NavLocation } | { type: "view"; viewId: string };

/** What a surface needs from the NavigationService (NAVSVC1): the state, its changes, and dispatch. */
export interface NavSource {
  readonly state: NavState | null;
  onDidChange(listener: () => void): { dispose(): void };
  dispatch(command: NavCommand): void;
}
