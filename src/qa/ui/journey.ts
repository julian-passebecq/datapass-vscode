/**
 * QA-4: UI journeys driven through Playwright `_electron` (`npm run qa:ui`). Pure: no `vscode`, no
 * file system, no Playwright. Codex (or a person) writes a `datapass.ui-journey` file; qa:ui executes
 * its steps in the isolated VS Code that qa:prepare set up, and this module turns the step outcomes
 * into a `datapass.qa-report` (QA-1's format and validator).
 *
 *   datapass.ui-journey  1   <journey>.json   ordered UI steps in a small closed vocabulary
 *
 * The journey is untrusted data. Its header is strict (a bad header refuses the whole file); a step
 * that is not understood (unknown kind, missing selector) is kept and reported NOT_RUN, never PASS.
 */
import { arr, enumOf, obj, validateSchema, type Schema } from "../../core/contracts/schemaDsl";
import { parseStrictJson, StrictJsonError } from "../../core/model/strictJson";
import { FEATURES, QA_REPORT_FORMAT, QaFormatError, SCREEN_PATTERN, type Feature, type Purpose } from "../formats";

export const UI_JOURNEY_FORMAT = "datapass.ui-journey";
export const MAX_UI_STEPS = 40;
export const DEFAULT_STEP_TIMEOUT_MS = 15_000;
export const UI_ROLES = ["button", "link", "tab", "treeitem", "menuitem", "checkbox", "option"] as const;

export type UiStep =
  | { kind: "run"; label: string }                 // a Command Palette entry, by its label
  | { kind: "openView"; name: string }             // View: Open View…, by the view's name
  | { kind: "click"; text: string; role?: (typeof UI_ROLES)[number] }
  | { kind: "expect"; text: string; timeoutMs: number }
  | { kind: "press"; key: string }
  | { kind: "screenshot"; name: string }
  | { kind: "invalid"; problem: string; raw: string };

export interface UiJourney { id: string; title: string; client?: string; features: Feature[]; steps: UiStep[] }

export type StepStatus = "PASS" | "FAIL" | "NOT_RUN";
export interface StepResult { status: StepStatus; detail?: string; screen?: string }

const HEADER_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: { const: UI_JOURNEY_FORMAT }, version: { const: 1 },
  id: { type: "string", pattern: "^[A-Z][A-Z0-9-]{1,19}$" },
  title: { type: "string", minLength: 1, maxLength: 160 },
  client: { type: "string", pattern: "^[a-z][a-z0-9-]{0,79}$" },
  features: arr(enumOf(...FEATURES), 20, 1)
}, ["format", "version", "id", "title", "features"]);

const SCREEN_NAME = /^[a-z0-9][a-z0-9-]{0,59}$/;
const KEY = /^[A-Za-z0-9]+(\+[A-Za-z0-9]+){0,3}$/;
const ACTIONS = ["run", "openView", "click", "expect", "press", "screenshot"] as const;
const MODIFIERS: Record<string, readonly string[]> = { click: ["role"], expect: ["timeoutMs"] };

const text = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
const short = (v: unknown) => { const s = JSON.stringify(v) ?? String(v); return s.length > 120 ? `${s.slice(0, 119)}…` : s; };

