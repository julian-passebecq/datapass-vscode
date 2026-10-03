/**
 * V5E2E1: the V5 acceptance run (go/V5-ACCEPTANCE.md), node-free part. `qa/v5/acceptance.json`
 * (`datapass.v5-acceptance` 1) lists the 14 feature rows; each row names its packages, what it needs
 * from the extension (`requires`: contributed commands, settings, views, source files) and its
 * journeys (main + hole case) as UI steps. `npm run qa:v5` (scripts/qa/v5.ts) drives them in VS Code.
 *
 * Row statuses, never softened:
 *  - `cut`      the row's package left V5 (TL-10 cut order), with the reason;
 *  - `deferred` the row is outside the part asked for (`--part a|b`);
 *  - `missing`  a required command/setting/view/source is not in this build: a typed hole naming
 *               what is missing and which package brings it, never a pass;
 *  - `pending-merge` the same, for a row whose feature MR is still open (`pendingMerge`): its journeys
 *               are written against that branch's behaviour and run as soon as the build offers it;
 *  - `green`    every journey reached every step and its boundary checks are clean;
 *  - `red`      a step failed or a boundary check found something.
 * Labels and settings are data (the acceptance file); nothing here talks to VS Code or the disk.
 */
import { describeStep, parseStep, type UiStep } from "../ui/journey";
import { checkSpawn, SPAWN_ALLOW_LIST, type SpawnTrigger } from "../../core/spawnAllowList";

