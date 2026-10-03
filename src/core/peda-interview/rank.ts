/**
 * V5 PEDA2 (TL-12, Julian 12:10 "read the project through an interviewer's eyes"): rank the catalog notions the
 * project really uses, then prepare each one for an interview.
 *
 * Ranking (pure, documented, deterministic):
 *   uses   = project facts showing the notion (`concept:<id>` signals for a concept card; the entry's
 *            DECISION_SIGNALS signal with a known option, or a decision-rationale record, for a decision card)
 *   blast  = distinct files touched + (distinct repositories − 1)   (how far a change to it would reach)
 *   score  = uses × blast; ties: blast desc, then `<kind>:<entryId>` asc.
 * A notion with no use is not ranked (a generic course is not interview prep). The list is cut to `max`
 * (setting `datapass.pedagogy.interviewPrep.maxNotions`, 15, clamped 10–20).
 *
 * Prep per notion: 2–3 questions from the card, "where in this project" (the most focused spans first), and
 * "why this choice here / the alternative" from a decision-rationale record when present, else a typed hole —
 * never an invented reason. Pure (no `vscode`).
 */
import type { DecisionRationale } from "@juliandatapass-group/decision-rationale";
import type { Hole, Origin } from "../../webview/views/model";
import { DECISION_SIGNALS, type CodeSpan, type ProjectFact } from "../peda-cards/bind";
import type { CardEntry } from "../peda-cards/cardTypes";
import { spineStepOf, type WholePictureStepId } from "./spine";

export const MAX_NOTIONS = { default: 15, min: 10, max: 20 } as const;
export const clampMaxNotions = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(MAX_NOTIONS.max, Math.max(MAX_NOTIONS.min, Math.round(n))) : MAX_NOTIONS.default;

export type NotionKind = "concept" | "decision";

export interface RankedNotion {
  /** Tour explanation ref (contract § 3): `concept:<entryId>` or `decision:<entryId>`. */
  readonly ref: string;
  readonly kind: NotionKind;
  readonly entry: CardEntry;
  readonly step: WholePictureStepId;
  readonly uses: number;
  readonly blast: number;
  readonly score: number;
  /** Most focused first, then path and line. */
  readonly spans: readonly CodeSpan[];
  readonly rationales: readonly DecisionRationale[];
}

export interface RankInputs {
  readonly entries: readonly CardEntry[];
  readonly facts: readonly ProjectFact[];
  readonly rationales?: readonly DecisionRationale[];
  /** Repository key of rationale evidence paths (records carry repository-relative paths). */
  readonly repositoryKey?: string;
}

const spanKey = (s: CodeSpan) => `${s.repositoryKey}/${s.path}`;
const cmpSpan = (a: CodeSpan, b: CodeSpan) => (a.endLine - a.startLine) - (b.endLine - b.startLine)
  || (spanKey(a) < spanKey(b) ? -1 : spanKey(a) > spanKey(b) ? 1 : 0) || a.startLine - b.startLine;

function rationaleSpans(r: DecisionRationale, repositoryKey: string): CodeSpan[] {
  return [...r.why.flatMap(w => w.evidence), ...r.how.evidence].map(e => ({ repositoryKey, path: e.path,
    startLine: e.startLine ?? 1, endLine: e.endLine ?? e.startLine ?? 1 }));
}

function notion(entry: CardEntry, kind: NotionKind, spans: CodeSpan[], uses: number, rationales: readonly DecisionRationale[]): RankedNotion | undefined {
  const step = spineStepOf(entry, kind);
  if (!step || uses === 0) return undefined;
  const files = new Set(spans.map(spanKey)).size;
  const repos = new Set(spans.map(s => s.repositoryKey)).size;
  const blast = Math.max(1, files + Math.max(0, repos - 1));
  const unique = [...new Map(spans.map(s => [`${spanKey(s)}:${s.startLine}-${s.endLine}`, s])).values()].sort(cmpSpan);
  return { ref: `${kind}:${entry.id}`, kind, entry, step, uses, blast, score: uses * blast, spans: unique, rationales };
}

