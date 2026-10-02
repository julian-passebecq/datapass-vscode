/**
 * V4-NAV NAVMAP1: the Navigator mini-map (slot `#minimap`). Pure (no `vscode`, no DOM): the host builds a model from
 * the NavLadder and the current Location, renders it to an SVG string and drops it in the Navigator webview; a click
 * posts `{type:"nav", command:{type:"go", location}}`, re-validated on the host by `navMapCommand`.
 *
 * Variants (setting `datapass.navigator.miniMap`):
 * - `architecture-tb` / `architecture-lr`: project → sub-projects → artifacts, compact, top-down or left-right; the
 *   Location's node is ringed in red ("you are here") and its ancestors get a thinner red ring.
 * - `ladder`: the five levels project → operation with the current path; the current level is ringed.
 * - `off`: nothing is drawn.
 * Level names, captions and colours are data (labels from `nav-state`, palette from settings), never hard-coded.
 */
import { NAV_LEVELS, type NavCommand, type NavLadder, type NavLevel, type NavLocation } from "../core/navigation/navTypes";
import { NAV_PALETTE_DEFAULT, navColor, type NavPalette } from "../core/navigation/navPalette";

export const NAV_MAP_VARIANTS = ["architecture-tb", "architecture-lr", "ladder", "off"] as const;
export type NavMapVariant = (typeof NAV_MAP_VARIANTS)[number];
export const NAV_MAP_DEFAULT_VARIANT: NavMapVariant = "architecture-tb";

export function readNavMapVariant(raw: unknown): NavMapVariant {
  return typeof raw === "string" && (NAV_MAP_VARIANTS as readonly string[]).includes(raw) ? raw as NavMapVariant : NAV_MAP_DEFAULT_VARIANT;
}

/** Captions of the mini-map; overridable as a whole or per key (e.g. localisation, a customer's vocabulary). */
export interface NavMapLabels {
  readonly title: string;
  readonly here: string;
  readonly more: string; // "{n}" = hidden count
  readonly none: string;
  readonly levels: Readonly<Record<NavLevel, string>>;
}
export const NAV_MAP_DEFAULT_LABELS: NavMapLabels = {
  title: "Mini-map", here: "You are here", more: "+{n} more", none: "—",
  levels: { project: "Project", subproject: "Sub-project", artifact: "Artifact", step: "Step", operation: "Operation" }
};

export interface NavMapOptions {
  /** Children shown per parent before a "+N" box (the current path is always kept). */
  readonly maxChildren?: number;
  readonly labels?: Partial<NavMapLabels>;
}

