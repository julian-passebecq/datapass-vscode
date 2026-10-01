/**
 * V5 PQSAMP1: the data sample shown under a step of the code-steps view (NAVREN4). Two sources, X-Ray first:
 *  1. Data X-Ray: a read-only DuckDB sample of ONE local data file the person picked (X-Ray's internal
 *     `datapass.dataXray._sample` command, only when X-Ray is installed) → origin `observed`.
 *  2. The manual AI exchange: DataPass builds a request the person copies to their own AI; the answer they
 *     paste back is stamped `ai-proposed` whatever it claims (no hidden AI call, ever).
 * Otherwise the step shows a typed hole. DataPass never executes the step's code (M, SQL, PySpark…).
 *
 * Pure (no `vscode`): raw values in, validated samples out. Labels are data (`DEFAULT_STEP_SAMPLE_LABELS`).
 */
import { sha256Bytes } from "../model/ids";
import { parseStrictJson } from "../model/strictJson";
import { readTable, SAMPLE_MAX_ROWS, STEP_SAMPLE_ANSWER_FORMAT, STEP_SAMPLE_REQUEST_FORMAT, type StepSample } from "./stepSampleModel";

export * from "./stepSampleModel";

/** What the request describes about a step (from the code-steps input; never the client's data). */
export interface StepSampleSubject {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly tables?: readonly { readonly id: string; readonly role: string }[];
  readonly params?: readonly { readonly name: string; readonly value: string }[];
}

export interface StepSampleRequest { readonly text: string; readonly digest: string }

/**
 * Source 2, outgoing: the request the person copies to their own AI. It describes the step only (label,
 * kind, table ids, parameters), never data, and asks for an illustrative sample in a fixed JSON shape.
 */
export function stepSampleRequest(step: StepSampleSubject): StepSampleRequest {
  const body = {
    format: STEP_SAMPLE_REQUEST_FORMAT,
    stepId: step.id,
    step: { label: step.label, kind: step.kind, tables: (step.tables ?? []).map(t => `${t.role} ${t.id}`), params: (step.params ?? []).map(p => `${p.name}: ${p.value}`) },
    answerShape: { format: STEP_SAMPLE_ANSWER_FORMAT, stepId: step.id, columns: ["<column>"], rows: [["<value>"]] }
  };
  const json = JSON.stringify(body, null, 2);
  const digest = sha256Bytes(json).value;
  const text = [
    "DataPass asks for an illustrative data sample for one step of a data pipeline.",
    `Propose at most ${SAMPLE_MAX_ROWS} plausible rows of what the step's output looks like. You have not seen the real data: say nothing else.`,
    "Answer with JSON only, in the answerShape below (same stepId, plus \"request\": the digest).",
    `Request digest: ${digest}`,
    "",
    json
  ].join("\n");
  return { text, digest };
}

export type AiSampleRead = { readonly ok: true; readonly sample: StepSample } | { readonly ok: false; readonly reason: string };

/** The first JSON object of a pasted answer (AIs often wrap it in a ``` fence). */
function jsonObjectOf(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const s = (fenced ? fenced[1]! : text).trim();
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : undefined;
}

/**
 * Source 2, incoming: the answer the person pasted back. It must name the same step (and, when it
 * carries one, the same request digest). The origin is always `ai-proposed`: an answer claiming
 * `observed` is not believed.
 */
export function readAiSampleAnswer(text: string, request: { stepId: string; digest: string }): AiSampleRead {
  const obj = jsonObjectOf(text);
  if (!obj) return { ok: false, reason: "No JSON object in the pasted answer." };
  let raw: unknown;
  try { raw = parseStrictJson(obj, { maxBytes: 512 * 1024 }); } catch (e) { return { ok: false, reason: `The answer is not valid JSON: ${(e as Error).message}` }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "The answer is not a JSON object." };
  const r = raw as Record<string, unknown>;
  if (r.format !== STEP_SAMPLE_ANSWER_FORMAT) return { ok: false, reason: `The answer's format is not ${STEP_SAMPLE_ANSWER_FORMAT}.` };
  if (r.stepId !== request.stepId) return { ok: false, reason: `The answer is for step ${String(r.stepId)}, not ${request.stepId}.` };
  if (r.request !== undefined && r.request !== request.digest) return { ok: false, reason: "The answer was made for another request (digest differs)." };
  const t = readTable(r);
  if (!t) return { ok: false, reason: "The answer needs columns (strings) and rows (arrays of plain values)." };
  return { ok: true, sample: { state: "sample", source: "exchange", origin: "ai-proposed", requestDigest: request.digest, ...t } };
}

