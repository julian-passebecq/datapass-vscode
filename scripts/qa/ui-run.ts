/**
 * `npm run qa:ui -- <run root> <journey.json | folder> [--code <VS Code executable>] [--out <report folder>]`
 *
 * QA-4: the hands of a Codex test run when Computer Use cannot see the desktop. It reads a run root
 * prepared by qa:prepare (run.json, the isolated profile with the VSIX installed, the client's
 * `.code-workspace`), starts that VS Code through Playwright `_electron` with the same isolation flags,
 * executes the journey's UI steps (src/qa/ui/journey.ts) and writes a `datapass.qa-report` with one
 * outcome per step and the screenshots under `screens/`.
 *
 * V1-AUTO-2 (the functional release gate): given a folder — normally `<run root>/ui-journeys/`, where
 * qa:prepare compiled every journey of the run (src/qa/ui/compile.ts) — it runs each compiled journey
 * in the order of its index.json, each in a fresh VS Code launched as the journey's setup says
 * (trusted or Restricted Mode; the client workspace, a fresh fixture copy, or an empty window), and
 * writes one merged report (`<run root>/qa-ui/<run id>/report.json`) where a journey that could not be
 * compiled is "blocked" with "not automatable: <reason>" — never a pass.
 *
 * Exit 0 = every journey was reached; 1 = one was not (failed, partly run, blocked or not automatable;
 * the report says which — and also when the run ends early, without a report holding every journey, or on
 * an unhandled rejection); 2 = cannot start (bad run root or journey). It writes only in the report
 * folder and the journey's own fixture/scratch folders, and never touches the person's own VS Code profile.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { _electron, type ElectronApplication, type Frame, type Locator, type Page } from "playwright-core";
import { listProcesses, processTree, waitForExit } from "./processTree";
import { EXTENSIONS_DIR, journeyTarget, UI_INDEX_FILE, USER_DATA_DIR, vscodeExecutable, type UiIndexEntry } from "./prepare";
import { parseQaReport, parseQaRun, QaFormatError } from "../../src/qa/formats";
import { buildUiReport, describeStep, mergeUiReports, parseUiJourney, screenPath, type RunInfo, type StepResult, type UiJourney, type UiStep } from "../../src/qa/ui/journey";

export interface UiRunOptions { root: string; journey: string; code?: string; out?: string; log?: (line: string) => void }
export interface UiRunResult { code: 0 | 1 | 2; reportFile?: string; outcome?: string; reasons: string[]; outcomes?: Record<string, string> }

const DRIVER = `playwright-core ${(require("playwright-core/package.json") as { version: string }).version}`;
const PALETTE_TIMEOUT_MS = 15_000;
/** The home qa:ui gives VS Code (HOME and USERPROFILE), so ~/.vscode-shared is the run's own too. */
export const QA_HOME_DIR = ".qa-home";

const CLOSE_TIMEOUT_MS = 30_000;

/** `p`, or undefined after `ms` (the timer also keeps the event loop alive while `p` is pending). */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<undefined>(r => { timer = setTimeout(() => r(undefined), ms); })]); }
  finally { clearTimeout(timer); }
}

class CannotRun extends Error { constructor(readonly reasons: string[]) { super(reasons.join("\n")); } }

type RunFile = Omit<RunInfo, "clients"> & { clients: Array<RunInfo["clients"][number] & { workspaceFile: string }> };

function readRun(root: string): RunFile {
  const runFile = path.join(root, "run.json");
  if (!fs.existsSync(runFile)) throw new CannotRun([`no run.json in ${root}: prepare the run root with npm run qa:prepare first`]);
  try { return parseQaRun(fs.readFileSync(runFile)) as unknown as RunFile; }
  catch (e) { throw new CannotRun(e instanceof QaFormatError ? e.issues.map(i => `${e.file}: ${i}`) : [String(e)]); }
}

