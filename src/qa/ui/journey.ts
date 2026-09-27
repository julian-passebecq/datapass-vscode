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
import { FEATURES, OPEN_FILE_PATTERN, QA_REPORT_FORMAT, QaFormatError, SCREEN_PATTERN, type Feature, type Purpose } from "../formats";

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
  // V1-AUTO-2: only the primitives the release journeys R01–R05 and the client journeys J01–J12 need.
  | { kind: "type"; text: string }                 // keystrokes into what has the focus (an input box, the editor)
  | { kind: "quickPick"; text: string }            // filter the open quick pick by `text`, pick the first row showing it
  | { kind: "expectAbsent"; text: string; timeoutMs: number } // still not shown after `timeoutMs`
  | { kind: "wait"; ms: number }
  | { kind: "commandPaletteSearch"; query: string } // the Command Palette with ">query", left open for expect/expectAbsent
  | { kind: "settingsSearch"; query: string }      // the Settings editor, searched for `query`
  | { kind: "openFile"; path: string }             // Quick Open (Go to File) on a workspace-relative path
  | { kind: "chooseFolder"; folder: (typeof FOLDER_TOKENS)[number] } // the next folder dialog answers this run-root folder
  | { kind: "invalid"; problem: string; raw: string };

/** Where `chooseFolder` points the next folder dialog: the journey's own scratch or fixture folder of the run root. */
export const FOLDER_TOKENS = ["scratch", "fixture"] as const;
/** Settle time before an `expectAbsent` is judged: it passes only if the text stays absent that long. */
export const DEFAULT_ABSENT_MS = 3_000;
export const MAX_WAIT_MS = 120_000;

/** V1-AUTO-2: how the journey's VS Code is launched (a test-journey's setup). Default: trusted, the client workspace. */
export interface UiLaunch { trust?: "trusted" | "restricted"; open?: "workspace" | "fixture" | "empty"; fixture?: string }
export interface UiJourney { id: string; title: string; client?: string; features: Feature[]; launch?: UiLaunch; from?: string; steps: UiStep[] }

export type StepStatus = "PASS" | "FAIL" | "NOT_RUN";
export interface StepResult { status: StepStatus; detail?: string; screen?: string }

const SEGMENT = "[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}";
const HEADER_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: { const: UI_JOURNEY_FORMAT }, version: { const: 1 },
  id: { type: "string", pattern: "^[A-Z][A-Z0-9-]{1,19}$" },
  title: { type: "string", minLength: 1, maxLength: 160 },
  client: { type: "string", pattern: "^[a-z][a-z0-9-]{0,79}$" },
  features: arr(enumOf(...FEATURES), 20, 1),
  launch: obj({ trust: enumOf("trusted", "restricted"), open: enumOf("workspace", "fixture", "empty"), fixture: { type: "string", pattern: `^${SEGMENT}(/${SEGMENT}){0,11}$` } }, []),
  /** The test-journey this file was compiled from (qa:compile), for the record. */
  from: { type: "string", minLength: 1, maxLength: 400 }
}, ["format", "version", "id", "title", "features"]);

const SCREEN_NAME = /^[a-z0-9][a-z0-9-]{0,59}$/;
const KEY = /^[A-Za-z0-9]+(\+[A-Za-z0-9]+){0,3}$/;
export const ACTIONS = ["run", "openView", "click", "expect", "press", "screenshot", "type", "quickPick", "expectAbsent", "wait", "commandPaletteSearch", "settingsSearch", "openFile", "chooseFolder"] as const;
/** The steps that check something: a compiled journey needs at least one to be a test (qa:compile). */
export const ASSERTIONS: ReadonlyArray<UiStep["kind"]> = ["expect", "expectAbsent"];
const MODIFIERS: Record<string, readonly string[]> = { click: ["role"], expect: ["timeoutMs"], expectAbsent: ["timeoutMs"] };
const REL_FILE = new RegExp(OPEN_FILE_PATTERN);

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
  if (action === "wait") {
    const ms = o.wait;
    return Number.isInteger(ms) && (ms as number) >= 100 && (ms as number) <= MAX_WAIT_MS ? { kind: "wait", ms: ms as number } : invalid(`wait takes a number of milliseconds from 100 to ${MAX_WAIT_MS}`);
  }
  const value = text(o[action]);
  if (action !== "screenshot" && !value) return invalid(`missing selector: ${action} needs a non-empty text of at most 200 characters`);
  const timeout = (fallback: number): number | string => {
    const t = o.timeoutMs;
    if (t === undefined) return fallback;
    return Number.isInteger(t) && (t as number) >= 100 && (t as number) <= 120_000 ? (t as number) : "timeoutMs must be an integer from 100 to 120000";
  };
  switch (action) {
    case "run": return { kind: "run", label: value! };
    case "openView": return { kind: "openView", name: value! };
    case "click": {
      if (o.role !== undefined && !(UI_ROLES as readonly unknown[]).includes(o.role)) return invalid(`role must be one of ${UI_ROLES.join(", ")}`);
      return { kind: "click", text: value!, ...(o.role ? { role: o.role as (typeof UI_ROLES)[number] } : {}) };
    }
    case "expect": case "expectAbsent": {
      const t = timeout(action === "expect" ? DEFAULT_STEP_TIMEOUT_MS : DEFAULT_ABSENT_MS);
      return typeof t === "string" ? invalid(t) : { kind: action, text: value!, timeoutMs: t };
    }
    case "press": return KEY.test(value!) ? { kind: "press", key: value! } : invalid("press takes a key such as Escape, Enter or Control+Shift+P");
    case "type": return { kind: "type", text: value! };
    case "quickPick": return { kind: "quickPick", text: value! };
    case "commandPaletteSearch": return { kind: "commandPaletteSearch", query: value! };
    case "settingsSearch": return { kind: "settingsSearch", query: value! };
    case "openFile": return REL_FILE.test(value!) ? { kind: "openFile", path: value! } : invalid("openFile takes a workspace-relative path with / (no .., no drive)");
    case "chooseFolder": return (FOLDER_TOKENS as readonly string[]).includes(value!) ? { kind: "chooseFolder", folder: value as (typeof FOLDER_TOKENS)[number] } : invalid(`chooseFolder takes ${FOLDER_TOKENS.join(" or ")} (a folder of the run root made for this journey)`);
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
  const launch = d.launch as UiLaunch | undefined;
  if (launch?.open === "fixture" && !launch.fixture) throw new QaFormatError(file, ["$.launch.open \"fixture\" needs $.launch.fixture"]);
  if (launch?.fixture !== undefined && launch.open !== "fixture") throw new QaFormatError(file, ["$.launch.fixture is used only with $.launch.open \"fixture\""]);
  return {
    id: d.id as string, title: d.title as string, ...(d.client ? { client: d.client as string } : {}), features: d.features as Feature[],
    ...(launch && Object.keys(launch).length ? { launch } : {}), ...(typeof d.from === "string" ? { from: d.from } : {}),
    steps: (steps as unknown[]).map(parseStep)
  };
}

