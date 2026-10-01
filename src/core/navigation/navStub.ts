/**
 * V4-NAV wave-1 stub of the shared contract (go/NAV-contract.md). Standalone; delete it when NAVSVC1
 * re-exports the vendored view-spi navigation types, and point the importers there.
 */
export const NAV_LEVELS = ["project", "subproject", "artifact", "step", "operation"] as const;
export type NavLevel = (typeof NAV_LEVELS)[number];
export interface NavLocation { readonly level: NavLevel; readonly nodeId: string; readonly artifactKind: string }
export type NavCommand = { type: "up" } | { type: "down"; childId?: string } | { type: "left" } | { type: "right" }
  | { type: "home" } | { type: "back" } | { type: "forward" } | { type: "go"; location: NavLocation } | { type: "view"; viewId: string };
