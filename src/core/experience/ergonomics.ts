/**
 * V1.1.x-POLISH-4 (Julian's check of 1.1.0-rc.1): the ergonomics he could not find. Pure (no `vscode`).
 *
 * - The DataPass activity-bar icon: a command brings the DataPass side bar back, and says how to keep
 *   its icon (right-click the Activity Bar, tick DataPass). VS Code gives extensions no way to pin it.
 * - Code zoom one click away: A− / A+ / reset step VS Code's own `editor.fontSize` (the setting
 *   "DataPass: Set Code Font Size…" writes), from the status bar, the Home page, and keys that VS Code
 *   leaves free (Alt+= / Alt+-; Ctrl+= / Ctrl+- stay VS Code's whole-window zoom, and Alt+0 is VS Code's
 *   "last editor in group", so reset has no key).
 * - "Appearance…": one quick pick for the colour theme, the DataPass overlay, its colours, the tree
 *   icon colours, the diagram style and the code size.
 * - "Home": the Home page, the DataPass tree and the right rail as the project saved them.
 */
import { CODE_FONT_MAX, CODE_FONT_MIN } from "./codeFont";

// ------------------------------------------------------------------ activity bar

/** The DataPass side bar (activity-bar view container) and the command VS Code generates to open it. */
export const ACTIVITY_CONTAINER = "datapass";
export const SHOW_CONTAINER_COMMAND = `workbench.view.extension.${ACTIVITY_CONTAINER}`;
export const ACTIVITY_BAR_HINT = "To keep the DataPass icon in the Activity Bar: right-click the Activity Bar (the column of icons on the far left) and tick DataPass.";

/**
 * Whether VS Code hides the whole Activity Bar: `workbench.activityBar.location: "hidden"` (VS Code 1.88+)
 * or the older `workbench.activityBar.visible: false`.
 */
export function activityBarHidden(location: unknown, visible: unknown): boolean {
  return location === "hidden" || visible === false;
}

// ------------------------------------------------------------------ code zoom

export const CODE_FONT_DEFAULT = 14;
export type ZoomStep = "smaller" | "bigger" | "reset";
export const ZOOM_COMMANDS: Readonly<Record<ZoomStep, string>> = {
  smaller: "datapass.codeFont.smaller", bigger: "datapass.codeFont.bigger", reset: "datapass.codeFont.reset"
};
/** Keys VS Code leaves free on Windows, macOS and Linux (checked against its default keybindings in the desktop tests). */
export const ZOOM_KEYS: Readonly<Partial<Record<ZoomStep, string>>> = { smaller: "alt+-", bigger: "alt+=" };
/** How the keys read in labels and tooltips. */
export const ZOOM_KEY_LABELS = { smaller: "Alt+-", bigger: "Alt+=" } as const;

/** The next size for a step: whole pixels, kept between 6 and 40; `undefined` for reset (remove the value). */
export function zoomedFontSize(current: unknown, step: ZoomStep): number | undefined {
  if (step === "reset") return undefined;
  const now = typeof current === "number" && Number.isFinite(current) ? current : CODE_FONT_DEFAULT;
  const next = step === "bigger" ? Math.floor(now) + 1 : Math.ceil(now) - 1;
  return Math.min(CODE_FONT_MAX, Math.max(CODE_FONT_MIN, next));
}

/** Status-bar texts of the three zoom items (the middle one names the size and opens Appearance). */
export function zoomStatus(size: unknown): { smaller: string; size: string; bigger: string; tooltip: string } {
  const s = typeof size === "number" && Number.isFinite(size) ? size : CODE_FONT_DEFAULT;
  return {
    smaller: "$(zoom-out)",
    size: `$(text-size) ${s}`,
    bigger: "$(zoom-in)",
    tooltip: `Code text: ${s} px (VS Code's editor.fontSize). A− ${ZOOM_KEY_LABELS.smaller} · A+ ${ZOOM_KEY_LABELS.bigger} · reset: click the size. Ctrl+= / Ctrl+- zoom the whole window instead.`
  };
}

// ------------------------------------------------------------------ appearance

export const APPEARANCE_IDS = [
  "theme.pick", "theme.toggle", "overlay.toggle", "overlay.colors", "tree.colors", "diagram.theme",
  "font.smaller", "font.bigger", "font.reset", "font.pick", "activityBar"
] as const;
export type AppearanceId = typeof APPEARANCE_IDS[number];
export const isAppearanceId = (v: unknown): v is AppearanceId => typeof v === "string" && (APPEARANCE_IDS as readonly string[]).includes(v);

export interface AppearanceInput {
  themeName?: string;
  /** VS Code has "Toggle between Light/Dark Themes" (1.82+). */
  canToggleTheme: boolean;
  overlay: boolean;
  coloredIcons: boolean;
  diagramTheme: string;
  fontSize?: number;
}
export interface AppearanceItem { id?: AppearanceId; label: string; description?: string; detail?: string; separator?: boolean }

