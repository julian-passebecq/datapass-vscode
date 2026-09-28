/**
 * V3-SHELL (vision §2.1): navigation and shell.
 *
 * - Tree lenses: buttons in the Project view's title bar switch what the left tree lists (Project,
 *   Architecture, Git, AI / Work orders, Readiness); "Natural tree" shows VS Code's Explorer. The
 *   chosen lens is remembered per workspace (workspaceState).
 * - The bottom-panel Architecture view is off by default (`datapass.layout.architectureInPanel`).
 * - Rail mode: the DataPass secondary side bar becomes a thin column of buttons (the `datapass.rail`
 *   view, a native tree since V1.1.x-POLISH-3) and expands back to the full panel, or to the one view
 *   a button names. VS Code gives extensions no way to set a side bar's width: the rail narrows it with
 *   VS Code's own "Decrease Current View Size" steps down to VS Code's minimum of 170 px, and "Expand"
 *   gives a fixed width back (see core/windows/railFold.ts for what stays impossible).
 * - The lens shown is named in the tree's first row and in the status bar (V1.1.x-POLISH-3), and a
 *   one-time hint points to the DataPass side bar when a project opens while it is not on screen.
 * - Close buttons on the panel they close, through VS Code's own close commands.
 */
import * as vscode from "vscode";
import { LENS_CONTEXT_KEY, LENS_INFO, LensStore, TREE_HINT_KEY, TREE_LENSES, lensStatus, parseLens, shouldHintTree, type TreeLens } from "../core/windows/treeLens";
import { RAIL_BUTTON_VIEW, soloContext, type RailPanelView } from "../core/windows/railSolo";
import { EXPAND_STEPS, FOLD_STEPS, NARROW_FOCUSED, WIDEN_FOCUSED } from "../core/windows/railFold";
import type { ProjectTreeProvider } from "../views/projectTree";
import { RAIL_BUTTONS, RAIL_BUTTON_IDS, railButtonCommand } from "../views/railHtml";
import { output } from "./io";

export const RAIL_CONTEXT_KEY = "datapass.rail";
const RAIL_STATE_KEY = "datapass.rail";
/** Whether this window's rail was narrowed by DataPass (then Expand gives width back). */
const RAIL_FOLDED_KEY = "datapass.rail.folded";
export const PANEL_CONTEXT_KEY = "datapass.layout.architectureInPanel";

/** V3-SHELL: whether the bottom-panel Architecture view is switched on. */
export const architectureInPanel = (): boolean => vscode.workspace.getConfiguration("datapass.layout").get<boolean>("architectureInPanel", false) === true;

/** Show the architecture diagram: the bottom-panel view when it is on, else the Workbench tab. */
export async function showArchitecture(preserveFocus = false): Promise<void> {
  if (architectureInPanel()) await vscode.commands.executeCommand("datapass.architecture.focus", preserveFocus ? { preserveFocus } : undefined);
  else await vscode.commands.executeCommand("datapass.openWorkbench");
}

export class ShellService implements vscode.Disposable {
  readonly lenses: LensStore;
  private readonly subs: vscode.Disposable[] = [];
  private railView?: vscode.TreeView<string>;
  private readonly railChanged = new vscode.EventEmitter<void>();
  private resizing = false;
  /** V3-POLISH-2: the rail buttons to show (all until setRailButtons is called). */
  private railShown: () => readonly string[] = () => RAIL_BUTTON_IDS;
  /** V1.1.x-POLISH-3: finds and opens the DAG file for the rail's DAG button (the Airflow DAG view). */
  private dagOpener: () => Promise<vscode.Uri | undefined> = async () => undefined;
  /** V1.1.x-POLISH-3: the panel view a rail button unfolded alone (undefined: the full panel). */
  private soloView?: RailPanelView;
  /** V1.1.x-POLISH-3: the lens, named from any view. */
  readonly lensItem: vscode.StatusBarItem;

