/**
 * V5E2E1: the V5 acceptance run (go/V5-ACCEPTANCE.md), node-free part. `qa/v5/acceptance.json`
 * (`datapass.v5-acceptance` 1) lists the 14 feature rows; each row names its packages, what it needs
 * from the extension (`requires`: contributed commands, settings, views, source files) and its
 * journeys (main + hole case) as UI steps. `npm run qa:v5` (scripts/qa/v5.ts) drives them in VS Code.
 *
 * Row statuses, never softened:
 *  - `cut`      the row's package left V5 (TL-10 cut order), with the reason;
 *  - `deferred` the row is in the other half of the package split (V5E2E1b);
 *  - `missing`  a required command/setting/view/source is not in this build: a typed hole naming
 *               what is missing and which package brings it, never a pass;
 *  - `green`    every journey reached every step and its boundary checks are clean;
 *  - `red`      a step failed or a boundary check found something.
 * Labels and settings are data (the acceptance file); nothing here talks to VS Code or the disk.
 */
import { describeStep, parseStep, type UiStep } from "../ui/journey";

export const V5_ACCEPTANCE_FORMAT = "datapass.v5-acceptance";
export const V5_REPORT_FORMAT = "datapass.v5-acceptance-report";
export const V5_SHOT_PATTERN = /^v5-(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const V5_FIXTURES = ["shop", "shop-bare", "repo-set", "repo-set-no-bi", "repo-set-no-common", "fastapi-orders", "qa-client"] as const;
export type V5Fixture = (typeof V5_FIXTURES)[number];

/** TL-4 (amended 13:00): the only git verbs DataPass may spawn, read-only. */
export const GIT_READ_ONLY_VERBS = ["status", "log", "rev-parse", "for-each-ref", "diff", "ls-files", "submodule", "symbolic-ref", "config"] as const;

/** Steps the V5 run adds to the qa:ui vocabulary (src/qa/ui/journey.ts). */
export type V5Step =
  | UiStep
  | { kind: "shot"; name: string }                       // the acceptance screenshot qa/v5/shots/<name>.png
  | { kind: "chooseFile"; path: string }                  // the next open-file dialog answers this fixture file
  | { kind: "appendFile"; path: string; text: string; match?: boolean } // a user edit of a fixture file (`match`: path is a regex, first hit)
  | { kind: "deleteFile"; path: string }                  // a user deletion (hole cases)
  | { kind: "expectFile"; pattern: string }               // a file whose fixture-relative path matches the regex exists
  | { kind: "expectNoFile"; pattern: string }
  | { kind: "expectFileText"; pattern: string; text: string } // that file contains `text`
  | { kind: "expectFileLacks"; pattern: string; text: string } // that file exists and does not contain `text`
  | { kind: "command"; id: string; args?: unknown[] };    // executeCommand through the QA harness extension

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
}

export interface V5Acceptance { format: typeof V5_ACCEPTANCE_FORMAT; version: 1; part: "a" | "b"; rows: V5Row[] }

export class V5AcceptanceError extends Error {
  constructor(readonly issues: string[]) { super(`invalid V5 acceptance file:\n${issues.join("\n")}`); }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string" && x.length > 0);
const REL = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0]+$/;

const EXTRA_KEYS = ["shot", "chooseFile", "appendFile", "deleteFile", "expectFile", "expectNoFile", "expectFileText", "expectFileLacks", "command"] as const;

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
  if (raw.part !== "a" && raw.part !== "b") issues.push("part must be a or b");
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
      journeys.push({ id: j.id, kind: j.kind, title: j.title, fixture: j.fixture as V5Fixture, steps,
        ...(isObj(j.settings) ? { settings: j.settings } : {}), ...(strs(j.stubs) ? { stubs: j.stubs } : {}), ...(typeof j.cut === "string" ? { cut: j.cut } : {}) });
    }
    if (r.part === raw.part && !r.cut && !journeys.some(j => j.kind === "hole")) issues.push(`${at}: a row of this part has a hole journey`);
    rows.push({ id: r.id, title: r.title, packages: r.packages, part: r.part, requires: req as V5Requires, shots: (r.shots as string[] | undefined) ?? [], journeys,
      ...(typeof r.cut === "string" ? { cut: r.cut } : {}), ...(isObj(r.providers) ? { providers: r.providers as Record<string, string> } : {}), ...(strs(r.notes) ? { notes: r.notes } : {}) });
  }
  const ids = rows.map(r => r.id);
  if (new Set(ids).size !== ids.length) issues.push("row ids must be unique");
  if (issues.length) throw new V5AcceptanceError(issues);
  return { format: V5_ACCEPTANCE_FORMAT, version: 1, part: raw.part as "a" | "b", rows };
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

