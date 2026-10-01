/**
 * V5 PEDA1b (TL-12/12b): pedagogy cards bound to the project's own code.
 *
 * - Concept card: the generic code example is replaced by the best matching span of the project (static facts from
 *   analyzers, signal `technique:<card id>`), with a jump. Best = the most focused span (fewest lines), then path and
 *   line (deterministic). No span → the generic example, marked `datapass-guidance`.
 * - Decision card: which option the project took and where — from a decision-rationale/1 record when one names the
 *   decision, else from facts (`DECISION_SIGNALS`: partitioning from NAVSQL1, retries from orchestration analyzers,
 *   history from dbt snapshots / MERGE). No record and no fact → the card's `ask` becomes a class-A owner question
 *   (practice rule 2), never a guessed answer.
 * Pure (no `vscode`); entry points (Context "Patterns", NAVPRIN1 principle cards, the Navigator at artifact/step level)
 * call `cardsForArtifact` / `cardsForConcepts` and draw the result with the detail-card / context-text kinds.
 */
import type { BindingData, Card, Cell, Hole, Origin } from "../../../webview/views/model";
import type { DecisionRationale } from "@juliandatapass-group/decision-rationale";
import type { OwnerQuestion, PedagogyCard } from "./catalogStub";

export interface CodeSpan { readonly repositoryKey: string; readonly path: string; readonly startLine: number; readonly endLine: number }

/** A static fact about the project: `technique:<card id>`, or a decision signal (`partitioning`, `retries`, `history`, `load-mode`). */
export interface ProjectFact {
  readonly signal: string;
  readonly at: CodeSpan;
  readonly origin: Origin;
  /** For decision signals: index of the card option the code shows (0 or 1). */
  readonly option?: 0 | 1;
  readonly detail?: string;
}

/** Decision card id → the fact signal that shows which option the project took (data, not logic). */
export const DECISION_SIGNALS: Readonly<Record<string, string>> = {
  "decision.storage-decisions.partition-or-not": "partitioning",
  "decision.recovery-change.retry-or-stop": "retries",
  "decision.data-modeling.latest-or-history": "history",
  "decision.recovery-change.full-or-incremental": "load-mode"
};

export type Excerpt =
  | { readonly source: "project"; readonly at: CodeSpan; readonly origin: Origin; readonly others: number }
  | { readonly source: "guidance"; readonly lang: string; readonly text: string; readonly origin: "datapass-guidance" };

export interface BoundConcept { readonly card: PedagogyCard; readonly excerpt: Excerpt }

export interface DecisionTaken { readonly option: string; readonly at: CodeSpan | null; readonly origin: Origin; readonly summary?: string }
export interface ClassAQuestion extends OwnerQuestion { readonly class: "A"; readonly cardId: string }
export type BoundDecision =
  | { readonly card: PedagogyCard; readonly taken: readonly DecisionTaken[]; readonly ask?: undefined }
  | { readonly card: PedagogyCard; readonly taken: readonly []; readonly ask: ClassAQuestion };

const spanLines = (s: CodeSpan) => s.endLine - s.startLine;
const cmpSpan = (a: CodeSpan, b: CodeSpan) => spanLines(a) - spanLines(b) || (a.repositoryKey + "/" + a.path < b.repositoryKey + "/" + b.path ? -1 : a.repositoryKey + "/" + a.path > b.repositoryKey + "/" + b.path ? 1 : 0) || a.startLine - b.startLine;

/** The best matching project span of a concept card, else its generic example marked datapass-guidance. */
export function bindConcept(card: PedagogyCard, facts: readonly ProjectFact[]): BoundConcept {
  const hits = facts.filter(f => f.signal === `technique:${card.id}`).sort((a, b) => cmpSpan(a.at, b.at));
  const best = hits[0];
  if (best) return { card, excerpt: { source: "project", at: best.at, origin: best.origin, others: hits.length - 1 } };
  const ex = card.card?.codeExample;
  return { card, excerpt: { source: "guidance", lang: ex?.lang ?? "text", text: ex?.text ?? "", origin: "datapass-guidance" } };
}

/** First evidence span of a rationale record, when it names one. */
function rationaleSpan(r: DecisionRationale, repositoryKey: string): CodeSpan | null {
  const ev = r.why.flatMap(w => w.evidence)[0];
  if (ev) return { repositoryKey, path: ev.path, startLine: ev.startLine ?? 1, endLine: ev.endLine ?? ev.startLine ?? 1 };
  const p = r.subjects.find(s => s.kind === "path");
  return p ? { repositoryKey, path: p.id, startLine: 1, endLine: 1 } : null;
}

/** Which option the project took and where; with neither record nor fact, a class-A owner question. */
export function bindDecision(card: PedagogyCard, facts: readonly ProjectFact[], rationales: readonly DecisionRationale[] = [], repositoryKey = ""): BoundDecision {
  const d = card.decisionCard;
  const records = rationales.filter(r => r.decisionPoint !== null && (r.decisionPoint === card.id || r.decisionPoint === card.conceptId));
  if (records.length) return { card, taken: records.map(r => ({ option: r.choice.option ?? r.choice.summary, summary: r.choice.summary, at: rationaleSpan(r, repositoryKey), origin: r.origin })) };
  const signal = DECISION_SIGNALS[card.id];
  const hits = signal && d ? facts.filter(f => f.signal === signal && f.option !== undefined).sort((a, b) => cmpSpan(a.at, b.at)) : [];
  if (hits.length && d) {
    const byOption = new Map<number, ProjectFact>();
    for (const f of hits) if (!byOption.has(f.option!)) byOption.set(f.option!, f);
    return { card, taken: [...byOption].sort(([a], [b]) => a - b).map(([i, f]) => ({ option: d.options[i]!, at: f.at, origin: f.origin, ...(f.detail ? { summary: f.detail } : {}) })) };
  }
  const ask = d?.ask ?? { text: card.title, why: "no decision fact for this card", constraint: "consumer" as const };
  return { card, taken: [], ask: { class: "A", cardId: card.id, ...ask } };
}

