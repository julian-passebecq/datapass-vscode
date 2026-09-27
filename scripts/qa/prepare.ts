/**
 * `npm run qa:prepare -- --auto <test repository clone> --root <run root> [--vsix <file>] [--sha256 <hex>] [--datapass-version <v>] [--commit <released commit>] [--rc] [--clone] [--code <VS Code executable>] [--launch]`
 * `npm run qa:prepare -- --auto <test repository clone> --check [--report <report.json>]` validates a test repository only.
 *
 * The mechanical part of a Codex test run (handoff/v3/12 §4.3, QA-1): validate the configuration and
 * every journey, check that each declared folder is under the run root with the declared origin (it
 * never clones), install the VSIX into an isolated VS Code profile under the run root, write one
 * `.code-workspace` per client (bridge first) and `run.json`, and print the launch command.
 *
 * V1-AUTO: `--rc` adds DataPass's own release journeys (`qa/rc/journeys/`, kind "app") to the client's;
 * each journey gets its launch command (trusted or Restricted Mode; the client workspace, a fresh copy
 * of a public example under `fixtures/<id>`, or an empty window with `scratch/<id>`). `--sha256` pins
 * the VSIX, `--datapass-version` tests another version than the configuration names, `--clone` clones
 * the declared folders that are missing. It then writes `CODEX_PROMPT.md`: the one prompt to paste into
 * a Codex desktop thread.
 *
 * V1-AUTO-2: it also compiles every journey (src/qa/ui/compile.ts) into `<run root>/ui-journeys/`, the
 * functional gate that `npm run qa:ui -- <run root> <run root>/ui-journeys` runs; a journey without UI
 * steps (its own `ui`, or DataPass's proposal in `qa/ui/<client id>.json`) is listed "not automatable".
 *
 * Exit 0 = ready; 2 = cannot prepare (every reason is printed). It never touches the person's own VS
 * Code profile, never pushes, publishes or calls a cloud CLI, and writes only under the run root.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from "@vscode/test-electron";
import { buildCompanyWorkspace } from "../../src/core/windows/company";
import { isInside } from "../../src/core/exchange/pathSafety";
import { remoteIdentity } from "../../src/core/project/gitHosts";
import { codexRunPrompt, CODEX_PROMPT_FILE, type PromptJourney } from "../../src/qa/codexPrompt";
import { compileJourney, compileSummary, parseUiSteps, type UiStepsFile } from "../../src/qa/ui/compile";
import { parseUiJourney } from "../../src/qa/ui/journey";
import {
  CODEX_TESTS_FILE, QA_REPORT_FORMAT, QA_RUN_FILE, QA_RUN_FORMAT, QaFormatError, parseCodexTests, parseQaReport, parseQaRun, parseTestJourney, runIdOf, openPath, SCREEN_PATTERN,
  type ClientWorkspace, type CodexTestsConfig, type FolderRef, type TestJourney
} from "../../src/qa/formats";

export const EXTENSION_ID = "julian-passebecq.datapass-vscode";
export const USER_DATA_DIR = ".vscode-user";
export const EXTENSIONS_DIR = ".vscode-ext";
/** This checkout: DataPass's release journeys and the public examples their fixtures copy. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const RC_JOURNEYS_DIR = path.join(REPO_ROOT, "qa", "rc");
const EXAMPLES_DIR = path.join(REPO_ROOT, "examples", "v3");
/** doc 12 §4.1 named the file datapass-auto.json before the addendum; both are read. */
const CONFIG_NAMES = [CODEX_TESTS_FILE, "datapass-auto.json"];

