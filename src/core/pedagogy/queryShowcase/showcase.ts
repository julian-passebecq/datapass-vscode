/**
 * V5 PEDA3 (TL-12c): query showcase cards — the project's notable SQL / Spark SQL / PySpark transforms, one
 * detail card each, ranked by a documented interview-value score.
 *
 * A card cites the project: the query is a span with a jump (never copied text), tables come from lineage
 * facts, techniques from static analyzer facts (PEDA1a technique ids). Business context comes from a
 * decision-rationale record or an ai-proposed text; the sample output only from an X-Ray sample (PQSAMP1) or
 * ai-proposed. Anything missing is a typed hole, never invented. No query is ever run. Pure (no `vscode`).
 *
 * Interview value (all factors in [FLOOR, 1], product in (0, 1]):
 *   rarity      = 1 − Π(1 − rarity_t) over the query's techniques (probability that at least one is rare).
 *   complexity  = min(1, log2(1 + points) / 4), points = joins + ctes + subqueries + 2·windows + aggregates
 *                 + setOps + 2·rare techniques (rarity ≥ 0.5) + (statements − 1).
 *   centrality  = (1 + upstream + downstream) / (1 + max over the project), upstream = other queries writing a
 *                 table this one reads, downstream = other queries reading a table this one writes.
 *   score       = rarity × complexity × centrality; ties broken by id (deterministic).
 */
import type { BindingData, Card, Cell, Hole, Origin } from "../../../webview/views/model";
import { EMPTY_SHAPE, SQL_TECHNIQUES, technique, type QueryShape } from "./techniques";

export const SHOWCASE_LANGUAGES = ["sql", "spark-sql", "pyspark"] as const;
export type ShowcaseLanguage = typeof SHOWCASE_LANGUAGES[number];

export interface QuerySpan { readonly startLine: number; readonly endLine: number }

/** One notable query or transform of the project, from static facts. */
export interface QueryFact {
  readonly id: string;
  readonly repositoryKey: string;
  /** Repository-relative, `/`-separated. */
  readonly path: string;
  readonly span: QuerySpan;
  readonly language: ShowcaseLanguage;
  readonly title: string;
  readonly techniques: readonly string[];
  readonly shape: QueryShape;
  readonly tablesRead: readonly string[];
  readonly tablesWritten: readonly string[];
  /** Where the facts come from (static analyzer facts, or an ai-proposed bridge explanation). */
  readonly origin: Origin;
}

export interface ContextText { readonly text: string; readonly origin: "decision-rationale" | "ai-proposed" }
export interface SampleOutput { readonly columns: readonly string[]; readonly rowCount: number; readonly origin: "xray-sample" | "ai-proposed" }
export interface ShowcaseInputs {
  readonly facts: readonly QueryFact[];
  readonly context?: ReadonlyMap<string, ContextText>;
  readonly samples?: ReadonlyMap<string, SampleOutput>;
}

export const FLOOR = 0.05;
const clamp = (x: number) => Math.min(1, Math.max(FLOOR, x));

export function rarityFactor(techniques: readonly string[]): number {
  const miss = techniques.reduce((p, id) => p * (1 - (technique(id)?.rarity ?? 0)), 1);
  return clamp(1 - miss);
}

export function complexityFactor(shape: QueryShape, techniques: readonly string[]): number {
  const rare = techniques.filter(id => (technique(id)?.rarity ?? 0) >= 0.5).length;
  const points = shape.joins + shape.ctes + shape.subqueries + 2 * shape.windows + shape.aggregates + shape.setOps
    + 2 * rare + Math.max(0, shape.statements - 1);
  return clamp(Math.log2(1 + points) / 4);
}

/** Lineage degree of each query: other queries upstream (write what it reads) + downstream (read what it writes). */
export function lineageDegrees(facts: readonly QueryFact[]): Map<string, number> {
  const writers = new Map<string, Set<string>>(), readers = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, t: string, id: string) => { const k = t.toLowerCase(); (m.get(k) ?? m.set(k, new Set()).get(k)!).add(id); };
  for (const f of facts) { f.tablesWritten.forEach(t => add(writers, t, f.id)); f.tablesRead.forEach(t => add(readers, t, f.id)); }
  const degrees = new Map<string, number>();
  for (const f of facts) {
    const up = new Set<string>(), down = new Set<string>();
    for (const t of f.tablesRead) for (const w of writers.get(t.toLowerCase()) ?? []) if (w !== f.id) up.add(w);
    for (const t of f.tablesWritten) for (const r of readers.get(t.toLowerCase()) ?? []) if (r !== f.id) down.add(r);
    degrees.set(f.id, up.size + down.size);
  }
  return degrees;
}

export interface ScoredQuery { readonly fact: QueryFact; readonly score: number; readonly rarity: number; readonly complexity: number; readonly centrality: number }