const where = (s: CodeSpan | null) => s ? `${s.repositoryKey ? `${s.repositoryKey}/` : ""}${s.path}:${s.startLine}-${s.endLine}` : null;
const inArtifact = (s: CodeSpan | null, repositoryKey: string, path: string) => !!s && s.repositoryKey === repositoryKey && s.path === path;

/** One detail card (field labels are keys `field.<label>` in the host labels; values carry their origin). */
export function conceptCardView(b: BoundConcept): Card {
  const c = b.card.card;
  const e = b.excerpt;
  const fields: { label: string; value: Cell }[] = [
    { label: "pedagogy.question", value: { value: c?.question ?? null, origin: "datapass-guidance" } },
    e.source === "project"
      ? { label: "pedagogy.excerpt", value: { value: where(e.at), origin: e.origin } }
      : { label: "pedagogy.example", value: { value: e.text, origin: "datapass-guidance" } },
    { label: "pedagogy.takeaways", value: { value: c?.takeaways.join("; ") || null, origin: "datapass-guidance" } }
  ];
  if (c?.output) fields.splice(2, 0, { label: "pedagogy.output", value: { value: c.output, origin: "datapass-guidance" } });
  return { id: `pedagogy:${b.card.id}`, title: b.card.title, origin: e.origin, fields, ...(e.source === "project" ? { nodeId: `${e.at.repositoryKey}/${e.at.path}` } : {}) };
}

export function decisionCardView(b: BoundDecision): { card: Card; holes: Hole[] } {
  const d = b.card.decisionCard;
  const g = (value: string | null): Cell => ({ value, origin: "datapass-guidance" });
  const fields: { label: string; value: Cell }[] = [
    { label: "pedagogy.question", value: g(d?.question ?? null) },
    ...b.taken.map(t => ({ label: "pedagogy.projectChoice", value: { value: `${t.option}${where(t.at) ? ` @ ${where(t.at)}` : ""}`, origin: t.origin } as Cell })),
    { label: "pedagogy.rule", value: g(d?.rule ?? null) },
    { label: "pedagogy.maxim", value: g(d?.maxim ?? null) }
  ];
  const holes: Hole[] = [];
  if (b.ask) {
    fields.splice(1, 0, { label: "pedagogy.ownerQuestion", value: { value: b.ask.text, origin: "owner-question" } });
    holes.push({ kind: "owner-question", field: "pedagogy.projectChoice", reason: `${b.card.id}: class A — ${b.ask.text} (${b.ask.why})` });
  }
  return { card: { id: `pedagogy:${b.card.id}`, title: b.card.title, origin: b.taken[0]?.origin ?? "datapass-guidance", fields }, holes };
}

export interface CardInputs { readonly cards: readonly PedagogyCard[]; readonly facts: readonly ProjectFact[]; readonly rationales?: readonly DecisionRationale[]; readonly repositoryKey?: string }

function build(cards: readonly PedagogyCard[], inputs: CardInputs, keep: (span: CodeSpan | null, isDecision: boolean) => boolean): BindingData {
  const out: Card[] = [], holes: Hole[] = [];
  for (const card of [...cards].sort((a, b) => a.family.localeCompare(b.family) || a.order - b.order)) {
    if (card.kind === "decision") {
      const b = bindDecision(card, inputs.facts, inputs.rationales, inputs.repositoryKey);
      if (!keep(b.taken[0]?.at ?? null, true)) continue;
      const v = decisionCardView(b);
      out.push(v.card); holes.push(...v.holes);
    } else {
      const b = bindConcept(card, inputs.facts);
      if (!keep(b.excerpt.source === "project" ? b.excerpt.at : null, false)) continue;
      out.push(conceptCardView(b));
    }
  }
  return { source: "pedagogy.projectCards", origin: out.some(c => c.origin !== "datapass-guidance") ? "static" : "datapass-guidance", cards: out, holes };
}

/** Context "Patterns" / Navigator artifact level: cards whose project span lies in this file, plus its open decisions. */
export function cardsForArtifact(inputs: CardInputs, repositoryKey: string, path: string): BindingData {
  return build(inputs.cards, inputs, (span, isDecision) => inArtifact(span, repositoryKey, path) || (isDecision && span === null && inputs.facts.some(f => inArtifact(f.at, repositoryKey, path))));
}

/** NAVPRIN1 principle cards: the cards of the given concept ids (or card ids), bound to the project, guidance fallback kept. */
export function cardsForConcepts(inputs: CardInputs, ids: readonly string[]): BindingData {
  const want = new Set(ids);
  return build(inputs.cards.filter(c => want.has(c.id) || (c.conceptId !== null && want.has(c.conceptId))), inputs, () => true);
}