export interface PrepareOptions {
  auto: string; root: string; vsix?: string; code?: string;
  /** The released commit the VSIX was built from (no tags: PLAN.md records it), recorded in run.json. */
  commit?: string;
  /** Also start each client's isolated VS Code (detached): qa:prepare is the launcher, Codex never launches it from its sandbox. */
  launch?: boolean;
  /** A folder of DataPass's own journeys to add (`qa/rc` with `--rc`): `<dir>/journeys/*.json`, kind "app". */
  vendor?: string;
  /** The VSIX's expected SHA-256: another file is refused before anything is installed. */
  sha256?: string;
  /** The DataPass version this run tests, when it is not the one the configuration names. */
  datapassVersion?: string;
  /** Clone the declared folders that are missing under the run root (at their ref and commit). */
  clone?: boolean;
  now?: Date; log?: (line: string) => void;
}
export interface PrepareResult { code: 0 | 2; reasons: string[]; runFile?: string; promptFile?: string; workspaceFiles: string[]; launch: string[] }

class CannotPrepare extends Error { constructor(readonly reasons: string[]) { super(reasons.join("\n")); } }

function git(cwd: string, ...args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function readConfig(auto: string): { config: CodexTestsConfig; file: string } {
  const name = CONFIG_NAMES.find(n => fs.existsSync(path.join(auto, n)));
  if (!name) throw new CannotPrepare([`no ${CONFIG_NAMES.join(" or ")} in ${auto}`]);
  const file = path.join(auto, name);
  try { return { config: parseCodexTests(fs.readFileSync(file), name), file }; }
  catch (e) { throw new CannotPrepare(e instanceof QaFormatError ? e.issues.map(i => `${name}: ${i}`) : [String(e)]); }
}

function readJourneys(auto: string, config: CodexTestsConfig): Array<TestJourney & { file: string }> {
  const reasons: string[] = [];
  const out: Array<TestJourney & { file: string }> = [];
  const realAuto = fs.realpathSync(auto);
  for (const rel of config.journeys) {
    const file = path.join(auto, rel);
    if (!fs.existsSync(file)) { reasons.push(`${rel}: file not found in the test repository`); continue; }
    if (!isInside(realAuto, fs.realpathSync(file))) { reasons.push(`${rel}: resolves outside the test repository`); continue; }
    try { out.push({ ...parseTestJourney(fs.readFileSync(file), rel), file: rel }); }
    catch (e) { reasons.push(...(e instanceof QaFormatError ? e.issues.map(i => `${rel}: ${i}`) : [`${rel}: ${String(e)}`])); }
  }
  const ids = new Map<string, string>();
  for (const j of out) {
    if (ids.has(j.id)) reasons.push(`${j.file}: journey id ${j.id} is also used by ${ids.get(j.id)}`);
    ids.set(j.id, j.file);
    if (j.kind !== config.purpose) reasons.push(`${j.file}: kind "${j.kind}" in a "${config.purpose}" configuration`);
    if (j.setup?.client && !config.workspaces.some(w => w.client.id === j.setup!.client)) reasons.push(`${j.file}: setup.client "${j.setup.client}" is not one of the configured clients (${config.workspaces.map(w => w.client.id).join(", ")})`);
  }
  if (reasons.length) throw new CannotPrepare(reasons);
  return out;
}

/** DataPass's own journeys: every `<dir>/journeys/*.json`, kind "app", no client, ids distinct from the client's. */
export function readVendorJourneys(dir: string, taken: ReadonlyArray<{ id: string; file: string }> = []): Array<TestJourney & { file: string }> {
  const reasons: string[] = [];
  const out: Array<TestJourney & { file: string }> = [];
  const jdir = path.join(dir, "journeys");
  if (!fs.existsSync(jdir)) throw new CannotPrepare([`no journeys folder in ${dir}`]);
  const ids = new Map(taken.map(t => [t.id, t.file]));
  for (const name of fs.readdirSync(jdir).filter(n => n.endsWith(".json")).sort()) {
    const rel = `journeys/${name}`;
    try {
      const j = parseTestJourney(fs.readFileSync(path.join(jdir, name)), rel);
      if (j.kind !== "app") reasons.push(`${rel}: a DataPass release journey is kind "app", not "${j.kind}"`);
      if (j.setup?.client) reasons.push(`${rel}: a DataPass release journey names no client (setup.client)`);
      if (ids.has(j.id)) reasons.push(`${rel}: journey id ${j.id} is also used by ${ids.get(j.id)}`);
      ids.set(j.id, rel);
      if (j.setup?.fixture !== undefined && !fs.existsSync(path.join(EXAMPLES_DIR, j.setup.fixture, ".datapass"))) reasons.push(`${rel}: fixture ${j.setup.fixture} is not an example under examples/v3/`);
      out.push({ ...j, file: `qa/${path.basename(dir)}/${rel}` });
    } catch (e) { reasons.push(...(e instanceof QaFormatError ? e.issues.map(i => `${rel}: ${i}`) : [`${rel}: ${String(e)}`])); }
  }
  if (!out.length && !reasons.length) reasons.push(`no journeys in ${jdir}`);
  if (reasons.length) throw new CannotPrepare(reasons);
  return out;
}

/** `--clone`: clone each declared folder that is missing; a folder that exists is left alone (checkFolders checks it). */
function cloneMissing(root: string, workspaces: ClientWorkspace[], log: (line: string) => void): void {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const ref of workspaces.flatMap(w => [w.bridge, ...w.repositories])) {
    if (seen.has(ref.folder.toLowerCase())) continue;
    seen.add(ref.folder.toLowerCase());
    const dir = path.join(root, ref.folder);
    if (fs.existsSync(dir)) continue;
    const r = spawnSync("git", ["clone", "-q", ...(ref.ref ? ["--branch", ref.ref] : []), "--", ref.remote, dir], { encoding: "utf8", windowsHide: true, timeout: 600_000 });
    if (r.status !== 0) { reasons.push(`cannot clone ${ref.remote} into ${ref.folder}: ${(r.stderr || String(r.error ?? "")).trim().slice(0, 300)}`); continue; }
    if (ref.commit && git(dir, "checkout", "-q", ref.commit) === undefined) reasons.push(`${ref.folder}: cloned, but commit ${ref.commit} cannot be checked out`);
    log(`✓ cloned ${ref.remote} into ${ref.folder}`);
  }
  if (reasons.length) throw new CannotPrepare(reasons);
}

