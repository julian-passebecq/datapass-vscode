/**
 * V5 STEPBAR1 (Julian 1 Oct 13:45; CEO ARCHI REVIEW B1/B6/B7): the guided path as the normal way to
 * navigate. The "Steps" view (secondary side bar, next to the Navigator) shows TOUR2's step list in
 * its `general` mode by default, each step with its small checks (pass / fail / not checked / hole);
 * checks with no step land in "Project checks" at the end. It is not pedagogy: no cards unless the
 * Learning or Interview mode is chosen. A step click jumps to its Location (NAVTOUR1's own `go` + `view`).
 *
 * The step list stays TOUR2's (B7): this file only extends NavTours (`addExtension`) and picks the
 * default journey: the project's first declared journey (`.datapass/tours.json`), else the first
 * built-in general journey, else the built-in "Explore the project" (project, then sub-projects).
 * The checks are the ones the Project tree used to show (they stay in the Readiness lens), each with
 * the same command its tree node ran; the area → step map is data (`resources/steps/check-steps.json`,
 * setting `datapass.guided.checkSteps`).
 */
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import { flattenSteps, ladderLocations } from "../../core/navigation/tours/store";
import type { Tour } from "../../core/navigation/tours/tourTypes";
import type { ProjectMap } from "../../core/project/projectMap";
import type { Readiness } from "../../core/readiness/readiness";
import {
  assignChecks, checkStepMap, checksFromFiles, checksFromReadiness, exploreSteps, type AssignedChecks, type StepCheck, type StepLike
} from "../../core/steps/stepChecks";
import { guidedScript } from "../guided/guidedHtml";
import { navTours, type NavTours } from "../navTours";
import { labelPack, toursScript, uiLabel } from "../navToursHtml";
import {
  defaultStepsHtml, injectStepChecks, parseStepBarMessage, projectChecksHtml, stepBarPage, stepBarScript, withDefaultSteps, withProjectChecks,
  type DefaultSteps
} from "./stepBarHtml";

export const STEPS_VIEW_ID = "datapass.steps";
/** Links under "Project checks" (the tree's Readiness row and its "Check connections" row). */
const LINKS = [{ command: "datapass.readinessReport", key: "readinessReport" }, { command: "datapass.checkConnections", key: "checkConnections" }] as const;

const guidedConfig = () => vscode.workspace.getConfiguration("datapass.guided");

/** What the bar reads besides the tours: the WorkSession behind the NavHost (duck-typed, kept small for tests). */
export interface StepBarSources {
  readiness(): Readiness | undefined;
  projectMap(): Pick<ProjectMap, "components">;
  /** V5HOLE3: probe these local tools now (the bar shows their checks); never at activation. */
  ensureToolProbes?(ids: Iterable<string>): Promise<void>;
}
export function sourcesOf(host: NavHost): StepBarSources {
  const s = host.session as unknown as { readiness?: () => Readiness; ensureToolProbes?: (ids: Iterable<string>) => Promise<void> };
  return {
    readiness: () => (typeof s.readiness === "function" ? s.readiness() : undefined), projectMap: () => host.session.projectMap(),
    ...(typeof s.ensureToolProbes === "function" ? { ensureToolProbes: (ids: Iterable<string>) => s.ensureToolProbes!.call(s, ids) } : {})
  };
}

/** The first general tour of the project's first declared journey, else of the first built-in general journey. */
export function defaultTour(visible: readonly Tour[], declaredIds: ReadonlySet<string>): Tour | undefined {
  const general = visible.filter((t) => (t.mode ?? "general") === "general");
  const declared = general.find((t) => declaredIds.has(t.id));
  return declared ?? general[0];
}

const stepOf = (f: { step: { id?: string; location: StepLike["location"]; section?: string }; number: string }): StepLike =>
  ({ id: f.step.id ?? f.number, location: f.step.location, ...(f.step.section ? { section: f.step.section } : {}) });

export class StepBar implements vscode.Disposable {
  private readonly subs: vscode.Disposable[] = [];
  private checksById = new Map<string, StepCheck>();
  private assigned: AssignedChecks = { byStep: [], project: [] };
  private defaults: (DefaultSteps & { locations?: readonly StepLike[] }) | undefined;

