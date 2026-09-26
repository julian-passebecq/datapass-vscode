/**
 * 0.22 modes (package B): the presentation preset of this machine. Reads the shipped presets
 * (resources/experience/presets.json) and the settings `datapass.experience.preset` / `.overrides`,
 * sets the context keys `datapass.hidden.<surface>` that the views' and menus' `when` clauses use,
 * and shows the mode in the status bar.
 *
 * Switching mode only writes these two user settings (machine scope): never a file of a project or
 * a repository (D-01). Presets never gate safety (D-03): commands stay in the palette with their own
 * guards, and blockers show in every mode.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { experienceTooltip, hiddenSurfaces, isVisible, overridesFor, parsePresets, resolveExperience, type Experience, type PresetsFile } from "../core/experience/presets";
import { DEFAULT_PRESET, hiddenKey, PRESET_IDS, SURFACES, type PresetId } from "../core/experience/surfaces";
import { output } from "./io";

const INTRO_SHOWN = "datapass.experience.introShown";
const config = () => vscode.workspace.getConfiguration("datapass.experience");

/** Every surface shown: what DataPass falls back to when presets.json cannot be read (nothing is hidden by accident). */
const FALLBACK: PresetsFile = {
  format: "datapass.experience", version: 1, default: "advanced",
  presets: PRESET_IDS.map(id => ({ id, label: id[0]!.toUpperCase() + id.slice(1), description: id, show: SURFACES.map(s => s.id) }))
};

export class ExperienceService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Experience>();
  readonly onDidChange = this.emitter.event;
  readonly presets: PresetsFile;
  private current: Experience;
  private readonly item: vscode.StatusBarItem;
  private readonly subs: vscode.Disposable[] = [];
  private lastMessages = "";
  /** Resolves once the context keys of the current mode are set. */
  ready: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.presets = loadPresets(context.extensionPath);
    this.current = this.resolve();
    this.item = vscode.window.createStatusBarItem("datapass.mode", vscode.StatusBarAlignment.Left, 22);
    this.item.name = "DataPass mode";
    this.item.command = "datapass.experience.switchMode";
    this.subs.push(this.item, this.emitter, vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("datapass.experience")) void this.apply();
    }));
    this.ready = this.apply(false);
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  experience(): Experience { return this.current; }
  shows = (surface: string): boolean => isVisible(this.current, surface);
  statusText(): string { return this.item.text; }
  statusTooltip(): string { return typeof this.item.tooltip === "string" ? this.item.tooltip : ""; }
  statusVisible(): boolean { return this.shows("status.mode"); }

  private resolve(): Experience {
    return resolveExperience(this.presets, config().get("preset"), config().get("overrides"));
  }

  /** Re-read the settings, set every context key, repaint the status item, tell the views. */
  async apply(fire = true): Promise<void> {
    this.current = this.resolve();
    const x = this.current;
    const changed = Object.keys(x.overrides).length;
    this.item.text = `$(layers) DataPass: ${x.label}${changed ? " *" : ""}`;
    this.item.tooltip = experienceTooltip(x);
    if (this.shows("status.mode")) this.item.show(); else this.item.hide();
    const messages = x.messages.join("\n");
    if (messages && messages !== this.lastMessages) {
      for (const m of x.messages) output().appendLine(`[mode] ${m}`);
      void vscode.window.showWarningMessage(x.messages[0]!, "Open settings").then(pick => {
        if (pick) void vscode.commands.executeCommand("workbench.action.openSettings", "datapass.experience");
      });
    }
    this.lastMessages = messages;
    output().appendLine(`[mode] ${x.label}; hidden: ${hiddenSurfaces(x).join(", ") || "none"}`);
    await Promise.all(x.surfaces.map(s => vscode.commands.executeCommand("setContext", hiddenKey(s.id), !s.visible)));
    if (fire) this.emitter.fire(x);
  }

  async setPreset(id: PresetId): Promise<void> {
    await config().update("preset", id, vscode.ConfigurationTarget.Global);
    await this.apply();
  }

  async setOverrides(overrides: Record<string, boolean> | undefined): Promise<void> {
    await config().update("overrides", overrides && Object.keys(overrides).length ? overrides : undefined, vscode.ConfigurationTarget.Global);
    await this.apply();
  }

  /** New install: say once which mode DataPass opens in, with a way to switch (not awaited). */
  introduce(): void {
    if (this.context.extensionMode === vscode.ExtensionMode.Test) return;
    if (this.context.globalState.get<boolean>(INTRO_SHOWN)) return;
    const set = config().inspect("preset");
    void this.context.globalState.update(INTRO_SHOWN, true);
    if (set?.globalValue !== undefined || set?.workspaceValue !== undefined) return;
    void vscode.window.showInformationMessage(`DataPass opens in ${this.current.label} mode: the calm view. Advanced shows everything.`, "Switch mode").then(pick => {
      if (pick) void vscode.commands.executeCommand("datapass.experience.switchMode");
    });
  }
}