export const V5_ACCEPTANCE_FORMAT = "datapass.v5-acceptance";
export const V5_REPORT_FORMAT = "datapass.v5-acceptance-report";
export const V5_SHOT_PATTERN = /^v5-(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const V5_FIXTURES = ["shop", "shop-bare", "shop-macro", "shop-milestone", "repo-set", "repo-set-no-bi", "repo-set-no-common", "fastapi-orders", "dag", "studio-demo", "studio-hole"] as const;
export type V5Fixture = (typeof V5_FIXTURES)[number];
/** Fixtures served to Playwright Chromium (datapass-studio), not opened in VS Code. */
export const CHROMIUM_FIXTURES: readonly V5Fixture[] = ["studio-demo", "studio-hole"];

/** Steps the V5 run adds to the qa:ui vocabulary (src/qa/ui/journey.ts). */
export type V5Step =
  | UiStep
  | { kind: "shot"; name: string }                       // the acceptance screenshot qa/v5/shots/<name>.png
  | { kind: "chooseFile"; path: string }                  // the next open-file dialog answers this fixture file
  | { kind: "chooseSave"; answer: "default" }             // the next save dialog is accepted as offered (the user presses Save on the default location)
  | { kind: "appendFile"; path: string; text: string; match?: boolean } // a user edit of a fixture file (`match`: path is a regex, first hit)
  | { kind: "deleteFile"; path: string }                  // a user deletion (hole cases)
  | { kind: "expectFile"; pattern: string }               // a file whose fixture-relative path matches the regex exists
  | { kind: "expectNoFile"; pattern: string }
  | { kind: "expectFileText"; pattern: string; text: string } // that file contains `text`
  | { kind: "expectFileLacks"; pattern: string; text: string } // that file exists and does not contain `text`
  | { kind: "command"; id: string; args?: unknown[] }     // executeCommand through the QA harness extension
  | { kind: "chooseCassette"; name: string }              // the next open-file dialog answers tests/fixtures/v5/exchange/<name> (a canned AI answer)
  | { kind: "acceptWrites"; pattern: string }             // files matching the regex written so far come from the user's confirmed action (the click just before)
  | { kind: "expectElement"; selector: string; timeoutMs: number } // a visible element matching the CSS selector, in the page or a webview frame
  | { kind: "expectNoOverlap"; selector: string }         // at least 2 visible elements match and no two bounding boxes intersect
  | { kind: "expectClipboard"; text: string }             // the system clipboard holds `text`
  | { kind: "openInChromium"; pattern: string }           // open the fixture file matching the regex in Playwright Chromium, network off; later UI steps act there
  | { kind: "closeChromium" };                            // back to VS Code

export interface V5Journey {
  id: string;
  kind: "main" | "hole";
  title: string;
  fixture: V5Fixture;
  /** User settings for this journey (merged over the run's base settings). */
  settings?: Record<string, unknown>;
  /** QA stand-ins loaded beside DataPass (qa/v5/harness/<name>), e.g. the Data X-Ray sample stub. */
  stubs?: string[];
  /** A journey-level cut (one step group of a row whose package was cut). */
  cut?: string;
  /** `chromium`: the journey runs in Playwright Chromium against a local preview (Studio), not in VS Code. */
  host?: "vscode" | "chromium";
  steps: V5Step[];
}

export interface V5Requires { commands?: string[]; settings?: string[]; views?: string[]; sources?: string[] }

export interface V5Row {
  id: string;
  title: string;
  packages: string[];
  part: "a" | "b";
  cut?: string;
  requires: V5Requires;
  /** Which package brings each required id, for the `missing` hole. */
  providers?: Record<string, string>;
  shots: string[];
  journeys: V5Journey[];
  notes?: string[];
  /** The feature MR is not merged yet: while the build lacks it the row is `pending-merge` (journeys coded against its branch). */
  pendingMerge?: string;
}

/**
 * Which journey steps may start a `lazy-probe` or `user-command` spawn (core/spawnAllowList.ts). Key: an allow-list id,
 * or a prefix ending in `*`; value: the surfaces that need it, `view:<name>` (openView), `command:<id>` (run by label or
 * by id; a trailing `*` matches a command family) or `click:<text>`. A `read-only` entry needs no trigger.
 */
export type SpawnTriggers = Readonly<Record<string, readonly string[]>>;

export type V5Part = "a" | "b" | "all";
export interface V5Acceptance { format: typeof V5_ACCEPTANCE_FORMAT; version: 1; part: V5Part; rows: V5Row[]; spawnTriggers: SpawnTriggers }

export class V5AcceptanceError extends Error {
  constructor(readonly issues: string[]) { super(`invalid V5 acceptance file:\n${issues.join("\n")}`); }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string" && x.length > 0);
const REL = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0]+$/;

const EXTRA_KEYS = ["shot", "chooseFile", "chooseSave", "appendFile", "deleteFile", "expectFile", "expectNoFile", "expectFileText", "expectFileLacks", "command",
  "chooseCassette", "acceptWrites", "expectElement", "expectNoOverlap", "expectClipboard", "openInChromium", "closeChromium"] as const;
const CASSETTE = /^[a-z0-9][a-z0-9-]*\.(json|md|txt)$/;

/** One step: the V5 extras here, everything else through qa:ui's `parseStep` (unknown → `invalid`, never run). */
export function parseV5Step(raw: unknown): V5Step {
  if (isObj(raw)) {
    const key = EXTRA_KEYS.find(k => k in raw);
    if (key) {
      const v = raw[key];
      const bad = (problem: string): V5Step => ({ kind: "invalid", problem, raw: JSON.stringify(raw).slice(0, 200) });
      switch (key) {
        case "shot": return typeof v === "string" && V5_SHOT_PATTERN.test(v) ? { kind: "shot", name: v } : bad("shot takes a name v5-NN-slug");
        case "chooseFile": return typeof v === "string" && REL.test(v) ? { kind: "chooseFile", path: v } : bad("chooseFile takes a fixture-relative path");
        case "chooseSave": return v === "default" ? { kind: "chooseSave", answer: "default" } : bad("chooseSave takes \"default\" (accept the location the dialog offers)");
        case "deleteFile": return typeof v === "string" && REL.test(v) ? { kind: "deleteFile", path: v } : bad("deleteFile takes a fixture-relative path");
        case "appendFile": {
          if (typeof v !== "string" || typeof raw.text !== "string" || (raw.match !== undefined && typeof raw.match !== "boolean")) return bad("appendFile takes a fixture-relative path (or a regex with match: true) and a text");
          if (raw.match === true) { try { new RegExp(v); } catch { return bad("appendFile match takes a regular expression"); } return { kind: "appendFile", path: v, text: raw.text, match: true }; }
          return REL.test(v) ? { kind: "appendFile", path: v, text: raw.text } : bad("appendFile takes a fixture-relative path");
        }
        case "expectFile": case "expectNoFile": {
          try { new RegExp(String(v)); } catch { return bad(`${key} takes a regular expression`); }
          return typeof v === "string" && v ? { kind: key, pattern: v } : bad(`${key} takes a regular expression`);
        }
        case "expectFileText": case "expectFileLacks": {
          try { new RegExp(String(v)); } catch { return bad(`${key} takes a regular expression`); }
          return typeof v === "string" && typeof raw.text === "string" && raw.text ? { kind: key, pattern: v, text: raw.text } : bad(`${key} takes a regex and a text`);
        }
        case "command": return typeof v === "string" && /^[A-Za-z][\w.-]*$/.test(v) && (raw.args === undefined || Array.isArray(raw.args))
          ? { kind: "command", id: v, ...(raw.args ? { args: raw.args as unknown[] } : {}) } : bad("command takes a command id and optional args");
        case "chooseCassette": return typeof v === "string" && CASSETTE.test(v) ? { kind: "chooseCassette", name: v } : bad("chooseCassette takes a file name of tests/fixtures/v5/exchange");
        case "acceptWrites": case "openInChromium": {
          try { new RegExp(String(v)); } catch { return bad(`${key} takes a regular expression`); }
          return typeof v === "string" && v ? { kind: key, pattern: v } : bad(`${key} takes a regular expression`);
        }
        case "expectElement": case "expectNoOverlap": {
          if (typeof v !== "string" || !v.trim() || v.length > 300) return bad(`${key} takes a CSS selector`);
          if (key === "expectNoOverlap") return { kind: key, selector: v };
          const t = raw.timeoutMs;
          return t === undefined || (typeof t === "number" && t > 0 && t <= 120_000) ? { kind: key, selector: v, timeoutMs: (t as number | undefined) ?? 15_000 } : bad("expectElement timeoutMs is 1..120000");
        }
        case "expectClipboard": return typeof v === "string" && v ? { kind: "expectClipboard", text: v } : bad("expectClipboard takes a text");
        case "closeChromium": return v === true ? { kind: "closeChromium" } : bad("closeChromium takes true");
      }
    }
  }
  return parseStep(raw);
}

export function parseV5Acceptance(text: string): V5Acceptance {
  const issues: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new V5AcceptanceError([`not JSON: ${(e as Error).message}`]); }
  if (!isObj(raw) || raw.format !== V5_ACCEPTANCE_FORMAT || raw.version !== 1) throw new V5AcceptanceError([`format must be ${V5_ACCEPTANCE_FORMAT} version 1`]);
  if (raw.part !== "a" && raw.part !== "b" && raw.part !== "all") issues.push("part must be a, b or all");
  const spawnTriggers = parseSpawnTriggers(raw.spawnTriggers, issues);
  if (!Array.isArray(raw.rows)) throw new V5AcceptanceError(["rows must be an array"]);
  const rows: V5Row[] = [];
  const shots = new Set<string>();
  for (const [i, r] of raw.rows.entries()) {
    const at = `rows[${i}]`;
    if (!isObj(r) || typeof r.id !== "string" || !/^\d{2}$/.test(r.id) || typeof r.title !== "string" || !strs(r.packages) || (r.part !== "a" && r.part !== "b")) { issues.push(`${at}: id NN, title, packages, part a|b are required`); continue; }
    const req = isObj(r.requires) ? r.requires : {};
    for (const k of ["commands", "settings", "views", "sources"]) if (req[k] !== undefined && !strs(req[k])) issues.push(`${at}.requires.${k} must be a list of ids`);
    if (!strs(r.shots ?? [])) issues.push(`${at}.shots must be a list`);
    for (const s of (r.shots as string[] | undefined) ?? []) {
      const m = V5_SHOT_PATTERN.exec(s);
      if (!m) issues.push(`${at}: shot ${s} is not v5-NN-slug`);
      if (shots.has(s)) issues.push(`${at}: shot ${s} is listed twice`);
      shots.add(s);
    }
    const journeys: V5Journey[] = [];
    for (const [k, j] of (Array.isArray(r.journeys) ? r.journeys : []).entries()) {
      const jat = `${at}.journeys[${k}]`;
      if (!isObj(j) || typeof j.id !== "string" || !/^V5-\d{2}[A-Z0-9-]*$/.test(j.id) || (j.kind !== "main" && j.kind !== "hole") || typeof j.title !== "string" || !(V5_FIXTURES as readonly string[]).includes(String(j.fixture))) {
        issues.push(`${jat}: id V5-NN…, kind main|hole, title and a known fixture are required`); continue;
      }
      if (!Array.isArray(j.steps) || !j.steps.length) { issues.push(`${jat}: steps are required`); continue; }
      const steps = j.steps.map(parseV5Step);
      steps.forEach((s, n) => { if (s.kind === "invalid") issues.push(`${jat}.steps[${n}]: ${s.problem}`); });
      for (const s of steps) if (s.kind === "shot" && !((r.shots as string[] | undefined) ?? []).includes(s.name)) issues.push(`${jat}: shot ${s.name} is not one of the row's shots`);
      if (j.kind === "hole" && !steps.some(s => s.kind === "expect" || s.kind === "expectFileText")) issues.push(`${jat}: a hole journey asserts the hole is visible (expect)`);
      if (j.kind === "hole" && !steps.some(s => s.kind === "expectAbsent" || s.kind === "expectFileLacks")) issues.push(`${jat}: a hole journey asserts no placeholder value is shown (expectAbsent)`);
      const chromium = CHROMIUM_FIXTURES.includes(j.fixture as V5Fixture);
      if ((j.host === "chromium") !== chromium) issues.push(`${jat}: host chromium goes with a Chromium fixture (${CHROMIUM_FIXTURES.join(", ")}) and only with one`);
      if (chromium) for (const s of steps) if (VSCODE_ONLY.includes(s.kind)) issues.push(`${jat}: step ${s.kind} needs VS Code, not Chromium`);
      journeys.push({ id: j.id, kind: j.kind, title: j.title, fixture: j.fixture as V5Fixture, steps,
        ...(isObj(j.settings) ? { settings: j.settings } : {}), ...(strs(j.stubs) ? { stubs: j.stubs } : {}), ...(typeof j.cut === "string" ? { cut: j.cut } : {}),
        ...(chromium ? { host: "chromium" as const } : {}) });
    }
    if ((raw.part === "all" || r.part === raw.part) && !r.cut && !journeys.some(j => j.kind === "hole")) issues.push(`${at}: a row of this part has a hole journey`);
    if (r.pendingMerge !== undefined && (typeof r.pendingMerge !== "string" || !r.pendingMerge.trim())) issues.push(`${at}.pendingMerge names the open MR(s)`);
    rows.push({ id: r.id, title: r.title, packages: r.packages, part: r.part, requires: req as V5Requires, shots: (r.shots as string[] | undefined) ?? [], journeys,
      ...(typeof r.cut === "string" ? { cut: r.cut } : {}), ...(isObj(r.providers) ? { providers: r.providers as Record<string, string> } : {}), ...(strs(r.notes) ? { notes: r.notes } : {}),
      ...(typeof r.pendingMerge === "string" && r.pendingMerge.trim() ? { pendingMerge: r.pendingMerge } : {}) });
  }
  const ids = rows.map(r => r.id);
  if (new Set(ids).size !== ids.length) issues.push("row ids must be unique");
  if (issues.length) throw new V5AcceptanceError(issues);
  return { format: V5_ACCEPTANCE_FORMAT, version: 1, part: raw.part as V5Part, rows, spawnTriggers };
}

