/**
 * V5 PEDA1b (TL-12/12b, go/TOUR-PEDA-contract.md § 3–5): pedagogy cards bound to the project's own code.
 *
 * - Concept card (`concept:<entryId>`): the generic code example is replaced by the best matching project span (static
 *   facts, signal `concept:<entryId>`), with a jump. Best = the most focused span (fewest lines), then path and line
 *   (deterministic). No span → the generic example, marked `datapass-guidance`.
 * - Decision card (`decision:<entryId>`): which option the project took and where — from a decision-rationale/1 record
 *   whose decisionPoint is the entry, else from facts (`DECISION_SIGNALS`: partitioning from NAVSQL1, retries from the
 *   orchestration analyzers, history from dbt snapshots / MERGE, load mode). No record and no fact → the card's `ask`
 *   becomes a class-A owner question (practice rule 2), never a guessed answer.
 * Pure (no `vscode`). Entry points (Context "Patterns", NAVPRIN1 principle cards, the Navigator at artifact/step level,
 * tour refs) call `cardsForArtifact` / `cardsForConcepts` / `cardByRef` and draw with the detail-card / context-text kinds.
 */
import type { BindingData, Card, Cell, Hole, Origin } from "../../webview/views/model";
import type { DecisionRationale } from "@juliandatapass-group/decision-rationale";
import type { CardEntry, OwnerQuestion } from "./cardTypes";

export interface CodeSpan { readonly repositoryKey: string; readonly path: string; readonly startLine: number; readonly endLine: number }

/** A static fact about the project: `concept:<entryId>` (a span using the concept), or a decision signal. */
export interface ProjectFact {
  readonly signal: string;
  readonly at: CodeSpan;
  readonly origin: Origin;
  /** For decision signals: the option id (of the entry's `options`) the code shows. */
  readonly option?: string;
  readonly detail?: string;
}

/** Decision entry id → the fact signal that shows which option the project took (data, not logic). */
export const DECISION_SIGNALS: Readonly<Record<string, string>> = {
  "concept.layout.partition-key": "partitioning",
  "concept.architecture.retry-policy": "retries",
  "concept.modelling.scd-choice": "history",
  "concept.ingestion.load-mode": "load-mode"
};

export interface CardSettings { readonly conceptCards: boolean; readonly decisionCards: boolean }
export const ALL_CARDS: CardSettings = { conceptCards: true, decisionCards: true };

export type Excerpt =
  | { readonly source: "project"; readonly at: CodeSpan; readonly origin: Origin; readonly others: number }
  | { readonly source: "guidance"; readonly lang: string; readonly text: string; readonly origin: "datapass-guidance" };
export interface BoundConcept { readonly entry: CardEntry; readonly excerpt: Excerpt }

export interface DecisionTaken { readonly option: string; readonly label: string; readonly at: CodeSpan | null; readonly origin: Origin; readonly summary?: string }
export interface ClassAQuestion extends OwnerQuestion { readonly class: "A"; readonly entryId: string }
export type BoundDecision =
  | { readonly entry: CardEntry; readonly taken: readonly DecisionTaken[]; readonly ask?: undefined }
  | { readonly entry: CardEntry; readonly taken: readonly []; readonly ask: ClassAQuestion };

const key = (s: CodeSpan) => `${s.repositoryKey}/${s.path}`;
const cmpSpan = (a: CodeSpan, b: CodeSpan) => (a.endLine - a.startLine) - (b.endLine - b.startLine) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) || a.startLine - b.startLine;

/** The best matching project span of a concept card, else its generic example marked datapass-guidance. */
export function bindConcept(entry: CardEntry, facts: readonly ProjectFact[]): BoundConcept {
  const hits = facts.filter(f => f.signal === `concept:${entry.id}`).sort((a, b) => cmpSpan(a.at, b.at));
  const best = hits[0];
  if (best) return { entry, excerpt: { source: "project", at: best.at, origin: best.origin, others: hits.length - 1 } };
  const ex = entry.card?.codeExample;
  return { entry, excerpt: { source: "guidance", lang: ex?.lang ?? "text", text: ex?.text ?? "", origin: "datapass-guidance" } };
}