  constructor(private readonly context: vscode.ExtensionContext, private readonly tree: ProjectTreeProvider, private readonly treeView: vscode.TreeView<unknown>) {
    this.lenses = new LensStore(context.workspaceState);
    tree.setLenses(this.lenses);
    this.lensItem = vscode.window.createStatusBarItem("datapass.treeLens", vscode.StatusBarAlignment.Left, 21.5);
    this.lensItem.name = "DataPass tree";
    this.lensItem.command = "datapass.tree.chooseLens";
    this.paintLensItem();
    this.lensItem.show();
    this.subs.push(this.lensItem);
    void vscode.commands.executeCommand("setContext", LENS_CONTEXT_KEY, this.lenses.current);
    void vscode.commands.executeCommand("setContext", RAIL_CONTEXT_KEY, this.rail());
    void this.syncPanelKey();
    this.subs.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.layout.architectureInPanel")) void this.syncPanelKey(); }));
  }

  dispose(): void { for (const s of this.subs) s.dispose(); this.railChanged.dispose(); }

  // ---------------------------------------------------------------- lenses

  lens(): TreeLens { return this.lenses.current; }

  async chooseLens(lens: TreeLens): Promise<void> {
    await this.lenses.choose(lens);
    this.lensShown();
    if (!this.treeView.visible) await vscode.commands.executeCommand("datapass.project.focus");
  }

  /** The tree shows another lens (chosen, or followed): context key for the toggled buttons, repaint. */
  lensShown(): void {
    this.tree.lensChanged();
    this.paintLensItem();
  }

  private paintLensItem(): void {
    const s = lensStatus(this.lenses.current);
    this.lensItem.text = s.text;
    this.lensItem.tooltip = s.tooltip;
  }

  /** The status-bar text now (also read by the desktop tests). */
  lensStatusText(): string { return this.lensItem.text; }

  /** Whether the DataPass tree is on screen. */
  treeVisible(): boolean { return this.treeView.visible; }

  /**
   * V1.1.x-POLISH-3: once per install, when a DataPass project is open and its tree is not on screen
   * (the Explorer shows), point to the DataPass side bar. Returns whether the hint showed.
   */
  async hintTree(readable: boolean): Promise<boolean> {
    const shown = this.context.globalState.get<boolean>(TREE_HINT_KEY) === true;
    if (!shouldHintTree({ readable, treeVisible: this.treeView.visible, shown })) return false;
    await this.context.globalState.update(TREE_HINT_KEY, true);
    const show = "Show the DataPass tree";
    const pick = await vscode.window.showInformationMessage(
      `DataPass: this project's tree is in the DataPass side bar (it lists ${LENS_INFO[this.lenses.current].label} now). The "DataPass tree" item in the status bar opens it from anywhere.`,
      show
    );
    if (pick === show) await vscode.commands.executeCommand("datapass.project.focus");
    return true;
  }

  // ---------------------------------------------------------------- bottom panel

  architectureInPanel(): boolean { return architectureInPanel(); }

  private async syncPanelKey(): Promise<void> {
    await vscode.commands.executeCommand("setContext", PANEL_CONTEXT_KEY, this.architectureInPanel());
  }

  async toggleArchitecturePanel(on?: boolean): Promise<void> {
    const next = on ?? !this.architectureInPanel();
    await vscode.workspace.getConfiguration("datapass.layout").update("architectureInPanel", next, vscode.ConfigurationTarget.Global);
    await this.syncPanelKey();
    if (next) await vscode.commands.executeCommand("datapass.architecture.focus");
  }

  // ---------------------------------------------------------------- rail

  /** The rail shows `shown()` and repaints whenever one of `changes` fires (mode, project modules). */
  setRailButtons(shown: () => readonly string[], changes: ReadonlyArray<vscode.Event<unknown>>): void {
    this.railShown = shown;
    for (const change of changes) this.subs.push(change(() => this.paintRail()));
    this.paintRail();
  }

  /** The rail buttons shown now (also read by the desktop tests). */
  railButtons(): readonly string[] { return this.railShown(); }

  private paintRail(): void { this.railChanged.fire(); }

  rail(): boolean { return this.context.workspaceState.get<boolean>(RAIL_STATE_KEY) === true; }
  railResolved(): boolean { return Boolean(this.railView?.visible); }

