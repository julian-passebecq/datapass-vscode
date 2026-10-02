/**
 * V5 PEDA3: query facts for the showcase from a DataPass Hop bridge explanation (V3-HOP1, written by the client AI:
 * spans, tables, summary → origin `ai-proposed`) and, when the code is on this machine, the PEDA3 tagger over the
 * span's text (techniques, shape). The text is read, never run. Pure (no `vscode`).
 */
import type { UnderstandingDoc } from "../understanding/contract";
import type { ContextText } from "./assemble";
import type { QueryFact, ShowcaseLanguage } from "./score";
import { EMPTY_SHAPE, queryShape, tagSqlTechniques } from "./techniques";

/** One bridge explanation (SQL and PySpark files only) → one query fact, plus its summary as ai-proposed context. */
export function factsFromUnderstanding(repositoryKey: string, doc: UnderstandingDoc, code?: string): { fact: QueryFact; context?: ContextText } | undefined {
  const lang = doc.target.language;
  if ((lang !== "sql" && lang !== "pyspark") || !doc.steps.length) return undefined;
  const read = new Set<string>(), written = new Set<string>();
  for (const s of doc.steps) {
    if (s.kind === "source" || s.kind === "read") (s.inputs?.length ? s.inputs : s.outputs ?? []).forEach(t => read.add(t));
    if (s.kind === "write") (s.outputs ?? []).forEach(t => written.add(t));
  }
  const span = { startLine: Math.min(...doc.steps.map(s => s.lines[0])), endLine: Math.max(...doc.steps.map(s => s.lines[1])) };
  const python = lang === "pyspark";
  const text = code?.split(/\r?\n/).slice(span.startLine - 1, span.endLine).join("\n");
  const joins = Math.max(doc.steps.filter(s => s.kind === "join").length, doc.joins?.length ?? 0);
  const aggregates = doc.steps.filter(s => s.kind === "aggregate").length;
  const shape = text ? queryShape(text, python) : { ...EMPTY_SHAPE, joins, aggregates, statements: 1 };
  const language: ShowcaseLanguage = python ? "pyspark" : "sql";
  const fact: QueryFact = {
    id: `${repositoryKey}/${doc.target.path}`, repositoryKey, path: doc.target.path, span, language, title: doc.title,
    techniques: text ? tagSqlTechniques(text, python) : (doc.joins ?? []).some(j => j.type === "anti") ? ["anti-join"] : [],
    shape, tablesRead: [...read].sort(), tablesWritten: [...written].sort(), origin: "ai-proposed"
  };
  return { fact, ...(doc.summary ? { context: { text: doc.summary, origin: "ai-proposed" as const } } : {}) };
}
