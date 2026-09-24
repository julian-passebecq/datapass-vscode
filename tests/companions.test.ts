import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { safeAppUrl } from "../src/core/model/safeUrl";
import {
  ageLabel, companionLinks, mongokuBaseFrom, mongokuEntityFor, mongokuEntityUrl, parseMongokuContext, resolveCompanions, scopesForEntity,
  viewMongokuContext, MongokuContextRejected, MONGOKU_FRESH_MS
} from "../src/core/companions/companions";
import { validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { projectFacts } from "../src/core/workspace/facts";
import type { ProjectContext } from "../src/core/workspace/loader";
import { preflight } from "../src/core/capabilities/preflight";
import { CAPABILITIES } from "../src/core/capabilities/registry";
import type { ToolObservation } from "../src/core/capabilities/tools";
import { parseStrictJson } from "../src/core/model/strictJson";

const manifest = (): DataPassProjectManifest => ({
  schemaVersion: 2,
  project: { id: "retail", title: "Retail BI" },
  platforms: {
    grafana: {
      url: "https://metrics.example.com/grafana/",
      dashboards: [
        { uid: "weekly-1", title: "Weekly metrics", scopes: ["weekly"], source: "grafana/weekly.ts" },
        { uid: "ops", title: "Operations" },
        { uid: "hydro_only", title: "Hydro only", scopes: ["hydro"] }
      ]
    }
  },
  companions: { mongoku: { entityId: "retail_bi", scopeEntities: { hydro: "retail_hydro" } } },
  scopes: [{ id: "weekly", title: "Weekly reporting" }, { id: "hydro", title: "Hydro pilot" }]
});

// ---------------------------------------------------------------- safe URLs

test("safeAppUrl: https and loopback http only; no credentials, query, fragment or hidden characters", () => {
  assert.equal(safeAppUrl("https://metrics.example.com/grafana/"), "https://metrics.example.com/grafana/");
  assert.equal(safeAppUrl("http://localhost:3100"), "http://localhost:3100/");
  assert.equal(safeAppUrl("http://127.0.0.1:5173/"), "http://127.0.0.1:5173/");
  assert.equal(safeAppUrl("http://[::1]:3000/"), "http://[::1]:3000/");
  for (const bad of [
    "http://metrics.example.com/", "https://user:pass@example.com/", "https://example.com/?token=abc", "https://example.com/#t=1",
    "javascript:alert(1)", "file:///C:/Windows", "data:text/html,x", "vscode://settings", "https://exa mple.com/", " https://example.com/",
    "https://example.com\\evil", "https://example.com/%0aSet-Cookie", "https://example.com/\u202e", "ftp://example.com/", "", "x".repeat(3000)
  ]) assert.equal(safeAppUrl(bad), undefined, bad);
  assert.equal(safeAppUrl(42), undefined);
});

// ---------------------------------------------------------------- resolution

test("Grafana links keep the stack's base path and follow dashboard scopes", () => {
  const weekly = resolveCompanions({ manifest: manifest(), scopeId: "weekly" }).grafana!;
  assert.equal(weekly.host, "metrics.example.com");
  assert.deepEqual(weekly.links.map(l => [l.id, l.url]), [
    ["grafana.home", "https://metrics.example.com/grafana/"],
    ["grafana.explore", "https://metrics.example.com/grafana/explore"],
    ["grafana.dashboard:weekly-1", "https://metrics.example.com/grafana/d/weekly-1"],
    ["grafana.dashboard:ops", "https://metrics.example.com/grafana/d/ops"]
  ]);
  assert.equal(weekly.links[2]!.source, "grafana/weekly.ts");
  const whole = resolveCompanions({ manifest: manifest(), scopeId: "project" }).grafana!;
  assert.deepEqual(whole.links.map(l => l.id), ["grafana.home", "grafana.explore", "grafana.dashboard:ops"], "scoped dashboards stay in their scopes");
});

test("no Grafana section without a valid stack URL; a traversal source is dropped, not followed", () => {
  const m = manifest();
  m.platforms!.grafana!.url = "http://grafana.internal/";
  assert.equal(resolveCompanions({ manifest: m, scopeId: "weekly" }).grafana, undefined);
  const m2 = manifest();
  m2.platforms!.grafana!.dashboards![0]!.source = "../../outside.ts";
  assert.equal(resolveCompanions({ manifest: m2, scopeId: "weekly" }).grafana!.links[2]!.source, undefined);
  assert.equal(resolveCompanions({ manifest: undefined, scopeId: "project" }).grafana, undefined);
});

test("Mongoku: scope override, project fallback, and Mongoku's own ?project= deep link", () => {
  const m = manifest();
  assert.deepEqual(mongokuEntityFor(m, "hydro"), { entityId: "retail_hydro", source: "scope" });
  assert.deepEqual(mongokuEntityFor(m, "weekly"), { entityId: "retail_bi", source: "project" });
  const withUrl = resolveCompanions({ manifest: m, scopeId: "weekly", mongokuUrl: "http://localhost:3100" }).mongoku!;
  assert.equal(withUrl.needsUrl, false);
  assert.deepEqual(withUrl.links.map(l => l.url), ["http://localhost:3100/?project=retail_bi"]);
  const noUrl = resolveCompanions({ manifest: m, scopeId: "weekly" }).mongoku!;
  assert.equal(noUrl.needsUrl, true);
  assert.deepEqual(noUrl.links, []);
  const badUrl = resolveCompanions({ manifest: m, scopeId: "weekly", mongokuUrl: "http://mongoku.lan/" }).mongoku!;
  assert.equal(badUrl.needsUrl, true, "an unsafe setting is treated as unset, never opened");
  assert.equal(mongokuEntityUrl("https://ops.example.com/mongoku/", "a:b"), "https://ops.example.com/mongoku/?project=a%3Ab");
  assert.equal(mongokuEntityUrl("https://ops.example.com/", "../x"), undefined);
  assert.equal(mongokuBaseFrom("http://localhost:3100/?project=retail_bi"), "http://localhost:3100/");
  assert.equal(mongokuBaseFrom("https://user:pw@ops.example.com/"), undefined);
  assert.equal(companionLinks(resolveCompanions({ manifest: m, scopeId: "hydro", mongokuUrl: "http://localhost:3100/" })).map(l => l.id).join(","),
    "grafana.home,grafana.explore,grafana.dashboard:ops,grafana.dashboard:hydro_only,mongoku.entity");
});

test("vscode://…/open?entity= resolves only explicit, effective mappings", () => {
  const m = manifest();
  assert.deepEqual(scopesForEntity(m, "retail_hydro"), [{ id: "hydro", title: "Hydro pilot" }]);
  assert.deepEqual(scopesForEntity(m, "retail_bi"), [{ id: "project", title: "Retail BI (whole project)" }]);
  assert.deepEqual(scopesForEntity(m, "unknown_entity"), []);
  assert.deepEqual(scopesForEntity(m, "../../etc"), []);
  const overridden = manifest();
  overridden.companions!.mongoku!.scopeEntities = { project: "other_entity" };
  assert.deepEqual(scopesForEntity(overridden, "retail_bi"), [], "scopeEntities.project overrides the project-level entity");
  assert.deepEqual(scopesForEntity(overridden, "other_entity"), [{ id: "project", title: "Retail BI (whole project)" }]);
});

// ---------------------------------------------------------------- manifest validation + editor schema

test("manifest validation: companion sections are checked and scope references cannot dangle", () => {
  assert.deepEqual(validateProjectManifest(manifest()), []);
  const cases: Array<[(m: any) => void, RegExp]> = [
    [m => { m.platforms.grafana.url = "https://g.example.com/?orgId=1"; }, /platforms\.grafana\.url/],
    [m => { delete m.platforms.grafana.url; }, /dashboards needs platforms\.grafana\.url/],
    [m => { m.platforms.grafana.dashboards[1].uid = "bad uid"; }, /uid must be a Grafana dashboard UID/],
    [m => { m.platforms.grafana.dashboards[1].uid = "weekly-1"; }, /uid is duplicated/],
    [m => { m.platforms.grafana.dashboards[0].scopes = ["renamed-scope"]; }, /must name a declared scope/],
    [m => { m.platforms.grafana.dashboards[0].source = "../secrets.ts"; }, /workspace-relative path/],
    [m => { m.platforms.grafana.dashboards[0].token = "x"; }, /token is not allowed/],
    [m => { m.companions.mongoku.url = "http://localhost:3100/"; }, /user setting/],
    [m => { m.companions.mongoku.entityId = "has space"; }, /Mongoku entity id/],
    [m => { m.companions.mongoku.scopeEntities = { ghost: "x" }; }, /must name a declared scope/],
    [m => { m.companions.mongoku = {}; }, /needs entityId or scopeEntities/],
    [m => { m.companions.grafana = {}; }, /not a known companion/]
  ];
  for (const [mutate, expected] of cases) {
    const m = structuredClone(manifest()) as any;
    mutate(m);
    const issues = validateProjectManifest(m);
    assert.ok(issues.some(i => expected.test(i)), `${expected}: ${issues.join(" | ")}`);
  }
  // v1 manifests may declare a Grafana stack and a project-level Mongoku entity (no scopes).
  const v1 = { schemaVersion: 1, project: { id: "p", title: "P" }, platforms: { grafana: { url: "https://g.example.com" } }, companions: { mongoku: { entityId: "p_entity" } } };
  assert.deepEqual(validateProjectManifest(v1), []);
});

test("the editor JSON schema agrees with the runtime on the companion sections", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validate = ajv.compile(JSON.parse(readFileSync("schemas/datapass-project.schema.json", "utf8")));
  assert.ok(validate(manifest()), JSON.stringify(validate.errors));
  for (const mutate of [
    (m: any) => { m.platforms.grafana.url = "https://g.example.com/?orgId=1"; },
    (m: any) => { m.platforms.grafana.url = "http://grafana.internal/"; },
    (m: any) => { m.platforms.grafana.dashboards[1].uid = "bad uid"; },
    (m: any) => { m.platforms.grafana.dashboards[0].token = "x"; },
    (m: any) => { m.companions.mongoku.url = "http://localhost:3100/"; },
    (m: any) => { m.companions.mongoku = {}; },
    (m: any) => { m.companions.other = {}; }
  ]) {
    const m = structuredClone(manifest()) as any;
    mutate(m);
    assert.equal(validate(m), false, JSON.stringify(m.platforms.grafana) + JSON.stringify(m.companions));
    assert.ok(validateProjectManifest(m).length > 0, "runtime must reject what the schema rejects");
  }
});

