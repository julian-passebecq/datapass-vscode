/**
 * Pilot stage 1 (AI-4a), channel 2 (handoff/v3/09 §3.3, §4.6, §8.8): the agent writes
 * `requests/<n>.json` to ask for a VS Code action; DataPass shows it as a card, runs the existing
 * read-only DataPass capability on the person's click, and writes `responses/<n>.json`. Pure.
 *
 * A request is untrusted input: strict JSON, at most 4 KiB, unknown fields refused, the order id
 * and receipt must match, n in 1…50 equal to its file name, no gap, no second request for the same
 * action. The capability must exist, be of phase `read`, have side effects within {reads-local,
 * reads-remote, credential-prompt}, an action mode `open-native` or `run-readonly`, and be one
 * DataPass implements; the component must exist and the environment must be the order's (dev).
 */
import { constOf, enumOf, obj, validateSchema, type Schema } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import type { CapabilityRecord, SideEffect } from "../capabilities/registry";
import type { WorkOrder } from "../workOrders/format";

export const REQUEST_FORMAT = "datapass.pilot-request";
export const RESPONSE_FORMAT = "datapass.pilot-response";
export const PILOT_FORMAT_VERSION = "1";
export const MAX_REQUESTS = 50;
export const MAX_REQUEST_BYTES = 4 * 1024;
export const REQUESTS_DIR = "requests";
export const RESPONSES_DIR = "responses";
export const REQUEST_FILE_RE = /^([1-9]\d{0,2})\.json$/;

export const ALLOWED_SIDE_EFFECTS: readonly SideEffect[] = ["reads-local", "reads-remote", "credential-prompt"];
export const ALLOWED_ACTION_MODES = ["open-native", "run-readonly"] as const;
/** Phase read, but out of stage 1 (09 §3.3, §9): a remote shell cannot be held to read-only. */
export const EXCLUDED_CAPABILITIES: Readonly<Record<string, string>> = { "infra.remote.ssh": "a remote shell cannot be held to read-only" };

const S = (max: number, min = 1, pattern?: string): Schema => ({ type: "string", minLength: min, maxLength: max, ...(pattern ? { pattern } : {}) });
const REF = S(100, 1, "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$");

export const PILOT_REQUEST_SCHEMA: Schema = obj({
  format: constOf(REQUEST_FORMAT), version: constOf(PILOT_FORMAT_VERSION),
  orderId: S(21, 21, "^wo-\\d{8}-\\d{4}-[0-9a-z]{4}$"), receipt: S(9, 9, "^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$"),
  n: { type: "integer", minimum: 1, maximum: 1000 },
  action: obj({ capability: S(100, 1, "^[a-z0-9][a-z0-9.-]{0,99}$"), component: REF, environment: REF }),
  why: S(1000)
}, ["format", "version", "orderId", "receipt", "n", "action"]);

export const PILOT_RESPONSE_SCHEMA: Schema = obj({
  format: constOf(RESPONSE_FORMAT), version: constOf(PILOT_FORMAT_VERSION),
  orderId: S(21, 21), n: { type: "integer", minimum: 1, maximum: MAX_REQUESTS },
  outcome: enumOf("done", "declined", "failed"), what: S(500), at: { type: "string", format: "date-time" }
});

export interface PilotRequest {
  format: typeof REQUEST_FORMAT;
  version: typeof PILOT_FORMAT_VERSION;
  orderId: string;
  receipt: string;
  n: number;
  action: { capability: string; component: string; environment: string };
  why?: string;
}

export interface PilotResponse {
  format: typeof RESPONSE_FORMAT;
  version: typeof PILOT_FORMAT_VERSION;
  orderId: string;
  n: number;
  outcome: "done" | "declined" | "failed";
  what: string;
  at: string;
}

export interface RequestContext {
  order: WorkOrder;
  capabilities: ReadonlyMap<string, CapabilityRecord>;
  components: readonly string[];
  environments: ReadonlyArray<{ id: string; production?: boolean }>;
  /** Numbers of the other request files of this order (for the gap check). */
  numbers: readonly number[];
  /** Earlier valid requests of this order (n < this one's), for the duplicate check. */
  earlier: readonly PilotRequest[];
  /** Numbers already answered (responses/<n>.json exists). */
  answered: readonly number[];
}

export type RequestVerdict =
  | { ok: true; request: PilotRequest; capability: CapabilityRecord }
  | { ok: false; why: RefusalWhy; message: string; n?: number };
export type RefusalWhy = "excluded" | "oversize" | "invalid" | "other-order" | "number" | "gap" | "duplicate" | "too-many" | "unknown-capability" | "not-read" | "side-effects" | "action-mode" | "not-implemented" | "component" | "environment";

