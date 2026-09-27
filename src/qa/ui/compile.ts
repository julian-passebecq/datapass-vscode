/**
 * V1-AUTO-2: the journey compiler, `datapass.test-journey` → `datapass.ui-journey`. Pure: no `vscode`,
 * no file system. qa:prepare compiles every journey of a run into `<run root>/ui-journeys/` and qa:ui
 * runs them (the functional release gate; Codex Computer Use is the exploratory pass on top).
 *
 * A test-journey is a goal in the client's words; the compiler never guesses UI steps from that prose.
 * The steps come from the journey's own `ui` field or, failing that, from the vendor's proposal for
 * that client (`qa/ui/<client id>.json`, format `datapass.ui-steps`: DataPass's steps for a client
 * journey, which the client's AI may copy into the journey). The launch comes from `setup` (trust,
 * open, fixture) and `setup.mode` becomes two leading steps (Switch Mode…, then the mode).
 *
 * A journey without steps, with a step outside the vocabulary, or without any check (expect /
 * expectAbsent) is reported "not automatable" with the reason: never compiled into a silent pass.
 */
import { parseStrictJson, StrictJsonError } from "../../core/model/strictJson";
import { QaFormatError, type TestJourney } from "../formats";
import { ASSERTIONS, describeStep, MAX_UI_STEPS, parseStep, UI_JOURNEY_FORMAT, type UiLaunch, type UiStep } from "./journey";

export const UI_STEPS_FORMAT = "datapass.ui-steps";
/** The label of the mode picker and its rows (the presets of src/core/experience). */
export const SWITCH_MODE_LABEL = "DataPass: Switch Mode…";
/** The views a mode shows or hides settle before the journey's own steps. */
export const MODE_SETTLE_MS = 6_000;

/** One journey of a `datapass.ui-steps` file: its steps, or why it cannot be driven through the UI. */
export interface UiStepsEntry { id: string; ui?: unknown[]; notAutomatable?: string }
export interface UiStepsFile { client: string; journeys: UiStepsEntry[] }

export type CompileResult =
  | { id: string; title: string; ok: true; stepsFrom: "journey" | "vendor"; journey: Record<string, unknown>; notes: string[] }
  | { id: string; title: string; ok: false; reason: string };

const ID = /^[A-Z][A-Z0-9-]{1,19}$/;
const CLIENT = /^[a-z][a-z0-9-]{0,79}$/;

/** Read a `datapass.ui-steps` file (untrusted data: strict JSON, closed shape; the steps are checked at compile time). */
export function parseUiSteps(raw: string | Uint8Array, file: string): UiStepsFile {
  let doc: unknown;
  try { doc = parseStrictJson(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); }
  catch (e) { throw new QaFormatError(file, [e instanceof StrictJsonError ? e.message : String(e)]); }
  const issues: string[] = [];
  const d = (doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {}) as Record<string, unknown>;
  if (d.format !== UI_STEPS_FORMAT) issues.push(`format must be "${UI_STEPS_FORMAT}"`);
  if (d.version !== 1) issues.push("version must be 1");
  if (typeof d.client !== "string" || !CLIENT.test(d.client)) issues.push("$.client must be a client id");
  const extra = Object.keys(d).filter(k => !["$schema", "format", "version", "client", "journeys"].includes(k));
  if (extra.length) issues.push(`unknown field(s) ${extra.join(", ")}`);
  const journeys = Array.isArray(d.journeys) ? d.journeys : (issues.push("$.journeys must be a list"), []);
  const seen = new Set<string>();
  journeys.forEach((j, i) => {
    const e = (j && typeof j === "object" && !Array.isArray(j) ? j : {}) as Record<string, unknown>;
    if (typeof e.id !== "string" || !ID.test(e.id)) issues.push(`$.journeys[${i}].id must be a journey id`);
    else if (seen.has(e.id)) issues.push(`$.journeys[${i}].id ${e.id} appears twice`); else seen.add(e.id);
    const keys = Object.keys(e).filter(k => k !== "id");
    if (keys.some(k => k !== "ui" && k !== "notAutomatable")) issues.push(`$.journeys[${i}]: only id, ui and notAutomatable`);
    if ((e.ui === undefined) === (e.notAutomatable === undefined)) issues.push(`$.journeys[${i}]: exactly one of ui or notAutomatable`);
    if (e.ui !== undefined && !Array.isArray(e.ui)) issues.push(`$.journeys[${i}].ui must be a list of steps`);
    if (e.notAutomatable !== undefined && (typeof e.notAutomatable !== "string" || !e.notAutomatable.trim() || e.notAutomatable.length > 300)) issues.push(`$.journeys[${i}].notAutomatable must be a reason of at most 300 characters`);
  });
  if (issues.length) throw new QaFormatError(file, issues);
  return { client: d.client as string, journeys: journeys as UiStepsEntry[] };
}

