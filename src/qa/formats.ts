/**
 * Codex test mode formats (handoff/v3/12 §4, QA-1, with ARCHI's addendum of 2026-09-26). Pure: no
 * `vscode`, no file system. Producer: Codex and the client's test repositories (the auto repository
 * for "client", codex-datapass-vsixtest for "app"); consumer: DataPass (`npm run qa:prepare`, and
 * the "Codex tests" mode of QA-2). Every file is untrusted data: strict JSON, bounded sizes, closed
 * vocabularies, paths relative to one run root, https remotes only. DataPass never executes anything
 * from them.
 *
 *   datapass.codex-tests   1   datapass-codex-tests.json   which workspaces and journeys a run covers
 *   datapass.test-journey  1   journeys/*.json             one goal, in the client's (or app user's) terms
 *   datapass.qa-report     1   reports/{app,client}/<run>/report.json   what Codex reached, found, answered
 *   datapass.qa-run        1   <run root>/run.json         written by qa:prepare (not a cross-app contract)
 */
import { anyOf, arr, constOf, enumOf, obj, validateSchema, type Schema, type SchemaIssue } from "../core/contracts/schemaDsl";
import { parseStrictJson, StrictJsonError } from "../core/model/strictJson";
import { remoteIdentity } from "../core/project/gitHosts";
import { vetRelativePath } from "../core/exchange/pathSafety";

export const CODEX_TESTS_FORMAT = "datapass.codex-tests";
export const TEST_JOURNEY_FORMAT = "datapass.test-journey";
export const QA_REPORT_FORMAT = "datapass.qa-report";
export const QA_RUN_FORMAT = "datapass.qa-run";
/** The config file at the root of a test repository. */
export const CODEX_TESTS_FILE = "datapass-codex-tests.json";
export const QA_RUN_FILE = "run.json";
export const MAX_FILE_BYTES = 256 * 1024;

