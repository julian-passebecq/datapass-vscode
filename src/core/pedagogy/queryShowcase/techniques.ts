/**
 * V5 PEDA3: SQL technique ids for query showcase cards. STUB of the PEDA1a arch-catalog SQL technique
 * concepts (TL-12): same ids, rarity in [0, 1] (1 = rarely seen in projects, worth showing in an interview).
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
  T("sql.join", 0.05, "Combining tables on keys", "Name the join keys and check they are unique on one side.", ["sql.anti-join"]),
  T("sql.aggregate", 0.08, "Grouping rows and computing totals", "Every non-aggregated column must be in GROUP BY.", ["sql.window-function"]),
  T("sql.cte", 0.25, "Naming intermediate results with WITH", "One CTE per business step makes the query readable top-down.", ["sql.recursive-cte"]),
  T("sql.subquery", 0.2, "Nesting a query as a value or a table", "A correlated subquery often reads better as a join or a window.", ["sql.cte"]),
  T("sql.set-operation", 0.3, "UNION / INTERSECT / EXCEPT of compatible results", "UNION ALL keeps duplicates and avoids a sort.", []),
  T("sql.window-function", 0.55, "Ranking and running totals without collapsing rows", "PARTITION BY decides the group, ORDER BY the sequence inside it.", ["sql.qualify"]),
  T("sql.merge-upsert", 0.6, "Insert-or-update in one statement (MERGE)", "Make the ON condition match at most one target row.", ["sql.scd2"]),
  T("sql.anti-join", 0.5, "Rows with no match (NOT EXISTS / LEFT ANTI)", "NOT EXISTS is NULL-safe; NOT IN is not.", []),
  T("sql.semi-join", 0.45, "Filter on existence without duplicating rows", "EXISTS stops at the first match.", []),
  T("sql.full-outer-join", 0.5, "Reconciling two sources (both sides kept)", "COALESCE the keys after a full join.", []),
  T("sql.pivot", 0.65, "Turning row values into columns", "List the pivot values explicitly to keep the schema stable.", []),
  T("sql.qualify", 0.7, "Filtering on a window result (QUALIFY)", "QUALIFY replaces a subquery around ROW_NUMBER().", []),
  T("sql.rollup-cube", 0.7, "Subtotals in one pass (ROLLUP / CUBE / GROUPING SETS)", "GROUPING() tells a subtotal row from a NULL value.", []),
  T("sql.recursive-cte", 0.8, "Walking hierarchies with a recursive WITH", "Always bound the recursion depth.", []),
  T("sql.lateral-explode", 0.6, "Exploding arrays or nested data into rows", "Explode late: filter before multiplying rows.", []),
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
        if (kind === "ANTI") found.add("sql.anti-join");
        if (kind === "SEMI") found.add("sql.semi-join");
        if (side === "FULL") found.add("sql.full-outer-join");
        break;
      }
      case "With": found.add("sql.cte"); if (flag(n, "recursive")) found.add("sql.recursive-cte"); break;
      case "CTE": s.ctes++; break;
      case "Subquery": s.subqueries++; found.add("sql.subquery"); break;
      case "Window": s.windows++; found.add("sql.window-function"); break;
      case "Group": s.aggregates++; found.add("sql.aggregate"); break;
      case "Union": case "Intersect": case "Except": s.setOps++; found.add("sql.set-operation"); break;
      case "Merge": found.add("sql.merge-upsert"); break;
      case "Pivot": found.add("sql.pivot"); break;
      case "Qualify": found.add("sql.qualify"); break;
      case "Rollup": case "Cube": case "GroupingSets": found.add("sql.rollup-cube"); break;
      case "Lateral": case "Explode": case "Posexplode": case "Unnest": found.add("sql.lateral-explode"); break;
      case "Exists": found.add("sql.semi-join"); break;
      case "Not": if ((n.args?.get("this") ?? []).some(c => c.type === "Exists")) found.add("sql.anti-join"); break;
      default: if (AGGREGATES.has(n.type)) found.add("sql.aggregate");
    }
    for (const kids of n.args?.values() ?? []) for (const k of kids) walk(k, depth + 1);
  };
  for (const t of trees) walk(t, 0);
  return { techniques: [...found].sort(), shape: s };
}
