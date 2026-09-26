/**
 * 0.18 (manifest v5): toolchain, version ranges, the ID map and connections.
 *
 * Negative cases first-class: a secret-looking value in any environment, unknown tool ids, bad
 * version ranges, credential files never opened, CLI output (account names, masked token
 * prefixes) never reaching a view, a snapshot, an AI pack or a report, and no manifest value ever
 * passed to a CLI. Every project here is synthetic and non-FOIL (a Fabric sales BI project, a
 * Databricks analytics project, an Azure web shop).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import fsModule from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { cliVersion, extractVersion, isRangeError, parseRange, satisfies } from "../src/core/toolchain/versions";
import { buildToolchain, installFor, knownTools, suggestTools, toolRangeWarnings, validateToolchain, type ToolchainDecl } from "../src/core/toolchain/toolchain";
import { compareExtensionsJson, parseExtensionsJson } from "../src/core/toolchain/extensionsJson";
import {
  buildConnections, parseAzAccount, parseDatabricksProfiles, parseFabStatus, portalFor, signInCommand, toolsToCheck,
  type CommandResult, type ConnectionDecl, type ConnectionProbe
} from "../src/core/toolchain/connections";
import { lookupId } from "../src/core/toolchain/idMap";
import { buildReadiness, readinessContextLines, readinessReport, readinessSnapshot, toolchainContextLines, type IdentifierDecl, type ReadinessInput } from "../src/core/readiness/readiness";
import { LATEST_MANIFEST_VERSION, migrateManifestToLatest, validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { TOOLS, type ToolObservation } from "../src/core/capabilities/tools";
import { preflight } from "../src/core/capabilities/preflight";
import { CAPABILITY_INDEX } from "../src/core/capabilities/registry";
import { buildAiContext } from "../src/core/exchange/aiContext";
import { wbReadiness } from "../src/views/workbenchState";
import { runConnectionChecks, defaultConnectionRunner, type ConnectionRunner } from "../src/work/connectionChecks";

const T = "2026-09-25T12:00:00.000Z";
const TENANT = "33333333-3333-3333-3333-333333333333";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const SUB_DEV = "44444444-4444-4444-4444-444444444444";
const WS_DEV = "11111111-1111-1111-1111-111111111111";
const WS_PROD = "22222222-2222-2222-2222-222222222222";
/** What the CLIs print that must never leave the parsers. */
const ACCOUNT = "julia.sample@contoso.example";
const MASKED = "eyJ0************************************";
const LEAKS = [ACCOUNT, MASKED, "eyJ0", "Contoso Sales Subscription", "oid-1234"];
const VALUES = [TENANT, SUB_DEV, WS_DEV, WS_PROD, OTHER_TENANT];
/**
 * Credential-shaped fakes, assembled at run time so the source never holds a token-shaped literal
 * (GitHub push protection would rightly block one).
 */
const FAKE_DATABRICKS_TOKEN = ["dapi", "0123456789abcdef".repeat(2)].join("");
const FAKE_GITHUB_TOKEN = ["ghp", "_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
const FAKE_JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnop"].join(".");

/** Fabric + Azure sales BI project (synthetic). */
function salesBi(extra: Partial<DataPassProjectManifest> = {}): DataPassProjectManifest {
  return {
    schemaVersion: 5,
    project: { id: "sales-bi", title: "Sales BI" },
    repositories: { bi: { remote: { url: "https://github.com/example-org/sales-bi" } } },
    environments: [{ id: "dev" }, { id: "prod", production: true }],
    identifiers: [
      { id: "tenant", label: "Entra tenant", provider: "azure", kind: "tenant", value: TENANT },
      { id: "sub-data", label: "Data subscription", provider: "azure", kind: "subscription", values: { dev: SUB_DEV, prod: "55555555-5555-5555-5555-555555555555" } },
      { id: "ws-sales", label: "Sales workspace", provider: "fabric", kind: "workspace", values: { dev: WS_DEV, prod: WS_PROD }, envKey: "FABRIC_WORKSPACE_ID" }
    ],
    toolchain: { tools: [
      { tool: "cli.fab", version: ">=1.0" },
      { tool: "cli.az", version: "^2.60" },
      { tool: "ext.fabric" },
      { tool: "py.fabric-cicd", version: ">=0.1.20,<1", where: "ci" },
      { tool: "py.semantic-link-labs", where: "fabric" },
      { tool: "pack.powerbi-gbrueckl", optional: true },
      { tool: "cli.databrick" }
    ] },
    connections: [
      { id: "azure-dev", kind: "sign-in", label: "Azure (dev)", tool: "cli.az", identifier: "tenant", subscription: "sub-data", environment: "dev" },
      { id: "fabric", kind: "sign-in", label: "Fabric CLI", tool: "cli.fab", identifier: "tenant" },
      { id: "dbx-dev", kind: "sign-in", label: "Databricks (dev)", tool: "cli.databricks", profile: "sales-dev", environment: "dev" },
      { id: "sales-git", kind: "git-binding", label: "Sales workspace ↔ Git", provider: "fabric", identifier: "ws-sales", environment: "dev", repoRef: "bi", folder: "fabric/", branch: "dev" },
      { id: "sales-sql", kind: "cloud-connection", label: "Sales SQL connection", provider: "fabric", name: "conn-sales-sql", environment: "dev" }
    ],
    ...extra
  };
}

const probes = (versions: Record<string, string | null>): Map<string, ToolObservation> => new Map(TOOLS.map(t => {
  const v = versions[t.id];
  return [t.id, { toolId: t.id, state: v === undefined ? "absent" : "present", version: v ?? undefined, observedAt: T }];
}));

function readinessInput(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    manifest: salesBi(), coordinationKey: ".", envFiles: new Map(), repositories: [], problems: [], settings: {}, diagramCloudSidecar: false,
    latestSchemaVersion: LATEST_MANIFEST_VERSION, tools: probes({ "cli.fab": "1.2.0", "cli.az": "2.59.1", "ext.fabric": "1.3.0" }), platform: "win32", ...over
  };
}

