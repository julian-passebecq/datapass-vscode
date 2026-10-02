/**
 * V4-NAV `metrics` layout kind in the nav renderer (NAVFIX1, review M3: NAVREN3 shipped HTML helpers only, so the
 * catalog's "Spark performance" view drew `layout-unregistered`). One KPI per binding metric, value + unit with its
 * § 34 origin badge; an off-shape metric is a typed `metrics-invalid` hole. Self-registered (out/gen/layouts.ts).
 */
import { holesNode, label, valueNode, type BindingData, type Hole, type LayoutEntry, type LayoutModel, type VNode } from "../model";

interface MetricLike { readonly id: string; readonly label: string; readonly value: number | string; readonly unit?: string; readonly origin: string }

function isMetric(x: unknown): x is MetricLike {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return typeof m.id === "string" && typeof m.label === "string" && typeof m.origin === "string"
    && (typeof m.value === "number" || typeof m.value === "string") && (m.unit === undefined || typeof m.unit === "string");
}

export const metricsModel: LayoutModel = ({ view, data, labels }) => {
  const holes: Hole[] = [];
  const kpis: VNode[] = [];
  for (const d of data) {
    if (d.metrics === undefined) continue;
    if (!Array.isArray(d.metrics) || !d.metrics.every(isMetric)) { holes.push({ kind: "metrics-invalid", reason: label(labels, "metrics.invalid"), field: d.source }); continue; }
    for (const m of d.metrics) kpis.push({ tag: "div", cls: "nv-card nv-metric", attrs: { "data-metric-id": m.id }, children: [
      { tag: "span", cls: "nv-metric-label", text: m.label },
      valueNode({ value: m.unit ? `${m.value} ${m.unit}` : m.value, origin: m.origin }, d.origin, labels)] });
  }
  const all = holesNode([...data, { source: "metrics", origin: "static", holes } satisfies BindingData], labels);
  const body: VNode = kpis.length ? { tag: "div", cls: "nv-metrics", attrs: { "aria-label": view.title }, children: kpis } : { tag: "p", cls: "nv-empty", text: label(labels, "view.noMetrics") };
  return { tag: "div", cls: "nv-layout nv-layout-metrics", children: all ? [body, all] : [body] };
};

export default { kind: "metrics", model: metricsModel } satisfies LayoutEntry;
