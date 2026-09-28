/**
 * V1.1.x-POLISH-4: the ergonomics Julian could not find in 1.1.0-rc.1 (see core/experience/ergonomics.ts).
 *
 * - "DataPass: Show DataPass in the Activity Bar": opens the DataPass side bar (VS Code's own
 *   `workbench.view.extension.datapass`) and says how to keep the icon; when the whole Activity Bar is
 *   hidden it offers to show it again (VS Code's setting, after a confirmation).
 * - A− / A+ / reset for the code text, in the status bar and on the Home page, with keys.
 * - "DataPass: Appearance…": theme, overlay, overlay colours, tree icon colours, diagram style, code size.
 * - "DataPass: Home": the Home page, the DataPass tree and the right rail as the project saved them,
 *   from any editor arrangement (the saved layout's grid when there is one, else the Home is revealed
 *   where it is or opened in the active group).
 *
 * Every status-bar item has an id and a name, so VS Code's own right-click on the status bar hides it.
 */
import * as vscode from "vscode";
import type { WorkViews } from "./workViews";
import type { ShellService } from "./shellCommands";
import type { WorkSession } from "./session";
import { confirmModal, guarded, report, UserFacingError } from "./io";
import { writeCodeFontSize } from "./codeFontCommand";
import {
  ACTIVITY_BAR_HINT, HOME_LAYOUT_NAME, HOME_RESTORE_COMMAND, HOME_STATUS, SHOW_CONTAINER_COMMAND, ZOOM_COMMANDS,
  activityBarHidden, appearanceItems, isAppearanceId, projectLayout, settingScope, zoomStatus, zoomedFontSize,
  type AppearanceId, type ZoomStep
} from "../core/experience/ergonomics";
import { findView } from "../core/windows/workViews";

/** The right side's view container (the rail, or the AI / Details panel). */
const RIGHT_CONTAINER = "datapass-details";
const TOGGLE_THEME = "workbench.action.toggleLightDarkThemes";

export interface ErgonomicsControls {
  /** Status-bar texts now (desktop tests). */
  status(): { home: string; smaller: string; size: string; bigger: string };
  /** What the last "Home" did (desktop tests). */
  lastRestore(): { layout?: string; why?: string; rail: boolean } | undefined;
  /** What the last "Show DataPass in the Activity Bar" did (desktop tests). */
  lastActivityBar(): { opened: boolean; barHidden: boolean } | undefined;
}