/** One step object → a typed step, or an `invalid` step naming the problem (reported NOT_RUN). */
export function parseStep(raw: unknown): UiStep {
  const invalid = (problem: string): UiStep => ({ kind: "invalid", problem, raw: short(raw) });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("a step must be an object");
  const o = raw as Record<string, unknown>;
  const actions = Object.keys(o).filter(k => (ACTIONS as readonly string[]).includes(k));
  if (actions.length !== 1) return invalid(actions.length ? `one action per step, got ${actions.join(" + ")}` : `unknown step (${Object.keys(o).join(", ") || "empty"}): use ${ACTIONS.join(", ")}`);
  const action = actions[0]!;
  const extra = Object.keys(o).filter(k => k !== action && !(MODIFIERS[action] ?? []).includes(k));
  if (extra.length) return invalid(`unknown field(s) ${extra.join(", ")} on a ${action} step`);
  const value = text(o[action]);
  if (action !== "screenshot" && !value) return invalid(`missing selector: ${action} needs a non-empty text of at most 200 characters`);
  switch (action) {
    case "run": return { kind: "run", label: value! };
    case "openView": return { kind: "openView", name: value! };
    case "click": {
      if (o.role !== undefined && !(UI_ROLES as readonly unknown[]).includes(o.role)) return invalid(`role must be one of ${UI_ROLES.join(", ")}`);
      return { kind: "click", text: value!, ...(o.role ? { role: o.role as (typeof UI_ROLES)[number] } : {}) };
    }
    case "expect": {
      const t = o.timeoutMs;
      if (t !== undefined && !(Number.isInteger(t) && (t as number) >= 100 && (t as number) <= 120_000)) return invalid("timeoutMs must be an integer from 100 to 120000");
      return { kind: "expect", text: value!, timeoutMs: (t as number | undefined) ?? DEFAULT_STEP_TIMEOUT_MS };
    }
    case "press": return KEY.test(value!) ? { kind: "press", key: value! } : invalid("press takes a key such as Escape, Enter or Control+Shift+P");
    default: return value && SCREEN_NAME.test(value) ? { kind: "screenshot", name: value } : invalid("missing selector: screenshot needs a name of lowercase letters, digits and dashes");
  }
}

