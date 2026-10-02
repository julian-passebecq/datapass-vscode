/**
 * `npm run qa:v5 -- [--rows 01,05] [--part a|b] [--code <VS Code executable>] [--out <folder>] [--keep]`
 *
 * V5E2E1: the V5 acceptance run (go/V5-ACCEPTANCE.md). Reads `qa/v5/acceptance.json`, checks each row's
 * features against this build's package.json (a missing command/setting/view/source is a typed hole,
 * `missing`, never a pass), then drives every journey of the rows of this part in a fresh VS Code
 * (Playwright `_electron`, like qa:ui) with this checkout as the development extension, light theme,
 * 1440×900, an isolated profile and home. Screenshots named by the spec go to `qa/v5/shots/`.
 *
 * Boundaries on every journey (QA harness `qa/v5/harness/spy`, attributed to DataPass by stack):
 * no network except localhost, child processes only `git` with a TL-4 read-only verb, and no write
 * outside `.datapass/` that a step did not make. The report (`datapass.v5-acceptance-report`) goes to
 * `<out>/report.json` and `qa/v5/report.json`.
 *
 * Build first (`npm run build`). Exit 0 = every row of the part is green or cut; 1 = otherwise;
 * 2 = cannot start. It never touches the person's own VS Code profile and writes only under `--out`
 * and `qa/v5/`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { vscodeExecutable } from "./prepare";
import { listProcesses, processTree, waitForExit } from "./processTree";
import { runStep, withTimeout, type StepContext } from "./ui-run";
import { buildFixture, fileStamps } from "./v5Fixtures";
import {
  acceptanceVerdict, boundaryFindings, describeV5Step, missingFeatures, offerOf, parseV5Acceptance, rowStatus,
  V5_REPORT_FORMAT, type BoundaryEvent, type JourneyOutcome, type RowOutcome, type V5Journey, type V5Row, type V5Step
} from "../../src/qa/v5/acceptance";

const REPO = path.resolve(__dirname, "..", "..");
const QA_V5 = path.join(REPO, "qa", "v5");
export const SHOTS_DIR = path.join(QA_V5, "shots");
const HARNESS = path.join(QA_V5, "harness");
const SIZE = { width: 1440, height: 900 };
/** Base user settings: light theme, quiet workbench, nothing that calls home. */
export const BASE_SETTINGS: Record<string, unknown> = {
  "workbench.colorTheme": "Default Light Modern",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "window.restoreWindows": "none",
  "window.zoomLevel": 0,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
  "extensions.ignoreRecommendations": true,
  "workbench.enableExperiments": false,
  "git.autofetch": false,
  "security.workspace.trust.enabled": false,
  "chat.disableAIFeatures": true
};

interface Ctx { app: ElectronApplication; page: () => Promise<Page>; fixtureRoot: string; bridge: string; touched: Set<string>; journeyId: string; outDir: string }

async function bridgeCall(bridge: string, req: Record<string, unknown>, timeoutMs = 20_000): Promise<{ ok: boolean; value?: unknown; error?: string; pending?: boolean }> {
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  fs.writeFileSync(path.join(bridge, `req-${n}.json`), JSON.stringify(req));
  const res = path.join(bridge, `res-${n}.json`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fs.existsSync(res)) { try { return JSON.parse(fs.readFileSync(res, "utf8")); } catch { /* half written */ } }
    await new Promise(r => setTimeout(r, 200));
  }
  return { ok: false, error: `the QA harness did not answer within ${timeoutMs} ms` };
}

const listFiles = (root: string) => [...fileStamps(root).keys()];

