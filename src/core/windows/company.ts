/**
 * Company windows (0.17). Julian's mapping: 1 VS Code window = 1 company (FOIL in one window,
 * DataPass in another). A company is a multi-root `.code-workspace` file listing the coordination
 * repositories of one or more DataPass projects and the repositories found on this machine by their
 * Git origin, with an optional title-bar colour and the work view to apply when it opens.
 *
 * Also the machine-local list a launcher (Power Ops, `code <file.code-workspace>`) reads to open a
 * company or one of its work views. `vscode://` links are routed to the last active window, so the
 * contract never relies on them: a launcher runs `code` with the workspace file, and asks for a work
 * view by writing a small request file that only that window's DataPass reads.
 *
 * Pure: every path API is passed in, so Windows and POSIX rules are both testable.
 */
import * as nodePath from "node:path";
import { parseStrictJson } from "../model/strictJson";
import { OPEN_VIEW_FORMAT } from "./workViews";

export type PathApi = Pick<typeof nodePath, "dirname" | "relative" | "isAbsolute" | "resolve" | "join" | "sep">;

export const COMPANY_SETTING = "datapass.company";
export const STARTUP_VIEW_SETTING = "datapass.startupView";
export const EXPORT_FORMAT = "datapass.company-workspaces";
export const EXPORT_FILE_NAME = "company-workspaces.json";

/** Title-bar colours offered when creating a company workspace (white text on each). */
export const TITLE_COLORS: ReadonlyArray<{ id: string; label: string; hex: string }> = [
  { id: "blue", label: "Blue", hex: "#1F6FEB" },
  { id: "green", label: "Green", hex: "#1A7F37" },
  { id: "purple", label: "Purple", hex: "#8250DF" },
  { id: "orange", label: "Orange", hex: "#BC4C00" },
  { id: "red", label: "Red", hex: "#CF222E" },
  { id: "teal", label: "Teal", hex: "#0E7C86" },
  { id: "pink", label: "Pink", hex: "#BF3989" },
  { id: "grey", label: "Grey", hex: "#57606A" }
];

/** The keys DataPass owns inside `workbench.colorCustomizations`; any other colour is kept. */
export const TITLE_BAR_KEYS = ["titleBar.activeBackground", "titleBar.activeForeground", "titleBar.inactiveBackground", "titleBar.inactiveForeground"] as const;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

export function titleBarColors(hex: string): Record<(typeof TITLE_BAR_KEYS)[number], string> {
  const c = hex.toUpperCase();
  return { "titleBar.activeBackground": c, "titleBar.activeForeground": "#FFFFFF", "titleBar.inactiveBackground": `${c}B3`, "titleBar.inactiveForeground": "#FFFFFFB3" };
}

/**
 * How a folder is written in a workspace file saved in `workspaceDir`: relative (portable: the
 * company folder can move, and the file never carries a machine path) whenever the folder is on the
 * same drive, absolute only when it is not.
 */
export function relativeFolderPath(workspaceDir: string, folder: string, p: PathApi = nodePath): { path: string; absolute: boolean } {
  const rel = p.relative(workspaceDir, folder);
  if (rel === "") return { path: ".", absolute: false };
  if (p.isAbsolute(rel)) return { path: folder, absolute: true };
  return { path: rel.split(p.sep).join("/"), absolute: false };
}

export interface CompanyWorkspaceInput {
  /** Absolute path of the `.code-workspace` file being written. */
  file: string;
  company: string;
  /** Absolute folder paths, in the order they should appear. */
  folders: readonly string[];
  /** `#RRGGBB`, or undefined for VS Code's own title bar colours. */
  color?: string;
  startupView?: string;
  /** The parsed existing file when replacing one: its other settings, extensions, tasks and launch configurations are kept. */
  existing?: Record<string, unknown>;
}

