/** V4-NAV `surface` layout kind: reuse an existing DataPass view (Workbench diagram, Hop, Airflow DAG…) — a button asks the host to open it. */
import { holesNode, label, type LayoutEntry, type LayoutModel, type VNode } from "../model";

export const surfaceModel: LayoutModel = ({ view, data, labels }) => {
  const holes = holesNode(data, labels);
  if (!view.surface) {
    return { tag: "div", cls: "nv-layout nv-layout-surface", children: [
      { tag: "div", cls: "nv-hole", attrs: { role: "note", "data-hole-kind": "no-surface" }, children: [
        { tag: "span", cls: "nv-hole-kind", text: label(labels, "hole.no-surface") },
        { tag: "span", cls: "nv-hole-reason", text: label(labels, "surface.missing") }] },
      ...(holes ? [holes] : [])] };
  }
  const name = label(labels, `surface.${view.surface}`);
  const children: VNode[] = [
    ...(view.description ? [{ tag: "p", cls: "nv-muted", text: view.description }] : []),
    { tag: "button", cls: "nv-surface-open", text: `${label(labels, "surface.open")} ${name}`,
      attrs: { type: "button", "data-surface": view.surface }, on: { action: "open-surface", surface: view.surface } }];
  return { tag: "div", cls: "nv-layout nv-layout-surface", children: holes ? [...children, holes] : children };
};

export default { kind: "surface", model: surfaceModel } satisfies LayoutEntry;