/** Steps that drive the VS Code workbench or its files; a Chromium journey has none of them. */
const VSCODE_ONLY: readonly V5Step["kind"][] = ["run", "openView", "quickPick", "commandPaletteSearch", "settingsSearch", "openFile", "chooseFolder", "chooseFile", "chooseSave",
  "chooseCassette", "appendFile", "deleteFile", "expectFile", "expectNoFile", "expectFileText", "expectFileLacks", "command", "acceptWrites", "expectClipboard", "openInChromium", "closeChromium"];

const SURFACE = /^(view|command|click):.+$/;

/** The trigger table: every key names an allow-list entry (or a prefix of some) that is not read-only. */
export function parseSpawnTriggers(raw: unknown, issues: string[]): SpawnTriggers {
  if (raw === undefined) return {};
  if (!isObj(raw)) { issues.push("spawnTriggers must be an object (allow-list id -> surfaces)"); return {}; }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("$")) continue;
    const hits = SPAWN_ALLOW_LIST.filter(d => (k.endsWith("*") ? d.id.startsWith(k.slice(0, -1)) : d.id === k));
    if (!hits.length) issues.push(`spawnTriggers.${k}: no such entry in core/spawnAllowList.ts`);
    else if (hits.every(d => d.trigger === "read-only")) issues.push(`spawnTriggers.${k}: read-only entries need no trigger`);
    if (!strs(v) || !v.every(x => SURFACE.test(x))) { issues.push(`spawnTriggers.${k}: a list of view:<name>, command:<id> or click:<text>`); continue; }
    out[k] = v;
  }
  return out;
}

