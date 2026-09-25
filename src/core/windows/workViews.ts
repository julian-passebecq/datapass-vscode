/**
 * Work views (0.17): named saved layouts of one VS Code window, kept machine-local in
 * `.datapass/local/views.json` (git-ignored, never shared). A view holds only what DataPass can
 * restore through public VS Code APIs:
 *
 *   - the selected sub-project and component;
 *   - the editor grid of the main window (`vscode.getEditorLayout` / `vscode.setEditorLayout`,
 *     sizes as fractions) and the files of each group, as repository-relative paths;
 *   - the Workbench tab: in a group of that grid, or in a floating window of its own;
 *   - which DataPass views were visible (Project, Work, Galaxy, Architecture, Details);
 *   - the diagram settings of the Workbench tab and of the Architecture panel (orientation, lanes,
 *     folded lanes, zoom) and the previewed architecture.
 *
 * Pure (no `vscode`): parsing, validation, normalisation, descriptions. Everything read from the
 * file is untrusted data: paths are vetted, ids and names are bounded, nothing becomes a command.
 */
import { arr, BOOL, constOf, enumOf, obj, TIME, validateSchema, type Schema } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { ID_PATTERN, slugId } from "../model/ids";
import { vetRelativePath } from "../exchange/pathSafety";
import { GROUP_BY, type GroupBy } from "../project/diagramModel";
import type { Direction } from "../project/layout";

/** File name under `.datapass/local`. */
export const WORK_VIEWS_FILE = "views.json";
export const WORK_VIEWS_FORMAT = "datapass.work-views";
/** A launcher (Power Ops) asks a window to apply a view by writing this file under `.datapass/local`. */
export const OPEN_VIEW_REQUEST_FILE = "open-view.json";
export const OPEN_VIEW_FORMAT = "datapass.open-view";
/** A request older than this is ignored (the launcher wrote it for a window that never opened). */
export const OPEN_VIEW_MAX_AGE_MS = 120_000;

export const MAX_VIEWS = 40;
export const MAX_GROUPS = 9;
export const MAX_TABS = 30;
const MAX_BYTES = 256 * 1024;

export const PANES = ["project", "work", "galaxy", "architecture", "aiExchange", "details"] as const;
export type Pane = typeof PANES[number];
/** The contributed view behind each pane (VS Code generates `<id>.focus` for each). */
export const PANE_VIEW_IDS: Readonly<Record<Pane, string>> = {
  project: "datapass.project", work: "datapass.work", galaxy: "datapass.galaxy", architecture: "datapass.architecture", aiExchange: "datapass.aiExchange", details: "datapass.details"
};
/** Panes that live in the secondary side bar (its container "datapass-details" holds both). */
export const SECONDARY_PANES: readonly Pane[] = ["aiExchange", "details"];

export const WORKBENCH_VIEWS = ["architecture", "options", "sheet", "board"] as const;
export type WorkbenchView = typeof WORKBENCH_VIEWS[number];

/** Diagram settings of one webview mode ("full" = Workbench tab, "map" = Architecture panel). */
export interface DiagramUi {
  /** Workbench tab only: which of its three views is shown. */
  view?: WorkbenchView;
  dir: Direction;
  groupBy: GroupBy;
  /** Folded lanes ("lane:<id>") and parents ("parent:<id>"). */
  folded: string[];
  zoom: "fit" | "100";
}
export type DiagramMode = "full" | "map";

/** `vscode.setEditorLayout` format; sizes are fractions of the parent (VS Code treats them as weights). */
export interface EditorLayout { orientation: 0 | 1; groups: LayoutGroup[] }
export interface LayoutGroup { size?: number; groups?: LayoutGroup[] }

/** A file in a repository of the project (`repo` is a manifest key, "." the coordination repository). */
export interface RepoTab { repo: string; path: string }
/** A file in a workspace folder that is not one of the project's repositories. */
export interface FolderTab { folder: string; path: string }
export interface WorkbenchTab { workbench: true }
export type ViewTab = RepoTab | FolderTab | WorkbenchTab;
export interface ViewGroup { tabs: ViewTab[]; active?: number }

export interface WorkView {
  id: string;
  name: string;
  savedAt: string;
  selection?: { subproject?: string; component?: string };
  editors?: { layout: EditorLayout; groups: ViewGroup[]; activeGroup?: number };
  /** The Workbench tab in a floating window of its own (a second screen). */
  floatingWorkbench?: boolean;
  /** DataPass views that were visible. */
  panes?: Pane[];
  diagram?: { full?: DiagramUi; map?: DiagramUi };
  /** The architecture previewed on the diagram (a scenario of options.json, or decision=option picks). */
  preview?: { scenario?: string; picks?: string[] };
}

