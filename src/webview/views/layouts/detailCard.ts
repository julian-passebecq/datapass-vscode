/** V4-NAV `detail-card` layout kind: one card per binding card, label/value pairs, each value with its origin. */
import { holesNode, label, valueNode, type LayoutModel, type VNode } from "../model";

export const detailCardModel: LayoutModel = ({ data, labels }) => {
  const cards: VNode[] = data.flatMap(d => (d.cards ?? []).map(c => ({
    tag: "section", cls: "nv-card",
    attrs: { "aria-label": c.title, ...(c.nodeId ? { tabindex: "0", "data-node-id": c.nodeId } : {}) },
    ...(c.nodeId ? { on: { action: "select" as const, nodeId: c.nodeId } } : {}),
    children: [
      { tag: "h3", text: c.title },
      { tag: "dl", children: c.fields.flatMap(f => [
        { tag: "dt", text: label(labels, `field.${f.label}`) },
        { tag: "dd", children: [valueNode(f.value, c.origin ?? d.origin, labels)] }]) }]
  })));
  const holes = holesNode(data, labels);
  const body: VNode[] = cards.length ? cards : [{ tag: "p", cls: "nv-empty", text: label(labels, "view.noCards") }];
  return { tag: "div", cls: "nv-layout nv-layout-detail-card", children: holes ? [...body, holes] : body };
};
