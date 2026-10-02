/**
 * V4-NAV NAVDATA1 view-data sender, pure half: turns what the binding providers returned (core/navigation/bindings)
 * into what the view renderer reads (`webview/views/model.ts` BindingData), and builds the two host → webview
 * messages for the current Location and view: `nav-state` (full ViewDefs, as `parseHostMessage` requires) then
 * `view-data`. Every value keeps its § 34 origin; every hole keeps its kind. Pure (no `vscode`).
 */
import type { NavState, ViewDef } from "../core/navigation/navTypes";
import type { BindingRow, BoundData } from "../core/navigation/bindings";
import { isGraphViewDto, toGraphView } from "../core/navigation/bindings/graphView";
import type { BindingData, Card, Cell, HostMessage, Labels, Row } from "../webview/views/model";

const ROW_META = new Set(["id", "origin"]);

function cell(v: unknown, origin: string, base: string): Cell {
  const value = v === null || v === undefined ? null
    : typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v);
  return origin === base ? value : { value, origin };
}

function rowOf(r: BindingRow, base: string): Row {
  const cells: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(r)) if (!ROW_META.has(k)) cells[k] = cell(v, r.origin, base);
  return { nodeId: r.id, cells };
}

/** Provider results → renderer data: columns in first-seen order (label first), cards with stable ids. */
export function toBindingData(bound: readonly BoundData[]): BindingData[] {
  return bound.map(({ source, result }) => {
    const base = String(result.origin);
    const rows = result.rows?.map(r => rowOf(r, base));
    const columns = rows ? [...new Set(rows.flatMap(r => Object.keys(r.cells)))] : undefined;
    const cards: Card[] | undefined = result.cards?.map((c, i) => ({
      id: `${source}#${i}`, title: c.title,
      fields: c.fields.map(f => ({ label: f.label, value: cell(f.value, String(f.origin), base) }))
    }));
    return {
      source, origin: base,
      holes: result.holes.map(h => ({ reason: h.reason, kind: h.kind ?? "binding-empty" })),
      ...(columns ? { columns } : {}), ...(rows ? { rows } : {}), ...(cards ? { cards } : {}),
      ...(result.graph ? { graph: isGraphViewDto(result.graph) ? result.graph : toGraphView(result.graph, source) } : {}), ...(result.metrics ? { metrics: result.metrics } : {}), ...(result.steps !== undefined ? { steps: result.steps } : {})
    };
  });
}

export interface NavViewFrame { readonly state: NavState; readonly views: readonly ViewDef[]; readonly labels: Labels; readonly bound: readonly BoundData[] }

/** The messages the host posts on every Location / view change: state first, then the current view's data. */
export function navViewMessages(f: NavViewFrame): HostMessage[] {
  const view = f.views.find(v => v.id === f.state.viewId) ?? f.views[0];
  const state: HostMessage = { type: "nav-state", state: f.state, views: f.views, labels: f.labels };
  return view ? [state, { type: "view-data", viewId: view.id, data: toBindingData(f.bound) }] : [state];
}

/** Host labels from the `datapass.navView.labels` setting (strings only; anything else is dropped). */
export function navViewLabels(raw: unknown): Labels {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}
