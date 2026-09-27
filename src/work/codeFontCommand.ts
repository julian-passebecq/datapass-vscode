/**
 * V3-THEME: "DataPass: Set Code Font Size…" — writes VS Code's `editor.fontSize` in this workspace's settings,
 * after a modal confirmation that names the exact setting and value. With no folder open it offers the user
 * settings instead. "Reset" removes the workspace value.
 */
import * as vscode from "vscode";
import { CODE_FONT_SIZES, codeFontLabel, parseCodeFontSize } from "../core/experience/codeFont";

type Choice = number | "reset";

async function chooseSize(current: number | undefined): Promise<Choice | undefined> {
  type Item = vscode.QuickPickItem & { choice: Choice | "other" };
  const items: Item[] = [
    ...CODE_FONT_SIZES.map(s => ({ label: codeFontLabel(s, current), choice: s as Choice | "other" })),
    { label: "Other size…", choice: "other" },
    { label: "Reset (remove this workspace's value)", choice: "reset" }
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "DataPass: code font size", placeHolder: `Now ${current ?? "?"} px. DataPass writes VS Code's own setting editor.fontSize.` });
  if (!pick) return undefined;
  if (pick.choice !== "other") return pick.choice;
  const text = await vscode.window.showInputBox({ title: "Code font size (px)", value: String(current ?? 14), validateInput: t => { const r = parseCodeFontSize(t); return "error" in r ? r.error : undefined; } });
  if (text === undefined) return undefined;
  const r = parseCodeFontSize(text);
  return "error" in r ? undefined : r.size;
}

export function registerCodeFontCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand("datapass.setCodeFontSize", async (arg?: unknown) => {
    const cfg = vscode.workspace.getConfiguration("editor");
    let choice: Choice | undefined;
    if (typeof arg === "number" || typeof arg === "string") {
      const r = parseCodeFontSize(String(arg));
      if ("error" in r) { void vscode.window.showErrorMessage(`DataPass: ${r.error}`); return; }
      choice = r.size;
    } else choice = await chooseSize(cfg.get<number>("fontSize"));
    if (choice === undefined) return;
    const workspace = Boolean(vscode.workspace.workspaceFolders?.length);
    const where = workspace ? "this workspace's settings" : "your user settings (no folder is open)";
    const what = choice === "reset" ? `Remove editor.fontSize from ${where}?` : `Set editor.fontSize to ${choice} in ${where}?`;
    const button = choice === "reset" ? "Remove" : "Set";
    const ok = await vscode.window.showInformationMessage(what, { modal: true, detail: "This is VS Code's own setting; you can change it back in Settings at any time." }, button);
    if (ok !== button) return;
    await cfg.update("fontSize", choice === "reset" ? undefined : choice, workspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  }));
}