function readJourney(journeyFile: string): UiJourney {
  if (!fs.existsSync(journeyFile)) throw new CannotRun([`journey not found: ${journeyFile}`]);
  try { return parseUiJourney(fs.readFileSync(journeyFile), path.basename(journeyFile)); }
  catch (e) { throw new CannotRun(e instanceof QaFormatError ? e.issues.map(i => `${e.file}: ${i}`) : [String(e)]); }
}

/**
 * The first visible match in the workbench or any webview frame, waiting for it up to `timeout`.
 * Hidden matches are skipped, not just checked: a frame often holds an invisible copy of the text
 * before the visible one (the diagram's edge `<title>` "PDF inbox → …" precedes the node "PDF inbox";
 * a hidden view keeps its tree rows), and taking only the first match would never see the node.
 */
async function findVisible(page: Page, make: (f: Frame) => Locator, timeout: number): Promise<Locator | undefined> {
  const end = Date.now() + timeout;
  for (;;) {
    for (const frame of page.frames()) {
      const loc = make(frame).filter({ visible: true }).first();
      try { if (await loc.isVisible()) return loc; } catch { /* frame detached meanwhile */ }
    }
    if (Date.now() >= end) return undefined;
    await page.waitForTimeout(200);
  }
}

const quickInput = (page: Page) => page.locator(".quick-input-widget input.input");

/** Open the Command Palette with `prefix` (">" commands, "view " views, "" files) and type `text`. */
async function openQuickInput(page: Page, prefix: string, text: string): Promise<void> {
  const input = quickInput(page);
  for (let attempt = 0; ; attempt++) {
    try {
      await page.keyboard.press("Escape");
      // A focused webview (the Architecture diagram) swallows F1, and the keystrokes then land in the
      // editor: take the focus out of it first. A webview can also take the focus back a moment later
      // and close the palette: the value is checked, and the whole opening is retried.
      await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; if (a && a.tagName === "IFRAME") a.blur(); }).catch(() => undefined);
      await page.keyboard.press("F1");
      await input.waitFor({ state: "visible", timeout: PALETTE_TIMEOUT_MS });
      // The prefix first (it switches the picker), then the whole value at once: filled together before the
      // picker switched, the text can reach the previous picker and leave "No matching views".
      await input.fill(prefix, { timeout: 3_000 });
      await page.waitForTimeout(250);
      await input.fill(prefix + text, { timeout: 3_000 });
      await page.waitForTimeout(300);
      if (await input.isVisible() && (await input.inputValue({ timeout: 1_000 })) === prefix + text) return;
    } catch { /* retried below */ }
    if (attempt >= 2) throw new Error(`the Command Palette did not keep the focus to take "${prefix}${text}"`);
    await page.waitForTimeout(1_000);
  }
}

/** The row the last pick pressed Enter on (reported with quickPick, for the record). */
let lastPicked = "";

/** Pick the first row of the open quick input showing `label` (a row labelled exactly `label` first). */
async function pickRow(page: Page, label: string, typed: string): Promise<string | undefined> {
  const row = page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row", { hasText: label }).first();
  // A row whose label is exactly `label` wins over one that only contains it (view "Git" over "GitHub…").
  const exact = page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row").filter({ has: page.locator(".label-name", { hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) }) }).first();
  try {
    await row.waitFor({ state: "visible", timeout: PALETTE_TIMEOUT_MS });
    await page.waitForTimeout(300);
  }
  catch {
    const shown = await page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row").allInnerTexts().catch(() => []);
    const value = await quickInput(page).inputValue({ timeout: 500 }).catch(() => "(closed)");
    await page.keyboard.press("Escape");
    return `no entry "${label}" in the quick input after typing "${typed}" (input "${value}"; rows: ${shown.slice(0, 3).map(s => s.replace(/\s+/g, " ").slice(0, 60)).join(" | ") || "none"})`;
  }
  // The list re-renders while it filters, so a click can wait on a moving row or land on its neighbour.
  // Walk the keyboard focus instead until the focused row is the one wanted, then press Enter.
  await quickInput(page).focus({ timeout: 1_000 }).catch(() => undefined);
  const focusedRow = page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row.focused").filter({ visible: true }).first();
  // First pass: the row labelled exactly `label` if there is one; second pass: any row showing it.
  for (const wantExact of (await exact.isVisible().catch(() => false)) ? [true, false] : [false]) {
    for (let moves = 0; moves < 40; moves++) {
      const name = (await focusedRow.locator(".label-name").first().innerText({ timeout: 1_000 }).catch(() => "")).replace(/\s+/g, " ").trim();
      const text = (await focusedRow.innerText({ timeout: 1_000 }).catch(() => "")).replace(/\s+/g, " ");
      if (wantExact ? name === label : text.includes(label)) { await page.keyboard.press("Enter"); lastPicked = text.slice(0, 80); return undefined; }
      await page.keyboard.press("ArrowDown"); // the list wraps around at its end
      await page.waitForTimeout(100);
    }
  }
  await page.keyboard.press("Escape");
  return `the entry "${label}" is listed but the keyboard never reached it`;
}