interface CheckedRepo { folder: string; remote: string; commit: string }
const withPath = (repo: CheckedRepo, ref: FolderRef) => (ref.path ? { folder: repo.folder, path: ref.path, remote: repo.remote, commit: repo.commit } : repo);

/** Each declared folder exists under the root, is a Git clone, and its origin is the declared remote. */
function checkFolders(root: string, workspaces: ClientWorkspace[]): Map<string, CheckedRepo> {
  const reasons: string[] = [];
  const out = new Map<string, CheckedRepo>();
  const realRoot = fs.realpathSync(root);
  const check = (who: string, ref: FolderRef) => {
    cloneOf(who, ref);
    if (ref.path === undefined || !out.has(ref.folder)) return;
    const sub = path.join(root, ref.folder, ref.path);
    if (!fs.existsSync(sub) || !fs.statSync(sub).isDirectory()) reasons.push(`${who}: ${ref.path} is not a folder inside ${ref.folder}`);
    else if (!isInside(fs.realpathSync(path.join(root, ref.folder)), fs.realpathSync(sub))) reasons.push(`${who}: ${ref.folder}/${ref.path} resolves outside the clone`);
  };
  const cloneOf = (who: string, ref: FolderRef) => {
    if (out.has(ref.folder)) return;
    const dir = path.join(root, ref.folder);
    if (!fs.existsSync(dir)) { reasons.push(`${who}: folder ${ref.folder} is missing under the run root (clone ${ref.remote} there)`); return; }
    if (!isInside(realRoot, fs.realpathSync(dir))) { reasons.push(`${who}: folder ${ref.folder} resolves outside the run root`); return; }
    const origin = git(dir, "config", "--get", "remote.origin.url");
    if (origin === undefined) { reasons.push(`${who}: ${ref.folder} has no Git origin (is it a clone of ${ref.remote}?)`); return; }
    if (remoteIdentity(origin) !== remoteIdentity(ref.remote)) { reasons.push(`${who}: ${ref.folder} is a clone of ${origin.replace(/\/\/[^@/]+@/, "//")}, not ${ref.remote}`); return; }
    const commit = git(dir, "rev-parse", "HEAD");
    if (!commit || !/^[a-f0-9]{40}$/.test(commit)) { reasons.push(`${who}: ${ref.folder} has no commit`); return; }
    out.set(ref.folder, { folder: ref.folder, remote: ref.remote, commit });
  };
  for (const w of workspaces) {
    check(`${w.client.id} bridge`, w.bridge);
    w.repositories.forEach(r => check(`${w.client.id} repository`, r));
  }
  if (reasons.length) throw new CannotPrepare(reasons);
  return out;
}

