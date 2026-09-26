/**
 * Windows and work views (0.17): the status-bar switcher ("Company · sub-project ▾"), saving and
 * applying work views, the company workspace file (1 VS Code window = 1 company), the startup work
 * view a workspace file names, the Workbench in a floating window, and the machine-local list
 * Power Ops reads to launch a company or one of its work views.
 *
 * Local-first: work views live in `.datapass/local` (git-ignored); the company workspace file is
 * written where the person chooses, with folders relative to it whenever possible; the Power Ops
 * list goes to the per-user application data folder. Nothing is sent anywhere, and `vscode://`
 * links are never used to target a window (VS Code routes them to the last active one).
 */
import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import type { WorkSession } from "./session";
import { cloneParents, gitRunner, readLocalBindings } from "./session";
import type { WorkbenchHost } from "../views/workbench";
import type { WorkViews } from "./workViews";
import { knownProjects } from "./workbenchCommands";
import { locateRepositories } from "./projectObserver";
import { confirmModal, errorMessage, guarded, output, report, UserFacingError } from "./io";
import { clipboard } from "../core/clipboard";
import { openFolderWindow } from "../core/external";
import { readProjectManifest } from "../core/projectManifest";
import { isInside } from "../core/exchange/pathSafety";
import { LOCAL_DIR } from "../core/workspace/loader";
import { cleanViewName, describeView, findView, OPEN_VIEW_REQUEST_FILE, type WorkView } from "../core/windows/workViews";
import {
  buildCompanyWorkspace, buildPowerOpsExport, cleanCompanyName, defaultExportFile, isHexColor, parseWorkspaceFile, TITLE_COLORS,
  workspaceFileName, workspaceFolderPaths, type ExportCompany, type ExportProject
} from "../core/windows/company";

const REGISTRY_KEY = "datapass.v17.companyWorkspaces";
const EXPORT_KEY = "datapass.v17.powerOpsExport";
const MAX_REGISTRY = 50;

let exportFileForTests: string | undefined;
/** Test-mode only: write the Power Ops list here instead of the per-user application data folder. */
export function setExportFileForTests(file?: string): void { exportFileForTests = file; }

export interface WindowControls {
  /** Applies a launcher's request or the workspace file's startup view; resolves to the view applied. */
  startup(): Promise<string | undefined>;
  switcherText(): string;
  switcherTooltip(): string;
  company(): string;
}