const noLeak = (what: string, text: string, extra: string[] = []) => { for (const s of [...LEAKS, ...extra]) assert.ok(!text.includes(s), `${what} leaked ${s}`); };

// ------------------------------------------------------------------ version ranges

test("versions: ranges people write for CLIs, extensions and Python libraries", () => {
  const ok = (range: string, v: string) => { const r = parseRange(range); assert.ok(!isRangeError(r), `${range}: ${JSON.stringify(r)}`); return satisfies(extractVersion(v)!, r as Exclude<typeof r, { error: string }>); };
  assert.ok(ok(">=1.0", "1.0.0")); assert.ok(!ok(">=1.0", "0.9.9"));
  assert.ok(ok(">1.2.3", "1.2.4")); assert.ok(!ok(">1.2.3", "1.2.3"));
  assert.ok(ok("<2", "1.99.0")); assert.ok(!ok("<2", "2.0.0"));
  assert.ok(ok("<=2.1", "2.1.0")); assert.ok(!ok("<=2.1", "2.1.1"));
  assert.ok(ok("1.4", "1.4.9")); assert.ok(!ok("1.4", "1.5.0"), "a bare version is its release line");
  assert.ok(ok("==1.4.2", "1.4.2")); assert.ok(!ok("==1.4.2", "1.4.3"));
  assert.ok(ok("1.x", "1.9.0")); assert.ok(ok("1.2.*", "1.2.7")); assert.ok(!ok("1.2.*", "1.3.0")); assert.ok(ok("*", "0.0.1"));
  assert.ok(ok("^1.2", "1.9.0")); assert.ok(!ok("^1.2", "2.0.0")); assert.ok(ok("^0.3.1", "0.3.9")); assert.ok(!ok("^0.3.1", "0.4.0"));
  assert.ok(ok("~1.2", "1.2.9")); assert.ok(!ok("~1.2", "1.3.0"));
  assert.ok(ok("~=1.4.2", "1.4.9")); assert.ok(!ok("~=1.4.2", "1.5.0")); assert.ok(ok("~=1.4", "1.9.0")); assert.ok(!ok("~=1.4", "2.0.0"));
  assert.ok(ok("!=1.5.0", "1.5.1")); assert.ok(!ok("!=1.5.0", "1.5.0"));
  assert.ok(ok(">=1.0 <2.0", "1.5.0")); assert.ok(!ok(">=1.0 <2.0", "2.0.0"));
  assert.ok(ok(">=0.1.20,<1", "0.1.27")); assert.ok(!ok(">=0.1.20,<1", "0.1.19"));
  assert.ok(ok("^1.4 || ^2.0", "2.3.0")); assert.ok(!ok("^1.4 || ^2.0", "3.0.0"));
  assert.ok(ok(">=2.46", "2.46.0.1"), "a fourth part (git for Windows) compares after the first three");
});

test("versions: bad ranges are refused, and the message never repeats the text", () => {
  for (const bad of ["", "   ", "latest", "stable", ">= 1.0", "=> 1.0", "~>1.0", "1.0.0.0.0", "1.0.0-beta", ">=x", "^1.x", "~=1", "!=1.x", "^2.0 ||", "|| ^2", "1..0", ">=01.0", "1.0; rm -rf ~", "$(whoami)", "x".repeat(81)]) {
    const r = parseRange(bad);
    assert.ok(isRangeError(r), `accepted ${JSON.stringify(bad)}`);
    if (bad.trim().length > 2) assert.ok(!r.error.includes(bad.trim()), "the error names the rule, not the value");
  }
  assert.ok(isRangeError(parseRange(42)));
});

test("versions: what each probed CLI prints becomes a comparable version", () => {
  const cases: Array<[string, string]> = [
    ["{\n  \"azure-cli\": \"2.64.0\",\n  \"azure-cli-core\": \"2.64.0\",\n  \"extensions\": {}\n}", "2.64.0"],
    ["Databricks CLI v0.230.0", "0.230.0"],
    ["fab version 1.1.0", "1.1.0"],
    ["git version 2.44.0.windows.1", "2.44.0"],
    ["2.46.0.1", "2.46.0.1"],
    ["Python 3.14.7", "3.14.7"],
    ["java version \"22.0.2\" 2024-07-16", "22.0.2"],
    ["OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2", "9.5"],
    ["Google Cloud SDK 481.0.0\nbq 2.1.6", "481.0.0"],
    ["Terraform v1.9.5\non windows_amd64", "1.9.5"],
    ["psql (PostgreSQL) 16.2", "16.2"],
    ["4.0.5907", "4.0.5907"]
  ];
  for (const [out, want] of cases) assert.equal(cliVersion(out), want, out.split("\n")[0]);
  assert.equal(cliVersion("no number here"), "no number here");
  assert.equal(cliVersion("{\n}"), undefined);
});

// ------------------------------------------------------------------ toolchain validation and view