function rationaleSpan(r: DecisionRationale, repositoryKey: string): CodeSpan | null {
  const ev = r.why.flatMap(w => w.evidence)[0];
  if (ev) return { repositoryKey, path: ev.path, startLine: ev.startLine ?? 1, endLine: ev.endLine ?? ev.startLine ?? 1 };
  const p = r.subjects.find(s => s.kind === "path");
  return p ? { repositoryKey, path: p.id, startLine: 1, endLine: 1 } : null;
}

const optionLabel = (entry: CardEntry, id: string) => entry.options.find(o => o.id === id)?.title ?? id;

/** Which option the project took and where; with neither record nor fact, a class-A owner question. */
export function bindDecision(entry: CardEntry, facts: readonly ProjectFact[], rationales: readonly DecisionRationale[] = [], repositoryKey = ""): BoundDecision {
  const d = entry.decisionCard;
  const records = rationales.filter(r => r.decisionPoint === entry.id);
  if (records.length) return { entry, taken: records.map(r => ({ option: r.choice.option ?? "", label: r.choice.option ? optionLabel(entry, r.choice.option) : r.choice.summary,
    summary: r.choice.summary, at: rationaleSpan(r, repositoryKey), origin: r.origin })) };
  const signal = DECISION_SIGNALS[entry.id];
  const hits = signal && d ? facts.filter(f => f.signal === signal && f.option !== undefined && d.options.includes(f.option)).sort((a, b) => cmpSpan(a.at, b.at)) : [];
  if (hits.length && d) {
    const byOption = new Map<string, ProjectFact>();
    for (const f of hits) if (!byOption.has(f.option!)) byOption.set(f.option!, f);
    return { entry, taken: d.options.filter(o => byOption.has(o)).map(o => { const f = byOption.get(o)!;
      return { option: o, label: optionLabel(entry, o), at: f.at, origin: f.origin, ...(f.detail ? { summary: f.detail } : {}) }; }) };
  }
  const ask = d?.ask ?? { text: entry.title, why: "no decision fact for this card", constraint: "consumer" as const };
  return { entry, taken: [], ask: { class: "A", entryId: entry.id, ...ask } };
}

const where = (s: CodeSpan | null) => s ? `${s.repositoryKey ? `${s.repositoryKey}/` : ""}${s.path}:${s.startLine}-${s.endLine}` : null;
const g = (value: string | null): Cell => ({ value, origin: "datapass-guidance" });

/** One concept card (field labels are keys `field.<label>` in the host labels; values carry their origin). */
export function conceptCardView(b: BoundConcept): Card {
  const c = b.entry.card;
  const e = b.excerpt;
  const fields: { label: string; value: Cell }[] = [
    { label: "pedagogy.question", value: g(c?.question ?? null) },
    e.source === "project" ? { label: "pedagogy.excerpt", value: { value: where(e.at), origin: e.origin } } : { label: "pedagogy.example", value: g(e.text) },
    ...(c?.output ? [{ label: "pedagogy.output", value: g(c.output) }] : []),
    { label: "pedagogy.takeaways", value: g(c?.takeaways.join("; ") || null) }
  ];
  return { id: `concept:${b.entry.id}`, title: b.entry.title, origin: e.origin, fields, ...(e.source === "project" ? { nodeId: key(e.at) } : {}) };
}

export function decisionCardView(b: BoundDecision): { card: Card; holes: Hole[] } {
  const d = b.entry.decisionCard;
  const fields: { label: string; value: Cell }[] = [
    { label: "pedagogy.question", value: g(d?.question ?? null) },
    ...(b.ask ? [{ label: "pedagogy.ownerQuestion", value: { value: b.ask.text, origin: "owner-question" } as Cell }] : []),
    ...b.taken.map(t => ({ label: "pedagogy.projectChoice", value: { value: `${t.label}${where(t.at) ? ` @ ${where(t.at)}` : ""}`, origin: t.origin } as Cell })),
    { label: "pedagogy.rule", value: g(d?.rule ?? null) },
    ...(d?.maxim ? [{ label: "pedagogy.maxim", value: g(d.maxim) }] : [])
  ];
  const holes: Hole[] = b.ask ? [{ kind: "owner-question", field: "pedagogy.projectChoice", reason: `${b.entry.id}: class A — ${b.ask.text} (${b.ask.why})` }] : [];
  const first = b.taken[0];
  return { card: { id: `decision:${b.entry.id}`, title: b.entry.title, origin: first?.origin ?? "datapass-guidance", fields, ...(first?.at ? { nodeId: key(first.at) } : {}) }, holes };
}

