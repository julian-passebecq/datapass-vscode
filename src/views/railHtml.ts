/**
 * V3-SHELL (vision §2.1): the thin right rail — a vertical column of buttons shown in the DataPass
 * secondary side bar instead of the full panel (AI, Claude & Codex, Details) while rail mode is on.
 * V1.1.x-POLISH-3: the rail is a native tree (see core/windows/railFold.ts for why); each button is a
 * codicon, a label and an existing command. Pure (no `vscode`). The file keeps its name for history.
 */

export interface RailButton {
  id: string;
  glyph: string;
  /** Codicon of the tree row. */
  icon: string;
  label: string;
  title: string;
}

export const RAIL_BUTTONS: readonly RailButton[] = [
  { id: "expand", glyph: "⇤", icon: "layout-sidebar-right", label: "Expand", title: "Expand the full DataPass panel (AI, Claude & Codex, Details)" },
  { id: "details", glyph: "ⓘ", icon: "info", label: "Details", title: "The selected component or sub-project (this view alone)" },
  { id: "ai", glyph: "✦", icon: "sparkle", label: "AI", title: "The AI view: guided exchange, work orders, manual routes (this view alone)" },
  { id: "git", glyph: "⑂", icon: "git-merge", label: "Git", title: "The Git lens of the left tree: Needs you, repositories, pull requests" },
  { id: "airflow", glyph: "⋔", icon: "type-hierarchy-sub", label: "DAG", title: "The Airflow DAG view alone: the DAG in the editor, else the project's DAG files (read, never run)" },
  { id: "copyForAi", glyph: "⇪", icon: "export", label: "Export", title: "Copy a DataPass file with its context for your AI" },
  { id: "importFromAi", glyph: "⇩", icon: "desktop-download", label: "Import", title: "Paste your AI's answer (reviewed before anything is written)" },
  { id: "workViews", glyph: "▤", icon: "list-flat", label: "Views", title: "Work views: saved layouts, sub-projects and other projects" },
  { id: "ownWindow", glyph: "⧉", icon: "multiple-windows", label: "Window", title: "Open the Workbench in its own window (a second screen)" }
];

export const RAIL_BUTTON_IDS: readonly string[] = RAIL_BUTTONS.map(b => b.id);

/**
 * V3-POLISH-2: the buttons a rail offers. The DAG button follows the Airflow DAG view: hidden when the
 * mode hides that surface (the view's own `!datapass.hidden.view.airflowDag`) or the project switches
 * the Airflow module off. Every other button is always shown.
 */
export function railButtonsShown(o: { shows: (surface: string) => boolean; airflowModule: boolean }): string[] {
  return RAIL_BUTTON_IDS.filter(id => id !== "airflow" || (o.airflowModule && o.shows("view.airflowDag")));
}

/** The existing command (and arguments) each rail button runs. */
export function railButtonCommand(id: string): { command: string; args: unknown[] } {
  switch (id) {
    case "details": return { command: "datapass.rail.expand", args: ["datapass.details", true] };
    case "ai": return { command: "datapass.rail.expand", args: ["datapass.aiExchange", true] };
    case "airflow": return { command: "datapass.rail.expand", args: ["datapass.airflowDag", true] };
    case "git": return { command: "datapass.tree.lens.git", args: [] };
    case "copyForAi": return { command: "datapass.copyForAi", args: [] };
    case "importFromAi": return { command: "datapass.importFromAi", args: [] };
    case "workViews": return { command: "datapass.openSwitcher", args: [] };
    case "ownWindow": return { command: "datapass.openWorkbenchFloating", args: [] };
    default: return { command: "datapass.rail.expand", args: [] };
  }
}
