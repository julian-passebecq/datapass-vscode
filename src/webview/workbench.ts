/**
 * DataPass Workbench webview (browser side). Renders the state posted by the extension in one of
 * three modes: "full" (editor tab with four views: architecture, options, project sheet, board),
 * "map" (bottom panel: diagram of the selected sub-project) and "detail" (secondary side bar: the
 * selection's files, operations by phase, data and formulas, options, cards and actions).
 *
 * Safety: text is always set with textContent (never innerHTML); the only messages sent back are
 * select / openFile / preview / command, and the extension validates each against the project.
 */
import type { WbComponent, WbDecision, WbGit, WbImpact, WbOperation, WbOption, WbOrder, WbReadiness, WbRepository, WbScenario, WbSubproject, WorkbenchState } from "../views/workbenchState";
import type { CardView } from "../core/project/board";
import type { WbTool } from "../views/toolkitState";
import type { RecipeRouteView, RecipeView } from "../core/toolkit/toolkit";
import { formatAmounts, formatCostLine, formatCostTotal, partialLabel, sumCostLines, type CostTotal } from "../core/project/costs";
import { crossCount, layerCount, layoutGraph, sizeForWidth, sizeForWidthVertical, type Direction, type Layout, type LayoutEdgeInput } from "../core/project/layout";
import { buildDiagram, GROUP_BY, GROUP_BY_LABELS, type DiagramComponent, type DiagramModel, type GroupBy } from "../core/project/diagramModel";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };

const vscode = acquireVsCodeApi();
const MODE = (document.body.dataset.mode ?? "full") as "full" | "map" | "detail";
const root = document.getElementById("app")!;
let state: WorkbenchState | undefined;

type View = "architecture" | "options" | "sheet" | "board" | "workOrders" | "toolkit";
type SheetSection = "datasets" | "formulas" | "runtimes" | "glossary";
const CARD_TYPES = ["task", "bug", "feature", "decision", "question"] as const;
interface Ui {
  collapsed: Record<string, boolean>;
  zoom: "fit" | "100";
  view: View;
  dir: Direction;
  groupBy: GroupBy;
  /** Folded diagram lanes ("lane:<id>") and parents ("parent:<id>"). */
  folded: string[];
  /** Options view: "scenarios" or a decision id. */
  optFocus?: string;
  /** Options view: the option whose consequences the side column shows. */
  optOption?: string;
  /** Options view: the custom combination being built (decision → option). */
  custom: Record<string, string>;
  sheetSection: SheetSection;
  sheetFocus?: string;
  /** Board view: the selected card and the filters (sub-project, sprint or "-" for none, types, text). */
  boardFocus?: string;
  boardSub?: string;
  boardSprint?: string;
  boardTypes: string[];
  boardQuery?: string;
  /** Work orders view: which orders are listed. */
  woFilter?: "all" | "open" | "needs" | "done";
  /** Toolkit view (0.23): section, selection ("tool:<id>" / "recipe:<id>") and filters. */
  tkSection?: "tools" | "recipes" | "requests" | "files";
  tkFocus?: string;
  tkModule?: string;
  tkQuery?: string;
}
const ui = ((vscode.getState() as Partial<Ui> | undefined) ?? {}) as Ui;
ui.collapsed ??= {};
ui.zoom ??= "fit";
ui.view ??= "architecture";
ui.dir ??= "LR";
ui.groupBy ??= "none";
ui.folded ??= [];
ui.custom ??= {};
ui.sheetSection ??= "datasets";
ui.boardTypes ??= [];
/**
 * 0.17: the diagram settings (and the Workbench tab's view) are also reported to the extension, so a
 * work view can save them; a work view applied there comes back as a "ui" message.
 */
const diagramUi = () => ({ view: MODE === "full" ? ui.view : undefined, dir: ui.dir, groupBy: ui.groupBy, folded: ui.folded, zoom: ui.zoom });
let reportedUi = "";
const saveUi = () => {
  vscode.setState(ui);
  if (MODE === "detail") return;
  const now = JSON.stringify(diagramUi());
  if (now === reportedUi) return;
  reportedUi = now;
  vscode.postMessage({ type: "ui", ui: diagramUi() });
};
function applyHostUi(u: Partial<Ui> | undefined): void {
  if (!u || typeof u !== "object" || MODE === "detail") return;
  if (u.dir === "LR" || u.dir === "TB") ui.dir = u.dir;
  if (typeof u.groupBy === "string" && (GROUP_BY as readonly string[]).includes(u.groupBy)) ui.groupBy = u.groupBy;
  if (Array.isArray(u.folded)) ui.folded = u.folded.filter((f): f is string => typeof f === "string").slice(0, 100);
  if (u.zoom === "fit" || u.zoom === "100") ui.zoom = u.zoom;
  if (MODE === "full" && (u.view === "architecture" || u.view === "options" || u.view === "sheet" || u.view === "board" || u.view === "workOrders" || u.view === "toolkit")) ui.view = u.view;
  reportedUi = JSON.stringify(diagramUi());
  vscode.setState(ui);
}

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | undefined | null | false;

function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== undefined && c !== null && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const send = (message: unknown) => vscode.postMessage(message);
const command = (id: string, ...args: unknown[]) => send({ type: "command", command: id, args });
const select = (subproject?: string, component?: string) => send({ type: "select", subproject, component });
const previewScenario = (scenario: string) => send({ type: "preview", scenario });
const previewPicks = (picks: string[]) => send({ type: "preview", picks });
const btn = (label: string, onclick: () => void, opts: { kind?: "primary" | "secondary" | "link" | "danger"; title?: string; disabled?: boolean; icon?: string } = {}) =>
  h("button", { class: `btn ${opts.kind ?? "secondary"}`, title: opts.title, disabled: opts.disabled, onclick: () => onclick(), type: "button" }, opts.icon ? h("span", { class: "ico", "aria-hidden": "true", text: opts.icon }) : undefined, label);

const HEALTH_TEXT: Record<string, string> = { ok: "ready", attention: "attention", blocked: "blocked", planned: "planned", info: "info" };
const FILE_STATE: Record<string, [string, string]> = {
  found: ["found", "ok"], missing: ["missing", "bad"], unbound: ["not cloned", "warn"], planned: ["repo planned", "muted"], unknown: ["not checked", "muted"]
};
const OP_STATE: Record<string, string> = { ready: "ok", blocked: "bad", "needs-config": "warn", "needs-review": "info", unknown: "muted", unsupported: "bad" };
const REPO_STATE: Record<string, [string, string]> = {
  local: ["cloned", "ok"], unbound: ["not cloned", "warn"], planned: ["planned", "muted"], missing: ["not found", "bad"],
  "wrong-remote": ["wrong clone", "bad"], "not-a-repo": ["no Git", "warn"], restricted: ["not inspected", "muted"], unverified: ["unverified", "warn"]
};
const SUPPORT_TEXT: Record<string, [string, string]> = { operations: ["DataPass operations", "ok"], files: ["files only", "info"], unsupported: ["not supported yet", "warn"] };
const DIFF_TEXT: Record<string, string> = { added: "new", replaced: "changed", removed: "removed" };
const pill = (text: string, tone: string, title?: string) => h("span", { class: `pill ${tone}`, text, title });
const eyebrow = (text: string) => h("div", { class: "eyebrow", text });
/** A component as the diagram shows it: the previewed architecture's version first (added or changed), else the project's. */
/** 0.23: a coding-state pill (coded / partly coded / not coded / not checked here), when the mode shows it. */
const CODING_TONE: Record<string, string> = { coded: "ok", "partly-coded": "warn", "not-coded": "muted", unknown: "muted" };
const codingPill = (c: { state: string; label: string; reason: string } | undefined) => c ? pill(c.label, CODING_TONE[c.state] ?? "muted", c.reason) : undefined;

/** 0.22 modes: decisions of options.json that can change a component (the "alternatives exist" marker). */
const alternativesOf = (s: WorkbenchState, id: string) => s.experience?.alternatives === false ? [] : (s.options?.decisions ?? []).filter(d => d.concerns.includes(id)).map(d => d.title);
const comp = (id: string | undefined) => state?.preview?.components.find(c => c.id === id) ?? state?.components.find(c => c.id === id);
const inPreviewOnly = (id: string | undefined) => Boolean(id && !state?.components.some(c => c.id === id) && state?.preview?.components.some(c => c.id === id));
const subp = (id: string | undefined) => state?.subprojects.find(s => s.id === id);
const repoOf = (key: string | undefined) => state?.repositories.find(r => r.key === key);
const ago = (iso?: string) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
// 0.22 (F01, F08): one aggregation everywhere; amounts per currency, "partial" when a part has no figure.
const money = (amounts: Record<string, number>, suffix: string) => formatAmounts(amounts, suffix);
const withPartial = (text: string, t: CostTotal) => [text, partialLabel(t)].filter(Boolean).join(" · ");

function toggle(key: string) {
  ui.collapsed[key] = !ui.collapsed[key];
  saveUi();
  render();
}

// ------------------------------------------------------------------ empty states

function emptyState(s: WorkbenchState): HTMLElement | undefined {
  if (!s.hasRoot) return h("div", { class: "empty" }, h("h2", { text: "Open a project folder" }), h("p", { class: "muted", text: "DataPass works on a folder (or a repository) that holds .datapass/project.json." }), btn("Open folder…", () => command("vscode.openFolder"), { kind: "primary" }), btn("Switch project…", () => command("datapass.switchProject")));
  if (!s.hasManifest) return h("div", { class: "empty" },
    h("h2", { text: "No DataPass project here yet" }),
    h("p", { class: "muted", text: "A project is described by .datapass/project.json (repositories, sub-projects, environments) and .datapass/graph.json (components, their files and operations). Your AI assistant can prepare both from the guide; DataPass then shows what exists, what is missing and where." }),
    h("div", { class: "row" }, btn("Initialize project manifest", () => command("datapass.initializeProjectManifest"), { kind: "primary" }), btn("Open the preparation guide", () => command("datapass.openPreparationGuide")), btn("Switch project…", () => command("datapass.switchProject"))));
  if (s.manifestErrors.length) return h("div", { class: "empty" },
    h("h2", { text: "The project manifest has errors" }),
    h("ul", { class: "problems" }, ...s.manifestErrors.map(e => h("li", { text: e }))),
    h("div", { class: "row" }, btn("Open project.json", () => command("datapass.openProjectManifest"), { kind: "primary" })));
  return undefined;
}

// ------------------------------------------------------------------ header (full mode)

function viewTabs(s: WorkbenchState): HTMLElement {
  const tab = (id: View, label: string, badge?: string) => h("button", {
    class: `vtab ${ui.view === id ? "active" : ""}`, role: "tab", type: "button", "aria-selected": String(ui.view === id),
    onclick: () => { ui.view = id; saveUi(); render(); }
  }, label, badge ? h("span", { class: "vbadge", text: badge }) : undefined);
  const hidden = s.experience?.hiddenViews ?? [];
  const shown = (id: View) => id === ui.view || !hidden.includes(id);
  const decisions = s.options?.decisions.length;
  const sheetCount = s.sheet ? s.sheet.datasets.length + s.sheet.formulas.length + s.sheet.runtimes.length : undefined;
  return h("div", { class: "vtabs", role: "tablist", "aria-label": "Workbench views" },
    tab("architecture", "Architecture"),
    shown("options") ? tab("options", "Options", s.optionsError ? "!" : decisions ? String(decisions) : undefined) : undefined,
    shown("sheet") ? tab("sheet", "Project sheet", s.sheetError ? "!" : sheetCount ? String(sheetCount) : undefined) : undefined,
    shown("board") ? tab("board", "Board", s.boardError ? "!" : s.board ? String(s.board.summary.open) : undefined) : undefined,
    shown("workOrders") ? tab("workOrders", "Work orders", s.workOrders?.needs ? `${s.workOrders.needs}!` : s.workOrders?.open ? String(s.workOrders.open) : undefined) : undefined,
    shown("toolkit") ? tab("toolkit", "Toolkit", s.toolkit && (s.toolkit.requests.length || s.toolkit.newerFiles || s.toolkit.files.some(f => f.error)) ? "!" : undefined) : undefined);
}

function header(s: WorkbenchState): HTMLElement {
  const sum = s.summary;
  const behind = s.repositories.reduce((n, r) => n + (r.behind ?? 0), 0);
  return h("header", { class: "top" },
    h("div", { class: "title" },
      eyebrow("DataPass · Project workbench"),
      h("h1", { text: s.project?.title ?? "Project" }),
      s.project?.description ? h("p", { class: "muted small", text: s.project.description }) : undefined),
    h("div", { class: "chips" },
      sum ? pill(`${sum.filesFound}/${sum.filesExpected} files`, sum.filesMissing ? "warn" : "ok", "Expected files found on this machine") : undefined,
      sum ? pill(`${sum.opsReady}/${sum.opsTotal} operations ready`, sum.opsReady === sum.opsTotal ? "ok" : "info") : undefined,
      sum?.reposToBind ? pill(`${sum.reposToBind} repo(s) to clone or create`, "warn") : undefined,
      behind ? pill(`${behind} commit(s) to get`, "info", "New commits on the remote (as of the last check)") : undefined,
      !s.trusted ? pill("Restricted Mode", "warn", "Git is not read in an untrusted workspace") : undefined,
      pill(`inspected ${ago(s.observedAt)}`, "muted")),
    h("div", { class: "row actions" },
      viewTabs(s),
      h("span", { class: "grow" }),
      btn("Re-inspect", () => command("datapass.refreshProject"), { icon: "⟳", title: "Read the files and Git state again (no network)" }),
      btn("Check for updates", () => command("datapass.checkForUpdates"), { icon: "⇣", title: "git fetch every cloned repository: see what the AI pushed, change nothing yet" }),
      btn("Prepare AI context", () => command("datapass.preparationPack", {}), { icon: "✦" }),
      btn("Layout", () => command("datapass.arrangeWorkbench"), { icon: "▦", title: "Show the Project tree, the architecture panel and the details side bar" }),
      btn("Work views", () => command("datapass.openSwitcher"), { icon: "▤", title: "Saved layouts of this window, sub-projects and other projects (also in the status bar, bottom left)" }),
      btn("Own window", () => command("datapass.openWorkbenchFloating"), { icon: "⧉", title: "Move this Workbench tab into a floating window (for a second screen); it stays part of this VS Code window" })));
}

/** One line saying which architecture the diagram shows, when it is not the current one. */
function previewBanner(s: WorkbenchState): HTMLElement | undefined {
  const p = s.preview;
  if (!p) return undefined;
  const i = p.impact;
  const parts = [
    `${i.components.added.length ? `+${i.components.added.length} ` : ""}${i.components.removed.length ? `−${i.components.removed.length} ` : ""}${i.components.replaced.length ? `~${i.components.replaced.length} ` : ""}component(s)`,
    i.tools.newlyNeeded.length ? `${i.tools.newlyNeeded.length} new official tool(s)${i.tools.newlyNeeded.some(t => t.state === "absent") ? ", some not installed" : ""}` : "no new tool",
    withPartial(money(i.costs.monthly, "/month"), i.costs.total) || undefined
  ].filter(Boolean);
  return h("div", { class: "banner preview", role: "status" },
    h("b", { text: `Active variant: ${p.title}`, title: "This machine's working choice (remembered per project, never written in a repository). Record decision in Options commits a choice." }),
    codingPill(s.coding?.preview),
    h("span", { class: "muted small", text: ` · ${parts.join(" · ")} · this machine only: graph.json is unchanged` }),
    h("span", { class: "grow" }),
    btn("Compare", () => { ui.view = "options"; ui.optFocus = "scenarios"; saveUi(); if (MODE === "full") render(); else command("datapass.openOptions"); }, { kind: "link" }),
    btn("Back to current", () => previewScenario("current"), { kind: "link" }));
}

// ------------------------------------------------------------------ navigation (architecture view)

function nav(s: WorkbenchState): HTMLElement {
  const sel = s.selection;
  const items: HTMLElement[] = [eyebrow("Sub-projects")];
  items.push(h("button", { class: `navrow ${!sel.subproject && !sel.component ? "active" : ""}`, type: "button", "aria-pressed": String(!sel.subproject && !sel.component), onclick: () => select(undefined, undefined) }, h("span", { class: "label", text: "Overview" })));
  for (const sp of s.subprojects) {
    const open = !ui.collapsed[`sp:${sp.id}`];
    const active = sel.subproject === sp.id && !sel.component;
    items.push(h("div", { class: "navgroup" },
      h("div", { class: "navhead" },
        h("button", { class: "twisty", type: "button", "aria-expanded": String(open), title: open ? "Collapse" : "Expand", onclick: () => toggle(`sp:${sp.id}`), text: open ? "▾" : "▸" }),
        h("button", { class: `navrow ${active ? "active" : ""}`, type: "button", "aria-pressed": String(active), onclick: () => select(sp.id, undefined) },
          h("span", { class: `dot h-${sp.health}`, "aria-hidden": "true" }), h("span", { class: "label", text: sp.title }), h("span", { class: "meta", text: `${sp.summary.filesFound}/${sp.summary.filesExpected}` }))),
      open ? h("div", { class: "navchildren" }, ...sp.componentIds.map(id => comp(id)).filter((c): c is WbComponent => !!c).map(c => {
        const on = sel.component === c.id;
        return h("button", { class: `navrow sub ${on ? "active" : ""}`, type: "button", "aria-pressed": String(on), title: c.headline, onclick: () => select(sp.id, c.id) },
          h("span", { class: "glyph", text: c.providerGlyph, "aria-hidden": "true" }), h("span", { class: "label", text: c.label }), h("span", { class: `dot h-${c.health}`, title: HEALTH_TEXT[c.health] }));
      })) : undefined));
  }
  items.push(h("div", { class: "divider" }), eyebrow("Repositories"));
  for (const r of s.repositories) items.push(repoRow(r, true));
  if (s.problems.some(p => p.severity !== "info")) {
    items.push(h("div", { class: "divider" }), eyebrow("Problems in project files"));
    for (const p of s.problems.filter(p => p.severity !== "info").slice(0, 8)) items.push(h("div", { class: `problem ${p.severity}` }, h("b", { text: p.where }), h("span", { text: p.message })));
  }
  items.push(h("div", { class: "divider" }), h("p", { class: "muted small", text: "The code stays in its repository. DataPass explains, checks and routes you to the official tool; it never deploys by itself." }));
  return h("nav", { class: "nav", "aria-label": "Project navigation" }, ...items);
}

const WEB_SHORT: Record<string, (host: string) => string> = {
  repository: host => `${host} ↗`, "pull-requests": host => (host === "GitLab" ? "Merge requests" : "Pull requests"),
  pipelines: host => (host === "GitHub" ? "Actions" : "Pipelines"), boards: host => (host === "Azure DevOps" ? "Boards" : "Issues")
};

