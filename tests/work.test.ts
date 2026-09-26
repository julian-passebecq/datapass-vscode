import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildWorkModel, checklistKey, IMPLICIT_SCOPE_ID, relevantProviders, type WorkModelInput } from "../src/core/work/workModel";
import type { ToolObservation } from "../src/core/capabilities/tools";
import { CAPABILITIES } from "../src/core/capabilities/registry";
import { foilProjectManifest, genericProjectManifest, migrateManifestToV2, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { parseDomainPack } from "../src/core/domainPacks/pack";
import { observeRemoteRevision, readRepoRevision, safeRemoteUrl, workingTreeFingerprint, type GitRunner } from "../src/core/workspace/gitBase";
import { parseClaimsRegister, emptyClaimsRegister } from "../src/core/publication/claimsRegister";
import { prepareBrief } from "../src/core/publication/brief";
import { emittedSchemaFiles } from "../src/core/contracts/schemaFiles";
import { parseGraph } from "../src/core/workspace/graph";
import { sha256Bytes } from "../src/core/model/ids";

const ROOT = join(__dirname, "..");
const RETAIL = parseDomainPack(readFileSync(join(ROOT, "resources", "domain-packs", "sample.retail.json")));
const NOW = "2026-09-24T12:00:00Z";

const present = (...ids: string[]) => new Map<string, ToolObservation>(ids.map(id => [id, { toolId: id, state: "present", observedAt: NOW }]));

function base(manifest: DataPassProjectManifest | undefined, extra: Partial<WorkModelInput> = {}): WorkModelInput {
  return { manifest, packs: [], tools: new Map(), facts: new Map(), reviewsConfirmed: new Set(), checklist: {}, appObservations: {}, exchanges: [], ...extra };
}

function v2Manifest(): DataPassProjectManifest {
  const m = migrateManifestToV2(genericProjectManifest("retail-bi"));
  m.platforms = { fabric: { workspaceName: "Retail" }, powerbi: { projectRoot: "bi" } };
  m.repositories = { site: { remote: { url: "https://github.com/example/site", branch: "main" }, management: "remote-only" } };
  m.apps = [{ id: "forecast-app", appType: "streamlit", repoRef: "site", entrypoint: "app.py" }];
  m.scopes = [{
    id: "weekly-forecast", title: "Weekly forecast refresh", objective: "Publish the weekly forecast report",
    capabilityRefs: ["fabric.workspace.browse"],
    checklist: [
      { id: "notebook", label: "Update the forecast notebook", capabilityRef: "fabric.notebook.edit-local-sync" },
      { id: "review", label: "Review the report" }
    ]
  }];
  return m;
}

test("no manifest: implicit scope and an initialize next step", () => {
  const m = buildWorkModel(base(undefined));
  assert.equal(m.scope.id, IMPLICIT_SCOPE_ID);
  assert.equal(m.scopeSource, "implicit");
  assert.match(m.nextStep, /Initialize a project manifest/);
  assert.equal(m.operations.length, 0);
});

test("v1 FOIL manifest without scopes derives operations from declared platforms", () => {
  const manifest = foilProjectManifest();
  const providers = relevantProviders(manifest, undefined);
  const m = buildWorkModel(base(manifest));
  assert.equal(m.scopeSource, "implicit");
  assert.ok(m.operations.length > 0);
  assert.ok(m.operations.every(o => providers.has(o.capability.provider)));
  // Nothing is declared yet, so the next step names the first blocked operation's prerequisite.
  assert.match(m.nextStep, /Declare .* in the project manifest|scope/);
});

test("declared scope: capabilityRefs plus checklist capabilities, in order, with checklist states", () => {
  const manifest = v2Manifest();
  const checklist = { [checklistKey("weekly-forecast", "review")]: { state: "blocked" as const, note: "waiting for data", at: NOW } };
  const m = buildWorkModel(base(manifest, { checklist }));
  assert.equal(m.scope.id, "weekly-forecast");
  assert.deepEqual(m.operations.map(o => o.capability.id), ["fabric.workspace.browse", "fabric.notebook.edit-local-sync"]);
  assert.equal(m.checklist[0]!.preflight?.capabilityId, "fabric.notebook.edit-local-sync");
  assert.equal(m.checklist[1]!.state, "blocked");
  assert.match(m.nextStep, /Resolve "Review the report" \(blocked: waiting for data\)/);
  assert.deepEqual(m.progress, { done: 0, total: 2 });
});

test("next step follows the first open checklist item's preflight", () => {
  const m = buildWorkModel(base(v2Manifest()));
  const notebook = m.checklist[0]!;
  assert.notEqual(notebook.preflight!.status, "ready"); // no tools present
  assert.ok(m.nextStep.startsWith("Update the forecast notebook:"));
});

test("optional tools never block an operation; required ones do; unknown is not absent", () => {
  const manifest = v2Manifest();
  manifest.scopes = [{ id: "s", title: "S", capabilityRefs: ["fabric.notebook.edit-local-sync"] }];
  const facts = new Map([["fabric.workspace", "Retail"]]);
  const absent = (...ids: string[]) => new Map<string, ToolObservation>(ids.map(id => [id, { toolId: id, state: "absent", observedAt: NOW }]));

  // Nothing probed yet: prerequisites are unknown, not missing.
  assert.equal(buildWorkModel(base(manifest, { facts })).operations[0]!.result.status, "unknown");

  // Required extension observed absent: blocked.
  const blocked = buildWorkModel(base(manifest, { facts, tools: absent("ext.fabric-data-engineering", "ext.jupyter", "cli.java") })).operations[0]!.result;
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.nextStep, /Fabric Data Engineering/);

  // Required tools present, every optional companion absent: ready.
  const tools = new Map([...absent("ext.fabric-studio", "ext.onelake", "cli.copilot", "ws.mcp"), ...present("ext.fabric-data-engineering", "ext.jupyter", "cli.java")]);
  const ready = buildWorkModel(base(manifest, { facts, tools })).operations[0]!.result;
  assert.equal(ready.status, "ready");
  assert.equal(ready.optionalMissing.length, 2);
  assert.match(ready.evidenceNote, /not that the operation will succeed/);

  // Workspace fact missing: blocked even with every tool present.
  assert.equal(buildWorkModel(base(manifest, { tools })).operations[0]!.result.status, "blocked");
});

