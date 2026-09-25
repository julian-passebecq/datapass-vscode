/**
 * DataPass Workbench webview (browser side). Renders the state posted by the extension in one of
 * three modes: "full" (editor tab with four views: architecture, options, project sheet, board),
 * "map" (bottom panel: diagram of the selected sub-project) and "detail" (secondary side bar: the
 * selection's files, operations by phase, data and formulas, options, cards and actions).
 *
 * Safety: text is always set with textContent (never innerHTML); the only messages sent back are
 * select / openFile / preview / command, and the extension validates each against the project.
 */
import type { WbComponent, WbDecision, WbImpact, WbOperation, WbOption, WbReadiness, WbRepository, WbScenario, WbSubproject, WorkbenchState } from "../views/workbenchState";
import type { CardView } from "../core/project/board";
import { crossCount, layerCount, layoutGraph, sizeForWidth, sizeForWidthVertical, type Direction, type Layout, type LayoutEdgeInput } from "../core/project/layout";
import { buildDiagram, GROUP_BY, GROUP_BY_LABELS, type DiagramComponent, type DiagramModel, type GroupBy } from "../core/project/diagramModel";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };

const vscode = acquireVsCodeApi();
const MODE = (document.body.dataset.mode ?? "full") as "full" | "map" | "detail";
const root = document.getElementById("app")!;
let state: WorkbenchState | undefined;