function repoRow(r: WbRepository, compact: boolean): HTMLElement {
  const [text, tone] = REPO_STATE[r.state] ?? [r.state, "muted"];
  const actions: HTMLElement[] = [];
  if (r.state === "unbound" || r.state === "missing" || r.state === "wrong-remote") {
    if (r.remote) actions.push(btn("Clone", () => command("datapass.cloneRepository", r.key), { kind: "link", title: `Clone ${r.remote} next to this project (you confirm first)` }));
    actions.push(btn("Locate", () => command("datapass.locateRepository", r.key), { kind: "link", title: "Point DataPass to an existing clone on this machine" }));
  }
  // 0.22 (F04): a clone whose origin could not be compared: browse it, but prove it before updating it.
  if (r.state === "unverified") {
    actions.push(btn("Locate", () => command("datapass.locateRepository", r.key), { kind: "link", title: "Point DataPass to the right clone on this machine" }));
    actions.push(btn("Retry", () => command("datapass.refreshProject"), { kind: "link", title: "Read the clone's origin again" }));
  }
  if (r.state === "local" && !r.coordination) actions.push(btn("Open", () => command("datapass.openRepositoryWindow", r.key), { kind: "link", title: "Open this repository in a new window" }));
  if (r.state === "local" && (r.behind ?? 0) > 0) actions.push(btn(`Get ${r.behind}`, () => command("datapass.getUpdates", r.key), { kind: "link", title: "Fast-forward to the commits already fetched (you confirm first)" }));
  // 0.16: the repository's pages on its Git host (the address is shown before the browser opens).
  if (r.links.length && r.host) {
    if (compact) actions.push(btn(`${r.host} ↗`, () => command("datapass.openRepositoryWeb", r.key), { kind: "link", title: "Repository, pull requests, pipelines, boards or issues on the web" }));
    else for (const l of r.links) actions.push(btn(WEB_SHORT[l.id]?.(r.host) ?? l.label, () => command("datapass.openRepositoryWeb", r.key, l.id), { kind: "link", title: `${l.label} on ${r.host}` }));
  }
  return h("div", { class: `repo ${compact ? "compact" : ""}` },
    h("div", { class: "repohead" }, h("span", { class: "label", text: r.label, title: r.remote ?? "" }), pill(text, tone)),
    h("div", { class: "muted small", text: r.state === "local" ? [r.branch ? `${r.branch}` : undefined, r.detail].filter(Boolean).join(" · ") : r.remote ?? r.detail }),
    actions.length ? h("div", { class: "row tight" }, ...actions) : undefined);
}

// ------------------------------------------------------------------ diagram

function diagramToolbar(s: WorkbenchState): HTMLElement {
  const seg = (d: Direction, label: string, title: string) => h("button", {
    class: `seg ${ui.dir === d ? "active" : ""}`, type: "button", "aria-pressed": String(ui.dir === d), title,
    onclick: () => { ui.dir = d; saveUi(); render(); }
  }, label);
  const groupSel = h("select", { class: "sel", "aria-label": "Group components by", title: "Group components in lanes", onchange: (e: Event) => { ui.groupBy = (e.target as HTMLSelectElement).value as GroupBy; ui.folded = ui.folded.filter(f => f.startsWith("parent:")); saveUi(); render(); } },
    ...GROUP_BY.map(g => { const o = h("option", { value: g, text: g === "none" ? "No grouping" : `Group: ${GROUP_BY_LABELS[g]}` }) as HTMLOptionElement; o.selected = ui.groupBy === g; return o; }));
  const parts: HTMLElement[] = [
    h("div", { class: "segs", role: "group", "aria-label": "Orientation" }, seg("LR", "⇄ Horizontal", "Left to right"), seg("TB", "⇅ Vertical", "Top to bottom")),
    groupSel
  ];
  if (s.options) {
    const current = s.preview ? (s.preview.key.startsWith("scenario:") ? s.preview.key.slice(9) : "custom") : "current";
    const opts: Array<[string, string]> = [["current", "Architecture: current"], ...s.options.scenarios.filter(x => x.id !== "current").map(x => [x.id, `Variant: ${x.title}${x.recommended ? " ★" : ""}`] as [string, string])];
    if (current === "custom") opts.push(["custom", `Variant: ${s.preview!.title}`]);
    const previewSel = h("select", { class: "sel", "aria-label": "Active variant", title: "The active variant: the tree, Details, the diagram and the packs for your AI follow it (this machine only: nothing is written)", onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v !== "custom") previewScenario(v); } },
      ...opts.map(([v, t]) => { const o = h("option", { value: v, text: t }) as HTMLOptionElement; o.selected = v === current; return o; }));
    parts.push(previewSel);
  }
  if (ui.folded.length) parts.push(btn("Unfold all", () => { ui.folded = []; saveUi(); render(); }, { kind: "link" }));
  parts.push(h("span", { class: "grow" }), btn(ui.zoom === "fit" ? "100%" : "Fit", () => { ui.zoom = ui.zoom === "fit" ? "100" : "fit"; saveUi(); render(); }, { kind: "link", title: ui.zoom === "fit" ? "Show at full size (scroll)" : "Fit the diagram to the view" }));
  return h("div", { class: "dtoolbar" }, ...parts);
}

/** The diagram frame; the canvas is drawn by drawDiagrams() once the frame's width is known. */
function diagram(s: WorkbenchState): HTMLElement {
  const ids = s.preview?.diagram.nodeIds ?? s.diagram.nodeIds;
  if (!ids.length) {
    return h("div", { class: "diagram empty-diagram" }, h("p", { class: "muted", text: s.components.length ? "No component in this sub-project yet." : "No components yet: describe them in .datapass/graph.json (graph version 0.2), or ask your AI to prepare it." }),
      btn("Open graph.json", () => command("datapass.openGraph"), { kind: "link" }));
  }
  const legend = h("div", { class: "legend" },
    h("span", { class: "lg data", text: "data" }), h("span", { class: "lg control", text: "orchestration" }), h("span", { class: "lg dependency", text: "dependency" }),
    s.preview ? h("span", { class: "lg-diff" }, h("span", { class: "tag added", text: "new" }), h("span", { class: "tag replaced", text: "changed" }), h("span", { class: "tag removed", text: "removed" })) : undefined,
    h("span", { class: "muted small grow", text: "Click a component to select it; double-click opens its entry file. The diagram never runs anything." }));
  return h("div", { class: "diagram" }, diagramToolbar(s), h("div", { class: "scroller", "data-diagram": "1" }), legend);
}

function diagramModel(s: WorkbenchState): DiagramModel {
  const components = new Map<string, DiagramComponent>();
  const add = (c: { id: string; label: string; kind: string; subprojects: string[]; repoKey?: string; parent?: string; children?: string[] }, providerId?: string) =>
    components.set(c.id, { id: c.id, label: c.label, providerId, kind: c.kind, subprojects: c.subprojects, repoKey: c.repoKey, parent: c.parent, children: c.children ?? [] });
  for (const c of s.components) add(c, c.providerId);
  for (const g of s.preview?.ghosts ?? []) if (!components.has(g.id)) add(g, g.providerId);
  for (const c of s.preview?.components ?? []) add(c, c.providerId);
  const edges = s.preview?.diagram.edges ?? s.diagram.edges;
  return buildDiagram({
    components, nodeIds: s.preview?.diagram.nodeIds ?? s.diagram.nodeIds, edges, groupBy: ui.groupBy, collapsed: new Set(ui.folded),
    labels: { subprojects: Object.fromEntries(s.subprojects.map(x => [x.id, x.title])), repositories: Object.fromEntries(s.repositories.map(r => [r.key, r.label])) },
    diff: s.preview?.diff
  });
}

/** Lay out and draw every diagram frame for the width (and, in the panel, the height) it has. */
function drawDiagrams(): void {
  const s = state;
  if (!s) return;
  for (const scroller of Array.from(document.querySelectorAll<HTMLElement>(".diagram .scroller[data-diagram]"))) {
    const availW = Math.max(200, scroller.clientWidth - 2);
    const availH = MODE === "map" ? Math.max(120, window.innerHeight - scroller.getBoundingClientRect().top - 44) : Infinity;
    const model = diagramModel(s);
    const ids = model.nodes.map(n => n.id);
    const edges: LayoutEdgeInput[] = model.edges;
    const lanes = ui.groupBy === "none" ? undefined : { of: model.laneOf, order: model.laneOrder, labels: model.laneLabels };
    const size = ui.zoom === "100" ? {} : ui.dir === "LR" ? sizeForWidth(availW, layerCount(ids, edges)) : sizeForWidthVertical(availW, crossCount(ids, edges, lanes));
    const L = layoutGraph(ids, edges, { ...size, direction: ui.dir, lanes });
    const scale = ui.zoom === "100" ? 1 : Math.max(0.6, Math.min(1, availW / L.width, availH / L.height));
    scroller.replaceChildren(h("div", { class: "sizer", style: `width:${Math.ceil(L.width * scale)}px;height:${Math.ceil(L.height * scale)}px` }, canvasFor(s, model, L, scale)));
    scroller.dataset.drawnWidth = String(availW);
    frames.observe(scroller);
  }
}

/** Redraw a diagram when its frame's width really changed (panel resized, side bar toggled, window resized). */
let redrawTimer: number | undefined;
const frames = new ResizeObserver(entries => {
  const changed = entries.some(e => Math.abs(Math.max(200, (e.target as HTMLElement).clientWidth - 2) - Number((e.target as HTMLElement).dataset.drawnWidth ?? 0)) > 8);
  if (!changed) return;
  if (redrawTimer) clearTimeout(redrawTimer);
  redrawTimer = window.setTimeout(drawDiagrams, 60);
});

function fold(key: string): void {
  ui.folded = ui.folded.includes(key) ? ui.folded.filter(k => k !== key) : [...ui.folded, key];
  saveUi();
  render();
}

function canvasFor(s: WorkbenchState, model: DiagramModel, L: Layout, scale: number): HTMLElement {
  const compact = (L.nodes[0]?.w ?? 184) < 170;
  const canvas = h("div", { class: `canvas${compact ? " compact" : ""}`, style: `width:${L.width}px;height:${L.height}px;${scale < 1 ? `transform:scale(${scale});` : ""}` });
  for (const lane of L.lanes) {
    const info = model.lanes.find(l => l.id === lane.id);
    canvas.append(h("div", { class: `lane dir-${L.direction}`, style: `left:${lane.x}px;top:${lane.y}px;width:${lane.w}px;height:${lane.h}px` },
      h("button", { class: "lanehead", type: "button", "aria-expanded": String(!info?.collapsed), title: info?.collapsed ? "Unfold this group" : "Fold this group into one box", onclick: () => fold(`lane:${lane.id}`) },
        `${info?.collapsed ? "▸" : "▾"} ${lane.label}`, h("span", { class: "muted", text: ` · ${info?.count ?? 0}` }))));
  }
  const edgesEl = svg("svg", { class: "edges", width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`, "aria-hidden": "true" });
  const defs = svg("defs", {});
  for (const flow of ["data", "control", "dependency", "deployment"]) {
    const m = svg("marker", { id: `arrow-${flow}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    m.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: `arrow ${flow}` }));
    defs.append(m);
  }
  edgesEl.append(defs);
  const diffOf = new Map(model.edges.map(e => [e.id, e.diff]));
  const node = (id: string) => model.nodes.find(n => n.id === id);
  const label = (id: string) => node(id)?.label ?? id;
  for (const e of L.edges) {
    const d = diffOf.get(e.id);
    const hot = s.selection.component && (e.from === s.selection.component || e.to === s.selection.component);
    const p = svg("path", { d: e.path, class: `edge ${e.flow}${hot ? " hot" : ""}${d ? ` diff-${d}` : ""}`, "marker-end": `url(#arrow-${e.flow})` });
    const t = svg("title", {}); t.textContent = `${label(e.from)} → ${label(e.to)} (${e.flow}${d ? `, ${d} in this preview` : ""})`; p.append(t);
    edgesEl.append(p);
  }
  canvas.append(edgesEl);
  for (const n of L.nodes) {
    const m = node(n.id);
    if (!m) continue;
    const pos = `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`;
    if (m.kind === "lane-group") {
      canvas.append(h("button", { class: `node group${m.diff ? ` diff-${m.diff}` : ""}`, type: "button", style: pos, title: `${m.label}: ${m.memberIds.length} components folded. Click to unfold.`, onclick: () => fold(n.id) },
        h("span", { class: "nodetop", text: "folded group" }), h("span", { class: "nodelabel", text: m.label }), h("span", { class: "nodestatus", text: `${m.memberIds.length} components · click to unfold` })));
      continue;
    }
    const c = comp(m.componentId);
    const ghost = s.preview?.ghosts.find(g => g.id === m.componentId);
    if (!c && !ghost) continue;
    const on = s.selection.component === m.componentId;
    const diff = m.diff;
    const hasKids = Boolean(c?.children.some(k => s.diagram.nodeIds.includes(k) || s.preview?.diagram.nodeIds.includes(k)));
    const folded = m.kind === "parent";
    const el = h("div", { class: `nodewrap`, style: pos },
      h("button", {
        class: `node ${c ? `h-${c.health}` : "h-planned"} ${on ? "active" : ""}${diff ? ` diff-${diff}` : ""}${folded ? " parent" : ""}`, type: "button", style: "left:0;top:0;width:100%;height:100%",
        "aria-pressed": String(on), title: c ? `${c.label} — ${c.providerLabel ?? c.kind}\n${c.headline}\nNext: ${c.nextStep}${diff ? `\nIn this preview: ${DIFF_TEXT[diff]}` : ""}` : `${ghost!.label}: removed in this preview`,
        onclick: () => { if (c) select(s.selection.subproject ?? c.subprojects[0], c.id); },
        ondblclick: () => { if (c && !inPreviewOnly(c.id)) command("datapass.openComponentEntry", c.id); }
      },
        h("span", { class: "nodetop" }, h("span", { class: "glyph", text: c?.providerGlyph ?? ghost!.providerGlyph, "aria-hidden": "true" }), h("span", { class: "provider", text: c?.providerLabel ?? ghost?.providerLabel ?? c?.kind ?? ghost!.kind }), diff ? h("span", { class: `tag ${diff}`, text: DIFF_TEXT[diff] }) : c && alternativesOf(s, c.id).length ? h("span", { class: "tag alt", text: "alternatives", title: `Alternatives exist (options.json): ${alternativesOf(s, c.id).join("; ")}` }) : undefined),
        h("span", { class: "nodelabel", text: `${c?.label ?? ghost!.label}${folded ? ` (+${m.memberIds.length - 1})` : ""}` }),
        h("span", { class: "nodestatus" }, c ? h("span", { class: `dot h-${c.health}`, "aria-hidden": "true" }) : undefined, h("span", { text: c ? c.headline : "not in this architecture" }))),
      hasKids || folded ? h("button", { class: "foldbtn", type: "button", title: folded ? "Show the components inside" : "Fold the components inside into this box", "aria-expanded": String(!folded), onclick: () => fold(`parent:${m.componentId}`), text: folded ? "▸" : "▾" }) : undefined);
    canvas.append(el);
  }
  return canvas;
}

// ------------------------------------------------------------------ files

function filesBlock(c: WbComponent): HTMLElement {
  const a = c.artifacts;
  if (!a) return h("section", { class: "files" }, eyebrow("Files"), h("p", { class: "muted", text: c.providerSupport === "unsupported" ? `${c.providerLabel}: DataPass has no operations for this service yet.` : "No files declared for this component (graph.json → artifacts)." }));
  const repo = repoOf(a.repoKey);
  const preview = inPreviewOnly(c.id);
  const rows = a.files.map(f => {
    const generated = f.source === "generated";
    const [text, tone] = generated && f.state === "missing" ? ["to generate", "warn"] : f.optional && f.state === "missing" ? ["recommended", "muted"] : FILE_STATE[f.state] ?? [f.state, "muted"];
    const needed = f.optional ? "recommended" : f.requiredFor.length ? `needed to ${f.requiredFor.join(", ")}` : f.role;
    const open = f.state === "found" && !preview;
    return h("button", {
      class: `filerow ${open ? "" : "absent"}`, type: "button", title: open ? `Open ${f.repoPath}` : `${f.repoPath}: ${text}`, disabled: preview && f.state !== "found",
      onclick: () => open ? send({ type: "openFile", componentId: c.id, path: f.repoPath }) : preview ? undefined : command("datapass.explainMissingFile", c.id, f.repoPath)
    },
      h("span", { class: "fname" }, h("code", { text: f.path + (f.kind === "dir" && !f.path.endsWith("/") && !f.path.endsWith("**") ? "/" : "") }), f.count && f.kind !== "file" ? h("span", { class: "muted small", text: ` ${f.count} file(s)` }) : undefined),
      h("span", { class: "frole muted small", text: generated ? `generated by ${f.generatedBy}` : `${f.role} · ${needed}` }),
      pill(text, tone));
  });
  return h("section", { class: "files" },
    h("div", { class: "bar" }, h("div", {}, eyebrow("Files · " + a.profileLabel), h("h3", { text: `${repo?.label ?? a.repoKey} / ${a.root === "." ? "(root)" : a.root}` })),
      h("span", { class: "muted small", text: `${a.summary.found}/${a.summary.expected} required found${a.summary.optionalMissing ? ` · ${a.summary.optionalMissing} recommended missing` : ""}` })),
    h("p", { class: "muted small", text: a.profileAbout }),
    h("div", { class: "filelist", role: "list" }, ...rows),
    ...a.mustNotCommit.map(m => h("div", { class: `note ${m.tracked ? "bad" : ""}`, text: m.tracked ? `${m.path} is committed to Git although it ${m.why}. Remove it from the repository and rotate what it contains.` : m.tracking === "unknown" ? `${m.path} ${m.why}: could not check Git tracking (${m.trackingReason ?? "not checked"}); make sure it is not committed.` : `${m.path} ${m.why}: keep it out of Git (it is not tracked).` })));
}

// ------------------------------------------------------------------ operations and detail

function operationRow(o: WbOperation, c: WbComponent): HTMLElement {
  const env = o.environmentId ? pill(`${o.environmentId}${o.production ? " · prod" : ""}`, o.production ? "bad" : "muted") : undefined;
  const actions: HTMLElement[] = [btn("Details", () => command("datapass.showOperation", o.key), { kind: "link", title: "Every prerequisite, review and warning for this operation" })];
  if (o.status === "ready" || o.status === "unknown" || o.status === "needs-review") {
    if (o.capabilityId === "generic.files.open") actions.unshift(btn("Open", () => command("datapass.openComponentEntry", c.id), { kind: "link" }));
    else if (o.command) actions.unshift(btn("Copy command", () => command("datapass.copyComponentCommand", o.key), { kind: "link", title: `${o.command.text} (from ${o.command.cwd})` }));
    else if (o.capabilityId === "adf.studio.open") actions.unshift(btn("Open ADF Studio", () => command("datapass.openAdfStudio"), { kind: "link" }));
    else if (o.capabilityId.startsWith("ci.")) actions.unshift(btn("Open runs", () => command("datapass.openCiRuns", c.id), { kind: "link", title: "The runs page of this pipeline on its Git host (or the official extension's view)" }));
    else if (o.native) actions.unshift(btn("Open tool", () => command("datapass.openNativeTool", c.id), { kind: "link", title: c.nativeTool }));
  }
  if (o.capabilityId !== "generic.files.open") actions.push(btn("Record result", () => command("datapass.recordComponentResult", o.key), { kind: "link", title: "Say whether it worked when you ran it in the native tool" }));
  const why = o.blockers[0]?.detail ?? o.unknowns[0]?.detail ?? (o.reviews[0] ? `Review: ${o.reviews[0].label}` : o.nextStep);
  return h("div", { class: `op t-${OP_STATE[o.status] ?? "muted"}` },
    h("div", { class: "ophead" }, h("span", { class: "oplabel", text: o.label }), env, pill(o.status.replace("-", " "), OP_STATE[o.status] ?? "muted")),
    o.status !== "ready" ? h("div", { class: "muted small", text: why }) : undefined,
    o.lastResult ? h("div", { class: `small ${o.lastResult.stale ? "muted" : ""}`, text: `Your last result: ${o.lastResult.result} (${o.lastResult.at.slice(0, 10)})${o.lastResult.stale ? " — for other files or target" : ""}` }) : undefined,
    h("div", { class: "row tight" }, ...actions));
}