  constructor(private readonly host: NavHost, private readonly tours: NavTours, private readonly sources: StepBarSources = sourcesOf(host)) {
    this.subs.push(tours.addExtension({
      model: (m) => { this.prepare(); return m; },
      html: (inner) => this.decorate(inner),
      handle: (raw) => this.handle(raw)
    }), vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("datapass.guided.checkSteps")) tours.refresh(); }));
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  private map() { return checkStepMap(guidedConfig().get("checkSteps")); }

  /** Every check the tree used to show, from the session's readiness and expected-file states. */
  checks(): StepCheck[] {
    const r = this.sources.readiness();
    // V5 STEPBAR1: the tool checks moved here from the tree's "Tools & versions", which probed them when opened.
    if (r && this.sources.ensureToolProbes) void this.sources.ensureToolProbes(r.toolchain.entries.filter((e) => e.where === "local").map((e) => e.tool));
    return [...(r ? checksFromReadiness(r) : []), ...checksFromFiles(this.sources.projectMap())];
  }

  /** Steps of the running tour, or of the default journey; checks assigned to them. */
  prepare(): void {
    const map = this.map();
    const all = this.checks();
    this.checksById = new Map(all.map((c) => [c.id, c]));
    const cur = this.tours.current();
    if (cur) {
      const steps = flattenSteps(cur.tour.steps).map(stepOf);
      this.assigned = assignChecks(steps, all, map);
      this.defaults = undefined;
      return;
    }
    const declared = new Set(this.tours.fileDocument().tours.map((t) => t.id));
    const t = defaultTour(this.tours.visible(), declared);
    const steps: StepLike[] = t
      ? flattenSteps(t.steps).map(stepOf)
      : exploreSteps(ladderLocations(this.host.nav.ladder));
    this.assigned = assignChecks(steps, all, map);
    this.defaults = {
      title: t ? this.tours.explain(t.titleRef, undefined, t) ?? t.id : map.labels.explore ?? "Explore the project",
      ...(t ? { tourId: t.id } : { locations: steps }),
      steps: steps.map((s, i) => ({ label: this.host.label(s.location), checks: this.assigned.byStep[i] ?? [] }))
    };
  }

  /** TOUR2's html with the checks per step, the default steps when no tour runs, and "Project checks". */
  decorate(inner: string): string {
    const { labels } = this.map();
    let out = this.defaults
      ? withDefaultSteps(inner, uiLabel(labelPack(guidedConfig().get("labels")), "none"), defaultStepsHtml(this.defaults, labels))
      : injectStepChecks(inner, this.assigned.byStep, labels);
    out = withProjectChecks(out, projectChecksHtml(this.assigned.project, labels, LINKS.map((l) => ({ command: l.command, label: labels[l.key] ?? l.key }))));
    return out;
  }

  /** The bar's clicks: a check runs its tree action; a default step starts its tour there (or goes there). */
  async handle(raw: unknown): Promise<boolean> {
    const m = parseStepBarMessage(raw);
    if (!m) return false;
    switch (m.type) {
      case "step-check": {
        const a = this.checksById.get(m.id)?.action;
        if (a) await vscode.commands.executeCommand(a.command, ...(a.arguments ?? []));
        break;
      }
      case "step-start": {
        const t = this.tours.tours().find((x) => x.id === m.tourId);
        if (t) { this.tours.start(t); if (m.index > 0) this.tours.goStep(m.index); }
        break;
      }
      case "step-go": {
        const s = this.defaults?.locations?.[m.index];
        if (s) this.host.nav.dispatch({ type: "go", location: s.location });
        break;
      }
      case "step-link":
        if (LINKS.some((l) => l.command === m.command)) await vscode.commands.executeCommand(m.command);
        break;
    }
    return true;
  }
}

/** The "Steps" webview view: NavTours' html (with TOUR2's guided header and this bar's checks) in one slot. */
export class StepsView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private ready = false;
  private bar?: StepBar;
  private barTours?: NavTours;
  private toursSub?: vscode.Disposable;

  constructor(private readonly host: NavHost) {}

  /** Attach to the live NavTours (it follows `datapass.guided.enabled`); detach when it goes. */
  sync(): void {
    const tours = navTours();
    if (tours === this.barTours) return;
    this.bar?.dispose(); this.toursSub?.dispose();
    this.bar = undefined; this.toursSub = undefined; this.barTours = tours;
    if (tours) {
      this.bar = new StepBar(this.host, tours);
      this.toursSub = tours.onDidChange(() => void this.post());
    }
    void this.post();
  }

  /** The bar (desktop tests). */
  stepBar(): StepBar | undefined { return this.bar; }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view; this.ready = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = stepBarPage(view.webview.cspSource, nonce(), [toursScript("vscodeApi"), guidedScript("vscodeApi"), stepBarScript("vscodeApi")]);
    view.webview.onDidReceiveMessage((raw: unknown) => {
      if (raw && typeof raw === "object" && (raw as { type?: unknown }).type === "steps-ready") { this.ready = true; void this.post(); return; }
      void this.barTours?.handle(raw);
    });
    view.onDidDispose(() => { this.view = undefined; this.ready = false; });
  }

  /** The html posted to the slot (desktop tests). */
  html(): string {
    return this.barTours ? this.barTours.html() : `<p class="tour-none">${uiLabel(labelPack(guidedConfig().get("labels")), "off")}</p>`;
  }

  private async post(): Promise<void> {
    if (this.view && this.ready) await this.view.webview.postMessage({ type: "tours", html: this.html() });
  }

  dispose(): void { this.bar?.dispose(); this.toursSub?.dispose(); }
}

let active: StepsView | undefined;
/** The live Steps view (desktop tests). */
export const stepsView = (): StepsView | undefined => active;

/** Register the Steps view; it follows NavTours' life (`datapass.guided.enabled`) and repaints when the session changes. */
export function registerStepBar(_context: vscode.ExtensionContext, host: NavHost): vscode.Disposable[] {
  const view = new StepsView(host);
  active = view;
  view.sync();
  return [view,
    vscode.window.registerWebviewViewProvider(STEPS_VIEW_ID, view, { webviewOptions: { retainContextWhenHidden: true } }),
    // After NavTours' own listener (its surface registers first) has re-created or dropped it.
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("datapass.guided.enabled")) view.sync(); }),
    host.session.onDidChange(() => navTours()?.refresh()),
    { dispose: () => { if (active === view) active = undefined; } }];
}

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
