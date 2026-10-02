/**
 * V4-NAV NAVPRIN1 binding `principles`: the DataPass-authored principle cards (principles.json, origin
 * `datapass-guidance`) with, for each, where this project applies or breaks it, computed by principles/checks.ts.
 * Card text is DataPass guidance, never client evidence; the Locations come from the client facts. At a lower
 * level only the cards that concern the Location's subtree are returned ('Principles here').
 */
import builtIn from "../principles/principles.json";
import { runPrincipleCheck, type PrincipleBreak, type PrincipleFacts, type PrincipleSettings } from "../principles/checks";
import type { NavLocation } from "../navTypes";
import type { NavOrigin } from "./origin";

export const PRINCIPLES_SOURCE = "principles";
export const PRINCIPLES_SCHEMA = "datapass.principles/1";

export interface PrincipleCardDef {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly concepts: readonly string[];
  readonly check: string;
}
export interface PrinciplesDoc {
  readonly schema: typeof PRINCIPLES_SCHEMA;
  readonly origin: "datapass-guidance";
  readonly label: string;
  readonly cards: readonly PrincipleCardDef[];
}

export interface PrincipleCard extends PrincipleCardDef {
  /** Badge shown on every card ('DataPass guidance'); data, overridable. */
  readonly label: string;
  /** Origin of the card text. Locations carry the origin of the facts they come from. */
  readonly origin: "datapass-guidance";
  readonly status: "applies" | "breaks" | "unknown";
  readonly applies: readonly NavLocation[];
  readonly breaks: readonly PrincipleBreak[];
  readonly holes: readonly { readonly reason: string }[];
}

export interface PrinciplesResult {
  readonly cards: readonly PrincipleCard[];
  readonly holes: readonly { reason: string }[];
  readonly origin: NavOrigin;
}

/** Validates a principles document (built-in or user override from the catalog); returns null when unusable. */
export function parsePrinciples(raw: unknown): PrinciplesDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.schema !== PRINCIPLES_SCHEMA || !Array.isArray(d.cards)) return null;
  const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const cards: PrincipleCardDef[] = [];
  const ids = new Set<string>();
  for (const c of d.cards as unknown[]) {
    if (!c || typeof c !== "object") continue;
    const x = c as Record<string, unknown>;
    if (!str(x.id) || !str(x.title) || !str(x.text) || !str(x.check) || ids.has(x.id as string)) continue;
    const concepts = Array.isArray(x.concepts) ? x.concepts.filter(str) as string[] : [];
    ids.add(x.id as string);
    cards.push({ id: x.id as string, title: x.title as string, text: x.text as string, check: x.check as string, concepts });
  }
  return { schema: PRINCIPLES_SCHEMA, origin: "datapass-guidance", label: str(d.label) ? d.label as string : "DataPass guidance", cards };
}

export const BUILT_IN_PRINCIPLES: PrinciplesDoc = parsePrinciples(builtIn)!;

/** Overrides replace built-in cards by id and append new ones; a card with `hidden: true` is dropped. */
export function mergePrinciples(base: PrinciplesDoc, override: unknown): PrinciplesDoc {
  if (!override || typeof override !== "object") return base;
  const o = override as Record<string, unknown>;
  const parsed = parsePrinciples({ ...o, schema: PRINCIPLES_SCHEMA, cards: Array.isArray(o.cards) ? o.cards : [] });
  const hidden = new Set(Array.isArray(o.cards) ? (o.cards as Record<string, unknown>[]).filter(c => c?.hidden === true).map(c => c.id) : []);
  const byId = new Map(base.cards.map(c => [c.id, c] as const));
  for (const c of parsed?.cards ?? []) byId.set(c.id, c);
  for (const id of hidden) byId.delete(id as string);
  return { ...base, label: typeof o.label === "string" && o.label.trim() ? o.label : base.label, cards: [...byId.values()] };
}

export interface PrinciplesQuery {
  readonly facts: PrincipleFacts;
  /** Restrict Locations to this subtree ('Principles here'); absent = whole project. */
  readonly within?: (l: NavLocation) => boolean;
  readonly doc?: PrinciplesDoc;
  readonly settings?: PrincipleSettings;
}

export function principleCards(q: PrinciplesQuery): PrinciplesResult {
  const doc = q.doc ?? BUILT_IN_PRINCIPLES;
  const within = q.within;
  const facts: PrincipleFacts = within ? { ...q.facts, artifacts: q.facts.artifacts.filter(a => within(a.location)) } : q.facts;
  const cards: PrincipleCard[] = [];
  const holes: { reason: string }[] = [];
  for (const def of doc.cards) {
    const r = runPrincipleCheck(def.check, facts, q.settings);
    // 'Principles here': keep only cards with a Location in the subtree.
    if (within && !r.applies.length && !r.breaks.length) continue;
    cards.push({ ...def, label: doc.label, origin: "datapass-guidance", status: r.status, applies: r.applies, breaks: r.breaks, holes: r.holes });
    for (const h of r.holes) holes.push({ reason: `${def.title}: ${h.reason}` });
  }
  if (within && !cards.length) holes.push({ reason: "no principle check has evidence for this location" });
  return { cards, holes, origin: "datapass-guidance" };
}
