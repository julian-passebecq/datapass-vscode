/**
 * V5 PEDA1b: STUB of the PEDA1a pedagogy cards (`@juliandatapass-group/arch-catalog` concepts/pedagogy, TL-12/12b).
 * Same types and ids as PEDA1a (`card.<family>.<name>`, `decision.<family>.<name>`), a handful of cards only so the
 * binding can be built and tested before PEDA1a is vendored; then `PEDAGOGY_CARDS` comes from the package and this
 * file goes. Card texts are catalog data. Pure (no `vscode`).
 */

export type PedagogyCardKind = "concept" | "decision" | "sql-technique";
export type ConstraintKind = "sla-freshness" | "volume" | "cost" | "security" | "skills" | "platform" | "consumer" | "data-profile";
export interface OwnerQuestion { readonly text: string; readonly why: string; readonly constraint: ConstraintKind }
export interface ConceptCard {
  readonly question: string;
  readonly codeExample: { readonly lang: string; readonly text: string };
  readonly output?: string;
  readonly comparison?: { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };
  readonly takeaways: readonly string[];
  readonly interviewQuestions: readonly string[];
}
export interface DecisionCard {
  readonly family: string;
  readonly question: string;
  readonly options: readonly [string, string];
  readonly rule: string;
  readonly ask: OwnerQuestion;
  readonly maxim: string;
}
export interface PedagogyCard {
  readonly id: string;
  readonly kind: PedagogyCardKind;
  readonly family: string;
  readonly order: number;
  readonly title: string;
  readonly conceptId: string | null;
  readonly card?: ConceptCard;
  readonly decisionCard?: DecisionCard;
}

const concept = (family: string, name: string, order: number, title: string, card: ConceptCard): PedagogyCard =>
  ({ id: `card.${family}.${name}`, kind: family === "sql-technique" ? "sql-technique" : "concept", family, order, title, conceptId: null, card });
const decision = (family: string, maxim: string, name: string, order: number, title: string, d: Omit<DecisionCard, "family" | "maxim">): PedagogyCard =>
  ({ id: `decision.${family}.${name}`, kind: "decision", family, order, title, conceptId: null, decisionCard: { family, maxim, ...d } });

export const PEDAGOGY_CARDS: readonly PedagogyCard[] = [
  concept("sql-technique", "cte", 1, "CTE (WITH)", { question: "How do you keep a long query readable?",
    codeExample: { lang: "sql", text: "WITH paid AS (SELECT * FROM orders WHERE status = 'paid')\nSELECT customer_id, SUM(amount) FROM paid GROUP BY customer_id" },
    takeaways: ["One CTE per business step", "Read the query top-down"], interviewQuestions: ["When would you use a temp table instead of a CTE?"] }),
  concept("sql-technique", "anti-join", 2, "Anti-join", { question: "How do you find rows with no match?",
    codeExample: { lang: "sql", text: "SELECT c.* FROM customers c\nWHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)" },
    takeaways: ["NOT EXISTS is NULL-safe", "NOT IN breaks on a NULL"], interviewQuestions: ["Why can NOT IN return no rows?"] }),
  concept("sql-technique", "merge", 3, "MERGE (upsert)", { question: "How do you insert or update in one statement?",
    codeExample: { lang: "sql", text: "MERGE INTO dim t USING stg s ON t.id = s.id\nWHEN MATCHED THEN UPDATE SET *\nWHEN NOT MATCHED THEN INSERT *" },
    takeaways: ["The ON condition must match at most one target row"], interviewQuestions: ["What happens when two source rows match one target row?"] }),
  concept("spark-sql", "window-functions", 1, "Window functions", { question: "How do you rank rows without collapsing them?",
    codeExample: { lang: "pyspark", text: "w = Window.partitionBy('customer_id').orderBy(F.desc('ts'))\ndf.withColumn('rn', F.row_number().over(w))" },
    takeaways: ["PARTITION BY = the group", "ORDER BY = the sequence"], interviewQuestions: ["Difference between RANK and ROW_NUMBER?"] }),
  decision("storage-decisions", "Design storage around the queries, not around the source.", "partition-or-not", 2, "Partition or not", {
    question: "Partition this table or not?", options: ["No partitioning", "Partition by the main filter column"],
    rule: "Partition when most queries filter on one low-cardinality column and each partition still holds large files.",
    ask: { text: "Which column do most queries filter on, and how much data arrives per value?", why: "Pruning helps only for the common filter and only with large partitions.", constraint: "volume" } }),
  decision("data-modeling", "Define the row before writing the transformation.", "latest-or-history", 2, "Latest or history", {
    question: "Keep only the latest value or the history?", options: ["Latest only (overwrite)", "History (SCD2 / snapshots)"],
    rule: "Keep history when someone must report as of a past date or audit a change; otherwise overwrite.",
    ask: { text: "Does anyone need to know what the value was on a past date?", why: "Point-in-time needs decide history.", constraint: "consumer" } }),
  decision("recovery-change", "Plan for failure before the first production run.", "retry-or-stop", 1, "Retry or stop", {
    question: "Retry automatically or stop the pipeline?", options: ["Retry with backoff", "Stop and alert"],
    rule: "Retry transient failures on idempotent steps; stop on data or code errors that a retry cannot fix.",
    ask: { text: "Are these steps safe to run twice, and which failures are transient?", why: "Only idempotent steps can be retried safely.", constraint: "platform" } }),
  decision("recovery-change", "Plan for failure before the first production run.", "full-or-incremental", 4, "Full refresh or incremental", {
    question: "Full refresh or incremental load?", options: ["Full refresh each run", "Incremental (append or merge)"],
    rule: "Refresh fully while the table is small enough to rebuild within the window; go incremental when rebuild time or cost no longer fits.",
    ask: { text: "How long does a full rebuild take, and what window do you have?", why: "Rebuild time against the window decides the load mode.", constraint: "sla-freshness" } })
];