/** The notions the project really uses, best first, at most `max`. */
export function rankNotions(inputs: RankInputs, max: number = MAX_NOTIONS.default): RankedNotion[] {
  const out: RankedNotion[] = [];
  const records = inputs.rationales ?? [];
  for (const entry of inputs.entries) {
    if (entry.card) {
      const hits = inputs.facts.filter(f => f.signal === `concept:${entry.id}`);
      const n = notion(entry, "concept", hits.map(h => h.at), hits.length, []);
      if (n) out.push(n);
    }
    if (entry.decisionCard) {
      const signal = DECISION_SIGNALS[entry.id];
      const options = entry.decisionCard.options;
      const hits = signal ? inputs.facts.filter(f => f.signal === signal && f.option !== undefined && options.includes(f.option)) : [];
      const recs = records.filter(r => r.decisionPoint === entry.id);
      const spans = [...hits.map(h => h.at), ...recs.flatMap(r => rationaleSpans(r, inputs.repositoryKey ?? ""))];
      const n = notion(entry, "decision", spans, hits.length + recs.length, recs);
      if (n) out.push(n);
    }
  }
  return out.sort((a, b) => b.score - a.score || b.blast - a.blast || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).slice(0, Math.max(0, max));
}

export interface Said { readonly text: string; readonly origin: Origin }

export interface NotionPrep {
  readonly ref: string;
  readonly title: string;
  readonly step: WholePictureStepId;
  /** 2–3 questions an interviewer would ask, from the card (datapass-guidance). */
  readonly questions: readonly string[];
  /** Where in this project (at most 3 spans). */
  readonly where: readonly CodeSpan[];
  /** Why this choice here: a decision-rationale record, else null (hole). */
  readonly why: Said | null;
  /** The alternative and why not here: a record's alternative, else the card's other option + rule (guidance). */
  readonly alternative: Said | null;
  readonly holes: readonly Hole[];
}

const MAX_QUESTIONS = 3, MAX_WHERE = 3;

/** Interview prep of one ranked notion. */
export function prepNotion(n: RankedNotion): NotionPrep {
  const holes: Hole[] = [];
  const c = n.entry.card, d = n.entry.decisionCard;
  const questions = (n.kind === "concept"
    ? [...(c?.interviewQuestions ?? []), ...(c?.question ? [c.question] : [])]
    : [...(d?.question ? [d.question] : []), ...(d?.ask.text ? [d.ask.text] : []), ...(c?.interviewQuestions ?? [])]).slice(0, MAX_QUESTIONS);
  if (questions.length < 2) holes.push({ kind: "missing-questions", field: "interview.questions", reason: `${n.ref}: the card has fewer than 2 interview questions` });
  const rec = n.rationales[0];
  const why: Said | null = rec ? { text: [rec.choice.summary, ...rec.why.map(w => w.driver)].join(" — "), origin: rec.origin } : null;
  if (!why) holes.push({ kind: "missing-rationale", field: "interview.why", reason: `${n.ref}: no decision-rationale record says why this project made this choice (ask the owner)` });
  const alt = rec?.alternatives[0];
  let alternative: Said | null = alt ? { text: `${alt.label}: ${alt.whyNotHere}`, origin: rec.origin } : null;
  if (!alternative && d) {
    const other = n.entry.options.filter(o => d.options.includes(o.id)).map(o => o.title).join(" / ");
    alternative = { text: `${other}: ${d.rule}`, origin: "datapass-guidance" };
  }
  if (!alternative) holes.push({ kind: "missing-alternative", field: "interview.alternative", reason: `${n.ref}: no alternative recorded for this notion` });
  return { ref: n.ref, title: n.entry.title, step: n.step, questions, where: n.spans.slice(0, MAX_WHERE), why, alternative, holes };
}
