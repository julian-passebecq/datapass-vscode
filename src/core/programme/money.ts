/**
 * Money figures of different kinds are never summed together. A unit CAPEX assumption is not
 * a programme budget; a funding target is not money received; cloud spend is not a bill of
 * materials. Unknown is not zero.
 */
export type MoneyKind =
  | "unit-capex-assumption" | "programme-budget" | "funding-target" | "funding-requested"
  | "funding-committed" | "funding-received" | "cloud-spend" | "other";

export interface MoneyFigure {
  id: string;
  kind: MoneyKind;
  amount: number | null;       // null = unknown
  currency: string;            // ISO 4217
  priceYear?: number;          // real vs nominal comparisons need the base year
  scope: string;               // what the figure covers
  basis: "source-reported" | "assumption" | "model-output" | "measured" | "target" | "quote";
  sourceRef: string;
  asOf: string;
}

export interface MoneyGroup {
  kind: MoneyKind;
  currency: string;
  priceYear?: number;
  knownTotal: number;
  unknownCount: number;
  figures: string[];
  note?: string;
}

export function groupMoney(figures: MoneyFigure[]): { groups: MoneyGroup[]; warnings: string[] } {
  const warnings: string[] = [];
  const map = new Map<string, MoneyGroup>();
  for (const f of figures) {
    if (!/^[A-Z]{3}$/.test(f.currency)) warnings.push(`${f.id}: currency must be an ISO 4217 code`);
    if (f.amount !== null && !Number.isFinite(f.amount)) { warnings.push(`${f.id}: amount is not finite`); continue; }
    if (f.kind === "unit-capex-assumption" && f.basis === "quote") warnings.push(`${f.id}: a unit CAPEX assumption labelled as a supplier quote needs a quote reference`);
    const key = `${f.kind}|${f.currency}|${f.priceYear ?? "?"}`;
    const g = map.get(key) ?? { kind: f.kind, currency: f.currency, priceYear: f.priceYear, knownTotal: 0, unknownCount: 0, figures: [] };
    if (f.amount === null) g.unknownCount++; else g.knownTotal += f.amount;
    g.figures.push(f.id);
    map.set(key, g);
  }
  const groups = [...map.values()].map(g => ({
    ...g,
    ...(g.unknownCount ? { note: `${g.unknownCount} figure(s) unknown: total is a lower bound, not a total.` } : {}),
    ...(g.priceYear === undefined ? { note: [g.unknownCount ? `${g.unknownCount} unknown.` : "", "No price year: do not compare with other years."].filter(Boolean).join(" ") } : {})
  }));
  const committed = groups.filter(g => g.kind === "funding-committed");
  const target = groups.filter(g => g.kind === "funding-target");
  if (target.length && !committed.length) warnings.push("A funding target exists with no committed funding recorded; do not present the target as secured.");
  return { groups, warnings };
}

/** Explicitly refuses to add figures across kinds or currencies. */
export function sumSameKind(figures: MoneyFigure[]): number {
  const kinds = new Set(figures.map(f => f.kind)), currencies = new Set(figures.map(f => f.currency));
  if (kinds.size > 1) throw new Error(`Refusing to add different money kinds: ${[...kinds].join(", ")}`);
  if (currencies.size > 1) throw new Error(`Refusing to add different currencies: ${[...currencies].join(", ")}`);
  if (figures.some(f => f.amount === null)) throw new Error("Refusing to total figures that include unknown amounts");
  return figures.reduce((t, f) => t + (f.amount as number), 0);
}