export function registerWindowCommands(context: vscode.ExtensionContext, session: WorkSession, host: WorkbenchHost, views: WorkViews): WindowControls {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const version = String(context.extension.packageJSON.version ?? "unknown");
  const config = () => vscode.workspace.getConfiguration("datapass");
  const text1 = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 200 ? v.trim() : undefined);
  const workspaceFile = () => (vscode.workspace.workspaceFile?.scheme === "file" ? vscode.workspace.workspaceFile : undefined);
  /** The company this window stands for: the workspace's setting, else the project, else the workspace name. */
  const company = () => text1(config().inspect<string>("company")?.workspaceValue)
    ?? session.project.manifest?.project.title
    ?? (vscode.workspace.name ? vscode.workspace.name.replace(/ \(Workspace\)$/, "") : undefined)
    ?? "DataPass";
  /** Only a `.code-workspace` file can name the startup view (a folder's settings are committed with the repository). */
  const startupSetting = () => (workspaceFile() ? text1(config().inspect<string>("startupView")?.workspaceValue) : undefined);
  const projectRoots = () => (session.projectRootCandidates().length ? [...session.projectRootCandidates()] : session.root && session.project.manifestExists ? [session.root] : []);
  const isStartup = (v: WorkView) => { const s = startupSetting(); return Boolean(s && (s === v.id || s.toLowerCase() === v.name.toLowerCase())); };

  // ------------------------------------------------------------------ status bar switcher

  const item = vscode.window.createStatusBarItem("datapass.company", vscode.StatusBarAlignment.Left, 21);
  item.name = "DataPass company switcher";
  item.command = "datapass.openSwitcher";
  context.subscriptions.push(item);
  let appliedName: string | undefined;
  /** Labels come from repository files: no icon syntax (it would render as VS Code icons), bounded length. */
  const label = (s: string, max = 40) => { const t = s.replace(/\$\([^)]*\)/g, "").replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
  const subprojectTitle = () => {
    const sel = session.selection();
    const sp = session.projectMap().subprojects.find(s => s.id === sel.subproject);
    return sp && !sp.implicit ? sp.title : undefined;
  };
  const tooltipText = () => [
    `${company()} — DataPass window`,
    session.project.manifest ? `Project: ${session.project.manifest.project.title}` : "No DataPass project in this window",
    `Sub-project: ${subprojectTitle() ?? "whole project"}`,
    `Work view: ${appliedName ?? "none applied"}${startupSetting() ? ` · this workspace opens with "${startupSetting()}"` : ""}`,
    "Click: work views, sub-projects, other projects, the Workbench in its own window."
  ].join("\n");
  const update = () => {
    const applied = views.lastApplied();
    appliedName = undefined;
    if (applied) void views.load(vscode.Uri.parse(applied.root)).then(r => { appliedName = r.file.views.find(v => v.id === applied.id)?.name; item.tooltip = tooltipText(); });
    const sp = subprojectTitle();
    item.text = `$(briefcase) ${label(company())}${sp ? ` · ${label(sp)}` : ""} $(chevron-down)`;
    item.tooltip = tooltipText();
    if (vscode.workspace.workspaceFolders?.length) item.show(); else item.hide();
  };
  context.subscriptions.push(
    session.onDidChange(update), session.onDidChangeSelection(update), views.onDidChange(update),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.company") || e.affectsConfiguration("datapass.startupView")) update(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(update)
  );
  update();

  // ------------------------------------------------------------------ work views

  const labels = () => {
    const map = session.projectMap();
    return { subproject: (id: string) => map.subprojects.find(s => s.id === id)?.title, component: (id: string) => map.components.find(c => c.id === id)?.label };
  };

  /** Find a view by id or name: this project first, then the other DataPass projects of the window. */
  const locate = async (idOrName: string): Promise<{ view: WorkView; root: vscode.Uri } | undefined> => {
    const all = await views.all();
    const current = session.root?.toString();
    for (const s of [...all.filter(x => x.root.toString() === current), ...all.filter(x => x.root.toString() !== current)]) {
      const view = findView(s.file, idOrName);
      if (view) return { view, root: s.root };
    }
    return undefined;
  };

  const pickView = async (title: string): Promise<{ view: WorkView; root: vscode.Uri } | undefined> => {
    const all = await views.all();
    const items = all.flatMap(s => s.file.views.map(v => ({ label: v.name, description: [all.length > 1 ? s.title : undefined, isStartup(v) ? "opens with this workspace" : undefined].filter(Boolean).join(" · ") || undefined, detail: describeView(v, labels()), view: v, root: s.root })));
    if (!items.length) throw new UserFacingError("No work view yet. Arrange the window (files, Workbench, diagram, sub-project), then run DataPass: Save Work View….");
    const pick = await vscode.window.showQuickPick(items, { title, matchOnDetail: true });
    return pick ? { view: pick.view, root: pick.root } : undefined;
  };

  const applyAndReport = async (view: WorkView, root: vscode.Uri, origin = "") => {
    const notes = await views.apply(view, root);
    if (notes.length) {
      report(`Work view "${view.name}"${origin}`, notes);
      void vscode.window.showInformationMessage(`Work view "${view.name}" applied. ${notes.length} note(s): ${notes[0]}${notes.length > 1 ? " (all in the DataPass Work output)" : ""}`);
    } else {
      vscode.window.setStatusBarMessage(`$(layout) DataPass: work view "${view.name}" applied`, 4000);
    }
  };

  reg("datapass.saveWorkView", async (nameArg?: unknown) => {
    if (!session.root || !session.project.manifestExists) throw new UserFacingError("Work views belong to a DataPass project: open a folder with .datapass/project.json first.");
    let name = typeof nameArg === "string" ? cleanViewName(nameArg) : undefined;
    const { file } = await views.load();
    if (!name) {
      const sel = session.selection();
      const suggestion = (sel.component && labels().component(sel.component)) || (sel.subproject && labels().subproject(sel.subproject)) || `View ${file.views.length + 1}`;
      const typed = await vscode.window.showInputBox({
        title: "Save work view", value: suggestion,
        prompt: "Name of this layout: the open files and their grid, the Workbench, the visible DataPass views, the diagram settings and the selection. Saved on this computer only (.datapass/local, never committed).",
        validateInput: v => (cleanViewName(v) ? undefined : "1 to 80 characters")
      });
      if (typed === undefined) return;
      name = cleanViewName(typed)!;
      const same = file.views.find(v => v.name.toLowerCase() === name!.toLowerCase());
      if (same && !(await confirmModal(`Replace the work view "${same.name}"?`, "It will hold the current layout instead. Its id stays, so a workspace that opens with it keeps working.", "Replace"))) return;
    }
    const { view, notes, replaced } = await views.save(name);
    await exportIfEnabled();
    report(`Work view "${view.name}" ${replaced ? "replaced" : "saved"}`, [describeView(view, labels()), ...notes, `Stored in ${LOCAL_DIR}/views.json (this computer only).`]);
    void vscode.window.showInformationMessage(`Work view "${view.name}" ${replaced ? "replaced" : "saved"}: ${describeView(view, labels())}.${notes.length ? ` ${notes[0]}` : ""}`);
  });

  reg("datapass.applyWorkView", async (arg?: unknown) => {
    const wanted = typeof arg === "string" ? arg : undefined;
    const target = wanted ? await locate(wanted) : await pickView("Apply which work view?");
    if (!target) { if (wanted) throw new UserFacingError(`No work view "${wanted}" in this window's DataPass projects.`); return; }
    await applyAndReport(target.view, target.root);
  });

  reg("datapass.renameWorkView", async (arg?: unknown) => {
    const target = typeof arg === "string" ? await locate(arg) : await pickView("Rename which work view?");
    if (!target) { if (typeof arg === "string") throw new UserFacingError(`No work view "${arg}".`); return; }
    const typed = await vscode.window.showInputBox({ title: `Rename "${target.view.name}"`, value: target.view.name, validateInput: v => (cleanViewName(v) ? undefined : "1 to 80 characters") });
    if (typed === undefined || cleanViewName(typed) === target.view.name) return;
    const renamed = await views.rename(target.view.id, cleanViewName(typed)!, target.root);
    await exportIfEnabled();
    vscode.window.setStatusBarMessage(`DataPass: work view renamed to "${renamed.name}"`, 4000);
  });

  reg("datapass.deleteWorkView", async (arg?: unknown) => {
    const target = typeof arg === "string" ? await locate(arg) : await pickView("Delete which work view?");
    if (!target) { if (typeof arg === "string") throw new UserFacingError(`No work view "${arg}".`); return; }
    const startup = isStartup(target.view);
    if (!(await confirmModal(`Delete the work view "${target.view.name}"?`, `Only this saved layout is deleted; no file, repository or project data changes.${startup ? " This workspace opens with it: choose another startup view afterwards." : ""}`, "Delete"))) return;
    await views.remove(target.view.id, target.root);
    await exportIfEnabled();
    vscode.window.setStatusBarMessage(`DataPass: work view "${target.view.name}" deleted`, 4000);
  });

  reg("datapass.setStartupView", async (arg?: unknown) => {
    const file = workspaceFile();
    if (!file) throw new UserFacingError("This window has no workspace file. Create the company workspace file first (DataPass: Create the Company Workspace File…); a single folder's settings are part of its repository.");
    let id: string | undefined;
    if (arg === "") id = undefined;
    else if (typeof arg === "string") {
      const target = await locate(arg);
      if (!target) throw new UserFacingError(`No work view "${arg}".`);
      id = target.view.id;
    } else {
      const all = await views.all();
      const items = [{ label: "$(circle-slash) No startup view", description: "DataPass leaves the window as VS Code restores it", id: undefined as string | undefined },
        ...all.flatMap(s => s.file.views.map(v => ({ label: v.name, description: isStartup(v) ? "current" : undefined, detail: describeView(v, labels()), id: v.id as string | undefined })))];
      const pick = await vscode.window.showQuickPick(items, { title: `Open ${path.basename(file.fsPath)} with which work view?` });
      if (!pick) return;
      id = pick.id;
    }
    await config().update("startupView", id, vscode.ConfigurationTarget.Workspace);
    await exportIfEnabled();
    vscode.window.setStatusBarMessage(id ? `DataPass: ${path.basename(file.fsPath)} opens with "${id}"` : "DataPass: no startup view", 4000);
  });

  reg("datapass.manageWorkViews", async () => {
    const target = await pickView("Manage which work view?");
    if (!target) return;
    const startup = isStartup(target.view);
    const actions = [
      { label: "$(play) Apply", id: "apply" },
      { label: "$(save) Replace with the current layout", id: "replace" },
      { label: "$(edit) Rename…", id: "rename" },
      ...(workspaceFile() ? [startup ? { label: "$(star-empty) Stop opening this workspace with it", id: "unstartup" } : { label: "$(star-full) Open this workspace with it", id: "startup" }] : []),
      { label: "$(trash) Delete…", id: "delete" }
    ];
    const pick = await vscode.window.showQuickPick(actions, { title: target.view.name, placeHolder: describeView(target.view, labels()) });
    if (!pick) return;
    if (pick.id === "apply") await applyAndReport(target.view, target.root);
    else if (pick.id === "replace") {
      if (target.root.toString() !== session.root?.toString()) throw new UserFacingError("Switch to that project folder first (a view is saved from its own project).");
      const r = await views.save(target.view.name, target.view.id);
      await exportIfEnabled();
      vscode.window.setStatusBarMessage(`DataPass: work view "${r.view.name}" replaced`, 4000);
    }
    else if (pick.id === "rename") await vscode.commands.executeCommand("datapass.renameWorkView", target.view.id);
    else if (pick.id === "startup") await vscode.commands.executeCommand("datapass.setStartupView", target.view.id);
    else if (pick.id === "unstartup") await vscode.commands.executeCommand("datapass.setStartupView", "");
    else if (pick.id === "delete") await vscode.commands.executeCommand("datapass.deleteWorkView", target.view.id);
  });

  reg("datapass.openSwitcher", async () => {
    type Item = vscode.QuickPickItem & { run?: () => Promise<unknown> };
    const run = (id: string, ...args: unknown[]) => async () => vscode.commands.executeCommand(id, ...args);
    const items: Item[] = [];
    const all = await views.all();
    const applied = views.lastApplied();
    items.push({ label: "Work views", kind: vscode.QuickPickItemKind.Separator });
    for (const s of all) {
      for (const v of s.file.views) {
        const current = applied?.id === v.id && applied.root === s.root.toString();
        items.push({ label: `$(layout) ${v.name}`, description: [all.length > 1 ? s.title : undefined, current ? "current" : undefined, isStartup(v) ? "opens with this workspace" : undefined].filter(Boolean).join(" · ") || undefined, detail: describeView(v, labels()), run: () => applyAndReport(v, s.root) });
      }
      if (s.error) items.push({ label: `$(warning) ${s.title}: saved views cannot be read`, detail: s.error });
    }
    items.push({ label: "$(save) Save the current layout as a work view…", run: run("datapass.saveWorkView") });
    if (all.some(s => s.file.views.length)) items.push({ label: "$(gear) Rename, delete or choose the startup view…", run: run("datapass.manageWorkViews") });
    const map = session.projectMap();
    const declared = map.subprojects.filter(s => !s.implicit);
    if (map.project && declared.length) {
      const sel = session.selection();
      items.push({ label: "Sub-projects", kind: vscode.QuickPickItemKind.Separator });
      items.push({ label: "$(home) Whole project", description: !sel.subproject ? "current" : undefined, run: () => session.select({}) });
      for (const sp of declared) items.push({ label: `$(symbol-namespace) ${sp.title}`, description: sel.subproject === sp.id ? "current" : undefined, detail: sp.objective, run: () => session.select({ subproject: sp.id }) });
    }
    items.push({ label: "Projects", kind: vscode.QuickPickItemKind.Separator });
    if (session.projectRootCandidates().length > 1) items.push({ label: "$(folder-library) Another DataPass project of this window…", run: run("datapass.selectProjectFolder") });
    items.push({ label: "$(arrow-swap) Switch project…", description: "opens it in its own window", run: run("datapass.switchProject") });
    items.push({ label: "Window", kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: "$(multiple-windows) Open the Workbench in a floating window", description: "for a second screen", run: run("datapass.openWorkbenchFloating") });
    items.push({ label: "$(file-code) Create the company workspace file…", description: "one window per company", run: run("datapass.createCompanyWorkspace") });
    items.push({ label: "$(export) Export company workspaces for Power Ops", run: run("datapass.exportCompanyWorkspaces") });
    const pick = await vscode.window.showQuickPick(items, { title: `${company()} — work views, sub-projects, projects`, placeHolder: "A work view applies in one click", matchOnDescription: true, matchOnDetail: true });
    if (pick?.run) await pick.run();
  });

  reg("datapass.openWorkbenchFloating", async () => {
    let result: "moved" | "already";
    try { result = await host.openFloating(); } catch (e) { throw new UserFacingError(errorMessage(e)); }
    vscode.window.setStatusBarMessage(result === "moved" ? "DataPass: the Workbench is in its own window (drag it to another screen)" : "DataPass: the Workbench is already in its own window", 5000);
  });

  // ------------------------------------------------------------------ company workspace file

  const registry = (): string[] => (context.globalState.get<string[]>(REGISTRY_KEY) ?? []).filter(f => typeof f === "string" && path.isAbsolute(f));
  const sameFile = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const register = async (file: string) => {
    const list = registry();
    if (list[0] && sameFile(list[0], file)) return;
    await context.globalState.update(REGISTRY_KEY, [file, ...list.filter(f => !sameFile(f, file))].slice(0, MAX_REGISTRY));
  };

  /** A project's coordination folder and its repositories found on this machine by Git origin. */
  const projectFolders = async (root: vscode.Uri): Promise<{ title: string; organization?: string; folders: Array<{ fsPath: string; label: string }>; missing: string[] }> => {
    if (root.toString() === session.root?.toString() && session.project.manifest) {
      const map = session.projectMap();
      const folders = map.repositories.filter(r => r.state === "local" && session.repoFolder(r.key)).map(r => ({ fsPath: session.repoFolder(r.key)!.fsPath, label: r.coordination ? "coordination" : r.label }));
      return { title: session.project.manifest.project.title, folders, missing: map.repositories.filter(r => r.state !== "local" && r.state !== "planned").map(r => `${r.label} (${r.state === "restricted" ? "not inspected in Restricted Mode" : r.remote ?? r.key})`) };
    }
    const read = await readProjectManifest(root);
    if (!read.manifest) return { title: path.basename(root.fsPath), folders: [{ fsPath: root.fsPath, label: "coordination" }], missing: read.errors.length ? [`the manifest has errors (${read.errors[0]})`] : [] };
    const located = await locateRepositories({ root, manifest: read.manifest, trusted: vscode.workspace.isTrusted, git: gitRunner, localBindings: await readLocalBindings(root), cloneParents: cloneParents() });
    const folders = [...located.folders].map(([key, uri]) => ({ fsPath: uri.fsPath, label: key === located.coordinationKey ? "coordination" : read.manifest!.repositories?.[key]?.label ?? key }));
    const missing = Object.entries(read.manifest.repositories ?? {}).filter(([key, r]) => !r.planned && !located.folders.has(key)).map(([key, r]) => `${r.label ?? key} (${r.remote?.url ?? key})`);
    return { title: read.manifest.project.title, folders, missing };
  };

  reg("datapass.createCompanyWorkspace", async () => {
    // 1. The DataPass projects of this company.
    type ProjectItem = vscode.QuickPickItem & { folder: string; organization?: string };
    const items: ProjectItem[] = [];
    for (const r of projectRoots()) items.push({ label: r.toString() === session.root?.toString() ? session.project.manifest?.project.title ?? path.basename(r.fsPath) : path.basename(r.fsPath), description: "in this window", detail: r.fsPath, folder: r.fsPath, picked: true });
    const known = await knownProjects(session);
    const listed = (f: string) => items.some(i => sameFile(i.folder, f));
    for (const e of known.entries) if (e.localFolder && !listed(e.localFolder)) items.push({ label: e.title, description: [e.organization, "catalog"].filter(Boolean).join(" · "), detail: e.localFolder, folder: e.localFolder, organization: e.organization });
    for (const r of known.recent) if (!listed(r.folder)) items.push({ label: r.title, description: "recently opened", detail: r.folder, folder: r.folder });
    if (!items.length) throw new UserFacingError("No DataPass project found. Open a project folder (one with .datapass/project.json) or add a catalog, then try again.");
    const projects = items.length === 1 ? items : await vscode.window.showQuickPick(items, { canPickMany: true, title: "Company workspace (1/5): which DataPass projects belong to this company?", placeHolder: "One VS Code window per company: these projects and their repositories found on this computer" });
    if (!projects?.length) return;

    // 2. Their folders: coordination repositories and the repositories found on this machine by Git origin.
    type FolderItem = vscode.QuickPickItem & { fsPath: string };
    const folderItems: FolderItem[] = [];
    const missing: string[] = [];
    for (const p of projects) {
      const r = await projectFolders(vscode.Uri.file(p.folder));
      for (const f of r.folders) if (!folderItems.some(i => sameFile(i.fsPath, f.fsPath))) folderItems.push({ label: path.basename(f.fsPath), description: `${r.title} · ${f.label}`, detail: f.fsPath, fsPath: f.fsPath, picked: true });
      missing.push(...r.missing.map(m => `${r.title}: ${m}`));
    }
    const folders = await vscode.window.showQuickPick(folderItems, { canPickMany: true, title: "Company workspace (2/5): folders of the window", placeHolder: missing.length ? `Not found on this computer, so not included: ${missing.join("; ")}` : "Every repository of these projects found on this computer" });
    if (!folders?.length) return;

    // 3. The company's name.
    const typed = await vscode.window.showInputBox({ title: "Company workspace (3/5): company name", value: projects.find(p => p.organization)?.organization ?? projects[0]!.label, prompt: "Shown in the status bar switcher and the window title (FOIL, DataPass, a client…)", validateInput: v => (cleanCompanyName(v) ? undefined : "1 to 60 characters") });
    if (typed === undefined) return;
    const name = cleanCompanyName(typed)!;

    // 4. Where the file goes (next to the repositories by default: relative paths).
    const target = await vscode.window.showSaveDialog({ title: "Company workspace (4/5): save the workspace file", defaultUri: vscode.Uri.file(path.join(path.dirname(projects[0]!.folder), workspaceFileName(name))), filters: { "VS Code workspace": ["code-workspace"] }, saveLabel: "Save workspace file" });
    if (!target) return;
    if (target.scheme !== "file") throw new UserFacingError("Save the workspace file on this computer.");
    const file = /\.code-workspace$/i.test(target.fsPath) ? target.fsPath : `${target.fsPath}.code-workspace`;

    // 5. Title bar colour and startup view.
    const colors = [{ label: "$(circle-slash) No colour", description: "VS Code's own title bar", hex: undefined as string | undefined, custom: false },
      ...TITLE_COLORS.map(c => ({ label: `$(circle-filled) ${c.label}`, description: c.hex, hex: c.hex as string | undefined, custom: false })),
      { label: "$(edit) Another colour…", description: "#RRGGBB", hex: undefined as string | undefined, custom: true }];
    const colorPick = await vscode.window.showQuickPick(colors, { title: "Company workspace (5/5): title bar colour", placeHolder: "Tells companies' windows apart at a glance (workbench.colorCustomizations of this workspace only)" });
    if (!colorPick) return;
    let color = colorPick.hex;
    if (colorPick.custom) {
      const hex = await vscode.window.showInputBox({ title: "Title bar colour", prompt: "#RRGGBB", value: "#1F6FEB", validateInput: v => (isHexColor(v.trim()) ? undefined : "Six hexadecimal digits after #, e.g. #1F6FEB") });
      if (hex === undefined) return;
      color = hex.trim().toUpperCase();
    }
    const viewItems: Array<vscode.QuickPickItem & { id?: string }> = [];
    for (const p of projects) {
      const { file: vf } = await views.load(vscode.Uri.file(p.folder));
      for (const v of vf.views) viewItems.push({ label: v.name, description: projects.length > 1 ? p.label : undefined, detail: describeView(v), id: v.id });
    }
    let startupView: string | undefined;
    if (viewItems.length) {
      const pick = await vscode.window.showQuickPick([{ label: "$(circle-slash) No startup view", description: "the window opens as VS Code restores it" } as vscode.QuickPickItem & { id?: string }, ...viewItems], { title: "Open this company with a work view?", placeHolder: "Applied each time this workspace file opens (Power Ops, double-click, code <file>)" });
      if (!pick) return;
      startupView = pick.id;
    }

    // Replacing a file keeps its other settings, extensions, tasks and launch configurations.
    let existing: Record<string, unknown> | undefined;
    const uri = vscode.Uri.file(file);
    let exists = false;
    try { await vscode.workspace.fs.stat(uri); exists = true; } catch { /* new file */ }
    if (exists) {
      try {
        existing = parseWorkspaceFile(await vscode.workspace.fs.readFile(uri)).raw;
        if (!(await confirmModal(`Replace ${path.basename(file)}?`, "Its folders, company name, startup view and title bar colour are rewritten; its other settings, extensions, tasks and launch configurations are kept (comments are not).", "Replace"))) return;
      } catch (e) {
        if (!(await confirmModal(`${path.basename(file)} is not a readable workspace file.`, `${errorMessage(e)}\n\nReplace it entirely?`, "Replace"))) return;
      }
    }
    const { doc, absolute } = buildCompanyWorkspace({ file, company: name, folders: folders.map(f => f.fsPath), color, startupView, existing });
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(doc, null, "\t") + "\n"));
    await register(file);
    await exportIfEnabled();

    const detail = [
      `${folders.length} folder(s)${absolute.length ? `; ${absolute.length} on another drive are written with absolute paths (${absolute.map(a => path.basename(a)).join(", ")}): keep this file on this computer, do not commit it` : ", written relative to the file (it can move with them)"}.`,
      startupView ? `Opening it applies the work view "${viewItems.find(v => v.id === startupView)?.label ?? startupView}".` : "",
      "VS Code Profiles: to give this company its own extensions and settings, open the workspace, then Manage (gear, bottom left) → Profiles → New Profile…, and use it for this workspace. VS Code then always reopens this workspace with that profile.",
      "Power Ops: run DataPass: Export Company Workspaces for Power Ops so its Tool Launcher can open this company (code <file>)."
    ].filter(Boolean).join("\n\n");
    const choice = await vscode.window.showInformationMessage(`Company workspace saved: ${path.basename(file)}`, { modal: true, detail }, "Open in a new window", "Copy the path");
    if (choice === "Open in a new window") await openFolderWindow(uri);
    else if (choice === "Copy the path") await clipboard.writeText(file);
  });

  // ------------------------------------------------------------------ Power Ops list

  // Tests never write into the real per-user application data, even when a test forgets the seam.
  const exportTarget = () => exportFileForTests ?? (context.extensionMode === vscode.ExtensionMode.Test
    ? path.join(os.tmpdir(), "datapass-desktop-tests", "company-workspaces.json")
    : defaultExportFile(process.env, process.platform, os.homedir()));

  /** Write the machine-local list of company workspaces (and their work views) Power Ops reads. */
  const exportCompanies = async (): Promise<{ file: string; companies: number }> => {
    const current = workspaceFile()?.fsPath;
    const files = [...(current && (text1(config().inspect<string>("company")?.workspaceValue) || projectRoots().length) ? [current] : []), ...registry()];
    const companies: ExportCompany[] = [];
    const alive: string[] = [];
    for (const f of files) {
      if (alive.some(a => sameFile(a, f))) continue;
      let bytes: Uint8Array;
      try { bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(f)); } catch { continue; }
      alive.push(f);
      let parsed: ReturnType<typeof parseWorkspaceFile>;
      try { parsed = parseWorkspaceFile(bytes); } catch (e) { output().appendLine(`[export] ${f}: ${errorMessage(e)}`); continue; }
      const projects: ExportProject[] = [];
      for (const folder of workspaceFolderPaths(f, parsed.folders).slice(0, 40)) {
        const read = await readProjectManifest(vscode.Uri.file(folder));
        if (!read.manifest) continue;
        const { file: vf, error } = await views.load(vscode.Uri.file(folder));
        projects.push({ id: read.manifest.project.id, title: read.manifest.project.title, folder, views: vf.views.map(v => ({ id: v.id, name: v.name, description: describeView(v) })), ...(error ? { viewsError: error } : {}) });
      }
      companies.push({ file: f, name: parsed.company ?? path.basename(f).replace(/\.code-workspace$/i, ""), color: parsed.color, startupView: parsed.startupView, projects });
    }
    await context.globalState.update(REGISTRY_KEY, alive.slice(0, MAX_REGISTRY));
    const doc = buildPowerOpsExport(companies, { generatedAt: new Date().toISOString(), generator: `DataPass Control Plane ${version}`, requestFile: folder => path.join(folder, ...LOCAL_DIR.split("/"), OPEN_VIEW_REQUEST_FILE) });
    const target = exportTarget();
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target), new TextEncoder().encode(JSON.stringify(doc, null, 2) + "\n"));
    await context.globalState.update(EXPORT_KEY, { file: target, at: doc.generatedAt });
    return { file: target, companies: companies.length };
  };

  /** After the first export, the list is kept up to date whenever a company or a work view changes. */
  // V1-STAB: exports run one after the other. Two at once (a rename's and a late open-view request's)
  // could read the views before the rename and write after it, leaving the old name in the list.
  let exportQueue: Promise<void> = Promise.resolve();
  const exportIfEnabled = (): Promise<void> => {
    exportQueue = exportQueue.then(async () => {
      if (!context.globalState.get(EXPORT_KEY)) return;
      try { await exportCompanies(); } catch (e) { output().appendLine(`[export] ${errorMessage(e)}`); }
    });
    return exportQueue;
  };

  reg("datapass.exportCompanyWorkspaces", async () => {
    const queued = exportQueue.then(() => exportCompanies());
    exportQueue = queued.then(() => undefined, () => undefined);
    const r = await queued;
    const choice = await vscode.window.showInformationMessage(
      `Power Ops list written: ${r.companies} company workspace(s).`,
      { modal: true, detail: `${r.file}\n\nPower Ops' Tool Launcher opens a company with code <file.code-workspace>, and a work view by writing the request file given for it. DataPass keeps this list up to date from now on. It holds file paths and view names only, never a secret.` },
      "Copy the path", "Open the list");
    if (choice === "Copy the path") await clipboard.writeText(r.file);
    else if (choice === "Open the list") await vscode.window.showTextDocument(vscode.Uri.file(r.file), { preview: true });
  });

  // ------------------------------------------------------------------ launcher requests and startup view

  // One request at a time per project folder; one arriving meanwhile is read right after (never dropped).
  const busy = new Set<string>();
  const again = new Set<string>();
  const handleRequest = async (root: vscode.Uri): Promise<string | undefined> => {
    const key = root.toString();
    if (busy.has(key)) { again.add(key); return undefined; }
    busy.add(key);
    try {
      const r = await views.handleRequest(root);
      if (!r) return undefined;
      if (r.error) { report("Open work view request", [`${path.basename(root.fsPath)}: ${r.error}`]); void vscode.window.showWarningMessage(`DataPass did not open the requested work view: ${r.error}.`); return undefined; }
      if (r.notes.length) report(`Work view "${r.view!.name}" (requested by a launcher)`, r.notes);
      return r.view!.id;
    } catch (e) {
      report("Open work view request", [`${path.basename(root.fsPath)}: ${errorMessage(e)}`]);
      void vscode.window.showWarningMessage(`DataPass could not apply the requested work view: ${errorMessage(e)}`);
      return undefined;
    } finally {
      busy.delete(key);
      if (again.delete(key)) void handleRequest(root);
    }
  };
  const requests = vscode.workspace.createFileSystemWatcher(`**/${LOCAL_DIR}/${OPEN_VIEW_REQUEST_FILE}`);
  const onRequest = (uri: vscode.Uri) => {
    const root = projectRoots().find(r => isInside(r.fsPath, uri.fsPath) && path.relative(r.fsPath, uri.fsPath).split(path.sep).join("/") === `${LOCAL_DIR}/${OPEN_VIEW_REQUEST_FILE}`);
    if (root) void handleRequest(root);
  };
  requests.onDidCreate(onRequest);
  requests.onDidChange(onRequest);
  context.subscriptions.push(requests);

  return {
    company,
    switcherText: () => item.text,
    switcherTooltip: () => tooltipText(),
    startup: async () => {
      const file = workspaceFile();
      if (file && (text1(config().inspect<string>("company")?.workspaceValue) || projectRoots().length)) await register(file.fsPath);
      let applied: string | undefined;
      // A launcher's request (Power Ops) wins over the workspace's startup view.
      for (const root of projectRoots()) { applied = await handleRequest(root); if (applied) break; }
      const wanted = startupSetting();
      if (!applied && wanted) {
        const found = await locate(wanted);
        if (!found) {
          void vscode.window.showWarningMessage(`This workspace opens with the work view "${wanted}", but there is no work view with that name on this computer. Work views are saved per computer: arrange the window and save one with that name (DataPass: Save Work View…).`);
        } else {
          try { await applyAndReport(found.view, found.root, " (startup view of this workspace)"); applied = found.view.id; }
          catch (e) { report("Startup work view", [errorMessage(e)]); }
        }
      }
      update();
      await exportIfEnabled();
      return applied;
    }
  };
}