async function runV5Step(ctx: Ctx, step: V5Step): Promise<{ status: "PASS" | "FAIL" | "NOT_RUN"; detail?: string }> {
  const abs = (rel: string) => path.join(ctx.fixtureRoot, ...rel.split("/"));
  switch (step.kind) {
    case "shot": {
      const page = await ctx.page();
      await page.waitForTimeout(600);
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS_DIR, `${step.name}.png`) });
      return { status: "PASS", detail: `qa/v5/shots/${step.name}.png` };
    }
    case "chooseFile": {
      const file = abs(step.path);
      if (!fs.existsSync(file)) return { status: "FAIL", detail: `fixture file ${step.path} does not exist` };
      await ctx.app.evaluate(({ dialog }, f) => {
        const d = dialog as unknown as { showOpenDialog: (...a: unknown[]) => Promise<unknown> };
        const original = d.showOpenDialog;
        d.showOpenDialog = async () => { d.showOpenDialog = original; return { canceled: false, filePaths: [f] }; };
      }, file);
      return { status: "PASS" };
    }
    case "appendFile": {
      const rel = step.match ? listFiles(ctx.fixtureRoot).find(f => new RegExp(step.path).test(f)) : step.path;
      if (!rel || !fs.existsSync(abs(rel))) return { status: "FAIL", detail: `no fixture file ${step.match ? `matches /${step.path}/` : step.path}` };
      fs.appendFileSync(abs(rel), step.text); ctx.touched.add(rel);
      return { status: "PASS", detail: rel };
    }
    case "deleteFile": fs.rmSync(abs(step.path), { force: true }); ctx.touched.add(step.path); return { status: "PASS" };
    case "expectFile": case "expectNoFile": {
      const re = new RegExp(step.pattern);
      const end = Date.now() + (step.kind === "expectFile" ? 15_000 : 0);
      for (;;) {
        const hit = listFiles(ctx.fixtureRoot).find(f => re.test(f));
        if (step.kind === "expectNoFile") return hit ? { status: "FAIL", detail: `${hit} exists` } : { status: "PASS" };
        if (hit) return { status: "PASS", detail: hit };
        if (Date.now() > end) return { status: "FAIL", detail: `no file matches /${step.pattern}/` };
        await new Promise(r => setTimeout(r, 500));
      }
    }
    case "expectFileText": case "expectFileLacks": {
      const re = new RegExp(step.pattern);
      const hit = listFiles(ctx.fixtureRoot).find(f => re.test(f));
      if (!hit) return { status: "FAIL", detail: `no file matches /${step.pattern}/` };
      const has = fs.readFileSync(abs(hit), "utf8").includes(step.text);
      if (step.kind === "expectFileText") return has ? { status: "PASS", detail: hit } : { status: "FAIL", detail: `${hit} does not contain "${step.text.slice(0, 60)}"` };
      return has ? { status: "FAIL", detail: `${hit} contains "${step.text.slice(0, 60)}"` } : { status: "PASS", detail: hit };
    }
    case "command": {
      const r = await bridgeCall(ctx.bridge, { op: "run", id: step.id, args: step.args ?? [] });
      return r.ok ? { status: "PASS", ...(r.pending ? { detail: "still running (picker open)" } : {}) } : { status: "FAIL", detail: r.error ?? "command failed" };
    }
    default: {
      const sctx: StepContext = { app: ctx.app, page: ctx.page, journeyId: ctx.journeyId, outDir: ctx.outDir, folder: ctx.fixtureRoot };
      const r = await runStep(sctx, step);
      return { status: r.status, ...(r.detail ? { detail: r.detail } : {}) };
    }
  }
}

function readSpy(file: string): { events: BoundaryEvent[]; active: boolean } {
  if (!fs.existsSync(file)) return { events: [], active: false };
  const events: BoundaryEvent[] = [];
  let active = false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      if (e.kind === "harness") active = true;
      else if (e.kind === "net") events.push({ kind: "net", target: String(e.target), via: String(e.via) });
      else if (e.kind === "spawn") events.push({ kind: "spawn", file: String(e.file), args: (e.args as string[]) ?? [] });
    } catch { /* torn line */ }
  }
  return { events, active };
}