async function pickFromQuickInput(page: Page, prefix: string, label: string): Promise<string | undefined> {
  // A webview taking the focus mid-walk closes the picker: open it again once.
  let problem: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    await openQuickInput(page, prefix, label);
    problem = await pickRow(page, label, `${prefix}${label}`);
    if (!problem) return undefined;
    await page.waitForTimeout(1_500);
  }
  return problem;
}

interface StepContext { app: ElectronApplication; page: () => Promise<Page>; journeyId: string; outDir: string; folder?: string }

const result = (problem: string | undefined): StepResult => (problem ? { status: "FAIL", detail: problem } : { status: "PASS" });

async function runStep(ctx: StepContext, step: UiStep): Promise<StepResult> {
  const page = await ctx.page();
  switch (step.kind) {
    case "invalid": return { status: "NOT_RUN", detail: step.problem };
    case "run": return result(await pickFromQuickInput(page, ">", step.label));
    case "openView": return result(await pickFromQuickInput(page, "view ", step.name));
    case "click": {
      const loc = await findVisible(page, f => (step.role ? f.getByRole(step.role, { name: step.text }) : f.getByText(step.text)), 15_000);
      if (!loc) return { status: "FAIL", detail: `nothing visible ${step.role ? `with role ${step.role} and name` : "with the text"} "${step.text}"` };
      // A modal editor or a re-rendering webview can keep a target "unstable": click where it is then.
      try { await loc.click({ timeout: 10_000 }); } catch { await loc.click({ force: true, timeout: 5_000 }); }
      return { status: "PASS" };
    }
    case "expect": {
      const loc = await findVisible(page, f => f.getByText(step.text), step.timeoutMs);
      return loc ? { status: "PASS" } : { status: "FAIL", detail: `"${step.text}" not shown within ${step.timeoutMs} ms` };
    }
    case "expectAbsent": {
      // Absent now and still absent after the settle time: a text that appears late is caught too.
      await page.waitForTimeout(step.timeoutMs);
      const loc = await findVisible(page, f => f.getByText(step.text), 0);
      return loc ? { status: "FAIL", detail: `"${step.text}" is shown (${(await loc.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120)})` } : { status: "PASS" };
    }
    case "press": await page.keyboard.press(step.key); return { status: "PASS" };
    case "type": {
      // Into the input box a command opens (it can take a moment to appear: typing earlier loses keystrokes),
      // else where the focus is.
      // A text field outside the quick input already has the focus (the Extensions search): type there.
      const ownField = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && !a.closest(".quick-input-widget");
      }).catch(() => false);
      const input = quickInput(page);
      if (!ownField && await input.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false)) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await input.fill(step.text, { timeout: 3_000 }).catch(() => undefined);
          await page.waitForTimeout(200);
          if ((await input.inputValue({ timeout: 1_000 }).catch(() => "")) === step.text) return { status: "PASS" };
          await page.waitForTimeout(700);
        }
        return { status: "FAIL", detail: `the input box did not keep "${step.text.slice(0, 60)}"` };
      }
      await page.keyboard.type(step.text, { delay: 10 });
      return { status: "PASS" };
    }
    case "wait": await page.waitForTimeout(step.ms); return { status: "PASS" };
    case "quickPick": {
      // The Command Palette closes before the command's own picker opens: wait for that one.
      const input = quickInput(page);
      for (let attempt = 0; ; attempt++) {
        await page.waitForTimeout(500);
        try {
          await input.waitFor({ state: "visible", timeout: PALETTE_TIMEOUT_MS });
          await input.fill(step.text, { timeout: 3_000 });
          break;
        } catch { if (attempt >= 2) return { status: "FAIL", detail: `no quick pick open to pick "${step.text}" from` }; }
      }
      const problem = await pickRow(page, step.text, step.text);
      return problem ? { status: "FAIL", detail: problem } : { status: "PASS", detail: `picked "${lastPicked}"` };
    }
    case "commandPaletteSearch": {
      await openQuickInput(page, ">", step.query);
      await page.waitForTimeout(800);
      return { status: "PASS" };
    }
    case "settingsSearch": {
      const problem = await pickFromQuickInput(page, ">", "Preferences: Open Settings (UI)");
      if (problem) return { status: "FAIL", detail: problem };
      const search = page.locator(".settings-editor .settings-header .suggest-input-container");
      try { await search.waitFor({ state: "visible", timeout: PALETTE_TIMEOUT_MS }); }
      catch { return { status: "FAIL", detail: "the Settings editor did not open" }; }
      await search.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.type(step.query, { delay: 20 });
      await page.waitForTimeout(1_500);
      return { status: "PASS" };
    }
    case "openFile": {
      await openQuickInput(page, "", step.path);
      const base = step.path.split("/").at(-1)!;
      // Go to File keeps re-rendering its rows while it searches: wait for the file, then take the top row.
      const row = page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row", { hasText: base }).first();
      try { await row.waitFor({ state: "visible", timeout: PALETTE_TIMEOUT_MS }); }
      catch { await page.keyboard.press("Escape"); return { status: "FAIL", detail: `Go to File found no ${step.path}` }; }
      await page.waitForTimeout(500);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(800);
      return { status: "PASS" };
    }
    case "chooseFolder": {
      if (!ctx.folder) return { status: "FAIL", detail: `this journey has no ${step.folder} folder (setup.open)` };
      // The next native folder dialog (Electron's, in VS Code's main process) answers this folder, once.
      await ctx.app.evaluate(({ dialog }, folder) => {
        const d = dialog as unknown as { showOpenDialog: (...a: unknown[]) => Promise<unknown> };
        const original = d.showOpenDialog;
        d.showOpenDialog = async () => { d.showOpenDialog = original; return { canceled: false, filePaths: [folder] }; };
      }, ctx.folder);
      return { status: "PASS" };
    }
    case "screenshot": {
      const rel = screenPath(ctx.journeyId, step.name);
      await page.screenshot({ path: path.join(ctx.outDir, ...rel.split("/")) });
      return { status: "PASS", screen: rel };
    }
  }
}