export async function vscodeExecutable(explicit?: string): Promise<string> {
  const pick = explicit ?? process.env.VSCODE_EXECUTABLE;
  if (pick) {
    if (!fs.existsSync(pick)) throw new CannotPrepare([`VS Code executable not found: ${pick}`]);
    return pick;
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const installed = path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe");
    if (fs.existsSync(installed)) return installed;
  }
  return downloadAndUnzipVSCode("stable");
}

/** Run the VS Code CLI (never the person's profile: every call passes both isolation flags). */
export function cli(executable: string, args: string[]): string {
  const bin = resolveCliPathFromVSCodeExecutablePath(executable);
  const r = process.platform === "win32"
    // code.cmd needs a shell (CVE-2024-27980); every argument is quoted.
    ? spawnSync([bin, ...args].map(a => `"${a.replace(/"/g, "")}"`).join(" "), { shell: true, encoding: "utf8", windowsHide: true, timeout: 180_000 })
    : spawnSync(bin, args, { encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) throw new CannotPrepare([`VS Code CLI failed (${args.filter(a => a.startsWith("--") && !a.endsWith("-dir")).join(" ")}): ${(r.stderr || r.stdout || String(r.error ?? "")).trim().slice(0, 500)}`]);
  return r.stdout;
}

/** The shell capture the agent runs for each screen (Codex Computer Use saves none); `<file>` = `screens/<journey id>-<what>.png`. */
export function captureCommand(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "powershell -NoProfile -Command \"Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; [System.Drawing.Graphics]::FromImage($i).CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('<file>')\"";
  if (platform === "darwin") return "screencapture -x <file>";
  return "import -window root <file>";
}

const quote = (s: string) => (/[\s"]/.test(s) ? `"${s}"` : s);

/**
 * What a journey's VS Code opens (the launch arguments after the isolation flags), making its folder
 * fresh: a copy of a public example under `fixtures/<id>` (never trusted before, disposable), an empty
 * `scratch/<id>` beside an empty window, or the client's `.code-workspace`. qa:prepare and qa:ui both call it.
 */
export function journeyTarget(root: string, id: string, setup: { open?: string; fixture?: string }, clientId: string): { target: string[]; folder?: string } {
  if (setup.open === "fixture" && setup.fixture) {
    const folder = path.join(root, "fixtures", id);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.cpSync(path.join(EXAMPLES_DIR, setup.fixture), folder, { recursive: true });
    return { target: ["--new-window", folder], folder };
  }
  if (setup.open === "empty") {
    const folder = path.join(root, "scratch", id);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    return { target: ["--new-window"], folder };
  }
  return { target: [path.join(root, `${clientId}.code-workspace`)] };
}

/** `<run root>/ui-journeys/`: one `<id>.json` (datapass.ui-journey) per automatable journey, and index.json in run order. */
export const UI_JOURNEYS_DIR = "ui-journeys";
export const UI_INDEX_FILE = "index.json";
/** DataPass's proposed UI steps for a client's journeys: `qa/ui/<client id>.json` (datapass.ui-steps). */
export const VENDOR_STEPS_DIR = path.join(REPO_ROOT, "qa", "ui");
export interface UiIndexEntry { id: string; title: string; features: string[]; source: "client" | "vendor"; file?: string; notAutomatable?: string }

export function compileRun(root: string, list: Array<{ j: TestJourney & { file: string }; source: "client" | "vendor" }>, clientId: string, stepsDir = VENDOR_STEPS_DIR): { total: number; automatable: number; lines: string[]; notAutomatable: Array<{ id: string; reason: string }> } {
  const dir = path.join(root, UI_JOURNEYS_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const stepsFile = path.join(stepsDir, `${clientId}.json`);
  let vendor: UiStepsFile | undefined;
  if (fs.existsSync(stepsFile)) {
    try { vendor = parseUiSteps(fs.readFileSync(stepsFile), path.basename(stepsFile)); }
    catch (e) { throw new CannotPrepare(e instanceof QaFormatError ? e.issues.map(i => `qa/ui/${path.basename(stepsFile)}: ${i}`) : [String(e)]); }
    if (vendor.client !== clientId) throw new CannotPrepare([`qa/ui/${path.basename(stepsFile)} is for client ${vendor.client}, not ${clientId}`]);
  }
  const index: UiIndexEntry[] = [];
  const lines: string[] = [];
  for (const { j, source } of list) {
    const r = compileJourney(j, { file: j.file, ...(source === "client" && vendor ? { vendor: vendor.journeys.find(e => e.id === j.id) } : {}) });
    lines.push(compileSummary(r));
    const entry: UiIndexEntry = { id: j.id, title: j.title, features: j.features, source };
    if (r.ok) {
      const text = JSON.stringify(r.journey, null, 2) + "\n";
      parseUiJourney(text, `${j.id}.json`); // what we write must read back
      fs.writeFileSync(path.join(dir, `${j.id}.json`), text);
      entry.file = `${j.id}.json`;
    } else entry.notAutomatable = r.reason;
    index.push(entry);
  }
  fs.writeFileSync(path.join(dir, UI_INDEX_FILE), JSON.stringify({ journeys: index }, null, 2) + "\n");
  return { total: index.length, automatable: index.filter(e => e.file).length, lines, notAutomatable: index.filter(e => e.notAutomatable).map(e => ({ id: e.id, reason: e.notAutomatable! })) };
}

export async function prepare(opts: PrepareOptions): Promise<PrepareResult> {
  const log = opts.log ?? (line => console.log(line));
  const root = path.resolve(opts.root);
  const auto = path.resolve(opts.auto);
  try {
    if (!fs.existsSync(root)) throw new CannotPrepare([`run root not found: ${root}`]);
    if (!fs.existsSync(auto)) throw new CannotPrepare([`test repository not found: ${auto}`]);
    const { config } = readConfig(auto);
    const journeys = readJourneys(auto, config);
    log(`✓ ${config.purpose} configuration: ${config.workspaces.length} client(s), ${journeys.length} journey(s)`);
    const vendor = opts.vendor ? readVendorJourneys(path.resolve(opts.vendor), journeys) : [];
    if (vendor.length) {
      if (config.purpose !== "client") throw new CannotPrepare(["DataPass release journeys (--rc) run with a client configuration (one client workspace)"]);
      log(`✓ ${vendor.length} DataPass release journey(s) from ${opts.vendor}`);
    }
    if (opts.clone) cloneMissing(root, config.workspaces, log);
    const repos = checkFolders(root, config.workspaces);
    log(`✓ ${repos.size} folder(s) under the run root, each with the declared origin`);

    // The VSIX: an explicit file (relative to the current folder, as typed), else the configuration's
    // path relative to the run root.
    if (!opts.vsix && !config.datapass.vsix) throw new CannotPrepare(["no VSIX: pass --vsix <file> or set datapass.vsix (a path under the run root)"]);
    const vsix = opts.vsix ? path.resolve(opts.vsix) : path.resolve(root, config.datapass.vsix!);
    if (!fs.existsSync(vsix) || !/\.vsix$/i.test(vsix)) throw new CannotPrepare([`VSIX not found: ${vsix}`]);
    const sha256 = createHash("sha256").update(fs.readFileSync(vsix)).digest("hex");
    if (opts.sha256 !== undefined && opts.sha256.toLowerCase() !== sha256) throw new CannotPrepare([`the VSIX ${vsix} has sha256 ${sha256}, not the pinned ${opts.sha256.toLowerCase()}`]);
    if (opts.datapassVersion !== undefined && !/^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/.test(opts.datapassVersion)) throw new CannotPrepare([`--datapass-version must be a version such as 1.0.0-rc.1, got ${JSON.stringify(opts.datapassVersion)}`]);
    const expectedVersion = opts.datapassVersion ?? config.datapass.version;
    if (opts.commit !== undefined && !/^[a-f0-9]{7,40}$/.test(opts.commit)) throw new CannotPrepare([`--commit must be the released commit (7 to 40 lowercase hex), got ${JSON.stringify(opts.commit)}`]);

    const executable = await vscodeExecutable(opts.code);
    const userDataDir = path.join(root, USER_DATA_DIR);
    const extensionsDir = path.join(root, EXTENSIONS_DIR);
    const isolation = ["--user-data-dir", userDataDir, "--extensions-dir", extensionsDir];
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });
    const [vscodeVersion, vscodeCommit] = cli(executable, [...isolation, "--version"]).split(/\r?\n/).map(s => s.trim());
    cli(executable, [...isolation, "--install-extension", vsix, "--force"]);
    const installed = cli(executable, [...isolation, "--list-extensions", "--show-versions"]).split(/\r?\n/).map(s => s.trim()).find(l => l.toLowerCase().startsWith(`${EXTENSION_ID}@`));
    const installedVersion = installed?.split("@")[1];
    if (!installedVersion) throw new CannotPrepare([`the VSIX installed, but ${EXTENSION_ID} is not listed in ${EXTENSIONS_DIR}`]);
    if (installedVersion !== expectedVersion) throw new CannotPrepare([`the VSIX is DataPass ${installedVersion}; ${opts.datapassVersion ? "--datapass-version" : "the configuration"} expects ${expectedVersion}`]);
    log(`✓ DataPass ${installedVersion} installed in ${EXTENSIONS_DIR} (VS Code ${vscodeVersion}, isolated profile ${USER_DATA_DIR})`);

    const runId = runIdOf(config, opts.now ?? new Date());
    // The test clones are trusted by construction: no Restricted Mode prompt in front of the journeys.
    const launchArgs = (file: string) => [...isolation, "--disable-workspace-trust", file];
    const commandOf = (args: string[]) => [executable, ...args].map(quote).join(" ");
    const workspaceFiles: string[] = [];
    const launch: string[] = [];
    const clients = config.workspaces.map(w => {
      const file = path.join(root, `${w.client.id}.code-workspace`);
      const { doc } = buildCompanyWorkspace({ file, company: w.client.title, folders: [w.bridge, ...w.repositories].map(r => path.join(root, openPath(r))) });
      fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
      workspaceFiles.push(file);
      const command = commandOf(launchArgs(file));
      launch.push(command);
      return { id: w.client.id, title: w.client.title, workspaceFile: path.basename(file), bridge: withPath(repos.get(w.bridge.folder)!, w.bridge), repositories: w.repositories.map(r => withPath(repos.get(r.folder)!, r)), launch: command };
    });
    const run = {
      format: QA_RUN_FORMAT, version: 1, runId, purpose: config.purpose, createdAt: new Date().toISOString(),
      datapass: { version: installedVersion, sha256, ...(opts.commit ? { commit: opts.commit } : {}), vsix: path.basename(vsix), extension: EXTENSION_ID },
      vscode: vscodeCommit && /^[a-f0-9]{40}$/.test(vscodeCommit) ? { version: vscodeVersion!, commit: vscodeCommit } : { version: vscodeVersion! },
      os: { platform: process.platform, release: os.release(), arch: process.arch },
      host: "codex-desktop",
      profile: { userDataDir: USER_DATA_DIR, extensionsDir: EXTENSIONS_DIR },
      preconditions: [
        "Run the journeys from the Codex desktop app (Computer Use sees nothing launched from codex exec).",
        "A visible, unlocked foreground desktop for the whole run; the screen must not lock or sleep.",
        `Computer Use approved for ${process.platform === "win32" ? "Code.exe" : "VS Code"} (a per-app approval, asked once).`,
        `The VSIX is the user's own local build of DataPass ${installedVersion}${opts.commit ? ` (released commit ${opts.commit})` : ""}, sha256 ${sha256}: installing it is expected.`,
        "VS Code is launched by qa:prepare (--launch) or the printed command, outside Codex's sandbox."
      ],
      knownLeaks: ["--user-data-dir does not isolate ~/.vscode-shared: state kept there is shared with the person's own VS Code."],
      screenshots: { folder: "screens", pattern: SCREEN_PATTERN, command: captureCommand() },
      clients,
      journeys: [] as Array<Record<string, unknown>>
    };
    // Each journey's launch: DataPass's release journeys first (the release gate), then the client's, in order.
    const prompted: PromptJourney[] = [];
    for (const [source, list] of [["vendor", vendor], ["client", journeys]] as const) {
      for (const j of list) {
        const s = j.setup ?? {};
        const own = config.workspaces.find(w => w.client.id === s.client) ?? config.workspaces[0]!;
        const { target, folder } = journeyTarget(root, j.id, s, own.client.id);
        const command = commandOf([...isolation, ...(s.trust === "restricted" ? [] : ["--disable-workspace-trust"]), ...target]);
        run.journeys.push({ id: j.id, kind: j.kind, title: j.title, file: j.file, features: j.features, source, launch: command });
        prompted.push({ journey: j, source, launch: command, ...(folder ? { folder } : {}) });
      }
    }
    // V1-AUTO-2: every journey compiled for qa:ui (the gate), in the same order; the others say why not.
    const compiled = compileRun(root, [...vendor.map(j => ({ j, source: "vendor" as const })), ...journeys.map(j => ({ j, source: "client" as const }))], config.workspaces[0]!.client.id);
    for (const line of compiled.lines) log(`  ${line}`);
    log(`✓ ${compiled.automatable} of ${compiled.total} journey(s) compiled for qa:ui into ${UI_JOURNEYS_DIR}/ (${compiled.total - compiled.automatable} not automatable)`);
    const text = JSON.stringify(run, null, 2) + "\n";
    parseQaRun(text); // what we write must read back
    const runFile = path.join(root, QA_RUN_FILE);
    fs.writeFileSync(runFile, text);
    log(`✓ ${QA_RUN_FILE} written (run ${runId})`);
    const promptFile = path.join(root, CODEX_PROMPT_FILE);
    fs.writeFileSync(promptFile, codexRunPrompt({
      runRoot: root, runId, config,
      datapass: { version: installedVersion, sha256, ...(opts.commit ? { commit: opts.commit } : {}), vsixPath: vsix },
      ...(expectedVersion !== config.datapass.version ? { configuredVersion: config.datapass.version } : {}),
      captureCommand: captureCommand(), journeys: prompted, platform: process.platform,
      qaUi: { checkout: REPO_ROOT, journeysDir: path.join(root, UI_JOURNEYS_DIR), reportDir: path.join(root, "qa-ui", runId), notAutomatable: compiled.notAutomatable }
    }));
    log(`✓ ${CODEX_PROMPT_FILE} written: paste it into a new Codex desktop thread (${prompted.length} journeys)`);
    log("");
    log(`Launch ${clients.length > 1 ? "each client's" : "the"} isolated VS Code:`);
    for (const l of launch) log(`  ${l}`);
    if (opts.launch) {
      for (const w of workspaceFiles) spawn(executable, launchArgs(w), { detached: true, stdio: "ignore", windowsHide: false }).unref();
      log(`✓ launched ${workspaceFiles.length} isolated VS Code window(s)`);
    }
    return { code: 0, reasons: [], runFile, promptFile, workspaceFiles, launch };
  } catch (e) {
    const reasons = e instanceof CannotPrepare ? e.reasons : [e instanceof Error ? e.message : String(e)];
    log("✗ Cannot prepare this run:");
    for (const r of reasons) log(`  - ${r}`);
    return { code: 2, reasons, workspaceFiles: [], launch: [] };
  }
}

/**
 * `--check`: validate a test repository without a run root — its configuration and journeys, and
 * optionally a report (`--report <file>`). What a test repository's own CI runs. Exit 0 valid, 2 not.
 */
export function check(opts: { auto: string; report?: string; log?: (line: string) => void }): { code: 0 | 2; reasons: string[] } {
  const log = opts.log ?? (line => console.log(line));
  const auto = path.resolve(opts.auto);
  try {
    if (!fs.existsSync(auto)) throw new CannotPrepare([`test repository not found: ${auto}`]);
    const { config } = readConfig(auto);
    const journeys = readJourneys(auto, config);
    log(`✓ ${config.purpose} configuration: ${config.workspaces.length} client(s), ${journeys.length} journey(s)`);
    if (opts.report) {
      const file = path.resolve(auto, opts.report);
      if (!fs.existsSync(file)) throw new CannotPrepare([`report not found: ${file}`]);
      try { parseQaReport(fs.readFileSync(file)); } catch (e) { throw new CannotPrepare(e instanceof QaFormatError ? e.issues.map(i => `${path.basename(file)}: ${i}`) : [String(e)]); }
      log(`✓ report ${path.basename(file)} is a valid ${QA_REPORT_FORMAT} v1`);
    }
    return { code: 0, reasons: [] };
  } catch (e) {
    const reasons = e instanceof CannotPrepare ? e.reasons : [e instanceof Error ? e.message : String(e)];
    log("✗ Not valid:");
    for (const r of reasons) log(`  - ${r}`);
    return { code: 2, reasons };
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  return argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const auto = argValue(argv, "auto") ?? argValue(argv, "config");
  const root = argValue(argv, "root");
  if (auto && argv.includes("--check")) process.exit(check({ auto, report: argValue(argv, "report") }).code);
  if (!auto || !root) {
    console.log("Usage: npm run qa:prepare -- --auto <test repository clone> --root <run root> [--vsix <file>] [--sha256 <hex>] [--datapass-version <v>] [--commit <released commit>] [--rc] [--clone] [--code <VS Code executable>] [--launch]");
    console.log("       npm run qa:prepare -- --auto <test repository clone> --check [--report <report.json>]");
    process.exit(2);
  }
  void prepare({
    auto, root, vsix: argValue(argv, "vsix"), code: argValue(argv, "code"), commit: argValue(argv, "commit"), launch: argv.includes("--launch"),
    sha256: argValue(argv, "sha256"), datapassVersion: argValue(argv, "datapass-version"), clone: argv.includes("--clone"),
    vendor: argValue(argv, "vendor") ?? (argv.includes("--rc") ? RC_JOURNEYS_DIR : undefined)
  }).then(r => process.exit(r.code));
}