type View = "architecture" | "options" | "sheet" | "board";
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
  if (MODE === "full" && (u.view === "architecture" || u.view === "options" || u.view === "sheet" || u.view === "board")) ui.view = u.view;
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
  "wrong-remote": ["wrong clone", "bad"], "not-a-repo": ["no Git", "warn"], restricted: ["not inspected", "muted"]
};
const SUPPORT_TEXT: Record<string, [string, string]> = { operations: ["DataPass operations", "ok"], files: ["files only", "info"], unsupported: ["not supported yet", "warn"] };
const DIFF_TEXT: Record<string, string> = { added: "new", replaced: "changed", removed: "removed" };
const pill = (text: string, tone: string, title?: string) => h("span", { class: `pill ${tone}`, text, title });
const eyebrow = (text: string) => h("div", { class: "eyebrow", text });
/** A component as the diagram shows it: the previewed architecture's version first (added or changed), else the project's. */
const comp = (id: string | undefined) => state?.preview?.components.find(c => c.id === id) ?? state?.components.find(c => c.id === id);
const inPreviewOnly = (id: string | undefined) => Boolean(id && !state?.components.some(c => c.id === id) && state?.preview?.components.some(c => c.id === id));
const subp = (id: string | undefined) => state?.subprojects.find(s => s.id === id);
const repoOf = (key: string | undefined) => state?.repositories.find(r => r.key === key);
const ago = (iso?: string) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const money = (amounts: Record<string, number>, suffix: string) => Object.entries(amounts).map(([c, n]) => `≈ ${n >= 100 ? Math.round(n) : n} ${c}${suffix}`).join(" + ");

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
  const decisions = s.options?.decisions.length;
  const sheetCount = s.sheet ? s.sheet.datasets.length + s.sheet.formulas.length + s.sheet.runtimes.length : undefined;
  return h("div", { class: "vtabs", role: "tablist", "aria-label": "Workbench views" },
    tab("architecture", "Architecture"),
    tab("options", "Options", s.optionsError ? "!" : decisions ? String(decisions) : undefined),
    tab("sheet", "Project sheet", s.sheetError ? "!" : sheetCount ? String(sheetCount) : undefined),
    tab("board", "Board", s.boardError ? "!" : s.board ? String(s.board.summary.open) : undefined));
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
    money(i.costs.monthly, "/month") || undefined
  ].filter(Boolean);
  return h("div", { class: "banner preview", role: "status" },
    h("b", { text: `Preview: ${p.title}` }),
    h("span", { class: "muted small", text: ` · ${parts.join(" · ")} · a preview only: graph.json is unchanged` }),
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
    const opts: Array<[string, string]> = [["current", "Architecture: current"], ...s.options.scenarios.filter(x => x.id !== "current").map(x => [x.id, `Preview: ${x.title}${x.recommended ? " ★" : ""}`] as [string, string])];
    if (current === "custom") opts.push(["custom", `Preview: ${s.preview!.title}`]);
    const previewSel = h("select", { class: "sel", "aria-label": "Architecture shown", title: "Show the consequences of an architecture option on the diagram (a preview: nothing is written)", onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v !== "custom") previewScenario(v); } },
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
        h("span", { class: "nodetop" }, h("span", { class: "glyph", text: c?.providerGlyph ?? ghost!.providerGlyph, "aria-hidden": "true" }), h("span", { class: "provider", text: c?.providerLabel ?? ghost?.providerLabel ?? c?.kind ?? ghost!.kind }), diff ? h("span", { class: `tag ${diff}`, text: DIFF_TEXT[diff] }) : undefined),
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
    ...a.mustNotCommit.map(m => h("div", { class: `note ${m.tracked ? "bad" : ""}`, text: m.tracked ? `${m.path} is committed to Git although it ${m.why}. Remove it from the repository and rotate what it contains.` : `${m.path} ${m.why}: keep it out of Git (it is not tracked).` })));
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
    h("div", { class: "row tight" }, h("span", { class: "glyph big", text: c.providerGlyph, "aria-hidden": "true" }), h("span", { text: c.providerLabel ?? c.kind }), c.status ? pill(`declared: ${c.status}`, "muted", "What the project files say; DataPass checks the files itself") : undefined, pill(HEALTH_TEXT[c.health] ?? c.health, c.health === "ok" ? "ok" : c.health === "blocked" ? "bad" : c.health === "attention" ? "warn" : "muted")),
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
    c.operations.length && !preview ? h("section", { class: "ops" }, eyebrow("What you can do, step by step"), ...[...byPhase].map(([phase, ops]) => h("div", { class: "phase" }, h("div", { class: "phasehead", text: phase }), ...ops.map(o => operationRow(o, c))))) : undefined,
    preview ? undefined : checklistBlock("Checklist", c.checklist, c.id),
    preview ? undefined : h("section", { class: "actions-col" }, eyebrow("Actions"),
      c.artifacts?.entry ? btn(`Open ${c.artifacts.entry}`, () => command("datapass.openComponentEntry", c.id), { kind: "primary", icon: "↗" }) : undefined,
      c.artifacts && repo?.state === "local" ? btn("Open this folder in a new window", () => command("datapass.openComponentFolder", c.id), { icon: "⧉", title: "Some official extensions work best with the component folder as the window root" }) : undefined,
      c.nativeTool ? btn(`Open ${c.nativeTool}`, () => command("datapass.openNativeTool", c.id), { icon: "⚙" }) : undefined,
      btn("Prepare AI context for this component", () => command("datapass.preparationPack", { componentId: c.id }), { icon: "✦" }),
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
    s.readiness ? readinessCard(s.readiness) : undefined,
    s.docs.length ? h("div", { class: "row" }, ...s.docs.map(d => btn(d.label, () => command("datapass.openDoc", d), { kind: "link", icon: "📄" }))) : undefined);
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
      h("span", { text: d.label }), h("span", { class: "muted small", text: ["non-secret id", d.provider, d.envKey ? `→ ${d.envKey}` : undefined].filter(Boolean).join(" · ") }),
      btn("Copy", () => command("datapass.env.copyIdentifier", d.id), { kind: "link", title: "Copies the id declared in the manifest" }))),
    h("div", { class: "row" },
      btn("Copy project ID", () => command("datapass.copyProjectId"), { icon: "⧉" }),
      btn("Open Power Ops", () => command("datapass.openPowerOps"), { icon: "⚿", title: "Secrets live in your local vault; DataPass never reads their values" }),
      btn("Readiness report", () => command("datapass.readinessReport"), { icon: "☰" })),
    serious.length ? h("div", { class: "checks" }, ...serious.slice(0, 10).map(c => h("div", { class: `problem ${c.severity}` }, h("b", { text: c.area }), h("span", { text: c.nextStep ? `${c.message} Next: ${c.nextStep}` : c.message })))) : undefined,
    h("p", { class: "muted small", text: `Optional companions: ${r.companions.map(c => `${c.label} — ${c.detail}`).join(" · ")}` }));
}