/** The "Appearance…" quick pick, in order (separators have no id). */
export function appearanceItems(s: AppearanceInput): AppearanceItem[] {
  const size = typeof s.fontSize === "number" ? s.fontSize : CODE_FONT_DEFAULT;
  return [
    { label: "Colours", separator: true },
    { id: "theme.pick", label: "$(color-mode) Colour theme…", description: s.themeName, detail: "VS Code's theme picker: light, dark or high contrast" },
    ...(s.canToggleTheme ? [{ id: "theme.toggle" as const, label: "$(color-mode) Switch light ⇄ dark", detail: "VS Code's own toggle between your preferred light and dark themes" }] : []),
    { id: "overlay.toggle", label: s.overlay ? "$(eye-closed) Hide the DataPass overlay" : "$(eye) Show the DataPass overlay", description: s.overlay ? "on" : "off", detail: "The validated / not validated marks on the diagram and in the tree (datapass.overlay.enabled)" },
    { id: "overlay.colors", label: "$(symbol-color) Overlay colours…", detail: "Your own #rrggbb for each overlay state (datapass.overlay.colors, in Settings)" },
    { id: "tree.colors", label: s.coloredIcons ? "$(circle-large-outline) Neutral tree icons" : "$(circle-large-filled) Coloured tree icons", description: s.coloredIcons ? "coloured now" : "neutral now", detail: "Colour every tree icon by its state, or only what needs attention (datapass.tree.coloredIcons)" },
    { id: "diagram.theme", label: `$(symbol-misc) Diagram style: ${s.diagramTheme === "vscode" ? "use Microsoft surfaces" : "follow the VS Code theme"}`, description: s.diagramTheme === "vscode" ? "VS Code now" : "Microsoft now", detail: "datapass.diagram.theme" },
    { label: "Code text", separator: true },
    { id: "font.smaller", label: "$(zoom-out) Smaller code (A−)", description: ZOOM_KEY_LABELS.smaller },
    { id: "font.bigger", label: "$(zoom-in) Larger code (A+)", description: ZOOM_KEY_LABELS.bigger },
    { id: "font.reset", label: "$(discard) Reset the code size", detail: "Removes this workspace's editor.fontSize" },
    { id: "font.pick", label: "$(text-size) Code font size…", description: `now ${size} px` },
    { label: "DataPass", separator: true },
    { id: "activityBar", label: "$(layout-activitybar-left) Show DataPass in the Activity Bar", detail: "Opens the DataPass side bar and says how to keep its icon" }
  ];
}

/**
 * Where to write a DataPass setting the person switches: where it is set now (workspace folder,
 * workspace, else the user settings), so the switch is not hidden by a more specific value.
 */
export function settingScope(inspect: { workspaceFolderValue?: unknown; workspaceValue?: unknown } | undefined): "folder" | "workspace" | "user" {
  if (inspect?.workspaceFolderValue !== undefined) return "folder";
  if (inspect?.workspaceValue !== undefined) return "workspace";
  return "user";
}

// ------------------------------------------------------------------ Home: restore the project layout

export const HOME_RESTORE_COMMAND = "datapass.home.restore";
/** A saved layout with this name is the project's Home layout ("Save as my Home layout" on the Home page). */
export const HOME_LAYOUT_NAME = "Home";

export interface LayoutCandidates {
  /** The saved layouts of this project (id and name). */
  views: ReadonlyArray<{ id: string; name: string }>;
  /** The layout the workspace file opens with (`datapass.startupView`), if any. */
  startup?: string;
  /** The layout applied (or saved) last in this window for this project, if any. */
  lastApplied?: string;
}

/**
 * The layout "Home" restores: the one named Home, else the one the workspace opens with, else the last
 * one applied in this window, else none (the Home page, the tree and the rail only).
 */
export function projectLayout(c: LayoutCandidates): { id: string; why: "home" | "startup" | "last" } | undefined {
  const byName = (n: string) => c.views.find(v => v.id === n) ?? c.views.find(v => v.name.toLowerCase() === n.trim().toLowerCase());
  const home = c.views.find(v => v.name.toLowerCase() === HOME_LAYOUT_NAME.toLowerCase());
  if (home) return { id: home.id, why: "home" };
  const startup = c.startup ? byName(c.startup) : undefined;
  if (startup) return { id: startup.id, why: "startup" };
  const last = c.lastApplied ? c.views.find(v => v.id === c.lastApplied) : undefined;
  if (last) return { id: last.id, why: "last" };
  return undefined;
}

/** The status-bar item of the Home button. */
export const HOME_STATUS = {
  text: "$(home) Home",
  tooltip: "DataPass Home: the Home page, the DataPass tree and the right rail as this project saved them (a layout named \"Home\", else the one the workspace opens with). Also brings the DataPass side bar back."
} as const;
