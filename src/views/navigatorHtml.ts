/**
 * V4-NAV NAVBAR1: the Navigator, a thin permanent navigation aid (secondary side bar by default,
 * or its own activity-bar container on the left, setting `datapass.navigator.location`).
 * Breadcrumb of the Location, home/up/down/left/right/back/forward, quick icons, the views of the
 * current Location, and two empty slots other packages fill (`#minimap` NAVMAP1, `#tours` NAVTOUR1).
 *
 * Pure (no `vscode`). Buttons, labels and icons are data (NAV_BUTTONS, NAVIGATOR_LABELS, the quick
 * icons from the rail's list), never written into the markup. Messages from the webview are untrusted:
 * `parseNavigatorMessage` keeps only the known shapes, bounded strings and known ids.
 */
import { NAV_LEVELS, type NavCommand, type NavLevel, type NavLocation, type NavState, type ViewDef } from "../core/navigation/navTypes";
import { RAIL_BUTTONS, RAIL_BUTTON_IDS } from "./railHtml";

export const NAVIGATOR_LOCATIONS = ["right", "left"] as const;
export type NavigatorLocation = (typeof NAVIGATOR_LOCATIONS)[number];
/** The two contributed view ids of the one provider: right = secondary side bar, left = own container. */
export const NAVIGATOR_VIEW_IDS: Readonly<Record<NavigatorLocation, string>> = { right: "datapass.navigator", left: "datapass.navigatorLeft" };

export const navigatorLocation = (raw: unknown): NavigatorLocation => (raw === "left" ? "left" : "right");
export const otherLocation = (l: NavigatorLocation): NavigatorLocation => (l === "left" ? "right" : "left");

/** A navigation button: the command it dispatches, its glyph and its words. */
export interface NavButton { readonly id: NavCommand["type"]; readonly glyph: string; readonly label: string; readonly title: string }

export const NAV_BUTTONS: readonly NavButton[] = [
  { id: "home", glyph: "⌂", label: "Home", title: "Back to the project (the top of the ladder)" },
  { id: "back", glyph: "←", label: "Back", title: "The previous location" },
  { id: "forward", glyph: "→", label: "Forward", title: "The next location" },
  { id: "up", glyph: "▲", label: "Up", title: "One level coarser (artifact → sub-project → project)" },
  { id: "down", glyph: "▼", label: "Down", title: "One level finer (the selected or first child)" },
  { id: "left", glyph: "◀", label: "Previous view", title: "The previous view of this location" },
  { id: "right", glyph: "▶", label: "Next view", title: "The next view of this location" }
];

/** Words of the view, overridable per key (data, never in the markup). */
export const NAVIGATOR_LABELS = {
  title: "Navigator",
  views: "Views",
  quick: "Quick",
  noViews: "No view for this location yet",
  noLocation: "No project open",
  levels: { project: "Project", subproject: "Sub-project", artifact: "Artifact", step: "Step", operation: "Operation" } as Record<NavLevel, string>
};
export type NavigatorLabels = typeof NAVIGATOR_LABELS;

/** Quick icons by default: the rail's buttons, without "Expand" (which only means something in rail mode). */
export const DEFAULT_QUICK_ICONS: readonly string[] = RAIL_BUTTON_IDS.filter(id => id !== "expand");

/** The quick icons a setting asks for: known rail ids, no duplicates; anything else falls back to the default. */
export function quickIcons(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_QUICK_ICONS];
  const out: string[] = [];
  for (const v of raw) if (typeof v === "string" && RAIL_BUTTON_IDS.includes(v) && !out.includes(v)) out.push(v);
  return out;
}

export interface NavigatorModel {
  readonly breadcrumb: readonly { readonly nodeId: string; readonly level: NavLevel; readonly text: string }[];
  readonly buttons: readonly (NavButton & { readonly enabled: boolean })[];
  readonly quick: readonly { readonly id: string; readonly glyph: string; readonly label: string; readonly title: string }[];
  readonly views: readonly { readonly id: string; readonly title: string; readonly description?: string; readonly current: boolean }[];
  readonly labels: NavigatorLabels;
}

export interface NavigatorInput {
  readonly state: NavState | null;
  readonly views: readonly ViewDef[];
  /** Coarse → fine, ending at the location; defaults to the location alone. */
  readonly trail?: readonly NavLocation[];
  readonly label?: (l: NavLocation) => string;
  readonly canUp?: boolean;
  readonly canDown?: boolean;
  readonly quick: readonly string[];
  readonly labels?: NavigatorLabels;
}

/** What the webview draws, from data only. */
export function navigatorModel(i: NavigatorInput): NavigatorModel {
  const labels = i.labels ?? NAVIGATOR_LABELS;
  const s = i.state;
  const trail = s ? (i.trail?.length ? i.trail : [s.location]) : [];
  const text = (l: NavLocation) => i.label?.(l) ?? `${labels.levels[l.level] ?? l.level} ${l.nodeId}`;
  const enabled = (id: NavButton["id"]): boolean => {
    if (!s) return false;
    switch (id) {
      case "back": return s.back.length > 0;
      case "forward": return s.forward.length > 0;
      case "up": return i.canUp ?? s.location.level !== "project";
      case "down": return i.canDown ?? true;
      case "left": case "right": return i.views.length > 1;
      default: return true;
    }
  };
  return {
    breadcrumb: trail.map(l => ({ nodeId: l.nodeId, level: l.level, text: text(l) })),
    buttons: NAV_BUTTONS.map(b => ({ ...b, enabled: enabled(b.id) })),
    quick: i.quick.flatMap(id => RAIL_BUTTONS.filter(b => b.id === id).map(b => ({ id: b.id, glyph: b.glyph, label: b.label, title: b.title }))),
    views: i.views.map(v => ({ id: v.id, title: v.title, description: v.description, current: s?.viewId === v.id })),
    labels
  };
}