export function parseUiJourney(raw: string | Uint8Array, file: string): UiJourney {
  let doc: unknown;
  try { doc = parseStrictJson(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
  catch (e) { throw new QaFormatError(file, [e instanceof StrictJsonError ? e.message : String(e)]); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new QaFormatError(file, ["not a JSON object"]);
  const d = doc as Record<string, unknown>;
  if (d.format !== UI_JOURNEY_FORMAT) throw new QaFormatError(file, [`format must be "${UI_JOURNEY_FORMAT}"${d.format === "datapass.test-journey" ? " (a test-journey is a goal for Codex; a ui-journey lists UI steps)" : ""}`]);
  // The steps are read one by one (parseStep): a step not understood is reported, it does not refuse the file.
  const { steps, ...header } = d;
  const issues = validateSchema(HEADER_SCHEMA, header).map(i => `${i.path}: ${i.message}`);
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_UI_STEPS) issues.push(`$.steps must be a list of 1 to ${MAX_UI_STEPS} steps`);
  if (Array.isArray(d.features) && new Set(d.features).size !== d.features.length) issues.push("$.features lists a tag twice");
  if (issues.length) throw new QaFormatError(file, issues);
  return { id: d.id as string, title: d.title as string, ...(d.client ? { client: d.client as string } : {}), features: d.features as Feature[], steps: (steps as unknown[]).map(parseStep) };
}

export function describeStep(step: UiStep): string {
  switch (step.kind) {
    case "run": return `run "${step.label}"`;
    case "openView": return `open view "${step.name}"`;
    case "click": return `click ${step.role ?? "text"} "${step.text}"`;
    case "expect": return `expect "${step.text}"`;
    case "press": return `press ${step.key}`;
    case "screenshot": return `screenshot ${step.name}`;
    default: return `unrecognised step ${step.raw}`;
  }
}

/** `screens/<journey id>-<name>.png`, as QA-1's report requires. */
export const screenPath = (journeyId: string, name: string): string => `screens/${journeyId}-${name}.png`;

/** What qa:prepare wrote (run.json) that the report repeats. */
export interface RunInfo {
  purpose: Purpose; runId: string;
  datapass: { version: string; sha256: string; commit?: string };
  vscode: { version: string; commit?: string };
  os: { platform: string; release: string; arch: string };
  clients: Array<{ id: string; title: string; bridge: unknown; repositories: unknown[] }>;
}

export interface UiReportInput {
  run: RunInfo; journey: UiJourney; results: StepResult[];
  startedAt: Date; finishedAt: Date;
  /** The driver's own name and version, e.g. "playwright-core 1.63.0". */
  driver: string;
  /** VS Code could not be started or driven at all: the journey is blocked. */
  blocked?: string;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function journeyOutcome(results: readonly StepResult[], blocked?: string): "reached" | "partly" | "not-reached" | "blocked" {
  if (blocked) return "blocked";
  if (results.some(r => r.status === "FAIL")) return "not-reached";
  if (!results.length || results.some(r => r.status !== "PASS")) return "partly";
  return "reached";
}

/** Step outcomes → a `datapass.qa-report` v1 (validate it with parseQaReport). */
export function buildUiReport(input: UiReportInput): Record<string, unknown> {
  const { run, journey, results } = input;
  const at = (i: number): StepResult => results[i] ?? { status: "NOT_RUN" };
  const lines = journey.steps.map((s, i) => { const r = at(i); return clip(`${i + 1}. ${describeStep(s)} — ${r.status}${r.detail ? `: ${r.detail}` : s.kind === "invalid" ? `: ${s.problem}` : ""}`, 300); });
  const screens = [...new Set(journey.steps.map((_, i) => at(i).screen).filter((s): s is string => !!s && new RegExp(SCREEN_PATTERN).test(s)))].slice(0, 40);
  const outcome = journeyOutcome(journey.steps.map((_, i) => at(i)), input.blocked);
  const expected = journey.steps.flatMap((s, i) => (s.kind === "expect" ? [{ text: clip(`"${s.text}" is shown`, 500), met: at(i).status === "PASS" ? true : at(i).status === "FAIL" ? false : "unclear" as const }] : [])).slice(0, 20);
  const findings: Array<Record<string, unknown>> = [];
  const area = journey.features[0]!;
  if (input.blocked) {
    findings.push({ id: "F1", journey: journey.id, severity: "blocker", area, title: clip(`${journey.id}: VS Code could not be driven`, 160), steps: ["qa:ui launches the isolated VS Code of the run root"], expected: "The isolated VS Code opens the client's workspace.", actual: clip(input.blocked, 1000) });
  } else {
    const failed = journey.steps.findIndex((_, i) => at(i).status === "FAIL");
    if (failed >= 0) {
      const r = at(failed);
      findings.push({ id: "F1", journey: journey.id, severity: "major", area, title: clip(`Step ${failed + 1} failed: ${describeStep(journey.steps[failed]!)}`, 160), steps: lines.slice(0, failed + 1).slice(-30), expected: clip(`${describeStep(journey.steps[failed]!)} succeeds`, 1000), actual: clip(r.detail ?? "failed", 1000), ...(r.screen && new RegExp(SCREEN_PATTERN).test(r.screen) ? { screens: [r.screen] } : {}) });
    }
  }
  const minutes = Math.max(0, Math.min(480, Math.round((input.finishedAt.getTime() - input.startedAt.getTime()) / 60_000)));
  return {
    format: QA_REPORT_FORMAT, version: 1,
    purpose: run.purpose, runId: run.runId,
    datapass: { version: run.datapass.version, sha256: run.datapass.sha256, ...(run.datapass.commit ? { commit: run.datapass.commit } : {}) },
    vscode: run.vscode, os: run.os,
    clients: run.clients.map(c => ({ id: c.id, title: c.title, bridge: c.bridge, repositories: c.repositories })),
    agent: { tool: "qa-ui", model: clip(input.driver, 80), host: "playwright" },
    startedAt: input.startedAt.toISOString(), finishedAt: input.finishedAt.toISOString(),
    journeys: [{ id: journey.id, outcome, minutes, path: lines, expected, screens }],
    findings, answers: [],
    coverage: { listed: journey.features, reached: outcome === "reached" ? journey.features : [] }
  };
}