test("unknown capability refs and a vanished selected scope are reported, not hidden", () => {
  const manifest = v2Manifest();
  manifest.scopes![0]!.capabilityRefs = ["fabric.does-not-exist"];
  const m = buildWorkModel(base(manifest, { selectedScopeId: "gone" }));
  assert.equal(m.scope.id, "weekly-forecast");
  assert.ok(m.problems.some(p => p.includes("fabric.does-not-exist")));
  assert.ok(m.problems.some(p => p.includes("\"gone\"")));
});

test("apps: remote-only binding is valid; missing repo is an issue; observations attach", () => {
  const manifest = v2Manifest();
  manifest.apps!.push({ id: "orphan", appType: "react", repoRef: "nope" });
  const obs = { state: "observed" as const, url: "https://github.com/example/site", ref: "main", revision: "a".repeat(40), observedAt: NOW };
  const m = buildWorkModel(base(manifest, { appObservations: { "forecast-app": obs } }));
  assert.equal(m.apps[0]!.issue, undefined);
  assert.equal(m.apps[0]!.observation?.revision, "a".repeat(40));
  assert.match(m.apps[1]!.issue!, /not declared/);
});

test("non-FOIL retail pack: programme views and outputs come from the pack, no FOIL terms", () => {
  const manifest = v2Manifest();
  const graph = parseGraph(JSON.stringify({ format: "datapass.graph", version: "0.1-draft", roles: {}, items: [{ id: "sales", kind: "dataset", label: "Sales" }] }));
  const m = buildWorkModel(base(manifest, { packs: [RETAIL], graph }));
  assert.ok(m.outputs.length > 0);
  assert.ok(m.programme.length > 0);
  const text = JSON.stringify(m.programme).toLowerCase();
  for (const term of ["foil", "lcoe", "francis", "éolienne"]) assert.ok(!text.includes(term), term);
});

test("exchanges are filtered to the active scope and newest first", () => {
  const ex = (id: string, scopeRef: string, at: string) => ({ id, kind: "app-request" as const, label: id, status: "x", scopeRef, at });
  const m = buildWorkModel(base(v2Manifest(), { exchanges: [ex("a", "weekly-forecast", "2026-01-01T00:00:00Z"), ex("b", "other", NOW), ex("c", "weekly-forecast", NOW)] }));
  assert.deepEqual(m.exchanges.map(e => e.id), ["c", "a"]);
});

// ---------------------------------------------------------------- git base

