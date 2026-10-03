/**
 * V5 PEDA1b: the pedagogy card contract (go/TOUR-PEDA-contract.md § 5, arch-catalog concept-entry/1 additive: `card` /
 * `decisionCard` on a ConceptEntry). The card texts are data: resources/pedagogy/cards.json (generic teaching content,
 * no client content), read and checked by `parseCardCatalog`. The family and language lists come from the vendored
 * `@juliandatapass-group/arch-catalog` (PEDA1a / PEDA1a2). Pure (no `vscode`).
 */
import {
  CODE_LANGS, CONCEPT_CARD_FAMILIES, CONSTRAINT_KINDS, DECISION_CARD_FAMILIES,
  type CodeLang, type ConceptCardFamily, type ConceptEntry, type ConceptOption, type DecisionCardFamily, type OwnerQuestion
} from "@juliandatapass-group/arch-catalog";
import catalogData from "../../../resources/pedagogy/cards.json";

export type { OwnerQuestion };
export { CODE_LANGS, CONCEPT_CARD_FAMILIES, DECISION_CARD_FAMILIES, type CodeLang, type ConceptCardFamily, type DecisionCardFamily };
export interface CodeExample { readonly lang: CodeLang; readonly text: string }
export interface ImplementedBy { readonly kind: "detector" | "analyzer" | "fact" | "view"; readonly id: string }
export interface ConceptCard {
  readonly family: ConceptCardFamily; readonly order: number; readonly question: string;
  readonly codeExample: CodeExample; readonly output?: string;
  readonly comparison?: { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] };
  readonly takeaways: readonly string[]; readonly interviewQuestions: readonly string[]; readonly implementedBy: readonly ImplementedBy[];
  /** Case-insensitive patterns matched line by line on the comment-stripped code (static, nothing run): each hit is a span. */
  readonly codeSignals?: readonly string[];
}
export interface DecisionCard {
  readonly family: DecisionCardFamily; readonly order: number; readonly question: string;
  /** Ids of this entry's `options`. */
  readonly options: readonly [string, string];
  readonly rule: string; readonly ask: OwnerQuestion; readonly maxim?: string; readonly example?: CodeExample;
  /** The decision-rationale/1 `decisionPoint` this card answers (default: the entry id). */
  readonly decisionPoint?: string;
  /** Concept entry ids shown with this card; when set, the open question is listed only for a file using one of them. */
  readonly concepts?: readonly string[];
}

/** The part of a concept entry the cards use (a full ConceptEntry with `card` / `decisionCard` satisfies it). */
export type CardEntry = Pick<ConceptEntry, "id" | "domain" | "title"> & {
  readonly options: readonly Pick<ConceptOption, "id" | "title">[];
  readonly card?: ConceptCard;
  readonly decisionCard?: DecisionCard;
};

export class CardCatalogError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

function checkExample(where: string, v: unknown): void {
  if (!isObj(v) || !oneOf(CODE_LANGS, v.lang) || typeof v.text !== "string") throw new CardCatalogError(`${where}: codeExample needs lang (${CODE_LANGS.join(", ")}) and text`);
}

function checkConcept(id: string, c: unknown): void {
  if (!isObj(c)) throw new CardCatalogError(`${id}: card must be an object`);
  if (!oneOf(CONCEPT_CARD_FAMILIES, c.family)) throw new CardCatalogError(`${id}: unknown concept family ${String(c.family)}`);
  if (typeof c.order !== "number" || !isStr(c.question)) throw new CardCatalogError(`${id}: card needs order and question`);
  checkExample(id, c.codeExample);
  if (!isStrs(c.takeaways) || !isStrs(c.interviewQuestions)) throw new CardCatalogError(`${id}: takeaways and interviewQuestions are string lists`);
  if (!Array.isArray(c.implementedBy) || !c.implementedBy.every(x => isObj(x) && oneOf(["detector", "analyzer", "fact", "view"], x.kind) && isStr(x.id))) throw new CardCatalogError(`${id}: implementedBy`);
  if (c.output !== undefined && typeof c.output !== "string") throw new CardCatalogError(`${id}: output is text`);
  if (c.codeSignals !== undefined) {
    if (!isStrs(c.codeSignals)) throw new CardCatalogError(`${id}: codeSignals are patterns`);
    for (const p of c.codeSignals) { try { new RegExp(p, "i"); } catch { throw new CardCatalogError(`${id}: bad codeSignal ${p}`); } }
  }
}

function checkDecision(id: string, optionIds: readonly string[], d: unknown): void {
  if (!isObj(d)) throw new CardCatalogError(`${id}: decisionCard must be an object`);
  if (!oneOf(DECISION_CARD_FAMILIES, d.family)) throw new CardCatalogError(`${id}: unknown decision family ${String(d.family)}`);
  if (typeof d.order !== "number" || !isStr(d.question) || !isStr(d.rule)) throw new CardCatalogError(`${id}: decisionCard needs order, question and rule`);
  if (!isStrs(d.options) || d.options.length !== 2 || !d.options.every(o => optionIds.includes(o))) throw new CardCatalogError(`${id}: decisionCard.options are two ids of the entry's options`);
  const a = d.ask;
  if (!isObj(a) || !isStr(a.text) || !isStr(a.why) || !oneOf(CONSTRAINT_KINDS, a.constraint)) throw new CardCatalogError(`${id}: ask needs text, why and a known constraint`);
  if (d.maxim !== undefined && !isStr(d.maxim)) throw new CardCatalogError(`${id}: maxim is text`);
  if (d.example !== undefined) checkExample(id, d.example);
  if (d.decisionPoint !== undefined && !isStr(d.decisionPoint)) throw new CardCatalogError(`${id}: decisionPoint is an id`);
  if (d.concepts !== undefined && !isStrs(d.concepts)) throw new CardCatalogError(`${id}: concepts are entry ids`);
}

/** Read and check a `datapass.pedagogy-cards/1` document; throws `CardCatalogError` on the first problem. */
export function parseCardCatalog(doc: unknown): CardEntry[] {
  if (!isObj(doc) || doc.schema !== "datapass.pedagogy-cards/1" || !Array.isArray(doc.entries)) throw new CardCatalogError("not a datapass.pedagogy-cards/1 document");
  const ids = new Set<string>();
  for (const e of doc.entries as unknown[]) {
    if (!isObj(e) || !isStr(e.id) || !isStr(e.domain) || !isStr(e.title)) throw new CardCatalogError("an entry needs id, domain and title");
    if (ids.has(e.id)) throw new CardCatalogError(`${e.id}: duplicate id`);
    ids.add(e.id);
    if (!Array.isArray(e.options) || !e.options.every(o => isObj(o) && isStr(o.id) && isStr(o.title))) throw new CardCatalogError(`${e.id}: options are {id, title}`);
    if (e.card === undefined && e.decisionCard === undefined) throw new CardCatalogError(`${e.id}: no card`);
    if (e.card !== undefined) checkConcept(e.id, e.card);
    if (e.decisionCard !== undefined) checkDecision(e.id, (e.options as { id: string }[]).map(o => o.id), e.decisionCard);
  }
  const entries = doc.entries as CardEntry[];
  for (const e of entries) for (const c of e.decisionCard?.concepts ?? []) {
    if (!entries.some(x => x.id === c && x.card)) throw new CardCatalogError(`${e.id}: ${c} is not a concept card`);
  }
  return entries;
}

/** The built-in cards (resources/pedagogy/cards.json). */
export const CARD_ENTRIES: readonly CardEntry[] = parseCardCatalog(catalogData);
