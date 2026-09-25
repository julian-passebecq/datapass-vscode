/**
 * DataPass Workbench webview (browser side). Renders the state posted by the extension in one of
 * three modes: "full" (editor tab: overview, diagram, files, details), "map" (bottom panel:
 * diagram of the selected sub-project) and "detail" (secondary side bar: the selection's files,
 * operations by phase, checklist and actions).
 *
 * Safety: text is always set with textContent (never innerHTML); the only messages sent back are
 * select / openFile / command, and the extension validates each against the project map.
 */
import type { WbComponent, WbOperation, WbReadiness, WbRepository, WbSubproject, WorkbenchState } from "../views/workbenchState";
import { layerCount, layoutGraph, sizeForWidth, type Layout } from "../core/project/layout";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };

const vscode = acquireVsCodeApi();
const MODE = (document.body.dataset.mode ?? "full") as "full" | "map" | "detail";
const root = document.getElementById("app")!;
let state: WorkbenchState | undefined;
const ui = ((vscode.getState() as { collapsed?: Record<string, boolean>; zoom?: "fit" | "100" } | undefined) ?? {}) as { collapsed: Record<string, boolean>; zoom?: "fit" | "100" };
ui.collapsed ??= {};
ui.zoom ??= "fit";

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
const pill = (text: string, tone: string, title?: string) => h("span", { class: `pill ${tone}`, text, title });
const eyebrow = (text: string) => h("div", { class: "eyebrow", text });
const comp = (id: string | undefined) => state?.components.find(c => c.id === id);
const subp = (id: string | undefined) => state?.subprojects.find(s => s.id === id);
const repoOf = (key: string | undefined) => state?.repositories.find(r => r.key === key);
const ago = (iso?: string) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

function toggle(key: string) {
  ui.collapsed[key] = !ui.collapsed[key];
  vscode.setState(ui);
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
      btn("Re-inspect", () => command("datapass.refreshProject"), { icon: "⟳", title: "Read the files and Git state again (no network)" }),
      btn("Check for updates", () => command("datapass.checkForUpdates"), { icon: "⇣", title: "git fetch every cloned repository: see what the AI pushed, change nothing yet" }),
      btn("Prepare AI context", () => command("datapass.preparationPack", {}), { icon: "✦" }),
      btn("Layout", () => command("datapass.arrangeWorkbench"), { icon: "▦", title: "Show the Project tree, the architecture panel and the details side bar" })));
}

// ------------------------------------------------------------------ navigation (sub-projects, components, repositories)

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

function repoRow(r: WbRepository, compact: boolean): HTMLElement {
  const [text, tone] = REPO_STATE[r.state] ?? [r.state, "muted"];
  const actions: HTMLElement[] = [];
  if (r.state === "unbound" || r.state === "missing" || r.state === "wrong-remote") {
    if (r.remote) actions.push(btn("Clone", () => command("datapass.cloneRepository", r.key), { kind: "link", title: `Clone ${r.remote} next to this project (you confirm first)` }));
    actions.push(btn("Locate", () => command("datapass.locateRepository", r.key), { kind: "link", title: "Point DataPass to an existing clone on this machine" }));
  }
  if (r.state === "local" && !r.coordination) actions.push(btn("Open", () => command("datapass.openRepositoryWindow", r.key), { kind: "link", title: "Open this repository in a new window" }));
  if (r.state === "local" && (r.behind ?? 0) > 0) actions.push(btn(`Get ${r.behind}`, () => command("datapass.getUpdates", r.key), { kind: "link", title: "Fast-forward to the commits already fetched (you confirm first)" }));
  return h("div", { class: `repo ${compact ? "compact" : ""}` },
    h("div", { class: "repohead" }, h("span", { class: "label", text: r.label, title: r.remote ?? "" }), pill(text, tone)),
    h("div", { class: "muted small", text: r.state === "local" ? [r.branch ? `${r.branch}` : undefined, r.detail].filter(Boolean).join(" · ") : r.remote ?? r.detail }),
    actions.length ? h("div", { class: "row tight" }, ...actions) : undefined);
}

