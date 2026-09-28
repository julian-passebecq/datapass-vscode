/**
 * V3-SHELL (vision §2.1): navigation and shell.
 *
 * - Tree lenses: buttons in the Project view's title bar switch what the left tree lists (Project,
 *   Architecture, Git, AI / Work orders, Readiness); "Natural tree" shows VS Code's Explorer. The
 *   chosen lens is remembered per workspace (workspaceState).
 * - The bottom-panel Architecture view is off by default (`datapass.layout.architectureInPanel`).
 * - Rail mode: the DataPass secondary side bar becomes a thin column of buttons (the `datapass.rail`
 *   view) and expands back to the full panel. VS Code gives extensions no way to set a side bar's
 *   width: the rail narrows it with VS Code's own "Decrease Current View Width" steps (while the
 *   rail keeps shrinking) and "Expand" gives the same number of steps back.
 * - Close buttons on the panel they close, through VS Code's own close commands.
 */
import * as vscode from "vscode";
import { LENS_CONTEXT_KEY, LENS_INFO, LensStore, TREE_LENSES, parseLens, type TreeLens } from "../core/windows/treeLens";
import type { ProjectTreeProvider } from "../views/projectTree";
import { RAIL_BUTTON_IDS, railHtml } from "../views/railHtml";
import { output } from "./io";