test("working tree fingerprint: clean trees hash to empty input, dirty trees include the diff", () => {
  assert.deepEqual(workingTreeFingerprint("", ""), { dirty: false, hash: sha256Bytes(new Uint8Array()) });
  const a = workingTreeFingerprint(" M a.txt\n", "diff1");
  const b = workingTreeFingerprint(" M a.txt\n", "diff2");
  assert.equal(a.dirty, true);
  assert.notEqual(a.hash.value, b.hash.value);
});

test("readRepoRevision: argv only, dirty flag, unversioned folders", async () => {
  const calls: string[][] = [];
  const run: GitRunner = async args => {
    calls.push(args);
    if (args[0] === "rev-parse") return { ok: true, stdout: "b".repeat(40) + "\n" };
    if (args[0] === "status") return { ok: true, stdout: "?? new.txt\n" };
    return { ok: true, stdout: "" };
  };
  const r = await readRepoRevision(run, "/repo");
  assert.equal(r.revision, "b".repeat(40));
  assert.equal(r.dirty, true);
  assert.ok(calls.every(c => Array.isArray(c)));
  const none = await readRepoRevision(async () => ({ ok: false, stdout: "" }), "/x");
  assert.equal(none.revision, "unversioned");
});

test("remote URLs with credentials or odd schemes are rejected before git runs", async () => {
  assert.equal(safeRemoteUrl("https://user:token@github.com/a/b"), undefined);
  assert.equal(safeRemoteUrl("file:///etc/passwd"), undefined);
  assert.equal(safeRemoteUrl("--upload-pack=evil"), undefined);
  assert.equal(safeRemoteUrl("https://github.com/a/b"), "https://github.com/a/b");
  assert.equal(safeRemoteUrl("git@github.com:a/b.git"), "git@github.com:a/b.git");
  let ran = false;
  const run: GitRunner = async () => { ran = true; return { ok: true, stdout: "" }; };
  assert.equal((await observeRemoteRevision(run, "https://u:p@github.com/a/b", "main", NOW)).state, "rejected");
  assert.equal((await observeRemoteRevision(run, "https://github.com/a/b", "-x", NOW)).state, "rejected");
  assert.equal((await observeRemoteRevision(run, "https://github.com/a/b", "a..b", NOW)).state, "rejected");
  assert.equal(ran, false);
});

test("observeRemoteRevision parses ls-remote and separates the -- guard from the URL", async () => {
  let seen: string[] = [];
  const sha = "c".repeat(40);
  const run: GitRunner = async args => { seen = args; return { ok: true, stdout: `${sha}\trefs/heads/main\n` }; };
  const obs = await observeRemoteRevision(run, "https://github.com/a/b", "main", NOW);
  assert.deepEqual(seen, ["ls-remote", "--", "https://github.com/a/b", "refs/heads/main"]);
  assert.equal(obs.state, "observed");
  assert.equal(obs.revision, sha);
  assert.equal((await observeRemoteRevision(async () => ({ ok: true, stdout: "" }), "https://github.com/a/b", undefined, NOW)).state, "not-found");
  assert.equal((await observeRemoteRevision(async () => ({ ok: false, stdout: "", stderr: "fatal: auth" }), "https://github.com/a/b", undefined, NOW)).state, "unreachable");
});

// ---------------------------------------------------------------- claims register

const SRC = { id: "study-1", authority: "mongo:foil", recordRef: "studies/1", revision: "r3", observedAt: NOW, classification: "internal" as const, snapshotHash: { algorithm: "sha256" as const, value: "d".repeat(64) } };

test("claims register: strict parse, duplicates rejected, feeds prepareBrief without rewriting", () => {
  const reg = { ...emptyClaimsRegister(), sources: [SRC], claims: [
    { id: "c1", statement: "The prototype reached target A in test 3.", basis: "measured", sourceRefs: ["study-1"], review: "approved", limitations: ["single run"], allowedAudiences: ["internal", "named-reviewers"] },
    { id: "c2", statement: "Public claim without a public source.", basis: "measured", sourceRefs: ["study-1"], review: "approved", limitations: [], allowedAudiences: ["public"] }
  ] };
  const parsed = parseClaimsRegister(JSON.stringify(reg));
  assert.throws(() => parseClaimsRegister(JSON.stringify({ ...reg, claims: [reg.claims[0], reg.claims[0]] })), /Duplicate claim/);
  assert.throws(() => parseClaimsRegister(`{"format":"datapass.claims-register","format":"x","version":"0.1-draft","sources":[],"claims":[]}`), /[Dd]uplicate/);
  const baseRef = { scopeRevision: "s@1", manifestHash: sha256Bytes("m"), repositories: [] };
  const internal = prepareBrief({ id: "brief-a", projectRef: "p", scopeRef: "s", base: baseRef, createdAt: NOW, audience: "internal", purpose: "Review", outputFormats: ["pptx"], claims: parsed.claims, sources: parsed.sources, assetRefs: [] });
  assert.deepEqual(internal.envelope.payload.claims.map(c => c.id), ["c1"]);
  assert.equal(internal.envelope.payload.claims[0]!.statement, reg.claims[0]!.statement);
  const pub = prepareBrief({ id: "brief-b", projectRef: "p", scopeRef: "s", base: baseRef, createdAt: NOW, audience: "public", purpose: "Site", outputFormats: ["web"], claims: parsed.claims, sources: parsed.sources, assetRefs: [] });
  assert.equal(pub.envelope.payload.claims.length, 0);
  assert.match(pub.excluded.find(e => e.claimId === "c2")!.reason, /not releasable to public/);
});