async function driveJourney(journey: V5Journey, executable: string, out: string, log: (l: string) => void): Promise<JourneyOutcome> {
  const base: Omit<JourneyOutcome, "status"> = { id: journey.id, kind: journey.kind, boundary: [], steps: [] };
  if (journey.cut) return { ...base, status: "CUT", detail: journey.cut };
  const dir = path.join(out, journey.id);
  fs.rmSync(dir, { recursive: true, force: true });
  const fixtureRoot = path.join(dir, "fixture");
  const open = buildFixture(journey.fixture, fixtureRoot);
  const before = fileStamps(fixtureRoot);
  const user = path.join(dir, "user"); const home = path.join(dir, "home"); const bridge = path.join(dir, "bridge"); const spyLog = path.join(dir, "spy.jsonl");
  fs.mkdirSync(path.join(user, "User"), { recursive: true }); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(bridge, { recursive: true });
  fs.writeFileSync(path.join(user, "User", "settings.json"), JSON.stringify({ ...BASE_SETTINGS, ...(journey.settings ?? {}) }, null, 2));
  log(`▶ ${journey.id} (${journey.kind}) ${journey.title} — ${journey.fixture}`);

  const env = { ...process.env, HOME: home, USERPROFILE: home, DATAPASS_QA_SPY_LOG: spyLog, DATAPASS_QA_EXT_ROOT: REPO, DATAPASS_QA_BRIDGE: bridge } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  const devPaths = [REPO, path.join(HARNESS, "spy"), ...(journey.stubs ?? []).map(s => path.join(HARNESS, s))];
  let app: ElectronApplication | undefined;
  const steps: JourneyOutcome["steps"] = [];
  let blocked: string | undefined;
  const touched = new Set<string>();
  try {
    try {
      app = await _electron.launch({
        executablePath: executable, env, timeout: 120_000,
        args: ["--user-data-dir", user, "--extensions-dir", path.join(dir, "ext"), ...devPaths.map(p => `--extensionDevelopmentPath=${p}`),
          "--force-device-scale-factor=1", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-telemetry", "--disable-updates", "--new-window", open]
      });
      const first = await app.firstWindow({ timeout: 120_000 });
      await first.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 120_000 });
      await app.evaluate(({ BrowserWindow }, s) => { for (const w of BrowserWindow.getAllWindows()) { w.unmaximize(); w.setContentSize(s.width, s.height); } }, SIZE);
      // DataPass activates on its views or commands: wait until the harness answers, then let the workbench settle.
      const ready = await bridgeCall(bridge, { op: "commands" }, 60_000);
      if (!ready.ok) blocked = ready.error;
      await first.waitForTimeout(2_500);
    } catch (e) { blocked = e instanceof Error ? e.message.split("\n")[0]! : String(e); }
    if (!blocked && app) {
      const a = app;
      const page = async (): Promise<Page> => {
        const wins = a.windows().filter(w => !w.isClosed() && !w.url().startsWith("devtools:"));
        return wins.at(-1) ?? a.firstWindow();
      };
      const ctx: Ctx = { app: a, page, fixtureRoot, bridge, touched, journeyId: journey.id, outDir: dir };
      let failed = false;
      for (const [i, step] of journey.steps.entries()) {
        const label = describeV5Step(step);
        if (failed) { steps.push({ step: label, status: "NOT_RUN", detail: "an earlier step failed" }); continue; }
        let r: { status: "PASS" | "FAIL" | "NOT_RUN"; detail?: string };
        try { r = await runV5Step(ctx, step); } catch (e) { r = { status: "FAIL", detail: e instanceof Error ? e.message.split("\n")[0]! : String(e) }; }
        if (r.status === "FAIL") {
          failed = true;
          try { await (await page()).screenshot({ path: path.join(dir, `fail-step-${i + 1}.png`) }); } catch { /* window gone */ }
        }
        steps.push({ step: label, status: r.status, ...(r.detail ? { detail: r.detail } : {}) });
        log(`  ${r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "–"} ${i + 1}. ${label}${r.detail ? ` — ${r.detail}` : ""}`);
      }
    }
  } finally {
    const pid = app?.process().pid;
    const tree = pid ? processTree(pid, listProcesses()) : [];
    if (app) await withTimeout(app.close().catch(() => undefined), 30_000);
    await waitForExit(tree);
  }
  const spy = readSpy(spyLog);
  const after = fileStamps(fixtureRoot);
  const writes: BoundaryEvent[] = [...after].filter(([f, s]) => before.get(f) !== s).map(([f]) => ({ kind: "write", path: f }));
  for (const f of before.keys()) if (!after.has(f)) writes.push({ kind: "write", path: f });
  const boundary = boundaryFindings([...spy.events, ...writes], touched);
  if (!spy.active && !blocked) boundary.push("boundary spy did not load: network/process checks not run");
  for (const b of boundary) log(`  ! ${b}`);
  const failedStep = steps.find(s => s.status === "FAIL");
  const status = blocked ? "FAIL" : failedStep || steps.some(s => s.status !== "PASS") ? "FAIL" : "PASS";
  return { ...base, boundary, steps, status, ...(blocked ? { detail: `VS Code could not be driven: ${blocked}` } : failedStep ? { detail: `${failedStep.step}: ${failedStep.detail ?? "failed"}` } : {}) };
}