export interface CardInputs {
  readonly entries: readonly CardEntry[]; readonly facts: readonly ProjectFact[];
  readonly rationales?: readonly DecisionRationale[]; readonly repositoryKey?: string; readonly settings?: CardSettings;
}

interface Built { readonly card: Card; readonly holes: readonly Hole[]; readonly span: CodeSpan | null; readonly decision: boolean }

function buildAll(entries: readonly CardEntry[], inputs: CardInputs): Built[] {
  const s = inputs.settings ?? ALL_CARDS;
  const out: Built[] = [];
  const order = (e: CardEntry) => e.card ? [0, e.card.family, e.card.order] as const : [1, e.decisionCard!.family, e.decisionCard!.order] as const;
  const sorted = entries.filter(e => (e.card && s.conceptCards) || (e.decisionCard && s.decisionCards)).sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2] || a.id.localeCompare(b.id);
  });
  for (const e of sorted) {
    if (e.card && s.conceptCards) {
      const b = bindConcept(e, inputs.facts);
      out.push({ card: conceptCardView(b), holes: [], span: b.excerpt.source === "project" ? b.excerpt.at : null, decision: false });
    }
    if (e.decisionCard && s.decisionCards) {
      const b = bindDecision(e, inputs.facts, inputs.rationales, inputs.repositoryKey);
      const v = decisionCardView(b);
      out.push({ card: v.card, holes: v.holes, span: b.taken[0]?.at ?? null, decision: true });
    }
  }
  return out;
}

function toBinding(built: readonly Built[]): BindingData {
  return { source: "pedagogy.cards", origin: built.some(b => b.card.origin !== "datapass-guidance") ? "static" : "datapass-guidance",
    cards: built.map(b => b.card), holes: built.flatMap(b => b.holes) };
}

/** Context "Patterns" / Navigator artifact level: cards bound to this file, plus the open decisions of a file that has facts. */
export function cardsForArtifact(inputs: CardInputs, repositoryKey: string, path: string): BindingData {
  const inFile = (s: CodeSpan | null) => !!s && s.repositoryKey === repositoryKey && s.path === path;
  const fileHasFacts = inputs.facts.some(f => inFile(f.at));
  return toBinding(buildAll(inputs.entries, inputs).filter(b => inFile(b.span) || (b.decision && b.span === null && fileHasFacts)));
}

/** NAVPRIN1 principle cards: the cards of the given entry ids, bound to the project, guidance fallback kept. */
export function cardsForConcepts(inputs: CardInputs, ids: readonly string[]): BindingData {
  const want = new Set(ids);
  return toBinding(buildAll(inputs.entries.filter(e => want.has(e.id)), inputs));
}

/** A tour explanation ref `concept:<entryId>` / `decision:<entryId>` (contract § 3); undefined = unknown (the box shows a hole). */
export function cardByRef(inputs: CardInputs, ref: string): { card: Card; holes: readonly Hole[] } | undefined {
  const m = /^(concept|decision):(\S+)$/.exec(ref);
  const entry = m && inputs.entries.find(e => e.id === m[2]);
  if (!m || !entry) return undefined;
  const s = inputs.settings ?? ALL_CARDS;
  const built = buildAll([entry], { ...inputs, settings: { conceptCards: m[1] === "concept" && s.conceptCards, decisionCards: m[1] === "decision" && s.decisionCards } })[0];
  return built ? { card: built.card, holes: built.holes } : undefined;
}