test("toolchain: validation refuses malformed ids, ranges, places and duplicates; unknown well-formed ids are not errors", () => {
  const v = (tools: unknown) => validateToolchain({ toolchain: { tools } });
  assert.deepEqual(v([{ tool: "cli.az", version: "^2.60" }, { tool: "py.fabric-cicd", where: "ci" }, { tool: "cli.brandnew" }]), []);
  assert.match(v([{ tool: "az" }]).join(), /tool must be a tool id/);
  assert.match(v([{ tool: "cli.az && del C:" }]).join(), /tool must be a tool id/);
  assert.match(v([{ tool: "CLI.AZ" }]).join(), /tool must be a tool id/);
  assert.match(v([{ tool: "cli.az", version: "latest" }]).join(), /toolchain\.tools\[0\]\.version may only use digits/);
  assert.match(v([{ tool: "cli.az", version: ">= 2" }]).join(), /version is not a version range/);
  assert.match(v([{ tool: "cli.az", version: 2 }]).join(), /version must be a non-empty version range/);
  assert.match(v([{ tool: "cli.az", where: "cloud" }]).join(), /where must be local, ci or fabric/);
  assert.match(v([{ tool: "cli.az", optional: "yes" }]).join(), /optional must be true or false/);
  assert.match(v([{ tool: "cli.az" }, { tool: "cli.az" }]).join(), /listed twice/);
  assert.deepEqual(v([{ tool: "cli.az" }, { tool: "cli.az", where: "ci" }]), [], "the same tool locally and in CI is fine");
  assert.match(validateToolchain({ toolchain: [] }).join(), /toolchain must be an object/);
  assert.match(v(Array.from({ length: 61 }, (_, i) => ({ tool: `cli.t${i}` }))).join(), /at most 60/);
});

