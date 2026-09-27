/**
 * V3-AIRFLOW: state and HTML of the "Airflow DAG" view (secondary side bar). Pure (no `vscode`):
 * one inline script allowed by nonce, theme variables only, text set with textContent, icons
 * bundled (src/webview/diagramIcons.ts). The webview sends task ids and line numbers only; the
 * extension host looks them up again in its own reading of the file.
 */
import { layoutDag, type DagEdge, type DagExtraction, type DagRoute, type DagTask, type TaskKind, type Unresolved } from "../core/airflow/dagExtract";
import { DIAGRAM_ICONS } from "../webview/diagramIcons";

export type AirflowDirection = "down" | "right";

export interface AirflowViewState {
  status: "none" | "not-dag" | "dag";
  /** The file as shown (workspace-relative when possible). */
  file?: string;
  reason?: string;
  dags: Array<{ dagId?: string; schedule?: string }>;
  dag: number;
  tasks: Array<DagTask & { layer: number; order: number }>;
  edges: DagEdge[];
  /** Each edge with the slots it passes through; `width`: slots per layer. */
  routes: DagRoute[];
  width: Record<number, number>;
  unresolved: Unresolved[];
  truncated: boolean;
  explanation: boolean;
  highlight?: string;
  direction: AirflowDirection;
}

export function airflowViewState(x: DagExtraction | undefined, file: string | undefined, dag: number, opts: { explanation: boolean; highlight?: string; direction: AirflowDirection }): AirflowViewState {
  const base = { dags: [], dag: 0, tasks: [], edges: [], routes: [], width: {}, unresolved: [], truncated: false, explanation: false, direction: opts.direction };
  if (!x || !file) return { ...base, status: "none" };
  if (!x.detected) return { ...base, status: "not-dag", file, reason: x.reason };
  const d = Math.min(Math.max(0, dag), x.dags.length - 1);
  const tasks = x.tasks.filter(t => t.dag === d);
  const ids = new Set(tasks.map(t => t.id));
  const edges = x.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  const layout = layoutDag(tasks, edges);
  const placed = new Map(layout.placed.map(p => [p.id, p]));
  return {
    status: "dag", file, dags: x.dags.map(i => ({ dagId: i.dagId, schedule: i.schedule })), dag: d,
    tasks: tasks.map(t => ({ ...t, layer: placed.get(t.id)!.layer, order: placed.get(t.id)!.order })),
    edges, routes: layout.routes, width: Object.fromEntries(layout.width), unresolved: x.unresolved, truncated: x.truncated, explanation: opts.explanation,
    ...(opts.highlight && ids.has(opts.highlight) ? { highlight: opts.highlight } : {}), direction: opts.direction
  };
}

/** The task whose code holds this 1-based line (the narrowest range wins; a TaskFlow call line counts too). */
export function taskAtLine(tasks: readonly DagTask[], line: number): DagTask | undefined {
  const hits = tasks.filter(t => t.callLine === line || (line >= t.startLine && line <= t.endLine));
  return hits.find(t => t.callLine === line) ?? hits.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
}

const KIND_ICON: Record<TaskKind, { icon?: string; glyph?: string; color: string; label: string }> = {
  python: { icon: "si:python", color: "#3b82c4", label: "Python" },
  bash: { glyph: "$_", color: "#6e7781", label: "Bash" },
  databricks: { icon: "si:databricks", color: "#ff3621", label: "Databricks" },
  spark: { icon: "co:layers", color: "#e8702a", label: "Spark" },
  sql: { icon: "co:database", color: "#2da44e", label: "SQL" },
  sensor: { icon: "co:symbol-event", color: "#a371f7", label: "Sensor" },
  container: { icon: "si:docker", color: "#2496ed", label: "Container" },
  notify: { glyph: "✉", color: "#d4a72c", label: "Notification" },
  empty: { glyph: "○", color: "#8c959f", label: "Empty" },
  trigger: { glyph: "↪", color: "#bf3989", label: "Trigger DAG" },
  other: { icon: "co:package", color: "#8c959f", label: "Other operator" }
};

