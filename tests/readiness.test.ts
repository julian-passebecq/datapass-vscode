/**
 * Environment readiness (manifest v4 localEnv / identifiers): key-presence parsing, validation,
 * deterministic checks, optional companions, migration, and the guarantee that no env value
 * reaches any output. A fake .env holds recognizable fake secrets; every projection built from it
 * (readiness, tree/webview state, snapshot, preparation pack, AI context, report) is searched for
 * them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { envKeyPresence, isEnvFileName } from "../src/core/readiness/envFile";
import {
  buildReadiness, readinessContextLines, readinessReport, readinessSnapshot, validateReadinessSections,
  type EnvFileObservation, type ReadinessInput
} from "../src/core/readiness/readiness";
import {
  LATEST_MANIFEST_VERSION, foilProjectManifest, genericProjectManifest, migrateManifestToLatest, validateProjectManifest, type DataPassProjectManifest
} from "../src/core/projectManifestModel";
import type { RepoView } from "../src/core/project/resolve";
import { buildProjectMap } from "../src/core/project/projectMap";
import { buildPreparationPack } from "../src/core/project/preparation";
import { buildAiContext } from "../src/core/exchange/aiContext";
import { buildSanitizedEnvironmentSnapshot } from "../src/core/snapshot";
import { wbReadiness } from "../src/views/workbenchState";
import { inputA } from "./fixtures/v3/research";

const FAKE_SECRET = "DPFAKESECRET_7f3a9c1e5b2d_do_not_leak";
const FAKE_SECRET_2 = "dpfake-mongo-password-91c2";
const FAKE_UNDECLARED = "DPFAKE_UNDECLARED_VALUE_4410";
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

const bytes = (text: string) => new TextEncoder().encode(text);
const FAKE_ENV = [
  "# Cloudflare worker",
  `CLOUDFLARE_ACCOUNT_ID=${ACCOUNT_ID}`,
  `export CLOUDFLARE_API_TOKEN="${FAKE_SECRET}"`,
  "MONGODB_URI=",
  `UNDECLARED_PRIVATE_NAME=${FAKE_UNDECLARED}`,
  ""
].join("\n");

function cloudflareManifest(extra: Partial<DataPassProjectManifest> = {}): DataPassProjectManifest {
  return {
    schemaVersion: 4,
    project: { id: "edge-shop", title: "Edge shop" },
    localEnv: { files: [".env", { path: ".env.local", optional: true }], requiredKeys: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "MONGODB_URI"] },
    identifiers: [{ id: "cf-account", label: "Cloudflare account ID", value: ACCOUNT_ID, provider: "cloudflare", envKey: "CLOUDFLARE_ACCOUNT_ID" }],
    modules: { diagramcloud: false },
    // Legacy block from an older manifest: accepted and ignored.
    companions: { mongoku: { entityId: "edge_shop" } },
    ...extra
  };
}

const wanted = new Set(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "MONGODB_URI"]);
function envObs(text = FAKE_ENV, git: EnvFileObservation["git"] = "ignored"): Map<string, EnvFileObservation> {
  return new Map<string, EnvFileObservation>([[":.env", { state: "found", presence: envKeyPresence(bytes(text), wanted), git }], [":.env.local", { state: "missing" }]]);
}

const repo = (over: Partial<RepoView> = {}): RepoView => ({
  key: ".", label: "This repository", state: "local", coordination: true, detail: "", usedBy: [],
  git: { branch: "main", head: "a1b2c3d4e5f6a7b8", upstream: "origin/main", changes: 0, ahead: 0, behind: 0 }, ...over
});

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    manifest: cloudflareManifest(), coordinationKey: ".", envFiles: envObs(), repositories: [repo()], problems: [],
    settings: {}, diagramCloudSidecar: true, latestSchemaVersion: LATEST_MANIFEST_VERSION, ...over
  };
}

// ------------------------------------------------------------------ parser

test("env parser: presence of the declared names only, never values or undeclared names", () => {
  const p = envKeyPresence(bytes(FAKE_ENV), wanted);
  assert.deepEqual(Object.fromEntries(p), { CLOUDFLARE_ACCOUNT_ID: "set", CLOUDFLARE_API_TOKEN: "set", MONGODB_URI: "empty" });
  assert.ok(!p.has("UNDECLARED_PRIVATE_NAME"), "undeclared names are not returned");
  assert.ok(!JSON.stringify([...p]).includes(FAKE_SECRET));
});

test("env parser: dotenv syntax (export, quotes, multi-line, comments, CRLF, BOM, `:`, last wins)", () => {
  const text = "\uFEFF# c\r\nA=1\r\nexport B = 'x'\r\nC=\"\"\r\nD=  # only a comment\r\nE=\"line1\nF=not-a-definition\nline3\"\nG: value\nH=first\nH=\nI=`\n`\n  J=spaced\nK\n";
  const got = Object.fromEntries(envKeyPresence(bytes(text), new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"])));
  assert.deepEqual(got, { A: "set", B: "set", C: "empty", D: "empty", E: "set", G: "set", H: "empty", I: "set", J: "set" });
});

test("env file names: only .env, .env.<name>, <name>.env and .dev.vars are read", () => {
  for (const ok of [".env", ".env.local", "apps/web/.env.production", "prod.env", ".dev.vars", ".dev.vars.staging"]) assert.ok(isEnvFileName(ok), ok);
  for (const bad of ["id_rsa", ".envrc", "config.json", "secrets.yaml", ".env/", "env"]) assert.ok(!isEnvFileName(bad), bad);
});

// ------------------------------------------------------------------ validation

test("manifest v4: localEnv and identifiers validate; v3 refuses them", () => {
  assert.deepEqual(validateProjectManifest(cloudflareManifest()), []);
  const v3 = { ...cloudflareManifest(), schemaVersion: 3 };
  const errors = validateProjectManifest(v3);
  assert.ok(errors.includes("localEnv requires schemaVersion 4."));
  assert.ok(errors.includes("identifiers requires schemaVersion 4."));
});

test("manifest v4: env files must be env files inside the repository, names must be variable names", () => {
  const bad = (localEnv: unknown) => validateReadinessSections({ schemaVersion: 4, localEnv }, new Set(["web"]));
  assert.match(bad({ files: ["../.env"] }).join(), /relative path inside the repository/);
  assert.match(bad({ files: ["C:/Users/x/.env"] }).join(), /relative path/);
  assert.match(bad({ files: ["config/secrets.json"] }).join(), /must name an env file/);
  assert.match(bad({ files: [{ path: ".env", repoRef: "nope" }] }).join(), /declared repository/);
  assert.match(bad({ files: [] }).join(), /1 to 10/);
  assert.match(bad({ files: [".env", ".env"] }).join(), /listed twice/);
  assert.match(bad({ files: [".env"], requiredKeys: ["OK", "1BAD", "OK"] }).join(), /requiredKeys\[1\].*variable name.*requiredKeys\[2\] "OK" is listed twice/);
  assert.deepEqual(bad({ files: [{ path: "apps/web/.dev.vars", repoRef: "web", optional: true }], requiredKeys: ["X"] }), []);
});

test("identifiers: secret-shaped values and secret names are refused, and a refused value is never echoed", () => {
  const check = (ident: Record<string, unknown>) => validateReadinessSections({ schemaVersion: 4, identifiers: [{ id: "a", label: "Account", value: "123", ...ident }] }, new Set());
  // Token-shaped fakes are assembled at runtime so no credential-shaped literal is committed.
  for (const value of [["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_"), ["sk", "ABCDEFGHIJKLMNOPQRSTUV"].join("-"), "AKIA" + "ABCDEFGHIJKLMNOP", "dapi" + "0123456789abcdef".repeat(2)]) {
    const issues = check({ value });
    assert.match(issues.join(), /looks like a credential/, value);
    assert.ok(!issues.join().includes(value), "the refused value is not echoed");
  }
  const withSecret = check({ value: `${FAKE_SECRET} x` });
  assert.match(withSecret.join(), /plain identifier/);
  assert.ok(!withSecret.join().includes(FAKE_SECRET));
  for (const envKey of ["CLOUDFLARE_API_TOKEN", "MONGODB_URI", "DATABASE_URL", "DB_PASSWORD", "STRIPE_SECRET_KEY", "API_KEY", "SESSION_COOKIE"]) assert.match(check({ envKey }).join(), /names a secret/, envKey);
  for (const label of ["API key", "Access token", "Admin password"]) assert.match(check({ label }).join(), /named like a secret/, label);
  // Non-secret ids and names that merely contain "pass" or "key" as part of a word are accepted.
  assert.deepEqual(check({ id: "datapass-project", label: "Keyboard layout id", envKey: "CLOUDFLARE_ACCOUNT_ID", value: ACCOUNT_ID }), []);
  assert.deepEqual(check({ value: "4f1e2d3c-aaaa-bbbb-cccc-0123456789ab", envKey: "AZURE_SUBSCRIPTION_ID" }), []);
});

test("migration: v1, v2, v3 and v4 upgrade to the latest (v5) without losing a field or mutating the input", () => {
  assert.equal(LATEST_MANIFEST_VERSION, 5);
  for (const m of [genericProjectManifest("x"), foilProjectManifest(), inputA().manifest!, cloudflareManifest()]) {
    const before = structuredClone(m);
    const up = migrateManifestToLatest(m);
    assert.equal(up.schemaVersion, 5);
    assert.deepEqual(m, before, "input not mutated");
    assert.deepEqual(validateProjectManifest(up), []);
    for (const key of Object.keys(m)) if (key !== "schemaVersion") assert.ok(key in up, key);
  }
  const v3 = inputA().manifest!;
  assert.deepEqual({ ...migrateManifestToLatest(v3), schemaVersion: 3 }, v3);
  // A v4 identifier's single value stays valid in v5: only the version moves.
  const v4 = cloudflareManifest();
  assert.deepEqual({ ...migrateManifestToLatest(v4), schemaVersion: 4 }, v4);
});

// ------------------------------------------------------------------ readiness and checks

test("readiness: a Cloudflare project shows expected files and names, which are missing, and where each value comes from", () => {
  const r = buildReadiness(input());
  assert.deepEqual(r.files.map(f => [f.path, f.state, f.optional]), [[".env", "found", false], [".env.local", "missing", true]]);
  assert.deepEqual(r.keys.map(k => [k.name, k.state, k.source]), [["CLOUDFLARE_ACCOUNT_ID", "set", "identifier"], ["CLOUDFLARE_API_TOKEN", "set", "vault"], ["MONGODB_URI", "empty", "vault"]]);
  assert.deepEqual(r.summary.keysSet, 2);
  const empty = r.checks.find(c => c.id === "env.key.empty:MONGODB_URI")!;
  assert.equal(empty.severity, "warning");
  assert.match(empty.nextStep!, /local vault \(Power Ops\)/);
  assert.ok(r.checks.some(c => c.id === "env.file.optional::.env.local" && c.severity === "info"), "optional file only a note");
});

test("readiness: missing file and key, committed or not-ignored env file", () => {
  const missing = buildReadiness(input({ envFiles: new Map([[":.env", { state: "missing" }], [":.env.local", { state: "missing" }]]) }));
  assert.ok(missing.checks.some(c => c.id === "env.file.missing::.env" && c.severity === "warning"));
  const token = missing.checks.find(c => c.id === "env.key.missing:CLOUDFLARE_API_TOKEN")!;
  assert.match(token.nextStep!, /Power Ops/);
  const account = missing.checks.find(c => c.id === "env.key.missing:CLOUDFLARE_ACCOUNT_ID")!;
  assert.match(account.nextStep!, /non-secret id "Cloudflare account ID"/);
  const tracked = buildReadiness(input({ envFiles: envObs(FAKE_ENV, "tracked") }));
  assert.equal(tracked.checks[0]!.id, "env.file.tracked::.env");
  assert.equal(tracked.checks[0]!.severity, "error");
  assert.match(tracked.checks[0]!.nextStep!, /git rm --cached \.env/);
  assert.ok(buildReadiness(input({ envFiles: envObs(FAKE_ENV, "not-ignored") })).checks.some(c => c.id === "env.file.notignored::.env" && c.severity === "warning"));
  const notCloned = buildReadiness(input({ manifest: cloudflareManifest({ repositories: { web: { remote: { url: "https://github.com/example/web" } } }, localEnv: { files: [{ path: ".dev.vars", repoRef: "web" }], requiredKeys: ["X"] } }), envFiles: new Map([["web:.dev.vars", { state: "not-cloned" }]]) }));
  assert.equal(notCloned.keys[0]!.state, "not-checked");
  assert.ok(notCloned.checks.some(c => c.id === "env.file.notcloned:web:.dev.vars" && c.severity === "info"));
});

test("optional companions: a disabled module yields only 'optional module disabled' — no warning, no error, no check", () => {
  const r = buildReadiness(input({ settings: {} }));
  assert.deepEqual(r.companions.map(c => [c.module, c.state, c.detail]), [["diagramcloud", "disabled", "optional module disabled"]]);
  assert.equal(r.checks.filter(c => c.area === "companion").length, 0);
  assert.ok(!r.checks.some(c => /mongoku|diagramcloud/i.test(c.message)));
  // Enabled, mapped, no address: a note, never a warning.
  const on = buildReadiness(input({ manifest: cloudflareManifest({ modules: {} }) }));
  assert.deepEqual(on.checks.filter(c => c.area === "companion").map(c => [c.id, c.severity]), [["companion.diagramcloud.url", "info"]]);
  const configured = buildReadiness(input({ manifest: cloudflareManifest({ modules: {} }), settings: { diagramCloudUrl: "https://diagram.example.com/" } }));
  assert.deepEqual(configured.companions.map(c => c.state), ["configured"]);
  assert.equal(configured.checks.filter(c => c.area === "companion").length, 0);
  // Enabled but not used by the project: nothing to fix either.
  const unused = buildReadiness(input({ manifest: cloudflareManifest({ modules: {}, companions: undefined }), diagramCloudSidecar: false }));
  assert.deepEqual(unused.companions.map(c => c.state), ["not-configured"]);
  assert.equal(unused.checks.filter(c => c.area === "companion").length, 0);
});

test("repository branch/head checks: detached, wrong branch, behind, ahead, changes, no upstream", () => {
  const r = buildReadiness(input({
    repositories: [
      repo({ key: "a", label: "A", git: { branch: "(detached)", head: "1111111aaaa" } }),
      repo({ key: "b", label: "B", branch: "main", git: { branch: "feature", head: "2222222bbbb", upstream: "origin/feature", behind: 3, ahead: 1, changes: 2 } }),
      repo({ key: "c", label: "C", git: { branch: "main", head: "3333333cccc" } }),
      repo({ key: "d", label: "D", state: "missing", git: undefined })
    ]
  }));
  const ids = r.checks.filter(c => c.area === "repository").map(c => `${c.severity}:${c.id}`);
  for (const want of ["warning:repo.detached:a", "warning:repo.branch:b", "info:repo.behind:b", "info:repo.ahead:b", "info:repo.changes:b", "info:repo.upstream:c", "error:repo.missing:d"]) assert.ok(ids.includes(want), `${want} in ${ids.join(", ")}`);
  assert.equal(r.checks[0]!.severity, "error", "errors first");
  assert.deepEqual(r.repositories.find(x => x.key === "b"), { key: "b", label: "B", state: "local", branch: "feature", expectedBranch: "main", head: "2222222", changes: 2, ahead: 1, behind: 3, upstream: true });
});

test("manifest checks: older version, no localEnv, unused identifier, project problems", () => {
  const v3 = buildReadiness(input({ manifest: inputA().manifest }));
  assert.ok(v3.checks.some(c => c.id === "manifest.version" && c.severity === "info"));
  assert.equal(v3.declared, false);
  const noEnv = buildReadiness(input({ manifest: cloudflareManifest({ localEnv: undefined }) }));
  assert.ok(noEnv.checks.some(c => c.id === "manifest.localEnv"));
  assert.ok(noEnv.checks.some(c => c.id === "manifest.identifier.unused:cf-account"));
  const problems = buildReadiness(input({ problems: [{ severity: "error", where: "graph", message: "x" }, { severity: "info", where: "y", message: "z" }] }));
  assert.equal(problems.checks.find(c => c.id === "manifest.problems")?.severity, "error");
});

// ------------------------------------------------------------------ no value in any output

test("no env value appears in any output: readiness, webview state, snapshot, report, AI context, preparation pack", () => {
  const r = buildReadiness(input({ envFiles: envObs(FAKE_ENV.replace("MONGODB_URI=", `MONGODB_URI=mongodb+srv://u:${FAKE_SECRET_2}@x.example.net/db`), "tracked") }));
  const map = buildProjectMap(inputA({ manifest: { ...cloudflareManifest(), schemaVersion: 4 } as DataPassProjectManifest }));
  const outputs: Record<string, string> = {
    readiness: JSON.stringify(r),
    webview: JSON.stringify(wbReadiness(r)),
    snapshot: JSON.stringify(buildSanitizedEnvironmentSnapshot({ generatedAt: "2026-09-25T10:00:00Z", project: { id: "edge-shop", title: "Edge shop", active: true, summary: "", bindings: [], actions: [] }, platforms: [] }, r)),
    readinessSnapshot: JSON.stringify(readinessSnapshot(r)),
    report: readinessReport(r, { id: "edge-shop", title: "Edge shop" }, "2026-09-25T10:00:00Z"),
    contextLines: readinessContextLines(r).join("\n"),
    aiContext: buildAiContext("missing-prerequisites", { project: { id: "edge-shop", title: "Edge shop" }, preflight: [], impact: [], programme: [], packs: [], environment: readinessContextLines(r) }).text,
    pack: buildPreparationPack({ map, question: "explain", dataPassVersion: "0.14.0", generatedAt: "2026-09-25T10:00:00Z", readiness: r }).text
  };
  for (const [name, text] of Object.entries(outputs)) {
    for (const secret of [FAKE_SECRET, FAKE_SECRET_2, FAKE_UNDECLARED, "UNDECLARED_PRIVATE_NAME"]) assert.ok(!text.includes(secret), `${name} leaked ${secret}`);
  }
  // Names and states are there; the declared non-secret id's value is not needed in any of them either.
  for (const name of ["snapshot", "report", "contextLines", "pack", "aiContext"]) {
    assert.ok(outputs[name]!.includes("CLOUDFLARE_API_TOKEN"), `${name} names the variable`);
    assert.ok(!outputs[name]!.includes(ACCOUNT_ID), `${name} holds names and states only`);
  }
  assert.match(outputs.pack!, /## Local environment \(names and states only\)/);
  assert.match(outputs.pack!, /`CLOUDFLARE_API_TOKEN`: set in \.env · secret, kept in my local vault/);
  assert.match(outputs.aiContext!, /## Local environment/);
  const snap = JSON.parse(outputs.snapshot!);
  assert.deepEqual(snap.environment.keys, [
    { name: "CLOUDFLARE_ACCOUNT_ID", state: "set", source: "identifier" },
    { name: "CLOUDFLARE_API_TOKEN", state: "set", source: "vault" },
    { name: "MONGODB_URI", state: "set", source: "vault" }
  ]);
  assert.deepEqual(snap.environment.companions, [{ module: "diagramcloud", state: "disabled" }]);
});

// ------------------------------------------------------------------ D-22 evidence chain

test("readiness: the evidence chain for az and the Fabric MCP server, unknown with reasons, in the report and the workbench", () => {
  const at = "2026-09-26T10:00:00.000Z";
  const r = buildReadiness(input({ tools: new Map([["cli.az", { toolId: "cli.az", state: "present", via: "az", version: "2.70.0", observedAt: at }], ["ws.mcp", { toolId: "ws.mcp", state: "absent", observedAt: at }]]) }));
  const az = r.evidence.find(e => e.id === "cli.az")!;
  assert.equal(az.summary, "installed / authenticated identity unknown");
  const fabric = r.evidence.find(e => e.id === "mcp.fabric-management")!;
  assert.equal(fabric.summary, "installed unknown");
  const reg = fabric.chain.find(l => l.link === "registered")!;
  assert.ok(reg.state === "observed" && !reg.holds, "no .vscode/mcp.json: observed not registered");
  assert.ok(fabric.chain.filter(l => l.state === "unknown").every(l => l.state === "unknown" && l.reason.length > 10));
  const report = readinessReport(r, { id: "p", title: "P" }, at);
  assert.match(report, /## Integration evidence/);
  assert.match(report, /connected: unknown — a registration says what a host may start/);
  const wb = wbReadiness(r);
  assert.equal(wb.evidence.find(e => e.id === "cli.az")!.links.length, 7);
  assert.ok(!JSON.stringify(wb).includes(FAKE_SECRET));
});