/** What the extension build offers, read from its package.json contributes and its source tree. */
export interface BuildOffer { commands: ReadonlySet<string>; settings: ReadonlySet<string>; views: ReadonlySet<string>; hasSource: (rel: string) => boolean }

export function offerOf(pkg: unknown, hasSource: (rel: string) => boolean): BuildOffer {
  const c = isObj(pkg) && isObj(pkg.contributes) ? pkg.contributes : {};
  const commands = new Set<string>((Array.isArray(c.commands) ? c.commands : []).map(x => (isObj(x) ? String(x.command) : "")).filter(Boolean));
  const confs = Array.isArray(c.configuration) ? c.configuration : isObj(c.configuration) ? [c.configuration] : [];
  const settings = new Set<string>(confs.flatMap(x => (isObj(x) && isObj(x.properties) ? Object.keys(x.properties) : [])));
  const views = new Set<string>(isObj(c.views) ? Object.values(c.views).flatMap(v => (Array.isArray(v) ? v.map(x => (isObj(x) ? String(x.id) : "")) : [])).filter(Boolean) : []);
  return { commands, settings, views, hasSource };
}

/** The required ids this build does not offer (`kind:id`), with the package that brings each. */
export function missingFeatures(row: V5Row, offer: BuildOffer): { id: string; provider?: string }[] {
  const out: { id: string; provider?: string }[] = [];
  const add = (kind: string, id: string) => out.push({ id: `${kind}:${id}`, ...(row.providers?.[id] ? { provider: row.providers[id] } : {}) });
  for (const id of row.requires.commands ?? []) if (!offer.commands.has(id)) add("command", id);
  for (const id of row.requires.settings ?? []) if (!offer.settings.has(id)) add("setting", id);
  for (const id of row.requires.views ?? []) if (!offer.views.has(id)) add("view", id);
  for (const id of row.requires.sources ?? []) if (!offer.hasSource(id)) add("source", id);
  return out;
}