function checklistBlock(title: string, list: WbComponent["checklist"], componentId?: string): HTMLElement | undefined {
  if (!list.length) return undefined;
  const mark: Record<string, string> = { todo: "☐", done: "☑", blocked: "⛔", problem: "⚠", skipped: "↷" };
  return h("section", { class: "checklist" }, eyebrow(title), ...list.map(c => h("button", {
    class: `check ${c.state}`, type: "button", title: "Change state (your own note, not proof)",
    onclick: () => command("datapass.setProjectChecklist", c.key, componentId ?? "")
  }, h("span", { class: "mark", text: mark[c.state] ?? "☐", "aria-hidden": "true" }), h("span", { class: "label", text: c.label }), c.state !== "todo" ? h("span", { class: "muted small", text: c.state }) : undefined)));
}

/** What the project sheet says about this component: its data, the formulas computed there, where it runs. */
function sheetBlock(c: WbComponent, s: WorkbenchState): HTMLElement | undefined {
  const sh = s.sheet;
  if (!sh) return undefined;
  const ds = sh.datasets.filter(d => d.componentId === c.id || d.producedBy?.includes(c.id) || d.consumedBy?.includes(c.id));
  const fs = sh.formulas.filter(f => f.componentId === c.id);
  const rs = sh.runtimes.filter(r => r.componentId === c.id || r.runs?.includes(c.id));
  if (!ds.length && !fs.length && !rs.length) return undefined;
  const open = (section: string, id: string) => command("datapass.openSheet", { section, id });
  return h("section", { class: "sheetbits" }, eyebrow("Project sheet"),
    ...ds.map(d => h("button", { class: "comprow", type: "button", title: "Open in the project sheet", onclick: () => open("datasets", d.id) },
      h("span", { class: "glyph", text: "▤", "aria-hidden": "true" }),
      h("span", { class: "label" }, h("b", { text: d.label }), h("span", { class: "muted small", text: `  ${[d.componentId === c.id ? "held here" : d.producedBy?.includes(c.id) ? "produced here" : "read here", volume(d)].filter(Boolean).join(" · ")}` })),
      h("span", { class: "muted small", text: (d.columns ?? []).filter(k => k.role && k.role !== "text").slice(0, 3).map(k => k.name).join(", ") }))),
    ...fs.map(f => h("button", { class: "comprow", type: "button", title: "Open in the project sheet", onclick: () => open("formulas", f.id) },
      h("span", { class: "glyph", text: "ƒx", "aria-hidden": "true" }), h("span", { class: "label" }, h("b", { text: f.label }), h("code", { class: "formula inline", text: `  ${f.expression}` })))),
    ...rs.map(r => h("button", { class: "comprow", type: "button", title: "Open in the project sheet", onclick: () => open("runtimes", r.id) },
      h("span", { class: "glyph", text: "⚙", "aria-hidden": "true" }), h("span", { class: "label" }, h("b", { text: r.label }), h("span", { class: "muted small", text: `  ${[r.host, r.specs].filter(Boolean).join(" · ")}` })))),
    h("p", { class: "muted small", text: "What the project declares (sheet.json): DataPass never computes formulas or counts rows." }));
}

const volume = (d: { rows?: string; files?: string; size?: string; growth?: string }) => [d.rows ? `${d.rows} rows` : undefined, d.files ? `${d.files} files` : undefined, d.size, d.growth ? `growth ${d.growth}` : undefined].filter(Boolean).join(" · ");

/** Decisions of options.json that can change this component. */
function optionsBlock(c: WbComponent, s: WorkbenchState): HTMLElement | undefined {
  const ds = s.options?.decisions.filter(d => d.concerns.includes(c.id)) ?? [];
  if (!ds.length) return undefined;
  return h("section", { class: "optbits" }, eyebrow("Architecture options"),
    ...ds.map(d => {
      const cur = d.options.find(o => o.current)!;
      const chosen = d.options.find(o => o.chosen && !o.current);
      return h("button", { class: "comprow", type: "button", title: "Compare the options", onclick: () => command("datapass.openOptions", d.id) },
        h("span", { class: "glyph", text: "⑂", "aria-hidden": "true" }),
        h("span", { class: "label" }, h("b", { text: d.title }), h("span", { class: "muted small", text: `  current: ${cur.label}${chosen ? ` · decided: ${chosen.label}` : ""} · ${d.options.length - 1} alternative(s)` })));
    }));
}

function componentDetail(c: WbComponent, s: WorkbenchState, withFiles: boolean): HTMLElement {
  const byPhase = new Map<string, WbOperation[]>();
  for (const o of c.operations) (byPhase.get(o.phaseLabel) ?? byPhase.set(o.phaseLabel, []).get(o.phaseLabel)!).push(o);
  const repo = repoOf(c.repoKey);
  const preview = inPreviewOnly(c.id);
  const diff = s.preview?.diff[c.id];
  return h("div", { class: "detail" },
    preview || diff ? h("div", { class: "banner preview small", text: preview ? `Only in the preview "${s.preview?.title}": this component is not in graph.json. Its files are shown as DataPass would check them.` : `In the preview "${s.preview?.title}": ${DIFF_TEXT[diff!] ?? diff}.` }) : undefined,
    eyebrow("Selected component"),
    h("h2", { text: c.label }),
    h("div", { class: "row tight" }, h("span", { class: "glyph big", text: c.providerGlyph, "aria-hidden": "true" }), h("span", { text: c.providerLabel ?? c.kind }), c.status ? pill(`declared: ${c.status}`, "muted", "What the project files say; DataPass checks the files itself") : undefined, pill(HEALTH_TEXT[c.health] ?? c.health, c.health === "ok" ? "ok" : c.health === "blocked" ? "bad" : c.health === "attention" ? "warn" : "muted"),
      alternativesOf(s, c.id).length ? pill("alternatives exist", "info", `Decisions in options.json that can change it: ${alternativesOf(s, c.id).join("; ")}`) : undefined),
    c.providerAbout ? h("p", { class: "muted small", text: c.providerAbout }) : undefined,
    c.description ? h("p", { text: c.description }) : undefined,
    h("div", { class: "card" },
      kv("Repository", repo ? `${repo.label} · ${REPO_STATE[repo.state]?.[0] ?? repo.state}` : c.repoKey ?? "—"),
      c.artifacts ? kv("Folder", c.artifacts.root === "." ? "(repository root)" : c.artifacts.root) : undefined,
      c.nativeTool ? kv("Official tool", c.nativeTool) : undefined,
      c.incoming.length ? kv("Comes from", c.incoming.map(r => r.label).join(", ")) : undefined,
      c.outgoing.length ? kv("Goes to", c.outgoing.map(r => r.label).join(", ")) : undefined),
    h("div", { class: `next h-${c.health}` }, h("b", { text: "Next: " }), h("span", { text: c.nextStep })),
    withFiles ? filesBlock(c) : undefined,
    boardBlock(s, x => x.components.some(y => y.id === c.id)),
    sheetBlock(c, s),
    optionsBlock(c, s),
    toolsDetailBlock(c.id),
    c.operations.length && !preview ? h("section", { class: "ops" }, eyebrow("What you can do, step by step"), ...[...byPhase].map(([phase, ops]) => h("div", { class: "phase" }, h("div", { class: "phasehead", text: phase }), ...ops.map(o => operationRow(o, c))))) : undefined,
    preview ? undefined : checklistBlock("Checklist", c.checklist, c.id),
    preview ? undefined : h("section", { class: "actions-col" }, eyebrow("Actions"),
      c.artifacts?.entry ? btn(`Open ${c.artifacts.entry}`, () => command("datapass.openComponentEntry", c.id), { kind: "primary", icon: "↗" }) : undefined,
      c.artifacts && repo?.state === "local" ? btn("Open this folder in a new window", () => command("datapass.openComponentFolder", c.id), { icon: "⧉", title: "Some official extensions work best with the component folder as the window root" }) : undefined,
      c.nativeTool ? btn(`Open ${c.nativeTool}`, () => command("datapass.openNativeTool", c.id), { icon: "⚙" }) : undefined,
      btn("Prepare AI context for this component", () => command("datapass.preparationPack", { componentId: c.id }), { icon: "✦" }),
      c.artifacts && c.artifacts.summary.missing > 0 ? btn("Prepare the missing files as a work order", () => command("datapass.workOrders.newForMissingFiles", c.id), { icon: "⚒", title: "Opens the Agent tab with the order prefilled; nothing is written or launched until you click" }) : undefined,
      ...c.docs.map(d => btn(d.label, () => command("datapass.openDoc", d), { kind: "link", icon: "📄" }))),
    c.problems.length ? h("section", {}, eyebrow("Problems"), ...c.problems.map(p => h("div", { class: "problem warning", text: p }))) : undefined,
    h("p", { class: "muted small evidence", text: "Evidence, not promise: an installed extension does not prove access to an account; ready means the prerequisites are here, not that the operation will succeed." }));
}

const kv = (k: string, v: string) => h("div", { class: "kv" }, h("span", { class: "muted", text: k }), h("b", { text: v }));

function subprojectDetail(sp: WbSubproject, s: WorkbenchState): HTMLElement {
  const needs = sp.needs;
  const decisions = s.options?.decisions.filter(d => d.subproject === sp.id) ?? [];
  return h("div", { class: "detail" },
    eyebrow(sp.implicit ? "Components" : "Selected sub-project"),
    h("h2", { text: sp.title }),
    sp.objective ? h("p", { text: sp.objective }) : undefined,
    h("div", { class: `next h-${sp.health}` }, h("b", { text: "Next: " }), h("span", { text: sp.nextStep })),
    h("section", { class: "needs" }, eyebrow("What this sub-project needs on this machine"),
      needs.repositories.length ? h("div", {}, h("h4", { text: "Repositories" }), ...needs.repositories.map(r => { const full = repoOf(r.key); return full ? repoRow(full, false) : h("div", { text: r.label }); })) : h("div", { class: "ok small", text: "✓ Every repository it uses is cloned here." }),
      needs.tools.length ? h("div", {}, h("h4", { text: "Tools not installed" }), ...needs.tools.map(t => h("div", { class: "tool" },
        h("div", {}, h("b", { text: t.label }), h("div", { class: "muted small", text: `for ${t.neededFor.slice(0, 4).join(", ")}${t.neededFor.length > 4 ? "…" : ""}` })),
        t.extensionIds[0] ? btn("Show extension", () => command("datapass.installTool", t.extensionIds[0]), { kind: "link", title: "Opens the extension page; you decide whether to install" }) : undefined))) : h("div", { class: "ok small", text: "✓ The tools its operations need are installed (or optional)." }),
      needs.missingFiles || needs.generationNeeded ? h("div", { class: "warn small", text: `${needs.missingFiles} expected file(s) missing${needs.generationNeeded ? `, ${needs.generationNeeded} to generate` : ""}: select a component to see which.` }) : undefined),
    boardBlock(s, x => x.subprojects.includes(sp.id)),
    decisions.length ? h("section", { class: "optbits" }, eyebrow("Architecture options for this sub-project"), ...decisions.map(d => h("button", { class: "comprow", type: "button", onclick: () => command("datapass.openOptions", d.id) },
      h("span", { class: "glyph", text: "⑂", "aria-hidden": "true" }), h("span", { class: "label", text: d.title }), h("span", { class: "muted small", text: `${d.options.length} options` })))) : undefined,
    checklistBlock("Checklist", sp.checklist),
    h("section", {}, eyebrow("Components"), ...sp.componentIds.map(id => comp(id)).filter((c): c is WbComponent => !!c).map(c =>
      h("button", { class: "comprow", type: "button", onclick: () => select(sp.id, c.id) }, h("span", { class: "glyph", text: c.providerGlyph, "aria-hidden": "true" }), h("span", { class: "label", text: c.label }), h("span", { class: "muted small", text: c.headline }), h("span", { class: `dot h-${c.health}` })))),
    h("section", { class: "actions-col" }, eyebrow("Actions"),
      btn("Prepare AI context for this sub-project", () => command("datapass.preparationPack", { subprojectId: sp.id }), { kind: "primary", icon: "✦" }),
      sp.repoKey && repoOf(sp.repoKey)?.state === "local" ? btn("Open its repository in a new window", () => command("datapass.openRepositoryWindow", sp.repoKey), { icon: "⧉" }) : undefined,
      ...sp.docs.map(d => btn(d.label, () => command("datapass.openDoc", d), { kind: "link", icon: "📄" }))));
}

/** Cards of the board that match (a component's, a sub-project's): open ones first; a click opens the card on the board. */
function boardBlock(s: WorkbenchState, match: (c: CardView) => boolean): HTMLElement | undefined {
  const b = s.board;
  const cards = b?.cards.filter(match) ?? [];
  if (!b || !cards.length) return undefined;
  const open = cards.filter(x => !x.done);
  const col = (id: string) => b.columns.find(x => x.id === id)?.title ?? id;
  return h("section", { class: "optbits" }, eyebrow(`Board · ${open.length} open${cards.length > open.length ? ` · ${cards.length - open.length} done` : ""}`),
    ...[...open, ...cards.filter(x => x.done)].slice(0, 8).map(x => h("button", { class: "comprow", type: "button", title: "Open this card on the board", onclick: () => openCard(x.id) },
      pill(TYPE_TEXT[x.type] ?? x.type, TYPE_TONE[x.type] ?? "muted"),
      h("span", { class: "label" }, h("b", { text: x.title }), h("span", { class: "muted small", text: `  ${col(x.status)}${x.priority ? ` · ${x.priority}` : ""}${x.overdue ? " · overdue" : ""}` })))));
}

/** Show a card on the board: this tab switches view; the side bar and the panel ask the extension. */
function openCard(id: string): void {
  if (MODE !== "full") { command("datapass.openBoard", id); return; }
  ui.view = "board";
  revealCard(id);
  saveUi();
  render();
}

/** Select a card, clear filters that would hide it, and scroll it into view after the next render. */
let scrollToCard: string | undefined;
function revealCard(id: string): void {
  if (!id) return;
  ui.boardFocus = id;
  const card = state?.board?.cards.find(c => c.id === id);
  if (card && state && !boardCards(state).includes(card)) { ui.boardSub = ui.boardSprint = ui.boardQuery = undefined; ui.boardTypes = []; }
  scrollToCard = id;
}

function overview(s: WorkbenchState): HTMLElement {
  const b = s.board;
  const sprint = b?.sprints.find(x => x.state === "current");
  return h("div", { class: "overview" },
    h("div", { class: "next h-info" }, h("b", { text: "Next: " }), h("span", { text: s.nextStep })),
    b ? h("div", { class: "banner" }, h("b", { text: "Board" }),
      h("span", { class: "muted small", text: `${b.summary.open} open card(s)${b.summary.bugs ? ` · ${b.summary.bugs} bug(s)` : ""}${b.summary.overdue ? ` · ${b.summary.overdue} overdue` : ""}${sprint ? ` · sprint "${sprint.title}" until ${sprint.end}` : ""}` }),
      h("span", { class: "grow" }), btn("Open the board", () => openCard(ui.boardFocus ?? ""), { kind: "link" })) : undefined,
    h("div", { class: "cards" }, ...s.subprojects.map(sp => h("button", { class: `spcard h-${sp.health}`, type: "button", onclick: () => select(sp.id, undefined) },
      h("div", { class: "bar" }, h("b", { text: sp.title }), pill(HEALTH_TEXT[sp.health] ?? sp.health, sp.health === "ok" ? "ok" : sp.health === "planned" ? "muted" : "warn")),
      sp.objective ? h("span", { class: "muted small", text: sp.objective }) : undefined,
      h("span", { class: "small", text: `${sp.summary.components} components · ${sp.summary.filesFound}/${sp.summary.filesExpected} files · ${sp.summary.opsReady}/${sp.summary.opsTotal} operations ready` }),
      sp.needs.repositories.length ? h("span", { class: "warn small", text: `needs: ${sp.needs.repositories.map(r => `${r.label} (${REPO_STATE[r.state]?.[0] ?? r.state})`).join(", ")}` }) : undefined,
      sp.needs.tools.length ? h("span", { class: "warn small", text: `tools missing: ${sp.needs.tools.map(t => t.label).slice(0, 3).join("; ")}` }) : undefined,
      h("span", { class: "muted small", text: `Next: ${sp.nextStep}` })))),
    s.environments.length ? h("p", { class: "muted small", text: `Environments: ${s.environments.map(e => `${e.id}${e.production ? " (production)" : ""}`).join(", ")}` }) : undefined,
    s.git ? gitCard(s.git) : undefined,
    s.readiness ? readinessCard(s.readiness) : undefined,
    s.docs.length ? h("div", { class: "row" }, ...s.docs.map(d => btn(d.label, () => command("datapass.openDoc", d), { kind: "link", icon: "📄" }))) : undefined);
}

/** 0.19: one line about Git, from the Git view's last check (counts only). */
function gitCard(g: WbGit): HTMLElement {
  const text = g.restricted ? "not inspected in Restricted Mode"
    : `${g.needsYou ? `${g.needsYou} need${g.needsYou === 1 ? "s" : ""} you` : "nothing needs you"} · ${g.checked}/${g.repositories} repositories · ${g.openPrs} open PR${g.openPrs === 1 ? "" : "s"}${g.failing ? ` (${g.failing} failing)` : ""}${g.oldestFetch ? ` · oldest fetch ${agoText(g.oldestFetch)}` : ""}`;
  return h("div", { class: "banner gitcard", "aria-label": "Git" }, h("b", { text: "Git" }),
    pill(g.needsYou ? `${g.needsYou}` : "✓", g.failing ? "bad" : g.needsYou ? "warn" : "ok", "Items in the Git view's Needs you list"),
    h("span", { class: "muted small", text: g.top && g.needsYou ? `${text} — ${g.top}` : text }),
    h("span", { class: "grow" }),
    btn("Open the Git view", () => command("datapass.git.focus"), { kind: "link" }),
    g.restricted ? undefined : btn("Fetch all", () => command("datapass.git.fetchAll"), { kind: "link", title: "Plain git fetch of every cloned repository: nothing is merged" }));
}