// ------------------------------------------------------------------ diagram

/** The diagram frame; the canvas is drawn by drawDiagrams() once the frame's width is known. */
function diagram(s: WorkbenchState): HTMLElement {
  if (!s.diagram.nodeIds.length) {
    return h("div", { class: "diagram empty-diagram" }, h("p", { class: "muted", text: s.components.length ? "No component in this sub-project yet." : "No components yet: describe them in .datapass/graph.json (graph version 0.2), or ask your AI to prepare it." }),
      btn("Open graph.json", () => command("datapass.openGraph"), { kind: "link" }));
  }
  const legend = h("div", { class: "legend" },
    h("span", { class: "lg data", text: "data" }), h("span", { class: "lg control", text: "orchestration" }), h("span", { class: "lg dependency", text: "dependency" }),
    h("span", { class: "muted small grow", text: "Click a component to select it; double-click opens its entry file. The diagram never runs anything." }),
    btn(ui.zoom === "fit" ? "100%" : "Fit", () => { ui.zoom = ui.zoom === "fit" ? "100" : "fit"; vscode.setState(ui); render(); }, { kind: "link", title: ui.zoom === "fit" ? "Show at full size (scroll)" : "Fit the diagram to the view" }));
  return h("div", { class: "diagram" }, h("div", { class: "scroller", "data-diagram": "1" }), legend);
}

/** Lay out and draw every diagram frame for the width (and, in the panel, the height) it has. */
function drawDiagrams(): void {
  const s = state;
  if (!s) return;
  for (const scroller of Array.from(document.querySelectorAll<HTMLElement>(".diagram .scroller[data-diagram]"))) {
    const availW = Math.max(200, scroller.clientWidth - 2);
    const availH = MODE === "map" ? Math.max(120, window.innerHeight - scroller.getBoundingClientRect().top - 44) : Infinity;
    const ids = s.diagram.nodeIds, edgesIn = s.diagram.edges;
    const L = layoutGraph(ids, edgesIn, ui.zoom === "100" ? {} : sizeForWidth(availW, layerCount(ids, edgesIn)));
    const scale = ui.zoom === "100" ? 1 : Math.max(0.6, Math.min(1, availW / L.width, availH / L.height));
    scroller.replaceChildren(h("div", { class: "sizer", style: `width:${Math.ceil(L.width * scale)}px;height:${Math.ceil(L.height * scale)}px` }, canvasFor(s, L, scale)));
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

function canvasFor(s: WorkbenchState, L: Layout, scale: number): HTMLElement {
  const compact = (L.nodes[0]?.w ?? 184) < 170;
  const canvas = h("div", { class: `canvas${compact ? " compact" : ""}`, style: `width:${L.width}px;height:${L.height}px;${scale < 1 ? `transform:scale(${scale});` : ""}` });
  const edges = svg("svg", { class: "edges", width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`, "aria-hidden": "true" });
  const defs = svg("defs", {});
  for (const flow of ["data", "control", "dependency", "deployment"]) {
    const m = svg("marker", { id: `arrow-${flow}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    m.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: `arrow ${flow}` }));
    defs.append(m);
  }
  edges.append(defs);
  for (const e of L.edges) {
    const p = svg("path", { d: e.path, class: `edge ${e.flow}${s.selection.component && (e.from === s.selection.component || e.to === s.selection.component) ? " hot" : ""}`, "marker-end": `url(#arrow-${e.flow})` });
    const t = svg("title", {}); t.textContent = `${comp(e.from)?.label ?? e.from} → ${comp(e.to)?.label ?? e.to} (${e.flow})`; p.append(t);
    edges.append(p);
  }
  canvas.append(edges);
  for (const n of L.nodes) {
    const c = comp(n.id);
    if (!c) continue;
    const on = s.selection.component === c.id;
    canvas.append(h("button", {
      class: `node h-${c.health} ${on ? "active" : ""}`, type: "button", style: `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`,
      "aria-pressed": String(on), title: `${c.label} — ${c.providerLabel ?? c.kind}\n${c.headline}\nNext: ${c.nextStep}`,
      onclick: () => select(s.selection.subproject ?? c.subprojects[0], c.id), ondblclick: () => command("datapass.openComponentEntry", c.id)
    },
      h("span", { class: "nodetop" }, h("span", { class: "glyph", text: c.providerGlyph, "aria-hidden": "true" }), h("span", { class: "provider", text: c.providerLabel ?? c.kind })),
      h("span", { class: "nodelabel", text: c.label }),
      h("span", { class: "nodestatus" }, h("span", { class: `dot h-${c.health}`, "aria-hidden": "true" }), h("span", { text: c.headline }))));
  }
  return canvas;
}