export type NavRing = "here" | "ancestor" | null;
export interface NavMapNode {
  readonly id: string; readonly label: string; readonly level: NavLevel;
  /** null = a "+N more" box (not clickable). */
  readonly location: NavLocation | null;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly ring: NavRing;
}
export interface NavMapModel {
  readonly variant: Exclude<NavMapVariant, "off">;
  readonly width: number; readonly height: number;
  readonly nodes: readonly NavMapNode[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly labels: NavMapLabels;
}

const BOX = { w: 92, h: 18, gx: 8, gy: 10, pad: 6 };
const LADDER = { w: 180, h: 18, gy: 4, pad: 6 };
const ARCH_DEPTH: Readonly<Record<NavLevel, number>> = { project: 0, subproject: 1, artifact: 2, step: 3, operation: 4 };

const key = (l: NavLocation) => `${l.level}\u0000${l.nodeId}`;
const sameLoc = (a: NavLocation, b: NavLocation) => a.level === b.level && a.nodeId === b.nodeId;

/** The chain root → … → location (inclusive), via `ladder.parent`; guarded against cycles. */
export function navPath(location: NavLocation, ladder: NavLadder): NavLocation[] {
  const out: NavLocation[] = [];
  const seen = new Set<string>();
  for (let l: NavLocation | null = location; l && !seen.has(key(l)); l = ladder.parent(l)) { seen.add(key(l)); out.unshift(l); }
  return out;
}

function mergeLabels(o: Partial<NavMapLabels> | undefined): NavMapLabels {
  return { ...NAV_MAP_DEFAULT_LABELS, ...o, levels: { ...NAV_MAP_DEFAULT_LABELS.levels, ...o?.levels } };
}

/** First `max` children, the one on the current path swapped in when it would be hidden. */
function pick(children: readonly NavLocation[], onPath: NavLocation | undefined, max: number): { shown: NavLocation[]; hidden: number } {
  const shown = children.slice(0, max);
  if (onPath && children.length > max && !shown.some(c => sameLoc(c, onPath))) {
    const found = children.find(c => sameLoc(c, onPath));
    if (found) shown[shown.length - 1] = found;
  }
  return { shown, hidden: Math.max(0, children.length - shown.length) };
}

/**
 * The mini-map model, or null for `off`. `names` = display names by node id (the `labels` of `nav-state`); a node
 * without a name shows its id's last path segment.
 */
export function buildNavMap(variant: NavMapVariant, location: NavLocation, ladder: NavLadder,
  names: Readonly<Record<string, string>> = {}, options: NavMapOptions = {}): NavMapModel | null {
  if (variant === "off") return null;
  const labels = mergeLabels(options.labels);
  const name = (l: NavLocation) => names[l.nodeId] ?? (l.nodeId.split(/[\\/]/).filter(Boolean).pop() || l.nodeId);
  const path = navPath(location, ladder);
  return variant === "ladder" ? ladderModel(path, name, labels) : archModel(variant, path, ladder, name, labels, Math.max(1, options.maxChildren ?? 8));
}

function archModel(variant: "architecture-tb" | "architecture-lr", path: NavLocation[], ladder: NavLadder,
  name: (l: NavLocation) => string, labels: NavMapLabels, max: number): NavMapModel {
  // Rings: the deepest path node drawn (≤ artifact) is "here", the ones above it are ancestors.
  const drawnPath = path.filter(l => ARCH_DEPTH[l.level] <= ARCH_DEPTH.artifact);
  const ringOf = (l: NavLocation): NavRing => {
    const i = drawnPath.findIndex(p => sameLoc(p, l));
    return i < 0 ? null : i === drawnPath.length - 1 ? "here" : "ancestor";
  };
  const onPathAt = (lvl: NavLevel) => drawnPath.find(p => p.level === lvl);
  const root = path[0] ?? ladder.root();

  // Grid: column = sub-project index, row = 0 root, 1 sub-project, 2.. artifacts stacked under it.
  type Cell = { id: string; label: string; level: NavLevel; location: NavLocation | null; col: number; row: number };
  const cells: Cell[] = [];
  const edges: { from: string; to: string }[] = [];
  const rootId = key(root);
  const subs = pick(ladder.children(root).filter(c => c.level === "subproject"), onPathAt("subproject"), max);
  subs.shown.forEach((s, col) => {
    const sid = key(s);
    cells.push({ id: sid, label: name(s), level: s.level, location: s, col, row: 1 });
    edges.push({ from: rootId, to: sid });
    const arts = pick(ladder.children(s), onPathAt("artifact"), max);
    arts.shown.forEach((a, i) => { cells.push({ id: key(a), label: name(a), level: a.level, location: a, col, row: 2 + i }); edges.push({ from: sid, to: key(a) }); });
    if (arts.hidden) cells.push({ id: `${sid}\u0000more`, label: labels.more.replace("{n}", String(arts.hidden)), level: "artifact", location: null, col, row: 2 + arts.shown.length });
  });
  if (subs.hidden) cells.push({ id: `${rootId}\u0000more`, label: labels.more.replace("{n}", String(subs.hidden)), level: "subproject", location: null, col: subs.shown.length, row: 1 });
  const cols = Math.max(1, ...cells.map(c => c.col + 1));
  cells.unshift({ id: rootId, label: name(root), level: root.level, location: root, col: (cols - 1) / 2, row: 0 });

  const lr = variant === "architecture-lr";
  const nodes: NavMapNode[] = cells.map(c => {
    // TB: columns left → right, rows downwards. LR: transposed (sub-projects stacked, artifacts to the right).
    const [a, b] = lr ? [c.row, c.col] : [c.col, c.row];
    return { id: c.id, label: c.label, level: c.level, location: c.location, x: BOX.pad + a * (BOX.w + BOX.gx), y: BOX.pad + b * (BOX.h + BOX.gy), w: BOX.w, h: BOX.h, ring: c.location ? ringOf(c.location) : null };
  });
  const width = Math.max(...nodes.map(n => n.x + n.w)) + BOX.pad;
  const height = Math.max(...nodes.map(n => n.y + n.h)) + BOX.pad;
  return { variant, width, height, nodes, edges, labels };
}

function ladderModel(path: NavLocation[], name: (l: NavLocation) => string, labels: NavMapLabels): NavMapModel {
  const current = path[path.length - 1];
  const nodes: NavMapNode[] = NAV_LEVELS.map((lvl, i) => {
    const at = path.find(p => p.level === lvl) ?? null;
    const ring: NavRing = at && current && sameLoc(at, current) ? "here" : at ? "ancestor" : null;
    return { id: `ladder\u0000${lvl}`, label: `${labels.levels[lvl]}: ${at ? name(at) : labels.none}`, level: lvl, location: at,
      x: LADDER.pad, y: LADDER.pad + i * (LADDER.h + LADDER.gy), w: LADDER.w, h: LADDER.h, ring };
  });
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id }));
  return { variant: "ladder", width: LADDER.w + 2 * LADDER.pad, height: LADDER.pad * 2 + NAV_LEVELS.length * (LADDER.h + LADDER.gy) - LADDER.gy, nodes, edges, labels };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
