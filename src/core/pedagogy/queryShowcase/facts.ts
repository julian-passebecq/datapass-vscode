/**
 * V5 PEDA3: query facts for the showcase from what DataPass already holds, read statically.
 * - `factsFromSqlTrees`: analyzer facts (SQLGlot trees of one SQL file) + lineage tables → origin `static`.
 * - `factsFromUnderstanding`: a DataPass Hop bridge file (V3-HOP1, written by the client AI) → origin `ai-proposed`,
 *   its summary as ai-proposed business context.
 * Nothing is parsed as code or run here. Pure (no `vscode`).
 */
import type { UnderstandingDoc } from "../../understanding/contract";
import type { ContextText, QueryFact, ShowcaseLanguage } from "./showcase";
import { detectFromSqlTrees, EMPTY_SHAPE, type StaticSqlNode } from "./techniques";

export interface SqlFileFacts {
  readonly repositoryKey: string;
  readonly path: string;
  readonly span: { readonly startLine: number; readonly endLine: number };
  readonly dialect: "tsql" | "spark";
  readonly trees: readonly StaticSqlNode[];
  readonly tablesRead: readonly string[];
  readonly tablesWritten: readonly string[];
}

const baseName = (p: string) => p.split("/").pop() ?? p;

export function factsFromSqlTrees(f: SqlFileFacts): QueryFact {
  const { techniques, shape } = detectFromSqlTrees(f.trees);
  return { id: `${f.repositoryKey}/${f.path}`, repositoryKey: f.repositoryKey, path: f.path, span: f.span,
    language: f.dialect === "spark" ? "spark-sql" : "sql", title: baseName(f.path), techniques, shape,
    tablesRead: [...new Set(f.tablesRead)].sort(), tablesWritten: [...new Set(f.tablesWritten)].sort(), origin: "static" };
}

const JOIN_TECHNIQUE: Readonly<Record<string, string>> = { anti: "card.sql-technique.anti-join", semi: "sql.semi-join", full: "sql.full-outer-join" };

/** One bridge explanation → one query fact (SQL and PySpark files only), plus its summary as ai-proposed context. */
export function factsFromUnderstanding(repositoryKey: string, doc: UnderstandingDoc): { fact: QueryFact; context?: ContextText } | undefined {
  const lang = doc.target.language;
  if (lang !== "sql" && lang !== "pyspark") return undefined;
  if (!doc.steps.length) return undefined;
  const read = new Set<string>(), written = new Set<string>(), techniques = new Set<string>();
  let joins = 0, aggregates = 0;
  for (const s of doc.steps) {
    if (s.kind === "source" || s.kind === "read") (s.inputs?.length ? s.inputs : s.outputs ?? []).forEach(t => read.add(t));
    if (s.kind === "write") (s.outputs ?? []).forEach(t => written.add(t));
    if (s.kind === "join") { joins++; techniques.add("sql.join"); }
    if (s.kind === "aggregate") { aggregates++; techniques.add("sql.aggregate"); }
  }
  for (const j of doc.joins ?? []) { techniques.add("sql.join"); const t = JOIN_TECHNIQUE[j.type]; if (t) techniques.add(t); }
  joins = Math.max(joins, doc.joins?.length ?? 0);
  const language: ShowcaseLanguage = lang === "pyspark" ? "pyspark" : "sql";
  const fact: QueryFact = {
    id: `${repositoryKey}/${doc.target.path}`, repositoryKey, path: doc.target.path,
    span: { startLine: Math.min(...doc.steps.map(s => s.lines[0])), endLine: Math.max(...doc.steps.map(s => s.lines[1])) },
    language, title: doc.title, techniques: [...techniques].sort(), shape: { ...EMPTY_SHAPE, joins, aggregates, statements: 1 },
    tablesRead: [...read].sort(), tablesWritten: [...written].sort(), origin: "ai-proposed"
  };
  return { fact, ...(doc.summary ? { context: { text: doc.summary, origin: "ai-proposed" as const } } : {}) };
}