/** The workspace document to write, and the folders that could only be written as absolute paths. */
export function buildCompanyWorkspace(input: CompanyWorkspaceInput, p: PathApi = nodePath): { doc: Record<string, unknown>; absolute: string[] } {
  const dir = p.dirname(input.file);
  const absolute: string[] = [];
  const seen = new Set<string>();
  const folders: Array<{ path: string }> = [];
  for (const f of input.folders) {
    const key = p.resolve(f).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const r = relativeFolderPath(dir, f, p);
    if (r.absolute) absolute.push(f);
    folders.push({ path: r.path });
  }
  const existing = input.existing ?? {};
  const oldSettings = isRecord(existing.settings) ? existing.settings : {};
  const settings: Record<string, unknown> = { ...oldSettings, [COMPANY_SETTING]: input.company };
  if (input.startupView) settings[STARTUP_VIEW_SETTING] = input.startupView; else delete settings[STARTUP_VIEW_SETTING];
  const colors: Record<string, unknown> = { ...(isRecord(oldSettings["workbench.colorCustomizations"]) ? oldSettings["workbench.colorCustomizations"] : {}) };
  for (const k of TITLE_BAR_KEYS) delete colors[k];
  if (input.color && isHexColor(input.color)) Object.assign(colors, titleBarColors(input.color));
  if (Object.keys(colors).length) settings["workbench.colorCustomizations"] = colors; else delete settings["workbench.colorCustomizations"];
  const doc: Record<string, unknown> = { ...existing, folders, settings };
  return { doc, absolute };
}

// ------------------------------------------------------------------ reading workspace files (JSON with comments)

