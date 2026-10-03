/**
 * `npm run qa:v5 -- [--rows 01,05] [--part a|b|all] [--code <VS Code executable>] [--studio <datapass-studio checkout>] [--out <folder>]`
 *
 * V5E2E1: the V5 acceptance run (go/V5-ACCEPTANCE.md). Reads `qa/v5/acceptance.json`, checks each row's
 * features against this build's package.json (a missing command/setting/view/source is a typed hole,
 * `missing`, or `pending-merge` while the row's feature MR is open — never a pass), then drives every
 * journey of the rows asked for in a fresh VS Code (Playwright `_electron`, like qa:ui) with this checkout
 * as the development extension, light theme, 1440×900, an isolated profile and home. Studio journeys
 * (`host: chromium`) run in Playwright Chromium against a loopback static preview of a datapass-studio
 * checkout with its shell built (`npm run build:shell` there). Screenshots named by the spec go to
 * `qa/v5/shots/`.
 *
 * Boundaries on every journey (QA harness `qa/v5/harness/spy`, attributed to DataPass by stack):
 *  - no network except localhost (Chromium: every request that leaves loopback, file:, data: or blob:);
 *  - every spawn judged by core/spawnAllowList.ts (`checkSpawn`): refused → finding; `read-only` → fine;
 *    `lazy-probe` / `user-command` → fine only after a step that opened its view or ran its command
 *    (`spawnTriggers` in the acceptance file; the step timeline is kept here);
 *  - no write outside `.datapass/` that a step did not make (`appendFile`, `deleteFile`) or accept right
 *    after the user's confirmation (`acceptWrites`).
 * The report (`datapass.v5-acceptance-report`) goes to `<out>/report.json` and `qa/v5/report.json`.
 *
 * Build first (`npm run build`). Exit 0 = every row asked for is green or cut; 1 = otherwise;
 * 2 = cannot start. It never touches the person's own VS Code profile and writes only under `--out`
 * and `qa/v5/`.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { _electron, chromium, type Browser, type ElectronApplication, type Frame, type Page } from "playwright-core";
import { vscodeExecutable } from "./prepare";
import { listProcesses, processTree, waitForExit } from "./processTree";
import { runStep, withTimeout, type StepContext } from "./ui-run";
import { buildFixture, buildStudioOverlay, fileStamps, findStudio, STUDIO_SHELL, V5_FIXTURE_DIR } from "./v5Fixtures";
import {
  acceptanceVerdict, boundaryFindings, describeV5Step, missingFeatures, offerOf, parseV5Acceptance, rowStatus,
  V5_REPORT_FORMAT, type BoundaryEvent, type JourneyOutcome, type RowOutcome, type SpawnTriggers, type TimelineMark, type V5Journey, type V5Part, type V5Row, type V5Step
} from "../../src/qa/v5/acceptance";

const REPO = path.resolve(__dirname, "..", "..");
const QA_V5 = path.join(REPO, "qa", "v5");
export const SHOTS_DIR = path.join(QA_V5, "shots");
const HARNESS = path.join(QA_V5, "harness");
const SIZE = { width: 1440, height: 900 };
/** Base user settings: light theme, quiet workbench, nothing that calls home, in-window dialogs (a native modal cannot be clicked). */
export const BASE_SETTINGS: Record<string, unknown> = {
  "workbench.colorTheme": "Default Light Modern",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "window.restoreWindows": "none",
  "window.zoomLevel": 0,
  "window.dialogStyle": "custom",
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

type StepOutcome = { status: "PASS" | "FAIL" | "NOT_RUN"; detail?: string };

interface Ctx {
  app?: ElectronApplication;
  /** The page UI steps act on: the VS Code window, or the Chromium page while one is open. */
  page: () => Promise<Page>;
  fixtureRoot: string; bridge: string; journeyId: string; outDir: string;
  /** Files the steps changed themselves. */
  touched: Set<string>;
  /** Files written by a confirmed action, with the stamp they had when accepted. */
  accepted: Map<string, string>;
  before: Map<string, string>;
  net: BoundaryEvent[];
  chromium?: { browser: Browser; page: Page };
}

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

/** The surfaces a step opens, for the spawn judge: views by name, commands by id (palette labels resolved), clicks by text. */
export function surfacesOf(step: V5Step, commandByLabel: ReadonlyMap<string, string>): string[] {
  switch (step.kind) {
    case "openView": return [`view:${step.name}`];
    case "run": return [`command:${commandByLabel.get(step.label) ?? step.label}`];
    case "command": return [`command:${step.id}`];
    case "click": return [`click:${step.text}`];
    case "quickPick": return [`click:${step.text}`];
    default: return [];
  }
}

/**
 * TL-1: every V5 feature is a GATED `v5.<feature>` key of `datapass.experience.overrides`, shown by default only in the
 * advanced preset. The run keeps the default preset (Galaxy and the other advanced views stay hidden) and switches on
 * every `v5.*` key this build declares plus `palette.full` (commands by palette label); a journey's own settings win.
 */
export function v5Overrides(pkg: unknown): Record<string, boolean> {
  const confs = (pkg as { contributes?: { configuration?: unknown } }).contributes?.configuration;
  const list = Array.isArray(confs) ? confs : confs ? [confs] : [];
  for (const c of list as Array<{ properties?: Record<string, { properties?: Record<string, unknown> }> }>) {
    const all = Object.keys(c.properties?.["datapass.experience.overrides"]?.properties ?? {});
    // `palette.full`: the journeys reach commands by their palette label (presentation only, no feature).
    const keys = all.filter(k => k.startsWith("v5.") || k === "palette.full");
    if (keys.length) return Object.fromEntries(keys.map(k => [k, true]));
  }
  return {};
}

/** Palette label → command id, from package.json contributes.commands. */
export function commandLabels(pkg: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const cmds = (pkg as { contributes?: { commands?: Array<{ command?: string; title?: string; category?: string }> } }).contributes?.commands ?? [];
  for (const c of cmds) if (c.command && c.title) out.set(c.category ? `${c.category}: ${c.title}` : c.title, c.command);
  return out;
}

/** Every visible element matching `selector` in the page and its frames, with its box. */
async function boxes(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }[]> {
  const out: { x: number; y: number; width: number; height: number }[] = [];
  for (const frame of page.frames() as Frame[]) {
    let all: Awaited<ReturnType<Frame["$$"]>> = [];
    try { all = await frame.$$(selector); } catch { continue; }
    for (const h of all) {
      const b = await h.boundingBox().catch(() => null);
      if (b && b.width > 0 && b.height > 0) out.push(b);
    }
  }
  return out;
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function answerNextOpenDialog(app: ElectronApplication | undefined, file: string): Promise<void> {
  if (!app) throw new Error("no VS Code window to answer a file dialog in");
  await app.evaluate(({ dialog }, f) => {
    const d = dialog as unknown as { showOpenDialog: (...a: unknown[]) => Promise<unknown> };
    const original = d.showOpenDialog;
    d.showOpenDialog = async () => { d.showOpenDialog = original; return { canceled: false, filePaths: [f] }; };
  }, file);
}

/**
 * The next native save dialog (Electron's, in VS Code's main process) is accepted as offered, once: the person
 * presses Save on the default location. No default offered = the person has nowhere to press Save: cancelled.
 */
async function acceptNextSaveDialog(app: ElectronApplication | undefined): Promise<void> {
  if (!app) throw new Error("no VS Code window to answer a save dialog in");
  await app.evaluate(({ dialog }) => {
    const d = dialog as unknown as { showSaveDialog: (...a: unknown[]) => Promise<unknown> };
    const original = d.showSaveDialog;
    d.showSaveDialog = async (...a: unknown[]) => {
      d.showSaveDialog = original;
      const opts = a.find(x => !!x && typeof x === "object" && "defaultPath" in (x as object)) as { defaultPath?: unknown } | undefined;
      const file = typeof opts?.defaultPath === "string" && opts.defaultPath ? opts.defaultPath : undefined;
      return file ? { canceled: false, filePath: file } : { canceled: true, filePath: "" };
    };
  });
}

/** Chromium with the network off: offline, and every request that is not file:/data:/blob: aborted and recorded. */
async function openOffline(file: string, net: BoundaryEvent[]): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: SIZE, colorScheme: "light", offline: true });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (/^(file|data|blob):/.test(url)) return route.continue();
    let host = url; try { host = new URL(url).host; } catch { /* keep the raw url */ }
    net.push({ kind: "net", via: "chromium (network off)", target: host || url });
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  return { browser, page };
}

