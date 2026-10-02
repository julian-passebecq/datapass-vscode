/**
 * NAVSVC1 VS Code host of the NavigationService: context keys (`datapass.nav.*`), the commands
 * `datapass.nav.{up,down,left,right,home,back,forward,pickView}`, and the bridge with the session
 * selection. The selection is how the existing surfaces already move together: a tree or Workbench
 * click selects in the session → becomes a `go`; a location change selects in the session → the
 * tree reveals its node and the Workbench (address, Details) repaints.
 */
import * as vscode from "vscode";
import type { ProjectMap } from "../project/projectMap";
import { NavigationService } from "./navigationService";
import { type NavCommand, type NavLocation, type NavState, type ViewDef } from "./navTypes";
import { builtinCatalog } from "./viewPacks";
import { buildLadder, type ProjectLadder } from "./ladder";
import { FileHeads } from "./fileHeads";
import { locationLabel, locationOf, locationPath } from "./projectLadder";

/** The part of the session the host needs (kept small for tests). */
export interface NavSession {
  projectMap(): ProjectMap;
  selection(): { subproject?: string; component?: string };
  select(sel: { subproject?: string; component?: string }): Promise<void>;
  readonly onDidChange: vscode.Event<unknown>;
  readonly onDidChangeSelection: vscode.Event<unknown>;
  /** Local folder of a repository (a10: file heads for artifact kinds); absent = kinds from paths only. */
  repoFolder?(repoKey: string): vscode.Uri | undefined;
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

  constructor(readonly session: NavSession) {
    this.heads = new FileHeads((k) => session.repoFolder?.(k));
    this.ladder = this.buildLadder();
    this.nav = new NavigationService(this.ladder, builtinCatalog());
    this.nav.dispatch({ type: "go", location: locationOf(session.selection(), this.projectMap()) });
    const navSub = this.nav.onDidChange((e) => { void this.toSession(e.state.location); void this.updateKeys(); });
    this.subs.push({ dispose: () => navSub.dispose() },
      session.onDidChangeSelection(() => this.fromSession()),
      session.onDidChange(() => { this.heads.clear(); this.rebuild(); }));
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

  async pickView(): Promise<void> {
    const views = this.nav.views();
    if (!views.length) { void vscode.window.showInformationMessage("DataPass: no view is offered here."); return; }
    const pick = await vscode.window.showQuickPick(views.map((v) => ({ label: v.title, description: v.id === this.nav.state.viewId ? "current" : undefined, detail: v.description, id: v.id })),
      { placeHolder: `Views of ${this.label(this.nav.state.location)}` });
    if (pick) this.nav.dispatch({ type: "view", viewId: pick.id });
  }

  label(l: NavLocation): string { return this.ladder.entry(l)?.label ?? locationLabel(this.session.projectMap(), l); }

  /**
   * The project map the NavigationService's ladder walks: the same session getter `projectLadder`
   * reads, never a copy, so surfaces and bindings see exactly what `nav` navigates.
   */
  projectMap(): ProjectMap { return this.session.projectMap(); }

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