export function describeStep(step: UiStep): string {
  switch (step.kind) {
    case "run": return `run "${step.label}"`;
    case "openView": return `open view "${step.name}"`;
    case "click": return `click ${step.role ?? "text"} "${step.text}"`;
    case "expect": return `expect "${step.text}"`;
    case "press": return `press ${step.key}`;
    case "screenshot": return `screenshot ${step.name}`;
    case "type": return `type "${step.text}"`;
    case "quickPick": return `pick "${step.text}"`;
    case "expectAbsent": return `expect no "${step.text}"`;
    case "wait": return `wait ${step.ms} ms`;
    case "commandPaletteSearch": return `search the Command Palette for "${step.query}"`;
    case "settingsSearch": return `search Settings for "${step.query}"`;
    case "openFile": return `open file ${step.path}`;
    case "chooseFolder": return `answer the next folder dialog with the ${step.folder} folder`;
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
  const expected = journey.steps.flatMap((s, i) => (s.kind === "expect" || s.kind === "expectAbsent" ? [{ text: clip(`"${s.text}" is ${s.kind === "expect" ? "shown" : "not shown"}`, 500), met: at(i).status === "PASS" ? true : at(i).status === "FAIL" ? false : "unclear" as const }] : [])).slice(0, 20);
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
    runPaths: { qaUi: input.blocked ? "failed" : "ran", computerUse: "not-run" },
    coverage: { listed: journey.features, reached: outcome === "reached" ? journey.features : [] }
  };
}

/**
 * V1-AUTO-2: one report for a whole run — the single-journey reports of qa:ui in order, then each
 * journey that could not be compiled as "blocked" with "not automatable: <reason>" (never a pass).
 * Findings are renumbered F1…; coverage is the union.
 */
export function mergeUiReports(run: RunInfo, reports: ReadonlyArray<Record<string, unknown>>, notAutomatable: ReadonlyArray<{ id: string; title: string; features: readonly string[]; reason: string }>, driver: string, now = new Date()): Record<string, unknown> {
  type J = { id: string; outcome: string };
  const journeys: Array<Record<string, unknown>> = reports.flatMap(r => r.journeys as Array<Record<string, unknown>>);
  for (const n of notAutomatable) journeys.push({ id: n.id, outcome: "blocked", minutes: 0, path: [clip(n.reason.startsWith("not automatable") ? n.reason : `not automatable: ${n.reason}`, 300)], expected: [], screens: [] });
  const findings = reports.flatMap(r => r.findings as Array<Record<string, unknown>>).map((f, i) => ({ ...f, id: `F${i + 1}` })).slice(0, 200);
  const listed = new Set<string>();
  const reached = new Set<string>();
  for (const r of reports) {
    const c = r.coverage as { listed: string[]; reached: string[] };
    c.listed.forEach(f => listed.add(f));
    c.reached.forEach(f => reached.add(f));
  }
  for (const n of notAutomatable) n.features.forEach(f => listed.add(f));
  const times = reports.flatMap(r => [r.startedAt as string, r.finishedAt as string]).sort();
  const order = FEATURES as readonly string[];
  const byOrder = (s: Set<string>) => order.filter(f => s.has(f));
  return {
    format: QA_REPORT_FORMAT, version: 1,
    purpose: run.purpose, runId: run.runId,
    datapass: { version: run.datapass.version, sha256: run.datapass.sha256, ...(run.datapass.commit ? { commit: run.datapass.commit } : {}) },
    vscode: run.vscode, os: run.os,
    clients: run.clients.map(c => ({ id: c.id, title: c.title, bridge: c.bridge, repositories: c.repositories })),
    agent: { tool: "qa-ui", model: clip(driver, 80), host: "playwright" },
    startedAt: times[0] ?? now.toISOString(), finishedAt: times.at(-1) ?? now.toISOString(),
    journeys: journeys.slice(0, 50), findings, answers: [],
    runPaths: { qaUi: (journeys as unknown as J[]).some(j => j.outcome === "blocked" && !notAutomatable.some(n => n.id === j.id)) ? "failed" : "ran", computerUse: "not-run" },
    coverage: { listed: byOrder(listed), reached: byOrder(reached) }
  };
}