async function runV5Step(ctx: Ctx, step: V5Step): Promise<StepOutcome> {
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
      await answerNextOpenDialog(ctx.app, file);
      return { status: "PASS" };
    }
    case "chooseSave":
      await acceptNextSaveDialog(ctx.app);
      return { status: "PASS" };
    case "chooseCassette": {
      const file = path.join(V5_FIXTURE_DIR, "exchange", step.name);
      if (!fs.existsSync(file)) return { status: "FAIL", detail: `no cassette tests/fixtures/v5/exchange/${step.name}` };
      await answerNextOpenDialog(ctx.app, file);
      return { status: "PASS" };
    }
    case "appendFile": {
      const rel = step.match ? listFiles(ctx.fixtureRoot).find(f => new RegExp(step.path).test(f)) : step.path;
      if (!rel || !fs.existsSync(abs(rel))) return { status: "FAIL", detail: `no fixture file ${step.match ? `matches /${step.path}/` : step.path}` };
      fs.appendFileSync(abs(rel), step.text); ctx.touched.add(rel);
      return { status: "PASS", detail: rel };
    }
    case "deleteFile":
      // A journey that deletes a file that is not there tests nothing: fail instead of passing silently.
      if (!fs.existsSync(abs(step.path))) return { status: "FAIL", detail: `${step.path} does not exist` };
      fs.rmSync(abs(step.path), { force: true }); ctx.touched.add(step.path); return { status: "PASS" };
    case "acceptWrites": {
      // The confirmed action writes after its button closes: poll like expectFile does, and (V5HOLE16) keep polling
      // until its writes settle (2 s without a new or changed match), so a multi-file write is accepted whole instead
      // of only the files that landed before the first poll.
      const re = new RegExp(step.pattern);
      const end = Date.now() + 15_000;
      let hits: [string, string][] = [];
      let seen = "";
      let since = Date.now();
      for (;;) {
        hits = [...fileStamps(ctx.fixtureRoot)].filter(([f, s]) => re.test(f) && ctx.before.get(f) !== s);
        const sig = hits.map(([f, s]) => `${f}=${s}`).sort().join("|");
        if (sig !== seen) { seen = sig; since = Date.now(); }
        if ((hits.length && Date.now() - since >= 2_000) || Date.now() > end) break;
        await new Promise(r => setTimeout(r, 500));
      }
      for (const [f, s] of hits) ctx.accepted.set(f, s);
      return hits.length ? { status: "PASS", detail: `${hits.length} file(s)` } : { status: "FAIL", detail: `the confirmed action wrote no file matching /${step.pattern}/` };
    }
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
      // A command may rewrite the file just after its button closes: expectFileText waits for the text (15 s).
      const end = Date.now() + (step.kind === "expectFileText" ? 15_000 : 0);
      let hit: string | undefined; let has = false;
      for (;;) {
        const hits = listFiles(ctx.fixtureRoot).filter(f => re.test(f));
        hit = hits.find(f => fs.readFileSync(abs(f), "utf8").includes(step.text)) ?? hits[0];
        has = !!hit && fs.readFileSync(abs(hit), "utf8").includes(step.text);
        if (has || Date.now() > end) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (!hit) return { status: "FAIL", detail: `no file matches /${step.pattern}/` };
      if (step.kind === "expectFileText") return has ? { status: "PASS", detail: hit } : { status: "FAIL", detail: `${hit} does not contain "${step.text.slice(0, 60)}"` };
      return has ? { status: "FAIL", detail: `${hit} contains "${step.text.slice(0, 60)}"` } : { status: "PASS", detail: hit };
    }
    case "command": {
      const r = await bridgeCall(ctx.bridge, { op: "run", id: step.id, args: step.args ?? [] });
      return r.ok ? { status: "PASS", ...(r.pending ? { detail: "still running (picker open)" } : {}) } : { status: "FAIL", detail: r.error ?? "command failed" };
    }
    case "expectElement": {
      const page = await ctx.page();
      const end = Date.now() + step.timeoutMs;
      for (;;) {
        if ((await boxes(page, step.selector)).length) return { status: "PASS" };
        if (Date.now() > end) return { status: "FAIL", detail: `no visible element ${step.selector} within ${step.timeoutMs} ms` };
        await page.waitForTimeout(250);
      }
    }
    case "expectNoOverlap": {
      const b = await boxes(await ctx.page(), step.selector);
      if (b.length < 2) return { status: "FAIL", detail: `${b.length} visible element(s) ${step.selector}: nothing to compare` };
      for (let i = 0; i < b.length; i++) for (let k = i + 1; k < b.length; k++) {
        if (overlaps(b[i]!, b[k]!)) return { status: "FAIL", detail: `elements ${i + 1} and ${k + 1} of ${step.selector} overlap (${JSON.stringify(b[i])} / ${JSON.stringify(b[k])})` };
      }
      return { status: "PASS", detail: `${b.length} element(s), no overlap` };
    }
    case "expectClipboard": {
      if (!ctx.app) return { status: "FAIL", detail: "no VS Code window" };
      const text = await ctx.app.evaluate(({ clipboard }) => clipboard.readText());
      return text.includes(step.text) ? { status: "PASS" } : { status: "FAIL", detail: `the clipboard holds "${text.replace(/\s+/g, " ").slice(0, 80)}"` };
    }
    case "openInChromium": {
      const re = new RegExp(step.pattern);
      const hit = listFiles(ctx.fixtureRoot).find(f => re.test(f));
      if (!hit) return { status: "FAIL", detail: `no file matches /${step.pattern}/` };
      if (ctx.chromium) await ctx.chromium.browser.close().catch(() => undefined);
      ctx.chromium = await openOffline(abs(hit), ctx.net);
      return { status: "PASS", detail: hit };
    }
    case "click": {
      // A role click names one control: an exact name first ("Write" is not "Show the diff and write…"), then qa:ui's substring match.
      if (step.role) {
        const page = await ctx.page();
        const end = Date.now() + 15_000;
        for (;;) {
          for (const frame of page.frames() as Frame[]) {
            const loc = frame.getByRole(step.role, { name: step.text, exact: true }).filter({ visible: true }).first();
            if (await loc.isVisible().catch(() => false)) {
              try { await loc.click({ timeout: 10_000 }); } catch { await loc.click({ force: true, timeout: 5_000 }); }
              return { status: "PASS" };
            }
          }
          if (Date.now() > end) break;
          await page.waitForTimeout(250);
        }
      }
      const sctx: StepContext = { app: ctx.app as ElectronApplication, page: ctx.page, journeyId: ctx.journeyId, outDir: ctx.outDir, folder: ctx.fixtureRoot };
      const r = await runStep(sctx, step);
      if (r.status === "FAIL" && step.role) {
        // A list row (a Steps view step is `role=option`) is named by its whole content, and a labelled part of it
        // (the tables chips) gives its label, not its text: click the row of that role that shows the text, as a person would.
        const page = await ctx.page();
        for (const frame of page.frames() as Frame[]) {
          const loc = frame.getByRole(step.role).filter({ hasText: step.text }).filter({ visible: true }).first();
          if (await loc.isVisible().catch(() => false)) {
            try { await loc.click({ timeout: 10_000 }); } catch { await loc.click({ force: true, timeout: 5_000 }); }
            return { status: "PASS", detail: `the ${step.role} showing "${step.text}"` };
          }
        }
      }
      return { status: r.status, ...(r.detail ? { detail: r.detail } : {}) };
    }
    case "closeChromium":
      if (ctx.chromium) await ctx.chromium.browser.close().catch(() => undefined);
      ctx.chromium = undefined;
      return { status: "PASS" };
    default: {
      const sctx: StepContext = { app: ctx.app as ElectronApplication, page: ctx.page, journeyId: ctx.journeyId, outDir: ctx.outDir, folder: ctx.fixtureRoot };
      let r = await runStep(sctx, step);
      // Go to File returns nothing while VS Code still indexes a fresh window: retry twice before failing.
      for (let i = 0; step.kind === "openFile" && r.status === "FAIL" && /Go to File found no/.test(r.detail ?? "") && i < 2; i++) {
        await new Promise(res => setTimeout(res, 3_000));
        r = await runStep(sctx, step);
      }
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
      else if (e.kind === "spawn") events.push({ kind: "spawn", file: String(e.file), args: (e.args as string[]) ?? [], ...(typeof e.at === "number" ? { at: e.at } : {}) });
    } catch { /* torn line */ }
  }
  return { events, active };
}