const fit = (s: string, w: number) => { const max = Math.max(3, Math.floor((w - 10) / 6)); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

/** The SVG of a model (theme tokens only; one colour per node id from the shared nav palette). */
export function renderNavMap(model: NavMapModel | null, palette: NavPalette = NAV_PALETTE_DEFAULT): string {
  if (!model) return "";
  const byId = new Map(model.nodes.map(n => [n.id, n]));
  const lr = model.variant === "architecture-lr";
  const edgeSvg = model.edges.map(e => {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) return "";
    const [x1, y1, x2, y2] = model.variant === "ladder" ? [a.x + 8, a.y + a.h, b.x + 8, b.y]
      : lr ? [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2] : [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y];
    return `<line class="nm-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join("");
  const nodeSvg = model.nodes.map(n => {
    const ring = n.ring === "here" ? ` stroke="${esc(palette.here)}" stroke-width="2.5"` : n.ring === "ancestor" ? ` stroke="${esc(palette.here)}" stroke-width="1.2"` : "";
    const nav = n.location ? ` data-nav-node="${esc(n.id)}" tabindex="0" role="button"` : ` class="nm-more"`;
    const title = n.ring === "here" ? `${model.labels.here}: ${n.label}` : n.label;
    const band = n.location ? `<rect class="nm-band" x="${n.x}" y="${n.y}" width="3" height="${n.h}" fill="${esc(navColor(n.location.nodeId, palette))}"/>` : "";
    return `<g class="nm-node nm-${n.level}${n.ring ? ` nm-${n.ring}` : ""}"${nav}><title>${esc(title)}</title>`
      + `<rect class="nm-box" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="3"${ring}/>${band}`
      + `<text x="${n.x + 7}" y="${n.y + n.h / 2 + 4}">${esc(fit(n.label, n.w))}</text></g>`;
  }).join("");
  return `<svg class="nav-map nav-map-${model.variant}" viewBox="0 0 ${model.width} ${model.height}" width="${model.width}" height="${model.height}" role="img" aria-label="${esc(model.labels.title)}">${edgeSvg}${nodeSvg}</svg>`;
}

/** CSS for the mini-map, theme tokens only. */
export const NAV_MAP_CSS = `.nav-map{max-width:100%;height:auto;font:10px var(--vscode-font-family)}`
  + `.nav-map .nm-box{fill:var(--vscode-editorWidget-background);stroke:var(--vscode-widget-border,var(--vscode-panel-border));stroke-width:1}`
  + `.nav-map .nm-more .nm-box{stroke-dasharray:2 2}.nav-map text{fill:var(--vscode-foreground)}.nav-map .nm-more text{fill:var(--vscode-descriptionForeground)}`
  + `.nav-map .nm-edge{stroke:var(--vscode-descriptionForeground);stroke-width:1;opacity:.6}`
  + `.nav-map [data-nav-node]{cursor:pointer}.nav-map [data-nav-node]:focus{outline:1px solid var(--vscode-focusBorder)}.nav-map .nm-here text{font-weight:600}`;

/**
 * The host side of a click: the webview only sends a node id; the Location comes from the host's own model,
 * so a forged id can never navigate somewhere the map does not show.
 */
export function navMapCommand(model: NavMapModel | null, nodeId: unknown): NavCommand | null {
  if (!model || typeof nodeId !== "string") return null;
  const n = model.nodes.find(x => x.id === nodeId);
  return n?.location ? { type: "go", location: n.location } : null;
}

/** Webview script: click / Enter on a node → `{type:"select", nodeId}` (the host answers with `navMapCommand`). */
export const NAV_MAP_SCRIPT = `(function(){const vs=window.__dpVsCode||(window.__dpVsCode=acquireVsCodeApi());`
  + `const send=e=>{const g=e.target.closest&&e.target.closest("[data-nav-node]");if(g){vs.postMessage({type:"select",nodeId:g.getAttribute("data-nav-node")});e.preventDefault();}};`
  + `document.addEventListener("click",send);document.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" ")send(e);});})();`;