/** One journey step as the spawn judge sees it: when it started and the surfaces it opened (`view:…`, `command:…`, `click:…`). */
export interface TimelineMark { at: number; surfaces: readonly string[] }

const surfaceMatches = (wanted: string, seen: string) => (wanted.endsWith("*") ? seen.startsWith(wanted.slice(0, -1)) : seen === wanted);

/**
 * V5HOLE3 / TL-4, judged with core/spawnAllowList.ts: a spawn outside the allow-list is a finding; a `read-only` one
 * is fine at any time; a `lazy-probe` only after a step opened a view or ran a command that needs it, a `user-command`
 * only after its own command (the `spawnTriggers` table names both). Undefined = allowed.
 */
export function judgeSpawn(file: string, args: readonly string[], at: number | undefined, timeline: readonly TimelineMark[], triggers: SpawnTriggers): string | undefined {
  const d = checkSpawn(file, args);
  const shown = [file.replace(/\\/g, "/").split("/").at(-1), ...args].join(" ").slice(0, 160);
  if (!d.allowed) return `spawn: ${d.reason} (${shown})`;
  if (d.trigger === "read-only") return undefined;
  const wanted = Object.entries(triggers).filter(([k]) => (k.endsWith("*") ? d.id.startsWith(k.slice(0, -1)) : d.id === k)).flatMap(([, v]) => v);
  const when = d.trigger === "lazy-probe" ? "its own view or command" : "its own command";
  if (!wanted.length) return `spawn: ${d.id} (${d.trigger}) has no trigger in spawnTriggers, so no step may start it (${shown})`;
  const ok = timeline.some(m => (at === undefined || m.at <= at) && m.surfaces.some(sv => wanted.some(w => surfaceMatches(w, sv))));
  return ok ? undefined : `spawn: ${d.id} (${d.trigger}) ran before ${when} (${shown})`;
}

/** TL-4 through the allow-list, timing ignored: a git command DataPass may start at all. */
export function gitSpawnAllowed(file: string, args: readonly string[]): { ok: true } | { ok: false; reason: string } {
  const d = checkSpawn(file, args);
  return d.allowed && d.id.startsWith("git.") ? { ok: true } : { ok: false, reason: d.allowed ? `${d.id} is not a git command` : d.reason };
}

export type BoundaryEvent =
  | { kind: "net"; target: string; via: string }
  | { kind: "spawn"; file: string; args: string[]; at?: number }
  | { kind: "write"; path: string };

/**
 * Boundary findings of one journey: DataPass network calls, spawns the allow-list refuses or that ran before their
 * trigger (`judgeSpawn`), writes outside `.datapass/` the steps did not make or accept.
 */
