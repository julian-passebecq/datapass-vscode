/**
 * NAVSVC1 VS Code host of the NavigationService: context keys (`datapass.nav.*`), the commands
 * `datapass.nav.{up,down,left,right,home,back,forward,pickView}`, and the bridge with the session
 * selection. The selection is how the existing surfaces already move together: a tree or Workbench
 * click selects in the session → becomes a `go`; a location change selects in the session → the
 * tree reveals its node and the Workbench (address, Details) repaints.
 */
import * as vscode from "vscode";
import type { ProjectMap } from "../project/projectMap";
import type { OptionsFile } from "../project/options";
import { NavigationService } from "./navigationService";
import { sameLocation, type NavCommand, type NavLocation, type NavState, type ViewDef } from "./navTypes";
import { builtinCatalog } from "./viewPacks";
import { buildLadder, type ProjectLadder } from "./ladder";
import { FileHeads } from "./fileHeads";
import { locationLabel, locationOf, locationPath } from "./projectLadder";
import type { UnderstandingEntry } from "../understanding/load";
import { hopState, type HopState } from "../../views/hopState";

/** The part of the session the host needs (kept small for tests). */
export interface NavSession {
  projectMap(): ProjectMap;
  selection(): { subproject?: string; component?: string };
  select(sel: { subproject?: string; component?: string }): Promise<void>;
  /** Folder of a repository on this computer (surfaces that run Git, e.g. NAVCHG1). */
  repoFolder?(key: string): vscode.Uri | undefined;
  readonly onDidChange: vscode.Event<unknown>;
  readonly onDidChangeSelection: vscode.Event<unknown>;
  /** V5 EXPLAIN1: project folder and parsed project files, for exports (optional; absent in tests). */
  readonly root?: vscode.Uri;
  readonly project?: { readonly options?: OptionsFile; readonly manifest?: { readonly project?: { readonly title?: string } } };
  /** Local folder of a repository (a10: file heads for artifact kinds); absent = kinds from paths only. */
  repoFolder?(repoKey: string): vscode.Uri | undefined;
  /** V5HOLE1: a file's Hop explanation (validated, never executed); absent = no `hop-steps` data. */
  understandingByPath?(repositoryKey: string, nativePath: string): Promise<UnderstandingEntry | undefined>;
  /** V5HOLE4: repository key and path of a project file (no read); absent = "Here" is the selection only. */
  understandingLocate?(uri: vscode.Uri): { repositoryKey: string; nativePath: string } | undefined;
}

export const NAV_COMMANDS = ["up", "down", "left", "right", "home", "back", "forward", "pickView"] as const;
export type NavCommandId = (typeof NAV_COMMANDS)[number];

/**
 * What a nav webview receives (`{type:"nav-state", state, views, labels}`): labels by node id, root → location path.
 * `views` are the full ViewDefs (bindings included): the renderer drops a view without them (a7).
 */
export interface NavStateMessage {
  readonly type: "nav-state"; readonly state: NavState;
  readonly views: readonly ViewDef[];
  readonly labels: Readonly<Record<string, string>>; readonly path: readonly NavLocation[];
}

export class NavHost implements vscode.Disposable {
  readonly nav: NavigationService;
  private readonly subs: vscode.Disposable[] = [];
  private readonly heads: FileHeads;
  private ladder: ProjectLadder;
  /** V5HOLE1: Hop state per file key (null: loading or none), cleared when the session changes. */
  private readonly hops = new Map<string, HopState | null>();
  private readonly hopLoaded = new vscode.EventEmitter<void>();
  /** A Hop explanation finished loading: views bound to `hop-steps` redraw. */
  readonly onDidLoadHop = this.hopLoaded.event;

  constructor(readonly session: NavSession) {
    this.heads = new FileHeads((k) => session.repoFolder?.(k));
    this.ladder = this.buildLadder();
    this.nav = new NavigationService(this.ladder, builtinCatalog());
    this.nav.dispatch({ type: "go", location: locationOf(session.selection(), this.projectMap()) });
    const navSub = this.nav.onDidChange((e) => { void this.toSession(e.state.location); void this.updateKeys(); });
    this.subs.push({ dispose: () => navSub.dispose() },
      session.onDidChangeSelection(() => this.fromSession()),
      session.onDidChange(() => { this.heads.clear(); this.hops.clear(); this.rebuild(); }), this.hopLoaded);
    this.warm();
    void this.updateKeys();
  }

  /** NAVLOC1 ladder over the session map; kinds from path + cached file heads (a10). */
  private buildLadder(): ProjectLadder {
    return buildLadder({ map: this.projectMap(), head: (k, p) => this.heads.get(k, p) });
  }

  private rebuild(): void {
    this.ladder = this.buildLadder();
    this.nav.setLadder(this.ladder);
    void this.updateKeys();
    this.warm();
  }

  /** Read the missing file heads in the background; rebuild once when some were read. */
  private warm(): void {
    void this.heads.warm(this.projectMap()).then((read) => { if (read) { this.ladder = this.buildLadder(); this.nav.setLadder(this.ladder); void this.updateKeys(); } }, () => undefined);
  }