export const PURPOSES = ["app", "client"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PRESETS = ["Vanilla", "Standard", "DataPass", "Advanced"] as const;
export const OUTCOMES = ["reached", "partly", "not-reached", "blocked"] as const;
export const SEVERITIES = ["blocker", "major", "minor", "idea"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
/**
 * The feature tags (12 §4.2 and §5): journeys list the features they exercise, findings name one as
 * their area, and the report's coverage compares both. common/testing/FEATURES.md copies this list.
 */
export const FEATURES = [
  "onboarding", "workspace", "architecture", "variants", "options", "costs", "readiness", "evidence",
  "work-orders", "stamps", "file-context", "ai-exchange", "resources", "git", "format-checks", "modes",
  "file-versions", "toolkit", "mcp", "install", "docs", "performance"
] as const;
export type Feature = (typeof FEATURES)[number];

// ------------------------------------------------------------------ building blocks

const S = (maxLength: number, minLength = 1, pattern?: string): Schema => ({ type: "string", minLength, maxLength, ...(pattern ? { pattern } : {}) });
const TIME: Schema = { type: "string", format: "date-time" };
const INT = (minimum: number, maximum: number): Schema => ({ type: "integer", minimum, maximum });
/** A client or workspace id. */
const CLIENT_ID: Schema = S(80, 1, "^[a-z][a-z0-9-]{0,79}$");
/** One or more portable segments, none starting with a dot: no "..", no absolute path, no drive. */
const SEGMENT = "[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}";
const REL_PATH: Schema = S(400, 1, `^${SEGMENT}(/${SEGMENT}){0,11}$`);
const HTTPS_REMOTE: Schema = S(500, 1, "^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[^\\s@?#]+$");
const SHA256: Schema = S(64, 64, "^[a-f0-9]{64}$");
const COMMIT: Schema = S(40, 40, "^[a-f0-9]{40}$");
const VERSION: Schema = S(40, 5, "^[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$");
const JOURNEY_ID: Schema = S(20, 2, "^[A-Z][A-Z0-9-]{1,19}$");
const TEXT = (max: number) => S(max);
const LINES = (maxItems: number, maxLength: number, minItems = 0) => arr(S(maxLength), maxItems, minItems);

/** `folder` = the clone under the run root; `path` = a sub-folder inside it (an `examples/v3/*` of a datapass-vscode clone). */
const FOLDER_REF: Schema = obj({ remote: HTTPS_REMOTE, folder: REL_PATH, path: REL_PATH }, ["remote", "folder"]);
const CLIENT: Schema = obj({ id: CLIENT_ID, title: TEXT(120) });
const WORKSPACE_FIELDS = { bridge: FOLDER_REF, repositories: arr(FOLDER_REF, 20) };
const WORKSPACE: Schema = obj(WORKSPACE_FIELDS);
/** 12 §4.7: an app workspace carries its own `id` and `title`. */
const APP_WORKSPACE: Schema = obj({ id: CLIENT_ID, title: TEXT(120), ...WORKSPACE_FIELDS });

const COMMON_CONFIG = {
  $schema: S(500),
  format: constOf(CODEX_TESTS_FORMAT), version: constOf(1),
  datapass: obj({ version: VERSION, vsix: REL_PATH }, ["version"]),
  journeys: arr(REL_PATH, 50, 1),
  report: obj({ remote: HTTPS_REMOTE, folder: REL_PATH }),
  limits: obj({ runMinutes: INT(1, 480), journeyMinutes: INT(1, 120) }, [])
};
const CONFIG_REQUIRED = ["format", "version", "purpose", "datapass", "journeys", "report"];
/** purpose "client": one client, one workspace (the auto repository of 12 §4.1). */
export const CLIENT_CONFIG_SCHEMA: Schema = obj({ ...COMMON_CONFIG, purpose: constOf("client"), client: CLIENT, workspace: WORKSPACE }, [...CONFIG_REQUIRED, "client", "workspace"]);
/** purpose "app": DataPass itself, tested across several clients (codex-datapass-vsixtest). */
export const APP_CONFIG_SCHEMA: Schema = obj({ ...COMMON_CONFIG, purpose: constOf("app"), workspaces: arr(APP_WORKSPACE, 10, 1) }, [...CONFIG_REQUIRED, "workspaces"]);
export const CODEX_TESTS_SCHEMA: Schema = anyOf(CLIENT_CONFIG_SCHEMA, APP_CONFIG_SCHEMA);

export const TEST_JOURNEY_SCHEMA: Schema = obj({
  $schema: S(500),
  format: constOf(TEST_JOURNEY_FORMAT), version: constOf(1),
  id: JOURNEY_ID, kind: enumOf(...PURPOSES), title: TEXT(160),
  as: TEXT(160), goal: TEXT(1000),
  setup: obj({ client: CLIENT_ID, mode: enumOf(...PRESETS), variant: S(40), environment: S(40, 1, "^[a-z][a-z0-9_-]{0,39}$") }, []),
  hints: LINES(10, 300),
  expected: LINES(20, 500, 1),
  questions: LINES(20, 500),
  features: arr(enumOf(...FEATURES), 20, 1),
  outOfScope: LINES(10, 300)
}, ["format", "version", "id", "kind", "title", "goal", "expected", "features"]);

const REPO_COMMIT: Schema = obj({ folder: REL_PATH, path: REL_PATH, remote: HTTPS_REMOTE, commit: COMMIT }, ["folder", "remote", "commit"]);
const CLIENT_RUN: Schema = obj({ id: CLIENT_ID, title: TEXT(120), bridge: REPO_COMMIT, repositories: arr(REPO_COMMIT, 20) });
/** The released commit the VSIX was built from (the repository has no tags; PLAN.md records it), short or full. */
const RELEASED_COMMIT: Schema = S(40, 7, "^[a-f0-9]{7,40}$");
const DATAPASS_BUILD: Schema = obj({ version: VERSION, sha256: SHA256, commit: RELEASED_COMMIT }, ["version", "sha256"]);
/** Screens are shell captures (Codex Computer Use saves none): `screens/<journey id>-<what>.png` in the report folder. */
export const SCREEN_PATTERN = "^screens/[A-Z][A-Z0-9-]{1,19}-[a-z0-9][a-z0-9-]{0,59}\\.png$";
const SCREEN: Schema = S(120, 1, SCREEN_PATTERN);
const VSCODE_BUILD: Schema = obj({ version: VERSION, commit: COMMIT }, ["version"]);
const OS: Schema = obj({ platform: S(20), release: S(80), arch: S(20) });

export const QA_REPORT_SCHEMA: Schema = obj({
  $schema: S(500),
  format: constOf(QA_REPORT_FORMAT), version: constOf(1),
  purpose: enumOf(...PURPOSES),
  runId: S(120, 1, "^[0-9]{8}-[0-9]{4}-[a-z][a-z0-9-]{0,79}$"),
  datapass: DATAPASS_BUILD, vscode: VSCODE_BUILD, os: OS,
  clients: arr(CLIENT_RUN, 10, 1),
  // The Codex desktop app only: Computer Use sees nothing launched from `codex exec`.
  agent: obj({ tool: constOf("codex"), model: S(80), host: constOf("app") }),
  startedAt: TIME, finishedAt: TIME,
  journeys: arr(obj({
    id: JOURNEY_ID, outcome: enumOf(...OUTCOMES), minutes: INT(0, 480),
    path: LINES(40, 300),
    expected: arr(obj({ text: TEXT(500), met: { enum: [true, false, "unclear"] } }), 20),
    screens: arr(SCREEN, 40)
  }, ["id", "outcome", "minutes", "path", "expected"]), 50),
  findings: arr(obj({
    id: S(20, 1, "^F[0-9]{1,4}$"), journey: JOURNEY_ID, severity: enumOf(...SEVERITIES), area: enumOf(...FEATURES),
    title: TEXT(160), steps: LINES(30, 300), expected: TEXT(1000), actual: TEXT(1000),
    screens: arr(SCREEN, 20), suggestion: TEXT(1000)
  }, ["id", "severity", "area", "title", "steps", "expected", "actual"]), 200),
  answers: arr(obj({ question: TEXT(500), answer: TEXT(2000), evidence: TEXT(1000), screens: arr(SCREEN, 10), confidence: enumOf(...CONFIDENCES) }, ["question", "answer", "evidence", "confidence"]), 50),
  clientFeedback: LINES(50, 1000),
  coverage: obj({ listed: arr(enumOf(...FEATURES), FEATURES.length), reached: arr(enumOf(...FEATURES), FEATURES.length) })
}, ["format", "version", "purpose", "runId", "datapass", "vscode", "os", "clients", "agent", "journeys", "findings", "answers", "coverage"]);

export const QA_RUN_SCHEMA: Schema = obj({
  format: constOf(QA_RUN_FORMAT), version: constOf(1),
  runId: S(120, 1, "^[0-9]{8}-[0-9]{4}-[a-z][a-z0-9-]{0,79}$"),
  purpose: enumOf(...PURPOSES),
  createdAt: TIME,
  datapass: obj({ version: VERSION, sha256: SHA256, commit: RELEASED_COMMIT, vsix: S(260), extension: S(120) }, ["version", "sha256", "vsix", "extension"]),
  vscode: VSCODE_BUILD, os: OS,
  host: constOf("codex-desktop"),
  profile: obj({ userDataDir: constOf(".vscode-user"), extensionsDir: constOf(".vscode-ext") }),
  /** What must hold before the agent starts (visible desktop, Computer Use approval, the VSIX is the user's build). */
  preconditions: LINES(10, 500, 1),
  /** What the isolated profile does not isolate (~/.vscode-shared). */
  knownLeaks: LINES(10, 500),
  screenshots: obj({ folder: constOf("screens"), pattern: constOf(SCREEN_PATTERN), command: S(1000) }),
  clients: arr(obj({ id: CLIENT_ID, title: TEXT(120), workspaceFile: REL_PATH, bridge: REPO_COMMIT, repositories: arr(REPO_COMMIT, 20), launch: S(2000) }), 10, 1),
  journeys: arr(obj({ id: JOURNEY_ID, kind: enumOf(...PURPOSES), title: TEXT(160), file: REL_PATH, features: arr(enumOf(...FEATURES), 20, 1) }), 50, 1)
});

// ------------------------------------------------------------------ parsing

export class QaFormatError extends Error {
  constructor(readonly file: string, readonly issues: readonly string[]) {
    super(`${file}: ${issues.slice(0, 5).join("; ")}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ""}`);
  }
}

export interface FolderRef { remote: string; folder: string; path?: string }
/** Where a reference opens: the clone folder, or the sub-folder inside it. */
export const openPath = (ref: FolderRef): string => (ref.path ? `${ref.folder}/${ref.path}` : ref.folder);
export interface ClientWorkspace { client: { id: string; title: string }; bridge: FolderRef; repositories: FolderRef[] }
export interface CodexTestsConfig {
  purpose: Purpose;
  datapass: { version: string; vsix?: string };
  /** One for "client", one or more for "app": the same shape either way. */
  workspaces: ClientWorkspace[];
  journeys: string[];
  report: FolderRef;
  limits: { runMinutes?: number; journeyMinutes?: number };
}
export interface TestJourney {
  id: string; kind: Purpose; title: string; as?: string; goal: string;
  setup?: { client?: string; mode?: (typeof PRESETS)[number]; variant?: string; environment?: string };
  hints?: string[]; expected: string[]; questions?: string[]; features: Feature[]; outOfScope?: string[];
}

const describe = (issues: SchemaIssue[]) => issues.map(i => `${i.path} ${i.message}`);

function readJson(file: string, raw: string | Uint8Array): Record<string, unknown> {
  let doc: unknown;
  try { doc = parseStrictJson(raw, { maxBytes: MAX_FILE_BYTES, maxDepth: 12, maxEntries: 5000, maxStringLength: 8000 }); }
  catch (e) { throw new QaFormatError(file, [e instanceof StrictJsonError ? `not valid JSON: ${e.message}` : String(e)]); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new QaFormatError(file, ["must be a JSON object"]);
  return doc as Record<string, unknown>;
}

function expectFormat(file: string, doc: Record<string, unknown>, format: string): void {
  if (doc.format !== format) throw new QaFormatError(file, [`format must be "${format}" (found ${JSON.stringify(doc.format ?? null)})`]);
  if (doc.version !== 1) throw new QaFormatError(file, [`version must be 1 (found ${JSON.stringify(doc.version ?? null)}): this DataPass reads version 1 only`]);
}

/** Extra rules the schema cannot say: paths are portable and unique, remotes have an identity. */
function checkRefs(refs: Array<{ where: string; ref: FolderRef }>): string[] {
  const out: string[] = [];
  const folders = new Map<string, string>();
  for (const { where, ref } of refs) {
    const v = vetRelativePath(ref.folder);
    if (!v.ok) out.push(`${where}.folder "${ref.folder}": ${v.reason}`);
    if (ref.path !== undefined) { const p = vetRelativePath(ref.path); if (!p.ok) out.push(`${where}.path "${ref.path}": ${p.reason}`); }
    const key = openPath(ref).toLowerCase();
    if (folders.has(key)) out.push(`${where}.folder "${openPath(ref)}" is also used by ${folders.get(key)}`);
    else folders.set(key, where);
    if (!remoteIdentity(ref.remote)) out.push(`${where}.remote "${ref.remote}" is not a repository address`);
  }
  return out;
}

export function parseCodexTests(raw: string | Uint8Array, file = CODEX_TESTS_FILE): CodexTestsConfig {
  const doc = readJson(file, raw);
  expectFormat(file, doc, CODEX_TESTS_FORMAT);
  if (!PURPOSES.includes(doc.purpose as Purpose)) throw new QaFormatError(file, [`purpose must be "app" or "client" (found ${JSON.stringify(doc.purpose ?? null)})`]);
  const purpose = doc.purpose as Purpose;
  const issues = describe(validateSchema(purpose === "app" ? APP_CONFIG_SCHEMA : CLIENT_CONFIG_SCHEMA, doc));
  if (issues.length) throw new QaFormatError(file, issues);
  const workspaces: ClientWorkspace[] = purpose === "app"
    ? (doc.workspaces as Array<{ id: string; title: string } & Omit<ClientWorkspace, "client">>).map(({ id, title, ...w }) => ({ client: { id, title }, ...w }))
    : [{ client: doc.client as ClientWorkspace["client"], ...(doc.workspace as Omit<ClientWorkspace, "client">) }];
  const extra: string[] = [];
  const ids = new Set<string>();
  workspaces.forEach((w, i) => {
    const at = purpose === "app" ? `$.workspaces[${i}]` : "$.workspace";
    if (ids.has(w.client.id)) extra.push(`${at}${purpose === "app" ? "" : ".client"}.id "${w.client.id}" appears twice`);
    ids.add(w.client.id);
    extra.push(...checkRefs([{ where: `${at}.bridge`, ref: w.bridge }, ...w.repositories.map((ref, j) => ({ where: `${at}.repositories[${j}]`, ref }))]));
  });
  // Folders are relative to one run root, shared by every workspace of the run.
  // Two clients may share a folder only when it is the same repository.
  const all = workspaces.flatMap(w => [w.bridge, ...w.repositories]);
  const byFolder = new Map<string, string>();
  for (const r of all) {
    const prev = byFolder.get(r.folder.toLowerCase());
    if (prev !== undefined && prev !== remoteIdentity(r.remote)) extra.push(`folder "${r.folder}" is declared with two different remotes`);
    byFolder.set(r.folder.toLowerCase(), remoteIdentity(r.remote) ?? "");
  }
  const journeys = doc.journeys as string[];
  journeys.forEach((j, i) => { const v = vetRelativePath(j); if (!v.ok) extra.push(`$.journeys[${i}] "${j}": ${v.reason}`); });
  if (new Set(journeys.map(j => j.toLowerCase())).size !== journeys.length) extra.push("$.journeys lists the same file twice");
  const datapass = doc.datapass as CodexTestsConfig["datapass"];
  if (datapass.vsix !== undefined) { const v = vetRelativePath(datapass.vsix); if (!v.ok) extra.push(`$.datapass.vsix "${datapass.vsix}": ${v.reason}`); else if (!/\.vsix$/i.test(datapass.vsix)) extra.push(`$.datapass.vsix "${datapass.vsix}" must end in .vsix`); }
  if (extra.length) throw new QaFormatError(file, extra);
  return { purpose, datapass, workspaces, journeys, report: doc.report as FolderRef, limits: (doc.limits ?? {}) as CodexTestsConfig["limits"] };
}

export function parseTestJourney(raw: string | Uint8Array, file: string): TestJourney {
  const doc = readJson(file, raw);
  expectFormat(file, doc, TEST_JOURNEY_FORMAT);
  const issues = describe(validateSchema(TEST_JOURNEY_SCHEMA, doc));
  const features = Array.isArray(doc.features) ? doc.features : [];
  const unknown = features.filter(f => !FEATURES.includes(f as Feature));
  if (unknown.length) issues.unshift(`unknown feature tag(s) ${unknown.map(f => JSON.stringify(f)).join(", ")}: use the list in common/testing/FEATURES.md`);
  if (new Set(features).size !== features.length) issues.push("$.features lists a tag twice");
  if (issues.length) throw new QaFormatError(file, [...new Set(issues)]);
  return doc as unknown as TestJourney;
}

export interface QaReport { purpose: Purpose; runId: string; datapass: { version: string; sha256: string }; journeys: Array<{ id: string; outcome: (typeof OUTCOMES)[number] }>; findings: Array<{ id: string; severity: (typeof SEVERITIES)[number] }>; coverage: { listed: Feature[]; reached: Feature[] } }

export function parseQaReport(raw: string | Uint8Array, file = "report.json"): QaReport {
  const doc = readJson(file, raw);
  expectFormat(file, doc, QA_REPORT_FORMAT);
  const issues = describe(validateSchema(QA_REPORT_SCHEMA, doc));
  if (!issues.length) {
    const r = doc as unknown as QaReport & { findings: Array<{ id: string }> };
    if (new Set(r.findings.map(f => f.id)).size !== r.findings.length) issues.push("$.findings has two findings with the same id");
    const listed = new Set(r.coverage.listed);
    for (const f of r.coverage.reached) if (!listed.has(f)) issues.push(`$.coverage.reached "${f}" is not in coverage.listed`);
  }
  if (issues.length) throw new QaFormatError(file, issues);
  return doc as unknown as QaReport;
}

export function parseQaRun(raw: string | Uint8Array, file = QA_RUN_FILE): Record<string, unknown> {
  const doc = readJson(file, raw);
  expectFormat(file, doc, QA_RUN_FORMAT);
  const issues = describe(validateSchema(QA_RUN_SCHEMA, doc));
  if (issues.length) throw new QaFormatError(file, issues);
  return doc;
}

/** `<yyyymmdd-hhmm>-<client id | app>`, in UTC. */
export function runIdOf(config: Pick<CodexTestsConfig, "purpose" | "workspaces">, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  return `${stamp}-${config.purpose === "app" ? "app" : config.workspaces[0]!.client.id}`;
}

/** Where Codex pushes the report in the audit repository (addendum 3). */
export function reportFolder(config: Pick<CodexTestsConfig, "purpose" | "report">, runId: string): string {
  return `${config.report.folder}/${config.purpose}/${runId}`;
}
