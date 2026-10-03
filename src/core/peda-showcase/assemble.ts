/**
 * V5 PEDA3 (TL-12c): query showcase cards — the project's notable SQL / Spark SQL / PySpark transforms, one
 * detail card each, ranked by the interview-value score (score.ts).
 *
 * A card cites the project: the query is a span with a jump (never copied text), tables come from lineage facts,
 * techniques from the PEDA3 tagger (techniques.ts). Business context comes from a decision-rationale record or an
 * ai-proposed text (exchange kind `peda-showcase-context`); the sample output only from an X-Ray sample (PQSAMP1) or
 * ai-proposed. Anything missing is a typed hole, never invented. No query is ever run. Pure (no `vscode`).
 */
import type { BindingData, Card, Cell, Hole } from "../../webview/views/model";
import { scoreText, topQueries, type ScoredQuery, type QueryFact } from "./score";
import { TECHNIQUE_WEIGHTS, techniqueWeight } from "./techniques";

export interface ContextText { readonly text: string; readonly origin: "decision-rationale" | "ai-proposed" }
export interface SampleOutput {
  readonly columns: readonly string[]; readonly rowCount: number; readonly origin: "xray-sample" | "ai-proposed";
  /** Project-relative file of a declared sample (samples.ts); `partial`: only its first bytes were read. */
  readonly file?: string; readonly partial?: boolean;
}

/** The declared hole every query (and guidance card) shows when no sample exists. Label data, not a placeholder. */
export const SAMPLE_HOLE = "no sample: add one under samples/";

/** The sample line of a card: `file: columns (N rows)`. */
export function sampleText(s: SampleOutput): string {
  return `${s.file ? `${s.file}: ` : ""}${s.columns.join(", ")} (${s.rowCount}${s.partial ? "+" : ""} rows)`;
}
export interface ShowcaseInputs {
  readonly facts: readonly QueryFact[];
  readonly context?: ReadonlyMap<string, ContextText>;
  readonly samples?: ReadonlyMap<string, SampleOutput>;
}

export interface ShowcaseCard { readonly card: Card; readonly holes: readonly Hole[] }

/** One query showcase card: field labels are keys (`field.<label>` in the host labels), values carry their origin. */
export function showcaseCard(q: ScoredQuery, inputs: ShowcaseInputs): ShowcaseCard {
  const f = q.fact;
  const holes: Hole[] = [];
  const hole = (field: string, kind: string, reason: string): Cell => { holes.push({ field, kind, reason: `${f.id}: ${reason}` }); return { value: null, origin: "hole" }; };
  const ctx = inputs.context?.get(f.id);
  const sample = inputs.samples?.get(f.id);
  const techs = f.techniques.map(id => techniqueWeight(id)).filter((t): t is NonNullable<typeof t> => !!t)
    .sort((a, b) => b.rarity - a.rarity || (a.id < b.id ? -1 : 1));
  const top = techs[0];
  const tables = [...f.tablesRead.map(t => `${t} (read)`), ...f.tablesWritten.map(t => `${t} (write)`)];
  const fields: { label: string; value: Cell }[] = [
    { label: "showcase.context", value: ctx ? { value: ctx.text, origin: ctx.origin } : hole("showcase.context", "missing-rationale", "no decision-rationale record or ai-proposed context") },
    { label: "showcase.tables", value: tables.length ? { value: tables.join(", "), origin: f.origin } : hole("showcase.tables", "missing-lineage", "no lineage fact for this query") },
    { label: "showcase.query", value: { value: `${f.repositoryKey}/${f.path}:${f.span.startLine}-${f.span.endLine}`, origin: f.origin } },
    { label: "showcase.techniques", value: techs.length ? { value: techs.map(t => t.id).join(", "), origin: "static" } : hole("showcase.techniques", "missing-technique", "no known technique tagged") },
    { label: "showcase.tip", value: top ? { value: top.tip, origin: "datapass-guidance" } : hole("showcase.tip", "missing-technique", "no technique to give a tip on") },
    { label: "showcase.sample", value: sample ? { value: sampleText(sample), origin: sample.origin } : hole("showcase.sample", "missing-sample", `${SAMPLE_HOLE} (no X-Ray sample or ai-proposed sample; never invented)`) },
    { label: "showcase.teaches", value: top ? { value: techs.slice(0, 3).map(t => t.teaches).join("; "), origin: "datapass-guidance" } : hole("showcase.teaches", "missing-technique", "nothing to teach without a technique") },
    { label: "showcase.next", value: { value: TECHNIQUE_WEIGHTS.filter(t => !f.techniques.includes(t.id) && t.rarity > (top?.rarity ?? 0)).slice(0, 2).map(t => t.id).join(", ") || null, origin: "datapass-guidance" } },
    { label: "showcase.score", value: { value: scoreText(q.score), origin: "computed" } }
  ];
  return { card: { id: `showcase:${f.id}`, title: f.title, nodeId: f.id, origin: f.origin, fields }, holes };
}

/**
 * General (non-project) technique cards, marked `datapass-guidance`, for a project with no query facts. Each still
 * shows its sample line, as the declared hole (V5HOLE13): a general example has no project sample.
 */
export function guidanceCards(n: number): Card[] {
  return [...TECHNIQUE_WEIGHTS].sort((a, b) => b.rarity - a.rarity || (a.id < b.id ? -1 : 1)).slice(0, Math.max(0, n)).map(t => ({
    id: `guidance:${t.id}`, title: t.id, origin: "datapass-guidance",
    fields: [{ label: "showcase.teaches", value: t.teaches }, { label: "showcase.tip", value: t.tip },
      { label: "showcase.sample", value: { value: null, origin: "hole" } }]
  }));
}

/** Binding data for a `detail-card` view: the top N project cards, or general guidance cards when there are none. */
export function showcaseBinding(inputs: ShowcaseInputs, n: number): BindingData {
  if (!inputs.facts.length) return { source: "pedagogy.queryShowcase", origin: "datapass-guidance", cards: guidanceCards(n),
    holes: [{ kind: "missing-facts", reason: "no SQL / Spark SQL / PySpark query facts for this project yet: general examples shown" },
      { kind: "missing-sample", field: "showcase.sample", reason: SAMPLE_HOLE }] };
  const built = topQueries(inputs.facts, n).map(q => showcaseCard(q, inputs));
  return { source: "pedagogy.queryShowcase", origin: "static", cards: built.map(b => b.card), holes: built.flatMap(b => b.holes) };
}
