/**
 * V4-NAV shared types (go/NAV-contract.md). Every navigation surface imports them from here, never
 * from a local stub: this is the one re-export of the vendored `@juliandatapass-group/view-spi`
 * navigation and catalog contracts (NAVSPI1). Pure (no `vscode`).
 */
export {
  NAV_LEVELS, NAV_HISTORY_LIMIT, ARTIFACT_KINDS, LAYOUT_KINDS, DEFAULT_VIEW_CATALOG,
  sameLocation, initialNavState, reduceNav, resolveViews, validateNavLocation, validateViewCatalog, validateViewOverrides
} from "@juliandatapass-group/view-spi";
export type {
  NavLevel, NavLocation, NavState, NavCommand, NavLadder, NavViews, LayoutKind,
  ViewBinding, ViewDef, ViewCatalog, ViewOverrideEntry, ViewOverrides
} from "@juliandatapass-group/view-spi";
