/**
 * V5 PEDA1b: the ONE standalone re-export of the pedagogy card contract (go/TOUR-PEDA-contract.md § 5, arch-catalog
 * concept-entry/1 additive: `card` / `decisionCard` on a ConceptEntry). STUB until REPIN5 vendors PEDA1a (concept
 * cards) and PEDA1a2 (decision cards, SQL techniques): then these types and `CARD_ENTRIES` come from
 * `@juliandatapass-group/arch-catalog` and this file only re-exports. Card texts are catalog data. Pure (no `vscode`).
 */
import type { ConceptEntry, ConceptOption, OwnerQuestion } from "@juliandatapass-group/arch-catalog";

export type { OwnerQuestion };
export const CONCEPT_CARD_FAMILIES = ["ingestion", "storage", "transformation", "orchestration", "quality", "spark-sql", "sql-technique"] as const; // STUB until REPIN5
export const DECISION_CARD_FAMILIES = ["storage", "data-modeling", "recovery-change", "quality-performance"] as const; // STUB until REPIN5
export const CODE_LANGS = ["sql", "pyspark", "python", "scala", "dax", "yaml", "text"] as const; // STUB until REPIN5
export type ConceptCardFamily = typeof CONCEPT_CARD_FAMILIES[number];
export type DecisionCardFamily = typeof DECISION_CARD_FAMILIES[number];
export type CodeLang = typeof CODE_LANGS[number];
export interface CodeExample { readonly lang: CodeLang; readonly text: string }
export interface ImplementedBy { readonly kind: "detector" | "analyzer" | "fact" | "view"; readonly id: string }
export interface ConceptCard {
  readonly family: ConceptCardFamily; readonly order: number; readonly question: string;
  readonly codeExample: CodeExample; readonly output?: string;
  readonly comparison?: { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };
  readonly takeaways: readonly string[]; readonly interviewQuestions: readonly string[]; readonly implementedBy: readonly ImplementedBy[];
}
export interface DecisionCard {
  readonly family: DecisionCardFamily; readonly order: number; readonly question: string;
  /** Ids of this entry's `options`. */
  readonly options: readonly [string, string];
  readonly rule: string; readonly ask: OwnerQuestion; readonly maxim?: string; readonly example?: CodeExample;
}

/** The part of a concept entry the cards use (a full ConceptEntry with `card` / `decisionCard` satisfies it). */
export type CardEntry = Pick<ConceptEntry, "id" | "domain" | "title"> & {
  readonly options: readonly Pick<ConceptOption, "id" | "title">[];
  readonly card?: ConceptCard;
  readonly decisionCard?: DecisionCard;
};

const opt = (id: string, title: string) => ({ id, title });

/** STUB entries (a few cards of PEDA1a / PEDA1a2 so binding is built and tested before the re-pin). */
export const CARD_ENTRIES: readonly CardEntry[] = [
  { id: "concept.sql.cte", domain: "sql", title: "CTE (WITH)", options: [], card: { family: "sql-technique", order: 1, question: "How do you keep a long query readable?",
    codeExample: { lang: "sql", text: "WITH paid AS (SELECT * FROM orders WHERE status = 'paid')\nSELECT customer_id, SUM(amount) FROM paid GROUP BY customer_id" },
    takeaways: ["One CTE per business step", "Read the query top-down"], interviewQuestions: ["When would you use a temp table instead of a CTE?", "Is a CTE materialised?"], implementedBy: [{ kind: "analyzer", id: "peda3-tagger" }] } },
  { id: "concept.sql.anti-join-nulls", domain: "sql", title: "Anti-join and NULLs", options: [], card: { family: "sql-technique", order: 8, question: "How do you find rows with no match?",
    codeExample: { lang: "sql", text: "SELECT c.* FROM customers c\nWHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)" },
    takeaways: ["NOT EXISTS is NULL-safe", "NOT IN breaks on a NULL"], interviewQuestions: ["Why can NOT IN return no rows?", "LEFT JOIN … IS NULL or NOT EXISTS?"], implementedBy: [{ kind: "analyzer", id: "peda3-tagger" }] } },
  { id: "concept.spark-perf.join-strategy", domain: "spark-perf", title: "Broadcast join", options: [], card: { family: "spark-sql", order: 5, question: "How do you avoid shuffling a big table to join a small one?",
    codeExample: { lang: "pyspark", text: "from pyspark.sql.functions import broadcast\nbig.join(broadcast(small), 'id')" },
    takeaways: ["Broadcast the small side only", "Check the plan for BroadcastHashJoin"], interviewQuestions: ["When does a broadcast join fail?", "What is autoBroadcastJoinThreshold?"], implementedBy: [{ kind: "fact", id: "spark-join" }] } },
  { id: "concept.layout.partition-key", domain: "layout", title: "Partition or not", options: [opt("none", "No partitioning"), opt("by-filter-column", "Partition by the main filter column")],
    decisionCard: { family: "storage", order: 2, question: "Partition this table or not?", options: ["none", "by-filter-column"],
      rule: "Partition when most queries filter on one low-cardinality column and each partition still holds large files.", maxim: "Design storage around the queries, not around the source.",
      ask: { text: "Which column do most queries filter on, and how much data arrives per value?", why: "Pruning helps only for the common filter and only with large partitions.", constraint: "volume" } } },
  { id: "concept.modelling.scd-choice", domain: "modelling", title: "Latest or history", options: [opt("overwrite", "Latest only (overwrite)"), opt("scd2", "History (SCD2 / snapshots)")],
    decisionCard: { family: "data-modeling", order: 2, question: "Keep only the latest value or the history?", options: ["overwrite", "scd2"],
      rule: "Keep history when someone must report as of a past date or audit a change; otherwise overwrite.", maxim: "Define the row before writing the transformation.",
      ask: { text: "Does anyone need to know what the value was on a past date?", why: "Point-in-time needs decide history.", constraint: "consumer" } } },
  { id: "concept.architecture.retry-policy", domain: "architecture", title: "Retry or stop", options: [opt("retry", "Retry with backoff"), opt("stop", "Stop and alert")],
    decisionCard: { family: "recovery-change", order: 1, question: "Retry automatically or stop the pipeline?", options: ["retry", "stop"],
      rule: "Retry transient failures on idempotent steps; stop on data or code errors that a retry cannot fix.", maxim: "Plan for failure before the first production run.",
      ask: { text: "Are these steps safe to run twice, and which failures are transient?", why: "Only idempotent steps can be retried safely.", constraint: "platform" } } },
  { id: "concept.ingestion.load-mode", domain: "ingestion", title: "Full refresh or incremental", options: [opt("full", "Full refresh each run"), opt("incremental", "Incremental (append or merge)")],
    decisionCard: { family: "recovery-change", order: 4, question: "Full refresh or incremental load?", options: ["full", "incremental"],
      rule: "Refresh fully while the table is small enough to rebuild within the window; go incremental when rebuild time or cost no longer fits.",
      ask: { text: "How long does a full rebuild take, and what window do you have?", why: "Rebuild time against the window decides the load mode.", constraint: "sla-freshness" } } }
];
