/**
 * V4-NAV NAVREN3 — "metrics" layout kind (go/NAV-contract.md). Pure (no `vscode`): turns a binding
 * provider's metrics into the HTML of KPI cards with a small bar each. Every value shows its unit and
 * its basis (theoretical / observed / ai-proposed …, § 34 origin); a metric with no value is drawn as a
 * hole with the provider's reason, never guessed. Labels and basis names are data (`MetricsLabels`).
 */

export interface MetricValue {
  readonly id: string;
  readonly title: string;
  /** Absent = hole: the provider could not establish it. */
  readonly value?: number | string;
  readonly unit?: string;
  /** § 34 origin of the value: "theoretical" | "observed" | "ai-proposed" | "static" | … */
  readonly basis?: string;
  /** Reason shown for a hole. */
  readonly hole?: string;
  /** Optional scale for the bar (numeric values only). */
  readonly max?: number;
}

export interface MetricsLabels {
  readonly empty: string;
  readonly hole: string;
  readonly unknownBasis: string;
  /** Display name per basis id; an unlisted basis is shown as its id. */
  readonly basis: Readonly<Record<string, string>>;
}

export const DEFAULT_METRICS_LABELS: MetricsLabels = {
  empty: "No metrics for this location.",
  hole: "not known",
  unknownBasis: "origin unknown",
  basis: { theoretical: "theoretical", observed: "observed", "ai-proposed": "AI-proposed", static: "static" }
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Basis id reduced to a safe CSS class suffix. */
function basisClass(basis: string | undefined): string {
  return basis ? basis.toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown" : "unknown";
}

/** Bar fill in [0, 100] or undefined when no numeric scale applies. */
export function barPercent(m: MetricValue): number | undefined {
  if (typeof m.value !== "number" || !Number.isFinite(m.value) || !m.max || !Number.isFinite(m.max) || m.max <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((m.value / m.max) * 100)));
}

export function formatValue(v: number | string): string {
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return String(v);
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function isHole(m: MetricValue): boolean {
  return m.value === undefined || m.value === null || (typeof m.value === "number" && !Number.isFinite(m.value));
}

export function renderMetricCard(m: MetricValue, labels: MetricsLabels = DEFAULT_METRICS_LABELS): string {
  const title = `<div class="nav-metric-title">${escapeHtml(m.title)}</div>`;
  if (isHole(m)) {
    const reason = m.hole ? `<div class="nav-metric-reason">${escapeHtml(m.hole)}</div>` : "";
    return `<div class="nav-metric hole" data-id="${escapeHtml(m.id)}">${title}<div class="nav-metric-value">${escapeHtml(labels.hole)}</div>${reason}</div>`;
  }
  const unit = m.unit ? ` <span class="nav-metric-unit">${escapeHtml(m.unit)}</span>` : "";
  const basisName = m.basis ? labels.basis[m.basis] ?? m.basis : labels.unknownBasis;
  const pct = barPercent(m);
  const bar = pct === undefined ? "" : `<div class="nav-metric-bar"><span style="width:${pct}%"></span></div>`;
  return `<div class="nav-metric basis-${basisClass(m.basis)}" data-id="${escapeHtml(m.id)}">${title}`
    + `<div class="nav-metric-value">${escapeHtml(formatValue(m.value as number | string))}${unit}</div>${bar}`
    + `<div class="nav-metric-basis">${escapeHtml(basisName)}</div></div>`;
}

/** The card grid; `order` (a ViewDef's `metrics`) picks and orders ids, missing ids become holes. */
export function renderMetrics(metrics: readonly MetricValue[], order?: readonly string[], labels: MetricsLabels = DEFAULT_METRICS_LABELS): string {
  const list = order && order.length
    ? order.map(id => metrics.find(m => m.id === id) ?? { id, title: id })
    : metrics;
  if (!list.length) return `<div class="nav-metrics empty">${escapeHtml(labels.empty)}</div>`;
  return `<div class="nav-metrics">${list.map(m => renderMetricCard(m, labels)).join("")}</div>`;
}

export const METRICS_CSS = `
.nav-metrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.nav-metric{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px;background:var(--vscode-editorWidget-background)}
.nav-metric-title{font-size:.85em;opacity:.8}
.nav-metric-value{font-size:1.4em;font-weight:600}
.nav-metric-unit{font-size:.7em;font-weight:400;opacity:.8}
.nav-metric-bar{height:4px;background:var(--vscode-editorWidget-border);margin:4px 0}
.nav-metric-bar span{display:block;height:100%;background:var(--vscode-charts-blue)}
.nav-metric-basis{font-size:.75em;opacity:.7}
.nav-metric.basis-observed .nav-metric-bar span{background:var(--vscode-charts-green)}
.nav-metric.basis-ai-proposed .nav-metric-bar span{background:var(--vscode-charts-purple)}
.nav-metric.hole{border-style:dashed;opacity:.75}
.nav-metric-reason{font-size:.75em;opacity:.7}
`;