interface RunEnv { executable?: string; studio?: string; triggers: SpawnTriggers; commandByLabel: ReadonlyMap<string, string>; v5Gates: Record<string, boolean>; out: string; log: (l: string) => void }

/** Runs the steps in order; the first failure leaves the rest NOT_RUN. Returns the outcomes and the step timeline. */
/**
 * A journey's first command needs the DataPass session, which loads after activation. Wait until the extension is
 * active, then (up to 20 s) until the company status item shows the project instead of the folder name. Never fails:
 * a fixture without a project title just starts after the wait.
 */
async function waitForProject(bridge: string, page: Page, folder: string): Promise<void> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const active = await bridgeCall(bridge, { op: "active" }, 5_000);
    if (active.ok && active.value === true) break;
    await page.waitForTimeout(500);
  }
  const item = page.locator('.statusbar-item[id$="datapass.company"]').first();
  while (Date.now() < end) {
    const text = (await item.innerText({ timeout: 1_000 }).catch(() => "")).trim();
    if (text && !text.startsWith(folder)) return;
    await page.waitForTimeout(500);
  }
}

async function runSteps(ctx: Ctx, journey: V5Journey, env: RunEnv): Promise<{ steps: JourneyOutcome["steps"]; timeline: TimelineMark[] }> {
  const steps: JourneyOutcome["steps"] = [];
  const timeline: TimelineMark[] = [];
  let failed = false;
  for (const [i, step] of journey.steps.entries()) {
    const label = describeV5Step(step);
    if (failed) { steps.push({ step: label, status: "NOT_RUN", detail: "an earlier step failed" }); continue; }
    timeline.push({ at: Date.now(), surfaces: surfacesOf(step, env.commandByLabel) });
    let r: StepOutcome;
    try { r = await runV5Step(ctx, step); } catch (e) { r = { status: "FAIL", detail: e instanceof Error ? e.message.split("\n")[0]! : String(e) }; }
    if (r.status === "FAIL") {
      failed = true;
      try { await (await ctx.page()).screenshot({ path: path.join(ctx.outDir, `fail-step-${i + 1}.png`) }); } catch { /* window gone */ }
    }
    steps.push({ step: label, status: r.status, ...(r.detail ? { detail: r.detail } : {}) });
    env.log(`  ${r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "–"} ${i + 1}. ${label}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  return { steps, timeline };
}

function outcome(journey: V5Journey, steps: JourneyOutcome["steps"], boundary: string[], blocked: string | undefined): JourneyOutcome {
  const failedStep = steps.find(s => s.status === "FAIL");
  const status = blocked || failedStep || steps.some(s => s.status !== "PASS") ? "FAIL" : "PASS";
  return { id: journey.id, kind: journey.kind, boundary, steps, status,
    ...(blocked ? { detail: blocked } : failedStep ? { detail: `${failedStep.step}: ${failedStep.detail ?? "failed"}` } : {}) };
}

async function driveJourney(journey: V5Journey, env: RunEnv): Promise<JourneyOutcome> {
  if (journey.cut) return { id: journey.id, kind: journey.kind, boundary: [], steps: [], status: "CUT", detail: journey.cut };
  if (journey.host === "chromium") return driveChromiumJourney(journey, env);
  const executable = env.executable!;
  const dir = path.join(env.out, journey.id);
  fs.rmSync(dir, { recursive: true, force: true });
  const fixtureRoot = path.join(dir, "fixture");
  const open = buildFixture(journey.fixture, fixtureRoot);
  const before = fileStamps(fixtureRoot);
  const user = path.join(dir, "user"); const home = path.join(dir, "home"); const bridge = path.join(dir, "bridge"); const spyLog = path.join(dir, "spy.jsonl");
  fs.mkdirSync(path.join(user, "User"), { recursive: true }); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(bridge, { recursive: true });
  fs.writeFileSync(path.join(user, "User", "settings.json"), JSON.stringify({ ...BASE_SETTINGS, "datapass.experience.overrides": env.v5Gates, ...(journey.settings ?? {}) }, null, 2));
  env.log(`▶ ${journey.id} (${journey.kind}) ${journey.title} — ${journey.fixture}`);

  const procEnv = { ...process.env, HOME: home, USERPROFILE: home, DATAPASS_QA_SPY_LOG: spyLog, DATAPASS_QA_EXT_ROOT: REPO, DATAPASS_QA_BRIDGE: bridge } as Record<string, string>;
  delete procEnv.ELECTRON_RUN_AS_NODE;
  const devPaths = [REPO, path.join(HARNESS, "spy"), ...(journey.stubs ?? []).map(s => path.join(HARNESS, s))];
  let app: ElectronApplication | undefined;
  let steps: JourneyOutcome["steps"] = [];
  let timeline: TimelineMark[] = [];
  let blocked: string | undefined;
  const ctx: Ctx = { page: async () => { throw new Error("VS Code is not running"); }, fixtureRoot, bridge, journeyId: journey.id, outDir: dir, touched: new Set(), accepted: new Map(), before, net: [] };
  try {
    try {
      app = await _electron.launch({
        executablePath: executable, env: procEnv, timeout: 120_000,
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
      if (!blocked) await waitForProject(bridge, first, path.basename(fixtureRoot));
    } catch (e) { blocked = e instanceof Error ? e.message.split("\n")[0]! : String(e); }
    if (!blocked && app) {
      const a = app;
      ctx.app = a;
      ctx.page = async (): Promise<Page> => {
        if (ctx.chromium) return ctx.chromium.page;
        const wins = a.windows().filter(w => !w.isClosed() && !w.url().startsWith("devtools:"));
        return wins.at(-1) ?? a.firstWindow();
      };
      ({ steps, timeline } = await runSteps(ctx, journey, env));
    }
  } finally {
    if (ctx.chromium) await ctx.chromium.browser.close().catch(() => undefined);
    const pid = app?.process().pid;
    const tree = pid ? processTree(pid, listProcesses()) : [];
    if (app) await withTimeout(app.close().catch(() => undefined), 30_000);
    await waitForExit(tree);
  }
  const spy = readSpy(spyLog);
  const after = fileStamps(fixtureRoot);
  const writes: BoundaryEvent[] = [...after].filter(([f, s]) => before.get(f) !== s && ctx.accepted.get(f) !== s).map(([f]) => ({ kind: "write", path: f }));
  for (const f of before.keys()) if (!after.has(f)) writes.push({ kind: "write", path: f });
  const boundary = boundaryFindings([...spy.events, ...ctx.net, ...writes], ctx.touched, { timeline, triggers: env.triggers });
  if (!spy.active && !blocked) boundary.push("boundary spy did not load: network/process checks not run");
  for (const b of boundary) env.log(`  ! ${b}`);
  return outcome(journey, steps, boundary, blocked ? `VS Code could not be driven: ${blocked}` : undefined);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".csv": "text/csv", ".parquet": "application/vnd.apache.parquet", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2"
};

/** Loopback static server: `overlay` first (the journey's synthetic workspace), then the Studio checkout. Static files only. */
async function serveStudio(studio: string, overlay: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(/^\/+/, "");
    if (rel.split("/").includes("..")) { res.writeHead(400).end(); return; }
    const file = [overlay, studio].map(r => path.join(r, ...rel.split("/"))).find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(() => r())) };
}

/**
 * A Studio journey (TL-3, row 14): the built shell of a datapass-studio checkout in Playwright Chromium, served on
 * loopback; the first step is implicit (open the journey's workspace). Boundaries: every request leaving loopback is
 * a finding, and the shell's sources and build must not name datapass-vscode-cloud (nothing imported from it).
 */
async function driveChromiumJourney(journey: V5Journey, env: RunEnv): Promise<JourneyOutcome> {
  const dir = path.join(env.out, journey.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  env.log(`▶ ${journey.id} (${journey.kind}) ${journey.title} — ${journey.fixture} (Chromium)`);
  const studio = env.studio;
  if (!studio) return outcome(journey, [], [], "no datapass-studio checkout found: pass --studio <folder> or set DATAPASS_STUDIO_DIR");
  if (!fs.existsSync(path.join(studio, STUDIO_SHELL, "index.html"))) return outcome(journey, [], [], `the Studio shell is not built in ${studio}: run npm run build:shell there`);
  const net: BoundaryEvent[] = [];
  const boundary: string[] = [];
  const cloudRefs = cloudImports(studio);
  for (const f of cloudRefs) boundary.push(`build: ${f} names datapass-vscode-cloud (Studio imports nothing from it, TL-3)`);
  const overlay = path.join(dir, "overlay");
  const workspace = buildStudioOverlay(journey.fixture, studio, overlay);
  const server = await serveStudio(studio, overlay);
  const browser = await chromium.launch({ headless: true });
  let steps: JourneyOutcome["steps"] = [];
  let timeline: TimelineMark[] = [];
  let blocked: string | undefined;
  try {
    const context = await browser.newContext({ viewport: SIZE, colorScheme: "light" });
    const page = await context.newPage();
    page.on("request", r => {
      const url = r.url();
      if (url.startsWith(server.origin) || /^(data|blob):/.test(url)) return;
      let host = url; try { host = new URL(url).host; } catch { /* raw */ }
      net.push({ kind: "net", via: "chromium", target: host });
    });
    try {
      await page.goto(`${server.origin}/${STUDIO_SHELL}/index.html?workspace=${encodeURIComponent(workspace)}`, { timeout: 60_000 });
    } catch (e) { blocked = `Studio did not open: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`; }
    if (!blocked) {
      const ctx: Ctx = { page: async () => page, fixtureRoot: overlay, bridge: "", journeyId: journey.id, outDir: dir, touched: new Set(), accepted: new Map(), before: new Map(), net };
      ({ steps, timeline } = await runSteps(ctx, journey, env));
    }
  } finally {
    await browser.close().catch(() => undefined);
    await server.close();
  }
  boundary.push(...boundaryFindings(net, new Set(), { timeline, triggers: env.triggers }));
  for (const b of boundary) env.log(`  ! ${b}`);
  return outcome(journey, steps, boundary, blocked);
}

/** Files of the Studio shell (sources, config, build) that name datapass-vscode-cloud. */
function cloudImports(studio: string): string[] {
  const shell = path.join(studio, "apps", "studio-shell");
  const hits: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|jsx|ts|tsx|json|html)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("datapass-vscode-cloud")) hits.push(path.relative(studio, p).split(path.sep).join("/"));
    }
  };
  for (const d of ["src", "dist"]) walk(path.join(shell, d));
  for (const f of ["package.json", "vite.config.js"]) { const p = path.join(shell, f); if (fs.existsSync(p) && fs.readFileSync(p, "utf8").includes("datapass-vscode-cloud")) hits.push(`apps/studio-shell/${f}`); }
  return hits;
}

export async function runV5(opts: { rows?: string[]; part?: V5Part; code?: string; studio?: string; out: string; log?: (l: string) => void }): Promise<{ code: 0 | 1 | 2; rows: RowOutcome[] }> {
  const log = opts.log ?? (l => console.log(l));
  const acceptance = parseV5Acceptance(fs.readFileSync(path.join(QA_V5, "acceptance.json"), "utf8"));
  const part = opts.part ?? acceptance.part;
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as unknown;
  const offer = offerOf(pkg, rel => fs.existsSync(path.join(REPO, ...rel.split("/"))));
  if (!fs.existsSync(path.join(REPO, "dist", "extension.js"))) { console.error("✗ dist/extension.js is missing: run npm run build first"); return { code: 2, rows: [] }; }
  const env: RunEnv = { triggers: acceptance.spawnTriggers, commandByLabel: commandLabels(pkg), v5Gates: v5Overrides(pkg), out: opts.out, log, studio: findStudio(REPO, opts.studio ?? process.env.DATAPASS_STUDIO_DIR) };
  const outcomes: RowOutcome[] = [];
  const inPart = (row: V5Row) => part === "all" || row.part === part;
  for (const row of acceptance.rows) {
    if (opts.rows && !opts.rows.includes(row.id)) continue;
    const missing = row.cut || !inPart(row) ? [] : missingFeatures(row, offer);
    const journeys: JourneyOutcome[] = [];
    if (!row.cut && inPart(row) && !missing.length) {
      for (const j of row.journeys) {
        if (!j.cut && j.host !== "chromium") env.executable ??= await vscodeExecutable(opts.code);
        journeys.push(await driveJourney(j, env));
      }
    }
    const { status, detail } = rowStatus(row, part, missing, journeys);
    outcomes.push({ id: row.id, title: row.title, status, detail, ...(missing.length ? { missing } : {}), journeys, shots: row.shots.filter(s => fs.existsSync(path.join(SHOTS_DIR, `${s}.png`))) });
    log(`${status === "green" ? "✓" : status === "cut" || status === "deferred" || status === "pending-merge" ? "–" : "✗"} row ${row.id} ${row.title}: ${status} — ${detail}`);
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

/** Kept for symmetry with qa:ui. */
export const rowsOfPart = (rows: readonly V5Row[], part: V5Part) => rows.filter(r => part === "all" || r.part === part);

if (require.main === module) {
  const argv = process.argv.slice(2);
  const value = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const part = value("part");
  void runV5({
    rows: value("rows")?.split(",").map(s => s.trim()).filter(Boolean),
    part: part === "a" || part === "b" || part === "all" ? part : undefined,
    code: value("code"),
    studio: value("studio"),
    out: path.resolve(value("out") ?? path.join(REPO, "out", "qa-v5"))
  }).then(r => process.exit(r.code), e => { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(2); });
}
