/**
 * V5 PEDA3 (TL-12c): the interview-value score of a query, pure and documented.
 * All factors in [FLOOR, 1], product in (0, 1]:
 *   rarity      = 1 − Π(1 − rarity_t) over the query's techniques (probability that at least one is rare).
 *   complexity  = min(1, log2(1 + points) / 4), points = joins + ctes + subqueries + 2·windows + aggregates
 *                 + setOps + 2·rare techniques (rarity ≥ 0.5) + (statements − 1).
 *   centrality  = (1 + upstream + downstream) / (1 + max over the project), upstream = other queries writing a
 *                 table this one reads, downstream = other queries reading a table this one writes (case-insensitive).
 *   score       = rarity × complexity × centrality; ties broken by id (deterministic).
 * Pure (no `vscode`).
 */
import type { Origin } from "../../webview/views/model";
import { techniqueWeight, type QueryShape } from "./techniques";

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
  /** SqlTechniqueId values (techniques.ts tagger). */
  readonly techniques: readonly string[];
  readonly shape: QueryShape;
  readonly tablesRead: readonly string[];
  readonly tablesWritten: readonly string[];
  /** Where the facts come from (static facts, or an ai-proposed bridge explanation). */
  readonly origin: Origin;
}

export const FLOOR = 0.05;
const clamp = (x: number) => Math.min(1, Math.max(FLOOR, x));

export function rarityFactor(techniques: readonly string[]): number {
  return clamp(1 - techniques.reduce((p, id) => p * (1 - (techniqueWeight(id)?.rarity ?? 0)), 1));
}

export function complexityFactor(shape: QueryShape, techniques: readonly string[]): number {
  const rare = techniques.filter(id => (techniqueWeight(id)?.rarity ?? 0) >= 0.5).length;
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