export function scoreQueries(facts: readonly QueryFact[]): ScoredQuery[] {
  const degrees = lineageDegrees(facts);
  const max = Math.max(0, ...degrees.values());
  return facts.map(fact => {
    const rarity = rarityFactor(fact.techniques);
    const complexity = complexityFactor(fact.shape, fact.techniques);
    const centrality = clamp((1 + (degrees.get(fact.id) ?? 0)) / (1 + max));
    return { fact, rarity, complexity, centrality, score: rarity * complexity * centrality };
  }).sort((a, b) => b.score - a.score || (a.fact.id < b.fact.id ? -1 : a.fact.id > b.fact.id ? 1 : 0));
}

/** The "Queries worth showing" list: the top N by interview value. */
export const topQueries = (facts: readonly QueryFact[], n: number): ScoredQuery[] => scoreQueries(facts).slice(0, Math.max(0, n));

/** Rounded for display (3 decimals). */
export const scoreText = (x: number) => (Math.round(x * 1000) / 1000).toFixed(3);

export interface ShowcaseCard { readonly card: Card; readonly holes: readonly Hole[] }

/** One query showcase card: field labels are keys (`field.<label>` in the host labels), values carry their origin. */
export function showcaseCard(q: ScoredQuery, inputs: ShowcaseInputs): ShowcaseCard {
  const f = q.fact;
  const holes: Hole[] = [];
  const hole = (field: string, kind: string, reason: string): Cell => { holes.push({ field, kind, reason: `${f.id}: ${reason}` }); return { value: null, origin: "hole" }; };
  const ctx = inputs.context?.get(f.id);
  const sample = inputs.samples?.get(f.id);
  const techs = f.techniques.map(id => technique(id)).filter((t): t is NonNullable<typeof t> => !!t)
    .sort((a, b) => b.rarity - a.rarity || (a.id < b.id ? -1 : 1));
  const top = techs[0];
  const tables = [...f.tablesRead.map(t => `${t} (read)`), ...f.tablesWritten.map(t => `${t} (write)`)];
  const next = [...new Set(techs.flatMap(t => t.next))].filter(id => !f.techniques.includes(id));
  const fields: { label: string; value: Cell }[] = [
    { label: "showcase.context", value: ctx ? { value: ctx.text, origin: ctx.origin } : hole("showcase.context", "missing-rationale", "no decision-rationale record or ai-proposed context") },
    { label: "showcase.tables", value: tables.length ? { value: tables.join(", "), origin: f.origin } : hole("showcase.tables", "missing-lineage", "no lineage fact for this query") },
    { label: "showcase.query", value: { value: `${f.repositoryKey}/${f.path}:${f.span.startLine}-${f.span.endLine}`, origin: f.origin } },
    { label: "showcase.techniques", value: techs.length ? { value: techs.map(t => t.id).join(", "), origin: f.origin } : hole("showcase.techniques", "missing-technique", "no known technique detected") },
    { label: "showcase.tip", value: top ? { value: top.tip, origin: "datapass-guidance" } : hole("showcase.tip", "missing-technique", "no technique to give a tip on") },
    { label: "showcase.sample", value: sample ? { value: `${sample.columns.join(", ")} (${sample.rowCount} rows)`, origin: sample.origin } : hole("showcase.sample", "missing-sample", "no X-Ray sample or ai-proposed sample (never invented)") },
    { label: "showcase.teaches", value: top ? { value: techs.slice(0, 3).map(t => t.teaches).join("; "), origin: "datapass-guidance" } : hole("showcase.teaches", "missing-technique", "nothing to teach without a technique") },
    { label: "showcase.next", value: next.length ? { value: next.join(", "), origin: "datapass-guidance" } : { value: null, origin: "datapass-guidance" } },
    { label: "showcase.score", value: { value: scoreText(q.score), origin: "computed" } }
  ];
  return { card: { id: `showcase:${f.id}`, title: f.title, nodeId: f.id, origin: f.origin, fields }, holes };
}

/** General (non-project) technique cards, marked `datapass-guidance`, for a project with no query facts. */
export function guidanceCards(n: number): Card[] {
  return [...SQL_TECHNIQUES].sort((a, b) => b.rarity - a.rarity || (a.id < b.id ? -1 : 1)).slice(0, Math.max(0, n)).map(t => ({
    id: `guidance:${t.id}`, title: t.id, origin: "datapass-guidance",
    fields: [{ label: "showcase.teaches", value: t.teaches }, { label: "showcase.tip", value: t.tip }, { label: "showcase.next", value: t.next.join(", ") || null }]
  }));
}

/** Binding data for a `detail-card` view: the top N project cards, or general guidance cards when there are none. */
export function showcaseBinding(inputs: ShowcaseInputs, n: number): BindingData {
  if (!inputs.facts.length) return { source: "pedagogy.queryShowcase", origin: "datapass-guidance", cards: guidanceCards(n),
    holes: [{ kind: "missing-facts", reason: "no SQL / Spark SQL / PySpark query facts for this project yet: general examples shown" }] };
  const built = topQueries(inputs.facts, n).map(q => showcaseCard(q, inputs));
  return { source: "pedagogy.queryShowcase", origin: "static", cards: built.map(b => b.card), holes: built.flatMap(b => b.holes) };
}

export { EMPTY_SHAPE };
