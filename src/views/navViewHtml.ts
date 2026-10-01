/**
 * V4-NAV NAVHOST1: the pure half of the DataPass view host (navView.ts) — title, message parsing,
 * surface lookup and the panel's HTML shell. The view body comes from the view renderer (NAVREN1);
 * until it merges, `fallbackRender` draws bound data as plain cards and tables. Pure (no `vscode`).
 */
import { NAV_LEVELS, type NavCommand, type NavLocation, type ViewDef } from "../core/navigation/navTypes";
import type { BoundData } from "../core/navigation/bindings";

/** Renders one view's bound data to an HTML fragment (escaped, no script). */
export type NavRenderer = (view: ViewDef, data: readonly BoundData[]) => string;

export type NavViewMessage = { type: "nav"; command: NavCommand } | { type: "select"; nodeId: string } | { type: "ready" };

/** Title from the `datapass.navView.titleFormat` setting: {location}, {view}, {n}, {N}. */
export function navViewTitle(format: string, location: string, view: ViewDef | undefined, index: number, count: number): string {
  const values: Record<string, string> = { location, view: view?.title ?? "", n: String(count ? index + 1 : 0), N: String(count) };
  return format.replace(/\{(location|view|n|N)\}/g, (_m, k: string) => values[k] ?? "").replace(/\s+/g, " ").trim();
}

/** The command a `surface` view runs, from the `datapass.navView.surfaces` setting (DataPass commands only). */
export function surfaceCommand(view: ViewDef, surfaces: Readonly<Record<string, unknown>>): string | undefined {
  if (view.layout !== "surface" || !view.surface) return undefined;
  const cmd = surfaces[view.surface];
  return typeof cmd === "string" && /^datapass\.[\w.]+$/.test(cmd) ? cmd : undefined;
}

const SIMPLE = new Set(["up", "left", "right", "home", "back", "forward"]);
const MAX_ID = 512;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;

function parseLocation(raw: unknown): NavLocation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const l = raw as Record<string, unknown>;
  if (!(NAV_LEVELS as readonly unknown[]).includes(l.level) || !isId(l.nodeId) || !isId(l.artifactKind)) return undefined;
  return { level: l.level as NavLocation["level"], nodeId: l.nodeId, artifactKind: l.artifactKind };
}

function parseCommand(raw: unknown): NavCommand | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  if (typeof c.type !== "string") return undefined;
  if (SIMPLE.has(c.type)) return { type: c.type } as NavCommand;
  if (c.type === "down") return c.childId === undefined ? { type: "down" } : isId(c.childId) ? { type: "down", childId: c.childId } : undefined;
  if (c.type === "view") return isId(c.viewId) ? { type: "view", viewId: c.viewId } : undefined;
  if (c.type === "go") { const location = parseLocation(c.location); return location && { type: "go", location }; }
  return undefined;
}

/** Webview messages are untrusted: anything off the protocol is dropped. */
export function parseNavViewMessage(raw: unknown): NavViewMessage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  if (m.type === "ready") return { type: "ready" };
  if (m.type === "select") return isId(m.nodeId) ? { type: "select", nodeId: m.nodeId } : undefined;
  if (m.type === "nav") { const command = parseCommand(m.command); return command && { type: "nav", command }; }
  return undefined;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const SKIP_COLUMNS = new Set(["id", "label", "origin"]);

/** Plain rendering used until the view renderer (NAVREN1) is wired. */
export const fallbackRender: NavRenderer = (view, data) => {
  const parts: string[] = [];
  if (view.description) parts.push(`<p class="desc">${esc(view.description)}</p>`);
  for (const { source, result } of data) {
    for (const card of result.cards ?? []) {
      parts.push(`<section class="card"><h3>${esc(card.title)}</h3><dl>${card.fields.map(f =>
        `<dt>${esc(f.label)}</dt><dd title="origin: ${esc(f.origin)}">${esc(f.value)}</dd>`).join("")}</dl></section>`);
    }
    for (const m of result.metrics ?? []) {
      parts.push(`<div class="metric" title="origin: ${esc(m.origin)}"><b>${esc(m.value)}${m.unit ? ` ${esc(m.unit)}` : ""}</b> ${esc(m.label)}</div>`);
    }
    const rows = result.rows ?? [];
    if (rows.length) {
      const cols = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => !SKIP_COLUMNS.has(k))))];
      parts.push(`<table><thead><tr><th>Name</th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r =>
        `<tr data-node="${esc(r.id)}" title="origin: ${esc(r.origin)}"><td><a href="#" data-node="${esc(r.id)}">${esc(r.label)}</a></td>${cols.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    }
    for (const h of result.holes) parts.push(`<p class="hole" data-source="${esc(source)}">${esc(h.reason)}</p>`);
  }
  return parts.join("\n") || `<p class="hole">Nothing to show here.</p>`;
};

const SCRIPT = `
const vscode = acquireVsCodeApi();
const nav = command => vscode.postMessage({ type: "nav", command });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-nav]");
  if (b) { e.preventDefault(); nav({ type: b.dataset.nav }); return; }
  const a = e.target.closest("a[data-node]");
  if (a) { e.preventDefault(); nav({ type: "down", childId: a.dataset.node }); return; }
  const n = e.target.closest("[data-node]");
  if (n) vscode.postMessage({ type: "select", nodeId: n.dataset.node });
});
const KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "home" };
document.addEventListener("keydown", e => {
  if (e.altKey && KEYS[e.key]) { e.preventDefault(); nav({ type: KEYS[e.key] }); }
  else if (e.altKey && e.key === "Backspace") { e.preventDefault(); nav({ type: "back" }); }
});
vscode.postMessage({ type: "ready" });
`;

export interface NavViewPage {
  readonly cspSource: string;
  readonly nonce: string;
  readonly title: string;
  readonly body: string;
  readonly canUp: boolean;
  readonly canDown: boolean;
  readonly viewCount: number;
}

export function navViewHtml(p: NavViewPage): string {
  const btn = (cmd: string, label: string, tip: string, enabled = true) =>
    `<button data-nav="${cmd}" title="${esc(tip)}"${enabled ? "" : " disabled"}>${label}</button>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${p.cspSource} data:; style-src ${p.cspSource} 'unsafe-inline'; script-src 'nonce-${p.nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0 10px 10px; }
header { position: sticky; top: 0; display: flex; gap: 4px; align-items: center; padding: 6px 0; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); }
header h2 { flex: 1; font-size: 1em; margin: 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 2px 7px; cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; }
th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--vscode-panel-border); }
a { color: var(--vscode-textLink-foreground); text-decoration: none; }
.card dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; }
.card dt { opacity: .75; } .card dd { margin: 0; }
.hole, .desc { opacity: .75; font-style: italic; }
.metric { display: inline-block; margin: 4px 12px 4px 0; }
</style></head>
<body>
<header>
${btn("up", "↑", "Coarser (Alt+Up)", p.canUp)}${btn("down", "↓", "Finer (Alt+Down)", p.canDown)}
<h2>${esc(p.title)}</h2>
${btn("left", "←", "Previous view (Alt+Left)", p.viewCount > 1)}${btn("right", "→", "Next view (Alt+Right)", p.viewCount > 1)}
</header>
<main>${p.body}</main>
<script nonce="${p.nonce}">${SCRIPT}</script>
</body></html>`;
}
