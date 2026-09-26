import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { safeAppUrl } from "../src/core/model/safeUrl";
import { companionLinks, resolveCompanions } from "../src/core/companions/companions";
import { validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { projectFacts } from "../src/core/workspace/facts";
import type { ProjectContext } from "../src/core/workspace/loader";
import { preflight } from "../src/core/capabilities/preflight";
import { CAPABILITIES } from "../src/core/capabilities/registry";
import type { ToolObservation } from "../src/core/capabilities/tools";

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
  // An older manifest may still carry this block: accepted and ignored.
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

test("legacy companions are ignored: no link, and only Grafana links remain", () => {
  const links = companionLinks(resolveCompanions({ manifest: manifest(), scopeId: "hydro" }));
  assert.deepEqual(links.map(l => l.id), ["grafana.home", "grafana.explore", "grafana.dashboard:ops", "grafana.dashboard:hydro_only"]);
  assert.ok(links.every(l => l.service === "grafana"));
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
    [m => { m.companions.grafana = {}; }, /not a known companion/]
  ];
  for (const [mutate, expected] of cases) {
    const m = structuredClone(manifest()) as any;
    mutate(m);
    const issues = validateProjectManifest(m);
    assert.ok(issues.some(i => expected.test(i)), `${expected}: ${issues.join(" | ")}`);
  }
  // Old manifests with legacy companion and module fields, even malformed ones, still load (ignored).
  const v1 = { schemaVersion: 1, project: { id: "p", title: "P" }, platforms: { grafana: { url: "https://g.example.com" } }, companions: { mongoku: { entityId: "p_entity" } } };
  assert.deepEqual(validateProjectManifest(v1), []);
  const legacy = { ...structuredClone(manifest()), modules: { mongoku: true, grafana: true }, companions: { mongoku: { url: "http://localhost:3100/", scopeEntities: { ghost: "x y" } } } };
  assert.deepEqual(validateProjectManifest(legacy), []);
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
    (m: any) => { m.companions = []; }
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