export interface WorkViewsFile { format: typeof WORK_VIEWS_FORMAT; version: "1"; note?: string; views: WorkView[] }

// ------------------------------------------------------------------ schema

const NAME: Schema = { type: "string", minLength: 1, maxLength: 80 };
const VIEW_ID: Schema = { type: "string", pattern: ID_PATTERN.source };
const REPO_KEY: Schema = { type: "string", pattern: "^(\\.|[a-z][a-z0-9_.-]{0,79})$" };
const FOLDER_NAME: Schema = { type: "string", minLength: 1, maxLength: 200, pattern: "^[^/\\\\\\x00-\\x1f]+$" };
const REL: Schema = { type: "string", minLength: 1, maxLength: 400 };
const SIZE: Schema = { type: "number", minimum: 0, maximum: 1 };
const INDEX: Schema = { type: "integer", minimum: 0, maximum: 99 };
const FOLD: Schema = { type: "string", pattern: "^(lane|parent):[^\\s]{1,200}$" };
const PICK: Schema = { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,79}=[a-z][a-z0-9_.-]{0,79}$" };

const level3: Schema = obj({ size: SIZE }, []);
const level2: Schema = obj({ size: SIZE, groups: arr(level3, MAX_GROUPS, 1) }, []);
const level1: Schema = obj({ size: SIZE, groups: arr(level2, MAX_GROUPS, 1) }, []);
const LAYOUT: Schema = obj({ orientation: { enum: [0, 1] }, groups: arr(level1, MAX_GROUPS, 1) });

const DIAGRAM_UI: Schema = obj({
  view: enumOf(...WORKBENCH_VIEWS),
  dir: enumOf("LR", "TB"),
  groupBy: enumOf(...GROUP_BY),
  folded: arr(FOLD, 100),
  zoom: enumOf("fit", "100")
}, ["dir", "groupBy", "folded", "zoom"]);

const TAB: Schema = { anyOf: [obj({ repo: REPO_KEY, path: REL }), obj({ folder: FOLDER_NAME, path: REL }), obj({ workbench: constOf(true) })] };

const VIEW: Schema = obj({
  id: VIEW_ID, name: NAME, savedAt: TIME,
  selection: obj({ subproject: VIEW_ID, component: VIEW_ID }, []),
  editors: obj({ layout: LAYOUT, groups: arr(obj({ tabs: arr(TAB, MAX_TABS), active: INDEX }, ["tabs"]), MAX_GROUPS, 1), activeGroup: INDEX }, ["layout", "groups"]),
  floatingWorkbench: BOOL,
  panes: arr(enumOf(...PANES), PANES.length),
  diagram: obj({ full: DIAGRAM_UI, map: DIAGRAM_UI }, []),
  preview: obj({ scenario: VIEW_ID, picks: arr(PICK, 50) }, [])
}, ["id", "name", "savedAt"]);

export const WORK_VIEWS_SCHEMA: Schema = obj({
  format: constOf(WORK_VIEWS_FORMAT),
  version: constOf("1"),
  note: { type: "string", maxLength: 400 },
  views: arr(VIEW, MAX_VIEWS)
}, ["format", "version", "views"]);

// ------------------------------------------------------------------ parse / serialize

export function emptyWorkViews(): WorkViewsFile {
  return { format: WORK_VIEWS_FORMAT, version: "1", views: [] };
}

/** Parse `.datapass/local/views.json`; throws with a readable message when it is not valid. */
export function parseWorkViews(raw: string | Uint8Array): WorkViewsFile {
  const doc = parseStrictJson(raw, { maxBytes: MAX_BYTES, maxDepth: 12 });
  const issues = validateSchema(WORK_VIEWS_SCHEMA, doc);
  if (issues.length) throw new Error(`Invalid ${WORK_VIEWS_FILE}: ${issues.slice(0, 4).map(i => `${i.path} ${i.message}`).join("; ")}`);
  const file = doc as WorkViewsFile;
  const ids = new Set<string>();
  for (const v of file.views) {
    if (ids.has(v.id)) throw new Error(`Invalid ${WORK_VIEWS_FILE}: two views have the id "${v.id}"`);
    ids.add(v.id);
    const problem = viewProblem(v);
    if (problem) throw new Error(`Invalid ${WORK_VIEWS_FILE}: view "${v.name}": ${problem}`);
  }
  return file;
}