test("a declared Grafana stack is the fact the datasource/alert operation was waiting for", () => {
  const cap = CAPABILITIES.find(c => c.facts?.some(f => f.fact === "grafana.instance"))!;
  const tools = new Map<string, ToolObservation>([["cli.gcx", { toolId: "cli.gcx", state: "present", observedAt: "2026-09-25T00:00:00Z" }]]);
  const ctx = (m: DataPassProjectManifest): ProjectContext => ({ manifest: m, manifestExists: true, manifestErrors: [], packs: [], packErrors: [] });
  const without = manifest();
  delete without.platforms!.grafana!.url;
  delete without.platforms!.grafana!.dashboards;
  const before = preflight(cap, { tools, facts: projectFacts(ctx(without)), reviewsConfirmed: new Set() });
  assert.equal(before.status, "blocked");
  assert.match(before.nextStep, /Declare platforms\.grafana\.url in the project manifest/, "names a field a person can edit, not an internal fact id");
  const facts = projectFacts(ctx(manifest()));
  assert.equal(facts.get("grafana.instance"), "metrics.example.com", "host only, never the full URL");
  assert.equal(preflight(cap, { tools, facts, reviewsConfirmed: new Set() }).status, "ready");
});

// ---------------------------------------------------------------- Mongoku context (the producer's real format)