/** Remove `//` and `/* *\/` comments and trailing commas (outside strings): VS Code's JSONC to strict JSON. */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "\"") {
      let j = i + 1;
      while (j < n && text[j] !== "\"") j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (ch === ",") {
      let j = i + 1;
      // A comma followed only by blanks and comments before } or ] is a trailing comma.
      for (;;) {
        while (j < n && /\s/.test(text[j]!)) j++;
        if (text[j] === "/" && text[j + 1] === "/") { while (j < n && text[j] !== "\n") j++; continue; }
        if (text[j] === "/" && text[j + 1] === "*") { const e = text.indexOf("*/", j + 2); j = e < 0 ? n : e + 2; continue; }
        break;
      }
      if (text[j] !== "}" && text[j] !== "]") out += ch;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export interface ParsedWorkspaceFile {
  raw: Record<string, unknown>;
  /** Local folders as written (relative or absolute); `uri` folders (remote) are skipped. */
  folders: Array<{ path: string; name?: string }>;
  settings: Record<string, unknown>;
  company?: string;
  startupView?: string;
  color?: string;
}

export function parseWorkspaceFile(bytes: Uint8Array | string): ParsedWorkspaceFile {
  let text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const doc = parseStrictJson(stripJsonc(text), { maxBytes: 1_048_576, maxDepth: 20 });
  if (!isRecord(doc)) throw new Error("a workspace file is a JSON object");
  const folders = Array.isArray(doc.folders)
    ? doc.folders.filter(isRecord).filter(f => typeof f.path === "string" && f.path.length > 0 && f.path.length <= 1000).slice(0, 100)
      .map(f => ({ path: f.path as string, name: typeof f.name === "string" ? f.name : undefined }))
    : [];
  const settings = isRecord(doc.settings) ? doc.settings : {};
  const text1 = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 200 ? v.trim() : undefined);
  const colors = isRecord(settings["workbench.colorCustomizations"]) ? settings["workbench.colorCustomizations"] : {};
  const bg = colors["titleBar.activeBackground"];
  return { raw: doc, folders, settings, company: text1(settings[COMPANY_SETTING]), startupView: text1(settings[STARTUP_VIEW_SETTING]), color: isHexColor(bg) ? bg.toUpperCase() : undefined };
}

/** Absolute folders of a workspace file (relative paths are relative to the file's folder). */
export function workspaceFolderPaths(file: string, folders: ReadonlyArray<{ path: string }>, p: PathApi = nodePath): string[] {
  const dir = p.dirname(file);
  return folders.map(f => (p.isAbsolute(f.path) ? p.resolve(f.path) : p.resolve(dir, f.path)));
}

// ------------------------------------------------------------------ Power Ops export (machine-local)

export interface ExportView { id: string; name: string; description: string }
export interface ExportProject { id: string; title: string; folder: string; views: ExportView[]; viewsError?: string }
export interface ExportCompany { file: string; name: string; color?: string; startupView?: string; projects: ExportProject[] }

export interface PowerOpsExport {
  format: typeof EXPORT_FORMAT;
  version: "1";
  generatedAt: string;
  generator: string;
  note: string;
  howToOpen: { company: string; view: string };
  companies: Array<{
    name: string;
    workspaceFile: string;
    color?: string;
    startupView?: string;
    launch: { command: "code"; arguments: string };
    projects: Array<{
      id: string; title: string; folder: string; viewsError?: string;
      views: Array<ExportView & { startup: boolean; openView: { file: string; request: { format: typeof OPEN_VIEW_FORMAT; version: "1"; view: string } } }>;
    }>;
  }>;
}

/** One argument for a Windows command line (Power Ops' Tool Launcher passes Arguments as one string). */
export function quoteArg(arg: string): string {
  return /^[A-Za-z0-9_\-.:\\/]+$/.test(arg) ? arg : `"${arg.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/, "$1$1")}"`;
}

export function buildPowerOpsExport(companies: readonly ExportCompany[], meta: { generatedAt: string; generator: string; requestFile: (projectFolder: string) => string }): PowerOpsExport {
  return {
    format: EXPORT_FORMAT, version: "1", generatedAt: meta.generatedAt, generator: meta.generator,
    note: "Machine-local list of the company workspace files DataPass knows on this computer, for launchers such as Power Ops. It holds file paths and view names only — never a secret. Do not commit it.",
    howToOpen: {
      company: "Run launch.command with launch.arguments (code <file.code-workspace>). If that company's window is already open, VS Code brings it to the front; otherwise it opens it, and DataPass applies its startupView.",
      view: "Write openView.request, plus \"requestedAt\": the current time in ISO 8601, to openView.file, then open the company as above. DataPass applies the view within a few seconds and deletes the file; a request older than 2 minutes is ignored."
    },
    companies: companies.map(c => ({
      name: c.name,
      workspaceFile: c.file,
      ...(c.color ? { color: c.color } : {}),
      ...(c.startupView ? { startupView: c.startupView } : {}),
      launch: { command: "code" as const, arguments: quoteArg(c.file) },
      projects: c.projects.map(p => ({
        id: p.id, title: p.title, folder: p.folder, ...(p.viewsError ? { viewsError: p.viewsError } : {}),
        views: p.views.map(v => ({
          ...v,
          startup: Boolean(c.startupView && (c.startupView === v.id || c.startupView.toLowerCase() === v.name.toLowerCase())),
          openView: { file: meta.requestFile(p.folder), request: { format: OPEN_VIEW_FORMAT, version: "1" as const, view: v.id } }
        }))
      }))
    }))
  };
}

/** Where the export goes by default: a DataPass folder in the per-user application data. */
export function defaultExportFile(env: Readonly<Record<string, string | undefined>>, platform: string, home: string, p: PathApi = nodePath): string {
  if (platform === "win32") return p.join(env.LOCALAPPDATA || p.join(home, "AppData", "Local"), "DataPass", EXPORT_FILE_NAME);
  if (platform === "darwin") return p.join(home, "Library", "Application Support", "DataPass", EXPORT_FILE_NAME);
  return p.join(env.XDG_DATA_HOME || p.join(home, ".local", "share"), "datapass", EXPORT_FILE_NAME);
}

/** A company name as typed: 1–60 characters, no control characters. */
export function cleanCompanyName(input: string): string | undefined {
  const name = input.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  return name && [...name].length <= 60 ? name : undefined;
}

/** A file name for the workspace file of a company ("FOIL" → "FOIL.code-workspace"). */
export function workspaceFileName(company: string): string {
  const base = company.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60) || "Company";
  return `${base}.code-workspace`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