function launchOf(setup: TestJourney["setup"]): UiLaunch | undefined {
  const s = setup ?? {};
  const l: UiLaunch = {
    ...(s.trust ? { trust: s.trust } : {}),
    ...(s.open ? { open: s.open } : {}),
    ...(s.open === "fixture" && s.fixture ? { fixture: s.fixture } : {})
  };
  return Object.keys(l).length ? l : undefined;
}

/**
 * Compile one test-journey. `vendor` is the proposal of the vendor's `datapass.ui-steps` file for this
 * journey, used only when the journey carries neither `ui` nor `notAutomatable`.
 */
export function compileJourney(j: TestJourney, opts: { file?: string; vendor?: UiStepsEntry } = {}): CompileResult {
  const base = { id: j.id, title: j.title };
  const notAutomatable = j.notAutomatable ?? (j.ui ? undefined : opts.vendor?.notAutomatable);
  if (notAutomatable !== undefined) return { ...base, ok: false, reason: `not automatable: ${notAutomatable}` };
  const stepsFrom = j.ui ? "journey" : opts.vendor?.ui ? "vendor" : undefined;
  const raw = j.ui ?? opts.vendor?.ui;
  if (!stepsFrom || !raw) return { ...base, ok: false, reason: "not automatable: the journey has no ui steps and DataPass has none for it (qa/ui/<client>.json)" };

  const own = raw.map(parseStep);
  const bad = own.findIndex(s => s.kind === "invalid");
  if (bad >= 0) return { ...base, ok: false, reason: `not automatable: ${stepsFrom} ui step ${bad + 1}: ${(own[bad] as { problem: string }).problem}` };
  if (!own.some(s => ASSERTIONS.includes(s.kind))) return { ...base, ok: false, reason: `not automatable: the ${stepsFrom} ui steps check nothing (no expect or expectAbsent)` };

  const launch = launchOf(j.setup);
  if (own.some(s => s.kind === "chooseFolder" && s.folder === "fixture") && launch?.open !== "fixture") return { ...base, ok: false, reason: "not automatable: chooseFolder fixture needs setup.open \"fixture\"" };
  if (own.some(s => s.kind === "chooseFolder" && s.folder === "scratch") && launch?.open !== "empty") return { ...base, ok: false, reason: "not automatable: chooseFolder scratch needs setup.open \"empty\" (the scratch folder)" };

  const notes: string[] = [];
  const setupSteps: Array<Record<string, unknown>> = [];
  if (j.setup?.mode) setupSteps.push({ run: SWITCH_MODE_LABEL }, { quickPick: j.setup.mode }, { wait: MODE_SETTLE_MS });
  // A scenario id is not the label its picker shows: the steps select a variant themselves when it matters.
  if (j.setup?.variant) notes.push(`setup.variant ${j.setup.variant} is left to the steps`);
  if (j.setup?.environment) notes.push(`setup.environment ${j.setup.environment} is not applied (the project's default)`);
  const steps = [...setupSteps, ...(raw as Array<Record<string, unknown>>)];
  if (steps.length > MAX_UI_STEPS) return { ...base, ok: false, reason: `not automatable: ${steps.length} steps with the setup, more than ${MAX_UI_STEPS}` };

  const journey: Record<string, unknown> = {
    format: UI_JOURNEY_FORMAT, version: 1, id: j.id, title: j.title,
    ...(j.setup?.client ? { client: j.setup.client } : {}),
    features: j.features,
    ...(launch ? { launch } : {}),
    ...(opts.file ? { from: opts.file.slice(0, 400) } : {}),
    steps
  };
  return { ...base, ok: true, stepsFrom, journey, notes };
}

/** One line per compiled journey, for logs: `J01 ✓ 9 steps (vendor)` or `J11 – not automatable: …`. */
export function compileSummary(r: CompileResult): string {
  if (!r.ok) return `${r.id} – ${r.reason}`;
  const steps = (r.journey.steps as unknown[]).map(parseStep) as UiStep[];
  return `${r.id} ✓ ${steps.length} steps (${r.stepsFrom}; checks: ${steps.filter(s => ASSERTIONS.includes(s.kind)).map(describeStep).join(", ").slice(0, 160)})${r.notes.length ? ` — ${r.notes.join("; ")}` : ""}`;
}
