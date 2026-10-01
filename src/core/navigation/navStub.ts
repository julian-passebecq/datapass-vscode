/**
 * V4-NAV contract stub (go/NAV-contract.md): the view-spi navigation types, copied here so wave-1 packages
 * can code before NAVSPI1 is vendored. Delete when NAVSVC1 re-exports the vendored types.
 */
export const NAV_LEVELS = ["project", "subproject", "artifact", "step", "operation"] as const;
export type NavLevel = (typeof NAV_LEVELS)[number];
export interface NavLocation { readonly level: NavLevel; readonly nodeId: string; readonly artifactKind: string }
export interface NavState { readonly location: NavLocation; readonly viewId: string | null;
  readonly back: readonly NavLocation[]; readonly forward: readonly NavLocation[] }
export type NavCommand = { type: "up" } | { type: "down"; childId?: string } | { type: "left" } | { type: "right" }
  | { type: "home" } | { type: "back" } | { type: "forward" } | { type: "go"; location: NavLocation } | { type: "view"; viewId: string };
export const LAYOUT_KINDS = ["graph", "table", "detail-card", "metrics", "diff-history", "code-steps", "context-text", "surface", "erd"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];
export interface ViewDef { readonly id: string; readonly title: string; readonly layout: LayoutKind;
  readonly bindings: readonly { readonly source: string; readonly params?: Readonly<Record<string, unknown>> }[];
  readonly metrics?: readonly string[]; readonly preset?: string; readonly surface?: string; readonly description?: string }
