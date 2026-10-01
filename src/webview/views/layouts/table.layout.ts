/** V4-NAV `table` layout kind: the binding rows as one table; a row with a node id selects it (Enter / click). */
import { holesNode, label, valueNode, type LayoutEntry, type LayoutModel, type VNode } from "../model";

export const tableModel: LayoutModel = ({ view, data, labels }) => {
  const sets = data.filter(d => d.rows);
  const columns = [...new Set(sets.flatMap(d => d.columns ?? d.rows!.flatMap(r => Object.keys(r.cells))))];
  const head: VNode = { tag: "thead", children: [{ tag: "tr", children: columns.map(c => ({ tag: "th", text: label(labels, `column.${c}`), attrs: { scope: "col" } })) }] };
  const rows: VNode[] = sets.flatMap(d => d.rows!.map(r => ({
    tag: "tr",
    ...(r.nodeId ? { cls: "nv-row nv-selectable", attrs: { tabindex: "0", "data-node-id": r.nodeId }, on: { action: "select" as const, nodeId: r.nodeId } } : { cls: "nv-row" }),
    children: columns.map(c => ({ tag: "td", children: c in r.cells ? [valueNode(r.cells[c]!, d.origin, labels)] : [] }))
  })));
  const holes = holesNode(data, labels);
  const body: VNode = rows.length
    ? { tag: "table", cls: "nv-table", attrs: { "aria-label": view.title }, children: [head, { tag: "tbody", children: rows }] }
    : { tag: "p", cls: "nv-empty", text: label(labels, "view.noRows") };
  return { tag: "div", cls: "nv-layout nv-layout-table", children: holes ? [body, holes] : [body] };
};

export default { kind: "table", model: tableModel } satisfies LayoutEntry;
