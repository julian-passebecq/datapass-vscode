/**
 * V5 TOUR2: guided mode in the Navigator (Julian 12:10, TL-11, TL-12c). Extends the NAVTOUR1 Tours
 * section (no edit of its logic): mode switch Learning / Interview / All, Present (read-only),
 * Next/Previous by buttons, 1–9 keys and wheel, "Save current path as tour", "Add this screen to tour".
 * Each step drives the NavigationService (`go` + `view`, built-in or NAVCAT1 saved view) through NavTours.
 * The current step's explanation is offered to the Context view (`explanation()` + `onDidChange`, NAVCTX1)
 * and its Location to the mini-map (`highlight()`, NAVMAP1), each behind its panel setting.
 * Commands `datapass.nav.tour.{saveCurrentPath,addScreen,present,setMode}`. Off (`datapass.guided.enabled`)
 * = nothing registered.
 */
import * as vscode from "vscode";
import {
  addScreenToTour, availableModes, keyToStepIndex, readGuidedSettings, recordScreen, saveScreensAsTour, visibleTours, wheelDelta,
  type GuidedMode, type GuidedSettings, type Screen
} from "../../core/guided/guided";
import type { NavHost } from "../../core/navigation/navHost";
import type { NavLocation } from "../../core/navigation/navTypes";
import { serializeTourFile, TOURS_FILE } from "../../core/navigation/tours/store";
import type { TourDocument } from "../../core/navigation/tours/tourTypes";
import { projectRoot } from "../../core/workspace/root";
import { addNavigatorSlot } from "../navigator";
import { navTours, onDidChangeNavTours, type NavTours } from "../navTours";
import { labelPack, uiLabel } from "../navToursHtml";
import { guidedHtml, guidedScript, parseGuidedMessage } from "./guidedHtml";

export const GUIDED_COMMANDS = {
  saveCurrentPath: "datapass.nav.tour.saveCurrentPath", addScreen: "datapass.nav.tour.addScreen",
  present: "datapass.nav.tour.present", setMode: "datapass.nav.tour.setMode"
} as const;

const config = () => vscode.workspace.getConfiguration("datapass.guided");
const settings = (): GuidedSettings => readGuidedSettings((k) => config().get(k));
const labels = () => labelPack(config().get("labels"));

