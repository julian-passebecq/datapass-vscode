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