  /** Commands and their palette-free behaviour; `pickView` offers the location's views. */
  registerCommands(): vscode.Disposable[] {
    const simple = (type: Exclude<NavCommandId, "pickView">): NavCommand => ({ type } as NavCommand);
    return NAV_COMMANDS.map((id) => vscode.commands.registerCommand(`datapass.nav.${id}`, async (arg?: unknown) => {
      if (id === "pickView") return this.pickView();
      // `down` from a webview or keybinding may name the child (the current selection).
      if (id === "down" && typeof arg === "string") return void this.nav.dispatch({ type: "down", childId: arg });
      this.nav.dispatch(simple(id));
    }));
  }

  /**
   * V5HOLE4: "Here" is the active editor. Its file, when the ladder knows it, is the place whose views are
   * offered (picking one goes there); otherwise the Navigator's location (the session selection). One-shot:
   * no continuous editor → Navigator sync.
   */
  async pickView(): Promise<void> {
    const here = this.editorLocation() ?? this.nav.state.location;
    const views = this.nav.viewsAt(here);
    if (!views.length) { void vscode.window.showInformationMessage("DataPass: no view is offered here."); return; }
    const atNav = sameLocation(here, this.nav.state.location);
    const pick = await vscode.window.showQuickPick(views.map((v) => ({ label: v.title, description: atNav && v.id === this.nav.state.viewId ? "current" : undefined, detail: v.description, id: v.id })),
      { placeHolder: `Views of ${this.label(here)}` });
    if (!pick) return;
    if (!sameLocation(here, this.nav.state.location)) this.nav.dispatch({ type: "go", location: here });
    this.nav.dispatch({ type: "view", viewId: pick.id });
  }

  /** The catalog artifact of the active editor's file (text or notebook), or undefined. Nothing is read or run. */
  private editorLocation(): NavLocation | undefined {
    const w = vscode.window as { activeTextEditor?: { document: { uri: vscode.Uri } }; activeNotebookEditor?: { notebook: { uri: vscode.Uri } } };
    const uri = [w.activeTextEditor?.document.uri, w.activeNotebookEditor?.notebook.uri].find((u) => u?.scheme === "file");
    const at = uri && this.session.understandingLocate?.(uri);
    return at ? this.ladder.locate(at.repositoryKey, at.nativePath) : undefined;
  }

  /** V5HOLE1: the Hop state of the file at a place, synchronously from the cache; a miss loads it and fires `onDidLoadHop`. */
  hop(l: NavLocation): HopState | undefined {
    const file = this.ladder.entry(l)?.file;
    const load = this.session.understandingByPath?.bind(this.session);
    if (!file || !load) return undefined;
    const k = `${file.repoKey}:${file.repoPath}`;
    if (this.hops.has(k)) return this.hops.get(k) ?? undefined;
    this.hops.set(k, null);
    void load(file.repoKey, file.repoPath).then((entry) => {
      if (!entry || this.hops.get(k) !== null) return;
      this.hops.set(k, hopState({ fileName: file.repoPath.split("/").pop() ?? file.repoPath, located: { repositoryKey: file.repoKey, nativePath: file.repoPath },
        entry, hasProject: true, workOrdersEnabled: false, canGoBack: false }));
      this.hopLoaded.fire();
    }, () => undefined);
    return undefined;
  }

  label(l: NavLocation): string { return this.ladder.entry(l)?.label ?? locationLabel(this.session.projectMap(), l); }

  /**
   * The project map the NavigationService's ladder walks: the same session getter `projectLadder`
   * reads, never a copy, so surfaces and bindings see exactly what `nav` navigates.
   */
  projectMap(): ProjectMap { return this.session.projectMap(); }

  /** A repository's folder on this computer, when the session knows it. */
  repoFolder(key: string): vscode.Uri | undefined { return this.session.repoFolder?.(key); }

  /** The message every nav webview renders. */
  message(): NavStateMessage {
    const s = this.nav.state;
    const path = locationPath(this.nav.ladder, s.location);
    const labels: Record<string, string> = {};
    for (const l of [...path, ...this.nav.ladder.children(s.location)]) labels[l.nodeId] = this.label(l);
    return { type: "nav-state", state: s, views: this.nav.views(), labels, path };
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.nav.dispose();
  }

  /** Tree or Workbench selection → `go`. */
  private fromSession(): void {
    const to = locationOf(this.session.selection(), this.session.projectMap());
    const here = this.nav.state.location;
    if (to.level === here.level && to.nodeId === here.nodeId) return;
    if (to.level === "project" && here.level === "project") return;
    // A component/sub-project selection that the current file, step or operation already sits in keeps it.
    const e = this.ladder.entry(here);
    if (to.level === "artifact" && e?.componentId === to.nodeId && here.nodeId !== to.nodeId && here.level !== "subproject") return;
    this.nav.dispatch({ type: "go", location: to.level === "project" ? this.ladder.root() : to });
  }

  /** Location → session selection (the tree reveals, the Workbench repaints). The project root keeps the selection. */
  private async toSession(l: NavLocation): Promise<void> {
    if (l.level === "project") return;
    const e = this.ladder.entry(l);
    const sel = { subproject: e?.subprojectId, component: e?.componentId };
    const cur = this.session.selection();
    if (cur.subproject === sel.subproject && cur.component === sel.component) return;
    await this.session.select(sel);
  }

  private async updateKeys(): Promise<void> {
    const set = (k: string, v: unknown) => vscode.commands.executeCommand("setContext", `datapass.nav.${k}`, v);
    await Promise.all([set("active", true), set("level", this.nav.state.location.level), set("canUp", this.nav.canUp()),
      set("canDown", this.nav.canDown()), set("viewCount", this.nav.views().length)]);
  }
}
