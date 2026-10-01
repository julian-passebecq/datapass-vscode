/**
 * V4-NAV NAVTOUR1: journey tours and 'Jump to a box' for the Navigator `#tours` slot (NAVBAR1).
 * Journey buttons, the journey's tours, the active tour's numbered steps (holes marked), prev/next
 * driving the NavigationService (`go` + `view`), and a fuzzy jump over every ladder Location.
 * The same actions are commands: `datapass.nav.tour.{pick,next,prev}` and `datapass.nav.jump`
 * (QuickPick), so tours work without the Navigator too.
 *
 * Tours (`datapass.tour/1`, go/TOUR-PEDA-contract.md): built-in journeys generated from facts
 * (core/navigation/tours/generate.ts) + user/AI-proposed tours read from `.datapass/tours.json`
 * (AI-proposed ones come through the AI exchange, TOURAI1). Words are the label pack (setting
 * `datapass.guided.labels`). `datapass.guided.enabled` off = no commands, no UI, nothing computed.
 */
import * as vscode from "vscode";
import type { NavHost } from "../core/navigation/navHost";
import type { NavLocation } from "../core/navigation/navTypes";
import { generateTours } from "../core/navigation/tours/generate";
import { jumpSearch, type JumpEntry } from "../core/navigation/tours/jump";
import {
  clampPreview, flattenSteps, journeys, ladderLocations, loadTourFile, locationKey, mergeTours, nextStep, prevStep, resolveRef,
  startTour, stepStatus, stepTo, tourOrigin, TOURS_FILE, type LoadedTours, type StepContext, type TourCursor
} from "../core/navigation/tours/store";
import type { Tour } from "../core/navigation/tours/tourTypes";
import { projectRoot } from "../core/workspace/root";
import { labelPack, parseToursMessage, toursHtml, uiLabel, type LabelPack, type ToursModel } from "./navToursHtml";

export const TOUR_COMMANDS = { pick: "datapass.nav.tour.pick", next: "datapass.nav.tour.next", prev: "datapass.nav.tour.prev", jump: "datapass.nav.jump" } as const;

const config = () => vscode.workspace.getConfiguration("datapass.guided");