/** Checks the schema cannot express: vetted paths, one group per layout leaf, indexes in range. */
export function viewProblem(v: WorkView): string | undefined {
  const e = v.editors;
  if (e) {
    if (leafCount(e.layout) !== e.groups.length) return `the grid has ${leafCount(e.layout)} group(s) but ${e.groups.length} are described`;
    if (e.activeGroup !== undefined && e.activeGroup >= e.groups.length) return "the active group does not exist";
    for (const g of e.groups) {
      if (g.active !== undefined && g.active >= g.tabs.length) return "an active tab does not exist";
      if (g.tabs.filter(t => "workbench" in t).length > 1) return "the Workbench appears twice in a group";
      for (const t of g.tabs) {
        if ("workbench" in t) continue;
        const vet = vetRelativePath(t.path);
        if (!vet.ok) return `${t.path}: ${vet.reason}`;
        if (vet.relative !== t.path) return `${t.path}: write it as ${vet.relative}`;
      }
    }
    if (e.groups.flatMap(g => g.tabs).filter(t => "workbench" in t).length > 1) return "the Workbench appears in two groups";
    if (v.floatingWorkbench && e.groups.some(g => g.tabs.some(t => "workbench" in t))) return "the Workbench cannot be both floating and in a group";
  }
  if (v.preview?.scenario && v.preview.picks?.length) return "a preview is a scenario or picks, not both";
  if (v.panes && new Set(v.panes).size !== v.panes.length) return "a pane is listed twice";
  return undefined;
}

export function serializeWorkViews(file: WorkViewsFile): Uint8Array {
  const out: WorkViewsFile = { format: WORK_VIEWS_FORMAT, version: "1", note: "Machine-local work views (saved window layouts). Never committed.", views: file.views };
  return new TextEncoder().encode(JSON.stringify(out, null, 2) + "\n");
}

// ------------------------------------------------------------------ helpers

export function leafCount(layout: EditorLayout | LayoutGroup): number {
  const groups = layout.groups;
  if (!groups?.length) return 1;
  return groups.reduce((n, g) => n + leafCount(g), 0);
}

/**
 * The layout VS Code reports (sizes in pixels, any depth) as a savable layout: sizes become
 * fractions of their parent (3 decimals), depth is capped at 3 and the grid at MAX_GROUPS leaves.
 * Undefined when the value is not a layout.
 */
export function normalizeLayout(raw: unknown): EditorLayout | undefined {
  const r = raw as { orientation?: unknown; groups?: unknown } | null;
  if (!r || typeof r !== "object" || (r.orientation !== 0 && r.orientation !== 1) || !Array.isArray(r.groups) || !r.groups.length) return undefined;
  const norm = (groups: unknown[], depth: number): LayoutGroup[] | undefined => {
    const items = groups.map(g => (g && typeof g === "object" ? g as { size?: unknown; groups?: unknown } : {}));
    const sizes = items.map(g => (typeof g.size === "number" && Number.isFinite(g.size) && g.size > 0 ? g.size : 0));
    const total = sizes.reduce((a, b) => a + b, 0);
    const out: LayoutGroup[] = [];
    for (let i = 0; i < items.length; i++) {
      const g: LayoutGroup = {};
      if (total > 0 && sizes[i]! > 0) g.size = Math.round((sizes[i]! / total) * 1000) / 1000;
      const children = items[i]!.groups;
      if (Array.isArray(children) && children.length) {
        if (depth >= 3) return undefined;
        const inner = norm(children, depth + 1);
        if (!inner) return undefined;
        g.groups = inner;
      }
      out.push(g);
    }
    return out;
  };
  const groups = norm(r.groups, 1);
  if (!groups) return undefined;
  const layout: EditorLayout = { orientation: r.orientation, groups };
  return leafCount(layout) <= MAX_GROUPS ? layout : undefined;
}

/** A readable id for a new view, unique among `taken`. */
export function viewIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugId(name, "view").slice(0, 70);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

/** Find a view by id, else by name (case-insensitive). */
export function findView(file: WorkViewsFile | undefined, idOrName: string | undefined): WorkView | undefined {
  if (!file || !idOrName) return undefined;
  const key = idOrName.trim();
  return file.views.find(v => v.id === key) ?? file.views.find(v => v.name.toLowerCase() === key.toLowerCase());
}