  /**
   * V1.1.x-POLISH-3: the rail is a native tree (it was a webview): with the keyboard in a tree, VS Code
   * counts the secondary side bar as focused, so its "Current View Size" commands can narrow it; icons
   * and colours follow the light or dark theme by themselves.
   */
  railProvider(): vscode.TreeDataProvider<string> {
    return {
      onDidChangeTreeData: this.railChanged.event,
      getChildren: (id?: string) => id ? [] : RAIL_BUTTON_IDS.filter(b => this.railShown().includes(b)),
      getTreeItem: (id: string) => {
        const b = RAIL_BUTTONS.find(x => x.id === id)!;
        const item = new vscode.TreeItem(b.label, vscode.TreeItemCollapsibleState.None);
        item.id = `rail:${b.id}`;
        item.iconPath = new vscode.ThemeIcon(b.icon);
        item.tooltip = b.title;
        item.accessibilityInformation = { label: `${b.label}: ${b.title}` };
        const c = railButtonCommand(b.id);
        item.command = { command: c.command, title: b.label, arguments: c.args };
        return item;
      }
    };
  }

  attachRail(view: vscode.TreeView<string>): void { this.railView = view; }

  /** One rail button, by id (the desktop tests press them this way; the tree runs the same commands). */
  async onRailMessage(m: unknown): Promise<void> {
    const msg = m as { type?: unknown; id?: unknown };
    if (msg?.type !== "rail" || typeof msg.id !== "string" || !this.railShown().includes(msg.id)) return;
    switch (msg.id) {
      case "expand": return this.expand();
      // V1.1.x-POLISH-3: each button unfolds the view it names, alone (not the whole stack, AI first).
      case "details": return this.expand("datapass.details", RAIL_BUTTON_VIEW.details);
      case "ai": return this.expand("datapass.aiExchange", RAIL_BUTTON_VIEW.ai);
      case "git": return this.chooseLens("git");
      // V3-POLISH-1: unfold the panel on the Airflow DAG view, then read the active editor.
      // V1.1.x-POLISH-3: find the DAG first (the active file, else the project's), then unfold the DAG view alone.
      case "airflow": return this.showDag();
      case "copyForAi": await vscode.commands.executeCommand("datapass.copyForAi"); return;
      case "importFromAi": await vscode.commands.executeCommand("datapass.importFromAi"); return;
      case "workViews": await vscode.commands.executeCommand("datapass.openSwitcher"); return;
      case "ownWindow": await vscode.commands.executeCommand("datapass.openWorkbenchFloating"); return;
    }
  }

  setDagOpener(open: () => Promise<vscode.Uri | undefined>): void { this.dagOpener = open; }

  /** The panel view shown alone, if any (desktop tests). */
  solo(): RailPanelView | undefined { return this.soloView; }

  private async setSolo(view: RailPanelView | undefined): Promise<void> {
    this.soloView = view;
    for (const [key, value] of Object.entries(soloContext(view))) await vscode.commands.executeCommand("setContext", key, value);
  }

  /** The rail's DAG button: nothing unfolds when the project has no DAG (the opener says so). */
  async showDag(): Promise<void> {
    const uri = await this.dagOpener();
    if (!uri) return;
    await this.expand("datapass.airflowDag", RAIL_BUTTON_VIEW.airflow);
    await vscode.commands.executeCommand("datapass.showAirflowDag");
  }

  private async setRail(on: boolean): Promise<void> {
    await this.context.workspaceState.update(RAIL_STATE_KEY, on);
    await vscode.commands.executeCommand("setContext", RAIL_CONTEXT_KEY, on);
  }

  /** Rail mode: the full panel folds into the column of buttons, and the side bar narrows to VS Code's minimum. */
  async collapse(): Promise<void> {
    if (this.resizing) return;
    this.resizing = true;
    try {
      if (!this.rail()) await this.setRail(true);
      await this.setSolo(undefined);
      // The keyboard in the rail tree: the secondary side bar is the focused part VS Code resizes.
      await vscode.commands.executeCommand("datapass.rail.focus");
      const can = (await vscode.commands.getCommands(true)).includes(NARROW_FOCUSED);
      if (can) for (let i = 0; i < FOLD_STEPS; i += 1) await vscode.commands.executeCommand(NARROW_FOCUSED);
      await this.context.workspaceState.update(RAIL_FOLDED_KEY, can);
      output().appendLine(`[rail] folded${can ? "" : " (no resize command: the width stays VS Code's)"}`);
    } catch { /* the rail still shows; only the width is VS Code's */ } finally {
      this.resizing = false;
    }
  }