/**
 * Each journey starts from the same isolated profile: no user settings (the DataPass mode is the
 * default, a journey's setup.mode sets its own), no per-workspace state (the selected variant, open
 * editors), no hot-exit backups (an unsaved edit of an earlier journey) and no trusted folders. The
 * installed VSIX stays.
 */
export function resetProfile(root: string): void {
  const user = path.join(root, USER_DATA_DIR);
  // The run's own home too: it keeps the folders a journey trusted (R02), and every journey starts untrusted-by-default.
  for (const p of [path.join(root, QA_HOME_DIR), path.join(user, "Backups"), path.join(user, "User", "workspaceStorage"), path.join(user, "User", "settings.json")]) fs.rmSync(p, { recursive: true, force: true });
}

/** Launch the journey's VS Code, run its steps, close it: the outcomes, or why VS Code could not be driven. */
async function driveJourney(root: string, run: RunFile, journey: UiJourney, outDir: string, executable: string, log: (line: string) => void): Promise<{ results: StepResult[]; blocked?: string; startedAt: Date; finishedAt: Date }> {
  const client = journey.client ? run.clients.find(c => c.id === journey.client) : run.clients[0];
  if (!client) throw new CannotRun([`journey client "${journey.client}" is not in run.json (${run.clients.map(c => c.id).join(", ")})`]);
  const workspace = path.join(root, client.workspaceFile);
  if (!fs.existsSync(workspace)) throw new CannotRun([`workspace file missing: ${workspace}`]);
  const launch = journey.launch ?? {};
  const { target, folder } = journeyTarget(root, journey.id, launch, client.id);
  log(`▶ ${journey.id} "${journey.title}" in ${launch.open === "fixture" ? `a fresh copy of ${launch.fixture}` : launch.open === "empty" ? "an empty window" : client.title}${launch.trust === "restricted" ? " (Restricted Mode)" : ""} (${journey.steps.length} step(s))`);

  resetProfile(root);
  const startedAt = new Date();
  const results: StepResult[] = [];
  let blocked: string | undefined;
  let app: ElectronApplication | undefined;
  try {
    try {
      const env = { ...process.env } as Record<string, string>;
      delete env.ELECTRON_RUN_AS_NODE;
      // ~/.vscode-shared is not isolated by --user-data-dir: it carries the person's trusted folders
      // (a trusted C:\Users\<me> or D:\ makes every run root trusted, and Restricted Mode untestable).
      // qa:ui gives VS Code a home of its own under the run root.
      const home = path.join(root, QA_HOME_DIR);
      fs.mkdirSync(home, { recursive: true });
      Object.assign(env, { HOME: home, USERPROFILE: home });
      app = await _electron.launch({
        executablePath: executable,
        args: ["--user-data-dir", path.join(root, USER_DATA_DIR), "--extensions-dir", path.join(root, EXTENSIONS_DIR),
          ...(launch.trust === "restricted" ? [] : ["--disable-workspace-trust"]),
          "--skip-welcome", "--skip-release-notes", "--disable-telemetry", ...(target[0] === "--new-window" ? target : ["--new-window", ...target])],
        env, timeout: 120_000
      });
      const page = await app.firstWindow({ timeout: 120_000 });
      await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 120_000 });
    } catch (e) { blocked = e instanceof Error ? e.message.split("\n")[0]! : String(e); }

    if (!blocked) {
      const a = app!;
      // The newest open workbench window: a step may open another one (Open a Client Project…).
      const page = async (): Promise<Page> => {
        const open = a.windows().filter(w => !w.isClosed() && !w.url().startsWith("devtools:"));
        const last = open.at(-1) ?? await a.firstWindow();
        await last.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 120_000 }).catch(() => undefined);
        return last;
      };
      const ctx: StepContext = { app: a, page, journeyId: journey.id, outDir, ...(folder ? { folder } : {}) };
      let failed = false;
      for (const [i, step] of journey.steps.entries()) {
        if (failed) { results.push({ status: "NOT_RUN", detail: "an earlier step failed" }); continue; }
        let r: StepResult;
        try { r = await runStep(ctx, step); }
        catch (e) { r = { status: "FAIL", detail: e instanceof Error ? e.message.split("\n")[0]! : String(e) }; }
        if (r.status === "FAIL") {
          failed = true;
          const rel = screenPath(journey.id, `fail-step-${i + 1}`);
          try { await (await page()).screenshot({ path: path.join(outDir, ...rel.split("/")) }); r = { ...r, screen: rel }; } catch { /* the window is gone */ }
        }
        results.push(r);
        log(`  ${r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "–"} ${i + 1}. ${describeStep(step)}${r.detail ? ` — ${r.detail}` : ""}`);
      }
    }
  } finally {
    // The main process exits first; its children still write into the run root for a moment (QATMP).
    const pid = app?.process().pid;
    const tree = pid ? processTree(pid, listProcesses()) : [];
    // QAEXIT: Playwright's close() can stay pending forever on Windows once the Electron pipes are gone;
    // with no timer left, Node then drains its event loop and exits 0 without a report. Bound it.
    if (app) await withTimeout(app.close().catch(() => undefined), CLOSE_TIMEOUT_MS);
    const killed = await waitForExit(tree);
    if (killed.length) log(`  (killed ${killed.length} VS Code process(es) still running after close)`);
  }
  return { results, blocked, startedAt, finishedAt: new Date() };
}