function loadPresets(extensionPath: string): PresetsFile {
  try {
    return parsePresets(fs.readFileSync(path.join(extensionPath, "resources", "experience", "presets.json")));
  } catch (error) {
    output().appendLine(`[mode] presets.json could not be read (${error instanceof Error ? error.message : String(error)}): every surface is shown.`);
    return FALLBACK;
  }
}

/**
 * 0.22 landing: in Standard and above, focus the Architecture panel when a project opens. A work
 * view applied at startup (0.17 `datapass.startupView`, or a launcher's request) wins.
 */
export async function landOnArchitecture(experience: ExperienceService, hasProject: boolean, applied: string | undefined): Promise<boolean> {
  if (!hasProject || applied || !experience.shows("landing.architecture") || !experience.shows("view.architecture")) return false;
  const startup = vscode.workspace.getConfiguration("datapass").inspect<string>("startupView");
  if (startup?.workspaceValue || startup?.workspaceFolderValue) return false;
  const editor = vscode.window.activeTextEditor;
  await vscode.commands.executeCommand("datapass.architecture.focus");
  // Give the keyboard back to the file being edited.
  if (editor) await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  return true;
}

export function registerExperienceCommands(context: vscode.ExtensionContext, experience: ExperienceService): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("datapass.experience.switchMode", async (id?: unknown) => {
      if (typeof id === "string" && (PRESET_IDS as readonly string[]).includes(id)) { await experience.setPreset(id as PresetId); return; }
      const x = experience.experience();
      type Pick = vscode.QuickPickItem & { id?: PresetId; action?: "customize" | "reset" };
      const items: Pick[] = experience.presets.presets.map(p => ({
        id: p.id, label: `${p.id === x.preset ? "$(check) " : ""}${p.label}`, description: p.id === DEFAULT_PRESET ? "default" : undefined, detail: p.description
      }));
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
      items.push({ label: "$(settings) Customize this mode…", action: "customize", detail: "Show or hide each view, tab, section and status item" });
      if (Object.keys(x.overrides).length) items.push({ label: "$(discard) Reset my changes", action: "reset", detail: `Back to ${x.label} as shipped (${Object.keys(x.overrides).length} change(s))` });
      const pick = await vscode.window.showQuickPick(items, { title: "DataPass: Switch Mode", placeHolder: "Modes change what is shown, never your files or the safety checks" });
      if (!pick) return;
      if (pick.action === "customize") return vscode.commands.executeCommand("datapass.experience.customize");
      if (pick.action === "reset") return experience.setOverrides(undefined);
      if (pick.id) await experience.setPreset(pick.id);
    }),
    vscode.commands.registerCommand("datapass.experience.customize", async () => {
      const x = experience.experience();
      type Pick = vscode.QuickPickItem & { id: string };
      const items: Pick[] = x.surfaces.map(s => ({ id: s.id, label: s.label, description: s.origin === "override" ? "changed" : undefined, detail: s.detail, picked: s.visible }));
      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true, title: `Customize DataPass Mode (${x.label})`, placeHolder: "Checked = shown. Your changes are kept when you switch mode."
      });
      if (!picked) return;
      await experience.setOverrides(overridesFor(experience.presets, x.preset, new Set(picked.map(p => p.id))));
    }),
    vscode.commands.registerCommand("datapass.experience.resetOverrides", () => experience.setOverrides(undefined))
  );
}
