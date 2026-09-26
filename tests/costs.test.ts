/**
 * 0.26 (C1, D-24): cost basis in options.json — `shared` resources counted once in combined totals,
 * `use: "learning-only"` flagged (never hidden), and exactly the 0.22 results without them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { costFlags, formatCostLine, formatCostTotal, sumCostLines, sumPickedOptions, type CostFigure } from "../src/core/project/costs";
import { analyzeOptions, parseOptions } from "../src/core/project/options";
import { optionsMarkdown } from "../src/core/project/optionsReport";
import { inputA } from "./fixtures/v3/research";
import { optionsAJson } from "./fixtures/v3/researchOptions";

const ROOT = join(__dirname, "..");
const cap = (monthly: number, extra: Partial<CostFigure> = {}): CostFigure => ({ monthly, shared: "fabric-capacity-f8", ...extra });

test("C1: three options sharing one key count it once", () => {
  const t = sumPickedOptions([{ costs: [cap(300), { monthly: 5 }] }, { costs: [cap(300)] }, { costs: [cap(300), { monthly: 2 }] }], "USD");
  assert.deepEqual(t.monthly, { USD: 307 });
  assert.deepEqual([t.priced, t.total], [3, 3]);
  assert.deepEqual(t.shared, ["fabric-capacity-f8"]);
  assert.deepEqual(t.disagree, []);
  assert.equal(formatCostTotal(t), "≈ 307 USD/month · shared counted once: fabric-capacity-f8");
});

test("C1: the same key with different figures is unpriced and says the figures disagree (never max or min)", () => {
  const t = sumPickedOptions([{ costs: [cap(300), { monthly: 5 }] }, { costs: [cap(450)] }], "USD");
  assert.deepEqual(t.monthly, { USD: 5 });
  assert.deepEqual([t.priced, t.total], [0, 2]);
  assert.deepEqual(t.disagree, ["fabric-capacity-f8"]);
  const text = formatCostTotal(t);
  assert.match(text, /partial: 0 of 2 decisions priced/);
  assert.match(text, /shared resource `fabric-capacity-f8`: figures disagree/);
  assert.doesNotMatch(text, /300|450|305|455/);
  // Same figure in another currency disagrees too.
  const cur = sumPickedOptions([{ costs: [cap(300)] }, { costs: [cap(300, { currency: "EUR" })] }], "USD");
  assert.deepEqual(cur.disagree, ["fabric-capacity-f8"]);
});

test("C1: different currencies stay apart around a shared resource", () => {
  const t = sumPickedOptions([{ costs: [cap(300, { currency: "EUR" }), { monthly: 10 }] }, { costs: [cap(300, { currency: "EUR" }), { monthly: 4, currency: "GBP" }] }], "USD");
  assert.deepEqual(t.monthly, { EUR: 300, GBP: 4, USD: 10 });
  assert.equal(t.priced, 2);
});

test("C1: shared and unpriced lines — a line without figure does not contradict; all unpriced stays unpriced", () => {
  const priced = sumPickedOptions([{ costs: [cap(300)] }, { costs: [{ shared: "fabric-capacity-f8" }] }], "USD");
  assert.deepEqual(priced.monthly, { USD: 300 });
  assert.deepEqual([priced.priced, priced.total, priced.disagree.length], [2, 2, 0]);
  const unknown = sumPickedOptions([{ costs: [{ shared: "k" }] }, { costs: [{ shared: "k" }, { monthly: 1 }] }], "USD");
  assert.deepEqual(unknown.monthly, { USD: 1 });
  assert.deepEqual([unknown.priced, unknown.total, unknown.shared.length], [0, 2, 0]);
  // One option alone: an unpriced shared line is unpriced there.
  assert.equal(formatCostTotal(sumCostLines([{ shared: "k" }], "USD")), "not priced (0 of 1 line)");
});

test("C1: an option's own subtotal shows the shared line with its label", () => {
  const t = sumCostLines([cap(300), { monthly: 5 }], "USD");
  assert.deepEqual(t.monthly, { USD: 305 });
  assert.equal(formatCostTotal(t), "≈ 305 USD/month · shared (`fabric-capacity-f8`), counted once per scenario");
  assert.equal(formatCostLine(cap(300), "USD"), "≈ 300 USD/month · shared (`fabric-capacity-f8`), counted once per scenario");
});

test("C1: a learning-only line flags its option and the scenario, never hides it", () => {
  const free: CostFigure = { monthly: 0, use: "learning-only" };
  const option = sumCostLines([free], "USD");
  assert.equal(option.learningOnly, 1);
  assert.equal(formatCostTotal(option), "≈ 0 USD/month · learning only — not for client work");
  assert.equal(formatCostLine(free, "USD"), "≈ 0 USD/month · learning only — not for client work");
  const scenario = sumPickedOptions([{ costs: [{ monthly: 3 }] }, { costs: [free] }], "USD");
  assert.deepEqual([scenario.priced, scenario.total, scenario.learningOnly], [2, 2, 1]);
  assert.deepEqual(costFlags(scenario), ["learning only — not for client work"]);
  assert.equal(formatCostLine({ monthly: 1, use: "any" }, "USD"), "≈ 1 USD/month");
});

test("C1: files without the new fields give exactly the 0.22 results", () => {
  const lines = sumCostLines([{ monthly: 10, currency: "EUR" }, { monthly: 5 }, {}], "USD");
  assert.deepEqual({ ...lines }, { monthly: { EUR: 10, USD: 5 }, oneTime: {}, priced: 2, total: 3, unit: "line", shared: [], disagree: [], learningOnly: 0 });
  assert.equal(formatCostTotal(lines), "≈ 10 EUR/month + ≈ 5 USD/month · partial: 2 of 3 lines priced");
  const s = sumPickedOptions([{ costs: [{ monthly: 3 }] }, { costs: [] }, { costs: [{ monthly: 1, currency: "EUR" }, {}] }], "USD");
  assert.equal(formatCostTotal(s), "≈ 1 EUR/month + ≈ 3 USD/month · partial: 1 of 3 decisions priced");
  assert.equal(formatCostTotal(sumCostLines([{ monthly: 2, oneTime: 30 }, { oneTime: 20, currency: "CHF" }], "GBP")), "≈ 2 GBP/month · ≈ 20 CHF one-time + ≈ 30 GBP one-time");
  assert.deepEqual(costFlags(s), []);
});

test("C1: the editor schema and the runtime accept both fields and refuse a bad key or a bad use", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "datapass-options.schema.json"), "utf8")));
  const file = (cost: Record<string, unknown>) => ({ format: "datapass.options", version: "1", decisions: [{ id: "d", title: "D", current: "a", options: [{ id: "a", label: "A", costs: [{ label: "x", ...cost }] }] }] });
  const ok = file({ monthly: 1, shared: "fabric-capacity-f8", use: "learning-only" });
  assert.ok(validate(ok), JSON.stringify(validate.errors));
  assert.equal(parseOptions(JSON.stringify(ok)).decisions[0]!.options[0]!.costs![0]!.shared, "fabric-capacity-f8");
  assert.ok(validate(file({ use: "any" })));
  for (const bad of [{ shared: "Fabric Capacity" }, { shared: "" }, { use: "demo" }]) {
    assert.equal(validate(file(bad)), false, JSON.stringify(bad));
    assert.throws(() => parseOptions(JSON.stringify(file(bad))), Error, JSON.stringify(bad));
  }
});

test("C1: the doc-pipeline example shares one storage account across A/B/C and flags the Free Edition line", () => {
  const o = parseOptions(readFileSync(join(ROOT, "examples", "v3", "doc-pipeline", ".datapass", "options.json"), "utf8"));
  const opts = o.decisions[0]!.options;
  for (const id of ["direct", "blob-function", "adf"]) assert.ok(opts.find(x => x.id === id)!.costs!.some(c => c.shared === "doc-storage"), id);
  const d = opts.find(x => x.costs?.some(c => c.use === "learning-only"))!;
  assert.match(d.label, /Databricks Free Edition/);
  // Combined: A's and B's picks together would count the storage once.
  const both = sumPickedOptions([opts[0]!, opts[1]!], o.currency ?? "USD");
  assert.deepEqual(both.shared, ["doc-storage"]);
  assert.deepEqual(both.monthly, { EUR: 8, USD: 1 });
});

test("C1: the Options report (packs) shows the shared and learning-only labels in the option, scenario and line rows", () => {
  const raw = optionsAJson() as Record<string, any>;
  const d0 = raw.decisions[0];
  for (const x of d0.options) x.costs = [{ label: "Shared capacity", monthly: 300, shared: "fabric-capacity-f8" }];
  d0.options.find((x: any) => x.id !== d0.current).costs.push({ label: "Free Edition", monthly: 0, use: "learning-only" });
  const options = parseOptions(JSON.stringify(raw));
  const analysis = analyzeOptions({ base: inputA(), options });
  const md = optionsMarkdown({ options, analysis, purpose: "compare", generatedAt: "2026-09-26", dataPassVersion: "0.26.0" }).text;
  assert.match(md, /- Cost: Shared capacity \(≈ 300 USD\/month · shared \(`fabric-capacity-f8`\), counted once per scenario\)/);
  assert.match(md, /- Cost: Free Edition \(≈ 0 USD\/month · learning only — not for client work\)/);
  const scenarioRows = md.split("\n").filter(l => l.startsWith("| ") && /decisions? priced|USD\/month/.test(l) && !l.startsWith("| Declared"));
  assert.ok(scenarioRows.some(l => /learning only — not for client work/.test(l)), "a scenario picking the learning-only option is flagged");
  assert.match(md, /\| Declared cost of this choice \|.*learning only — not for client work/);
  assert.match(md, /`shared`/);
});
