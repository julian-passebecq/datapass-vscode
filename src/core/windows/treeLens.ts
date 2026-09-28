/**
 * V3-SHELL (vision §2.1): one tree, on the left. Buttons in the Project view's title bar switch
 * what the tree lists — its "lens". The chosen lens is remembered per workspace; the tree may
 * follow the screen in use for a moment (a sub-project selected in the Workbench) without
 * forgetting the person's choice. Pure (no `vscode`).
 */

export const TREE_LENSES = ["project", "architecture", "git", "ai", "readiness"] as const;
export type TreeLens = typeof TREE_LENSES[number];
export const DEFAULT_LENS: TreeLens = "project";

/** workspaceState key of the chosen lens; context key the menus' `toggled` clauses read. */
export const LENS_STATE_KEY = "datapass.tree.lens";
export const LENS_CONTEXT_KEY = "datapass.tree.lens";

export const LENS_INFO: Readonly<Record<TreeLens, { label: string; icon: string; detail: string }>> = {
  project: { label: "Project", icon: "home", detail: "Everything: next step, sub-projects, repositories, readiness" },
  architecture: { label: "Architecture", icon: "type-hierarchy", detail: "Sub-projects → components → files, options and repositories" },
  git: { label: "Git", icon: "git-merge", detail: "Needs you, repositories, worktrees, pull requests with CI" },
  ai: { label: "AI / Work orders", icon: "sparkle", detail: "Work orders for Claude or Codex, copy for AI, import an answer" },
  readiness: { label: "Readiness", icon: "checklist", detail: "Local environment, tools, connections, checks, problems" }
};

export function parseLens(value: unknown): TreeLens {
  return typeof value === "string" && (TREE_LENSES as readonly string[]).includes(value) ? value as TreeLens : DEFAULT_LENS;
}

/** The part of `vscode.Memento` the store needs (workspaceState in the extension, a map in tests). */
export interface LensMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/**
 * The lens shown now, and the one the person chose. `follow` shows another lens for the screen in
 * use without storing it; the next explicit choice (or `restore`) wins again.
 */
export class LensStore {
  private shown: TreeLens;
  constructor(private readonly memento: LensMemento) {
    this.shown = parseLens(memento.get(LENS_STATE_KEY));
  }

  get current(): TreeLens { return this.shown; }
  get chosen(): TreeLens { return parseLens(this.memento.get(LENS_STATE_KEY)); }

  /** The person picked a lens: shown and remembered for this workspace. Returns whether the tree changes. */
  async choose(lens: TreeLens): Promise<boolean> {
    const changed = lens !== this.shown;
    this.shown = lens;
    if (this.chosen !== lens) await this.memento.update(LENS_STATE_KEY, lens);
    return changed;
  }

  /** Show a lens for the screen in use (not remembered). Returns whether the tree changes. */
  follow(lens: TreeLens): boolean {
    if (lens === this.shown) return false;
    this.shown = lens;
    return true;
  }

  /** Back to the remembered lens. Returns whether the tree changes. */
  restore(): boolean { return this.follow(this.chosen); }
}

/** Where a selection made elsewhere (Workbench, diagram, Details) can be revealed. */
export const LENSES_WITH_ARCHITECTURE: readonly TreeLens[] = ["project", "architecture"];

/**
 * The lens to show when the screen in use changes, or undefined to stay: a sub-project or component
 * selected elsewhere is revealed in the Architecture lens when the current lens does not list it.
 */
export function lensForScreen(current: TreeLens, screen: { selected?: boolean }): TreeLens | undefined {
  if (screen.selected && !LENSES_WITH_ARCHITECTURE.includes(current)) return "architecture";
  return undefined;
}

/**
 * V1.1.x-POLISH-3 (Julian's check of rc.1: "the lenses are hard to find"): the first row of the tree
 * says which lens is shown and switches it on a click. View title buttons only show while the pointer
 * is over the view title (and some overflow into "…"); a tree row is always visible, in any theme.
 */
export const LENS_ROW_ID = "lens";
export const LENS_ROW_COMMAND = "datapass.tree.chooseLens";

export function lensRow(lens: TreeLens): { id: string; label: string; description: string; icon: string; tooltip: string; command: string } {
  const others = TREE_LENSES.filter(l => l !== lens).map(l => LENS_INFO[l].label);
  return {
    id: LENS_ROW_ID,
    label: `Showing: ${LENS_INFO[lens].label} ▾`,
    description: `switch to ${others.join(", ")}`,
    icon: LENS_INFO[lens].icon,
    tooltip: `The tree lists: ${LENS_INFO[lens].label} — ${LENS_INFO[lens].detail}.\nClick to list something else: ${others.join(", ")}, or the natural tree (Explorer).`,
    command: LENS_ROW_COMMAND
  };
}

/**
 * V1.1.x-POLISH-3: the separate Git view repeats the Git lens word for word, so it hides while the
 * Git lens is shown (package.json `when` of `datapass.git`). This is that clause, checked by the tests.
 */
export const GIT_VIEW_WHEN = "!datapass.hidden.view.git && datapass.tree.lens != git";

/** V1.1.x-POLISH-3: the status-bar item that names the lens from any view (Explorer included). */
export function lensStatus(lens: TreeLens): { text: string; tooltip: string } {
  return {
    text: `$(list-tree) DataPass tree: ${LENS_INFO[lens].label}`,
    tooltip: `The DataPass tree (left side bar) lists: ${LENS_INFO[lens].label} — ${LENS_INFO[lens].detail}.\nClick to open the DataPass side bar and choose what it lists.`
  };
}

/** globalState key: the one-time "the DataPass tree is in its own side bar" hint was shown. */
export const TREE_HINT_KEY = "datapass.tree.hintShown";

/**
 * V1.1.x-POLISH-3: show the hint once, only when a DataPass project is open while the DataPass tree
 * is not on screen (for example the Explorer is showing), and never again once shown or dismissed.
 */
export function shouldHintTree(s: { readable: boolean; treeVisible: boolean; shown: boolean }): boolean {
  return s.readable && !s.treeVisible && !s.shown;
}