export function boundaryFindings(events: readonly BoundaryEvent[], userTouched: ReadonlySet<string>, spawns: { timeline: readonly TimelineMark[]; triggers: SpawnTriggers } = { timeline: [], triggers: {} }): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.kind === "net" && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(e.target)) out.push(`network: ${e.via} to ${e.target}`);
    if (e.kind === "spawn") { const f = judgeSpawn(e.file, e.args, e.at, spawns.timeline, spawns.triggers); if (f) out.push(f); }
    if (e.kind === "write" && !e.path.startsWith(".datapass/") && !userTouched.has(e.path)) out.push(`write outside .datapass/ without a user action: ${e.path}`);
  }
  return [...new Set(out)];
}

export type RowStatus = "green" | "red" | "missing" | "pending-merge" | "cut" | "deferred";
export interface JourneyOutcome { id: string; kind: "main" | "hole"; status: "PASS" | "FAIL" | "NOT_RUN" | "CUT"; detail?: string; boundary: string[]; steps: { step: string; status: string; detail?: string }[] }
export interface RowOutcome { id: string; title: string; status: RowStatus; detail: string; missing?: { id: string; provider?: string }[]; journeys: JourneyOutcome[]; shots: string[] }

/** A row is green only when every journey not cut passed with clean boundaries. */
export function rowStatus(row: V5Row, part: V5Part, missing: readonly { id: string }[], journeys: readonly JourneyOutcome[]): { status: RowStatus; detail: string } {
  if (row.cut) return { status: "cut", detail: row.cut };
  if (part !== "all" && row.part !== part) return { status: "deferred", detail: `in V5E2E1${row.part}` };
  if (missing.length && row.pendingMerge) return { status: "pending-merge", detail: `waits for ${row.pendingMerge}; not in this build: ${missing.map(m => m.id).join(", ")}` };
  if (missing.length) return { status: "missing", detail: `hole: not in this build: ${missing.map(m => m.id).join(", ")}` };
  const live = journeys.filter(j => j.status !== "CUT");
  if (!live.length) return { status: "red", detail: "no journey ran" };
  const bad = live.filter(j => j.status !== "PASS" || j.boundary.length);
  return bad.length ? { status: "red", detail: bad.map(j => `${j.id}: ${j.detail ?? j.boundary.join("; ")}`).join(" | ").slice(0, 600) } : { status: "green", detail: `${live.length} journey(s) passed` };
}

/** The W3 gate line "every row is green or marked cut" (deferred rows keep it open). */
export function acceptanceVerdict(rows: readonly RowOutcome[]): { accepted: boolean; counts: Record<RowStatus, number> } {
  const counts: Record<RowStatus, number> = { green: 0, red: 0, missing: 0, "pending-merge": 0, cut: 0, deferred: 0 };
  for (const r of rows) counts[r.status]++;
  return { accepted: rows.length > 0 && rows.every(r => r.status === "green" || r.status === "cut"), counts };
}

export function describeV5Step(s: V5Step): string {
  switch (s.kind) {
    case "shot": return `screenshot ${s.name}`;
    case "chooseFile": return `answer the next file dialog with ${s.path}`;
    case "appendFile": return `edit ${s.path}`;
    case "deleteFile": return `delete ${s.path}`;
    case "expectFile": return `expect a file /${s.pattern}/`;
    case "expectNoFile": return `expect no file /${s.pattern}/`;
    case "expectFileText": return `expect /${s.pattern}/ to contain "${s.text.slice(0, 40)}"`;
    case "expectFileLacks": return `expect /${s.pattern}/ not to contain "${s.text.slice(0, 40)}"`;
    case "command": return `execute ${s.id}`;
    case "chooseSave": return "accept the next save dialog at its default location";
    case "chooseCassette": return `answer the next file dialog with the cassette ${s.name}`;
    case "acceptWrites": return `accept the files /${s.pattern}/ written by the confirmed action`;
    case "expectElement": return `expect an element ${s.selector}`;
    case "expectNoOverlap": return `expect no overlap between ${s.selector}`;
    case "expectClipboard": return `expect the clipboard to hold "${s.text.slice(0, 40)}"`;
    case "openInChromium": return `open /${s.pattern}/ in Chromium, network off`;
    case "closeChromium": return "close Chromium";
    default: return describeStep(s);
  }
}
