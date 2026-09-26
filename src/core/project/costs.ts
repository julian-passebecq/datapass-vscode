/**
 * Declared costs (options.json), added up without lying (0.22, FOIL review F01 + F08).
 *
 * One aggregation for every place that shows a cost (option subtotal, scenario table, compact
 * line, webview): amounts are kept per currency and never converted, monthly and one-time stay
 * separate, and every total says how many of its parts were priced. A line or an option with no
 * figure is unknown, never zero; a total with any unknown part is labelled "partial".
 *
 * Pure and dependency-free: the webview imports it too.
 */

export interface CostFigure { monthly?: number; oneTime?: number; currency?: string }

export interface CostTotal {
  /** Per currency, never converted. */
  monthly: Record<string, number>;
  oneTime: Record<string, number>;
  /** Parts (lines or decisions) with at least one figure, out of all parts counted. */
  priced: number;
  total: number;
  /** What a part is, for the "n of m priced" label. */
  unit: "line" | "decision";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function add(into: Record<string, number>, currency: string, n: number): void {
  into[currency] = round2((into[currency] ?? 0) + n);
}

export const isPriced = (l: CostFigure): boolean => l.monthly !== undefined || l.oneTime !== undefined;

/** The cost lines of one option: a line without monthly or one-time figure counts as unpriced. */
export function sumCostLines(lines: readonly CostFigure[] | undefined, defaultCurrency: string): CostTotal {
  const t: CostTotal = { monthly: {}, oneTime: {}, priced: 0, total: 0, unit: "line" };
  for (const l of lines ?? []) {
    t.total++;
    if (!isPriced(l)) continue;
    t.priced++;
    const cur = l.currency ?? defaultCurrency;
    if (l.monthly !== undefined) add(t.monthly, cur, l.monthly);
    if (l.oneTime !== undefined) add(t.oneTime, cur, l.oneTime);
  }
  return t;
}

/**
 * The picks of a scenario: one part per decision. A decision is priced when its option declares at
 * least one line and every line has a figure; otherwise it is unpriced (its known lines still count
 * in the amounts, and the total is partial).
 */
export function sumPickedOptions(options: ReadonlyArray<{ costs?: readonly CostFigure[] }>, defaultCurrency: string): CostTotal {
  const t: CostTotal = { monthly: {}, oneTime: {}, priced: 0, total: 0, unit: "decision" };
  for (const o of options) {
    t.total++;
    const s = sumCostLines(o.costs, defaultCurrency);
    if (s.total > 0 && s.priced === s.total) t.priced++;
    for (const [c, n] of Object.entries(s.monthly)) add(t.monthly, c, n);
    for (const [c, n] of Object.entries(s.oneTime)) add(t.oneTime, c, n);
  }
  return t;
}

export const isPartial = (t: CostTotal): boolean => t.priced < t.total;

/** "≈ 12.5 USD/month + ≈ 3 EUR/month": one term per currency, never added across currencies. */
export function formatAmounts(amounts: Record<string, number>, suffix = ""): string {
  return Object.entries(amounts).sort(([a], [b]) => a.localeCompare(b)).map(([cur, n]) => `≈ ${n >= 100 ? Math.round(n) : n} ${cur}${suffix}`).join(" + ");
}

/** The partial marker, or "" when every part is priced. */
export function partialLabel(t: CostTotal): string {
  return isPartial(t) ? `partial: ${t.priced} of ${t.total} ${t.unit}${t.total === 1 ? "" : "s"} priced` : "";
}

/**
 * One line for a total: amounts per currency, monthly then one-time, then the partial marker.
 * Nothing priced says so ("not priced"), never "0" and never a bare dash.
 */
export function formatCostTotal(t: CostTotal, words: { month?: string; once?: string } = {}): string {
  if (t.total === 0) return "no cost declared";
  if (t.priced === 0 && !Object.keys(t.monthly).length && !Object.keys(t.oneTime).length) return `not priced (0 of ${t.total} ${t.unit}${t.total === 1 ? "" : "s"})`;
  const parts = [formatAmounts(t.monthly, words.month ?? "/month"), formatAmounts(t.oneTime, words.once ?? " one-time")].filter(Boolean);
  const partial = partialLabel(t);
  return [...parts, partial].filter(Boolean).join(" · ");
}

/** One declared line: its own figures in its own currency, or "not priced". */
export function formatCostLine(l: CostFigure, defaultCurrency: string, words: { month?: string; once?: string } = {}): string {
  const cur = l.currency ?? defaultCurrency;
  const parts = [l.monthly !== undefined ? `≈ ${l.monthly} ${cur}${words.month ?? "/month"}` : "", l.oneTime !== undefined ? `≈ ${l.oneTime} ${cur}${words.once ?? " one-time"}` : ""].filter(Boolean);
  return parts.join(" · ") || "not priced";
}