// ------------------------------------------------------------------ files

function filesBlock(c: WbComponent): HTMLElement {
  const a = c.artifacts;
  if (!a) return h("section", { class: "files" }, eyebrow("Files"), h("p", { class: "muted", text: c.providerSupport === "unsupported" ? `${c.providerLabel}: DataPass has no operations for this service yet.` : "No files declared for this component (graph.json → artifacts)." }));
  const repo = repoOf(a.repoKey);
  const rows = a.files.map(f => {
    const generated = f.source === "generated";
    const [text, tone] = generated && f.state === "missing" ? ["to generate", "warn"] : f.optional && f.state === "missing" ? ["recommended", "muted"] : FILE_STATE[f.state] ?? [f.state, "muted"];
    const needed = f.optional ? "recommended" : f.requiredFor.length ? `needed to ${f.requiredFor.join(", ")}` : f.role;
    const open = f.state === "found";
    return h("button", {
      class: `filerow ${open ? "" : "absent"}`, type: "button", title: open ? `Open ${f.repoPath}` : `${f.repoPath}: ${text}`,
      onclick: () => open ? send({ type: "openFile", componentId: c.id, path: f.repoPath }) : command("datapass.explainMissingFile", c.id, f.repoPath)
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

function checklistBlock(title: string, list: WbState["checklist"], componentId?: string): HTMLElement | undefined {
  if (!list.length) return undefined;
  const mark: Record<string, string> = { todo: "☐", done: "☑", blocked: "⛔", problem: "⚠", skipped: "↷" };
  return h("section", { class: "checklist" }, eyebrow(title), ...list.map(c => h("button", {
    class: `check ${c.state}`, type: "button", title: "Change state (your own note, not proof)",
    onclick: () => command("datapass.setProjectChecklist", c.key, componentId ?? "")
  }, h("span", { class: "mark", text: mark[c.state] ?? "☐", "aria-hidden": "true" }), h("span", { class: "label", text: c.label }), c.state !== "todo" ? h("span", { class: "muted small", text: c.state }) : undefined)));
}
type WbState = { checklist: WbComponent["checklist"] };

function componentDetail(c: WbComponent, s: WorkbenchState, withFiles: boolean): HTMLElement {
  const byPhase = new Map<string, WbOperation[]>();
  for (const o of c.operations) (byPhase.get(o.phaseLabel) ?? byPhase.set(o.phaseLabel, []).get(o.phaseLabel)!).push(o);
  const repo = repoOf(c.repoKey);
  return h("div", { class: "detail" },
    eyebrow("Selected component"),
    h("h2", { text: c.label }),
    h("div", { class: "row tight" }, h("span", { class: "glyph big", text: c.providerGlyph, "aria-hidden": "true" }), h("span", { text: c.providerLabel ?? c.kind }), c.status ? pill(`declared: ${c.status}`, "muted", "What the project files say; DataPass checks the files itself") : undefined, pill(HEALTH_TEXT[c.health] ?? c.health, c.health === "ok" ? "ok" : c.health === "blocked" ? "bad" : c.health === "attention" ? "warn" : "muted")),
    c.providerAbout ? h("p", { class: "muted small", text: c.providerAbout }) : undefined,
    c.description ? h("p", { text: c.description }) : undefined,
    h("div", { class: "card" },
      kv("Repository", repo ? `${repo.label} · ${REPO_STATE[repo.state]?.[0] ?? repo.state}` : "—"),
      c.artifacts ? kv("Folder", c.artifacts.root === "." ? "(repository root)" : c.artifacts.root) : undefined,
      c.nativeTool ? kv("Official tool", c.nativeTool) : undefined,
      c.incoming.length ? kv("Comes from", c.incoming.map(r => r.label).join(", ")) : undefined,
      c.outgoing.length ? kv("Goes to", c.outgoing.map(r => r.label).join(", ")) : undefined),
    h("div", { class: `next h-${c.health}` }, h("b", { text: "Next: " }), h("span", { text: c.nextStep })),
    withFiles ? filesBlock(c) : undefined,
    c.operations.length ? h("section", { class: "ops" }, eyebrow("What you can do, step by step"), ...[...byPhase].map(([phase, ops]) => h("div", { class: "phase" }, h("div", { class: "phasehead", text: phase }), ...ops.map(o => operationRow(o, c))))) : undefined,
    checklistBlock("Checklist", c.checklist, c.id),
    h("section", { class: "actions-col" }, eyebrow("Actions"),
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
    checklistBlock("Checklist", sp.checklist),
    h("section", {}, eyebrow("Components"), ...sp.componentIds.map(id => comp(id)).filter((c): c is WbComponent => !!c).map(c =>
      h("button", { class: "comprow", type: "button", onclick: () => select(sp.id, c.id) }, h("span", { class: "glyph", text: c.providerGlyph, "aria-hidden": "true" }), h("span", { class: "label", text: c.label }), h("span", { class: "muted small", text: c.headline }), h("span", { class: `dot h-${c.health}` })))),
    h("section", { class: "actions-col" }, eyebrow("Actions"),
      btn("Prepare AI context for this sub-project", () => command("datapass.preparationPack", { subprojectId: sp.id }), { kind: "primary", icon: "✦" }),
      sp.repoKey && repoOf(sp.repoKey)?.state === "local" ? btn("Open its repository in a new window", () => command("datapass.openRepositoryWindow", sp.repoKey), { icon: "⧉" }) : undefined,
      ...sp.docs.map(d => btn(d.label, () => command("datapass.openDoc", d), { kind: "link", icon: "📄" }))));
}

function overview(s: WorkbenchState): HTMLElement {
  return h("div", { class: "overview" },
    h("div", { class: "next h-info" }, h("b", { text: "Next: " }), h("span", { text: s.nextStep })),
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

// ------------------------------------------------------------------ modes

function render(): void {
  renderInner();
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
    root.append(h("div", { class: "map" }, tabs, diagram(s), c ? h("div", { class: "strip" }, h("b", { text: c.label }), h("span", { class: "muted", text: ` · ${c.headline} · Next: ${c.nextStep}` })) : undefined));
    return;
  }
  const crumbs = [s.project?.title ?? "Project", sp && !sp.implicit ? sp.title : undefined, c?.label].filter(Boolean).join(" / ");
  const center = h("main", { class: "center" },
    h("div", { class: "breadcrumb", text: crumbs }),
    h("div", { class: "bar" }, h("div", {}, eyebrow(sp ? "Architecture of the sub-project" : "Architecture of the project"), h("h2", { text: sp?.title ?? "All components" })),
      sp?.objective ? h("span", { class: "muted small objective", text: sp.objective }) : undefined),
    diagram(s),
    c ? filesBlock(c) : sp ? undefined : overview(s));
  root.append(header(s), h("div", { class: "shell" }, nav(s), center, h("aside", { class: "side", "aria-label": "Selection details" }, detailColumn(s, false))));
}

// In the bottom panel the height matters too: redraw when the window (the panel) changes size.
window.addEventListener("resize", () => { if (MODE === "map") { if (redrawTimer) clearTimeout(redrawTimer); redrawTimer = window.setTimeout(drawDiagrams, 60); } });

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type?: string; state?: WorkbenchState };
  if (msg?.type === "state" && msg.state) { state = msg.state; render(); }
});
render();
send({ type: "ready" });
