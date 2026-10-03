/**
 * V5 PEDA3: the SQL technique tagger (go/TOUR-PEDA-contract.md § 5: no analyzer emits technique tags yet, PEDA3
 * owns this pure tagger). It strips comments and string literals, then matches tokens; it never parses or runs
 * the query. `SQL_TECHNIQUE_IDS` comes from the vendored arch-catalog (PEDA1a2); the rarity weights are PEDA3's own
 * scoring data. Pure (no `vscode`).
 */
import { SQL_TECHNIQUE_IDS, type SqlTechniqueId } from "@juliandatapass-group/arch-catalog";

export { SQL_TECHNIQUE_IDS, type SqlTechniqueId };

export interface TechniqueWeight {
  readonly id: SqlTechniqueId;
  /** 0..1: how rare the technique is in a typical project (feeds the interview-value score). */
  readonly rarity: number;
  /** Short tagger texts; the full lesson is the technique's concept card (arch-catalog `SQL_TECHNIQUES[].conceptId`). */
  readonly teaches: string;
  readonly tip: string;
}

const W = (id: SqlTechniqueId, rarity: number, teaches: string, tip: string): TechniqueWeight => ({ id, rarity, teaches, tip });
export const TECHNIQUE_WEIGHTS: readonly TechniqueWeight[] = [
  W("cte", 0.25, "Naming intermediate results with WITH", "One CTE per business step makes the query readable top-down."),
  W("row-number-rank", 0.45, "Numbering or ranking rows per group (latest record, dedup)", "ROW_NUMBER() = 1 per key is the classic dedup; RANK keeps ties."),
  W("lag-lead", 0.55, "Comparing a row with the previous or next one", "Give LAG a default to avoid NULL on the first row."),
  W("date-trunc", 0.2, "Bucketing timestamps by day, month or year", "Truncate in the time zone the business reports in."),
  W("having", 0.15, "Filtering groups after aggregation", "WHERE filters rows, HAVING filters groups."),
  W("count-distinct", 0.15, "Counting unique values", "COUNT(DISTINCT) is costly at scale: use an approximate count when exact is not needed."),
  W("self-join", 0.4, "Joining a table to itself (hierarchies, pairs)", "Alias both sides clearly and guard against the row matching itself."),
  W("anti-join", 0.5, "Rows with no match (NOT EXISTS / LEFT ANTI)", "NOT EXISTS is NULL-safe; NOT IN is not."),
  W("pivot", 0.65, "Turning row values into columns", "List the pivot values explicitly to keep the schema stable."),
  W("merge", 0.6, "Insert-or-update in one statement (MERGE)", "Make the ON condition match at most one target row.")
];
const BY_ID = new Map(TECHNIQUE_WEIGHTS.map(t => [t.id, t]));
export const techniqueWeight = (id: string): TechniqueWeight | undefined => BY_ID.get(id as SqlTechniqueId);

/** Comments (`--` and block comments; `#` too for Python) and string literals blanked; identifiers kept (T-SQL `#temp` too). */
export function stripSql(text: string, python = false): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(python ? /(--|#)[^\n]*/g : /--[^\n]*/g, " ")
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"""[\s\S]*?"""/g, "''");
}

/** Tables named after FROM / JOIN (lower case), used for the self-join check. */
function joinedTables(s: string): string[] {
  return [...s.matchAll(/\b(?:from|join)\s+([a-z_][\w.$]*)/gi)].map(m => m[1]!.toLowerCase());
}

/** The SQL techniques a query (or Spark SQL / PySpark transform) uses, by token match on its stripped text. */
export function tagSqlTechniques(text: string, python = false): SqlTechniqueId[] {
  const s = stripSql(text, python);
  const has = (re: RegExp) => re.test(s);
  const out = new Set<SqlTechniqueId>();
  if (has(/^\s*with\s+(recursive\s+)?[a-z_]\w*\s+as\s*\(/im) || has(/\)\s*,\s*[a-z_]\w*\s+as\s*\(/i)) out.add("cte");
  if (has(/\b(row_number|rank|dense_rank)\s*\(/i)) out.add("row-number-rank");
  if (has(/\b(lag|lead)\s*\(/i)) out.add("lag-lead");
  if (has(/\b(date_trunc|datetrunc|trunc)\s*\(/i) || has(/\bdate_trunc\b/i)) out.add("date-trunc");
  if (has(/\bhaving\b/i)) out.add("having");
  if (has(/\bcount\s*\(\s*distinct\b/i) || has(/\bcountDistinct\s*\(/)) out.add("count-distinct");
  if (has(/\bnot\s+exists\s*\(/i) || has(/\b(left\s+)?anti\s+join\b/i) || has(/["']left_anti["']|["']anti["']/i)) out.add("anti-join");
  if (has(/\bpivot\s*\(/i) || has(/\.pivot\s*\(/)) out.add("pivot");
  if (has(/\bmerge\s+into\b/i) || has(/\.merge\s*\(/)) out.add("merge");
  const t = joinedTables(s);
  if (t.length > 1 && new Set(t).size < t.length) out.add("self-join");
  return SQL_TECHNIQUE_IDS.filter(id => out.has(id));
}

/** Counts used by the complexity factor. */
export interface QueryShape {
  readonly joins: number; readonly ctes: number; readonly subqueries: number; readonly windows: number;
  readonly aggregates: number; readonly setOps: number; readonly statements: number;
}
export const EMPTY_SHAPE: QueryShape = { joins: 0, ctes: 0, subqueries: 0, windows: 0, aggregates: 0, setOps: 0, statements: 0 };

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** Token counts of the stripped text (approximate, deterministic). */
export function queryShape(text: string, python = false): QueryShape {
  const s = stripSql(text, python);
  const statements = s.split(";").filter(p => /\b(select|insert|merge|update|delete|create)\b/i.test(p)).length;
  return {
    joins: count(s, /\bjoin\b/gi) + count(s, /\.join\s*\(/g),
    ctes: count(s, /\b[a-z_]\w*\s+as\s*\(\s*select\b/gi),
    subqueries: count(s, /\(\s*select\b/gi) - count(s, /\b[a-z_]\w*\s+as\s*\(\s*select\b/gi),
    windows: count(s, /\bover\s*\(/gi) + count(s, /\.over\s*\(/g),
    aggregates: count(s, /\bgroup\s+by\b/gi) + count(s, /\.groupBy\s*\(/g),
    setOps: count(s, /\b(union|intersect|except)\b/gi),
    statements: Math.max(1, statements)
  };
}
