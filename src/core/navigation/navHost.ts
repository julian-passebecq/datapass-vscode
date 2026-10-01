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
import { sameLocation, type NavCommand, type NavLocation, type NavState } from "./navTypes";
import { locationLabel, locationOf, locationPath, projectLadder, selectionOf } from "./projectLadder";

/** The part of the session the host needs (kept small for tests). */
export interface NavSession {
  projectMap(): ProjectMap;
  selection(): { subproject?: string; component?: string };
  select(sel: { subproject?: string; component?: string }): Promise<void>;
  readonly onDidChange: vscode.Event<unknown>;
  readonly onDidChangeSelection: vscode.Event<unknown>;
  /** V5 EXPLAIN1: project folder and parsed project files, for exports (optional; absent in tests). */
  readonly root?: vscode.Uri;
  readonly project?: { readonly options?: OptionsFile; readonly manifest?: { readonly project?: { readonly title?: string } } };
}

export const NAV_COMMANDS = ["up", "down", "left", "right", "home", "back", "forward", "pickView"] as const;
export type NavCommandId = (typeof NAV_COMMANDS)[number];

/** What a nav webview receives (`{type:"nav-state", state, views, labels}`): labels by node id, root → location path. */
export interface NavStateMessage {
  readonly type: "nav-state"; readonly state: NavState;
  readonly views: readonly { id: string; title: string; layout: string }[];
  readonly labels: Readonly<Record<string, string>>; readonly path: readonly NavLocation[];
}

export class NavHost implements vscode.Disposable {
  readonly nav: NavigationService;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly navSession: NavSession) {
    const map = () => navSession.projectMap();
    this.nav = new NavigationService(projectLadder(map));
    this.nav.dispatch({ type: "go", location: locationOf(navSession.selection(), map()) });
    const navSub = this.nav.onDidChange((e) => { void this.toSession(e.state.location); void this.updateKeys(); });
    this.subs.push({ dispose: () => navSub.dispose() },
      navSession.onDidChangeSelection(() => this.fromSession()),
      navSession.onDidChange(() => { this.nav.setLadder(projectLadder(map)); void this.updateKeys(); }));
    void this.updateKeys();
  }

  /** The session the host navigates (read-only; V5 EXPLAIN1 reads `root` and `project`). */
  get session(): NavSession { return this.navSession; }

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

  label(l: NavLocation): string { return locationLabel(this.navSession.projectMap(), l); }

  /** The message every nav webview renders. */
  message(): NavStateMessage {
    const s = this.nav.state;
    const path = locationPath(this.nav.ladder, s.location);
    const labels: Record<string, string> = {};
    for (const l of [...path, ...this.nav.ladder.children(s.location)]) labels[l.nodeId] = this.label(l);
    return { type: "nav-state", state: s, views: this.nav.views().map((v) => ({ id: v.id, title: v.title, layout: v.layout })), labels, path };
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.nav.dispose();
  }

  /** Tree or Workbench selection → `go`. */
  private fromSession(): void {
    const to = locationOf(this.navSession.selection(), this.navSession.projectMap());
    if (!sameLocation(to, this.nav.state.location)) this.nav.dispatch({ type: "go", location: to });
  }

  /** Location → session selection (the tree reveals, the Workbench repaints). The project root keeps the selection. */
  private async toSession(l: NavLocation): Promise<void> {
    if (l.level === "project") return;
    const map = this.navSession.projectMap();
    if (sameLocation(locationOf(this.navSession.selection(), map), l)) return;
    await this.navSession.select(selectionOf(l, this.nav.ladder));
  }

  private async updateKeys(): Promise<void> {
    const set = (k: string, v: unknown) => vscode.commands.executeCommand("setContext", `datapass.nav.${k}`, v);
    await Promise.all([set("active", true), set("level", this.nav.state.location.level), set("canUp", this.nav.canUp()),
      set("canDown", this.nav.canDown()), set("viewCount", this.nav.views().length)]);
  }
}