/** Tour state + actions over the NavHost (one per window). */
export class NavTours implements vscode.Disposable {
  private file: LoadedTours = loadTourFile(undefined);
  private journey: string | null = null;
  private cursor: TourCursor | null = null;
  private query = "";
  private jumpHits: JumpEntry[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [this.emitter];

  constructor(private readonly host: NavHost) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${TOURS_FILE.join("/")}`);
    const navSub = host.nav.onDidChange(() => this.emitter.fire());
    this.subs.push(watcher, { dispose: () => navSub.dispose() },
      watcher.onDidChange(() => void this.reload()), watcher.onDidCreate(() => void this.reload()), watcher.onDidDelete(() => void this.reload()),
      host.session.onDidChange(() => void this.reload()),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("datapass.guided")) this.emitter.fire(); }));
    void this.reload();
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  /** Built-in (facts) + file tours, file tours reusing a built-in id dropped as holes. */
  loaded(): LoadedTours {
    const builtin = config().get<boolean>("generatedJourneys.enabled", true)
      ? generateTours(this.host.session.projectMap(), { locate: this.locate, viewsAt: (l) => this.host.nav.viewsAt(l) }) : [];
    return mergeTours(builtin, this.file);
  }
  tours(): readonly Tour[] { return this.loaded().document.tours; }

  async reload(): Promise<void> {
    const root = projectRoot();
    let text: string | undefined;
    if (root) {
      try { text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...TOURS_FILE))); } catch { text = undefined; }
    }
    this.file = loadTourFile(text);
    this.emitter.fire();
  }

  model(): ToursModel {
    const { document } = this.loaded();
    const tours = document.tours;
    const labels = labelPack(config().get("labels"));
    const js = journeys(tours);
    const active = this.activeTour(tours);
    const journey = this.journey !== null && js.includes(this.journey) ? this.journey : active?.journey ?? js[0] ?? null;
    const ctx = this.stepContext();
    const here = this.host.nav.state.location;
    const flat = active ? flattenSteps(active.steps) : [];
    const current = active && this.cursor ? flat[this.cursor.index] : undefined;
    return {
      labels,
      journeys: js.map((id) => ({ id, label: labels[`journey.${id}`] ?? id, active: id === journey })),
      tours: tours.filter((t) => (t.journey ?? "") === journey).map((t) => {
        const o = tourOrigin(t);
        return { id: t.id, title: this.title(t, labels, document.texts), ...(o === "datapass-guidance" ? {} : { badge: o }), active: t.id === active?.id };
      }),
      steps: flat.map((f, index) => ({
        index, number: f.number, depth: f.path.length - 1, label: this.host.label(f.step.location),
        preview: clampPreview(resolveRef(f.step.explanationRef, document.texts, labels) ?? ""), status: stepStatus(f.step, ctx),
        current: index === this.cursor?.index && f.step.location.nodeId === here.nodeId && f.step.location.level === here.level
      })),
      explanation: current ? resolveRef(current.step.explanationRef, document.texts, labels) ?? null : null,
      canPrev: !!active && (this.cursor?.index ?? 0) > 0, canNext: !!active && (this.cursor?.index ?? 0) < flat.length - 1,
      jump: { query: this.query, hits: this.jumpHits.map((h, index) => ({ index, label: h.label, kind: h.location.artifactKind })) }
    };
  }

  html(): string { return toursHtml(this.model()); }

  /** Navigator `#tours` slot messages. */
  async handle(raw: unknown): Promise<void> {
    const m = parseToursMessage(raw);
    if (!m) return;
    switch (m.action) {
      case "journey": {
        this.journey = m.journey;
        const first = this.tours().find((t) => (t.journey ?? "") === m.journey);
        if (first) this.start(first); else this.emitter.fire();
        return;
      }
      case "select": { const t = this.tours().find((x) => x.id === m.tourId); if (t) this.start(t); return; }
      case "step": return this.goStep(m.index);
      case "next": return this.next();
      case "prev": return this.prev();
      case "jump-query":
        this.query = m.query;
        this.jumpHits = m.query.trim() ? jumpSearch(this.jumpEntries(), m.query, 20) : [];
        this.emitter.fire();
        return;
      case "jump-go": {
        const hit = this.jumpHits[m.index];
        if (hit) { this.query = ""; this.jumpHits = []; this.host.nav.dispatch({ type: "go", location: hit.location }); }
        return;
      }
    }
  }

  start(tour: Tour): void { this.journey = tour.journey ?? ""; this.cursor = startTour(tour); this.show(tour); }
  next(): void { const t = this.activeTour(); if (t && this.cursor) { this.cursor = nextStep(t, this.cursor); this.show(t); } }
  prev(): void { const t = this.activeTour(); if (t && this.cursor) { this.cursor = prevStep(t, this.cursor); this.show(t); } }
  goStep(index: number): void { const t = this.activeTour(); if (t) { this.cursor = stepTo(t, index); this.show(t); } }

  /** QuickPick over every tour (journey as the description). */
  async pick(): Promise<void> {
    const { document } = this.loaded();
    const labels = labelPack(config().get("labels"));
    if (!document.tours.length) { void vscode.window.showInformationMessage(`DataPass: ${uiLabel(labels, "none")}`); return; }
    const pick = await vscode.window.showQuickPick(document.tours.map((t) => {
      const o = tourOrigin(t);
      return { label: this.title(t, labels, document.texts), description: t.journey ? labels[`journey.${t.journey}`] ?? t.journey : undefined,
        detail: o === "datapass-guidance" ? undefined : uiLabel(labels, o === "ai-proposed" ? "aiProposed" : "user"), id: t.id };
    }), { placeHolder: uiLabel(labels, "pickTour"), matchOnDescription: true });
    const t = pick && document.tours.find((x) => x.id === pick.id);
    if (t) this.start(t);
  }

  /** QuickPick 'Jump to a box' (VS Code's own fuzzy filter over label + kind). */
  async jump(): Promise<void> {
    const entries = this.jumpEntries();
    const pick = await vscode.window.showQuickPick(entries.map((e, i) => ({ label: e.label, description: `${e.location.artifactKind} · ${e.location.level}`, i })),
      { placeHolder: uiLabel(labelPack(config().get("labels")), "jump"), matchOnDescription: true });
    const hit = pick && entries[pick.i];
    if (hit) this.host.nav.dispatch({ type: "go", location: hit.location });
  }

  /** Title: the resolved ref, then "first → last" box of the tour so tours of one journey differ. */
  private title(t: Tour, labels: LabelPack, texts: Readonly<Record<string, string>> | undefined): string {
    const base = resolveRef(t.titleRef, texts, labels) ?? t.id;
    if (!t.id.startsWith("datapass.journey.")) return base;
    const first = t.steps[0], last = t.steps[t.steps.length - 1];
    return first && last ? `${base}: ${this.host.label(first.location)} → ${this.host.label(last.location)}` : base;
  }

  private jumpEntries(): JumpEntry[] {
    return ladderLocations(this.host.nav.ladder).map((location) => ({ location, label: this.host.label(location) }));
  }

  private stepContext(): StepContext {
    return { known: new Set(ladderLocations(this.host.nav.ladder).map(locationKey)), viewsAt: (l) => this.host.nav.viewsAt(l) };
  }

  private activeTour(tours: readonly Tour[] = this.tours()): Tour | undefined {
    return this.cursor ? tours.find((t) => t.id === this.cursor!.tourId) : undefined;
  }

  /** Drive the NavigationService to the current step: `go`, then `view`. A step with a hole is shown, not played. */
  private show(tour: Tour): void {
    const f = flattenSteps(tour.steps)[this.cursor!.index];
    const status = f ? stepStatus(f.step, this.stepContext()) : "unknown-location";
    if (f && status !== "unknown-location") {
      this.host.nav.dispatch({ type: "go", location: f.step.location });
      if (status === "ok") this.host.nav.dispatch({ type: "view", viewId: f.step.viewId });
    }
    this.emitter.fire();
  }

  /** The host ladder may know a finer Location for a component (NAVLOC1): reuse it, else the default. */
  private readonly locate = (componentId: string): NavLocation =>
    ladderLocations(this.host.nav.ladder).find((l) => l.nodeId === componentId && l.level === "artifact")
      ?? { level: "artifact", nodeId: componentId, artifactKind: "other" };
}

/** The live instance, for the Navigator slot (NAVBAR1) and desktop tests. */
let activeTours: NavTours | undefined;
export const navTours = (): NavTours | undefined => activeTours;

/** The one line `register.ts` calls. `datapass.guided.enabled` off = nothing registered; it follows the setting live. */
export function registerNavTours(_context: vscode.ExtensionContext, host: NavHost): vscode.Disposable[] {
  let live: vscode.Disposable[] = [];
  const stop = () => { for (const d of live) d.dispose(); live = []; activeTours = undefined; };
  const sync = () => {
    const on = config().get<boolean>("enabled", true);
    if (!on) { stop(); return; }
    if (live.length) return;
    const tours = new NavTours(host);
    activeTours = tours;
    live = [tours,
      vscode.commands.registerCommand(TOUR_COMMANDS.pick, () => tours.pick()),
      vscode.commands.registerCommand(TOUR_COMMANDS.next, () => tours.next()),
      vscode.commands.registerCommand(TOUR_COMMANDS.prev, () => tours.prev()),
      vscode.commands.registerCommand(TOUR_COMMANDS.jump, () => tours.jump())];
  };
  sync();
  return [vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("datapass.guided.enabled")) sync(); }), { dispose: stop }];
}
