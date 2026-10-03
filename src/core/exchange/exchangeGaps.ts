/**
 * XGAP1 (§ V5 Track E): the optional `gaps[]` block of an AI/app-exchange answer, i.e. what the answer says it
 * could not determine. Shape mirrors Common `@juliandatapass-group/exchange-protocol` `datapass.exchange-gaps/1`
 * (owner; `EXCHANGE_GAP_REASONS`, limits). A gap is a fact for "Next steps", never a proposal: nothing is
 * resolved from it, and its origin is always `ai-proposed`. Pure (no `vscode`).
 */
import { arr, enumOf, obj, type Schema } from "../contracts/schemaDsl";
import type { AppExchangePayload, Envelope } from "../contracts/envelopes";

export const EXCHANGE_GAP_REASONS = ["missing-source", "ambiguous", "out-of-scope"] as const;
export type ExchangeGapReason = (typeof EXCHANGE_GAP_REASONS)[number];
export const MAX_EXCHANGE_GAPS = 100;

export interface ExchangeGap {
  /** Where the answer stayed undecided, as the request named it (repo path, `path#L10-20`, artifact or node id). */
  location: string;
  question: string;
  reason: ExchangeGapReason;
}

const TRIMMED = "^\\S(?:[\\s\\S]*\\S)?$";
export const EXCHANGE_GAP_SCHEMA: Schema = obj({
  location: { type: "string", minLength: 1, maxLength: 4096, pattern: TRIMMED },
  question: { type: "string", minLength: 1, maxLength: 2000, pattern: TRIMMED },
  reason: enumOf(...EXCHANGE_GAP_REASONS)
});
export const EXCHANGE_GAPS_SCHEMA: Schema = arr(EXCHANGE_GAP_SCHEMA, MAX_EXCHANGE_GAPS);

/** A gap with the answer it came from. */
export interface AiGapFact extends ExchangeGap {
  /** Id of the answer envelope (the result). */
  answerRef: string;
  /** The external app / AI that answered. */
  appRef: string;
}

/** Duplicate (location, question) pairs in a block; the envelope validator rejects a block that has any. */
export function duplicateGaps(gaps: readonly ExchangeGap[]): string[] {
  const seen = new Set<string>(), dup: string[] = [];
  for (const g of gaps) { const k = `${g.location}\u0000${g.question}`; if (seen.has(k)) dup.push(`${g.location}: ${g.question}`); seen.add(k); }
  return dup;
}

/** The gaps of a validated result envelope (absent block = none). */
export function answerGaps(result: Envelope<"app-exchange", AppExchangePayload>): AiGapFact[] {
  return (result.payload.gaps ?? []).map(g => ({ location: g.location, question: g.question, reason: g.reason, answerRef: result.id, appRef: result.payload.appRef }));
}
