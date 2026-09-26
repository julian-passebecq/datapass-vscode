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

export interface CostFigure {
  monthly?: number; oneTime?: number; currency?: string;
  /** 0.26 (D-24): one shared resource; lines with the same key count once in any combined total. */
  shared?: string;
  /** 0.26 (D-24): "learning-only" flags an offer not usable for client work; never hides it. */
  use?: "any" | "learning-only";
}

export interface CostTotal {
  /** Per currency, never converted. */
  monthly: Record<string, number>;
  oneTime: Record<string, number>;
  /** Parts (lines or decisions) with at least one figure, out of all parts counted. */
  priced: number;
  total: number;
  /** What a part is, for the "n of m priced" label. */
  unit: "line" | "decision";
  /** Shared keys counted once in the amounts. */
  shared: string[];
  /** Shared keys whose declared figures differ: unpriced, never max or min. */
  disagree: string[];
  /** Parts with at least one learning-only line. */
  learningOnly: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function add(into: Record<string, number>, currency: string, n: number): void {
  into[currency] = round2((into[currency] ?? 0) + n);
}

export const isPriced = (l: CostFigure): boolean => l.monthly !== undefined || l.oneTime !== undefined;
export const isLearningOnly = (l: CostFigure): boolean => l.use === "learning-only";

export const LEARNING_ONLY_LABEL = "learning only — not for client work";
export const sharedLineLabel = (key: string): string => `shared (\`${key}\`), counted once per scenario`;
export const disagreeLabel = (key: string): string => `shared resource \`${key}\`: figures disagree`;

type SharedState = { state: "priced"; line: CostFigure; currency: string } | { state: "unpriced" } | { state: "disagree" };

/**
 * What each shared key is worth across all the lines combined: the figure its priced lines agree on
 * (same monthly, one-time and currency), "disagree" when they differ, "unpriced" when none has a
 * figure. A line without a figure does not contradict the others.
 */
function resolveShared(lines: readonly CostFigure[], defaultCurrency: string): Map<string, SharedState> {
  const by = new Map<string, CostFigure[]>();
  for (const l of lines) if (l.shared) by.set(l.shared, [...(by.get(l.shared) ?? []), l]);
  const out = new Map<string, SharedState>();
  for (const [key, ls] of by) {
    const priced = ls.filter(isPriced);
    const sig = (l: CostFigure) => `${l.monthly ?? ""}|${l.oneTime ?? ""}|${l.currency ?? defaultCurrency}`;
    if (!priced.length) out.set(key, { state: "unpriced" });
    else if (new Set(priced.map(sig)).size > 1) out.set(key, { state: "disagree" });
    else out.set(key, { state: "priced", line: priced[0]!, currency: priced[0]!.currency ?? defaultCurrency });
  }
  return out;
}

/** The common aggregation: each group is one part (decision) or each line is one part. */
function aggregate(groups: ReadonlyArray<readonly CostFigure[]>, defaultCurrency: string, unit: CostTotal["unit"]): CostTotal {
  const t: CostTotal = { monthly: {}, oneTime: {}, priced: 0, total: 0, unit, shared: [], disagree: [], learningOnly: 0 };
  const shared = resolveShared(groups.flat(), defaultCurrency);
  const counted = new Set<string>();
  const addLine = (l: CostFigure, cur: string) => {
    if (l.monthly !== undefined) add(t.monthly, cur, l.monthly);
    if (l.oneTime !== undefined) add(t.oneTime, cur, l.oneTime);
  };
  const linePriced = (l: CostFigure) => l.shared ? shared.get(l.shared)!.state === "priced" : isPriced(l);
  for (const lines of groups) {
    for (const l of lines) {
      if (!l.shared) { if (isPriced(l)) addLine(l, l.currency ?? defaultCurrency); continue; }
      if (counted.has(l.shared)) continue;
      counted.add(l.shared);
      const s = shared.get(l.shared)!;
      if (s.state === "priced") { addLine(s.line, s.currency); t.shared.push(l.shared); }
      else if (s.state === "disagree") t.disagree.push(l.shared);
    }
    if (unit === "line") {
      for (const l of lines) { t.total++; if (linePriced(l)) t.priced++; if (isLearningOnly(l)) t.learningOnly++; }
    } else {
      t.total++;
      if (lines.length > 0 && lines.every(linePriced)) t.priced++;
      if (lines.some(isLearningOnly)) t.learningOnly++;
    }
  }
  return t;
}

/** The cost lines of one option: a line without monthly or one-time figure counts as unpriced. */
export function sumCostLines(lines: readonly CostFigure[] | undefined, defaultCurrency: string): CostTotal {
  return aggregate([lines ?? []], defaultCurrency, "line");
}

/**
 * The picks of a scenario: one part per decision. A decision is priced when its option declares at
 * least one line and every line has a figure; otherwise it is unpriced (its known lines still count
 * in the amounts, and the total is partial). Lines sharing a key count once (0.26, D-24); a shared
 * resource whose figures disagree is unpriced.
 */
export function sumPickedOptions(options: ReadonlyArray<{ costs?: readonly CostFigure[] }>, defaultCurrency: string): CostTotal {
  return aggregate(options.map(o => o.costs ?? []), defaultCurrency, "decision");
}

/** The labels a total carries besides its amounts: disagreeing shared resources, learning-only offers. */
export function costFlags(t: CostTotal): string[] {
  return [...t.disagree.map(disagreeLabel), t.learningOnly ? LEARNING_ONLY_LABEL : ""].filter(Boolean);
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
  const sharedNote = t.shared.length ? (t.unit === "line" ? t.shared.map(sharedLineLabel) : [`shared counted once: ${t.shared.join(", ")}`]) : [];
  const flags = costFlags(t);
  if (t.priced === 0 && !Object.keys(t.monthly).length && !Object.keys(t.oneTime).length) return [`not priced (0 of ${t.total} ${t.unit}${t.total === 1 ? "" : "s"})`, ...flags].join(" · ");
  const parts = [formatAmounts(t.monthly, words.month ?? "/month"), formatAmounts(t.oneTime, words.once ?? " one-time")].filter(Boolean);
  const partial = partialLabel(t);
  return [...parts, partial, ...sharedNote, ...flags].filter(Boolean).join(" · ");
}

/** One declared line: its own figures in its own currency, or "not priced". */
export function formatCostLine(l: CostFigure, defaultCurrency: string, words: { month?: string; once?: string } = {}): string {
  const cur = l.currency ?? defaultCurrency;
  const parts = [l.monthly !== undefined ? `≈ ${l.monthly} ${cur}${words.month ?? "/month"}` : "", l.oneTime !== undefined ? `≈ ${l.oneTime} ${cur}${words.once ?? " one-time"}` : ""].filter(Boolean);
  return [parts.join(" · ") || "not priced", l.shared ? sharedLineLabel(l.shared) : "", isLearningOnly(l) ? LEARNING_ONLY_LABEL : ""].filter(Boolean).join(" · ");
}
