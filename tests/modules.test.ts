import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { ALWAYS_ON_PROVIDERS, MODULES, MODULE_IDS, disabledProviders, galaxyCardEnabled, moduleEnabled, modulesBlock, validateModules } from "../src/core/modules";
import { foilProjectManifest, genericProjectManifest, validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { buildWorkModel, IMPLICIT_SCOPE_ID } from "../src/core/work/workModel";
import { resolveCompanions, scopesForEntity } from "../src/core/companions/companions";
import { CAPABILITIES } from "../src/core/capabilities/registry";

const manifest = (modules?: DataPassProjectManifest["modules"]): DataPassProjectManifest => ({
  schemaVersion: 2,
  project: { id: "lab", title: "Lab" },
  ...(modules ? { modules } : {}),
  platforms: { fabric: { workspaceName: "Lab" }, databricks: { bundleRoot: "." }, powerbi: { projectRoot: "bi" }, grafana: { url: "https://g.example.com/" }, infrastructure: { root: "infra" } },
  companions: { mongoku: { entityId: "lab_entity" } },
  scopes: [{ id: "weekly", title: "Weekly", capabilityRefs: ["fabric.workspace.browse", "powerbi.report.edit-pbir"] }]
});
const model = (m: DataPassProjectManifest, scope?: string) => buildWorkModel({
  manifest: m, packs: [], tools: new Map(), facts: new Map(), reviewsConfirmed: new Set(), checklist: {}, appObservations: {}, exchanges: [], selectedScopeId: scope
});

test("modules: unlisted means on, only false switches off, no block keeps today's behaviour", () => {
  assert.equal(moduleEnabled(undefined, "powerbi"), true);
  assert.equal(moduleEnabled(manifest(), "powerbi"), true);
  assert.equal(moduleEnabled(manifest({ fabric: true }), "powerbi"), true);
  assert.equal(moduleEnabled(manifest({ powerbi: false }), "powerbi"), false);
  assert.equal(galaxyCardEnabled(manifest({ grafana: false }), "observability"), false, "the Observability card is the grafana module");
  assert.equal(galaxyCardEnabled(manifest({ grafana: false }), "fabric"), true);
  assert.deepEqual([...disabledProviders(manifest({ mongoku: false, diagramcloud: false }))].sort(), ["diagram", "mongo"]);
  assert.deepEqual(Object.keys(modulesBlock(new Set(["fabric"]))), [...MODULE_IDS]);
  // Every capability provider except the always-on core (apps, Python, opening files) belongs to exactly one module.
  for (const cap of CAPABILITIES) {
    if (ALWAYS_ON_PROVIDERS.has(cap.provider)) { assert.equal(MODULES.filter(m => m.providers.includes(cap.provider)).length, 0, cap.id); continue; }
    assert.equal(MODULES.filter(m => m.providers.includes(cap.provider)).length, 1, cap.id);
  }
});

test("modules: Mongoku is frozen — off in the manifests DataPass creates, unchanged in existing ones", () => {
  assert.equal(moduleEnabled(genericProjectManifest("x"), "mongoku"), false);
  assert.equal(moduleEnabled(foilProjectManifest(), "mongoku"), false);
  assert.deepEqual(validateProjectManifest(genericProjectManifest("x")), []);
  assert.equal(moduleEnabled(manifest(), "mongoku"), true, "a manifest without a modules block keeps it");
  assert.match(MODULES.find(m => m.id === "mongoku")!.note ?? "", /frozen.*GitHub/);
  assert.ok(ALWAYS_ON_PROVIDERS.has("devops"), "a project's Git host and CI are core, never a switchable module");
});

test("modules: validation and editor schema agree", () => {
  assert.deepEqual(validateModules({ fabric: true, powerbi: false }), []);
  assert.match(validateModules({ kafka: true })[0]!, /not a known module/);
  assert.match(validateModules({ fabric: "yes" })[0]!, /true or false/);
  assert.match(validateModules([])[0]!, /must be an object/);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validate = ajv.compile(JSON.parse(readFileSync("schemas/datapass-project.schema.json", "utf8")));
  assert.ok(validate(manifest({ powerbi: false, mongoku: false })), JSON.stringify(validate.errors));
  for (const bad of [{ kafka: true }, { fabric: "yes" }]) {
    const m = manifest() as any;
    m.modules = bad;
    assert.equal(validate(m), false);
    assert.ok(validateProjectManifest(m).length > 0);
  }
  const v1 = { schemaVersion: 1, project: { id: "p", title: "P" }, modules: { powerbi: false } };
  assert.deepEqual(validateProjectManifest(v1), [], "modules work for v1 manifests too");
});

test("modules: a switched-off module leaves the Work view, and a scope that uses it says so", () => {
  const whole = model(manifest({ powerbi: false, grafana: false }), IMPLICIT_SCOPE_ID);
  const providers = new Set(whole.operations.map(o => o.capability.provider));
  assert.ok(providers.has("fabric") && providers.has("databricks") && providers.has("infrastructure"));
  assert.ok(!providers.has("powerbi") && !providers.has("grafana"));
  const scoped = model(manifest({ powerbi: false }), "weekly");
  assert.deepEqual(scoped.operations.map(o => o.capability.id), ["fabric.workspace.browse"]);
  assert.ok(scoped.problems.some(p => /powerbi\.report\.edit-pbir.*Power BI module is switched off/.test(p)), scoped.problems.join(" | "));
  assert.deepEqual(model(manifest(), "weekly").problems, [], "without a modules block nothing changes");
});

test("modules: switched-off add-ons produce no links and cannot be selected from a Mongoku link", () => {
  const on = resolveCompanions({ manifest: manifest(), scopeId: "weekly", mongokuUrl: "http://localhost:3100/" });
  assert.ok(on.grafana && on.mongoku);
  const off = resolveCompanions({ manifest: manifest({ grafana: false, mongoku: false }), scopeId: "weekly", mongokuUrl: "http://localhost:3100/" });
  assert.equal(off.grafana, undefined);
  assert.equal(off.mongoku, undefined);
  assert.deepEqual(scopesForEntity(manifest({ mongoku: false }), "lab_entity"), []);
});
