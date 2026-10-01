/**
 * V4-NAV view renderer, pure part: what a binding provider hands a view, and the small node tree every layout
 * kind builds from it. Layouts never touch the DOM; `renderer.ts` turns the tree into elements, so the
 * data → view step is tested without a browser.
 */
import type { LayoutKind, NavLocation, NavState, ViewDef } from "../../core/navigation/navStub";

/** § 34 origin of a value (static, theoretical, ai-proposed, observed…). Free text: the host's labels name it. */
export type Origin = string;
/** A value with its origin; a bare value inherits the binding's origin. */
export interface Valued { readonly value: string | number | boolean | null; readonly origin?: Origin }
export type Cell = string | number | boolean | null | Valued;
/** A typed hole: what is missing and why. Never filled with a guess. */
export interface Hole { readonly reason: string; readonly kind?: string; readonly field?: string }
export interface Row { readonly nodeId?: string; readonly cells: Readonly<Record<string, Cell>> }
export interface Card { readonly id: string; readonly title: string; readonly nodeId?: string; readonly origin?: Origin;
  readonly fields: readonly { readonly label: string; readonly value: Cell }[] }
/** What one binding provider returned (go/NAV-contract.md: `{ rows | graph | cards | metrics, holes, origin }`). */
export interface BindingData { readonly source: string; readonly origin: Origin; readonly holes: readonly Hole[];
  readonly columns?: readonly string[]; readonly rows?: readonly Row[]; readonly cards?: readonly Card[];
  readonly graph?: unknown; readonly metrics?: unknown;
  /** `code-steps` kind (NAVREN4): a `CodeStepsInput`, validated by the layout. */
  readonly steps?: unknown }

/** Labels are data from the host (settings, presets); `label()` falls back to the key. */
export type Labels = Readonly<Record<string, string>>;
export const label = (labels: Labels, key: string): string => labels[key] ?? key;

/** The node tree a layout draws. `on` names an action the renderer wires (select a node, open a surface). */
export interface VNode { readonly tag: string; readonly cls?: string; readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>; readonly children?: readonly VNode[];
  readonly on?: { readonly action: "select"; readonly nodeId: string } | { readonly action: "open-surface"; readonly surface: string } }

export interface LayoutInput { readonly view: ViewDef; readonly data: readonly BindingData[]; readonly labels: Labels; readonly location: NavLocation }
export type LayoutModel = (input: LayoutInput) => VNode;
/** A `*.layout.ts` file's default export: the renderer registers it by itself (NAVWIRE1, out/gen/layouts.ts). */
export interface LayoutEntry { readonly kind: LayoutKind; readonly model: LayoutModel }

export function cellValue(c: Cell): Valued { return c !== null && typeof c === "object" ? c : { value: c }; }

/** One value with its origin badge (every value shows where it comes from, § 34). */
export function valueNode(c: Cell, fallbackOrigin: Origin, labels: Labels): VNode {
  const v = cellValue(c);
  const origin = v.origin ?? fallbackOrigin;
  const text = v.value === null ? label(labels, "value.empty") : String(v.value);
  return { tag: "span", cls: "nv-value", children: [
    { tag: "span", text },
    { tag: "span", cls: `nv-origin nv-origin-${cssToken(origin)}`, text: label(labels, `origin.${origin}`), attrs: { title: label(labels, "origin.title") } }] };
}

export function holeNode(h: Hole, labels: Labels): VNode {
  const kind = h.kind ?? "unknown";
  return { tag: "div", cls: "nv-hole", attrs: { role: "note", "data-hole-kind": kind }, children: [
    { tag: "span", cls: "nv-hole-kind", text: label(labels, `hole.${kind}`) },
    ...(h.field ? [{ tag: "code", text: h.field }] : []),
    { tag: "span", cls: "nv-hole-reason", text: h.reason }] };
}

export function holesNode(data: readonly BindingData[], labels: Labels): VNode | null {
  const holes = data.flatMap(d => d.holes);
  return holes.length ? { tag: "div", cls: "nv-holes", children: holes.map(h => holeNode(h, labels)) } : null;
}

export function cssToken(s: string): string { return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-"); }

/** Host → webview messages, untrusted: anything off-shape is dropped (as workbench.ts does). */
export type HostMessage =
  | { type: "nav-state"; state: NavState; views: readonly ViewDef[]; labels: Labels }
  | { type: "view-data"; viewId: string; data: readonly BindingData[] };

export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObj(raw)) return null;
  if (raw.type === "nav-state") {
    const { state, views, labels } = raw;
    if (!isObj(state) || !isLocation(state.location) || !(state.viewId === null || typeof state.viewId === "string")) return null;
    if (!Array.isArray(views) || !views.every(isViewDef)) return null;
    return { type: "nav-state", state: state as unknown as NavState, views: views as ViewDef[], labels: stringRecord(labels) };
  }
  if (raw.type === "view-data") {
    if (typeof raw.viewId !== "string" || !Array.isArray(raw.data) || !raw.data.every(isBindingData)) return null;
    return { type: "view-data", viewId: raw.viewId, data: raw.data as BindingData[] };
  }
  return null;
}

function isObj(x: unknown): x is Record<string, unknown> { return typeof x === "object" && x !== null && !Array.isArray(x); }
function isLocation(x: unknown): boolean { return isObj(x) && typeof x.level === "string" && typeof x.nodeId === "string" && typeof x.artifactKind === "string"; }
function isViewDef(x: unknown): boolean {
  return isObj(x) && typeof x.id === "string" && typeof x.title === "string" && typeof x.layout === "string" && Array.isArray(x.bindings);
}
function isBindingData(x: unknown): boolean {
  return isObj(x) && typeof x.source === "string" && typeof x.origin === "string" && Array.isArray(x.holes)
    && x.holes.every(h => isObj(h) && typeof h.reason === "string")
    && (x.rows === undefined || (Array.isArray(x.rows) && x.rows.every(r => isObj(r) && isObj(r.cells))))
    && (x.cards === undefined || (Array.isArray(x.cards) && x.cards.every(c => isObj(c) && typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.fields))))
    && (x.columns === undefined || (Array.isArray(x.columns) && x.columns.every(c => typeof c === "string")));
}
function stringRecord(x: unknown): Labels {
  const out: Record<string, string> = {};
  if (isObj(x)) for (const [k, v] of Object.entries(x)) if (typeof v === "string") out[k] = v;
  return out;
}