// ---------------------------------------------------------------- shipped files stay consistent

test("committed JSON Schema files match the TypeScript definitions (run npm run schemas)", () => {
  for (const [file, schema] of Object.entries(emittedSchemaFiles())) {
    const committed = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
    assert.deepEqual(committed, schema, `${file} drifted`);
  }
});

test("package.json contributes every registered command and every datapass.* capability action", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const contributed = new Set<string>(pkg.contributes.commands.map((c: { command: string }) => c.command));
  const sources = ["src/extension.ts", ...readdirSync(join(ROOT, "src", "work")).map(f => `src/work/${f}`)].map(f => readFileSync(join(ROOT, f), "utf8")).join("\n");
  const registered = [...sources.matchAll(/(?:registerCommand|reg)\(\s*"(datapass\.[^"]+)"/g)].map(m => m[1]!);
  assert.ok(registered.length >= 25);
  for (const id of registered) assert.ok(contributed.has(id), `${id} is registered but not contributed`);
  for (const cap of CAPABILITIES) {
    if (cap.datapassActionId?.startsWith("datapass.")) assert.ok(registered.includes(cap.datapassActionId), `${cap.id} → ${cap.datapassActionId}`);
  }
  // V3 layout: Project tree first in the activity bar (0.19: the Git view under it), Architecture in the bottom panel, AI exchange and Details in the secondary side bar.
  const views = pkg.contributes.views.datapass.map((v: { id: string }) => v.id);
  assert.deepEqual(views, ["datapass.project", "datapass.git", "datapass.work", "datapass.galaxy"]);
  assert.ok(pkg.activationEvents.includes("onView:datapass.git"));
  assert.equal(pkg.contributes.configuration.properties["datapass.git.ghPath"].scope, "machine", "a workspace can never choose the gh program");
  assert.deepEqual(pkg.contributes.viewsContainers.panel.map((v: { id: string }) => v.id), ["datapass-architecture"]);
  assert.deepEqual(pkg.contributes.viewsContainers.secondarySidebar.map((v: { id: string }) => v.id), ["datapass-details"]);
  assert.deepEqual(pkg.contributes.views["datapass-architecture"].map((v: { id: string }) => v.id), ["datapass.architecture"]);
  // 0.24: the Claude & Codex panel between the AI view and Details.
  assert.deepEqual(pkg.contributes.views["datapass-details"].map((v: { id: string }) => v.id), ["datapass.aiExchange", "datapass.agentPanel", "datapass.details"]);
  assert.ok(pkg.activationEvents.includes("onView:datapass.aiExchange"));
  assert.equal(pkg.contributes.configuration.properties["datapass.layout.showInSecondarySideBar"].default, true, "DataPass replaces Chat in the secondary side bar by default");
  // The secondary side bar contribution point exists from VS Code 1.106.
  assert.match(pkg.engines.vscode, /^\^1\.(10[6-9]|1[1-9]\d)\./);
  assert.equal(pkg.capabilities.untrustedWorkspaces.supported, "limited");
});

test("choosing the whole project is honoured even when scopes are declared", () => {
  const m = buildWorkModel(base(v2Manifest(), { selectedScopeId: IMPLICIT_SCOPE_ID }));
  assert.equal(m.scopeSource, "implicit");
  assert.equal(m.scope.id, IMPLICIT_SCOPE_ID);
  assert.deepEqual(m.problems, []);
  // No selection yet still defaults to the first declared scope.
  assert.equal(buildWorkModel(base(v2Manifest())).scope.id, "weekly-forecast");
});