function writeReport(outDir: string, report: Record<string, unknown>): string {
  const text = JSON.stringify(report, null, 2) + "\n";
  parseQaReport(text); // what we write must read back
  const reportFile = path.join(outDir, "report.json");
  fs.writeFileSync(reportFile, text);
  return reportFile;
}

export async function runUi(opts: UiRunOptions): Promise<UiRunResult> {
  const log = opts.log ?? (line => console.log(line));
  const root = path.resolve(opts.root);
  try {
    const run = readRun(root);
    const target = path.resolve(opts.journey);
    const isFolder = fs.existsSync(target) && fs.statSync(target).isDirectory();
    const executable = await vscodeExecutable(opts.code);

    if (!isFolder) {
      const journey = readJourney(target);
      const outDir = path.resolve(opts.out ?? path.join(root, "qa-ui", `${run.runId}-${journey.id}`));
      fs.mkdirSync(path.join(outDir, "screens"), { recursive: true });
      const r = await driveJourney(root, run, journey, outDir, executable, log);
      const report = buildUiReport({ run, journey, driver: DRIVER, ...r });
      const reportFile = writeReport(outDir, report);
      const outcome = (report.journeys as Array<{ outcome: string }>)[0]!.outcome;
      log(`${outcome === "reached" ? "✓" : "✗"} ${journey.id}: ${outcome}${r.blocked ? ` (${r.blocked})` : ""} — ${reportFile}`);
      return { code: outcome === "reached" ? 0 : 1, reportFile, outcome, reasons: r.blocked ? [r.blocked] : [] };
    }

    // A folder of compiled journeys: every journey of the run, in order, one merged report.
    const indexFile = path.join(target, UI_INDEX_FILE);
    if (!fs.existsSync(indexFile)) throw new CannotRun([`no ${UI_INDEX_FILE} in ${target}: qa:prepare compiles the run's journeys into <run root>/ui-journeys/`]);
    const index = (JSON.parse(fs.readFileSync(indexFile, "utf8")) as { journeys: UiIndexEntry[] }).journeys;
    const journeys = index.map(e => ({ entry: e, journey: e.file ? readJourney(path.join(target, e.file)) : undefined }));
    const outDir = path.resolve(opts.out ?? path.join(root, "qa-ui", run.runId));
    fs.mkdirSync(path.join(outDir, "screens"), { recursive: true });
    const reports: Array<Record<string, unknown>> = [];
    const notAutomatable: Array<{ id: string; title: string; features: string[]; reason: string }> = [];
    const outcomes: Record<string, string> = {};
    for (const { entry, journey } of journeys) {
      if (!journey) {
        notAutomatable.push({ id: entry.id, title: entry.title, features: entry.features, reason: entry.notAutomatable ?? "not automatable" });
        outcomes[entry.id] = "not automatable";
        log(`– ${entry.id}: ${entry.notAutomatable ?? "not automatable"}`);
        continue;
      }
      const r = await driveJourney(root, run, journey, outDir, executable, log);
      const report = buildUiReport({ run, journey, driver: DRIVER, ...r });
      reports.push(report);
      const outcome = (report.journeys as Array<{ outcome: string }>)[0]!.outcome;
      outcomes[entry.id] = outcome;
      log(`${outcome === "reached" ? "✓" : "✗"} ${journey.id}: ${outcome}${r.blocked ? ` (${r.blocked})` : ""}`);
    }
    const merged = mergeUiReports(run, reports, notAutomatable, DRIVER);
    const reportFile = writeReport(outDir, merged);
    const counts = Object.values(outcomes).reduce<Record<string, number>>((c, o) => ({ ...c, [o]: (c[o] ?? 0) + 1 }), {});
    log(`qa:ui ${Object.entries(counts).map(([o, n]) => `${n} ${o}`).join(" · ")} — ${reportFile}`);
    const allReached = Object.values(outcomes).every(o => o === "reached");
    return { code: allReached ? 0 : 1, reportFile, outcome: allReached ? "reached" : "not-reached", reasons: [], outcomes };
  } catch (e) {
    const reasons = e instanceof CannotRun ? e.reasons : [e instanceof Error ? e.message : String(e)];
    log("✗ Cannot run:");
    for (const r of reasons) log(`  - ${r}`);
    return { code: 2, reasons };
  }
}

