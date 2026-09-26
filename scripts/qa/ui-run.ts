/**
 * `npm run qa:ui -- <run root> <journey.json> [--code <VS Code executable>] [--out <report folder>]`
 *
 * QA-4: the hands of a Codex test run when Computer Use cannot see the desktop. It reads a run root
 * prepared by qa:prepare (run.json, the isolated profile with the VSIX installed, the client's
 * `.code-workspace`), starts that VS Code through Playwright `_electron` with the same isolation flags
 * and `--disable-workspace-trust`, executes the journey's UI steps (src/qa/ui/journey.ts) and writes a
 * `datapass.qa-report` with one outcome per step and the screenshots under `screens/`.
 *
 * Exit 0 = the journey was reached; 1 = it was not (failed, partly run or blocked; the report says
 * which); 2 = cannot start (bad run root or journey). It writes only in the report folder (default
 * `<run root>/qa-ui/<run id>-<journey id>/`) and never touches the person's own VS Code profile.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { _electron, type ElectronApplication, type Frame, type Locator, type Page } from "playwright-core";
import { EXTENSIONS_DIR, USER_DATA_DIR, vscodeExecutable } from "./prepare";
import { parseQaReport, parseQaRun, QaFormatError } from "../../src/qa/formats";
import { buildUiReport, describeStep, parseUiJourney, screenPath, type RunInfo, type StepResult, type UiJourney, type UiStep } from "../../src/qa/ui/journey";

export interface UiRunOptions { root: string; journey: string; code?: string; out?: string; log?: (line: string) => void }
export interface UiRunResult { code: 0 | 1 | 2; reportFile?: string; outcome?: string; reasons: string[] }

const DRIVER = `playwright-core ${(require("playwright-core/package.json") as { version: string }).version}`;
const PALETTE_TIMEOUT_MS = 15_000;

class CannotRun extends Error { constructor(readonly reasons: string[]) { super(reasons.join("\n")); } }

type RunFile = Omit<RunInfo, "clients"> & { clients: Array<RunInfo["clients"][number] & { workspaceFile: string }> };

function readInputs(root: string, journeyFile: string): { run: RunFile; journey: UiJourney } {
  const runFile = path.join(root, "run.json");
  if (!fs.existsSync(runFile)) throw new CannotRun([`no run.json in ${root}: prepare the run root with npm run qa:prepare first`]);
  if (!fs.existsSync(journeyFile)) throw new CannotRun([`journey not found: ${journeyFile}`]);
  try {
    const run = parseQaRun(fs.readFileSync(runFile)) as unknown as RunFile;
    const journey = parseUiJourney(fs.readFileSync(journeyFile), path.basename(journeyFile));
    return { run, journey };
  } catch (e) { throw new CannotRun(e instanceof QaFormatError ? e.issues.map(i => `${e.file}: ${i}`) : [String(e)]); }
}

/** The first visible match in the workbench or any webview frame, waiting for it up to `timeout`. */
async function findVisible(page: Page, make: (f: Frame) => Locator, timeout: number): Promise<Locator | undefined> {
  const end = Date.now() + timeout;
  for (;;) {
    for (const frame of page.frames()) {
      const loc = make(frame).first();
      try { if (await loc.isVisible()) return loc; } catch { /* frame detached meanwhile */ }
    }
    if (Date.now() >= end) return undefined;
    await page.waitForTimeout(200);
  }
}

/** Open the Command Palette (">") or Open View ("view "), type `label` and pick the first row showing it. */
async function pickFromQuickInput(page: Page, prefix: string, label: string): Promise<string | undefined> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("F1");
  const input = page.locator(".quick-input-widget input.input");
  await input.waitFor({ state: "visible", timeout: PALETTE_TIMEOUT_MS });
  // The prefix first (it switches the picker), then the name as keystrokes: filled all at once, the
  // text can reach the previous picker and leave "No matching views".
  await input.fill(prefix);
  await input.pressSequentially(label, { delay: 20 });
  const row = page.locator(".quick-input-list .monaco-list-row", { hasText: label }).first();
  try { await row.waitFor({ state: "visible", timeout: PALETTE_TIMEOUT_MS }); }
  catch { await page.keyboard.press("Escape"); return `no entry "${label}" in the quick input after typing "${prefix}${label}"`; }
  await row.click();
  return undefined;
}

