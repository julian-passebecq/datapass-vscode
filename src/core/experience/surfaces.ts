/**
 * 0.22 modes (package B): the stable list of surfaces a presentation preset shows or hides.
 * Pure (no `vscode`). Ids are a contract: presets.json, the `datapass.experience.overrides`
 * setting and the context keys `datapass.hidden.<id>` use them. Add, never rename.
 *
 * Presets only change presentation (D-03): safety blockers, commands in the palette and the
 * files of a project are the same in every mode.
 */

export type SurfaceKind = "view" | "aiTab" | "projectSection" | "workbenchView" | "statusBar" | "landing" | "badge";

export interface Surface {
  id: string;
  kind: SurfaceKind;
  label: string;
  /** For views: the contributed view id in package.json. */
  viewId?: string;
  detail: string;
}

export const SURFACES: readonly Surface[] = [
  { id: "view.project", kind: "view", viewId: "datapass.project", label: "Project tree", detail: "Sub-projects, components, repositories and readiness (left side bar)" },
  { id: "view.git", kind: "view", viewId: "datapass.git", label: "Git view", detail: "Repositories, worktrees, pull requests with CI, Needs you" },
  { id: "view.work", kind: "view", viewId: "datapass.work", label: "Work view", detail: "Module cards and capability operations (V2)" },
  { id: "view.galaxy", kind: "view", viewId: "datapass.galaxy", label: "Galaxy view", detail: "Platform cards and qualification (V1)" },
  { id: "view.architecture", kind: "view", viewId: "datapass.architecture", label: "Architecture panel", detail: "The project diagram (bottom panel)" },
  { id: "view.aiExchange", kind: "view", viewId: "datapass.aiExchange", label: "AI view", detail: "Copy a DataPass file for your AI, paste its answer (secondary side bar)" },
  { id: "view.details", kind: "view", viewId: "datapass.details", label: "Details", detail: "The selected component or sub-project (secondary side bar)" },
  { id: "ai.agent", kind: "aiTab", label: "AI view: Agent tab", detail: "Work orders for Claude Code or Codex (still opt-in per machine and project type)" },
  { id: "ai.manual", kind: "aiTab", label: "AI view: Manual tab", detail: "Where things stand and the route to each official tool" },
  { id: "project.subprojects", kind: "projectSection", label: "Project tree: sub-projects and components", detail: "The architecture as a tree" },
  { id: "project.repositories", kind: "projectSection", label: "Project tree: Repositories", detail: "Cloned, not cloned, planned; commits to get" },
  { id: "project.options", kind: "projectSection", label: "Project tree: Architecture options", detail: "Decisions and scenarios from options.json" },
  { id: "project.sheet", kind: "projectSection", label: "Project tree: Project sheet", detail: "Datasets, formulas, runtimes" },
  { id: "project.board", kind: "projectSection", label: "Project tree: Board", detail: "Tasks, bugs and sprints from board.json" },
  { id: "project.readiness", kind: "projectSection", label: "Project tree: Readiness and local environment", detail: "Full sections (blockers show in every mode)" },
  { id: "project.problems", kind: "projectSection", label: "Project tree: Problems in project files", detail: "What DataPass found wrong in .datapass files" },
  { id: "workbench.options", kind: "workbenchView", label: "Workbench: Options", detail: "Compare scenarios, preview, record a decision" },
  { id: "workbench.sheet", kind: "workbenchView", label: "Workbench: Project sheet", detail: "The project sheet as tables" },
  { id: "workbench.board", kind: "workbenchView", label: "Workbench: Board", detail: "Kanban and sprints" },
  { id: "workbench.workOrders", kind: "workbenchView", label: "Workbench: Work orders", detail: "Orders handed to Claude Code or Codex" },
  { id: "status.mode", kind: "statusBar", label: "Status bar: DataPass mode", detail: "Shows the mode; click to switch" },
  { id: "status.health", kind: "statusBar", label: "Status bar: tool health", detail: "Tools and bindings ready (opens the Galaxy view)" },
  { id: "landing.architecture", kind: "landing", label: "Open on the architecture", detail: "Focus the Architecture panel when a project opens (a workspace's startup view wins)" },
  { id: "badge.alternatives", kind: "badge", label: "\"Alternatives exist\" on components", detail: "Marks components an options.json decision can change" },
  // 0.23 (package G): variants.
  { id: "project.variantFilter", kind: "projectSection", label: "Project tree: selected architecture and All variants", detail: "The tree follows the previewed scenario; a toggle lists every option's components and files" },
  { id: "badge.codingState", kind: "badge", label: "Coding state of options and scenarios", detail: "coded / partly coded / not coded, derived from the files DataPass finds" },
  // 0.23: the toolkit catalogue.
  { id: "workbench.toolkit", kind: "workbenchView", label: "Workbench: Toolkit", detail: "Tools with their free tier and prices, recipes, what needs a newer DataPass" },
  { id: "project.toolkit", kind: "projectSection", label: "Project tree: Toolkit", detail: "Hub toolkit files read, entries skipped, Needs a newer DataPass" },
  { id: "badge.hubChanged", kind: "badge", label: "\"Changed by the hub\" on catalogue entries", detail: "Marks built-in tools a hub toolkit file changed" },
  // 0.24 (pass AI-3): the Claude & Codex panel.
  { id: "view.agentPanel", kind: "view", viewId: "datapass.agentPanel", label: "Claude & Codex panel", detail: "Quick links, Claude Control status, plan usage, this project's conversations and your to-dos (secondary side bar)" }
];

export const SURFACE_IDS: readonly string[] = SURFACES.map(s => s.id);

export const PRESET_IDS = ["vanilla", "standard", "datapass", "advanced"] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export const DEFAULT_PRESET: PresetId = "standard";

/** Context key set to true while a surface is hidden (views and menus use `!datapass.hidden.<id>`). */
export const hiddenKey = (id: string) => `datapass.hidden.${id}`;