test("toolchain: probes compared with ranges; CI, Fabric and non-probed tools are not checked here; unknown ids run nothing", () => {
  const view = buildToolchain({ toolchain: salesBi().toolchain, tools: probes({ "cli.fab": "1.2.0", "cli.az": "2.59.1", "ext.fabric": "1.3.0" }), platform: "win32" });
  const by = (id: string) => view.entries.find(e => e.tool === id)!;
  assert.equal(by("cli.fab").state, "ok"); assert.equal(by("cli.fab").version, "1.2.0");
  assert.equal(by("cli.az").state, "outside-range"); assert.match(by("cli.az").detail, /2\.59\.1 is outside the project's range \^2\.60/);
  assert.equal(by("ext.fabric").state, "ok");
  assert.equal(by("py.fabric-cicd").state, "not-checked"); assert.match(by("py.fabric-cicd").detail, /CI pipeline/);
  assert.equal(by("py.semantic-link-labs").state, "not-checked"); assert.match(by("py.semantic-link-labs").detail, /Fabric notebooks/);
  assert.equal(by("pack.powerbi-gbrueckl").state, "missing"); assert.equal(by("pack.powerbi-gbrueckl").optional, true);
  const unknown = by("cli.databrick");
  assert.equal(unknown.state, "unknown-tool");
  assert.deepEqual(unknown.suggestions?.[0], "cli.databricks");
  assert.equal(unknown.install, undefined, "no install command for an id DataPass does not know");
  assert.deepEqual(view.summary, { ok: 2, attention: 2, notChecked: 2, total: 7 });
  // A present tool whose version cannot be read, a desktop app, and a tool never probed.
  const odd = buildToolchain({ toolchain: { tools: [{ tool: "cli.git", version: ">=2" }, { tool: "app.pbi-desktop" }, { tool: "cli.tofu" }] }, tools: new Map([["cli.git", { toolId: "cli.git", state: "present", version: "unknown build", observedAt: T }]]), platform: "linux" });
  assert.deepEqual(odd.entries.map(e => e.state), ["version-unknown", "not-checked", "not-checked"]);
});

test("toolchain: install commands are per platform and only shown (winget, brew, pip, code --install-extension)", () => {
  const t = (id: string) => knownTools().get(id)!;
  assert.equal(installFor(t("cli.databricks"), "win32")?.command, "winget install Databricks.DatabricksCLI");
  assert.equal(installFor(t("cli.databricks"), "darwin")?.command, "brew tap databricks/tap && brew install databricks");
  assert.equal(installFor(t("cli.databricks"), "linux")?.command, undefined, "no guessed Linux command: the docs page instead");
  assert.match(installFor(t("cli.databricks"), "linux")!.docs!, /^https:\/\/learn\.microsoft\.com\//);
  assert.equal(installFor(t("cli.az"), "win32")?.command, "winget install -e --id Microsoft.AzureCLI");
  assert.equal(installFor(t("cli.fab"), "linux")?.command, "pip install ms-fabric-cli");
  assert.equal(installFor(t("ext.fabric"), "linux")?.command, "code --install-extension fabric.vscode-fabric");
  assert.equal(installFor(t("pack.powerbi-gbrueckl"), "win32")?.command, "code --install-extension GerhardBrueckl.powerbi-vscode-extensionpack");
  assert.equal(installFor(t("py.semantic-link-labs"), "win32")?.where, "a Fabric notebook cell (or a custom Fabric environment)");
  for (const tool of knownTools().values()) {
    const i = installFor(tool, "win32");
    if (i?.docs) assert.match(i.docs, /^https:\/\//, tool.id);
    if (i?.command) assert.ok(!/[`$]|\|\s*(sh|bash|iex)\b/.test(i.command), `${tool.id}: no piped installer`);
  }
});

test("toolchain: suggestions for a mistyped id stay in its family", () => {
  assert.deepEqual(suggestTools("cli.azure").slice(0, 1), ["cli.az"]);
  assert.ok(suggestTools("ext.fabric-studios").includes("ext.fabric-studio"));
  assert.deepEqual(suggestTools("zz.qqqqqqqqqqqq"), []);
});

test("toolchain: a version outside the range warns on the phases that use the tool, never blocks, never on reading", () => {
  const view = buildToolchain({ toolchain: { tools: [{ tool: "cli.databricks", version: ">=0.240" }] }, tools: probes({ "cli.databricks": "0.230.0" }), platform: "win32" });
  const warnings = toolRangeWarnings(view);
  assert.match(warnings.get("cli.databricks")!, /Databricks CLI 0\.230\.0 is outside this project's range >=0\.240/);
  const base = { tools: probes({ "cli.databricks": "0.230.0" }), facts: new Map<string, string | boolean | undefined>(), reviewsConfirmed: new Set<string>(), toolRangeWarnings: warnings };
  const readCap = [...CAPABILITY_INDEX.values()].find(c => c.phase === "read" && c.requirements.some(r => r.anyOf.includes("cli.databricks")));
  const otherCap = [...CAPABILITY_INDEX.values()].find(c => c.phase !== "read" && c.requirements.some(r => r.anyOf.includes("cli.databricks")));
  assert.ok(otherCap, "a non-read operation uses the Databricks CLI");
  const r = preflight(otherCap!, base);
  assert.ok(r.warnings.some(w => /outside this project's range/.test(w)), JSON.stringify(r.warnings));
  assert.ok(!r.blockers.some(b => b.kind === "tool"), "a version mismatch never blocks");
  if (readCap) assert.ok(!preflight(readCap, base).warnings.some(w => /outside this project's range/.test(w)), "never on reading");
});

// ------------------------------------------------------------------ extensions.json

test("extensions.json: JSONC with comments and trailing commas; compared with the toolchain's extensions only", () => {
  const obs = parseExtensionsJson("\uFEFF{\n  // workspace recommendations\n  \"recommendations\": [\"fabric.vscode-fabric\", \"ms-python.python\",],\n  \"unwantedRecommendations\": [\"GerhardBrueckl.powerbi-vscode-extensionpack\"]\n}\n");
  assert.equal(obs.state, "found");
  const view = compareExtensionsJson(salesBi().toolchain, obs);
  assert.deepEqual(view.expected.map(x => [x.tool, x.recommended, x.unwanted, x.optional]), [["ext.fabric", true, false, false], ["pack.powerbi-gbrueckl", false, true, true]]);
  assert.deepEqual(view.extra, ["ms-python.python"]);
  assert.equal(compareExtensionsJson(salesBi().toolchain, { state: "absent" }).expected.every(x => !x.recommended), true);
  assert.equal(compareExtensionsJson(undefined, obs).state, "no-toolchain");
  assert.equal(parseExtensionsJson("{ not json").state, "invalid");
  assert.equal(parseExtensionsJson("[]").state, "invalid");
  assert.equal(parseExtensionsJson("{\"recommendations\": \"fabric.vscode-fabric\"}").state, "invalid");
  const odd = parseExtensionsJson("{\"recommendations\": [\"not an id\", \"a.b\", 42]}");
  assert.deepEqual(odd.state === "found" ? odd.recommendations : [], ["a.b"]);
});

// ------------------------------------------------------------------ identifiers (ID map)

test("ID map: a secret-looking value in any environment is refused, and never echoed", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["Databricks token in prod", { dev: WS_DEV, prod: FAKE_DATABRICKS_TOKEN }],
    ["GitHub token in dev", { dev: FAKE_GITHUB_TOKEN, prod: WS_PROD }],
    ["JWT in dev", { dev: FAKE_JWT, prod: WS_PROD }],
    ["connection string in prod", { dev: WS_DEV, prod: "Server=tcp:x;Password=hunter2" }],
    ["URL in dev", { dev: "https://contoso.sharepoint.com/sites/x", prod: WS_PROD }]
  ];
  for (const [name, values] of cases) {
    const errors = validateProjectManifest(salesBi({ identifiers: [{ id: "ws", label: "Workspace", values }] }));
    assert.ok(errors.some(e => /identifiers\[0\]\.values\.(dev|prod)/.test(e)), `${name}: ${errors.join(" | ")}`);
    for (const v of Object.values(values)) if (v !== WS_DEV && v !== WS_PROD) assert.ok(!errors.join(" ").includes(v), `${name}: value echoed`);
  }
  // A secret-like label is refused too, with values.
  assert.ok(validateProjectManifest(salesBi({ identifiers: [{ id: "api-key", label: "API key", values: { dev: "abc123" } }] })).some(e => /named like a secret/.test(e)));
  // Environment keys: declared ids only; a weird key is not echoed either.
  const weird = validateProjectManifest(salesBi({ identifiers: [{ id: "ws", label: "WS", values: { "Password=x": "abc123" } }] }));
  assert.ok(weird.some(e => /values names environment "\?"/.test(e)) && !weird.join(" ").includes("Password=x"), weird.join(" | "));
  assert.ok(validateProjectManifest(salesBi({ identifiers: [{ id: "ws", label: "WS", values: {} }] })).some(e => /must map 1 to 20/.test(e)));
});

test("ID map: lookups say which declared id (and environment) a pasted GUID or portal address is", () => {
  const ids = salesBi().identifiers!;
  assert.deepEqual(lookupId(ids, WS_PROD), [{ id: "ws-sales", label: "Sales workspace", provider: "fabric", kind: "workspace", environment: "prod" }]);
  assert.deepEqual(lookupId(ids, ` ${TENANT.toUpperCase()} `).map(m => m.id), ["tenant"]);
  assert.deepEqual(lookupId(ids, `https://app.fabric.microsoft.com/groups/${WS_DEV}/list?experience=fabric-developer`).map(m => `${m.id}:${m.environment}`), ["ws-sales:dev"]);
  assert.deepEqual(lookupId(ids, "00000000-0000-0000-0000-000000000000"), []);
  assert.deepEqual(lookupId([{ id: "short", label: "Short", value: "ab12" }], "ab12", 8), [], "short values are ignored in hovers");
});

// ------------------------------------------------------------------ connections: validation

test("connections: references, kinds and fields are checked; a profile is a name, never a path", () => {
  const errors = (connections: unknown[]) => validateProjectManifest(salesBi({ connections: connections as ConnectionDecl[] }));
  assert.deepEqual(errors(salesBi().connections!), []);
  assert.match(errors([{ id: "a", kind: "sign-in", tool: "cli.az", identifier: "ws-sales" }]).join(), /kind workspace; tenant expected/);
  assert.match(errors([{ id: "a", kind: "sign-in", tool: "cli.az", subscription: "tenant" }]).join(), /kind tenant; subscription expected/);
  assert.match(errors([{ id: "a", kind: "sign-in", tool: "cli.fab", profile: "x" }]).join(), /profile only applies to a Databricks CLI sign-in/);
  for (const p of ["../.databrickscfg", "C:\\Users\\me\\.databrickscfg", "~/.databrickscfg", "a b", ""]) assert.ok(errors([{ id: "d", kind: "sign-in", tool: "cli.databricks", profile: p }]).length, p);
  assert.match(errors([{ id: "g", kind: "git-binding", provider: "fabric", folder: "/abs" }]).join(), /relative folder/);
  assert.match(errors([{ id: "c", kind: "cloud-connection", provider: "fabric", name: "Endpoint=sb://x;SharedAccessKey=abc" }]).join(), /looks like a connection string/);
  assert.match(errors([{ id: "c", kind: "cloud-connection", provider: "fabric", name: "ok", portal: "https://user:pw@example.com/x" }]).join(), /portal must be an https/);
  assert.match(validateProjectManifest({ ...salesBi(), schemaVersion: 4 }).join(), /toolchain requires schemaVersion 5.*connections requires schemaVersion 5|connections requires schemaVersion 5/);
});

// ------------------------------------------------------------------ connections: what the CLIs print

const ran = (over: Partial<CommandResult>): CommandResult => ({ ok: true, code: 0, stdout: "", stderr: "", ...over });
const AZ_OUT = JSON.stringify({ environmentName: "AzureCloud", homeTenantId: TENANT, id: SUB_DEV, isDefault: true, managedByTenants: [], name: "Contoso Sales Subscription", state: "Enabled", tenantId: TENANT, user: { name: ACCOUNT, type: "user" } }, null, 2);
const DBX_OUT = JSON.stringify({ profiles: [{ name: "DEFAULT", host: "https://adb-1.azuredatabricks.net", cloud: "azure", auth_type: "pat", valid: true }, { name: "sales-dev", host: "https://adb-2.azuredatabricks.net", cloud: "azure", auth_type: "databricks-cli", valid: false }, { name: "bad name; rm", valid: true }] });
const FAB_OUT = { stderr: "✓ Logged in to app.fabric.microsoft.com\n", stdout: `Logged In: True\nAccount: ${ACCOUNT}\nPrincipal Id: oid-1234\nTenant Id: ${TENANT}\nApp Id: 5814bfb4-2705-4994-b8d6-39aabeb5eaeb\nToken Fabric Powerbi: ${MASKED}\nToken Storage: ${MASKED}\nToken Azure: ${MASKED}\n` };

test("connections: parsers keep a few fields and drop the rest (account, subscription name, masked tokens)", () => {
  const az = parseAzAccount(ran({ stdout: AZ_OUT }), T);
  assert.deepEqual(az, { tool: "cli.az", ranAt: T, outcome: "ok", signedIn: true, tenantId: TENANT, subscriptionId: SUB_DEV });
  assert.deepEqual(parseAzAccount(ran({ ok: false, code: 1, stderr: "ERROR: Please run 'az login' to setup account." }), T), { tool: "cli.az", ranAt: T, outcome: "ok", signedIn: false });
  assert.equal(parseAzAccount(ran({ ok: false, code: 2, stderr: `boom for ${ACCOUNT}` }), T).reason, "az account show failed (exit code 2)");
  assert.equal(parseAzAccount(ran({ stdout: "not json" }), T).outcome, "failed");
  assert.equal(parseAzAccount(ran({ ok: false, notFound: true }), T).outcome, "not-installed");
  assert.equal(parseAzAccount(ran({ ok: false, timedOut: true }), T).outcome, "timeout");
  const dbx = parseDatabricksProfiles(ran({ stdout: DBX_OUT }), T);
  assert.deepEqual(dbx.profiles, [{ name: "DEFAULT", valid: true }, { name: "sales-dev", valid: false }]);
  assert.ok(!JSON.stringify(dbx).includes("azuredatabricks.net"), "hosts are not kept");
  const fab = parseFabStatus(ran(FAB_OUT), T);
  assert.deepEqual(fab, { tool: "cli.fab", ranAt: T, outcome: "ok", signedIn: true, tenantId: TENANT });
  assert.deepEqual(parseFabStatus(ran({ stderr: "✗ Not logged in to app.fabric.microsoft.com\n", stdout: "Logged In: False\nAccount: N/A\nTenant Id: N/A\n" }), T), { tool: "cli.fab", ranAt: T, outcome: "ok", signedIn: false, tenantId: undefined });
  for (const p of [az, dbx, fab]) noLeak("parsed probe", JSON.stringify(p));
});

test("connections: states and next steps per sign-in, bindings declared not checked, and nothing checked before asked", () => {
  const m = salesBi();
  const present = (t: string) => t === "cli.databricks" ? false : true;
  const before = buildConnections({ connections: m.connections, identifiers: m.identifiers, probes: new Map(), present });
  assert.deepEqual(before.map(c => [c.id, c.state]), [["azure-dev", "not-checked-yet"], ["fabric", "not-checked-yet"], ["dbx-dev", "tool-missing"], ["sales-git", "declared"], ["sales-sql", "declared"]]);
  assert.match(before[3]!.detail, /^declared, not checked · Sales workspace ↔ bi · fabric\/ · branch dev \(dev\)$/);
  assert.equal(before[3]!.portalHint, "Workspace settings → Git integration");
  assert.equal(before[3]!.hasPortal, true);
  assert.equal(portalFor(m.connections![3]!, m.identifiers!), `https://app.fabric.microsoft.com/groups/${WS_DEV}`);
  assert.match(portalFor(m.connections![4]!, m.identifiers!)!, /^https:\/\/learn\.microsoft\.com\//);

  const probe = (p: ConnectionProbe) => new Map<string, ConnectionProbe>([[p.tool, p]]);
  const az = (over: Partial<ConnectionProbe>) => buildConnections({ connections: [m.connections![0]!], identifiers: m.identifiers, probes: probe({ tool: "cli.az", ranAt: T, outcome: "ok", ...over }), present: () => true })[0]!;
  assert.equal(az({ signedIn: true, tenantId: TENANT, subscriptionId: SUB_DEV }).state, "ok");
  assert.match(az({ signedIn: true, tenantId: TENANT, subscriptionId: SUB_DEV }).detail, /tenant "Entra tenant" ✓ · subscription "Data subscription" ✓/);
  const other = az({ signedIn: true, tenantId: OTHER_TENANT, subscriptionId: SUB_DEV });
  assert.equal(other.state, "mismatch"); assert.equal(other.signIn, "az-login");
  const sub = az({ signedIn: true, tenantId: TENANT, subscriptionId: "55555555-5555-5555-5555-555555555555" });
  assert.equal(sub.state, "mismatch"); assert.equal(sub.signIn, "az-subscription");
  assert.equal(az({ signedIn: false }).state, "signed-out");
  assert.equal(az({ outcome: "timeout", reason: "az account show did not answer in time" }).state, "check-failed");

  const dbx = (profiles: Array<{ name: string; valid: boolean }>) => buildConnections({ connections: [m.connections![2]!], identifiers: m.identifiers, probes: probe({ tool: "cli.databricks", ranAt: T, outcome: "ok", profiles }), present: () => true })[0]!;
  assert.equal(dbx([{ name: "sales-dev", valid: true }]).state, "ok");
  assert.equal(dbx([{ name: "sales-dev", valid: false }]).state, "profile-invalid");
  assert.equal(dbx([{ name: "DEFAULT", valid: true }]).state, "profile-missing");

  const fab = (over: Partial<ConnectionProbe>) => buildConnections({ connections: [m.connections![1]!], identifiers: m.identifiers, probes: probe({ tool: "cli.fab", ranAt: T, outcome: "ok", ...over }), present: () => true })[0]!;
  assert.equal(fab({ signedIn: true, tenantId: TENANT }).state, "ok");
  assert.equal(fab({ signedIn: true, tenantId: OTHER_TENANT }).state, "mismatch");
  assert.equal(fab({ signedIn: false }).state, "signed-out");

  // A sign-in with a tool DataPass cannot check read-only.
  assert.equal(buildConnections({ connections: [{ id: "g", kind: "sign-in", tool: "cli.gcloud" }], probes: new Map(), present: () => true })[0]!.state, "declared");
  assert.deepEqual(toolsToCheck(m.connections), ["cli.az", "cli.fab", "cli.databricks"]);
});

test("connections: sign-in commands are built at click time from the manifest, never kept in a view", () => {
  const m = salesBi();
  assert.equal(signInCommand(m.connections![0]!, m.identifiers!, "az-login"), `az login --tenant ${TENANT}`);
  assert.equal(signInCommand(m.connections![0]!, m.identifiers!, "az-subscription"), `az account set --subscription ${SUB_DEV}`);
  assert.equal(signInCommand(m.connections![2]!, m.identifiers!, "databricks-login"), "databricks auth login --profile sales-dev");
  assert.equal(signInCommand(m.connections![1]!, m.identifiers!, "fab-login"), `fab auth login --tenant ${TENANT}`);
  const views = buildConnections({ connections: m.connections, identifiers: m.identifiers, probes: new Map([["cli.az", { tool: "cli.az", ranAt: T, outcome: "ok", signedIn: true, tenantId: OTHER_TENANT } as ConnectionProbe]]), present: () => true });
  for (const v of VALUES) assert.ok(!JSON.stringify(views).includes(v), `a view holds ${v}`);
});

// ------------------------------------------------------------------ the runner: fixed commands, home folder, no prompt, no manifest value

test("connection checks: each CLI gets its fixed command; no manifest value is ever an argument", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runner: ConnectionRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === "az") return ran({ stdout: AZ_OUT });
    if (command === "databricks") return ran({ stdout: DBX_OUT });
    return ran(FAB_OUT);
  };
  const results = await runConnectionChecks(toolsToCheck(salesBi().connections), runner, () => T);
  assert.deepEqual(calls.map(c => `${c.command} ${c.args.join(" ")}`).sort(), ["az account show --output json", "databricks auth profiles --output json", "fab auth status"]);
  const argv = JSON.stringify(calls);
  for (const v of [...VALUES, "sales-dev", "tenant", "sub-data", "ws-sales"]) assert.ok(!argv.includes(v), `${v} passed to a CLI`);
  noLeak("stored probes", JSON.stringify([...results.values()]));
  // A runner that throws is a failed check, not a crash.
  const broken = await runConnectionChecks(["cli.az"], async () => { throw new Error(`boom ${ACCOUNT}`); }, () => T);
  assert.equal(broken.get("cli.az")?.outcome, "failed");
  noLeak("failed probe", JSON.stringify([...broken.values()]));
});

test("connection checks: the real runner runs from the home folder with stdin closed and a timeout (fake CLI on PATH)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-fakecli-"));
  const report = path.join(dir, "fake.js");
  fs.writeFileSync(report, [
    "let stdin = '';",
    "process.stdin.on('data', d => stdin += d);",
    "process.stdin.on('end', () => {",
    "  if (process.argv.includes('sleep')) { setTimeout(() => {}, 60000); return; }",
    "  process.stdout.write(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), stdinEnded: true, noColor: process.env.NO_COLOR }));",
    "});"
  ].join("\n"));
  const name = "dpfakecli";
  if (process.platform === "win32") fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${process.execPath}" "%~dp0fake.js" %*\r\n`);
  else { fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake.js" "$@"\n`); fs.chmodSync(path.join(dir, name), 0o755); }
  const saved = { PATH: process.env.PATH, Path: process.env.Path };
  const sep = process.platform === "win32" ? ";" : ":";
  process.env.PATH = `${dir}${sep}${saved.PATH ?? saved.Path ?? ""}`;
  if (process.platform === "win32") process.env.Path = process.env.PATH;
  const oldCwd = process.cwd();
  try {
    process.chdir(dir);   // the extension host's own folder must not matter either
    const r = await defaultConnectionRunner(name, ["account", "show", "--output", "json"], 15000);
    assert.ok(r.ok, JSON.stringify(r));
    const seen = JSON.parse(r.stdout);
    assert.equal(path.resolve(seen.cwd).toLowerCase(), path.resolve(os.homedir()).toLowerCase(), "runs from the home folder, never the workspace");
    assert.deepEqual(seen.args, ["account", "show", "--output", "json"]);
    assert.equal(seen.stdinEnded, true, "stdin is closed: a prompt ends at once");
    assert.equal(seen.noColor, "1");
    const slow = await defaultConnectionRunner(name, ["sleep"], 1500);
    assert.equal(slow.ok, false); assert.equal(slow.timedOut, true);
    const missing = await defaultConnectionRunner("dp-no-such-cli-7f3a", ["x"], 2000);
    assert.equal(missing.notFound, true);
  } finally {
    process.chdir(oldCwd);
    process.env.PATH = saved.PATH;
    if (process.platform === "win32") process.env.Path = saved.Path;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("credential files are never opened: no file API call in the source names one, and a full check run reads no file", async () => {
  const CREDENTIAL_FILES = /\.databrickscfg|databricks-token|token-cache|accessTokens\.json|msal_token_cache|msal_http_cache|azureProfile\.json|service_principal_entries|\.fabric-cli|fab_config/i;
  const FILE_API = /readFile|readFileSync|openSync|createReadStream|joinPath|path\.join|Uri\.file|\bstat\(|statSync|readdir/;
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []);
  const offenders: string[] = [];
  for (const f of walk("src")) fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => { if (CREDENTIAL_FILES.test(line) && FILE_API.test(line)) offenders.push(`${f}:${i + 1}`); });
  assert.deepEqual(offenders, []);
  // Behaviour: spy on every read API while the whole v5 pipeline runs (validation, checks, readiness, packs).
  const opened: string[] = [];
  const spied = ["readFileSync", "openSync", "readFile", "createReadStream", "statSync", "existsSync"] as const;
  const target = fsModule as any;
  const originals = spied.map(k => [k, target[k]] as const);
  const promisesRead = target.promises.readFile;
  for (const [k, orig] of originals) target[k] = (p: unknown, ...rest: unknown[]) => { opened.push(String(p)); return orig(p, ...rest); };
  target.promises.readFile = (p: unknown, ...rest: unknown[]) => { opened.push(String(p)); return promisesRead(p, ...rest); };
  syncBuiltinESMExports();
  try {
    const m = salesBi();
    assert.deepEqual(validateProjectManifest(m), []);
    const results = await runConnectionChecks(toolsToCheck(m.connections), async c => ran(c === "az" ? { stdout: AZ_OUT } : c === "databricks" ? { stdout: DBX_OUT } : FAB_OUT), () => T);
    const r = buildReadiness(readinessInput({ connectionProbes: results }));
    readinessReport(r, m.project, T); toolchainContextLines(r); readinessSnapshot(r);
  } finally {
    for (const [k, orig] of originals) target[k] = orig;
    target.promises.readFile = promisesRead;
    syncBuiltinESMExports();
  }
  assert.deepEqual(opened.filter(p => CREDENTIAL_FILES.test(p) || /[\\/]\.azure[\\/]|[\\/]\.databricks/i.test(p)), []);
});

// ------------------------------------------------------------------ readiness, packs, report: names and states only

test("readiness v5: checks for tools and connections, and every projection holds names and states only", () => {
  const results = new Map<string, ConnectionProbe>([
    ["cli.az", parseAzAccount(ran({ stdout: AZ_OUT.replace(new RegExp(TENANT, "g"), OTHER_TENANT) }), T)],
    ["cli.fab", parseFabStatus(ran(FAB_OUT), T)],
    ["cli.databricks", parseDatabricksProfiles(ran({ stdout: DBX_OUT }), T)]
  ]);
  const r = buildReadiness(readinessInput({
    connectionProbes: results,
    extensionsJson: parseExtensionsJson("{\"recommendations\": [\"ms-python.python\"]}"),
    tools: probes({ "cli.fab": "1.2.0", "cli.az": "2.59.1", "ext.fabric": "1.3.0", "cli.databricks": "0.230.0" }),
    bindingFolders: new Map([["sales-git", "missing"]])
  }));
  const ids = r.checks.map(c => `${c.severity}:${c.id}`);
  for (const want of ["warning:tools.range:cli.az", "warning:tools.unknown:cli.databrick", "info:tools.missing:pack.powerbi-gbrueckl", "info:tools.extensionsJson.missing",
    "warning:connection.mismatch:azure-dev", "warning:connection.profile-invalid:dbx-dev", "info:connection.folder:sales-git"]) assert.ok(ids.includes(want), `${want} in ${ids.join(", ")}`);
  assert.ok(!ids.some(i => /connection\.(declared|ok)/.test(i)), "declared bindings and ok sign-ins are not problems");
  assert.deepEqual(r.identifiers.find(d => d.id === "ws-sales")?.environments, ["dev", "prod"]);

  const snapshot = JSON.stringify(readinessSnapshot(r));
  const context = [...readinessContextLines(r), ...toolchainContextLines(r)].join("\n");
  const report = readinessReport(r, { id: "sales-bi", title: "Sales BI" }, T);
  const wb = JSON.stringify(wbReadiness(r));
  const ai = buildAiContext("current-task", { project: { id: "sales-bi", title: "Sales BI" }, preflight: [], impact: [], programme: [], packs: [], toolchain: toolchainContextLines(r) }).text;
  for (const [what, text] of [["snapshot", snapshot], ["AI context lines", context], ["report", report], ["Workbench state", wb], ["Copy AI context", ai], ["readiness", JSON.stringify(r)]] as const) {
    noLeak(what, text, VALUES);
  }
  assert.match(context, /`ws-sales` Sales workspace · fabric workspace · per environment: dev, prod/);
  assert.match(context, /`azure-dev` sign-in cli\.az \(dev\): signed in elsewhere/);
  assert.match(context, /`sales-git` git-binding fabric \(dev\): declared, not checked/);
  assert.match(context, /`cli\.az` \(Azure CLI\): 2\.59\.1 ✗ needs \^2\.60/);
  assert.match(report, /## Tools & versions[\s\S]*## Connections/);
  assert.match(ai, /## Tools, ID map and connections \(names and states only\)/);
});

test("readiness v5: a v4 project is told what v5 adds; a v5 project without a toolchain gets a note", () => {
  const v4 = buildReadiness(readinessInput({ manifest: { schemaVersion: 4, project: { id: "edge", title: "Edge" } } as DataPassProjectManifest }));
  assert.match(v4.checks.find(c => c.id === "manifest.version")!.message, /tools and versions the project needs, ids per environment and connections/);
  const bare = buildReadiness(readinessInput({ manifest: { schemaVersion: 5, project: { id: "bare", title: "Bare" } } }));
  assert.ok(bare.checks.some(c => c.id === "manifest.toolchain" && c.severity === "info"));
  assert.equal(bare.toolchain.declared, false);
  assert.deepEqual(bare.connections, []);
});

// ------------------------------------------------------------------ migration and non-FOIL examples

test("migration: a v4 manifest upgrades to v5 unchanged except the version, and stays valid", () => {
  const v4: DataPassProjectManifest = {
    schemaVersion: 4, project: { id: "shop", title: "Web shop" },
    environments: [{ id: "dev" }],
    identifiers: [{ id: "sub", label: "Subscription", value: SUB_DEV, provider: "azure" }],
    localEnv: { files: [".env"], requiredKeys: ["AZURE_SUBSCRIPTION_ID"] }
  };
  const before = structuredClone(v4);
  const up = migrateManifestToLatest(v4);
  assert.equal(up.schemaVersion, 5);
  assert.deepEqual(v4, before, "input not mutated");
  assert.deepEqual({ ...up, schemaVersion: 4 }, v4);
  assert.deepEqual(validateProjectManifest(up), []);
  // And the upgraded file can then take v5 fields.
  const grown: DataPassProjectManifest = { ...up, identifiers: [{ id: "sub", label: "Subscription", kind: "subscription", values: { dev: SUB_DEV }, provider: "azure" }], toolchain: { tools: [{ tool: "cli.az", version: ">=2.60" }] }, connections: [{ id: "az", kind: "sign-in", tool: "cli.az", subscription: "sub", environment: "dev" }] };
  assert.deepEqual(validateProjectManifest(grown), []);
});

test("non-FOIL examples: a Databricks analytics project and an Azure web shop are valid v5 manifests", () => {
  const databricks: DataPassProjectManifest = {
    schemaVersion: 5, project: { id: "churn-analytics", title: "Churn analytics" },
    environments: [{ id: "dev" }, { id: "prod", production: true }],
    identifiers: [{ id: "dbx-ws", label: "Databricks workspace id", provider: "databricks", kind: "workspace", values: { dev: "1234567890123456", prod: "6543210987654321" } }],
    toolchain: { tools: [{ tool: "cli.databricks", version: ">=0.230" }, { tool: "ext.databricks" }, { tool: "cli.python", version: "3.11.x || 3.12.x" }] },
    connections: [{ id: "dbx-dev", kind: "sign-in", tool: "cli.databricks", profile: "churn-dev", environment: "dev" }, { id: "repo", kind: "git-binding", provider: "databricks", identifier: "dbx-ws", environment: "dev", branch: "main" }]
  };
  const shop: DataPassProjectManifest = {
    schemaVersion: 5, project: { id: "web-shop", title: "Web shop" },
    environments: [{ id: "dev" }],
    identifiers: [{ id: "tenant", label: "Tenant", kind: "tenant", provider: "azure", value: TENANT }, { id: "rg", label: "Resource group", kind: "resource-group", provider: "azure", values: { dev: "rg-shop-dev" } }],
    toolchain: { tools: [{ tool: "cli.az", version: ">=2.60" }, { tool: "cli.func", version: "^4" }, { tool: "ext.azure-functions" }, { tool: "cli.tofu", where: "ci" }] },
    connections: [{ id: "azure", kind: "sign-in", tool: "cli.az", identifier: "tenant" }, { id: "api-conn", kind: "cloud-connection", provider: "azure", name: "shop-api-connection", environment: "dev" }]
  };
  for (const m of [databricks, shop]) assert.deepEqual(validateProjectManifest(m), [], m.project.id);
  const view = buildToolchain({ toolchain: databricks.toolchain as ToolchainDecl, tools: probes({ "cli.python": "3.12.4", "cli.databricks": "0.229.0" }), platform: "darwin" });
  assert.deepEqual(view.entries.map(e => e.state), ["outside-range", "missing", "ok"]);
  assert.equal(view.entries[1]!.install?.command, "code --install-extension databricks.databricks");
  assert.equal(portalFor(shop.connections![1]!, shop.identifiers as IdentifierDecl[]), "https://portal.azure.com/");
});

test("docs: PREPARING_A_PROJECT.md lists every tool id DataPass knows (the contract an AI reads)", () => {
  const guide = fs.readFileSync("docs/PREPARING_A_PROJECT.md", "utf8");
  const missing = [...knownTools().keys()].filter(id => !guide.includes(`\`${id}\``));
  assert.deepEqual(missing, []);
});
