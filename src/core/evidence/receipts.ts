/**
 * Receipts (D-22): what a work-order result proves, one field per kind of evidence. A CLI exit, a
 * green CI, a deployment, a runtime success and a scientific validity are different claims; none
 * stands in for another. An agent's "I tested it" stays an assertion until its check is a receipt:
 * it names the tool, the scope, the input identity and the outcome. Even then it is the agent's
 * receipt; only CI read from the Git host by DataPass is observed. Pure.
 *
 * Contract (consumer: Claude Control): result.json `checks[]` items gain optional `field`, `tool`,
 * `scope` and `input`. Additive: results without them load as before.
 */
import { enumOf, type Schema } from "../contracts/schemaDsl";

export const RESULT_FIELDS = ["cli-exit", "ci", "deployed", "runtime", "scientific-validity"] as const;
export type ResultField = typeof RESULT_FIELDS[number];
export const RESULT_FIELD_LABELS: Readonly<Record<ResultField, string>> = {
  "cli-exit": "CLI exit", "ci": "CI", "deployed": "deployed", "runtime": "runtime success", "scientific-validity": "scientific validity"
};

const S = (maxLength: number): Schema => ({ type: "string", minLength: 1, maxLength });
/** The optional fields a result check may carry (spread into the result schema's check object). */
export const RECEIPT_CHECK_FIELDS: Record<string, Schema> = {
  field: enumOf(...RESULT_FIELDS), tool: S(80), scope: S(300), input: S(300)
};

export interface ReceiptCheck {
  what: string;
  outcome: "passed" | "failed" | "not-run";
  note?: string;
  /** Which result field this check speaks for. */
  field?: ResultField;
  /** The tool that ran it (pytest, az, fab, dbt…). */
  tool?: string;
  /** What it ran on (a repository path, a workspace, an environment). */
  scope?: string;
  /** The identity of the input (a commit, a file digest, a dataset version). */
  input?: string;
}

/** A check is a receipt only when it names tool, scope, input identity and outcome. */
export const isReceipt = (c: ReceiptCheck): boolean => Boolean(c.tool?.trim() && c.scope?.trim() && c.input?.trim());

export function checkEvidenceText(c: ReceiptCheck): string {
  return isReceipt(c) ? `receipt: ${c.tool} · ${c.scope} · input ${c.input} (the agent's receipt)` : "asserted, not verified";
}

export type FieldState = "observed" | "receipted" | "asserted" | "unknown";
export interface ResultFieldView { field: ResultField; label: string; state: FieldState; outcome?: "passed" | "failed" | "not-run" | "mixed"; text: string }

/** CI as DataPass read it from the host for the order's pull requests (open PRs only). */
export type ObservedCi = { passing: number; failing: number; running: number; unknown: number };

/**
 * One view per result field. CI read from the host wins over what the agent says about CI; every
 * other field is at best the agent's receipt, and without a receipt it is an assertion.
 */
export function resultFields(checks: readonly ReceiptCheck[] | undefined, ci?: ObservedCi): ResultFieldView[] {
  return RESULT_FIELDS.map((field): ResultFieldView => {
    const label = RESULT_FIELD_LABELS[field];
    if (field === "ci" && ci && ci.passing + ci.failing + ci.running > 0) {
      const outcome = ci.failing ? "failed" : ci.running ? "not-run" : "passed";
      return { field, label, state: "observed", outcome, text: `${label}: ${ci.failing ? `${ci.failing} failing` : ci.running ? "running" : "green"} — observed on the Git host` };
    }
    const mine = (checks ?? []).filter(c => c.field === field);
    if (!mine.length) return { field, label, state: "unknown", text: `${label}: unknown — no check speaks for it` };
    const outcomes = new Set(mine.map(c => c.outcome));
    const outcome = outcomes.size > 1 ? "mixed" : mine[0]!.outcome;
    const receipts = mine.filter(isReceipt);
    if (receipts.length === mine.length) return { field, label, state: "receipted", outcome, text: `${label}: ${outcome} — the agent's receipt (${receipts.map(c => c.tool).join(", ")})` };
    return { field, label, state: "asserted", outcome, text: `${label}: ${outcome} — asserted, not verified${receipts.length ? ` (${receipts.length} of ${mine.length} with a receipt)` : ""}` };
  });
}
