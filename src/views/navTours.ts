/**
 * V4-NAV NAVTOUR1: journey tours and 'Jump to a box' for the Navigator `#tours` slot (NAVBAR1).
 * Journey buttons, the journey's tours, the active tour's numbered steps (stale ones marked), prev/next
 * driving the NavigationService (`go` + `view`), and a fuzzy jump over every ladder Location.
 * The same actions are commands: `datapass.nav.tour.{pick,next,prev}` and `datapass.nav.jump`
 * (QuickPick), so tours work without the Navigator too.
 *
 * Tours: built-in ones generated from facts (core/navigation/tours/generate.ts) + user/AI-proposed
 * ones from `.datapass/tours.json` (read only here; AI-proposed tours come through the AI exchange).
 * Labels and journey names are settings (`datapass.tours.*`), never hard-coded in the logic.
 * The slot is filled by `toursHtml` (escaped, no inline handlers) and driven by `toursScript` +
 * `parseToursMessage`; the Navigator posts `{type:"tours", html}` and forwards `{type:"tour"}` messages.
 */
import * as vscode from "vscode";
import { generateTours } from "../core/navigation/tours/generate";
import { jumpSearch, type JumpEntry } from "../core/navigation/tours/jump";
import {
  journeys, ladderLocations, locationKeys, mergeTours, nextStep, parseToursDoc, prevStep, startTour, stepExists, stepTo,
  type Tour, type TourCursor
} from "../core/navigation/tours/tours";
import type { NavHost } from "../core/navigation/navHost";
import { projectRoot } from "../core/workspace/root";

export const TOUR_COMMANDS = { pick: "datapass.nav.tour.pick", next: "datapass.nav.tour.next", prev: "datapass.nav.tour.prev", jump: "datapass.nav.jump" } as const;
export const TOURS_FILE = [".datapass", "tours.json"] as const;

/** UI words; every one can be overridden by the setting `datapass.tours.labels`. */
import { parseToursMessage, toursHtml, TOURS_LABELS, type ToursLabels, type ToursModel } from "./navToursHtml";