/** The request number a file name carries (`3.json` → 3), or undefined. */
export function requestNumber(fileName: string): number | undefined {
  const m = REQUEST_FILE_RE.exec(fileName);
  return m ? Number(m[1]) : undefined;
}

export function checkRequest(raw: string | Uint8Array, fileName: string, c: RequestContext): RequestVerdict {
  const size = typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.length;
  const fileN = requestNumber(fileName);
  const no = (why: RefusalWhy, message: string): RequestVerdict => ({ ok: false, why, message, ...(fileN !== undefined ? { n: fileN } : {}) });
  if (size > MAX_REQUEST_BYTES) return no("oversize", `requests/${fileName} is larger than ${MAX_REQUEST_BYTES / 1024} KiB`);
  if (fileN === undefined) return no("number", `requests/${fileName}: the file name must be <n>.json`);
  if (fileN > MAX_REQUESTS) return no("too-many", `request ${fileN}: at most ${MAX_REQUESTS} requests per order`);
  let doc: unknown;
  try { doc = parseStrictJson(raw, { maxBytes: MAX_REQUEST_BYTES, maxDepth: 4, maxEntries: 50, maxStringLength: 1000 }); } catch (e) {
    return no("invalid", `request ${fileN} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const issues = validateSchema(PILOT_REQUEST_SCHEMA, doc);
  if (issues.length) return no("invalid", `request ${fileN} is invalid: ${issues.slice(0, 3).map(i => `${i.path} ${i.message}`).join("; ")}`);
  const r = doc as PilotRequest;
  if (r.orderId !== c.order.id || r.receipt !== c.order.receipt) return no("other-order", `request ${fileN} was written for another order`);
  if (r.n !== fileN) return no("number", `request ${fileN} says n = ${r.n}`);
  if (c.answered.includes(r.n) ) return no("duplicate", `request ${r.n} was already answered: use the next number`);
  for (let k = 1; k < r.n; k++) if (!c.numbers.includes(k)) return no("gap", `request ${r.n} comes before request ${k}`);
  const same = c.earlier.find(e => e.n < r.n && e.action.capability === r.action.capability && e.action.component === r.action.component && e.action.environment === r.action.environment);
  if (same) return no("duplicate", `request ${r.n} asks for the same action as request ${same.n}`);
  const cap = c.capabilities.get(r.action.capability);
  if (!cap) return no("unknown-capability", `request ${r.n}: DataPass has no capability "${r.action.capability}"`);
  const excluded = EXCLUDED_CAPABILITIES[cap.id];
  if (excluded) return no("excluded", `request ${r.n}: ${cap.id} stays out of pilot stage 1 (${excluded})`);
  if (cap.phase !== "read") return no("not-read", `request ${r.n}: ${cap.id} is a ${cap.phase} step; pilot stage 1 only reads`);
  const extra = cap.sideEffects.filter(s => !ALLOWED_SIDE_EFFECTS.includes(s));
  if (extra.length) return no("side-effects", `request ${r.n}: ${cap.id} ${extra.join(", ")}; pilot stage 1 only reads`);
  if (!(ALLOWED_ACTION_MODES as readonly string[]).includes(cap.actionMode)) return no("action-mode", `request ${r.n}: ${cap.id} is ${cap.actionMode}, not an action DataPass opens or runs read-only`);
  if (cap.implementation !== "implemented" || !cap.datapassActionId) return no("not-implemented", `request ${r.n}: DataPass cannot run ${cap.id} itself`);
  if (!c.components.includes(r.action.component)) return no("component", `request ${r.n}: component "${r.action.component}" is not in this project`);
  const env = c.environments.find(e => e.id === r.action.environment);
  if (!env) return no("environment", `request ${r.n}: environment "${r.action.environment}" is not in this project`);
  if (r.action.environment !== c.order.pilot?.environment || r.action.environment !== "dev" || env.production) return no("environment", `request ${r.n}: pilot stage 1 works on dev only, not "${r.action.environment}"`);
  return { ok: true, request: r, capability: cap };
}

/** The response DataPass writes: names and states only. */
export function pilotResponse(order: Pick<WorkOrder, "id">, n: number, outcome: PilotResponse["outcome"], what: string, at: string): PilotResponse {
  const text = what.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || outcome;
  return { format: RESPONSE_FORMAT, version: PILOT_FORMAT_VERSION, orderId: order.id, n, outcome, what: text, at };
}

/** Plain words for a capability's side effects on a card. */
export function sideEffectText(effects: readonly SideEffect[]): string {
  const words: Partial<Record<SideEffect, string>> = { "reads-local": "reads local files", "reads-remote": "reads remote", "credential-prompt": "may ask you to sign in" };
  return effects.map(e => words[e] ?? e).join(" · ");
}