export type NavigatorMessage =
  | { type: "ready" }
  | { type: "nav"; command: NavCommand }
  | { type: "select"; nodeId: string }
  | { type: "quick"; id: string };

const MAX_ID = 512;
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID;

function location(v: unknown): NavLocation | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!(NAV_LEVELS as readonly unknown[]).includes(o.level) || !str(o.nodeId) || !str(o.artifactKind)) return undefined;
  return { level: o.level as NavLevel, nodeId: o.nodeId, artifactKind: o.artifactKind };
}

function command(v: unknown): NavCommand | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "up": case "left": case "right": case "home": case "back": case "forward": return { type: o.type };
    case "down": return str(o.childId) ? { type: "down", childId: o.childId } : { type: "down" };
    case "view": return str(o.viewId) ? { type: "view", viewId: o.viewId } : undefined;
    case "go": { const l = location(o.location); return l ? { type: "go", location: l } : undefined; }
    default: return undefined;
  }
}

/** A webview message, or undefined when it is not one of the known shapes. */
export function parseNavigatorMessage(m: unknown): NavigatorMessage | undefined {
  if (!m || typeof m !== "object") return undefined;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case "ready": return { type: "ready" };
    case "nav": { const c = command(o.command); return c ? { type: "nav", command: c } : undefined; }
    case "select": return str(o.nodeId) ? { type: "select", nodeId: o.nodeId } : undefined;
    case "quick": return typeof o.id === "string" && RAIL_BUTTON_IDS.includes(o.id) ? { type: "quick", id: o.id } : undefined;
    default: return undefined;
  }
}

/**
 * The view's page: one inline script allowed by nonce, everything drawn from the posted model.
 * `extra` carries the CSS and scripts of the registered slots (`#minimap`, `#tours`, …), run under the same nonce.
 */
export function navigatorHtml(cspSource: string, nonce: string, extra: { readonly css?: string; readonly script?: string } = {}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { padding: 4px 6px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .crumbs { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 6px; }
  .crumbs button { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; padding: 0 2px; }
  .crumbs button:last-child { color: var(--vscode-foreground); font-weight: 600; }
  .sep { opacity: .6; }
  .row { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 6px; }
  .row button { min-width: 26px; height: 24px; border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; border-radius: 3px; }
  .row button:disabled { opacity: .4; cursor: default; }
  h3 { font-size: 11px; text-transform: uppercase; opacity: .7; margin: 8px 0 3px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li button { width: 100%; text-align: left; background: none; border: none; color: var(--vscode-foreground); padding: 2px 4px; cursor: pointer; }
  li button.current { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  li button:hover { background: var(--vscode-list-hoverBackground); }
  .empty { opacity: .7; font-style: italic; }
${extra.css ?? ""}
</style>
</head>
<body>
<nav class="crumbs" id="crumbs" aria-label="Location"></nav>
<div class="row" id="nav" role="toolbar"></div>
<div class="row" id="quick" role="toolbar"></div>
<h3 id="viewsTitle"></h3>
<ul id="views"></ul>
<div id="minimap"></div>
<div id="tours"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const el = (tag, text, attrs) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
  function draw(m) {
    const crumbs = $("crumbs"); crumbs.replaceChildren();
    if (!m.breadcrumb.length) crumbs.append(el("span", m.labels.noLocation, { class: "empty" }));
    m.breadcrumb.forEach((c, i) => {
      if (i) crumbs.append(el("span", "›", { class: "sep" }));
      const b = el("button", c.text, { title: m.labels.levels[c.level] || c.level });
      b.onclick = () => vscode.postMessage({ type: "select", nodeId: c.nodeId });
      crumbs.append(b);
    });
    const nav = $("nav"); nav.replaceChildren();
    for (const b of m.buttons) {
      const e = el("button", b.glyph, { title: b.title, "aria-label": b.label });
      e.disabled = !b.enabled;
      e.onclick = () => vscode.postMessage({ type: "nav", command: { type: b.id } });
      nav.append(e);
    }
    const quick = $("quick"); quick.replaceChildren();
    for (const q of m.quick) {
      const e = el("button", q.glyph, { title: q.title, "aria-label": q.label });
      e.onclick = () => vscode.postMessage({ type: "quick", id: q.id });
      quick.append(e);
    }
    $("viewsTitle").textContent = m.labels.views;
    const views = $("views"); views.replaceChildren();
    if (!m.views.length) views.append(el("li", m.labels.noViews, { class: "empty" }));
    for (const v of m.views) {
      const b = el("button", v.title, v.description ? { title: v.description } : {});
      if (v.current) { b.classList.add("current"); b.setAttribute("aria-current", "true"); }
      b.onclick = () => vscode.postMessage({ type: "nav", command: { type: "view", viewId: v.id } });
      const li = el("li"); li.append(b); views.append(li);
    }
  }
  window.addEventListener("message", e => { const m = e.data; if (m && m.type === "nav-state" && m.model) draw(m.model); });
${extra.script ?? ""}
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