  /**
   * Back to the full panel (on one of its views), or to one view alone (`solo`, a rail button). When
   * DataPass folded the rail, it gives a fixed width back first, while the rail tree has the keyboard.
   */
  async expand(view = "datapass.aiExchange", solo?: RailPanelView): Promise<void> {
    if (this.resizing) return;
    this.resizing = true;
    try {
      if (this.rail() && this.context.workspaceState.get<boolean>(RAIL_FOLDED_KEY) && (await vscode.commands.getCommands(true)).includes(WIDEN_FOCUSED)) {
        await vscode.commands.executeCommand("datapass.rail.focus");
        for (let i = 0; i < EXPAND_STEPS; i += 1) await vscode.commands.executeCommand(WIDEN_FOCUSED);
      }
      await this.context.workspaceState.update(RAIL_FOLDED_KEY, false);
      await this.setSolo(solo);
      await this.setRail(false);
      await vscode.commands.executeCommand(`${view}.focus`);
    } catch { /* the full panel shows; only the width is VS Code's */ } finally {
      this.resizing = false;
    }
  }
}

function railView(shell: ShellService): vscode.Disposable[] {
  const view = vscode.window.createTreeView("datapass.rail", { treeDataProvider: shell.railProvider() });
  shell.attachRail(view);
  return [view];
}

export function registerShellCommands(context: vscode.ExtensionContext, shell: ShellService): void {
  context.subscriptions.push(
    shell,
    ...railView(shell),
    ...TREE_LENSES.map(l => vscode.commands.registerCommand(`datapass.tree.lens.${l}`, () => shell.chooseLens(l))),
    vscode.commands.registerCommand("datapass.tree.chooseLens", async (arg?: unknown) => {
      if (typeof arg === "string") return shell.chooseLens(parseLens(arg));
      // V1.1.x-POLISH-3: from the status bar (Explorer showing), bring the DataPass tree on screen first.
      if (!shell.treeVisible()) await vscode.commands.executeCommand("datapass.project.focus", { preserveFocus: true });
      type Pick = vscode.QuickPickItem & { lens?: TreeLens; explorer?: boolean };
      const items: Pick[] = [
        ...TREE_LENSES.map(l => ({ label: `$(${LENS_INFO[l].icon}) ${LENS_INFO[l].label}`, description: l === shell.lens() ? "shown" : undefined, detail: LENS_INFO[l].detail, lens: l })),
        { label: "$(files) Natural tree", detail: "VS Code's Explorer: the folders and files as they are", explorer: true }
      ];
      const pick = await vscode.window.showQuickPick(items, { title: "What should the Project tree list?" });
      if (pick?.lens) await shell.chooseLens(pick.lens);
      else if (pick?.explorer) await vscode.commands.executeCommand("workbench.view.explorer");
    }),
    vscode.commands.registerCommand("datapass.tree.showExplorer", () => vscode.commands.executeCommand("workbench.view.explorer")),
    vscode.commands.registerCommand("datapass.layout.toggleArchitecturePanel", (on?: unknown) => shell.toggleArchitecturePanel(typeof on === "boolean" ? on : undefined)),
    vscode.commands.registerCommand("datapass.rail.collapse", () => shell.collapse()),
    // V1.1.x-POLISH-3: `solo` (the rail's buttons) unfolds that view alone; the DAG button first finds a DAG.
    vscode.commands.registerCommand("datapass.rail.expand", (view?: unknown, solo?: unknown) => {
      const v = typeof view === "string" && /^datapass\.(aiExchange|details|agentPanel|airflowDag)$/.test(view) ? view : undefined;
      if (solo === true && v === "datapass.airflowDag") return shell.showDag();
      if (solo === true && v) return shell.expand(v, v.slice("datapass.".length) as RailPanelView);
      return shell.expand(v === "datapass.airflowDag" ? undefined : v);
    }),
    vscode.commands.registerCommand("datapass.layout.closeRightPanel", () => vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar")),
    vscode.commands.registerCommand("datapass.layout.closeLeftBar", () => vscode.commands.executeCommand("workbench.action.closeSidebar")),
    vscode.commands.registerCommand("datapass.layout.closeBottomPanel", () => vscode.commands.executeCommand("workbench.action.closePanel"))
  );
}
