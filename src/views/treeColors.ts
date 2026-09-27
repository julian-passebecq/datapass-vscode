/**
 * V3-THEME: how many colours the Project tree uses. Pure (no `vscode`).
 *
 * Default: neutral icons (the theme's foreground) so what matters stands out — only items that need attention
 * (an error or a warning) keep their colour. `datapass.tree.coloredIcons: true` restores every colour.
 * `datapass.overlay.enabled: false` hides the DataPass validated / not-validated marks: sub-projects,
 * components and expected files then show a plain icon with no state colour (their text still says the state).
 */
export interface TreeLook { coloredIcons: boolean; overlay: boolean }
export const TREE_LOOK_DEFAULTS: Readonly<TreeLook> = { coloredIcons: false, overlay: true };

/** Theme colours that mean "needs attention": always kept while the overlay is on. */
export const ATTENTION_COLORS: ReadonlySet<string> = new Set(["problemsErrorIcon.foreground", "problemsWarningIcon.foreground", "errorForeground", "editorError.foreground", "editorWarning.foreground"]);

export function readTreeLook(tree: (key: "coloredIcons") => unknown, overlay: (key: "enabled") => unknown): TreeLook {
  const c = tree("coloredIcons"), o = overlay("enabled");
  return { coloredIcons: typeof c === "boolean" ? c : TREE_LOOK_DEFAULTS.coloredIcons, overlay: typeof o === "boolean" ? o : TREE_LOOK_DEFAULTS.overlay };
}

/** The colour a tree icon gets: undefined = the theme's foreground (neutral). */
export function treeIconColor(color: string | undefined, look: TreeLook): string | undefined {
  if (!color) return undefined;
  if (look.coloredIcons) return color;
  return ATTENTION_COLORS.has(color) ? color : undefined;
}

/** Plain icons used for DataPass-state rows when the overlay is off. */
export const PLAIN_STATE_ICONS = { subproject: "symbol-namespace", file: "file" } as const;

/**
 * The icon of a row whose icon IS a DataPass state (a sub-project's health, an expected file's state):
 * with the overlay off it becomes the plain icon, with no colour.
 */
export function stateIcon(icon: [string, string?], plain: string, look: TreeLook): [string, string?] {
  if (!look.overlay) return [plain];
  return [icon[0], treeIconColor(icon[1], look)];
}
