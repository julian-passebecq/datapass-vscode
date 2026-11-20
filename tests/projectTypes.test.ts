import assert from "node:assert/strict";
import test from "node:test";
import { MODULES, MODULE_IDS, disabledProviders, moduleEnabled, modulesBlock, validateModules, type ModuleId } from "../src/core/modules";
import { PROJECT_TYPES, PROJECT_TYPE_PRESETS, diffFromPreset, modulesForType, presetModules } from "../src/core/projectTypes";
import { validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";

const manifestFor = (type: "dev" | "work" | "perso", enabled: readonly ModuleId[]): DataPassProjectManifest => ({
  schemaVersion: 2,
  project: { id: "p", title: "P", type },
  modules: modulesBlock(new Set(enabled))
});
const enabledList = (m: DataPassProjectManifest) => MODULE_IDS.filter(id => moduleEnabled(m, id));

test("project types: dev, work and personal exist", () => {
  assert.deepEqual([...PROJECT_TYPES].sort(), ["dev", "perso", "work"]);
  for (const t of PROJECT_TYPES) assert.equal(PROJECT_TYPE_PRESETS[t].type, t);
});

const EXPECTED: Record<"dev" | "work" | "perso", ModuleId[]> = {
  dev: ["azure", "databases", "infrastructure", "airflow", "grafana"],
  work: ["fabric", "databricks", "azure", "databases", "infrastructure", "airflow", "powerbi", "grafana"],
  perso: ["databases", "infrastructure"]
};

test("project types: setting a type gives exactly this module list", () => {
  for (const t of PROJECT_TYPES) {
    assert.deepEqual(presetModules(t), EXPECTED[t], t);
    assert.deepEqual(enabledList(manifestFor(t, presetModules(t))), EXPECTED[t], `${t}: the manifest block enables exactly these`);
  }
});

test("project types: no preset switches the add-on on, and each preset is a valid manifest", () => {
  const addOns = MODULES.filter(m => m.group === "add-on").map(m => m.id);
  assert.ok(addOns.length > 0);
  for (const t of PROJECT_TYPES) {
    for (const a of addOns) assert.ok(!presetModules(t).includes(a), `${t}: ${a} is off in the preset`);
    const m = manifestFor(t, presetModules(t));
    assert.deepEqual(validateProjectManifest(m), []);
    assert.deepEqual(validateModules(m.modules), []);
  }
});

test("project types: add-ons toggle on top of the preset, and the types differ", () => {
  assert.deepEqual(modulesForType("perso", ["diagramcloud"]), ["databases", "infrastructure", "diagramcloud"]);
  assert.deepEqual(modulesForType("perso", ["databases", "powerbi"]), ["databases", "infrastructure", "powerbi"]);
  assert.deepEqual(modulesForType("work"), presetModules("work"));
  assert.deepEqual(diffFromPreset("perso", new Set<ModuleId>(["databases", "powerbi", "diagramcloud"])), { addOns: ["powerbi", "diagramcloud"], removed: ["infrastructure"] });
  // The result with an add-on on top is the ordinary modules block: the add-on's provider stays on, an off module's goes.
  const withAddOn = manifestFor("perso", modulesForType("perso", ["diagramcloud"]));
  assert.equal(moduleEnabled(withAddOn, "diagramcloud"), true);
  assert.equal(disabledProviders(withAddOn).has("diagram"), false);
  assert.equal(disabledProviders(manifestFor("perso", presetModules("perso"))).has("diagram"), true);
  assert.equal(new Set(PROJECT_TYPES.map(t => presetModules(t).join())).size, PROJECT_TYPES.length, "no two types are the same list");
});