export function airflowDagHtml(cspSource: string, nonce: string): string {
  const kinds = Object.fromEntries(Object.entries(KIND_ICON).map(([k, v]) => [k, { ...v, path: v.icon ? DIAGRAM_ICONS[v.icon] : undefined }]));
  const airflow = DIAGRAM_ICONS["si:apacheairflow"];
  const data = JSON.stringify({ kinds, airflow }).replace(/</g, "\\u003c");
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>Airflow DAG</title>
<style>
  :root { color-scheme: light dark; --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35))); }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 6px 10px 10px; margin: 0; }
  .muted { color: var(--vscode-descriptionForeground); } .small { font-size: 0.92em; }
  .head { display: flex; align-items: center; gap: 6px; }
  .head svg { flex: none; }
  .dagid { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  .badge { font-size: 0.85em; border: 1px solid var(--border); border-radius: 8px; padding: 0 6px; white-space: nowrap; color: var(--vscode-descriptionForeground); }
  .meta { margin: 2px 0 6px; display: flex; flex-wrap: wrap; gap: 2px 10px; }
  .tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; align-items: center; }
  button, select { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--border); border-radius: 3px; padding: 1px 8px; cursor: pointer; }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.link { background: none; border: none; color: var(--vscode-textLink-foreground); padding: 0; text-align: left; }
  button:focus-visible, g.task:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  #graph svg { display: block; margin: 0 auto; }
  #graph { overflow: auto; border: 1px solid var(--border); border-radius: 4px; background: var(--vscode-editor-background); }
  g.task { cursor: pointer; outline: none; }
  g.task rect.box { fill: var(--vscode-editorWidget-background, var(--vscode-editor-background)); stroke: var(--border); }
  g.task:hover rect.box { stroke: var(--vscode-focusBorder); }
  g.task.hl rect.box { stroke: var(--vscode-focusBorder); stroke-width: 2.2; fill: var(--vscode-editor-selectionHighlightBackground, var(--vscode-list-hoverBackground)); }
  text { fill: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  text.op { fill: var(--vscode-descriptionForeground); font-size: 10px; }
  text.glyph { font-size: 12px; font-weight: 600; }
  path.edge { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.2; opacity: .8; }
  marker path { fill: var(--vscode-descriptionForeground); }
  h3 { font-size: 0.85em; text-transform: uppercase; letter-spacing: .04em; margin: 10px 0 4px; color: var(--vscode-descriptionForeground); font-weight: 600; }
  .row { padding: 1px 0; }
  .empty { padding: 8px 0; }
</style>
</head>
<body>
<div id="root"><div class="empty muted">Open an Airflow DAG file (Python) to see its tasks here.</div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const DATA = ${data};
  const SVG = "http://www.w3.org/2000/svg";
  let state;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const sv = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const k in attrs || {}) e.setAttribute(k, String(attrs[k])); return e; };
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  function icon(kind, x, y, size) {
    const k = DATA.kinds[kind] || DATA.kinds.other;
    if (k.path) {
      const [, , w, h] = k.path.vb.split(" ").map(Number);
      const g = sv("g", { transform: "translate(" + x + "," + y + ") scale(" + (size / Math.max(w, h)) + ")" });
      g.appendChild(sv("path", { d: k.path.d, fill: k.color, ...(k.path.evenodd ? { "fill-rule": "evenodd" } : {}) }));
      return g;
    }
    const t = sv("text", { x: x + size / 2, y: y + size - 2, "text-anchor": "middle", class: "glyph", fill: k.color });
    t.style.fill = k.color;
    t.textContent = k.glyph || "?";
    return t;
  }
  function render() {
    const root = document.getElementById("root");
    root.replaceChildren();
    if (!state || state.status === "none") { root.appendChild(el("div", "empty muted", "Open an Airflow DAG file (Python) to see its tasks here.")); return; }
    if (state.status === "not-dag") {
      root.appendChild(el("div", "muted small", state.file));
      root.appendChild(el("div", "empty", "Not an Airflow DAG: " + (state.reason || "")));
      return;
    }
    const info = state.dags[state.dag] || {};
    const head = el("div", "head");
    const logo = sv("svg", { width: 16, height: 16, viewBox: DATA.airflow.vb, "aria-hidden": "true" });
    logo.appendChild(sv("path", { d: DATA.airflow.d, fill: "#017cee" }));
    head.appendChild(logo);
    const id = el("span", "dagid", info.dagId || "(DAG id computed at run time)");
    id.id = "dagId";
    head.appendChild(id);
    const badge = el("span", "badge", "read statically — not run");
    badge.title = "DataPass read this file's text. Nothing was executed; what it cannot read for sure is listed below.";
    head.appendChild(badge);
    root.appendChild(head);
    const meta = el("div", "meta small muted");
    meta.appendChild(el("span", "", "Schedule: " + (info.schedule || "not set")));
    meta.appendChild(el("span", "", state.tasks.length + " task" + (state.tasks.length === 1 ? "" : "s")));
    meta.appendChild(el("span", "", state.file));
    root.appendChild(meta);
    const tools = el("div", "tools");
    if (state.dags.length > 1) {
      const sel = el("select");
      sel.title = "This file defines several DAGs";
      state.dags.forEach((d, i) => { const o = el("option", "", d.dagId || "DAG " + (i + 1)); o.value = String(i); if (i === state.dag) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", () => vscode.postMessage({ type: "dag", index: Number(sel.value) }));
      tools.appendChild(sel);
    }
    const dir = el("button", "", state.direction === "down" ? "⇣ Top to bottom" : "⇢ Left to right");
    dir.title = "Switch the layout direction";
    dir.addEventListener("click", () => vscode.postMessage({ type: "direction", direction: state.direction === "down" ? "right" : "down" }));
    tools.appendChild(dir);
    if (state.explanation) {
      const ex = el("button", "link", "Open DataPass Hop explanation");
      ex.id = "explain";
      ex.addEventListener("click", () => vscode.postMessage({ type: "explain" }));
      tools.appendChild(ex);
    }
    root.appendChild(tools);
    root.appendChild(graph());
    if (state.unresolved.length) {
      root.appendChild(el("h3", "", "Not resolved statically (" + state.unresolved.length + ")"));
      for (const u of state.unresolved) {
        const r = el("div", "row small");
        const b = el("button", "link", "Lines " + u.startLine + (u.endLine > u.startLine ? "–" + u.endLine : "") + ": ");
        b.addEventListener("click", () => vscode.postMessage({ type: "revealLines", start: u.startLine, end: u.endLine }));
        r.appendChild(b);
        r.appendChild(el("span", "", " " + u.reason));
        root.appendChild(r);
      }
    }
    const hl = document.querySelector("g.task.hl");
    if (hl && hl.scrollIntoView) hl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function graph() {
    const box = el("div");
    box.id = "graph";
    if (!state.tasks.length) { box.appendChild(el("div", "empty muted", "No task could be read statically.")); box.style.padding = "4px 8px"; return box; }
    const down = state.direction === "down";
    const W = 168, H = 38, GX = down ? 14 : 44, GY = down ? 40 : 12, P = 10;
    const widest = Math.max(1, ...Object.values(state.width));
    const at = (layer, order) => {
      const across = order + (widest - (state.width[layer] || 1)) / 2;
      return { x: down ? P + across * (W + GX) : P + layer * (W + GX), y: down ? P + layer * (H + GY) : P + across * (H + GY) };
    };
    const pos = new Map();
    for (const t of state.tasks) pos.set(t.id, at(t.layer, t.order));
    const maxX = Math.max(...[...pos.values()].map(p => p.x)) + W + P, maxY = Math.max(...[...pos.values()].map(p => p.y)) + H + P;
    const svg = sv("svg", { width: maxX, height: maxY, viewBox: "0 0 " + maxX + " " + maxY, role: "img", "aria-label": "Tasks of the DAG" });
    const defs = sv("defs");
    const marker = sv("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    marker.appendChild(sv("path", { d: "M0,0 L10,5 L0,10 z" }));
    defs.appendChild(marker);
    svg.appendChild(defs);
    // Out of one box, through the slots of the layers it skips, into the next box.
    const curve = (x1, y1, x2, y2) => {
      const m = down ? (y2 - y1) / 2 : (x2 - x1) / 2;
      return down ? " C" + x1 + "," + (y1 + m) + " " + x2 + "," + (y2 - m) + " " + x2 + "," + y2
                  : " C" + (x1 + m) + "," + y1 + " " + (x2 - m) + "," + y2 + " " + x2 + "," + y2;
    };
    for (const r of state.routes) {
      const a = pos.get(r.from), b = pos.get(r.to);
      if (!a || !b) continue;
      const boxes = [a, ...r.via.map(v => at(v.layer, v.order)), b];
      let [x, y] = down ? [a.x + W / 2, a.y + H] : [a.x + W, a.y + H / 2];
      let d = "M" + x + "," + y;
      for (let i = 1; i < boxes.length; i++) {
        const q = boxes[i], last = i === boxes.length - 1;
        const [ix, iy] = down ? [q.x + W / 2, q.y] : [q.x, q.y + H / 2];
        d += curve(x, y, ix, iy);
        if (!last) { [x, y] = down ? [ix, q.y + H] : [q.x + W, iy]; d += " L" + x + "," + y; }
      }
      svg.appendChild(sv("path", { d, class: "edge", "marker-end": "url(#arrow)" }));
    }
    for (const t of state.tasks) {
      const p = pos.get(t.id), k = DATA.kinds[t.kind] || DATA.kinds.other;
      const g = sv("g", { class: "task" + (t.id === state.highlight ? " hl" : ""), tabindex: 0, role: "button", "data-id": t.id, transform: "translate(" + p.x + "," + p.y + ")" });
      const title = sv("title");
      title.textContent = t.id + "\n" + t.operator + " (" + k.label + ")" + (t.mapped ? ", mapped" : "") + "\nLines " + t.startLine + "–" + t.endLine + (t.callLine ? ", called at line " + t.callLine : "");
      g.appendChild(title);
      g.appendChild(sv("rect", { class: "box", width: W, height: H, rx: 5 }));
      const stripe = sv("rect", { width: 4, height: H, rx: 2 });
      stripe.style.fill = k.color;
      g.appendChild(stripe);
      g.appendChild(icon(t.kind, 10, 11, 16));
      const name = sv("text", { x: 32, y: 16 });
      name.textContent = clip(t.label, 20) + (t.mapped ? " [ ]" : "");
      g.appendChild(name);
      const op = sv("text", { x: 32, y: 30, class: "op" });
      op.textContent = clip((t.group ? t.group + " · " : "") + t.operator, 26);
      g.appendChild(op);
      const go = () => vscode.postMessage({ type: "reveal", id: t.id });
      g.addEventListener("click", go);
      g.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
      svg.appendChild(g);
    }
    box.appendChild(svg);
    return box;
  }
  window.addEventListener("message", ev => {
    const m = ev.data || {};
    if (m.type === "state") { state = m.state; render(); }
    else if (m.type === "highlight" && state) {
      state.highlight = m.id;
      for (const g of document.querySelectorAll("g.task")) g.classList.toggle("hl", g.getAttribute("data-id") === m.id);
      const hl = document.querySelector("g.task.hl");
      if (hl && hl.scrollIntoView) hl.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