async function runStep(page: Page, step: UiStep, journeyId: string, outDir: string): Promise<StepResult> {
  switch (step.kind) {
    case "invalid": return { status: "NOT_RUN", detail: step.problem };
    case "run": {
      const problem = await pickFromQuickInput(page, ">", step.label);
      return problem ? { status: "FAIL", detail: problem } : { status: "PASS" };
    }
    case "openView": {
      const problem = await pickFromQuickInput(page, "view ", step.name);
      return problem ? { status: "FAIL", detail: problem } : { status: "PASS" };
    }
    case "click": {
      const loc = await findVisible(page, f => (step.role ? f.getByRole(step.role, { name: step.text }) : f.getByText(step.text)), 15_000);
      if (!loc) return { status: "FAIL", detail: `nothing visible ${step.role ? `with role ${step.role} and name` : "with the text"} "${step.text}"` };
      await loc.click();
      return { status: "PASS" };
    }
    case "expect": {
      const loc = await findVisible(page, f => f.getByText(step.text), step.timeoutMs);
      return loc ? { status: "PASS" } : { status: "FAIL", detail: `"${step.text}" not shown within ${step.timeoutMs} ms` };
    }
    case "press": await page.keyboard.press(step.key); return { status: "PASS" };
    case "screenshot": {
      const rel = screenPath(journeyId, step.name);
      await page.screenshot({ path: path.join(outDir, ...rel.split("/")) });
      return { status: "PASS", screen: rel };
    }
  }
}

export async function runUi(opts: UiRunOptions): Promise<UiRunResult> {
  const log = opts.log ?? (line => console.log(line));
  const root = path.resolve(opts.root);
  let app: ElectronApplication | undefined;
  try {
    const { run, journey } = readInputs(root, path.resolve(opts.journey));
    const client = journey.client ? run.clients.find(c => c.id === journey.client) : run.clients[0];
    if (!client) throw new CannotRun([`journey client "${journey.client}" is not in run.json (${run.clients.map(c => c.id).join(", ")})`]);
    const workspace = path.join(root, client.workspaceFile);
    if (!fs.existsSync(workspace)) throw new CannotRun([`workspace file missing: ${workspace}`]);
    const outDir = path.resolve(opts.out ?? path.join(root, "qa-ui", `${run.runId}-${journey.id}`));
    fs.mkdirSync(path.join(outDir, "screens"), { recursive: true });
    const executable = await vscodeExecutable(opts.code);
    log(`▶ ${journey.id} "${journey.title}" in ${client.title} (${journey.steps.length} step(s))`);

    const startedAt = new Date();
    const results: StepResult[] = [];
    let blocked: string | undefined;
    try {
      const env = { ...process.env } as Record<string, string>;
      delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({
        executablePath: executable,
        args: ["--user-data-dir", path.join(root, USER_DATA_DIR), "--extensions-dir", path.join(root, EXTENSIONS_DIR), "--disable-workspace-trust",
          "--skip-welcome", "--skip-release-notes", "--disable-telemetry", "--new-window", workspace],
        env, timeout: 120_000
      });
      const page = await app.firstWindow({ timeout: 120_000 });
      await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 120_000 });
    } catch (e) { blocked = e instanceof Error ? e.message.split("\n")[0]! : String(e); }

    if (!blocked) {
      const page = await app!.firstWindow();
      let failed = false;
      for (const [i, step] of journey.steps.entries()) {
        if (failed) { results.push({ status: "NOT_RUN", detail: "an earlier step failed" }); continue; }
        let r: StepResult;
        try { r = await runStep(page, step, journey.id, outDir); }
        catch (e) { r = { status: "FAIL", detail: e instanceof Error ? e.message.split("\n")[0]! : String(e) }; }
        if (r.status === "FAIL") {
          failed = true;
          const rel = screenPath(journey.id, `fail-step-${i + 1}`);
          try { await page.screenshot({ path: path.join(outDir, ...rel.split("/")) }); r = { ...r, screen: rel }; } catch { /* the window is gone */ }
        }
        results.push(r);
        log(`  ${r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "–"} ${i + 1}. ${describeStep(step)}${r.detail ? ` — ${r.detail}` : ""}`);
      }
    }

    const report = buildUiReport({ run, journey, results, startedAt, finishedAt: new Date(), driver: DRIVER, blocked });
    const text = JSON.stringify(report, null, 2) + "\n";
    const parsed = parseQaReport(text);
    const reportFile = path.join(outDir, "report.json");
    fs.writeFileSync(reportFile, text);
    const outcome = parsed.journeys[0]!.outcome;
    log(`${outcome === "reached" ? "✓" : "✗"} ${journey.id}: ${outcome}${blocked ? ` (${blocked})` : ""} — ${reportFile}`);
    return { code: outcome === "reached" ? 0 : 1, reportFile, outcome, reasons: blocked ? [blocked] : [] };
  } catch (e) {
    const reasons = e instanceof CannotRun ? e.reasons : [e instanceof Error ? e.message : String(e)];
    log("✗ Cannot run this journey:");
    for (const r of reasons) log(`  - ${r}`);
    return { code: 2, reasons };
  } finally {
    await app?.close().catch(() => undefined);
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--code", "--out"].includes(argv[i - 1]!)));
  if (positional.length !== 2) {
    console.log("Usage: npm run qa:ui -- <run root> <journey.json> [--code <VS Code executable>] [--out <report folder>]");
    process.exit(2);
  }
  void runUi({ root: positional[0]!, journey: positional[1]!, code: value("code"), out: value("out") }).then(r => process.exit(r.code));
}