/** A view name as typed: control characters removed, spaces collapsed, 1–80 characters. */
export function cleanViewName(input: string): string | undefined {
  const name = input.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  return name && [...name].length <= 80 ? name : undefined;
}

const GROUP_TEXT: Readonly<Record<GroupBy, string>> = { none: "", subproject: "lanes by sub-project", repository: "lanes by repository", cloud: "lanes by cloud", level: "lanes by level" };

/** One line saying what a view restores (for pickers and tooltips). */
export function describeView(v: WorkView, labels: { subproject?: (id: string) => string | undefined; component?: (id: string) => string | undefined } = {}): string {
  const parts: string[] = [];
  const sp = v.selection?.subproject, c = v.selection?.component;
  if (c) parts.push(labels.component?.(c) ?? c);
  else if (sp) parts.push(labels.subproject?.(sp) ?? sp);
  else parts.push("whole project");
  if (v.editors) {
    const files = v.editors.groups.reduce((n, g) => n + g.tabs.filter(t => !("workbench" in t)).length, 0);
    parts.push(`${v.editors.groups.length} group${v.editors.groups.length === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"}`);
  }
  if (v.floatingWorkbench) parts.push("Workbench in its own window");
  else if (v.editors?.groups.some(g => g.tabs.some(t => "workbench" in t))) parts.push("Workbench tab");
  const d = v.diagram?.full ?? v.diagram?.map;
  if (d) parts.push([`diagram ${d.dir === "TB" ? "vertical" : "horizontal"}`, GROUP_TEXT[d.groupBy]].filter(Boolean).join(", "));
  if (v.preview?.scenario || v.preview?.picks?.length) parts.push(`preview ${v.preview.scenario ?? "custom"}`);
  return parts.join(" · ");
}

// ------------------------------------------------------------------ diagram settings from a webview

const FOLD_RE = /^(lane|parent):[^\s]{1,200}$/;

/** Diagram settings sent by a webview (untrusted): known values only, bounded. */
export function sanitizeDiagramUi(raw: unknown, mode: DiagramMode): DiagramUi | undefined {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return undefined;
  const dir = r.dir === "LR" || r.dir === "TB" ? r.dir : undefined;
  const groupBy = typeof r.groupBy === "string" && (GROUP_BY as readonly string[]).includes(r.groupBy) ? r.groupBy as GroupBy : undefined;
  if (!dir || !groupBy) return undefined;
  const folded = Array.isArray(r.folded) ? [...new Set(r.folded.filter((f): f is string => typeof f === "string" && FOLD_RE.test(f)))].slice(0, 100) : [];
  const zoom = r.zoom === "100" ? "100" : "fit";
  const ui: DiagramUi = { dir, groupBy, folded, zoom };
  if (mode === "full" && typeof r.view === "string" && (WORKBENCH_VIEWS as readonly string[]).includes(r.view)) ui.view = r.view as WorkbenchView;
  return ui;
}

export function sameDiagramUi(a: DiagramUi | undefined, b: DiagramUi | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// ------------------------------------------------------------------ open-view requests (launchers)

export type OpenViewRequest = { ok: true; view: string } | { ok: false; reason: string };

/**
 * A request written by a launcher: `{ "format": "datapass.open-view", "version": "1", "view": "<id or name>",
 * "requestedAt": "<ISO time>" }`. Only a view name travels; stale or malformed requests are refused.
 */
export function parseOpenViewRequest(raw: string | Uint8Array, now: number): OpenViewRequest {
  let doc: unknown;
  try { doc = parseStrictJson(raw, { maxBytes: 4096, maxDepth: 3 }); } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  const issues = validateSchema(obj({ format: constOf(OPEN_VIEW_FORMAT), version: constOf("1"), view: NAME, requestedAt: TIME }), doc);
  if (issues.length) return { ok: false, reason: issues.slice(0, 2).map(i => `${i.path} ${i.message}`).join("; ") };
  const r = doc as { view: string; requestedAt: string };
  const at = Date.parse(r.requestedAt);
  if (!(now - at <= OPEN_VIEW_MAX_AGE_MS && at - now <= 60_000)) return { ok: false, reason: `requested at ${r.requestedAt}, older than ${OPEN_VIEW_MAX_AGE_MS / 1000} s` };
  return { ok: true, view: r.view };
}