function detailColumn(s: WorkbenchState, withFiles: boolean): HTMLElement {
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
      return h("div", { class: "small money", text: money(i.costs.monthly, "/month") || "—", title: i.costs.missing.length ? `No monthly figure declared for: ${i.costs.missing.join(", ")}` : "Sum of the monthly figures declared in options.json" });
    case "oneTime":
      return h("div", { class: "small money", text: money(i.costs.oneTime, "") || "—" });
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
    h("div", { class: "colhead" }, h("b", { text: x.title }), x.recommended ? pill("recommended", "ok") : undefined, x.kind === "decided" ? pill("decided", "info") : undefined),
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
    h("div", { class: "colhead" }, h("b", { text: x.label }), x.current ? pill("current", "muted", "What graph.json describes today") : undefined, x.chosen && !x.current ? pill("decided", "info") : undefined, x.rejected ? pill("rejected", "bad") : undefined),
    x.summary ? h("div", { class: "muted small", text: x.summary }) : undefined,
    h("div", { class: "row tight" },
      btn("Consequences", () => { ui.optOption = x.id; saveUi(); render(); }, { kind: "link", title: "Show the consequences in the side column" }),
      x.current ? undefined : previewKey === `picks:${o.decisions.map(y => `${y.id}=${y.id === d.id ? x.id : y.current}`).join(",")}` ? pill("previewed", "info") : btn("Preview", () => previewPicks([`${d.id}=${x.id}`]), { kind: "link", title: "Show this option on the diagram (the other decisions stay current)" })))));
  const declared = o.criteria.filter(c => opts.some(x => x.values[c.id])).map(c => h("tr", {}, h("th", { title: c.description ?? "" }, c.label, c.unit ? h("span", { class: "muted small", text: ` (${c.unit})` }) : undefined, c.better ? h("span", { class: "muted small", text: c.better === "lower" ? " ↓ better" : " ↑ better" }) : undefined),
    ...opts.map(x => { const v = x.values[c.id]; return h("td", { title: v?.note ?? "" }, v ? h("div", { class: "small" }, v.text ? h("span", { text: v.text }) : undefined, v.text && v.score ? " " : undefined, scoreDots(v.score)) : h("span", { class: "muted", text: "—" })); })));
  const row = (label: string, what: Parameters<typeof impactCell>[1], title?: string) => h("tr", { class: "computed" }, h("th", { text: label, title }), ...opts.map(x => h("td", {}, impactCell(x.impact, what))));
  const list = (label: string, pick: (x: WbOption) => string[], tone = "") => opts.some(x => pick(x).length) ? h("tr", {}, h("th", { text: label }), ...opts.map(x => h("td", {}, pick(x).length ? h("ul", { class: `small bul ${tone}` }, ...pick(x).map(t => h("li", { text: t }))) : h("span", { class: "muted", text: "—" })))) : undefined;
  const declaredCost = (x: WbOption) => {
    const m = x.costs.filter(c => c.monthly !== undefined).reduce((n, c) => n + c.monthly!, 0);
    const t = x.costs.filter(c => c.oneTime !== undefined).reduce((n, c) => n + c.oneTime!, 0);
    return [x.costs.some(c => c.monthly !== undefined) ? `≈ ${Math.round(m * 100) / 100} ${o.currency}/month` : "", t ? `≈ ${Math.round(t * 100) / 100} ${o.currency} once` : ""].filter(Boolean).join(" · ") || "—";
  };
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
        h("td", { class: "small money", text: [c.monthly !== undefined ? `≈ ${c.monthly} ${c.currency}/month` : "", c.oneTime !== undefined ? `≈ ${c.oneTime} ${c.currency} once` : ""].filter(Boolean).join(" · ") || "—" }),
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
      kv("Declared cost", [money(i.costs.monthly, "/month"), money(i.costs.oneTime, " once")].filter(Boolean).join(" · ") || "—")),
    i.tools.newlyNeeded.length ? h("section", {}, eyebrow("Official tools it adds"), ...i.tools.newlyNeeded.map(t => h("div", { class: "tool" },
      h("div", {}, h("b", { text: t.label }), h("div", { class: "muted small", text: `for ${t.why.join(", ")}` })),
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
    c.decision ? h("section", { class: "optbits" }, eyebrow("Architecture decision"), h("button", { class: "comprow", type: "button", title: "Compare the options", onclick: () => command("datapass.openOptions", c.decision!.id) },
      h("span", { class: "glyph", text: "⑂", "aria-hidden": "true" }), h("span", { class: "label" }, h("b", { text: c.decision.title }), h("span", { class: "muted small", text: `  current: ${c.decision.current ?? "?"}${c.decision.chosen ? ` · decided: ${c.decision.chosen}` : ""}` })))) : undefined,
    h("section", { class: "actions-col" }, eyebrow("Actions"),
      btn("Prepare AI pack for this card", () => command("datapass.board.aiPack", { item: c.id }), { kind: "primary", icon: "✦", title: c.type === "bug" ? "With the error text you copied, credentials and local paths removed" : undefined }),
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

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type?: string; state?: WorkbenchState; view?: string; focus?: string; ui?: Partial<Ui> };
  if (msg?.type === "state" && msg.state) { state = msg.state; render(); return; }
  if (msg?.type === "ui") { applyHostUi(msg.ui); render(); return; }
  if (msg?.type === "show" && MODE === "full" && (msg.view === "architecture" || msg.view === "options" || msg.view === "sheet" || msg.view === "board")) {
    ui.view = msg.view;
    if (msg.view === "options") { ui.optFocus = typeof msg.focus === "string" ? msg.focus : ui.optFocus; ui.optOption = undefined; }
    if (msg.view === "board" && typeof msg.focus === "string") revealCard(msg.focus);
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
