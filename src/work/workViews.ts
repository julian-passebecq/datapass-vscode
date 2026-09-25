/**
 * Work views on the VS Code side (0.17): read and write `.datapass/local/views.json`, capture the
 * current window as a view, and apply a view in one call.
 *
 * What VS Code does, verified in desktop VS Code before this was written and kept under test in
 * tests/integration/windowFlows.ts:
 *  - `vscode.getEditorLayout` / `vscode.setEditorLayout` describe and arrange the window that has the
 *    focus (the main window or a floating one), with sizes reported in pixels and accepted as
 *    weights. Views are captured and applied with the main window focused; DataPass says so when a
 *    floating window has the focus instead of arranging the wrong window.
 *  - Tab groups are numbered main window first, then floating windows.
 *  - Removing groups merges their editors into the remaining ones, and opening a file in a column
 *    that does not exist creates empty groups. So a view first closes the main window's tabs that
 *    are neither modified nor pinned (never unsaved work), then sets the grid, then opens its files.
 *  - `workbench.action.moveEditorToNewWindow` moves the active editor into a floating window.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import type { WorkSession } from "./session";
import { layoutLeaves, type WorkbenchHost } from "../views/workbench";
import { LOCAL_DIR, writeLocal } from "../core/workspace/loader";
import { isInside, vetRelativePath } from "../core/exchange/pathSafety";
import { errorMessage, UserFacingError } from "./io";
import {
  emptyWorkViews, findView, MAX_TABS, MAX_VIEWS, normalizeLayout, OPEN_VIEW_REQUEST_FILE, PANE_VIEW_IDS, PANES, parseOpenViewRequest, parseWorkViews,
  SECONDARY_PANES, serializeWorkViews, viewIdFor, viewProblem, WORK_VIEWS_FILE,
  type FolderTab, type Pane, type RepoTab, type ViewGroup, type ViewTab, type WorkView, type WorkViewsFile
} from "../core/windows/workViews";

export interface StoredViews { root: vscode.Uri; title: string; file: WorkViewsFile; error?: string }

const isWorkbenchTab = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputWebview && /datapass\.workbench$/.test(tab.input.viewType);
const tabLabel = (t: RepoTab | FolderTab) => `${"repo" in t ? (t.repo === "." ? "" : `${t.repo}/`) : `${t.folder}/`}${t.path}`;

export class WorkViews implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires when views are saved, renamed, deleted or applied. */
  readonly onDidChange = this.emitter.event;
  private applied?: { root: string; id: string };

  constructor(private readonly session: WorkSession, private readonly host: WorkbenchHost, private readonly panes: () => Pane[]) {}

  dispose(): void { this.emitter.dispose(); }

  /** The view applied (or saved) last in this window, while nothing else was applied since. */
  lastApplied(): { root: string; id: string } | undefined { return this.applied; }

  // ------------------------------------------------------------------ storage

  /** Views stored in a project folder (default: this window's project). */
  async load(root = this.session.root): Promise<{ file: WorkViewsFile; error?: string }> {
    if (!root) return { file: emptyWorkViews() };
    const uri = vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), WORK_VIEWS_FILE);
    let stat: vscode.FileStat;
    try { stat = await vscode.workspace.fs.stat(uri); } catch { return { file: emptyWorkViews() }; }
    if (stat.type & vscode.FileType.SymbolicLink) return { file: emptyWorkViews(), error: `${WORK_VIEWS_FILE} is a symbolic link; DataPass does not follow it` };
    try { return { file: parseWorkViews(await vscode.workspace.fs.readFile(uri)) }; }
    catch (e) { return { file: emptyWorkViews(), error: errorMessage(e) }; }
  }

  /** Every DataPass project folder of this window with its views (a window can hold several projects). */
  async all(): Promise<StoredViews[]> {
    const current = this.session.root;
    const roots = this.session.projectRootCandidates().length ? [...this.session.projectRootCandidates()] : current ? [current] : [];
    const out: StoredViews[] = [];
    for (const root of roots) {
      const { file, error } = await this.load(root);
      const title = root.toString() === current?.toString() ? this.session.project.manifest?.project.title ?? path.basename(root.fsPath) : path.basename(root.fsPath);
      out.push({ root, title, file, error });
    }
    return out;
  }

  private async write(root: vscode.Uri, file: WorkViewsFile): Promise<void> {
    await writeLocal(root, WORK_VIEWS_FILE, serializeWorkViews(file));
    this.emitter.fire();
  }

  private async editable(root: vscode.Uri | undefined): Promise<{ root: vscode.Uri; file: WorkViewsFile }> {
    if (!root) throw new UserFacingError("Open a DataPass project folder first: work views are kept in its .datapass/local folder.");
    const { file, error } = await this.load(root);
    if (error) throw new UserFacingError(`.datapass/local/${WORK_VIEWS_FILE} cannot be read (${error}). Fix it or delete it, then try again.`);
    return { root, file };
  }

  /** Save the current window as a view (replacing the view with that id or name, if any). */
  async save(name: string, replaceId?: string): Promise<{ view: WorkView; notes: string[]; replaced: boolean }> {
    const { root, file } = await this.editable(this.session.root);
    const existing = replaceId ? file.views.find(v => v.id === replaceId) : file.views.find(v => v.name.toLowerCase() === name.toLowerCase());
    if (!existing && file.views.length >= MAX_VIEWS) throw new UserFacingError(`A project keeps at most ${MAX_VIEWS} work views; delete one first.`);
    const { view, notes } = await this.capture(name, existing?.id ?? viewIdFor(name, file.views.map(v => v.id)));
    await this.write(root, { ...file, views: existing ? file.views.map(v => (v.id === existing.id ? view : v)) : [...file.views, view] });
    this.applied = { root: root.toString(), id: view.id };
    return { view, notes, replaced: Boolean(existing) };
  }

  /** Rename a view; its id stays, so a workspace file's startup view keeps working. */
  async rename(id: string, name: string, root = this.session.root): Promise<WorkView> {
    const { root: r, file } = await this.editable(root);
    const view = file.views.find(v => v.id === id);
    if (!view) throw new UserFacingError(`No work view "${id}".`);
    if (file.views.some(v => v.id !== id && v.name.toLowerCase() === name.toLowerCase())) throw new UserFacingError(`A work view is already called "${name}".`);
    const renamed = { ...view, name };
    await this.write(r, { ...file, views: file.views.map(v => (v.id === id ? renamed : v)) });
    return renamed;
  }

  async remove(id: string, root = this.session.root): Promise<void> {
    const { root: r, file } = await this.editable(root);
    if (!file.views.some(v => v.id === id)) throw new UserFacingError(`No work view "${id}".`);
    if (this.applied?.id === id && this.applied.root === r.toString()) this.applied = undefined;
    await this.write(r, { ...file, views: file.views.filter(v => v.id !== id) });
  }

  // ------------------------------------------------------------------ capture

  /**
   * VS Code arranges the focused window: refuse when a floating window has the focus. Tab groups
   * beyond the focused grid exist only when floating windows exist; then the active group, the
   * active text editor or an active floating Workbench tells which window has the focus.
   */
  private mainWindowFocused(leaves: number): boolean {
    if (vscode.window.tabGroups.all.length <= leaves) return true;
    const panel = this.host.panel();
    const columns = [vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.window.activeTextEditor?.viewColumn ?? 0, panel?.active ? panel.viewColumn ?? 0 : 0];
    return !columns.some(c => c > leaves);
  }

  private requireMainWindow(leaves: number): void {
    if (!this.mainWindowFocused(leaves)) throw new UserFacingError("A floating window has the focus, and VS Code arranges the window that has the focus. Click in the main VS Code window, then try again.");
  }

  async capture(name: string, id: string): Promise<{ view: WorkView; notes: string[] }> {
    const notes: string[] = [];
    const view: WorkView = { id, name, savedAt: new Date().toISOString() };
    const sel = this.session.selection();
    if (sel.subproject || sel.component) view.selection = { ...(sel.subproject ? { subproject: sel.subproject } : {}), ...(sel.component ? { component: sel.component } : {}) };

    const raw = await vscode.commands.executeCommand("vscode.getEditorLayout");
    const leaves = layoutLeaves(raw);
    this.requireMainWindow(leaves);
    const layout = normalizeLayout(raw);
    const groups = [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
    let skipped = 0;
    if (layout && groups.length >= leaves) {
      const viewGroups: ViewGroup[] = [];
      let seenWorkbench = false;
      for (const g of groups.slice(0, leaves)) {
        const tabs: ViewTab[] = [];
        let active: number | undefined;
        for (const tab of g.tabs) {
          const t = this.tabOf(tab);
          if (!t || tabs.length >= MAX_TABS || ("workbench" in t && seenWorkbench)) { skipped++; continue; }
          if ("workbench" in t) seenWorkbench = true;
          if (tab.isActive) active = tabs.length;
          tabs.push(t);
        }
        viewGroups.push({ tabs, ...(active !== undefined ? { active } : {}) });
      }
      const activeGroup = vscode.window.tabGroups.activeTabGroup.viewColumn - 1;
      view.editors = { layout, groups: viewGroups, ...(activeGroup >= 0 && activeGroup < viewGroups.length ? { activeGroup } : {}) };
    } else {
      notes.push("The editor grid has more than 9 groups or 3 levels: the open files were not saved in this view.");
    }
    const panel = this.host.panel();
    if (panel?.viewColumn && panel.viewColumn > leaves) view.floatingWorkbench = true;
    const floatingFiles = groups.slice(leaves).flatMap(g => g.tabs).filter(t => !isWorkbenchTab(t)).length;
    if (floatingFiles) notes.push(`${floatingFiles} tab(s) in floating windows are not part of a view (only the Workbench tab can float in a view).`);
    if (skipped) notes.push(`${skipped} tab(s) were not saved: diffs, terminals, previews, unsaved files, or files outside this window's repositories and folders.`);
    view.panes = this.panes();
    const full = this.session.diagramUi("full"), map = this.session.diagramUi("map");
    if (full || map) view.diagram = { ...(full ? { full } : {}), ...(map ? { map } : {}) };
    const preview = this.session.previewRequest();
    if (preview) view.preview = preview;
    const problem = viewProblem(view);
    if (problem) throw new Error(`The captured view is not valid (${problem}).`);
    return { view, notes };
  }

  /** A tab as a view stores it: the Workbench, or a file as a path inside a repository or a workspace folder. */
  private tabOf(tab: vscode.Tab): ViewTab | undefined {
    if (isWorkbenchTab(tab)) return { workbench: true };
    const input = tab.input;
    const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputNotebook || input instanceof vscode.TabInputCustom ? input.uri : undefined;
    if (!uri || uri.scheme !== "file") return undefined;
    // The repository that holds the file (the deepest one, for a repository cloned inside another).
    let best: { key: string; folder: string } | undefined;
    for (const r of this.session.projectMap().repositories) {
      const folder = this.session.repoFolder(r.key)?.fsPath;
      if (folder && isInside(folder, uri.fsPath) && (!best || folder.length > best.folder.length)) best = { key: r.key, folder };
    }
    const relative = (base: string) => { const vet = vetRelativePath(path.relative(base, uri.fsPath).split(path.sep).join("/")); return vet.ok ? vet.relative : undefined; };
    if (best) { const p = relative(best.folder); return p ? { repo: best.key, path: p } : undefined; }
    const wf = vscode.workspace.getWorkspaceFolder(uri);
    if (wf && !/[/\\\x00-\x1f]/.test(wf.name)) { const p = relative(wf.uri.fsPath); return p ? { folder: wf.name, path: p } : undefined; }
    return undefined;
  }

  // ------------------------------------------------------------------ apply

  /** Apply a view stored in `root` (switching this window to that project folder first if needed). Returns notes. */
  async apply(view: WorkView, root: vscode.Uri): Promise<string[]> {
    const notes: string[] = [];
    const leaves = layoutLeaves(await vscode.commands.executeCommand("vscode.getEditorLayout"));
    // With a floating window focused, VS Code would arrange that window: the editors are left alone
    // (and said so), everything else is applied.
    const mainFocused = this.mainWindowFocused(leaves);
    if (this.session.root?.toString() !== root.toString()) await this.session.chooseProjectRoot(root);

    const map = this.session.projectMap();
    const sp = view.selection?.subproject, c = view.selection?.component;
    const spOk = !sp || map.subprojects.some(s => s.id === sp);
    const cOk = !c || map.components.some(x => x.id === c);
    if (!spOk) notes.push(`The sub-project "${sp}" is no longer in the project.`);
    if (!cOk) notes.push(`The component "${c}" is no longer in the project.`);
    await this.session.select({ subproject: spOk ? sp : undefined, component: cOk ? c : undefined });

    const options = this.session.project.options;
    const scenario = view.preview?.scenario, picks = view.preview?.picks ?? [];
    const scenarioOk = scenario && options && (scenario === "decided" || options.scenarios?.some(s => s.id === scenario));
    const validPicks = options ? picks.filter(p => { const [d, o] = p.split("="); return options.decisions.some(x => x.id === d && x.options.some(y => y.id === o)); }) : [];
    if ((scenario && !scenarioOk) || validPicks.length < picks.length) notes.push("The previewed architecture no longer matches .datapass/options.json; the diagram shows the current one.");
    await this.session.setPreview(scenarioOk ? { scenario } : validPicks.length ? { picks: validPicks } : undefined);

    if (view.diagram) await this.host.applyUi(view.diagram);
    if (view.panes) await this.applyPanes(view.panes);
    if (view.editors && mainFocused) await this.applyEditors(view, leaves, notes);
    else if (view.editors) notes.push("The open files and the editor grid were not changed: a floating window has the focus, and VS Code arranges the window that has it. Click in the main VS Code window and apply the view again.");

    this.applied = { root: root.toString(), id: view.id };
    this.emitter.fire();
    return notes;
  }

  private async applyPanes(panes: readonly Pane[]): Promise<void> {
    const visible = new Set(this.panes());
    for (const p of PANES) if (panes.includes(p)) await vscode.commands.executeCommand(`${PANE_VIEW_IDS[p]}.focus`);
    // Hide what the view did not show, when a DataPass view is what fills that area.
    if (!panes.includes("architecture") && visible.has("architecture")) await vscode.commands.executeCommand("workbench.action.closePanel");
    if (!SECONDARY_PANES.some(p => panes.includes(p)) && SECONDARY_PANES.some(p => visible.has(p))) await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  }

  private async applyEditors(view: WorkView, leaves: number, notes: string[]): Promise<void> {
    const e = view.editors!;
    const inGroup = e.groups.findIndex(g => g.tabs.some(t => "workbench" in t));
    const keepWorkbench = inGroup >= 0 || Boolean(view.floatingWorkbench);
    const mainTabs = vscode.window.tabGroups.all.filter(g => g.viewColumn <= leaves).flatMap(g => g.tabs);
    const closable = mainTabs.filter(t => !t.isDirty && !t.isPinned && !(keepWorkbench && isWorkbenchTab(t)));
    if (closable.length) await vscode.window.tabGroups.close(closable, true);
    const kept = mainTabs.filter(t => (t.isDirty || t.isPinned) && !isWorkbenchTab(t)).length;
    if (kept) notes.push(`${kept} unsaved or pinned tab(s) stayed open.`);
    // A view without the Workbench closes a floating one too (a main-window one was closed above).
    const panel = this.host.panel();
    if (!keepWorkbench && panel) panel.dispose();

    await vscode.commands.executeCommand("vscode.setEditorLayout", e.layout);
    const uris = new Map<string, vscode.Uri>();
    for (let i = 0; i < e.groups.length; i++) {
      const g = e.groups[i]!;
      const column = i + 1;
      const active = g.active ?? g.tabs.length - 1;
      // The active tab is opened last, so it ends up shown in its group.
      const order = [...g.tabs.keys()].filter(j => j !== active).concat(g.tabs[active] ? [active] : []);
      for (const j of order) {
        const t = g.tabs[j]!;
        if ("workbench" in t) { this.host.openPanel(column, view.diagram?.full?.view, undefined, true); continue; }
        const uri = await this.resolveTab(t, notes);
        if (!uri) continue;
        uris.set(`${i}:${j}`, uri);
        try { await vscode.commands.executeCommand("vscode.open", uri, { viewColumn: column, preview: false, preserveFocus: true }); }
        catch (err) { notes.push(`${tabLabel(t)} could not be opened (${errorMessage(err)}).`); }
      }
    }
    // Focus where the person was working.
    const ag = e.activeGroup;
    const g = ag !== undefined ? e.groups[ag] : undefined;
    const activeIndex = g ? g.active ?? g.tabs.length - 1 : -1;
    const focusTab = g?.tabs[activeIndex];
    if (focusTab && "workbench" in focusTab) this.host.panel()?.reveal(ag! + 1, false);
    else if (focusTab && uris.get(`${ag}:${activeIndex}`)) await vscode.commands.executeCommand("vscode.open", uris.get(`${ag}:${activeIndex}`), { viewColumn: ag! + 1, preview: false, preserveFocus: false });

    // Last, since the move gives the focus to the floating window.
    if (view.floatingWorkbench) {
      const current = this.host.panel();
      if (current && await this.host.isFloating()) { if (view.diagram?.full?.view) void current.webview.postMessage({ type: "show", view: view.diagram.full.view }); }
      else {
        try { await this.host.openFloating(view.diagram?.full?.view); }
        catch (err) { notes.push(`The Workbench could not move into its own window: ${errorMessage(err)}`); }
      }
    }
  }

  /** The file behind a saved tab, when it exists on this machine. */
  private async resolveTab(t: RepoTab | FolderTab, notes: string[]): Promise<vscode.Uri | undefined> {
    const vet = vetRelativePath(t.path);
    if (!vet.ok) { notes.push(`${t.path} was skipped (${vet.reason}).`); return undefined; }
    const base = "repo" in t ? this.session.repoFolder(t.repo) : vscode.workspace.workspaceFolders?.find(f => f.name === t.folder)?.uri;
    if (!base) { notes.push("repo" in t ? `${tabLabel(t)}: the repository "${t.repo}" is not cloned on this machine.` : `${tabLabel(t)}: the folder "${t.folder}" is not open in this window.`); return undefined; }
    const uri = vscode.Uri.joinPath(base, ...vet.relative.split("/"));
    try {
      if (!((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File)) { notes.push(`${tabLabel(t)} is not a file.`); return undefined; }
    } catch { notes.push(`${tabLabel(t)} no longer exists.`); return undefined; }
    return uri;
  }

  // ------------------------------------------------------------------ launcher requests (Power Ops)

  /**
   * Apply the view a launcher asked for in `root/.datapass/local/open-view.json`. The request is
   * deleted whatever it says (one shot); a stale or unknown one is reported, never guessed.
   */
  async handleRequest(root: vscode.Uri): Promise<{ view?: WorkView; notes: string[]; error?: string } | undefined> {
    const uri = vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), OPEN_VIEW_REQUEST_FILE);
    let bytes: Uint8Array;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.SymbolicLink || stat.size > 4096) { await this.deleteQuietly(uri); return { notes: [], error: "the request is a symbolic link or larger than 4 KiB" }; }
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch { return undefined; }
    await this.deleteQuietly(uri);
    const req = parseOpenViewRequest(bytes, Date.now());
    if (!req.ok) return { notes: [], error: req.reason };
    const view = findView((await this.load(root)).file, req.view);
    if (!view) return { notes: [], error: `there is no work view "${req.view}" in ${path.basename(root.fsPath)}` };
    return { view, notes: await this.apply(view, root) };
  }

  private async deleteQuietly(uri: vscode.Uri): Promise<void> {
    try { await vscode.workspace.fs.delete(uri, { useTrash: false }); } catch { /* already gone */ }
  }
}