/** TL-4: a spawn DataPass made is allowed only when it is `git <read-only verb>` with no write flag. */
export function gitSpawnAllowed(file: string, args: readonly string[]): { ok: true } | { ok: false; reason: string } {
  const exe = file.replace(/\\/g, "/").split("/").at(-1)!.toLowerCase().replace(/\.exe$/, "");
  if (exe !== "git") return { ok: false, reason: `spawned ${exe}: only git is allowed (TL-4)` };
  // Leading global options (`-C <dir>`, `-c k=v`, `--no-pager`, `--git-dir=…`) come before the verb.
  let i = 0;
  while (i < args.length && args[i]!.startsWith("-")) i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
  const verb = args[i];
  const rest = args.slice(i + 1);
  if (!verb || !(GIT_READ_ONLY_VERBS as readonly string[]).includes(verb)) return { ok: false, reason: `git ${verb ?? "(no verb)"} is not on the TL-4 read-only list` };
  if (verb === "config" && !rest.some(a => a === "--get" || a === "--get-all" || a === "--get-regexp")) return { ok: false, reason: "git config without --get" };
  if (verb === "config" && rest.some(a => a === "--global" || a === "--system" || a === "--unset" || a === "--add")) return { ok: false, reason: "git config write flag" };
  if (verb === "symbolic-ref" && rest.some(a => a === "-d" || a === "--delete" || a === "-m")) return { ok: false, reason: "git symbolic-ref write flag" };
  if (verb === "submodule" && rest[0] !== "status") return { ok: false, reason: `git submodule ${rest[0] ?? ""}: only status` };
  if (verb === "diff" && rest.some(a => a === "--ext-diff")) return { ok: false, reason: "git diff --ext-diff" };
  return { ok: true };
}

export type BoundaryEvent =
  | { kind: "net"; target: string; via: string }
  | { kind: "spawn"; file: string; args: string[] }
  | { kind: "write"; path: string };

/** Boundary findings of one journey: DataPass network calls, non-allow-listed spawns, writes outside `.datapass/` the steps did not make. */
export function boundaryFindings(events: readonly BoundaryEvent[], userTouched: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.kind === "net" && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(e.target)) out.push(`network: ${e.via} to ${e.target}`);
    if (e.kind === "spawn") { const g = gitSpawnAllowed(e.file, e.args); if (!g.ok) out.push(`spawn: ${g.reason} (${[e.file, ...e.args].join(" ").slice(0, 160)})`); }
    if (e.kind === "write" && !e.path.startsWith(".datapass/") && !userTouched.has(e.path)) out.push(`write outside .datapass/ without a user action: ${e.path}`);
  }
  return [...new Set(out)];
}

export type RowStatus = "green" | "red" | "missing" | "cut" | "deferred";
export interface JourneyOutcome { id: string; kind: "main" | "hole"; status: "PASS" | "FAIL" | "NOT_RUN" | "CUT"; detail?: string; boundary: string[]; steps: { step: string; status: string; detail?: string }[] }
export interface RowOutcome { id: string; title: string; status: RowStatus; detail: string; missing?: { id: string; provider?: string }[]; journeys: JourneyOutcome[]; shots: string[] }

/** A row is green only when every journey not cut passed with clean boundaries. */
export function rowStatus(row: V5Row, part: "a" | "b", missing: readonly { id: string }[], journeys: readonly JourneyOutcome[]): { status: RowStatus; detail: string } {
  if (row.cut) return { status: "cut", detail: row.cut };
  if (row.part !== part) return { status: "deferred", detail: `in V5E2E1${row.part}` };
  if (missing.length) return { status: "missing", detail: `hole: not in this build: ${missing.map(m => m.id).join(", ")}` };
  const live = journeys.filter(j => j.status !== "CUT");
  if (!live.length) return { status: "red", detail: "no journey ran" };
  const bad = live.filter(j => j.status !== "PASS" || j.boundary.length);
  return bad.length ? { status: "red", detail: bad.map(j => `${j.id}: ${j.detail ?? j.boundary.join("; ")}`).join(" | ").slice(0, 600) } : { status: "green", detail: `${live.length} journey(s) passed` };
}

/** The W3 gate line "every row is green or marked cut" (deferred rows keep it open). */
export function acceptanceVerdict(rows: readonly RowOutcome[]): { accepted: boolean; counts: Record<RowStatus, number> } {
  const counts: Record<RowStatus, number> = { green: 0, red: 0, missing: 0, cut: 0, deferred: 0 };
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
    default: return describeStep(s);
  }
}