/**
 * Why a run that claims success is not one: the report is missing, unreadable, lacks a journey
 * the run went through, or holds a journey that was not reached. Undefined when the report is sound.
 */
export function reportProblem(result: UiRunResult): string | undefined {
  if (!result.reportFile) return "no report file was written";
  if (!fs.existsSync(result.reportFile)) return `the report ${result.reportFile} does not exist`;
  let journeys: Array<{ id?: string; outcome?: string }>;
  try { journeys = (JSON.parse(fs.readFileSync(result.reportFile, "utf8")) as { journeys?: Array<{ id?: string; outcome?: string }> }).journeys ?? []; }
  catch (e) { return `the report ${result.reportFile} cannot be read: ${e instanceof Error ? e.message : String(e)}`; }
  if (!journeys.length) return `the report ${result.reportFile} has no journey`;
  const ids = new Set(journeys.map(j => j.id));
  const missing = Object.keys(result.outcomes ?? {}).filter(id => !ids.has(id));
  if (missing.length) return `the report lacks journey(s) ${missing.join(", ")}`;
  const notReached = journeys.filter(j => j.outcome !== "reached").map(j => j.id);
  if (notReached.length) return `journey(s) ${notReached.join(", ")} not reached`;
  return undefined;
}

type ExitProcess = { on(event: string, listener: (...args: any[]) => void): unknown; exit(code?: number): unknown };