/** Tour state + actions over the NavHost (one per window). */
export class NavTours implements vscode.Disposable {
  private fileTours: Tour[] = [];
  private problems: string[] = [];
  private journey: string | null = null;
  private cursor: TourCursor | null = null;
  private query = "";
  private jumpHits: JumpEntry[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [this.emitter];

  constructor(private readonly host: NavHost) {
    this.subs.push(host.session.onDidChange(() => void this.reload()),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("datapass.tours")) this.emitter.fire(); }));
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${TOURS_FILE.join("/")}`);
    this.subs.push(watcher, watcher.onDidChange(() => void this.reload()), watcher.onDidCreate(() => void this.reload()), watcher.onDidDelete(() => void this.reload()));
    const navSub = host.nav.onDidChange(() => this.emitter.fire());
    this.subs.push({ dispose: () => navSub.dispose() });
    void this.reload();
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  /** Generated (facts) + file tours. */
  tours(): Tour[] {
    const generated = config().get<boolean>("generated", true) ? generateTours(this.host.session.projectMap(), this.locate) : [];
    return mergeTours(generated, this.fileTours);
  }

  async reload(): Promise<void> {
    const root = projectRoot();
    let text: string | undefined;
    if (root) {
      try { text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...TOURS_FILE))); } catch { text = undefined; }
    }
    const parsed = parseToursDoc(text);
    this.fileTours = parsed.tours;
    this.problems = parsed.problems;
    this.emitter.fire();
  }

  model(): ToursModel {
    const tours = this.tours();
    const labels = toursLabels();
    const names = config().get<Record<string, string>>("journeyLabels", {}) ?? {};
    const js = journeys(tours);
    const journey = this.journey && js.includes(this.journey) ? this.journey : this.activeTour(tours)?.journey ?? js[0] ?? null;
    const active = this.activeTour(tours);
    const keys = locationKeys(ladderLocations(this.host.nav.ladder));
    const here = this.host.nav.state.location;
    return {
      labels,
      journeys: js.map((id) => ({ id, label: typeof names[id] === "string" ? names[id] : id, active: id === journey })),
      tours: tours.filter((t) => t.journey === journey).map((t) => ({ id: t.id, title: t.title, origin: t.origin, active: t.id === active?.id })),
      steps: active ? active.steps.map((s, index) => ({
        index, label: this.host.label(s.location), text: s.text, stale: !stepExists(s, keys),
        current: index === this.cursor!.index && s.location.nodeId === here.nodeId && s.location.level === here.level
      })) : [],
      canPrev: !!active && this.cursor!.index > 0, canNext: !!active && this.cursor!.index < active.steps.length - 1,
      jump: { query: this.query, hits: this.jumpHits.map((h, index) => ({ index, label: h.label, kind: h.location.artifactKind })) },
      problems: this.problems
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
        const first = this.tours().find((t) => t.journey === m.journey);
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

  start(tour: Tour): void {
    this.journey = tour.journey;
    this.cursor = startTour(tour);
    this.show(tour);
  }
  next(): void { const t = this.activeTour(); if (t && this.cursor) { this.cursor = nextStep(t, this.cursor); this.show(t); } }
  prev(): void { const t = this.activeTour(); if (t && this.cursor) { this.cursor = prevStep(t, this.cursor); this.show(t); } }
  goStep(index: number): void { const t = this.activeTour(); if (t && this.cursor) { this.cursor = stepTo(t, this.cursor, index); this.show(t); } }

  /** QuickPick over every tour (journey as the group). */
  async pick(): Promise<void> {
    const tours = this.tours();
    const L = toursLabels();
    if (!tours.length) { void vscode.window.showInformationMessage(`DataPass: ${L.none}`); return; }
    const names = config().get<Record<string, string>>("journeyLabels", {}) ?? {};
    const pick = await vscode.window.showQuickPick(tours.map((t) => ({
      label: t.title, description: names[t.journey] ?? t.journey,
      detail: `${t.steps.length} · ${t.origin === "ai-proposed" ? L.aiProposed : t.origin === "user" ? L.user : ""}`.replace(/ · $/, ""), id: t.id
    })), { placeHolder: L.pickTour, matchOnDescription: true });
    const t = pick && tours.find((x) => x.id === pick.id);
    if (t) this.start(t);
  }

  /** QuickPick 'Jump to a box' (VS Code's own fuzzy filter over label + kind). */
  async jump(): Promise<void> {
    const entries = this.jumpEntries();
    const pick = await vscode.window.showQuickPick(entries.map((e, i) => ({ label: e.label, description: `${e.location.artifactKind} · ${e.location.level}`, i })),
      { placeHolder: toursLabels().jump, matchOnDescription: true });
    if (pick) this.host.nav.dispatch({ type: "go", location: entries[pick.i]!.location });
  }

  private jumpEntries(): JumpEntry[] {
    return ladderLocations(this.host.nav.ladder).map((location) => ({ location, label: this.host.label(location) }));
  }

  private activeTour(tours = this.tours()): Tour | undefined {
    return this.cursor ? tours.find((t) => t.id === this.cursor!.tourId) : undefined;
  }

  /** Drive the NavigationService to the current step: `go`, then `view` when the step names an offered view. Stale steps are skipped silently (shown as holes). */
  private show(tour: Tour): void {
    const step = tour.steps[this.cursor!.index];
    const keys = locationKeys(ladderLocations(this.host.nav.ladder));
    if (step && stepExists(step, keys)) {
      this.host.nav.dispatch({ type: "go", location: step.location });
      if (step.viewId && this.host.nav.views().some((v) => v.id === step.viewId)) this.host.nav.dispatch({ type: "view", viewId: step.viewId });
    }
    this.emitter.fire();
  }

  /** The host ladder may know a finer Location for a component (NAVLOC1): reuse it, else the default. */
  private readonly locate = (componentId: string) => {
    const found = ladderLocations(this.host.nav.ladder).find((l) => l.nodeId === componentId && l.level === "artifact");
    return found ?? { level: "artifact" as const, nodeId: componentId, artifactKind: "other" };
  };
}

const config = () => vscode.workspace.getConfiguration("datapass.tours");
function toursLabels(): ToursLabels {
  const o = config().get<Record<string, unknown>>("labels", {}) ?? {};
  const out = { ...TOURS_LABELS } as ToursLabels;
  for (const k of Object.keys(out) as (keyof ToursLabels)[]) if (typeof o[k] === "string" && (o[k] as string).length <= 200) out[k] = o[k] as string;
  return out;
}

/** The one line `register.ts` calls. */
export function registerNavTours(_context: vscode.ExtensionContext, host: NavHost): vscode.Disposable[] {
  const tours = new NavTours(host);
  activeTours = tours;
  return [
    tours,
    { dispose: () => { if (activeTours === tours) activeTours = undefined; } },
    vscode.commands.registerCommand(TOUR_COMMANDS.pick, () => tours.pick()),
    vscode.commands.registerCommand(TOUR_COMMANDS.next, () => tours.next()),
    vscode.commands.registerCommand(TOUR_COMMANDS.prev, () => tours.prev()),
    vscode.commands.registerCommand(TOUR_COMMANDS.jump, () => tours.jump())
  ];
}

/** The live instance, for the Navigator slot (NAVBAR1) and desktop tests. */
let activeTours: NavTours | undefined;
export const navTours = (): NavTours | undefined => activeTours;
