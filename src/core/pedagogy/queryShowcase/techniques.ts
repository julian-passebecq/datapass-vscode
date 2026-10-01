/**
 * V5 PEDA3: SQL technique ids for query showcase cards. STUB of the PEDA1a arch-catalog SQL technique
 * cards (TL-12): `card.sql-technique.*` / `card.spark-sql.*` ids as in PEDA1a; `sql.*` ids are local until PEDA1a
 * has a card for them. Rarity in [0, 1] (1 = rarely seen in projects, worth showing in an interview).
 * When PEDA1a is vendored, `SQL_TECHNIQUES` is read from `@juliandatapass-group/arch-catalog` instead and this
 * table goes. Texts are catalog data (shown as-is, never parsed); detection only reads static facts, nothing runs.
 * Pure (no `vscode`).
 */

export interface SqlTechnique {
  readonly id: string;
  /** 0..1: how rare the technique is in a typical project (feeds the interview-value score). */
  readonly rarity: number;
  /** What a reader learns from seeing it used. */
  readonly teaches: string;
  readonly tip: string;
  /** Concept ids to read next. */
  readonly next: readonly string[];
}

const T = (id: string, rarity: number, teaches: string, tip: string, next: readonly string[] = []): SqlTechnique => ({ id, rarity, teaches, tip, next });

export const SQL_TECHNIQUES: readonly SqlTechnique[] = [
  T("sql.join", 0.05, "Combining tables on keys", "Name the join keys and check they are unique on one side.", ["card.sql-technique.anti-join"]),
  T("sql.aggregate", 0.08, "Grouping rows and computing totals", "Every non-aggregated column must be in GROUP BY.", ["card.spark-sql.window-functions"]),
  T("card.sql-technique.cte", 0.25, "Naming intermediate results with WITH", "One CTE per business step makes the query readable top-down.", ["sql.recursive-cte"]),
  T("sql.subquery", 0.2, "Nesting a query as a value or a table", "A correlated subquery often reads better as a join or a window.", ["card.sql-technique.cte"]),
  T("sql.set-operation", 0.3, "UNION / INTERSECT / EXCEPT of compatible results", "UNION ALL keeps duplicates and avoids a sort.", []),
  T("card.spark-sql.window-functions", 0.55, "Ranking and running totals without collapsing rows", "PARTITION BY decides the group, ORDER BY the sequence inside it.", ["sql.qualify"]),
  T("card.sql-technique.merge", 0.6, "Insert-or-update in one statement (MERGE)", "Make the ON condition match at most one target row.", ["sql.scd2"]),
  T("card.sql-technique.anti-join", 0.5, "Rows with no match (NOT EXISTS / LEFT ANTI)", "NOT EXISTS is NULL-safe; NOT IN is not.", []),
  T("sql.semi-join", 0.45, "Filter on existence without duplicating rows", "EXISTS stops at the first match.", []),
  T("sql.full-outer-join", 0.5, "Reconciling two sources (both sides kept)", "COALESCE the keys after a full join.", []),
  T("card.sql-technique.pivot", 0.65, "Turning row values into columns", "List the pivot values explicitly to keep the schema stable.", []),
  T("sql.qualify", 0.7, "Filtering on a window result (QUALIFY)", "QUALIFY replaces a subquery around ROW_NUMBER().", []),
  T("sql.rollup-cube", 0.7, "Subtotals in one pass (ROLLUP / CUBE / GROUPING SETS)", "GROUPING() tells a subtotal row from a NULL value.", []),
  T("sql.recursive-cte", 0.8, "Walking hierarchies with a recursive WITH", "Always bound the recursion depth.", []),
  T("sql.lateral-explode", 0.6, "Exploding arrays or nested data into rows", "Explode late: filter before multiplying rows.", []),
  T("card.sql-technique.row-number", 0.45, "Numbering rows per group (latest record, deduplication)", "ROW_NUMBER() = 1 per key is the classic dedup.", ["sql.qualify"]),
  T("card.sql-technique.lag-lead", 0.55, "Comparing a row with the previous or next one", "Give LAG a default to avoid NULL on the first row.", []),
  T("card.sql-technique.having", 0.15, "Filtering groups after aggregation", "WHERE filters rows, HAVING filters groups.", []),
  T("card.sql-technique.count-distinct", 0.15, "Counting unique values", "COUNT(DISTINCT) is expensive at scale: approx_count_distinct when exact is not needed.", []),
  T("card.sql-technique.date-trunc", 0.2, "Bucketing timestamps by day, month or year", "Truncate in the time zone the business reports in.", []),
  T("sql.scd2", 0.75, "Keeping history (slowly changing dimension type 2)", "Close the old row and open the new one in the same transaction.", [])
];