function agoText(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return !Number.isFinite(s) ? "?" : s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

const KEY_TONE: Record<string, string> = { set: "ok", empty: "warn", missing: "warn", "not-checked": "muted" };
const FILE_TONE: Record<string, string> = { found: "ok", missing: "warn", "not-cloned": "muted", unreadable: "warn", "too-large": "warn", "not-checked": "muted" };

/** Local environment and readiness: names and states only, never a value. */
function readinessCard(r: WbReadiness): HTMLElement {
  const sum = r.summary;
  const serious = r.checks.filter(c => c.severity !== "info");
  return h("section", { class: "envcard", "aria-label": "Local environment" },
    h("div", { class: "bar" }, h("h3", { text: "Local environment" }),
      r.keys.length ? pill(`${sum.keysSet}/${sum.keysTotal} variables set`, sum.keysSet === sum.keysTotal ? "ok" : "warn") : undefined,
      pill(`${sum.errors} error(s) · ${sum.warnings} warning(s)`, sum.errors ? "bad" : sum.warnings ? "warn" : "ok", "Deterministic local checks")),
    !r.declared ? h("p", { class: "muted small", text: "No env files or variable names declared yet (localEnv in .datapass/project.json, manifest v4)." }) : undefined,
    ...r.files.map(f => h("div", { class: "envrow" },
      h("code", { text: f.path }), f.repoLabel ? h("span", { class: "muted small", text: f.repoLabel }) : undefined,
      pill(f.stateText, f.git === "tracked" ? "bad" : f.optional && f.state === "missing" ? "muted" : FILE_TONE[f.state] ?? "muted"),
      btn(f.state === "missing" ? "Create…" : "Open", () => command("datapass.env.openFile", f.id), { kind: "link", title: f.state === "missing" ? "Create it with the variable names and empty values" : "Open in the editor" }))),
    ...r.keys.map(k => h("div", { class: "envrow" },
      h("code", { text: k.name }), pill(k.stateText, KEY_TONE[k.state] ?? "muted"), h("span", { class: "muted small", text: k.sourceText }),
      btn("Copy name", () => command("datapass.env.copyKeyName", k.name), { kind: "link", title: "Copies the variable name, never its value" }))),
    ...r.identifiers.map(d => h("div", { class: "envrow" },
      h("span", { text: d.label }), h("span", { class: "muted small", text: ["non-secret id", [d.provider, d.kind].filter(Boolean).join(" ") || undefined, d.environments.length ? d.environments.join(" / ") : undefined, d.envKey ? `→ ${d.envKey}` : undefined].filter(Boolean).join(" · ") }),
      d.environments.length > 1
        ? h("span", { class: "row" }, ...d.environments.map(env => btn(`Copy ${env}`, () => command("datapass.env.copyIdentifier", d.id, env), { kind: "link", title: `Copies the ${env} id declared in the manifest` })))
        : btn("Copy", () => command("datapass.env.copyIdentifier", d.id), { kind: "link", title: "Copies the id declared in the manifest" }))),
    r.tools ? toolsBlock(r.tools) : undefined,
    r.connections.length ? connectionsBlock(r.connections) : undefined,
    h("div", { class: "row" },
      btn("Copy project ID", () => command("datapass.copyProjectId"), { icon: "⧉" }),
      btn("Open Power Ops", () => command("datapass.openPowerOps"), { icon: "⚿", title: "Secrets live in your local vault; DataPass never reads their values" }),
      btn("Readiness report", () => command("datapass.readinessReport"), { icon: "☰" })),
    serious.length ? h("div", { class: "checks" }, ...serious.slice(0, 10).map(c => h("div", { class: `problem ${c.severity}` }, h("b", { text: c.area }), h("span", { text: c.nextStep ? `${c.message} Next: ${c.nextStep}` : c.message })))) : undefined,
    h("p", { class: "muted small", text: `Optional companions: ${r.companions.map(c => `${c.label} — ${c.detail}`).join(" · ")}` }));
}

const TOOL_TONE: Record<string, string> = { "ok": "ok", "outside-range": "warn", "missing": "warn", "unknown-tool": "bad", "version-unknown": "muted", "not-checked": "muted" };
const CONNECTION_TONE: Record<string, string> = { "ok": "ok", "declared": "muted", "not-checked-yet": "muted" };

/** Tools & versions (manifest v5): the version against the declared range; install commands are copied, never run. */
function toolsBlock(t: NonNullable<WbReadiness["tools"]>): HTMLElement {
  return h("div", { class: "envsub", "aria-label": "Tools and versions" },
    h("div", { class: "bar" }, h("b", { text: "Tools & versions" }),
      pill(`${t.summary.ok}/${t.summary.total} ok`, t.summary.attention ? "warn" : "ok"),
      t.summary.attention ? pill(`${t.summary.attention} to fix`, "warn") : undefined),
    ...t.entries.map(e => h("div", { class: "envrow" },
      h("span", { text: e.label }), pill(e.stateText, e.optional && TOOL_TONE[e.state] === "warn" ? "muted" : TOOL_TONE[e.state] ?? "muted", e.detail),
      toolById(e.tool) ? btn(toolById(e.tool)!.price.text, () => openToolkitAt(`tool:${e.tool}`), { kind: "link", title: "Show it in the Toolkit (what it is for, free tier and prices)" }) : undefined,
      (e.state === "missing" || e.state === "outside-range") && e.extensionId
        ? btn("Show extension", () => command("datapass.installTool", e.extensionId), { kind: "link", title: "Opens the extension page; you decide whether to install" })
        : (e.state === "missing" || e.state === "outside-range" || e.state === "not-checked") && e.install
          ? btn(e.install === "command" ? "Copy install" : "Install page", () => command("datapass.toolchain.copyInstall", e.tool), { kind: "link", title: e.install === "command" ? "Copies the install command; DataPass installs nothing" : "Opens the vendor's download page" })
          : undefined)),
    h("div", { class: "envrow" }, h("code", { text: ".vscode/extensions.json" }), pill(t.extensionsText, t.extensionsAttention ? "warn" : "muted"),
      btn("Show recommended extensions", () => command("datapass.showRecommendedExtensions"), { kind: "link", title: "VS Code's own list; it never installs anything by itself" })));
}

/** Connections (manifest v5): sign-ins checked read-only on request; bindings declared, not checked. */
function connectionsBlock(list: WbReadiness["connections"]): HTMLElement {
  const signIns = list.filter(c => c.kind === "sign-in");
  return h("div", { class: "envsub", "aria-label": "Connections" },
    h("div", { class: "bar" }, h("b", { text: "Connections" }), pill(`${list.filter(c => c.state === "ok").length}/${list.length} ok`, list.some(c => !CONNECTION_TONE[c.state]) ? "warn" : "muted"),
      signIns.length ? btn("Check connections", () => command("datapass.checkConnections"), { icon: "⇄", title: "az account show, databricks auth profiles, fab auth status: read-only, no prompt" }) : undefined),
    ...list.map(c => h("div", { class: "envrow" },
      h("span", { text: c.label }), h("span", { class: "muted small", text: `${c.kind}${c.environment ? ` · ${c.environment}` : ""}` }),
      pill(c.stateText, CONNECTION_TONE[c.state] ?? "warn", c.nextStep ? `${c.detail}. Next: ${c.nextStep}` : c.detail),
      c.signIn ? btn("Copy sign-in command", () => command("datapass.connections.copySignIn", c.id), { kind: "link", title: "You run it; DataPass never signs in" })
        : c.hasPortal ? btn("Open portal page", () => command("datapass.connections.openPortal", c.id), { kind: "link", title: "Where to verify it: DataPass cannot see this binding" })
        : undefined)));
}

function detailColumn(s: WorkbenchState, withFiles: boolean): HTMLElement {
  // 0.20: a selected work order shows its timeline until something else is selected.
  const order = s.workOrders?.selected ? s.workOrders.orders.find(o => o.id === s.workOrders!.selected) : undefined;
  if (order) return orderDetail(order, s, false);
  const c = comp(s.selection.component);
  if (c) return componentDetail(c, s, withFiles);
  const sp = subp(s.selection.subproject);
  if (sp) return subprojectDetail(sp, s);
  return h("div", { class: "detail" }, eyebrow("Selection"), h("h2", { text: "Nothing selected" }), h("p", { class: "muted", text: "Pick a sub-project or a component in the Project tree, the architecture diagram or the workbench. This panel then shows its files, what each step needs, and what to do next." }), overview(s));
}

// ------------------------------------------------------------------ options view

const scoreDots = (score?: number) => (score ? h("span", { class: "dots", "aria-label": `${score} out of 5`, text: `${"●".repeat(score)}${"○".repeat(5 - score)}` }) : undefined);

function impactCell(i: WbImpact, what: "components" | "tools" | "missing" | "support" | "repos" | "monthly" | "oneTime" | "problems"): HTMLElement {
  switch (what) {
    case "components": {
      const parts = [
        i.components.added.length ? `+${i.components.added.length} ${i.components.added.map(c => c.label).join(", ")}` : "",
        i.components.removed.length ? `−${i.components.removed.length} ${i.components.removed.map(c => c.label).join(", ")}` : "",
        i.components.replaced.length ? `~${i.components.replaced.length} ${i.components.replaced.map(c => `${c.label} (${c.from ?? "?"} → ${c.provider ?? "?"})`).join(", ")}` : ""
      ].filter(Boolean);
      return h("div", { class: "small" }, h("b", { text: `${i.components.total} components` }), ...parts.map(p => h("div", { class: "muted", text: p })));
    }
    case "tools":
      return i.tools.newlyNeeded.length ? h("div", { class: "small" }, ...i.tools.newlyNeeded.map(t => h("div", {}, pill(t.state === "present" ? "installed" : t.state === "absent" ? "not installed" : "unknown", t.state === "present" ? "ok" : t.state === "absent" ? "warn" : "muted"), ` ${t.label}`)))
        : h("div", { class: "muted small", text: i.tools.noLongerNeeded.length ? `none new · no longer needed: ${i.tools.noLongerNeeded.join(", ")}` : "none new" });
    case "missing":
      return h("div", { class: `small ${i.tools.missing.length ? "warn" : "ok"}`, text: i.tools.missing.length ? `${i.tools.missing.length} not installed here` : "all installed" });
    case "support":
      return h("div", { class: "small" }, h("div", { text: `${i.support.operations} with operations` }), i.support.files ? h("div", { class: "muted", text: `${i.support.files} files only` }) : undefined, i.support.unsupported ? h("div", { class: "warn", text: `${i.support.unsupported} not supported by DataPass` }) : undefined);
    case "repos":
      return h("div", { class: "small", text: [i.repositories.newlyUsed.length ? `new: ${i.repositories.newlyUsed.join(", ")}` : "", i.repositories.planned.length ? `planned: ${i.repositories.planned.join(", ")}` : ""].filter(Boolean).join(" · ") || `${i.repositories.used.length} used` });
    case "monthly":
      return h("div", { class: `small money ${partialLabel(i.costs.total) ? "warn" : ""}`, text: withPartial(money(i.costs.monthly, "/month"), i.costs.total) || "not priced", title: i.costs.missing.length ? `Not fully priced: ${i.costs.missing.join(", ")} (unknown, not zero)` : "Sum of the monthly figures declared in options.json, per currency" });
    case "oneTime":
      return h("div", { class: "small money", text: withPartial(money(i.costs.oneTime, ""), i.costs.total) || "not priced" });
    case "problems":
      return i.problems.length ? h("div", { class: "small" }, ...i.problems.slice(0, 3).map(p => h("div", { class: p.severity === "error" ? "bad" : "warn", text: p.message }))) : h("div", { class: "muted small", text: "none" });
  }
}

function optionsNav(s: WorkbenchState): HTMLElement {
  const o = s.options!;
  const items: HTMLElement[] = [eyebrow("Compare")];
  const active = (id: string) => (ui.optFocus ?? "scenarios") === id;
  const go = (id: string) => { ui.optFocus = id; ui.optOption = undefined; saveUi(); render(); };
  items.push(h("button", { class: `navrow ${active("scenarios") ? "active" : ""}`, type: "button", "aria-pressed": String(active("scenarios")), onclick: () => go("scenarios") }, h("span", { class: "label", text: "Scenarios (whole architecture)" }), h("span", { class: "meta", text: String(o.scenarios.length) })));
  const levels: string[] = [];
  for (const d of o.decisions) { const l = d.level ?? "other"; if (!levels.includes(l)) levels.push(l); }
  for (const l of levels) {
    items.push(h("div", { class: "levelhead", text: l === "other" ? "Decisions" : `Level: ${l}` }));
    for (const d of o.decisions.filter(x => (x.level ?? "other") === l)) {
      const chosen = d.options.find(x => x.chosen && !x.current);
      items.push(h("button", { class: `navrow sub ${active(d.id) ? "active" : ""}`, type: "button", "aria-pressed": String(active(d.id)), title: d.question ?? d.title, onclick: () => go(d.id) },
        h("span", { class: "glyph", text: chosen ? "★" : "⑂", "aria-hidden": "true" }), h("span", { class: "label", text: d.title }), h("span", { class: "meta", text: String(d.options.length) })));
    }
  }
  if (o.problems.some(p => p.severity !== "info")) {
    items.push(h("div", { class: "divider" }), eyebrow("Problems in options.json"));
    for (const p of o.problems.filter(p => p.severity !== "info").slice(0, 8)) items.push(h("div", { class: `problem ${p.severity}` }, h("b", { text: p.where }), h("span", { text: p.message })));
  }
  items.push(h("div", { class: "divider" }), h("p", { class: "muted small", text: "Options are prepared by the AI in .datapass/options.json. DataPass computes the consequences; you decide; the AI applies the decision in a pull request." }));
  return h("nav", { class: "nav", "aria-label": "Options navigation" }, ...items);
}

function scenariosTable(s: WorkbenchState): HTMLElement {
  const o = s.options!;
  const scen = o.scenarios;
  const previewKey = s.preview?.key;
  const head = h("tr", {}, h("th", { text: "" }), ...scen.map(x => h("th", { class: x.recommended ? "rec" : "" },
    h("div", { class: "colhead" }, h("b", { text: x.title }), x.recommended ? pill("recommended", "ok") : undefined, x.kind === "decided" ? pill("decided", "info") : undefined, codingPill(s.coding?.scenarios[x.id])),
    x.description ? h("div", { class: "muted small", text: x.description }) : undefined,
    x.id === "current" ? (previewKey ? btn("Show current", () => previewScenario("current"), { kind: "link" }) : pill("on the diagram", "muted"))
      : previewKey === `scenario:${x.id}` ? pill("previewed", "info") : btn("Preview on diagram", () => previewScenario(x.id), { kind: "link" }))));
  const picksRow = h("tr", {}, h("th", { text: "Choices" }), ...scen.map(x => h("td", {}, ...x.impact.picks.map(p => {
    const d = o.decisions.find(y => y.id === p.decision);
    const opt = d?.options.find(y => y.id === p.option);
    return h("div", { class: `small ${p.changed ? "" : "muted"}`, text: `${d?.title ?? p.decision}: ${opt?.label ?? p.option}` });
  }))));
  const row = (label: string, what: Parameters<typeof impactCell>[1], title?: string) => h("tr", {}, h("th", { text: label, title }), ...scen.map(x => h("td", {}, impactCell(x.impact, what))));
  const table = h("table", { class: "cmp" }, h("thead", {}, head), h("tbody", {},
    picksRow,
    row("Components", "components"),
    row("New official tools", "tools", "Official VS Code extensions and CLIs this architecture needs that the current one does not"),
    row("On this machine", "missing", "Tools this architecture needs that are not installed here"),
    row("DataPass support", "support", "Components DataPass can route to operations, only show as files, or does not support yet"),
    row("Repositories", "repos"),
    row("Declared cost / month", "monthly", "Declared in options.json with source and date; not verified by DataPass"),
    row("Declared one-time cost", "oneTime"),
    row("Problems", "problems")));
  return h("div", { class: "cmpwrap" }, table);
}

function customBuilder(s: WorkbenchState): HTMLElement {
  const o = s.options!;
  const picks = o.decisions.map(d => ({ d, value: ui.custom[d.id] && d.options.some(x => x.id === ui.custom[d.id]) ? ui.custom[d.id]! : d.current }));
  return h("section", { class: "custom" }, eyebrow("Build your own combination"),
    h("p", { class: "muted small", text: "Swap one level at a time (for example only the archive), then preview the whole architecture." }),
    h("div", { class: "customgrid" }, ...picks.map(({ d, value }) => h("label", { class: "customrow" },
      h("span", { class: "small", text: d.title }),
      h("select", { class: "sel", "aria-label": d.title, onchange: (e: Event) => { ui.custom[d.id] = (e.target as HTMLSelectElement).value; saveUi(); } },
        ...d.options.map(x => { const el = h("option", { value: x.id, text: `${x.label}${x.current ? " (current)" : ""}` }) as HTMLOptionElement; el.selected = x.id === value; return el; }))))),
    h("div", { class: "row" },
      btn("Preview this combination", () => previewPicks(o.decisions.map(d => `${d.id}=${ui.custom[d.id] ?? d.current}`)), { kind: "primary", icon: "◎" }),
      btn("Reset", () => { ui.custom = {}; saveUi(); render(); }, { kind: "link" })));
}

function decisionTable(s: WorkbenchState, d: WbDecision): HTMLElement {
  const o = s.options!;
  const opts = d.options;
  const previewKey = s.preview?.key;
  const head = h("tr", {}, h("th", { text: "" }), ...opts.map(x => h("th", { class: `${x.current ? "cur" : ""} ${ui.optOption === x.id ? "focus" : ""}` },
    h("div", { class: "colhead" }, h("b", { text: x.label }), x.current ? pill("current", "muted", "What graph.json describes today") : undefined, x.chosen && !x.current ? pill("decided", "info") : undefined, x.rejected ? pill("rejected", "bad") : undefined, x.current ? undefined : codingPill(s.coding?.options[`${d.id}=${x.id}`])),
    x.summary ? h("div", { class: "muted small", text: x.summary }) : undefined,
    h("div", { class: "row tight" },
      btn("Consequences", () => { ui.optOption = x.id; saveUi(); render(); }, { kind: "link", title: "Show the consequences in the side column" }),
      x.current ? undefined : previewKey === `picks:${o.decisions.map(y => `${y.id}=${y.id === d.id ? x.id : y.current}`).join(",")}` ? pill("previewed", "info") : btn("Preview", () => previewPicks([`${d.id}=${x.id}`]), { kind: "link", title: "Show this option on the diagram (the other decisions stay current)" })))));
  const declared = o.criteria.filter(c => opts.some(x => x.values[c.id])).map(c => h("tr", {}, h("th", { title: c.description ?? "" }, c.label, c.unit ? h("span", { class: "muted small", text: ` (${c.unit})` }) : undefined, c.better ? h("span", { class: "muted small", text: c.better === "lower" ? " ↓ better" : " ↑ better" }) : undefined),
    ...opts.map(x => { const v = x.values[c.id]; return h("td", { title: v?.note ?? "" }, v ? h("div", { class: "small" }, v.text ? h("span", { text: v.text }) : undefined, v.text && v.score ? " " : undefined, scoreDots(v.score)) : h("span", { class: "muted", text: "—" })); })));
  const row = (label: string, what: Parameters<typeof impactCell>[1], title?: string) => h("tr", { class: "computed" }, h("th", { text: label, title }), ...opts.map(x => h("td", {}, impactCell(x.impact, what))));
  const list = (label: string, pick: (x: WbOption) => string[], tone = "") => opts.some(x => pick(x).length) ? h("tr", {}, h("th", { text: label }), ...opts.map(x => h("td", {}, pick(x).length ? h("ul", { class: `small bul ${tone}` }, ...pick(x).map(t => h("li", { text: t }))) : h("span", { class: "muted", text: "—" })))) : undefined;
  const declaredCost = (x: WbOption) => formatCostTotal(sumCostLines(x.costs, o.currency), { once: " once" });
  const table = h("table", { class: "cmp" }, h("thead", {}, head), h("tbody", {},
    ...declared,
    h("tr", {}, h("th", { text: "Declared cost of this choice" }), ...opts.map(x => h("td", { class: "small money", text: declaredCost(x) }))),
    h("tr", { class: "sep" }, h("th", { colspan: String(opts.length + 1), text: "Consequences computed by DataPass (whole project, other decisions current)" })),
    row("Components", "components"),
    row("New official tools", "tools"),
    row("On this machine", "missing"),
    row("DataPass support", "support"),
    row("Repositories", "repos"),
    h("tr", { class: "sep" }, h("th", { colspan: String(opts.length + 1), text: "Declared in options.json" })),
    list("Pros", x => x.pros, "ok"), list("Cons", x => x.cons, "warn"), list("Consequences", x => x.consequences),
    list("Requires", x => x.requires.map(p => pickLabel(s, p))), list("Does not work with", x => x.excludes.map(p => pickLabel(s, p)), "warn")));
  return h("div", { class: "cmpwrap" }, table);
}

/** Host name of a declared source, for a short link label; never throws on an odd address. */
function hostOf(url: string): string {
  try { return new URL(url).host || url.slice(8, 48); } catch { return url.slice(8, 48); }
}

function pickLabel(s: WorkbenchState, p: string): string {
  const [d, o] = p.split("=");
  const dec = s.options?.decisions.find(x => x.id === d);
  return `${dec?.title ?? d}: ${dec?.options.find(x => x.id === o)?.label ?? o}`;
}

function costList(s: WorkbenchState, d: WbDecision): HTMLElement | undefined {
  const rows = d.options.flatMap(x => x.costs.map(c => ({ x, c })));
  if (!rows.length) return undefined;
  return h("section", { class: "costs" }, eyebrow("Pricing lines (declared, with source and date)"),
    h("table", { class: "cmp costs" }, h("thead", {}, h("tr", {}, ...["Option", "Item", "Price", "Estimate", "Source", "As of"].map(t => h("th", { text: t })))),
      h("tbody", {}, ...rows.map(({ x, c }) => h("tr", {},
        h("td", { class: "small", text: x.label }),
        h("td", { class: "small" }, h("div", { text: c.label }), c.note ? h("div", { class: "muted", text: c.note }) : undefined),
        h("td", { class: "small", text: c.price ?? "—" }),
        h("td", { class: "small money", text: formatCostLine(c, c.currency ?? "USD", { once: " once" }) }),
        h("td", { class: "small" }, c.source ? btn(hostOf(c.source), () => command("datapass.openOptionSource", c.source), { kind: "link", title: c.source }) : h("span", { class: "warn", text: "no source" })),
        h("td", { class: `small ${c.asOf ? "" : "warn"}`, text: c.asOf ?? "no date" }))))),
    h("p", { class: "muted small", text: "Orders of magnitude declared by the project (usually by the AI), not quotes. Check the official calculator before committing to a service; free tiers and regions change prices." }));
}

function impactSide(s: WorkbenchState, title: string, i: WbImpact, actions: HTMLElement[]): HTMLElement {
  return h("div", { class: "detail" },
    eyebrow("Consequences"),
    h("h2", { text: title }),
    h("div", { class: "card" },
      kv("Components", `${i.components.total} (${[i.components.added.length ? `+${i.components.added.length}` : "", i.components.removed.length ? `−${i.components.removed.length}` : "", i.components.replaced.length ? `~${i.components.replaced.length}` : ""].filter(Boolean).join(" ") || "unchanged"})`),
      kv("Links", `${i.relations.added ? `+${i.relations.added} ` : ""}${i.relations.removed ? `−${i.relations.removed}` : ""}`.trim() || "unchanged"),
      kv("Operations DataPass can check", `${i.operations.total}`),
      kv("Declared cost", formatCostTotal(i.costs.total, { once: " once" }))),
    i.tools.newlyNeeded.length ? h("section", {}, eyebrow("Official tools it adds"), ...i.tools.newlyNeeded.map(t => h("div", { class: "tool" },
      h("div", {}, h("b", { text: t.label }), h("div", { class: "muted small", text: `for ${t.why.join(", ")}` })),
      toolByExt(t.extensionId) ? pricePill(toolByExt(t.extensionId)!) : undefined,
      t.state === "present" ? pill("installed", "ok") : t.extensionId ? btn("Show extension", () => command("datapass.installTool", t.extensionId), { kind: "link", title: "Opens the extension page; you decide whether to install" }) : pill(t.state === "absent" ? "not installed" : "unknown", t.state === "absent" ? "warn" : "muted")))) : undefined,
    i.tools.noLongerNeeded.length ? h("p", { class: "muted small", text: `No longer needed: ${i.tools.noLongerNeeded.join(", ")}` }) : undefined,
    h("section", {}, eyebrow("Services and DataPass support"), ...i.providers.map(p => {
      const [text, tone] = SUPPORT_TEXT[p.support] ?? [p.support, "muted"];
      return h("div", { class: "tool" }, h("div", {}, h("b", { text: p.label }), h("div", { class: "muted small", text: [`${p.count} component(s)`, p.nativeTool ? `official tool: ${p.nativeTool}` : undefined, p.moduleOff ? `module "${p.moduleLabel}" is switched off in project.json` : undefined].filter(Boolean).join(" · ") })),
        pill(`${i.providersAdded.includes(p.id) ? "new · " : ""}${text}`, p.moduleOff ? "warn" : tone));
    })),
    i.providersRemoved.length ? h("p", { class: "muted small", text: `Services it removes: ${i.providersRemoved.join(", ")}` }) : undefined,
    i.problems.length ? h("section", {}, eyebrow("Problems"), ...i.problems.map(p => h("div", { class: `problem ${p.severity}`, text: p.message }))) : undefined,
    h("section", { class: "actions-col" }, eyebrow("Actions"), ...actions),
    h("p", { class: "muted small evidence", text: "Consequences are computed by DataPass from options.json and this machine; prices, scores, pros and cons are declarations. Nothing is written until you record a decision." }));
}

function optionsSide(s: WorkbenchState): HTMLElement {
  const o = s.options!;
  const focus = ui.optFocus ?? "scenarios";
  const common = [
    btn("Export the comparison (Markdown)", () => command("datapass.exportOptionsComparison"), { icon: "⇩" }),
    btn("Ask the AI to compare", () => command("datapass.optionsAiContext", { purpose: "compare", decision: focus === "scenarios" ? undefined : focus }), { icon: "✦" }),
    btn("Copy options.json for the AI", () => command("datapass.copyForAi", "options"), { icon: "⧉", title: "The file plus instructions: the AI returns the complete updated file" }),
    btn("Paste the AI's answer", () => command("datapass.showAiExchange", "options"), { icon: "⇣", title: "Opens the AI exchange (right side bar): checked as you paste, shown as a diff, backed up; you confirm before it is written" }),
    btn("Open options.json", () => command("datapass.openOptionsFile"), { kind: "link" })
  ];
  if (focus !== "scenarios") {
    const d = o.decisions.find(x => x.id === focus);
    if (d) {
      const x = d.options.find(y => y.id === ui.optOption) ?? d.options.find(y => y.chosen) ?? d.options.find(y => y.current)!;
      const actions = [
        x.current ? undefined : btn(`Preview "${x.label}"`, () => previewPicks([`${d.id}=${x.id}`]), { kind: "primary", icon: "◎" }),
        btn(x.chosen ? `Decided: ${x.label}` : `Record decision: ${x.label}`, () => command("datapass.recordDecision", { decision: d.id, option: x.id }), { icon: "★", title: "Writes chosen/decidedOn/rationale in options.json (backup kept); the AI applies it later" }),
        x.chosen && !x.current ? btn("Ask the AI to apply this decision", () => command("datapass.optionsAiContext", { purpose: "apply", decision: d.id, option: x.id }), { icon: "✦" }) : undefined,
        x.chosen && !x.current ? btn("Apply this decision as a work order", () => command("datapass.workOrders.newFromDecision", d.id), { icon: "⚒", title: "Opens the Agent tab with the order prefilled (the apply pack attached)" }) : undefined,
        ...common
      ].filter((b): b is HTMLElement => !!b);
      return impactSide(s, `${d.title}: ${x.label}`, x.impact, actions);
    }
  }
  const p = s.preview;
  const scenario = p ? undefined : o.scenarios.find(x => x.recommended) ?? o.scenarios[0];
  return impactSide(s, p ? `Previewed: ${p.title}` : scenario?.title ?? "Current architecture", p?.impact ?? scenario!.impact, [
    p ? btn("Back to the current architecture", () => previewScenario("current"), { kind: "primary" }) : undefined,
    ...common
  ].filter((b): b is HTMLElement => !!b));
}

function optionsCenter(s: WorkbenchState): HTMLElement {
  const o = s.options!;
  const focus = ui.optFocus ?? "scenarios";
  const d = focus === "scenarios" ? undefined : o.decisions.find(x => x.id === focus);
  if (!d) return h("main", { class: "center" },
    h("div", { class: "breadcrumb", text: `${s.project?.title ?? "Project"} / Architecture options` }),
    h("div", { class: "bar" }, h("div", {}, eyebrow("Scenarios"), h("h2", { text: o.title ?? "Architecture options" })), o.description ? h("span", { class: "muted small objective", text: o.description }) : undefined),
    previewBanner(s),
    scenariosTable(s),
    customBuilder(s),
    h("p", { class: "muted small", text: "Each column is a whole architecture. \"Preview on diagram\" shows it in the Architecture panel with what it adds, changes and removes; nothing is written." }));
  const cur = d.options.find(x => x.current)!;
  const chosen = d.options.find(x => x.chosen && !x.current);
  return h("main", { class: "center" },
    h("div", { class: "breadcrumb", text: `${s.project?.title ?? "Project"} / Architecture options / ${d.title}` }),
    h("div", { class: "bar" }, h("div", {}, eyebrow(`Decision${d.level ? ` · level: ${d.level}` : ""}${d.subproject ? ` · ${subp(d.subproject)?.title ?? d.subproject}` : ""}`), h("h2", { text: d.title })),
      d.question ? h("span", { class: "muted small objective", text: d.question }) : undefined),
    h("div", { class: "next h-info" }, h("b", { text: "Current: " }), h("span", { text: cur.label }),
      chosen ? h("span", { text: ` · Decided${d.decidedOn ? ` on ${d.decidedOn}` : ""}${d.decidedBy ? ` by ${d.decidedBy}` : ""}: ${chosen.label} (the AI still has to apply it)${d.rationale ? ` — ${d.rationale}` : ""}` }) : undefined),
    previewBanner(s),
    decisionTable(s, d),
    costList(s, d),
    d.notes ? h("p", { class: "muted small", text: d.notes }) : undefined);
}

function optionsEmpty(s: WorkbenchState): HTMLElement {
  return h("div", { class: "empty" },
    h("h2", { text: s.optionsError ? "options.json has errors" : "No architecture options yet" }),
    s.optionsError ? h("ul", { class: "problems" }, h("li", { text: s.optionsError })) : undefined,
    h("p", { class: "muted", text: "Options let you compare 2–3 alternatives per level of the architecture (storage, processing, databases, compute…) before building anything: what each one adds or removes, which official tools it needs, what DataPass supports, and the declared prices with their source and date. The AI prepares them in .datapass/options.json; DataPass computes the consequences; you decide." }),
    h("div", { class: "row" },
      btn("Ask the AI to propose options", () => command("datapass.copyForAi", "options"), { kind: "primary", icon: "✦" }),
      btn("Paste the AI's answer", () => command("datapass.showAiExchange", "options"), { icon: "⇣" }),
      s.optionsError ? btn("Open options.json", () => command("datapass.openOptionsFile")) : undefined,
      btn("How options work (guide)", () => command("datapass.openPreparationGuide"), { kind: "link" })));
}

// ------------------------------------------------------------------ project sheet view

function sheetNav(s: WorkbenchState): HTMLElement {
  const sh = s.sheet!;
  const counts: Record<SheetSection, number> = { datasets: sh.datasets.length, formulas: sh.formulas.length, runtimes: sh.runtimes.length, glossary: sh.glossary.length };
  const labels: Record<SheetSection, string> = { datasets: "Data (tables, collections, files)", formulas: "Formulas", runtimes: "Where code runs", glossary: "Glossary" };
  return h("nav", { class: "nav", "aria-label": "Project sheet sections" }, eyebrow("Project sheet"),
    ...(Object.keys(labels) as SheetSection[]).map(k => h("button", { class: `navrow ${ui.sheetSection === k ? "active" : ""}`, type: "button", "aria-pressed": String(ui.sheetSection === k), onclick: () => { ui.sheetSection = k; ui.sheetFocus = undefined; saveUi(); render(); } },
      h("span", { class: "label", text: labels[k] }), h("span", { class: "meta", text: String(counts[k]) }))),
    h("div", { class: "divider" }),
    sh.summary ? h("p", { class: "small", text: sh.summary }) : undefined,
    h("p", { class: "muted small", text: `What the project declares${sh.asOf ? `, as of ${sh.asOf}` : ""}. DataPass never computes a formula, counts rows or connects to a database.` }),
    h("div", { class: "actions-col" },
      btn("Ask the AI to fill the sheet", () => command("datapass.copyForAi", "sheet"), { icon: "✦" }),
      btn("Paste the AI's answer", () => command("datapass.showAiExchange", "sheet"), { icon: "⇣" }),
      btn("Open sheet.json", () => command("datapass.openSheetFile"), { kind: "link" })));
}

function compLink(id: string | undefined): HTMLElement {
  if (!id) return h("span", { class: "muted", text: "—" });
  const c = comp(id);
  return c ? btn(c.label, () => select(c.subprojects[0], c.id), { kind: "link", title: "Select this component" }) : h("span", { class: "warn", text: id, title: "Not a component of graph.json" });
}

function sheetCenter(s: WorkbenchState): HTMLElement {
  const sh = s.sheet!;
  const focusRow = (id: string) => { ui.sheetFocus = id; saveUi(); render(); };
  const rowAttrs = (id: string) => ({ class: `clickrow ${ui.sheetFocus === id ? "focus" : ""}`, tabindex: "0", onclick: () => focusRow(id), onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") focusRow(id); } });
  let table: HTMLElement;
  switch (ui.sheetSection) {
    case "datasets":
      table = h("table", { class: "cmp sheet" }, h("thead", {}, h("tr", {}, ...["Data", "Where", "Kind", "Volume", "Key columns"].map(t => h("th", { text: t })))),
        h("tbody", {}, ...sh.datasets.map(d => h("tr", rowAttrs(d.id),
          h("td", {}, h("b", { text: d.label }), d.classification ? h("div", { class: "muted small", text: d.classification }) : undefined),
          h("td", {}, compLink(d.componentId)),
          h("td", { class: "small", text: d.kind ?? "—" }),
          h("td", { class: "small", text: volume(d) || "—" }),
          h("td", {}, ...(d.columns ?? []).filter(c => c.role && c.role !== "text").slice(0, 6).map(c => h("span", { class: "chip", title: c.meaning ?? "", text: `${c.name}${c.unit ? ` [${c.unit}]` : ""} · ${c.role}` })))))));
      break;
    case "formulas":
      table = h("table", { class: "cmp sheet" }, h("thead", {}, h("tr", {}, ...["Formula", "Expression", "Result", "Computed in"].map(t => h("th", { text: t })))),
        h("tbody", {}, ...sh.formulas.map(f => h("tr", rowAttrs(f.id),
          h("td", {}, h("b", { text: f.label }), f.source ? h("div", { class: "muted small", text: f.source }) : undefined),
          h("td", {}, h("code", { class: "formula", text: f.expression })),
          h("td", { class: "small", text: [f.result?.symbol, f.result?.unit ? `[${f.result.unit}]` : undefined].filter(Boolean).join(" ") || "—" }),
          h("td", {}, compLink(f.componentId), f.where ? h("div", { class: "muted small", text: `${f.where.path}${f.where.symbol ? ` · ${f.where.symbol}` : ""}` }) : undefined)))));
      break;
    case "runtimes":
      table = h("table", { class: "cmp sheet" }, h("thead", {}, h("tr", {}, ...["Runtime", "Host", "Specs", "Access", "Runs"].map(t => h("th", { text: t })))),
        h("tbody", {}, ...sh.runtimes.map(r => h("tr", rowAttrs(r.id),
          h("td", {}, h("b", { text: r.label }), r.decisionRef ? h("div", {}, btn("Compare options", () => command("datapass.openOptions", r.decisionRef), { kind: "link" })) : undefined),
          h("td", { class: "small", text: [r.host, r.region].filter(Boolean).join(" · ") || "—" }),
          h("td", { class: "small", text: [r.specs, r.os].filter(Boolean).join(" · ") || "—" }),
          h("td", { class: "small", text: r.access ?? "—" }),
          h("td", {}, ...(r.runs ?? (r.componentId ? [r.componentId] : [])).map(id => compLink(id)))))));
      break;
    default:
      table = h("table", { class: "cmp sheet" }, h("thead", {}, h("tr", {}, h("th", { text: "Term" }), h("th", { text: "Meaning" }))),
        h("tbody", {}, ...sh.glossary.map(g => h("tr", {}, h("td", {}, h("b", { text: g.term })), h("td", { class: "small", text: g.meaning })))));
  }
  const empty = { datasets: sh.datasets.length, formulas: sh.formulas.length, runtimes: sh.runtimes.length, glossary: sh.glossary.length }[ui.sheetSection] === 0;
  return h("main", { class: "center" },
    h("div", { class: "breadcrumb", text: `${s.project?.title ?? "Project"} / Project sheet` }),
    empty ? h("p", { class: "muted", text: "Nothing declared in this section yet." }) : h("div", { class: "cmpwrap" }, table));
}

function sheetSide(s: WorkbenchState): HTMLElement {
  const sh = s.sheet!;
  const id = ui.sheetFocus;
  const d = ui.sheetSection === "datasets" ? sh.datasets.find(x => x.id === id) : undefined;
  const f = ui.sheetSection === "formulas" ? sh.formulas.find(x => x.id === id) : undefined;
  const r = ui.sheetSection === "runtimes" ? sh.runtimes.find(x => x.id === id) : undefined;
  if (d) return h("div", { class: "detail" }, eyebrow("Data"), h("h2", { text: d.label }),
    h("div", { class: "card" }, kv("Where", comp(d.componentId)?.label ?? d.componentId ?? "—"), kv("Kind", d.kind ?? "—"), kv("Volume", volume(d) || "—"), d.refresh ? kv("Refresh", d.refresh) : undefined, d.asOf ? kv("As of", d.asOf) : undefined,
      d.producedBy?.length ? kv("Produced by", d.producedBy.map(x => comp(x)?.label ?? x).join(", ")) : undefined,
      d.consumedBy?.length ? kv("Read by", d.consumedBy.map(x => comp(x)?.label ?? x).join(", ")) : undefined),
    (d.columns ?? []).length ? h("table", { class: "cmp cols" }, h("thead", {}, h("tr", {}, ...["Column", "Type", "Role", "Meaning"].map(t => h("th", { text: t })))),
      h("tbody", {}, ...(d.columns ?? []).map(c => h("tr", {}, h("td", {}, h("code", { text: c.name })), h("td", { class: "small", text: `${c.type ?? ""}${c.unit ? ` [${c.unit}]` : ""}` }), h("td", { class: "small", text: c.role ?? "" }), h("td", { class: "small", text: c.meaning ?? "" }))))) : undefined,
    d.notes ? h("p", { class: "small", text: d.notes }) : undefined);
  if (f) return h("div", { class: "detail" }, eyebrow("Formula"), h("h2", { text: f.label }),
    h("code", { class: "formula block", text: f.expression }),
    f.result ? h("p", { class: "small", text: `Result: ${[f.result.symbol, f.result.meaning, f.result.unit ? `[${f.result.unit}]` : undefined].filter(Boolean).join(" — ")}` }) : undefined,
    (f.variables ?? []).length ? h("table", { class: "cmp cols" }, h("thead", {}, h("tr", {}, ...["Symbol", "Meaning", "Unit"].map(t => h("th", { text: t })))),
      h("tbody", {}, ...(f.variables ?? []).map(v => h("tr", {}, h("td", {}, h("code", { text: v.symbol })), h("td", { class: "small", text: v.meaning ?? "" }), h("td", { class: "small", text: v.unit ?? "" }))))) : undefined,
    h("div", { class: "card" }, kv("Computed in", comp(f.componentId)?.label ?? f.componentId ?? "—"), f.where ? kv("File", `${f.where.repoRef ? `${f.where.repoRef} / ` : ""}${f.where.path}`) : undefined, f.source ? kv("Source", f.source) : undefined),
    f.validation ? h("p", { class: "small", text: `Validation: ${f.validation}` }) : undefined,
    f.notes ? h("p", { class: "muted small", text: f.notes }) : undefined,
    h("section", { class: "actions-col" },
      f.where ? btn("Open the file that computes it", () => command("datapass.openSheetReference", f.id), { icon: "↗" }) : undefined,
      f.reference ? btn("Open the reference", () => command("datapass.openOptionSource", f.reference), { kind: "link" }) : undefined),
    h("p", { class: "muted small evidence", text: "Shown as the project writes it. DataPass never evaluates a formula: the project's own code and tools do." }));
  if (r) return h("div", { class: "detail" }, eyebrow("Where code runs"), h("h2", { text: r.label }),
    h("div", { class: "card" }, kv("Host", r.host ?? "—"), r.region ? kv("Region", r.region) : undefined, kv("Specs", r.specs ?? "—"), r.os ? kv("OS", r.os) : undefined, kv("Access", r.access ?? "—"), r.cost ? kv("Cost", r.cost) : undefined,
      kv("Runs", (r.runs ?? []).map(x => comp(x)?.label ?? x).join(", ") || "—")),
    r.notes ? h("p", { class: "small", text: r.notes }) : undefined,
    r.decisionRef ? btn("Compare the alternatives", () => command("datapass.openOptions", r.decisionRef), { kind: "primary", icon: "⑂" }) : undefined);
  return h("div", { class: "detail" }, eyebrow("Project sheet"), h("h2", { text: "Select a row" }), h("p", { class: "muted", text: "Pick a dataset, a formula or a runtime to see all its details: columns, variables and units, where it is computed, how it is reached." }));
}

function sheetEmpty(s: WorkbenchState): HTMLElement {
  return h("div", { class: "empty" },
    h("h2", { text: s.sheetError ? "sheet.json has errors" : "No project sheet yet" }),
    s.sheetError ? h("ul", { class: "problems" }, h("li", { text: s.sheetError })) : undefined,
    h("p", { class: "muted", text: "The project sheet keeps what is specific to this project: order of magnitude of each table, collection or file set, the columns that matter, the project's formulas as its code computes them (with units and the file that computes them), and where code runs (VM, Docker, cluster). DataPass shows them next to each component and gives them to the AI." }),
    h("div", { class: "row" },
      btn("Ask the AI to fill the sheet", () => command("datapass.copyForAi", "sheet"), { kind: "primary", icon: "✦" }),
      btn("Paste the AI's answer", () => command("datapass.showAiExchange", "sheet"), { icon: "⇣" }),
      s.sheetError ? btn("Open sheet.json", () => command("datapass.openSheetFile")) : undefined));
}

// ------------------------------------------------------------------ board view (0.16)

const TYPE_TEXT: Record<string, string> = { task: "task", bug: "bug", feature: "feature", decision: "decision", question: "question" };
const TYPE_TONE: Record<string, string> = { task: "muted", bug: "bad", feature: "info", decision: "warn", question: "muted" };
const PRIORITY_TONE: Record<string, string> = { P0: "bad", P1: "bad", P2: "warn", P3: "muted", P4: "muted" };
const CARD_FILE: Record<string, [string, string]> = {
  found: ["here", "ok"], missing: ["missing", "bad"], "not-cloned": ["not cloned", "warn"], planned: ["repo planned", "muted"], unknown: ["not checked", "muted"], refused: ["refused", "bad"]
};

function boardCards(s: WorkbenchState): CardView[] {
  const q = (ui.boardQuery ?? "").trim().toLowerCase();
  return (s.board?.cards ?? []).filter(c =>
    (!ui.boardSub || c.subprojects.includes(ui.boardSub))
    && (!ui.boardSprint || (ui.boardSprint === "-" ? !c.sprint : c.sprint?.id === ui.boardSprint))
    && (!ui.boardTypes.length || ui.boardTypes.includes(c.type))
    && (!q || c.title.toLowerCase().includes(q) || c.id.includes(q)));
}

function moveCardTo(c: CardView, status: string): void {
  if (c.status !== status) command("datapass.board.moveCard", { item: c.id, status });
}

/** Shift+← / Shift+→: the previous or next column (keyboard alternative to dragging; Alt+arrows are VS Code's Go Back / Go Forward). */
function stepCard(s: WorkbenchState, c: CardView, dir: -1 | 1): void {
  const cols = s.board!.columns;
  const next = cols[cols.findIndex(x => x.id === c.status) + dir];
  if (next) moveCardTo(c, next.id);
}

function focusCard(id: string): void {
  ui.boardFocus = id;
  saveUi();
  render();
  // In a narrow tab the card panel is under the kanban: bring it into view when it is off-screen.
  const side = document.querySelector<HTMLElement>(".shell.board aside.side");
  if (side && side.getBoundingClientRect().top > window.innerHeight - 60) side.scrollIntoView({ block: "nearest" });
}

function boardNav(s: WorkbenchState): HTMLElement {
  const b = s.board!;
  const setFilter = (k: "boardSub" | "boardSprint") => (e: Event) => { const v = (e.target as HTMLSelectElement).value; ui[k] = v || undefined; saveUi(); render(); };
  const option = (value: string, text: string, selected: boolean) => { const o = h("option", { value, text }) as HTMLOptionElement; o.selected = selected; return o; };
  const subs = s.subprojects.filter(x => !x.implicit);
  const all = b.cards;
  const typeChip = (t: string) => {
    const on = ui.boardTypes.includes(t);
    return h("button", { class: `chipbtn ${on ? "on" : ""}`, type: "button", "aria-pressed": String(on), onclick: () => { ui.boardTypes = on ? ui.boardTypes.filter(x => x !== t) : [...ui.boardTypes, t]; saveUi(); render(); } },
      TYPE_TEXT[t] ?? t, h("span", { class: "muted", text: ` ${all.filter(c => c.type === t && !c.done).length}` }));
  };
  const sprints = [...b.sprints].sort((x, y) => (x.state === "current" ? -1 : 0) - (y.state === "current" ? -1 : 0) || x.start.localeCompare(y.start));
  return h("nav", { class: "nav", "aria-label": "Board filters" },
    eyebrow("Filter the cards"),
    h("div", { class: "filters" },
      h("label", {}, "Sub-project", h("select", { class: "sel", "aria-label": "Sub-project", onchange: setFilter("boardSub") }, option("", "All sub-projects", !ui.boardSub), ...subs.map(x => option(x.id, x.title, ui.boardSub === x.id)))),
      h("label", {}, "Sprint", h("select", { class: "sel", "aria-label": "Sprint", onchange: setFilter("boardSprint") }, option("", "All sprints", !ui.boardSprint), option("-", "No sprint (backlog)", ui.boardSprint === "-"),
        ...b.sprints.map(x => option(x.id, `${x.title}${x.state === "current" ? " (current)" : x.state === "past" ? " (past)" : ""}`, ui.boardSprint === x.id)))),
      h("div", { class: "row", role: "group", "aria-label": "Card types" }, ...CARD_TYPES.map(typeChip)),
      h("input", { id: "board-search", class: "sel", type: "search", placeholder: "Title or id…", "aria-label": "Filter by title or id", value: ui.boardQuery ?? "", oninput: (e: Event) => { ui.boardQuery = (e.target as HTMLInputElement).value || undefined; saveUi(); render(); } }),
      ui.boardSub || ui.boardSprint || ui.boardTypes.length || ui.boardQuery ? btn("Clear filters", () => { ui.boardSub = ui.boardSprint = ui.boardQuery = undefined; ui.boardTypes = []; saveUi(); render(); }, { kind: "link" }) : undefined),
    sprints.length ? h("div", { class: "divider" }) : undefined,
    sprints.length ? eyebrow("Sprints") : undefined,
    ...sprints.map(x => {
      const total = x.open + x.done;
      return h("button", { class: `sprintcard ${x.state}`, type: "button", title: "Show only this sprint", onclick: () => { ui.boardSprint = x.id; saveUi(); render(); } },
        h("div", { class: "bar" }, h("b", { text: x.title }), h("span", { class: "muted small", text: x.state === "current" ? "current" : x.state })),
        h("span", { class: "muted small", text: `${x.start} → ${x.end}` }),
        x.goal ? h("span", { class: "small", text: x.goal }) : undefined,
        h("div", { class: "progress", title: `${x.done} of ${total} done` }, h("span", { style: `width:${total ? Math.round((x.done / total) * 100) : 0}%` })),
        h("span", { class: "muted small", text: `${x.done}/${total} done` }));
    }),
    b.milestones.length ? h("div", { class: "divider" }) : undefined,
    b.milestones.length ? eyebrow("Milestones") : undefined,
    ...b.milestones.map(m => h("div", { class: "kv" }, h("span", { text: m.title }), h("b", { class: m.overdue ? "bad" : "", text: `${m.due ?? "no date"} · ${m.open} open` }))),
    h("div", { class: "divider" }),
    h("div", { class: "actions-col" },
      btn("Ask the AI to update the board", () => command("datapass.copyForAi", "board"), { icon: "✦", title: "board.json plus instructions: the AI returns the complete updated file" }),
      btn("Paste the AI's answer", () => command("datapass.showAiExchange", "board"), { icon: "⇣", title: "Opens the AI exchange (right side bar): checked as you paste, shown as a diff, backed up; you confirm before it is written" }),
      btn("Open board.json", () => command("datapass.openBoardFile"), { kind: "link" })),
    h("p", { class: "muted small", text: "Moving a card writes only its status in board.json (a backup is kept); the AI keeps the rest. Other viewers, such as Mongoku, read this file from GitHub: DataPass never talks to them." }));
}

function cardEl(s: WorkbenchState, c: CardView): HTMLElement {
  const on = ui.boardFocus === c.id;
  return h("div", {
    id: `card-${c.id}`, class: `kcard t-${c.type}${on ? " active" : ""}${c.done ? " isdone" : ""}`, role: "listitem", tabindex: "0", draggable: "true",
    "aria-label": `${TYPE_TEXT[c.type]} ${c.title}`, title: `${c.id}: ${c.title}\nDrag it to another column, or Shift+← / Shift+→.`,
    onclick: () => focusCard(c.id),
    onkeydown: (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key === "Enter" || k.key === " ") { e.preventDefault(); focusCard(c.id); }
      else if (k.shiftKey && !k.altKey && !k.ctrlKey && !k.metaKey && (k.key === "ArrowRight" || k.key === "ArrowLeft")) { e.preventDefault(); stepCard(s, c, k.key === "ArrowRight" ? 1 : -1); }
    },
    ondragstart: (e: Event) => { const d = (e as DragEvent).dataTransfer; if (d) { d.setData("text/plain", c.id); d.effectAllowed = "move"; } }
  },
    h("div", { class: "kcardtop" }, pill(TYPE_TEXT[c.type] ?? c.type, TYPE_TONE[c.type] ?? "muted"), c.priority ? pill(c.priority, PRIORITY_TONE[c.priority] ?? "muted") : undefined,
      c.environment?.production ? pill(c.environment.id, "bad", "Production environment") : undefined, h("span", { class: "grow" }), h("span", { class: "muted small", text: c.id })),
    h("div", { class: "kcardtitle", text: c.title }),
    c.sprint || c.due ? h("div", { class: "kcardmeta small" }, c.sprint ? h("span", { class: "muted", text: c.sprint.title }) : undefined, c.due ? h("span", { class: c.overdue ? "bad" : "muted", text: `${c.overdue ? "overdue · " : "due "}${c.due}` }) : undefined) : undefined,
    c.components.length ? h("div", { class: "kchips" }, ...c.components.slice(0, 4).map(x => h("span", { class: `chip${x.known ? "" : " warn"}`, text: `${x.glyph ? `${x.glyph} ` : ""}${x.label}` }))) : undefined,
    c.recipe ? h("div", { class: "muted small", text: `⚒ ${recipeById(c.recipe.id)?.title ?? c.recipe.id}${c.recipe.route ? ` · ${recipeById(c.recipe.id)?.routes.find(x => x.id === c.recipe!.route)?.title ?? c.recipe.route}` : ""}` }) : undefined,
    c.files.length || c.links.length ? h("div", { class: "muted small", text: [c.files.length ? `${c.files.length} file${c.files.length === 1 ? "" : "s"}${c.files.some(f => f.state === "missing") ? " (missing)" : ""}` : "", c.links.length ? `${c.links.length} link${c.links.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") }) : undefined);
}

function boardCenter(s: WorkbenchState): HTMLElement {
  const b = s.board!;
  const cards = boardCards(s);
  const filtered = cards.length !== b.cards.length;
  const columns = b.columns.map(col => {
    const inCol = cards.filter(c => c.status === col.id);
    const el = h("section", {
      class: `kcol${col.done ? " done" : ""}`, "aria-label": `${col.title}: ${inCol.length} card(s)`,
      ondragover: (e: Event) => { e.preventDefault(); el.classList.add("drop"); },
      ondragleave: () => el.classList.remove("drop"),
      ondrop: (e: Event) => { e.preventDefault(); el.classList.remove("drop"); const id = (e as DragEvent).dataTransfer?.getData("text/plain"); const c = b.cards.find(x => x.id === id); if (c) moveCardTo(c, col.id); }
    },
      h("div", { class: "kcolhead" }, h("b", { text: col.title }),
        h("span", { class: `vbadge${col.over ? " over" : ""}`, text: col.limit ? `${col.count}/${col.limit}` : String(col.count), title: col.limit ? `Limit of ${col.limit} card(s) in progress${col.over ? ": exceeded" : ""}` : `${col.count} card(s)` })),
      col.description ? h("div", { class: "muted small", text: col.description }) : undefined,
      h("div", { class: "kcards", role: "list" }, ...inCol.map(c => cardEl(s, c))),
      !inCol.length ? h("div", { class: "muted small kempty", text: filtered ? "No card matches the filters." : "Drop a card here." }) : undefined);
    return el;
  });
  return h("main", { class: "center" },
    h("div", { class: "breadcrumb", text: `${s.project?.title ?? "Project"} / Board` }),
    h("div", { class: "bar" }, h("div", {}, eyebrow("Board"), h("h2", { text: b.title ?? "Tasks, bugs and decisions" })),
      h("span", { class: "muted small objective", text: `${b.summary.open} open · ${b.summary.bugs} bug(s)${b.summary.overdue ? ` · ${b.summary.overdue} overdue` : ""}${filtered ? ` · showing ${cards.length} of ${b.cards.length}` : ""}${b.updated ? ` · updated ${b.updated}` : ""}` })),
    b.description ? h("p", { class: "muted small", text: b.description }) : undefined,
    h("div", { class: "kanban" }, ...columns));
}

function boardSide(s: WorkbenchState): HTMLElement {
  const b = s.board!;
  const c = b.cards.find(x => x.id === ui.boardFocus);
  if (!c) return h("div", { class: "detail" }, eyebrow("Board"), h("h2", { text: "Select a card" }),
    h("p", { class: "muted", text: "Click a card to see its components, files and links, to move it, or to prepare an AI pack for it. Drag a card to another column (or Shift+← / Shift+→) to change its status." }));
  const col = b.columns.find(x => x.id === c.status);
  const sp = (id: string) => s.subprojects.find(x => x.id === id)?.title ?? id;
  const sprint = c.sprint ? b.sprints.find(x => x.id === c.sprint!.id) : undefined;
  const moveSel = h("select", { class: "sel", "aria-label": "Move to column", onchange: (e: Event) => moveCardTo(c, (e.target as HTMLSelectElement).value) },
    ...b.columns.map(x => { const o = h("option", { value: x.id, text: x.title }) as HTMLOptionElement; o.selected = x.id === c.status; return o; }));
  return h("div", { class: "detail" },
    eyebrow(`${TYPE_TEXT[c.type] ?? c.type} · ${c.id}`),
    h("h2", { text: c.title }),
    h("div", { class: "row tight" }, pill(col?.title ?? c.status, c.done ? "ok" : "info"), c.priority ? pill(c.priority, PRIORITY_TONE[c.priority] ?? "muted") : undefined, c.overdue ? pill(`overdue (${c.due})`, "bad") : undefined),
    c.description ? h("p", { class: "cardtext", text: c.description }) : undefined,
    h("div", { class: "card" },
      c.subprojects.length ? kv("Sub-project", c.subprojects.map(sp).join(", ")) : undefined,
      sprint ? kv("Sprint", `${sprint.title} (${sprint.start} → ${sprint.end})`) : undefined,
      c.milestone ? kv("Milestone", `${c.milestone.title}${c.milestone.due ? ` · ${c.milestone.due}` : ""}`) : undefined,
      c.due ? kv("Due", c.due) : undefined,
      c.environment ? kv("Environment", `${c.environment.title ?? c.environment.id}${c.environment.production ? " (production)" : ""}${c.environment.known ? "" : " — not declared"}`) : undefined,
      c.assignee ? kv("Assignee", c.assignee) : undefined,
      c.labels.length ? kv("Labels", c.labels.join(", ")) : undefined,
      c.created ? kv("Created", c.created) : undefined,
      c.closed ? kv("Closed", c.closed) : undefined),
    c.components.length ? h("section", {}, eyebrow("Components"), ...c.components.map(x => x.known
      ? h("button", { class: "comprow", type: "button", title: "Select it and show it in the architecture", onclick: () => { select(comp(x.id)?.subprojects[0], x.id); ui.view = "architecture"; saveUi(); render(); } },
        h("span", { class: "glyph", text: x.glyph ?? "◻", "aria-hidden": "true" }), h("span", { class: "label", text: x.label }), h("span", { class: "muted small", text: comp(x.id)?.headline ?? "" }))
      : h("div", { class: "problem warning", text: `${x.id}: not a component of graph.json` }))) : undefined,
    c.files.length ? h("section", {}, eyebrow("Files"), h("div", { class: "filelist", role: "list" }, ...c.files.map(f => {
      const [text, tone] = CARD_FILE[f.state] ?? [f.state, "muted"];
      return h("button", { class: `filerow cardfile ${f.state === "found" ? "" : "absent"}`, type: "button", title: f.detail ?? `${f.repoLabel} / ${f.path}`, onclick: () => command("datapass.board.openFile", { item: c.id, index: f.index }) },
        h("span", { class: "fname" }, h("code", { text: f.path }), f.line ? h("span", { class: "muted small", text: ` :${f.line}` }) : undefined, h("span", { class: "muted small repoline", text: f.repoLabel })), pill(text, tone));
    }))) : undefined,
    c.links.length ? h("section", {}, eyebrow("Links"), h("div", { class: "actions-col" }, ...c.links.map(l => btn(l.label, () => command("datapass.board.openLink", { item: c.id, index: l.index }), { kind: "link", icon: "↗", title: l.url })))) : undefined,
    cardRecipeBlock(c),
    c.decision ? h("section", { class: "optbits" }, eyebrow("Architecture decision"), h("button", { class: "comprow", type: "button", title: "Compare the options", onclick: () => command("datapass.openOptions", c.decision!.id) },
      h("span", { class: "glyph", text: "⑂", "aria-hidden": "true" }), h("span", { class: "label" }, h("b", { text: c.decision.title }), h("span", { class: "muted small", text: `  current: ${c.decision.current ?? "?"}${c.decision.chosen ? ` · decided: ${c.decision.chosen}` : ""}` })))) : undefined,
    h("section", { class: "actions-col" }, eyebrow("Actions"),
      btn("Prepare AI pack for this card", () => command("datapass.board.aiPack", { item: c.id }), { kind: "primary", icon: "✦", title: c.type === "bug" ? "With the error text you copied, credentials and local paths removed" : undefined }),
      c.done ? undefined : btn("Work order for this card", () => command("datapass.workOrders.newFromCard", c.id), { icon: "⚒", title: "Opens the Agent tab with the order prefilled (the card pack attached)" }),
      h("label", { class: "row" }, h("span", { class: "small muted", text: "Move to" }), moveSel),
      btn("Open in board.json", () => command("datapass.openBoardFile", { item: c.id }), { kind: "link" })),
    h("p", { class: "muted small evidence", text: "The card is what the project says (board.json). A file is checked on this machine; a link opens only after you see its address." }));
}

function boardEmpty(s: WorkbenchState): HTMLElement {
  return h("div", { class: "empty" },
    h("h2", { text: s.boardError ? "board.json has errors" : "No board yet" }),
    s.boardError ? h("ul", { class: "problems" }, h("li", { text: s.boardError })) : undefined,
    h("p", { class: "muted", text: "The board keeps the project's tasks, bugs, features, decisions and questions, its sprints and milestones, in .datapass/board.json. Each card can name the components and files it concerns, so a click takes you there, and an AI pack for the card gives ChatGPT or Claude exactly that context. The AI keeps the file up to date; you move cards." }),
    h("div", { class: "row" },
      btn("Ask the AI to prepare the board", () => command("datapass.copyForAi", "board"), { kind: "primary", icon: "✦" }),
      btn("Paste the AI's answer", () => command("datapass.showAiExchange", "board"), { icon: "⇣" }),
      s.boardError ? btn("Open board.json", () => command("datapass.openBoardFile")) : undefined,
      btn("How the board works (guide)", () => command("datapass.openPreparationGuide"), { kind: "link" })));
}


// ------------------------------------------------------------------ work orders (0.20, pass AI-2)

const ORDER_TONE: Record<string, string> = { written: "muted", launched: "warn", reported: "info", done: "ok", abandoned: "muted", error: "bad" };
const OUT_TONE: Record<string, string> = { open: "info", merged: "ok", closed: "muted", "no-pr": "warn", "not-checked": "muted" };

function woRows(s: WorkbenchState): WbOrder[] {
  const w = s.workOrders!;
  const f = ui.woFilter ?? "all";
  return w.orders.filter(o => f === "all" ? true : f === "open" ? !o.closed : f === "needs" ? o.needs.length > 0 : o.closed);
}

function woNav(s: WorkbenchState): HTMLElement {
  const w = s.workOrders!;
  const chip = (id: NonNullable<Ui["woFilter"]>, label: string, n: number) => {
    const on = (ui.woFilter ?? "all") === id;
    return h("button", { class: `chipbtn ${on ? "on" : ""}`, type: "button", "aria-pressed": String(on), onclick: () => { ui.woFilter = id; saveUi(); render(); } }, label, h("span", { class: "muted", text: ` ${n}` }));
  };
  return h("nav", { class: "nav", "aria-label": "Work order filters" },
    eyebrow("Work orders"),
    h("p", { class: "muted small", text: w.typeLine }),
    w.allowed ? undefined : h("div", { class: "problem warning", text: w.why }),
    h("div", { class: "row", role: "group", "aria-label": "Show" },
      chip("all", "All", w.orders.length), chip("open", "Open", w.open), chip("needs", "Needs you", w.orders.filter(o => o.needs.length).length), chip("done", "Done", w.orders.filter(o => o.closed).length)),
    h("div", { class: "divider" }),
    h("div", { class: "actions-col" },
      btn("New work order", () => command("datapass.workOrders.new"), { kind: "primary", icon: "+", title: "Opens the Agent tab of the AI view (right side bar)" }),
      btn("Publish summary", () => command("datapass.workOrders.publishSummary"), { icon: "⇪", title: "Writes .datapass/work-log.json (and your private log repository when set); you commit them" }),
      btn("Export JSON…", () => command("datapass.workOrders.exportProject"), { kind: "link", title: "Names and states of the project, a sub-project or the company" }),
      btn("Re-read the orders", () => command("datapass.workOrders.refresh"), { kind: "link" })),
    h("p", { class: "muted small", text: "Orders stay on this computer (.datapass/local/work-orders). The durable record is the branches, the pull requests and the summary you publish. DataPass never merges, deploys or deletes." }));
}

/** 0.24 (AI-3): the conversation Claude Control linked to an order, or why none is shown. */
function conversationCell(o: WbOrder, w: NonNullable<WorkbenchState["workOrders"]>): HTMLElement {
  if (o.conversation) return h("span", { class: o.conversation.status === "needs-you" ? "warn" : "", text: o.conversation.text.replace(/ · (exact session|found by the marker line|moved to the app with \/desktop)$/, ""), title: o.conversation.text });
  const why = w.control === "on" ? "—" : w.control === "disabled" ? "— (Control switched off)" : w.control === "unknown" ? "—" : "— (Control off)";
  return h("span", { class: "muted", text: why });
}

function woCenter(s: WorkbenchState): HTMLElement {
  const w = s.workOrders!;
  const rows = woRows(s);
  const table = h("table", { class: "cmp sheet" },
    h("thead", {}, h("tr", {}, ...["When", "Order", "Agent", "Conversation", "Output", "Result", "Tokens"].map(t => h("th", { text: t })))),
    h("tbody", {}, ...rows.map(o => h("tr", {
      class: `clickrow${w.selected === o.id ? " focus" : ""}`, tabindex: "0", title: `${o.id}\nClick: its timeline in Details, its components in the diagram`,
      onclick: () => command("datapass.workOrders.select", o.id),
      onkeydown: (e: Event) => { const k = (e as KeyboardEvent).key; if (k === "Enter" || k === " ") { e.preventDefault(); command("datapass.workOrders.select", o.id); } }
    },
      h("td", { class: "muted small", text: o.createdAt ? o.createdAt.slice(5, 16).replace("T", " ") : "" }),
      h("td", {}, h("div", {}, pill(o.status, ORDER_TONE[o.status] ?? "muted"), " ", h("b", { text: `${o.short} ${o.title}` })), h("div", { class: "muted small", text: o.error ?? o.scope })),
      h("td", { class: "small", text: o.agent }),
      h("td", { class: "small" }, conversationCell(o, w)),
      h("td", {}, ...(o.outputs.length ? o.outputs.map(x => h("div", { class: `small ${x.ci === "failing" ? "bad" : ""}`, text: x.text })) : [h("span", { class: "muted small", text: o.kind === "investigate" ? "no pull request (a report)" : "no pull request (files to import)" })])),
      h("td", { class: "small" }, o.result.state === "valid" ? h("span", { text: `${o.result.status} (the agent says)${o.result.questions.length ? ` · ${o.result.questions.length} ?` : ""}` })
        : o.result.state === "refused" ? h("span", { class: "bad", text: "refused" }) : h("span", { class: "muted", text: "—" })),
      h("td", { class: "small money", text: o.conversation?.tokens ?? "—", title: o.conversation?.tokens ? "Tokens of the conversation (Claude Control)" : "Unknown without Claude Control" })))));
  const needs = w.orders.filter(o => !o.closed && o.needs.length).map(o => `${o.short}: ${o.needs[0]}`);
  return h("main", { class: "center" },
    h("div", { class: "breadcrumb", text: `${s.project?.title ?? "Project"} / Work orders` }),
    h("div", { class: "bar" }, h("div", {}, eyebrow("Work orders"), h("h2", { text: "What the agents were asked, and what came out" })),
      h("span", { class: "muted small objective", text: `${w.open} open · ${w.orders.length} in total` })),
    rows.length ? table : h("p", { class: "muted", text: w.orders.length ? "No order matches this filter." : "No work order yet. Write one in the Agent tab of the AI view (right side bar), or from a board card, a decision, a component's missing files or a failing pull request." }),
    needs.length ? h("div", { class: "note warn small", text: `Needs you: ${needs.slice(0, 6).join(" · ")}` }) : undefined);
}

function orderDetail(o: WbOrder, s: WorkbenchState, inWorkbench: boolean): HTMLElement {
  const timeline = h("ol", { class: "timeline" }, ...o.timeline.map(t => h("li", { class: t.tone ?? "" },
    h("div", {}, t.at ? h("span", { class: "muted small", text: `${t.at.slice(5, 16).replace("T", " ")}  ` }) : undefined, h("b", { text: t.what })),
    ...(t.detail ?? []).filter(Boolean).map(d => h("div", { class: "small tl-detail", text: d })))));
  const act = (label: string, id: string, opts: { kind?: "primary" | "secondary" | "link"; icon?: string; title?: string; args?: unknown[] } = {}) => btn(label, () => command(id, o.id, ...(opts.args ?? [])), { kind: opts.kind, icon: opts.icon, title: opts.title });
  return h("div", { class: "detail" },
    eyebrow(`Work order · ${o.id}`),
    h("h2", { text: o.title }),
    h("div", { class: "row tight" }, pill(o.status, ORDER_TONE[o.status] ?? "muted"), h("span", { class: "muted small", text: `${o.kind} · ${o.agent} · ${o.scope}` })),
    o.error ? h("div", { class: "problem warning", text: o.error }) : undefined,
    ...o.needs.map(n => h("div", { class: "problem warning", text: n })),
    h("div", { class: `next` }, h("b", { text: "Next: " }), h("span", { text: o.next })),
    o.outputs.length ? h("section", {}, eyebrow("Pull requests (checked by DataPass)"), ...o.outputs.map(x => h("div", { class: "envrow" },
      h("span", { text: x.text }), x.url ? btn("Open", () => command("datapass.workOrders.openPr", o.id, x.ref), { kind: "link", icon: "↗" }) : pill(x.state === "no-pr" ? "no PR" : x.state, OUT_TONE[x.state] ?? "muted")))) : undefined,
    o.conversation ? h("section", {}, eyebrow("Conversation (Claude Control)"),
      h("div", { class: "envrow" }, h("span", { class: "small", text: o.conversation.text }),
        o.conversation.openable ? btn("Open in Claude", () => command("datapass.control.openConversation", o.id), { kind: "link", icon: "↗" }) : undefined),
      h("div", { class: "muted small", text: [o.conversation.tokens ? `${o.conversation.tokens} tokens` : "", o.conversation.last ? `last activity ${o.conversation.last.slice(5, 16).replace("T", " ")}` : "", o.conversation.others ? `${o.conversation.others} more conversation${o.conversation.others > 1 ? "s" : ""} from this order` : ""].filter(Boolean).join(" · ") || "No token count yet" }))
      : s.workOrders?.control === "off" && o.status !== "written" && o.status !== "draft" ? h("p", { class: "muted small", text: "Claude Control is off: conversation status and tokens are hidden. The result and pull requests still arrive." }) : undefined,
    o.result.state === "valid" && (o.result.questions.length || o.result.followUps.length) ? h("section", {}, eyebrow("The agent asks / proposes"),
      ...o.result.questions.map(q => h("div", { class: "small", text: `? ${q}` })),
      ...o.result.followUps.map((f, i) => h("div", { class: "envrow" }, h("span", { class: "small", text: `→ ${f.title}` }), btn("Follow-up order", () => command("datapass.workOrders.followUp", o.id, i), { kind: "link" })))) : undefined,
    h("section", {}, eyebrow("Timeline"), timeline),
    h("section", { class: "actions-col" }, eyebrow("Actions"),
      !o.closed && o.canLaunch && o.status === "written" ? act("Launch", "datapass.workOrders.launch", { kind: "primary", icon: "▸", title: "Asks you to confirm first" }) : undefined,
      o.canResume ? act("Resume in terminal", "datapass.workOrders.resume", { icon: "↻" }) : undefined,
      o.proposed.length ? act(`Import the proposed ${o.proposed.join(", ")}`, "datapass.workOrders.importProposed", { icon: "⇣", title: "Validated, shown as a diff, confirmed, backed up" }) : undefined,
      o.changesCoordination && o.outputs.some(x => x.state === "open") ? act("Check the PR's DataPass files", "datapass.workOrders.checkPrFiles", { icon: "✓", title: "Fetches the branch and checks its .datapass/*.json like any import" }) : undefined,
      o.suggestDone ? act("Mark done", "datapass.workOrders.markDone", { kind: "primary", icon: "✓" }) : undefined,
      !o.closed ? act("Follow-up order", "datapass.workOrders.followUp", { icon: "→" }) : act("Follow-up order", "datapass.workOrders.followUp", { kind: "link" }),
      act("Copy for a chat", "datapass.workOrders.copyForChat", { kind: "link", title: "The same order for claude.ai or ChatGPT (no Claude Code quota)" }),
      act("Copy the prompt", "datapass.workOrders.copyPrompt", { kind: "link" }),
      act("Open order.md", "datapass.workOrders.openFile", { kind: "link" }),
      o.result.state !== "none" ? act("Open result.json", "datapass.workOrders.openFile", { kind: "link", args: ["result"] }) : undefined,
      !o.closed ? act("Revise (new order)", "datapass.workOrders.revise", { kind: "link" }) : undefined,
      !o.closed && !o.suggestDone ? act("Mark done", "datapass.workOrders.markDone", { kind: "link" }) : undefined,
      !o.closed ? act("Abandon", "datapass.workOrders.abandon", { kind: "link" }) : act("Archive", "datapass.workOrders.archive", { kind: "link" }),
      inWorkbench ? undefined : btn("All work orders", () => command("datapass.workOrders.show"), { kind: "link" }),
      btn("Back to the selection", () => command("datapass.workOrders.select"), { kind: "link" })),
    h("p", { class: "muted small evidence", text: "What the result claims is shown as \"the agent says\". Pull requests and CI come from Git and the host's CLI, found by the planned branch. Done is yours to set." }));
}

function woSide(s: WorkbenchState): HTMLElement {
  const w = s.workOrders!;
  const o = w.orders.find(x => x.id === w.selected);
  if (!o) return h("div", { class: "detail" }, eyebrow("Work orders"), h("h2", { text: "Select an order" }), h("p", { class: "muted", text: "Click a row to see its timeline, its pull requests with their CI, the agent's result and questions, and what to do next." }));
  return orderDetail(o, s, true);
}

function woEmpty(s: WorkbenchState): HTMLElement {
  return h("div", { class: "empty" }, h("h2", { text: "Work orders" }), h("p", { class: "muted", text: "Open a DataPass project to prepare work orders for Claude Code or Codex." }), btn("Switch project…", () => command("datapass.switchProject")));
}

// ------------------------------------------------------------------ toolkit (0.23)

const toolById = (id: string | undefined) => state?.toolkit?.tools.find(t => t.id === id);
const toolByExt = (ext: string | undefined) => ext ? state?.toolkit?.tools.find(t => t.extensionIds.some(e => e.toLowerCase() === ext.toLowerCase())) : undefined;
const recipeById = (id: string | undefined) => state?.toolkit?.recipes.find(r => r.id === id);
const PRICE_NOTE = "Prices are dated claims of the toolkit (DataPass's baseline or your hub), never authority: check the vendor's page before you buy.";
const APPLIES: Record<string, [string, string]> = { yes: ["applies here", "ok"], no: ["does not apply here", "muted"], unknown: ["not checked", "muted"] };
const SOURCE_TONE: Record<string, string> = { "built-in": "muted", hub: "info", "built-in, changed by the hub": "info" };

function pricePill(t: WbTool): HTMLElement {
  return pill(t.price.text, t.price.tone, [t.freeTier, t.price.dated ? `Checked ${t.price.dated}.` : "No date recorded.", PRICE_NOTE].filter(Boolean).join("\n"));
}

function openToolkitAt(focus: string): void {
  // The side bar and the panel have no views: the Workbench tab opens on the Toolkit.
  if (MODE !== "full") { command("datapass.openToolkit", focus); return; }
  ui.view = "toolkit";
  ui.tkFocus = focus;
  if (focus.startsWith("recipe:")) ui.tkSection = "recipes";
  else if (focus.startsWith("tool:")) ui.tkSection = "tools";
  saveUi();
  render();
}

function toolLine(t: WbTool, why?: string): HTMLElement {
  return h("button", { class: "comprow", type: "button", title: "Show it in the Toolkit", onclick: () => openToolkitAt(`tool:${t.id}`) },
    h("span", { class: "label" }, h("b", { text: t.label }), why ? h("span", { class: "muted small", text: `  ${why}` }) : undefined),
    t.state === "present" ? pill("installed", "ok") : undefined, pricePill(t));
}

/** Details: the catalogue tools of the component's official tool, with prices, and the recipes that use them. */
function toolsDetailBlock(componentId: string): HTMLElement | undefined {
  const k = state?.toolkit?.components[componentId];
  if (!k) return undefined;
  const tools = k.tools.map(toolById).filter((t): t is WbTool => !!t);
  return h("section", { class: "optbits" }, eyebrow("Tools and what they cost"),
    ...tools.map(t => toolLine(t, t.avoidWhen && t.status && t.status !== "active" ? t.status : undefined)),
    ...k.recipes.map(recipeById).filter((r): r is RecipeView => !!r).map(r => h("button", { class: "comprow", type: "button", title: "Show the recipe", onclick: () => openToolkitAt(`recipe:${r.id}`) },
      h("span", { class: "glyph", text: "⚒", "aria-hidden": "true" }), h("span", { class: "label" }, h("b", { text: r.title }), h("span", { class: "muted small", text: `  recipe · ${r.moduleLabel}` })))),
    h("p", { class: "muted small", text: PRICE_NOTE }));
}

function stepEl(r: RecipeView, route: RecipeRouteView, step: RecipeRouteView["steps"][number], i: number): HTMLElement {
  return h("li", {},
    h("span", { text: step.text }),
    step.copy ? h("div", { class: "row tight" }, h("code", { class: "small", text: step.copy }), btn("Copy", () => command("datapass.toolkit.copyStep", { recipe: r.id, route: route.id, step: i }), { kind: "link", title: "Copies the command; DataPass runs nothing from a recipe" })) : undefined,
    step.open ? btn("Open the page", () => command("datapass.toolkit.openStep", { recipe: r.id, route: route.id, step: i }), { kind: "link", icon: "↗" }) : undefined,
    step.capability ? h("span", { class: "muted small", text: ` (DataPass operation ${step.capability})` }) : undefined,
    step.tool ? h("span", { class: "muted small", text: ` · ${toolById(step.tool)?.label ?? step.tool}` }) : undefined);
}

function routeEl(r: RecipeView, route: RecipeRouteView, chosen: boolean): HTMLElement {
  const [text, tone] = APPLIES[route.applies] ?? [route.applies, "muted"];
  return h("div", { class: `card route${chosen ? " chosen" : ""}` },
    h("div", { class: "bar" }, h("b", { text: route.title }), h("span", {},
      chosen ? pill("the card's route", "info") : r.suggested === route.id ? pill("suggested", "ok", "The first route whose condition holds here") : undefined,
      pill(text, tone, route.condition))),
    route.condition ? h("div", { class: "muted small", text: route.condition }) : undefined,
    route.tools.length ? h("div", { class: "kchips" }, ...route.tools.map(t => h("button", { class: `chip${t.known ? "" : " warn"}`, type: "button", title: t.known ? `${t.price} — show it in the Toolkit` : "Not in the catalogue", onclick: () => t.known && openToolkitAt(`tool:${t.id}`), text: `${t.label}${t.state === "absent" ? " (not installed)" : ""} · ${t.price}` }))) : undefined,
    h("ol", { class: "steps" }, ...route.steps.map((s, i) => stepEl(r, route, s, i))),
    route.note ? h("p", { class: "muted small", text: route.note }) : undefined);
}

function recipeDetail(r: RecipeView, route?: string): HTMLElement {
  return h("div", { class: "recipe" },
    r.when ? h("p", { class: "small", text: `When: ${r.when}` }) : undefined,
    ...r.routes.map(x => routeEl(r, x, x.id === route)),
    r.checks.length ? h("div", {}, eyebrow("Checks"), h("ul", {}, ...r.checks.map(c => h("li", { text: c })))) : undefined,
    r.risks.length ? h("div", {}, eyebrow("Risks"), ...r.risks.map(x => h("div", { class: "problem warning", text: x }))) : undefined,
    h("p", { class: "muted small", text: `${r.moduleLabel} · ${r.file}${r.verified ? ` · verified ${r.verified}` : ""}${r.practice ? ` · practice: ${r.practice}` : ""}` }));
}

/** Board: the card's recipe, resolved against the toolkit. */
function cardRecipeBlock(c: CardView): HTMLElement | undefined {
  if (!c.recipe) return undefined;
  const r = recipeById(c.recipe.id);
  if (!r) return h("section", {}, eyebrow("Recipe"), h("div", { class: "problem warning", text: `Recipe "${c.recipe.id}" is not in the toolkit${state?.toolkit?.hub ? "" : " (no hub toolkit is read: add the hub's catalog to the datapass.catalogs setting)"}.` }));
  const unknownRoute = c.recipe.route && !r.routes.some(x => x.id === c.recipe!.route);
  return h("section", { class: "optbits" }, eyebrow("Recipe"),
    h("button", { class: "comprow", type: "button", title: "Show it in the Toolkit", onclick: () => openToolkitAt(`recipe:${r.id}`) },
      h("span", { class: "glyph", text: "⚒", "aria-hidden": "true" }), h("span", { class: "label" }, h("b", { text: r.title }), h("span", { class: "muted small", text: `  ${r.moduleLabel}` }))),
    unknownRoute ? h("div", { class: "problem warning", text: `Route "${c.recipe.route}" is not a route of this recipe.` }) : undefined,
    recipeDetail({ ...r, routes: c.recipe.route && !unknownRoute ? r.routes.filter(x => x.id === c.recipe!.route) : r.routes }, c.recipe.route));
}

function tkNav(s: WorkbenchState): HTMLElement {
  const k = s.toolkit!;
  const section = ui.tkSection ?? "tools";
  const item = (id: NonNullable<Ui["tkSection"]>, label: string, count: number, tone?: string) => h("button", { class: `navrow ${section === id ? "active" : ""}`, type: "button", onclick: () => { ui.tkSection = id; ui.tkFocus = undefined; saveUi(); render(); } },
    h("span", { class: "label", text: label }), h("span", { class: `vbadge${tone ? ` ${tone}` : ""}`, text: String(count) }));
  const option = (value: string, text: string, selected: boolean) => { const o = h("option", { value, text }) as HTMLOptionElement; o.selected = selected; return o; };
  return h("nav", { class: "nav", "aria-label": "Toolkit sections" },
    eyebrow("Toolkit"),
    item("tools", "Tools", k.tools.length),
    item("recipes", "Recipes", k.recipes.length),
    item("requests", "Needs a newer DataPass", k.requests.length + k.newerFiles, k.requests.length + k.newerFiles ? "over" : undefined),
    item("files", "Files read", k.files.length, k.files.some(f => f.error || f.skipped.length) ? "over" : undefined),
    h("div", { class: "divider" }),
    h("div", { class: "filters" },
      h("label", {}, "Module", h("select", { class: "sel", "aria-label": "Module", onchange: (e: Event) => { ui.tkModule = (e.target as HTMLSelectElement).value || undefined; saveUi(); render(); } },
        option("", "All modules", !ui.tkModule), ...k.modules.map(m => option(m.id, m.label, ui.tkModule === m.id)))),
      h("input", { id: "tk-search", class: "sel", type: "search", placeholder: "Name or id…", "aria-label": "Filter tools and recipes", value: ui.tkQuery ?? "", oninput: (e: Event) => { ui.tkQuery = (e.target as HTMLInputElement).value || undefined; saveUi(); render(); } })),
    h("div", { class: "divider" }),
    h("p", { class: "muted small", text: k.hub ? "DataPass's baseline, with the hub's toolkit files layered over it." : "DataPass's built-in baseline only: no hub toolkit was found (.datapass/toolkit in this folder, or beside a catalog of the datapass.catalogs setting)." }),
    h("div", { class: "actions-col" },
      btn("Ask the AI to update the toolkit", () => command("datapass.copyForAi", "toolkit"), { icon: "✦", title: "tools.json plus instructions: the AI returns the complete updated file (only when this folder is the hub)" }),
      btn("Paste the AI's answer", () => command("datapass.showAiExchange", "toolkit"), { icon: "⇣" })));
}

function tkMatch(text: string[], modules: string[]): boolean {
  if (ui.tkModule && !modules.includes(ui.tkModule)) return false;
  const q = ui.tkQuery?.toLowerCase();
  return !q || text.some(t => t.toLowerCase().includes(q));
}

function tkCenter(s: WorkbenchState): HTMLElement {
  const k = s.toolkit!;
  const section = ui.tkSection ?? "tools";
  const head = (title: string, sub: string) => [h("div", { class: "breadcrumb", text: `${s.project?.title ?? "DataPass"} / Toolkit` }), h("div", { class: "bar" }, h("div", {}, eyebrow("Toolkit"), h("h2", { text: title })), h("span", { class: "muted small objective", text: sub }))];
  if (section === "recipes") {
    const list = k.recipes.filter(r => tkMatch([r.title, r.id], [r.module]));
    return h("main", { class: "center" }, ...head("Recipes", `${list.length} of ${k.recipes.length}`),
      !k.recipes.length ? h("p", { class: "muted", text: "No recipe yet. Recipes live in the hub repository (.datapass/toolkit/recipes/*.json): step-by-step routes that name their tools." }) : undefined,
      h("div", { class: "filelist", role: "list" }, ...list.map(r => h("button", { class: `filerow${ui.tkFocus === `recipe:${r.id}` ? " active" : ""}`, type: "button", onclick: () => { ui.tkFocus = `recipe:${r.id}`; saveUi(); render(); } },
        h("span", { class: "fname" }, h("b", { text: r.title }), h("span", { class: "muted small repoline", text: `${r.moduleLabel} · ${r.routes.length} route(s)` })),
        r.suggested ? pill(`suggested: ${r.routes.find(x => x.id === r.suggested)?.title ?? r.suggested}`, "ok") : pill("route not checked", "muted")))));
  }
  if (section === "requests") {
    const newer = k.files.filter(f => f.newer);
    return h("main", { class: "center" }, ...head("Needs a newer DataPass", "What the toolkit's authors could not say with this version"),
      h("p", { class: "muted small", text: "When the toolkit format cannot express what a project needs, the AI adds an entry to datapassRequests instead of inventing a field. These are the input of the next DataPass version." }),
      ...newer.map(f => h("div", { class: "problem warning", text: `${f.path}: ${f.newer}` })),
      !k.requests.length && !newer.length ? h("p", { class: "muted", text: "Nothing requested." }) : undefined,
      ...k.requests.map(q => h("div", { class: "card" }, h("b", { text: q.title }), h("p", { class: "small", text: q.why }), q.example ? h("p", { class: "muted small", text: `Example: ${q.example}` }) : undefined,
        h("span", { class: "muted small", text: `${q.module ? `${q.module} · ` : ""}${q.file}` }))));
  }
  if (section === "files") {
    return h("main", { class: "center" }, ...head("Files read", k.hub ? `${k.files.length} file(s)` : "none"),
      h("div", { class: "card" }, h("b", { text: "Built-in baseline" }), h("span", { class: "muted small", text: "  the probe registry and the tools DataPass knows, with dated prices (shipped with the extension)" })),
      ...k.files.map(f => h("div", { class: "card" },
        h("div", { class: "bar" }, h("b", { text: f.title ?? f.path }), btn("Open", () => command("datapass.toolkit.openFile", { path: f.path }), { kind: "link" })),
        h("div", { class: "muted small", text: `${f.path}${f.updated ? ` · updated ${f.updated}` : ""}${f.requires ? ` · requires DataPass ${f.requires}` : ""} · ${f.tools} tool(s), ${f.recipes} recipe(s), ${f.requests} request(s)` }),
        f.error ? h("div", { class: "problem error", text: f.error }) : undefined,
        f.newer ? h("div", { class: "problem warning", text: f.newer }) : undefined,
        ...f.skipped.map(x => h("div", { class: "problem warning", text: `Skipped ${x}` })))),
      ...k.problems.map(p => h("div", { class: "problem warning", text: p })));
  }
  const list = k.tools.filter(t => tkMatch([t.label, t.id, ...t.extensionIds], t.modules));
  return h("main", { class: "center" }, ...head("Tools", `${list.length} of ${k.tools.length} · prices are dated claims`),
    h("div", { class: "filelist", role: "list" }, ...list.map(t => h("button", { class: `filerow${ui.tkFocus === `tool:${t.id}` ? " active" : ""}`, type: "button", onclick: () => { ui.tkFocus = `tool:${t.id}`; saveUi(); render(); } },
      h("span", { class: "fname" }, h("b", { text: t.label }), h("span", { class: "muted small repoline", text: [t.kind, t.publisher, t.status && t.status !== "active" ? t.status : undefined, t.source === "hub" || (t.source !== "built-in" && s.toolkit?.hubBadge) ? t.source : undefined].filter(Boolean).join(" · ") })),
      t.state === "present" ? pill("installed", "ok") : undefined, pricePill(t)))));
}

function tkSide(s: WorkbenchState): HTMLElement {
  const k = s.toolkit!;
  const [kind, id] = (ui.tkFocus ?? "").split(/:(.*)/s);
  if (kind === "recipe") {
    const r = k.recipes.find(x => x.id === id);
    if (r) return h("div", { class: "detail" }, eyebrow(`Recipe · ${r.moduleLabel}`), h("h2", { text: r.title }), recipeDetail(r));
  }
  const t = kind === "tool" ? k.tools.find(x => x.id === id) : undefined;
  if (!t) return h("div", { class: "detail" }, eyebrow("Toolkit"), h("h2", { text: "Select a tool or a recipe" }),
    h("p", { class: "muted", text: "Each tool says what it is for, who publishes it, what is free and what costs how much (with the date it was read), and how to install it (copied, never run). Recipes give the steps of a job and the tools of each route." }));
  return h("div", { class: "detail" },
    eyebrow(`${t.kind}${t.publisher ? ` · ${t.publisher}` : ""}`),
    h("h2", { text: t.label }),
    h("div", { class: "row tight" }, pricePill(t), t.status ? pill(t.status, t.status === "active" ? "ok" : "warn") : undefined, t.source === "built-in" || (t.source !== "hub" && !state?.toolkit?.hubBadge) ? undefined : pill(t.source, SOURCE_TONE[t.source] ?? "muted", t.changed.length ? `The hub changed: ${t.changed.join(", ")}` : undefined),
      t.probe ? pill(t.state === "present" ? "installed" : t.state === "absent" ? "not installed" : "not probed yet", t.state === "present" ? "ok" : "muted") : pill("no probe", "muted", "DataPass cannot see whether it is installed")),
    t.useWhen ? h("p", { class: "small", text: `Use when: ${t.useWhen}` }) : undefined,
    t.avoidWhen ? h("p", { class: "small", text: `Avoid when: ${t.avoidWhen}` }) : undefined,
    t.note ? h("p", { class: "muted small", text: t.note }) : undefined,
    t.replacedBy ? h("p", { class: "small" }, "Replaced by ", btn(toolById(t.replacedBy)?.label ?? t.replacedBy, () => openToolkitAt(`tool:${t.replacedBy}`), { kind: "link" })) : undefined,
    h("section", {}, eyebrow("Free tier and prices"),
      t.freeTier ? h("p", { class: "small", text: t.freeTier }) : h("p", { class: "muted small", text: t.priceModel === undefined ? "No price recorded for this tool." : "No free tier described." }),
      t.tiers.length ? h("div", { class: "card" }, ...t.tiers.map(x => h("div", { class: "tool" }, h("div", {}, h("b", { text: x.name }), x.features?.length ? h("div", { class: "muted small", text: x.features.join(" · ") }) : undefined, x.note ? h("div", { class: "muted small", text: x.note }) : undefined), h("span", { class: "small", text: x.price })))) : undefined,
      h("p", { class: "muted small", text: `${t.checkedAt ? `Read on ${t.checkedAt}. ` : ""}${PRICE_NOTE}` })),
    t.install.length ? h("section", {}, eyebrow("Install (copied, never run)"), ...t.install.map(l => h("div", { class: "row tight" }, h("code", { class: "small", text: l.text }), l.copy ? btn("Copy", () => command("datapass.toolkit.copyInstall", { tool: t.id, index: l.index }), { kind: "link" }) : undefined))) : undefined,
    t.links.length ? h("section", { class: "actions-col" }, eyebrow("Pages"), ...t.links.map(l => btn(l.label, () => command("datapass.toolkit.openLink", { tool: t.id, link: l.id }), { kind: "link", icon: "↗" }))) : undefined,
    t.recipes.length ? h("section", {}, eyebrow("Recipes that use it"), ...t.recipes.map(recipeById).filter((r): r is RecipeView => !!r).map(r => btn(r.title, () => openToolkitAt(`recipe:${r.id}`), { kind: "link", icon: "⚒" }))) : undefined,
    t.complements.length ? h("p", { class: "muted small", text: `Works with: ${t.complements.map(x => toolById(x)?.label ?? x).join(", ")}` }) : undefined,
    t.sideEffects.length ? h("p", { class: "muted small", text: `Side effects: ${t.sideEffects.join(", ")}` }) : undefined,
    h("p", { class: "muted small evidence", text: [t.maintainer ? `Maintainer: ${t.maintainer}.` : undefined, t.verified ? `Verified ${t.verified}.` : undefined, t.file ? `From ${t.file}.` : "From DataPass's baseline.", "Labels such as publisher and status are the catalogue's claims."].filter(Boolean).join(" ") }));
}

// ------------------------------------------------------------------ modes

function render(): void {
  // Keep the keyboard focus (a card moved to another column, the search box) across re-renders.
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.id;
  const caret = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] as const : undefined;
  renderInner();
  if (focusId) {
    const el = document.getElementById(focusId);
    el?.focus();
    if (caret && el instanceof HTMLInputElement && caret[0] !== null && caret[1] !== null) el.setSelectionRange(caret[0], caret[1]);
  }
  if (scrollToCard && ui.view === "board") {
    document.getElementById(`card-${scrollToCard}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    scrollToCard = undefined;
  }
  // The DOM is in place: lay out the diagrams for the width they got (reading it forces layout).
  drawDiagrams();
}

function renderInner(): void {
  const s = state;
  root.replaceChildren();
  if (!s) { root.append(h("p", { class: "muted pad", text: "Loading…" })); return; }
  const empty = emptyState(s);
  if (empty) { root.append(empty); return; }
  if (MODE === "detail") { root.append(detailColumn(s, true)); return; }
  const sp = subp(s.selection.subproject);
  const c = comp(s.selection.component);
  if (MODE === "map") {
    const tabs = h("div", { class: "tabs", role: "tablist" },
      h("button", { class: `tab ${!sp ? "active" : ""}`, role: "tab", "aria-selected": String(!sp), type: "button", onclick: () => select(undefined, undefined), text: "Whole project" }),
      ...s.subprojects.map(x => h("button", { class: `tab ${sp?.id === x.id ? "active" : ""}`, role: "tab", "aria-selected": String(sp?.id === x.id), type: "button", onclick: () => select(x.id, undefined) }, h("span", { class: `dot h-${x.health}` }), x.title)));
    root.append(h("div", { class: "map" }, tabs, previewBanner(s), diagram(s), c ? h("div", { class: "strip" }, h("b", { text: c.label }), h("span", { class: "muted", text: ` · ${c.headline} · Next: ${c.nextStep}` })) : undefined));
    return;
  }
  if (ui.view === "options") {
    root.append(header(s), s.options ? h("div", { class: "shell wide" }, optionsNav(s), optionsCenter(s), h("aside", { class: "side", "aria-label": "Consequences" }, optionsSide(s))) : optionsEmpty(s));
    return;
  }
  if (ui.view === "sheet") {
    root.append(header(s), s.sheet ? h("div", { class: "shell" }, sheetNav(s), sheetCenter(s), h("aside", { class: "side", "aria-label": "Row details" }, sheetSide(s))) : sheetEmpty(s));
    return;
  }
  if (ui.view === "workOrders") {
    root.append(header(s), s.workOrders ? h("div", { class: "shell wide" }, woNav(s), woCenter(s), h("aside", { class: "side", "aria-label": "Work order" }, woSide(s))) : woEmpty(s));
    return;
  }
  if (ui.view === "toolkit") {
    root.append(header(s), s.toolkit ? h("div", { class: "shell wide" }, tkNav(s), tkCenter(s), h("aside", { class: "side", "aria-label": "Tool or recipe" }, tkSide(s))) : h("div", { class: "empty" }, h("h2", { text: "Toolkit" }), h("p", { class: "muted", text: "Loading the catalogue…" })));
    return;
  }
  if (ui.view === "board") {
    root.append(header(s), s.board ? h("div", { class: "shell wide board" }, boardNav(s), boardCenter(s), h("aside", { class: "side", "aria-label": "Card details" }, boardSide(s))) : boardEmpty(s));
    return;
  }
  const crumbs = [s.project?.title ?? "Project", sp && !sp.implicit ? sp.title : undefined, c?.label].filter(Boolean).join(" / ");
  const center = h("main", { class: "center" },
    h("div", { class: "breadcrumb", text: crumbs }),
    h("div", { class: "bar" }, h("div", {}, eyebrow(sp ? "Architecture of the sub-project" : "Architecture of the project"), h("h2", { text: sp?.title ?? "All components" })),
      sp?.objective ? h("span", { class: "muted small objective", text: sp.objective }) : undefined),
    previewBanner(s),
    diagram(s),
    c ? filesBlock(c) : sp ? undefined : overview(s));
  root.append(header(s), h("div", { class: "shell" }, nav(s), center, h("aside", { class: "side", "aria-label": "Selection details" }, detailColumn(s, false))));
}

// In the bottom panel the height matters too: redraw when the window (the panel) changes size.
window.addEventListener("resize", () => { if (MODE === "map") { if (redrawTimer) clearTimeout(redrawTimer); redrawTimer = window.setTimeout(drawDiagrams, 60); } });

/** 0.22 modes: the view a command opened explicitly (shown even when the mode hides its tab). */
let forcedView: View | undefined;
window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type?: string; state?: WorkbenchState; view?: string; focus?: string; ui?: Partial<Ui> };
  if (msg?.type === "state" && msg.state) {
    state = msg.state;
    // 0.22 modes: a view the mode hides falls back to the architecture, unless a command asked for it.
    if (MODE === "full" && ui.view !== forcedView && (state.experience?.hiddenViews ?? []).includes(ui.view)) { ui.view = "architecture"; saveUi(); }
    render();
    return;
  }
  if (msg?.type === "ui") { applyHostUi(msg.ui); render(); return; }
  if (msg?.type === "show" && MODE === "full" && (msg.view === "architecture" || msg.view === "options" || msg.view === "sheet" || msg.view === "board" || msg.view === "workOrders" || msg.view === "toolkit")) {
    ui.view = msg.view;
    forcedView = msg.view;
    if (msg.view === "options") { ui.optFocus = typeof msg.focus === "string" ? msg.focus : ui.optFocus; ui.optOption = undefined; }
    if (msg.view === "board" && typeof msg.focus === "string") revealCard(msg.focus);
    if (msg.view === "toolkit" && typeof msg.focus === "string" && /^(tool|recipe):/.test(msg.focus)) { ui.tkFocus = msg.focus; ui.tkSection = msg.focus.startsWith("recipe:") ? "recipes" : "tools"; }
    if (msg.view === "toolkit" && (msg.focus === "requests" || msg.focus === "files")) { ui.tkSection = msg.focus; ui.tkFocus = undefined; }
    if (msg.view === "sheet" && typeof msg.focus === "string") {
      const [section, id] = msg.focus.split(":");
      if (section === "datasets" || section === "formulas" || section === "runtimes" || section === "glossary") { ui.sheetSection = section; ui.sheetFocus = id || undefined; }
    }
    saveUi();
    render();
  }
});
render();
reportedUi = JSON.stringify(diagramUi());
send({ type: "ready", ui: MODE === "detail" ? undefined : diagramUi() });