export function registerErgonomicsCommands(
  context: vscode.ExtensionContext, session: WorkSession, views: WorkViews, shell: ShellService, openHome: () => Promise<unknown>
): ErgonomicsControls {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const fontSize = () => vscode.workspace.getConfiguration("editor").get<number>("fontSize");

  // ------------------------------------------------------------------ status bar

  const home = vscode.window.createStatusBarItem("datapass.home", vscode.StatusBarAlignment.Left, 22);
  home.name = "DataPass Home";
  home.text = HOME_STATUS.text;
  home.tooltip = HOME_STATUS.tooltip;
  home.command = HOME_RESTORE_COMMAND;
  home.show();
  const zoomItem = (id: string, name: string, priority: number, command: string) => {
    const item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Right, priority);
    item.name = name;
    item.command = command;
    item.show();
    return item;
  };
  const smaller = zoomItem("datapass.codeFont.smaller", "DataPass code text smaller (A−)", 102, ZOOM_COMMANDS.smaller);
  const size = zoomItem("datapass.codeFont.size", "DataPass code text size and appearance", 101, "datapass.appearance");
  const bigger = zoomItem("datapass.codeFont.bigger", "DataPass code text larger (A+)", 100, ZOOM_COMMANDS.bigger);
  const paintZoom = () => {
    const s = zoomStatus(fontSize());
    smaller.text = s.smaller; size.text = s.size; bigger.text = s.bigger;
    smaller.tooltip = `Smaller code text (A−). ${s.tooltip}`;
    size.tooltip = `Appearance: theme, DataPass overlay, colours, code size. ${s.tooltip}`;
    bigger.tooltip = `Larger code text (A+). ${s.tooltip}`;
  };
  paintZoom();
  context.subscriptions.push(home, smaller, size, bigger, vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("editor.fontSize")) paintZoom(); }));

  // ------------------------------------------------------------------ activity bar

  let activityResult: { opened: boolean; barHidden: boolean } | undefined;
  reg("datapass.showInActivityBar", async () => {
    const wb = vscode.workspace.getConfiguration("workbench");
    const barHidden = activityBarHidden(wb.get("activityBar.location"), wb.get("activityBar.visible"));
    activityResult = { opened: false, barHidden };
    if (barHidden) {
      const ok = await confirmModal("VS Code's Activity Bar is hidden. Show it again?", "DataPass sets VS Code's own setting workbench.activityBar.location to \"default\" in your user settings. You can change it back in Settings.", "Show it");
      if (ok) {
        if (wb.get("activityBar.location") === "hidden") await wb.update("activityBar.location", "default", vscode.ConfigurationTarget.Global);
        if (wb.get("activityBar.visible") === false) await wb.update("activityBar.visible", true, vscode.ConfigurationTarget.Global);
      }
    }
    await vscode.commands.executeCommand(SHOW_CONTAINER_COMMAND);
    await vscode.commands.executeCommand("datapass.project.focus");
    activityResult = { opened: true, barHidden };
    void vscode.window.showInformationMessage(`DataPass: the DataPass side bar is open. ${ACTIVITY_BAR_HINT}`);
  });

  // ------------------------------------------------------------------ code zoom

  const zoom = async (step: ZoomStep) => {
    const next = zoomedFontSize(fontSize(), step);
    await writeCodeFontSize(next ?? "reset");
    paintZoom();
    vscode.window.setStatusBarMessage(`$(text-size) DataPass: code text ${fontSize() ?? next ?? "?"} px`, 2500);
  };
  reg(ZOOM_COMMANDS.smaller, () => zoom("smaller"));
  reg(ZOOM_COMMANDS.bigger, () => zoom("bigger"));
  reg(ZOOM_COMMANDS.reset, () => zoom("reset"));

  // ------------------------------------------------------------------ appearance

  const toggleSetting = async (section: string, key: string, next: unknown) => {
    const cfg = vscode.workspace.getConfiguration(section);
    const where = settingScope(cfg.inspect(key));
    await cfg.update(key, next, where === "folder" ? vscode.ConfigurationTarget.WorkspaceFolder : where === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  };
  const runAppearance = async (id: AppearanceId) => {
    const dp = vscode.workspace.getConfiguration("datapass");
    switch (id) {
      case "theme.pick": await vscode.commands.executeCommand("workbench.action.selectTheme"); return;
      case "theme.toggle": await vscode.commands.executeCommand(TOGGLE_THEME); return;
      case "overlay.toggle": await toggleSetting("datapass.overlay", "enabled", !(dp.get<boolean>("overlay.enabled", true))); return;
      case "overlay.colors": await vscode.commands.executeCommand("workbench.action.openSettings", "datapass.overlay.colors"); return;
      case "tree.colors": await toggleSetting("datapass.tree", "coloredIcons", !(dp.get<boolean>("tree.coloredIcons", false))); return;
      case "diagram.theme": await toggleSetting("datapass.diagram", "theme", dp.get<string>("diagram.theme", "microsoft") === "vscode" ? "microsoft" : "vscode"); return;
      case "font.smaller": return zoom("smaller");
      case "font.bigger": return zoom("bigger");
      case "font.reset": return zoom("reset");
      case "font.pick": await vscode.commands.executeCommand("datapass.setCodeFontSize"); return;
      case "activityBar": await vscode.commands.executeCommand("datapass.showInActivityBar"); return;
    }
  };
  reg("datapass.appearance", async (arg?: unknown) => {
    if (arg !== undefined) {
      if (!isAppearanceId(arg)) throw new UserFacingError("Unknown appearance choice.");
      return runAppearance(arg);
    }
    const dp = vscode.workspace.getConfiguration("datapass");
    const canToggleTheme = (await vscode.commands.getCommands(true)).includes(TOGGLE_THEME);
    const items = appearanceItems({
      themeName: vscode.workspace.getConfiguration("workbench").get<string>("colorTheme"), canToggleTheme,
      overlay: dp.get<boolean>("overlay.enabled", true), coloredIcons: dp.get<boolean>("tree.coloredIcons", false),
      diagramTheme: dp.get<string>("diagram.theme", "microsoft"), fontSize: fontSize()
    }).map(i => i.separator ? { label: i.label, kind: vscode.QuickPickItemKind.Separator } : { label: i.label, description: i.description, detail: i.detail, id: i.id });
    const pick = await vscode.window.showQuickPick(items, { title: "DataPass: Appearance", placeHolder: "Theme, DataPass overlay, colours, code size — each writes a VS Code or DataPass setting you can change back" });
    const id = pick && "id" in pick ? pick.id : undefined;
    if (id) await runAppearance(id);
  });

  // ------------------------------------------------------------------ Home: restore the project layout

  let restoreResult: { layout?: string; why?: string; rail: boolean } | undefined;
  reg(HOME_RESTORE_COMMAND, async () => {
    const current = session.root?.toString();
    const all = (await views.all().catch(() => [])).sort((a, b) => Number(b.root.toString() === current) - Number(a.root.toString() === current));
    const workspaceFile = vscode.workspace.workspaceFile?.scheme === "file";
    const startup = workspaceFile ? vscode.workspace.getConfiguration("datapass").inspect<string>("startupView")?.workspaceValue : undefined;
    const applied = views.lastApplied();
    let chosen: { id: string; why: string; name: string } | undefined;
    let root: vscode.Uri | undefined;
    // This project first, then the other DataPass projects of the window.
    for (const s of all) {
      const pick = projectLayout({ views: s.file.views, startup: typeof startup === "string" ? startup : undefined, lastApplied: applied?.root === s.root.toString() ? applied.id : undefined });
      if (pick) { chosen = { ...pick, name: findView(s.file, pick.id)!.name }; root = s.root; break; }
    }
    if (chosen && root) {
      const view = findView(all.find(s => s.root === root)!.file, chosen.id)!;
      const notes = await views.apply(view, root);
      if (notes.length) report(`Home: layout "${view.name}"`, notes);
    }
    // The left tree and the right rail, whatever the layout showed or hid (a focus shows a hidden side bar).
    await vscode.commands.executeCommand(SHOW_CONTAINER_COMMAND);
    await vscode.commands.executeCommand("datapass.project.focus", { preserveFocus: true });
    const rail = shell.rail();
    await vscode.commands.executeCommand(`workbench.view.extension.${RIGHT_CONTAINER}`);
    const right = rail ? "datapass.rail" : shell.solo() ? `datapass.${shell.solo()}` : "datapass.aiExchange";
    await vscode.commands.executeCommand(`${right}.focus`, { preserveFocus: true });
    // Last, the Home page itself (revealed where it is, else opened in the active group), with the keyboard.
    await openHome();
    restoreResult = { layout: chosen?.name, why: chosen?.why, rail };
    vscode.window.setStatusBarMessage(chosen ? `$(home) DataPass Home: layout "${chosen.name}" restored` : `$(home) DataPass Home (no layout named "${HOME_LAYOUT_NAME}" yet: save one from the Home page)`, 4000);
  });

  return {
    status: () => ({ home: home.text, smaller: smaller.text, size: size.text, bigger: bigger.text }),
    lastRestore: () => restoreResult,
    lastActivityBar: () => activityResult
  };
}