const fixture = () => parseStrictJson(readFileSync("tests/fixtures/mongoku/portfolio-context.synthetic.json"));
const NOW = Date.parse("2026-09-25T10:00:00Z");

test("Mongoku context: the real producer's output is accepted and bound to the mapped entity", () => {
  const ctx = parseMongokuContext(fixture(), "retail_bi", NOW);
  assert.equal(ctx.entityId, "retail_bi");
  assert.equal(ctx.project.name, "Retail BI (synthetic)");
  assert.equal(ctx.project.next_action, "Review the weekly report against last week's numbers.");
  assert.equal(ctx.items.length, 5);
  assert.deepEqual(ctx.ignoredFields, []);
  assert.deepEqual(viewMongokuContext(ctx, NOW), { age: "fresh", sourceFreshness: "CURRENT_FOR_DECLARED_SCOPE", work: 2, testGates: 2 });
  assert.equal(viewMongokuContext(ctx, Date.parse(ctx.generatedAt) + MONGOKU_FRESH_MS + 1).age, "old");
  assert.equal(ageLabel(ctx.generatedAt, NOW), "30 min ago");
});

test("Mongoku context: wrong entity, format, version, times and hostile content are refused", () => {
  const reject = (mutate: (d: any) => void, expected: RegExp, entity = "retail_bi") => {
    const d = structuredClone(fixture()) as any;
    mutate(d);
    assert.throws(() => parseMongokuContext(d, entity, NOW), (e: unknown) => e instanceof MongokuContextRejected && expected.test(e.message), String(expected));
  };
  reject(() => {}, /maps to "retail_hydro"/, "retail_hydro");
  reject(d => { d.format = "datapass.mongoku-summary"; }, /Expected format/);
  reject(d => { d.schema_version = "0.2"; }, /Unsupported Mongoku context version/);
  reject(d => { d.generated_at = "2026-09-26T10:00:00.000Z"; }, /future/);
  reject(d => { d.generated_at = "yesterday"; }, /UTC timestamp/);
  reject(d => { d.scope.project_id = "retail bi"; }, /not a Mongoku entity id/);
  reject(d => { d.items = Array.from({ length: 51 }, () => d.items[0]); }, /more than 50/);
  reject(d => { d.items[0].kind = "SCRIPT"; }, /items\[0\]\.kind/);
  reject(d => { d.project.next_action = "ok\u202eevil"; }, /bidirectional/);
  reject(d => { d.project.stop_point = "x".repeat(2001); }, /at most 2000/);
  reject(d => { d.sources[0].freshness = "FRESH"; }, /freshness/);
  reject(d => { d.project = []; }, /project must be an object/);
  // Unknown fields are reported and ignored, never interpreted.
  const extra = structuredClone(fixture()) as any;
  extra.run_command = "rm -rf /";
  extra.project.token = "not shown";
  assert.deepEqual(parseMongokuContext(extra, "retail_bi", NOW).ignoredFields, ["run_command", "project.token"]);
});