const BY_ID = new Map(SQL_TECHNIQUES.map(t => [t.id, t]));
export const technique = (id: string): SqlTechnique | undefined => BY_ID.get(id);

/** Minimal static node (shape of `SqlNode` from `@juliandatapass-group/analyzers/sql`, args flattened). */
export interface StaticSqlNode {
  readonly type: string;
  readonly args?: ReadonlyMap<string, readonly StaticSqlNode[]>;
  readonly value?: string | number | boolean | null;
}

/** Counts used by the complexity factor. */
export interface QueryShape {
  readonly joins: number; readonly ctes: number; readonly subqueries: number; readonly windows: number;
  readonly aggregates: number; readonly setOps: number; readonly statements: number;
}
export const EMPTY_SHAPE: QueryShape = { joins: 0, ctes: 0, subqueries: 0, windows: 0, aggregates: 0, setOps: 0, statements: 0 };

const AGGREGATES = new Set(["Count", "Sum", "Avg", "Min", "Max", "AnyValue", "ApproxDistinct", "ArrayAgg", "GroupConcat"]);

/** Technique ids and shape from SQLGlot trees (analyzer facts). Reads node types and flags only. */
export function detectFromSqlTrees(trees: readonly StaticSqlNode[]): { techniques: string[]; shape: QueryShape } {
  const found = new Set<string>();
  const s: { -readonly [K in keyof QueryShape]: number } = { ...EMPTY_SHAPE, statements: trees.length };
  const flag = (n: StaticSqlNode, key: string) => (n.args?.get(key) ?? []).some(c => c.value === true || c.type === "Boolean" || c.value === "true");
  const scalar = (n: StaticSqlNode, key: string) => String(n.args?.get(key)?.[0]?.value ?? "").toUpperCase();
  const walk = (n: StaticSqlNode, depth: number): void => {
    if (depth > 200) return;
    switch (n.type) {
      case "Join": {
        s.joins++; found.add("sql.join");
        const kind = scalar(n, "kind"), side = scalar(n, "side");
        if (kind === "ANTI") found.add("card.sql-technique.anti-join");
        if (kind === "SEMI") found.add("sql.semi-join");
        if (side === "FULL") found.add("sql.full-outer-join");
        break;
      }
      case "With": found.add("card.sql-technique.cte"); if (flag(n, "recursive")) found.add("sql.recursive-cte"); break;
      case "CTE": s.ctes++; break;
      case "Subquery": s.subqueries++; found.add("sql.subquery"); break;
      case "Window": {
        s.windows++; found.add("card.spark-sql.window-functions");
        const fn = n.args?.get("this")?.[0]?.type;
        if (fn === "RowNumber") found.add("card.sql-technique.row-number");
        if (fn === "Lag" || fn === "Lead") found.add("card.sql-technique.lag-lead");
        break;
      }
      case "Having": found.add("card.sql-technique.having"); break;
      case "Count": found.add("sql.aggregate"); if ((n.args?.get("this") ?? []).some(c => c.type === "Distinct")) found.add("card.sql-technique.count-distinct"); break;
      case "DateTrunc": case "TimestampTrunc": found.add("card.sql-technique.date-trunc"); break;
      case "Group": s.aggregates++; found.add("sql.aggregate"); break;
      case "Union": case "Intersect": case "Except": s.setOps++; found.add("sql.set-operation"); break;
      case "Merge": found.add("card.sql-technique.merge"); break;
      case "Pivot": found.add("card.sql-technique.pivot"); break;
      case "Qualify": found.add("sql.qualify"); break;
      case "Rollup": case "Cube": case "GroupingSets": found.add("sql.rollup-cube"); break;
      case "Lateral": case "Explode": case "Posexplode": case "Unnest": found.add("sql.lateral-explode"); break;
      case "Exists": found.add("sql.semi-join"); break;
      case "Not": if ((n.args?.get("this") ?? []).some(c => c.type === "Exists")) found.add("card.sql-technique.anti-join"); break;
      default: if (AGGREGATES.has(n.type)) found.add("sql.aggregate");
    }
    for (const kids of n.args?.values() ?? []) for (const k of kids) walk(k, depth + 1);
  };
  for (const t of trees) walk(t, 0);
  return { techniques: [...found].sort(), shape: s };
}