export class Guided implements vscode.Disposable {
  private mode: GuidedMode = "all";
  private presenting = false;
  private path: Screen[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Explanation or highlight changed (Context view, mini-map). */
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [this.emitter];

  constructor(private readonly host: NavHost, private readonly tours: NavTours) {
    this.record();
    const navSub = host.nav.onDidChange(() => { this.record(); this.emitter.fire(); });
    this.subs.push({ dispose: () => navSub.dispose() }, tours.onDidChange(() => this.emitter.fire()),
      tours.addExtension({
        filter: (ts) => visibleTours(ts, this.mode, settings()),
        model: (m) => ({ ...m, explanationBox: settings().panels.explanationBox }),
        html: (inner) => guidedHtml(inner, { labels: labels(), modes: availableModes(settings()), mode: this.mode, presenting: this.presenting, canEdit: true }),
        handle: (raw) => this.handle(raw)
      }));
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  /** The current step's explanation for the Context view; undefined when the box is off or no tour runs. */
  explanation(): { title: string; text: string | null } | undefined {
    const c = this.tours.current();
    if (!c || !settings().panels.explanationBox) return undefined;
    return { title: this.host.label(c.step.location), text: this.tours.explain(c.step.explanationRef, c.step, c.tour) ?? null };
  }

  /** The Location the mini-map highlights (NAVMAP1); undefined when off or no tour runs. */
  highlight(): NavLocation | undefined {
    return settings().panels.miniMapHighlight ? this.tours.current()?.step.location : undefined;
  }

  setMode(mode: GuidedMode): void {
    this.mode = availableModes(settings()).includes(mode) ? mode : "all";
    this.tours.refresh();
  }

  togglePresent(on = !this.presenting): void {
    this.presenting = on;
    void vscode.commands.executeCommand("setContext", "datapass.guided.presenting", on);
    this.tours.refresh();
  }

  async pickMode(): Promise<void> {
    const L = labels();
    const pick = await vscode.window.showQuickPick(availableModes(settings()).map((m) => ({ label: L[`mode.${m}`] ?? m, m, description: m === this.mode ? "current" : undefined })),
      { placeHolder: uiLabel(L, "pickMode") });
    if (pick) this.setMode(pick.m);
  }

  /** "Save current path as tour": the screens visited since the last save (or activation). */
  async saveCurrentPath(): Promise<void> {
    if (this.presenting) return;
    const L = labels();
    if (this.path.length < 2) { void vscode.window.showInformationMessage(`DataPass: ${uiLabel(L, "pathTooShort")}`); return; }
    const title = await vscode.window.showInputBox({ prompt: uiLabel(L, "tourTitle"), validateInput: (v) => (v.trim() ? undefined : uiLabel(L, "tourTitle")) });
    if (!title) return;
    const mode = this.mode === "all" ? undefined : this.mode;
    const { document, tourId } = saveScreensAsTour(this.tours.fileDocument(), title, this.path, (s) => this.host.label(s.location), mode);
    if (await this.write(document)) {
      this.path = this.path.slice(-1);
      void vscode.window.showInformationMessage(`DataPass: ${uiLabel(L, "saved")} ${tourId}`);
    }
  }

  /** "Add this screen to tour": the current Location + view, appended to a user tour (or a new one). */
  async addScreen(): Promise<void> {
    if (this.presenting) return;
    const L = labels();
    const screen = this.screen();
    if (!screen) { void vscode.window.showInformationMessage(`DataPass: ${uiLabel(L, "noScreen")}`); return; }
    const doc = this.tours.fileDocument();
    const NEW = "\u0000new";
    const pick = await vscode.window.showQuickPick([{ label: `$(add) ${uiLabel(L, "newTour")}`, id: NEW },
      ...doc.tours.map((t) => ({ label: this.tours.explain(t.titleRef, undefined, t) ?? t.id, description: t.id, id: t.id }))], { placeHolder: uiLabel(L, "pickUserTour") });
    if (!pick) return;
    const text = await vscode.window.showInputBox({ prompt: uiLabel(L, "stepText"), value: this.host.label(screen.location) });
    if (text === undefined) return;
    if (pick.id === NEW) {
      const title = await vscode.window.showInputBox({ prompt: uiLabel(L, "tourTitle") });
      if (!title?.trim()) return;
      const out = saveScreensAsTour(doc, title, [screen], () => text, this.mode === "all" ? undefined : this.mode);
      await this.write(out.document);
      return;
    }
    const next = addScreenToTour(doc, pick.id, screen, text);
    if (next) await this.write(next);
  }

  private async handle(raw: unknown): Promise<boolean> {
    const m = parseGuidedMessage(raw);
    if (!m) return false;
    switch (m.action) {
      case "mode": this.setMode(m.mode); break;
      case "present": this.togglePresent(); break;
      case "save-path": await this.saveCurrentPath(); break;
      case "add-screen": await this.addScreen(); break;
      case "wheel": { const d = wheelDelta(m.deltaY); if (d > 0) this.tours.next(); else if (d < 0) this.tours.prev(); break; }
      case "key": {
        if (m.key === "ArrowRight" || m.key === "ArrowDown" || m.key === "PageDown") this.tours.next();
        else if (m.key === "ArrowLeft" || m.key === "ArrowUp" || m.key === "PageUp") this.tours.prev();
        else { const c = this.tours.current(); const i = c ? keyToStepIndex(c.tour, m.key) : null; if (i !== null) this.tours.goStep(i); }
        break;
      }
    }
    return true;
  }

  private screen(): Screen | undefined {
    const s = this.host.nav.state;
    return s.viewId ? { location: s.location, viewId: s.viewId } : undefined;
  }

  private record(): void {
    const s = this.screen();
    if (s) this.path = recordScreen(this.path, s);
  }

  /** Write `.datapass/tours.json` (built-in tours are never written); the NavTours watcher reloads it. */
  private async write(doc: TourDocument): Promise<boolean> {
    const root = projectRoot();
    if (!root) { void vscode.window.showWarningMessage(`DataPass: ${uiLabel(labels(), "noProject")}`); return false; }
    const builtin = new Set(this.tours.tours().filter((t) => !doc.tours.some((d) => d.id === t.id)).map((t) => t.id));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, TOURS_FILE[0]));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...TOURS_FILE), new TextEncoder().encode(serializeTourFile(doc, builtin)));
    await this.tours.reload();
    return true;
  }
}

let active: Guided | undefined;
/** The live instance (Context view NAVCTX1, mini-map NAVMAP1, desktop tests). */
export const guided = (): Guided | undefined => active;

/** The one SURFACES line. Follows `datapass.guided.enabled` (and NavTours' own life) live. */
export function registerGuided(_context: vscode.ExtensionContext, host: NavHost): vscode.Disposable[] {
  let live: vscode.Disposable[] = [];
  const stop = () => { for (const d of live) d.dispose(); live = []; active = undefined; };
  const sync = () => {
    const tours = navTours();
    if (!config().get<boolean>("enabled", true) || !tours) { stop(); return; }
    if (live.length) return;
    const g = new Guided(host, tours);
    active = g;
    live = [g,
      vscode.commands.registerCommand(GUIDED_COMMANDS.saveCurrentPath, () => g.saveCurrentPath()),
      vscode.commands.registerCommand(GUIDED_COMMANDS.addScreen, () => g.addScreen()),
      vscode.commands.registerCommand(GUIDED_COMMANDS.present, (on?: unknown) => g.togglePresent(typeof on === "boolean" ? on : undefined)),
      vscode.commands.registerCommand(GUIDED_COMMANDS.setMode, (mode?: unknown) => (mode === "all" || mode === "learning" || mode === "interview" ? g.setMode(mode) : g.pickMode())),
      // Script-only slot: keys, wheel and mode buttons inside the tours slot; NavTours routes the messages to this extension.
      addNavigatorSlot({ id: "guided", messageTypes: ["guided"], handle: (m) => tours.handle(m), script: guidedScript })];
  };
  sync();
  // NavTours is created or dropped by its own surface (any order): follow its life, not SURFACES order.
  return [onDidChangeNavTours(() => { stop(); sync(); }),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("datapass.guided.enabled")) { stop(); sync(); } }), { dispose: stop }];
}