export async function runV5(opts: { rows?: string[]; part?: "a" | "b"; code?: string; out: string; log?: (l: string) => void }): Promise<{ code: 0 | 1 | 2; rows: RowOutcome[] }> {
  const log = opts.log ?? (l => console.log(l));
  const acceptance = parseV5Acceptance(fs.readFileSync(path.join(QA_V5, "acceptance.json"), "utf8"));
  const part = opts.part ?? acceptance.part;
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as unknown;
  const offer = offerOf(pkg, rel => fs.existsSync(path.join(REPO, ...rel.split("/"))));
  if (!fs.existsSync(path.join(REPO, "dist", "extension.js"))) { console.error("✗ dist/extension.js is missing: run npm run build first"); return { code: 2, rows: [] }; }
  let executable: string | undefined;
  const outcomes: RowOutcome[] = [];
  for (const row of acceptance.rows) {
    if (opts.rows && !opts.rows.includes(row.id)) continue;
    const missing = row.cut || row.part !== part ? [] : missingFeatures(row, offer);
    const journeys: JourneyOutcome[] = [];
    if (!row.cut && row.part === part && !missing.length) {
      executable ??= await vscodeExecutable(opts.code);
      for (const j of row.journeys) journeys.push(await driveJourney(j, executable, opts.out, log));
    }
    const { status, detail } = rowStatus(row, part, missing, journeys);
    outcomes.push({ id: row.id, title: row.title, status, detail, ...(missing.length ? { missing } : {}), journeys, shots: row.shots.filter(s => fs.existsSync(path.join(SHOTS_DIR, `${s}.png`))) });
    log(`${status === "green" ? "✓" : status === "cut" || status === "deferred" ? "–" : "✗"} row ${row.id} ${row.title}: ${status} — ${detail}`);
  }
  const verdict = acceptanceVerdict(outcomes);
  const report = {
    format: V5_REPORT_FORMAT, version: 1, part, generatedAt: new Date().toISOString(),
    build: { version: (pkg as { version: string }).version, node: process.version, os: `${os.type()} ${os.release()}` },
    verdict, rows: outcomes
  };
  fs.mkdirSync(opts.out, { recursive: true });
  for (const f of [path.join(opts.out, "report.json"), path.join(QA_V5, "report.json")]) fs.writeFileSync(f, JSON.stringify(report, null, 2) + "\n");
  log(`V5 acceptance part ${part}: ${Object.entries(verdict.counts).map(([k, v]) => `${v} ${k}`).join(", ")} — ${verdict.accepted ? "accepted" : "not accepted"}`);
  return { code: verdict.accepted ? 0 : 1, rows: outcomes };
}

/** Kept for symmetry with qa:ui: rows outside the part never run here. */
export const rowsOfPart = (rows: readonly V5Row[], part: "a" | "b") => rows.filter(r => r.part === part);

if (require.main === module) {
  const argv = process.argv.slice(2);
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const part = value("part");
  void runV5({
    rows: value("rows")?.split(",").map(s => s.trim()).filter(Boolean),
    part: part === "a" || part === "b" ? part : undefined,
    code: value("code"),
    out: path.resolve(value("out") ?? path.join(REPO, "out", "qa-v5"))
  }).then(r => process.exit(r.code), e => { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
}