/**
 * QAEXIT: the process exits 0 only when `run` settled with code 0 and its report holds every journey,
 * reached. An unhandled rejection or uncaught exception exits 1; so does the event loop draining while
 * `run` is still pending (a promise that never settles: Node would otherwise end with 0 and no report).
 */
export function runCli(run: () => Promise<UiRunResult>, proc: ExitProcess = process, log: (line: string) => void = line => console.error(line)): Promise<void> {
  let settled = false;
  const fail = (why: string) => { log(`✗ qa:ui ${why}`); proc.exit(1); };
  proc.on("unhandledRejection", (reason: unknown) => fail(`stopped on an unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`));
  proc.on("uncaughtException", (err: Error) => fail(`stopped on an uncaught exception: ${err.message}`));
  proc.on("beforeExit", () => { if (!settled) fail("ended early: a step never finished and no report was written"); });
  return run().then(
    r => {
      settled = true;
      const problem = r.code === 0 ? reportProblem(r) : undefined;
      if (problem) fail(`reported success but ${problem}`);
      else proc.exit(r.code);
    },
    e => { settled = true; fail(`failed: ${e instanceof Error ? e.message : String(e)}`); });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--code", "--out"].includes(argv[i - 1]!)));
  if (positional.length !== 2) {
    console.log("Usage: npm run qa:ui -- <run root> <journey.json | <run root>/ui-journeys> [--code <VS Code executable>] [--out <report folder>]");
    process.exit(2);
  }
  void runCli(() => runUi({ root: positional[0]!, journey: positional[1]!, code: value("code"), out: value("out") }));
}