export const RAIL_CONTEXT_KEY = "datapass.rail";
const RAIL_STATE_KEY = "datapass.rail";
const RAIL_STEPS_KEY = "datapass.rail.steps";
export const PANEL_CONTEXT_KEY = "datapass.layout.architectureInPanel";
const MAX_STEPS = 10;

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
  private railView?: vscode.WebviewView;
  private railWidth?: number;
  private widthWaiters: Array<(w: number | undefined) => void> = [];
  private resizing = false;
  /** V3-POLISH-2: the rail buttons to show (all until setRailButtons is called). */
  private railShown: () => readonly string[] = () => RAIL_BUTTON_IDS;

  constructor(private readonly context: vscode.ExtensionContext, private readonly tree: ProjectTreeProvider, private readonly treeView: vscode.TreeView<unknown>) {
    this.lenses = new LensStore(context.workspaceState);
    tree.setLenses(this.lenses);
    void vscode.commands.executeCommand("setContext", LENS_CONTEXT_KEY, this.lenses.current);
    void vscode.commands.executeCommand("setContext", RAIL_CONTEXT_KEY, this.rail());
    void this.syncPanelKey();
    this.subs.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.layout.architectureInPanel")) void this.syncPanelKey(); }));
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

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

  private paintRail(): void {
    const view = this.railView;
    if (!view) return;
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    view.webview.html = railHtml(view.webview.cspSource, nonce, this.railShown());
  }

  rail(): boolean { return this.context.workspaceState.get<boolean>(RAIL_STATE_KEY) === true; }
  railResolved(): boolean { return Boolean(this.railView); }

  railProvider(): vscode.WebviewViewProvider {
    return {
      resolveWebviewView: view => {
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        this.railView = view;
        this.paintRail();
        view.onDidDispose(() => { if (this.railView === view) this.railView = undefined; });
        view.webview.onDidReceiveMessage(m => void this.onRailMessage(m));
      }
    };
  }

  /** One message from the rail webview (also driven by the desktop tests). */
  async onRailMessage(m: unknown): Promise<void> {
    const msg = m as { type?: unknown; id?: unknown; width?: unknown };
    if (msg?.type === "width" && typeof msg.width === "number") {
      this.railWidth = msg.width;
      const waiters = this.widthWaiters.splice(0);
      for (const w of waiters) w(msg.width);
      return;
    }
    if (msg?.type !== "rail" || typeof msg.id !== "string" || !this.railShown().includes(msg.id)) return;
    switch (msg.id) {
      case "expand": return this.expand();
      case "details": return this.expand("datapass.details");
      case "ai": return this.expand("datapass.aiExchange");
      case "git": return this.chooseLens("git");
      // V3-POLISH-1: unfold the panel on the Airflow DAG view, then read the active editor.
      case "airflow": await this.expand("datapass.airflowDag"); await vscode.commands.executeCommand("datapass.showAirflowDag"); return;
      case "copyForAi": await vscode.commands.executeCommand("datapass.copyForAi"); return;
      case "importFromAi": await vscode.commands.executeCommand("datapass.importFromAi"); return;
      case "workViews": await vscode.commands.executeCommand("datapass.openSwitcher"); return;
      case "ownWindow": await vscode.commands.executeCommand("datapass.openWorkbenchFloating"); return;
    }
  }

  private async setRail(on: boolean): Promise<void> {
    await this.context.workspaceState.update(RAIL_STATE_KEY, on);
    await vscode.commands.executeCommand("setContext", RAIL_CONTEXT_KEY, on);
  }

  private nextWidth(ms: number): Promise<number | undefined> {
    return new Promise(resolve => {
      const t = setTimeout(() => { this.widthWaiters = this.widthWaiters.filter(w => w !== done); resolve(undefined); }, ms);
      const done = (w: number | undefined) => { clearTimeout(t); resolve(w); };
      this.widthWaiters.push(done);
    });
  }

  /** Rail mode: the full panel folds into the column of buttons, and the side bar narrows. */
  async collapse(): Promise<void> {
    if (this.resizing) return;
    this.resizing = true;
    try {
      if (!this.rail()) await this.setRail(true);
      const first = this.railView ? Promise.resolve(this.railWidth) : this.nextWidth(3000);
      await vscode.commands.executeCommand("datapass.rail.focus");
      let width = await first;
      let steps = 0;
      const canResize = (await vscode.commands.getCommands(true)).includes("workbench.action.decreaseViewWidth");
      output().appendLine(`[rail] resize command ${canResize ? "present" : "absent"}, rail ${width ?? "?"} px`);
      if (width !== undefined && canResize) {
        // The part that holds the focus is the one VS Code resizes: the secondary side bar itself.
        try { await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar"); } catch { /* older VS Code */ }
        while (steps < MAX_STEPS && width > 90) {
          const next = this.nextWidth(600);
          await vscode.commands.executeCommand("workbench.action.decreaseViewWidth");
          const w = await next;
          if (w === undefined || w >= width) break;
          width = w;
          steps += 1;
        }
      }
      output().appendLine(`[rail] folded: ${steps} width step(s), rail ${width ?? "?"} px wide`);
      await this.context.workspaceState.update(RAIL_STEPS_KEY, steps + (this.context.workspaceState.get<number>(RAIL_STEPS_KEY) ?? 0));
    } catch { /* the rail still shows; only the width is VS Code's */ } finally {
      this.resizing = false;
    }
  }

  /** Back to the full panel (on one of its views), giving back the width the rail took. */
  async expand(view = "datapass.aiExchange"): Promise<void> {
    if (this.resizing) return;
    this.resizing = true;
    try {
      await this.setRail(false);
      await vscode.commands.executeCommand(`${view}.focus`);
      const steps = Math.min(MAX_STEPS * 2, this.context.workspaceState.get<number>(RAIL_STEPS_KEY) ?? 0);
      await this.context.workspaceState.update(RAIL_STEPS_KEY, 0);
      if (steps && (await vscode.commands.getCommands(true)).includes("workbench.action.increaseViewWidth")) {
        try { await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar"); } catch { /* older VS Code */ }
        for (let i = 0; i < steps; i += 1) await vscode.commands.executeCommand("workbench.action.increaseViewWidth");
      }
    } catch { /* the full panel shows; only the width is VS Code's */ } finally {
      this.resizing = false;
    }
  }
}

export function registerShellCommands(context: vscode.ExtensionContext, shell: ShellService): void {
  context.subscriptions.push(
    shell,
    vscode.window.registerWebviewViewProvider("datapass.rail", shell.railProvider()),
    ...TREE_LENSES.map(l => vscode.commands.registerCommand(`datapass.tree.lens.${l}`, () => shell.chooseLens(l))),
    vscode.commands.registerCommand("datapass.tree.chooseLens", async (arg?: unknown) => {
      if (typeof arg === "string") return shell.chooseLens(parseLens(arg));
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
    vscode.commands.registerCommand("datapass.rail.expand", (view?: unknown) => shell.expand(typeof view === "string" && /^datapass\.(aiExchange|details|agentPanel)$/.test(view) ? view : undefined)),
    vscode.commands.registerCommand("datapass.layout.closeRightPanel", () => vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar")),
    vscode.commands.registerCommand("datapass.layout.closeLeftBar", () => vscode.commands.executeCommand("workbench.action.closeSidebar")),
    vscode.commands.registerCommand("datapass.layout.closeBottomPanel", () => vscode.commands.executeCommand("workbench.action.closePanel"))
  );
}
