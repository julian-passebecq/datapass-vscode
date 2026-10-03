/**
 * V5 PEDA2: "Ask the AI for model answers" — exchange kind `peda-model-answers` (go/TOUR-PEDA-contract.md § 7).
 * DataPass builds a request the person copies to their own AI (no hidden AI call, ever): the notion, its interview
 * questions and the project spans' paths (never code or data), plus the active tour's `generation`. The answer they
 * paste back is stamped `ai-proposed` whatever it claims; answers to questions that were not asked are dropped.
 * Pure (no `vscode`).
 */
import { sha256Bytes } from "../model/ids";
import { parseStrictJson } from "../model/strictJson";
import type { NotionPrep } from "./rank";
import type { TourGeneration } from "./tourShape";

export const MODEL_ANSWERS_KIND = "peda-model-answers";
export const MODEL_ANSWERS_REQUEST_FORMAT = "datapass.peda-model-answers.request/1";
export const MODEL_ANSWERS_ANSWER_FORMAT = "datapass.peda-model-answers/1";
export const MAX_ANSWER_CHARS = 2000;

export interface ModelAnswersRequest { readonly text: string; readonly digest: string; readonly asked: ReadonlyMap<string, readonly string[]> }

export function modelAnswersRequest(preps: readonly NotionPrep[], generation?: TourGeneration): ModelAnswersRequest {
  const notions = preps.map(p => ({ ref: p.ref, title: p.title, questions: [...p.questions],
    whereInProject: p.where.map(w => `${w.repositoryKey ? `${w.repositoryKey}/` : ""}${w.path}:${w.startLine}-${w.endLine}`) }));
  const body = {
    format: MODEL_ANSWERS_REQUEST_FORMAT, kind: MODEL_ANSWERS_KIND, notions,
    ...(generation && (generation.include?.length || generation.exclude?.length) ? { generation } : {}),
    answerShape: { format: MODEL_ANSWERS_ANSWER_FORMAT, answers: [{ ref: "<notion ref>", question: "<question, verbatim>", answer: "<model answer>" }] }
  };
  const json = JSON.stringify(body, null, 2);
  const digest = sha256Bytes(json).value;
  const text = [
    "DataPass asks for model interview answers about the data-engineering notions this project uses.",
    "For each question, give a concise answer a senior data engineer would give, citing the project location when it helps.",
    `Answer with JSON only, in the answerShape below (questions verbatim, at most ${MAX_ANSWER_CHARS} characters each, plus "request": the digest).`,
    `Request digest: ${digest}`,
    "",
    json
  ].join("\n");
  return { text, digest, asked: new Map(preps.map(p => [p.ref, p.questions])) };
}

export interface ModelAnswer { readonly ref: string; readonly question: string; readonly answer: string; readonly origin: "ai-proposed" }
export type ModelAnswersRead =
  | { readonly ok: true; readonly answers: readonly ModelAnswer[]; readonly dropped: number; readonly requestDigest: string }
  | { readonly ok: false; readonly reason: string };

function jsonObjectOf(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const s = (fenced ? fenced[1]! : text).trim();
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : undefined;
}

/** The pasted answer → ai-proposed model answers for the questions that were asked. */
export function readModelAnswers(text: string, request: Pick<ModelAnswersRequest, "digest" | "asked">): ModelAnswersRead {
  const obj = jsonObjectOf(text);
  if (!obj) return { ok: false, reason: "No JSON object in the pasted answer." };
  let raw: unknown;
  try { raw = parseStrictJson(obj, { maxBytes: 512 * 1024 }); } catch (e) { return { ok: false, reason: `The answer is not valid JSON: ${(e as Error).message}` }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "The answer is not a JSON object." };
  const r = raw as Record<string, unknown>;
  if (r.format !== MODEL_ANSWERS_ANSWER_FORMAT) return { ok: false, reason: `The answer's format is not ${MODEL_ANSWERS_ANSWER_FORMAT}.` };
  if (r.request !== undefined && r.request !== request.digest) return { ok: false, reason: "The answer was made for another request (digest differs)." };
  if (!Array.isArray(r.answers)) return { ok: false, reason: "The answer needs an `answers` array." };
  const answers: ModelAnswer[] = [];
  let dropped = 0;
  for (const a of r.answers as unknown[]) {
    const x = a && typeof a === "object" ? a as Record<string, unknown> : {};
    const ok = typeof x.ref === "string" && typeof x.question === "string" && typeof x.answer === "string" && x.answer.trim()
      && (request.asked.get(x.ref) ?? []).includes(x.question);
    if (!ok) { dropped++; continue; }
    answers.push({ ref: x.ref as string, question: x.question as string, answer: (x.answer as string).trim().slice(0, MAX_ANSWER_CHARS), origin: "ai-proposed" });
  }
  return { ok: true, answers, dropped, requestDigest: request.digest };
}
