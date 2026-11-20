import assert from "node:assert/strict";
import test from "node:test";
import { MODULES, MODULE_IDS, disabledProviders, moduleEnabled, modulesBlock, validateModules, type ModuleId } from "../src/core/modules";
import { PROJECT_TYPES, PROJECT_TYPE_PRESETS, buildModulesManifest, diffFromPreset, diffModules, enabledModules, keepsCurrentModules, presetModules, startingModules, typeEffect } from "../src/core/projectTypes";
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
  const perso = new Set<ModuleId>(["databases", "infrastructure", "diagramcloud"]);
  assert.deepEqual(diffFromPreset("perso", perso), { addOns: ["diagramcloud"], removed: [] });
  assert.deepEqual(diffFromPreset("perso", new Set<ModuleId>(["databases", "powerbi", "diagramcloud"])), { addOns: ["powerbi", "diagramcloud"], removed: ["infrastructure"] });
  // The result with an add-on on top is the ordinary modules block: the add-on's provider stays on, an off module's goes.
  const withAddOn = manifestFor("perso", [...perso]);
  assert.equal(moduleEnabled(withAddOn, "diagramcloud"), true);
  assert.equal(disabledProviders(withAddOn).has("diagram"), false);
  assert.equal(disabledProviders(manifestFor("perso", presetModules("perso"))).has("diagram"), true);
  assert.equal(new Set(PROJECT_TYPES.map(t => presetModules(t).join())).size, PROJECT_TYPES.length, "no two types are the same list");
});

test("project types: the work preset is every cloud-core module (a core module added later joins it)", () => {
  assert.deepEqual(presetModules("work"), MODULES.filter(m => m.group === "core").map(m => m.id));
});

const raw = () => ({
  schemaVersion: 2,
  project: { id: "p", title: "P", type: "dev" },
  modules: { fabric: false, databases: true, diagramcloud: true, workOrders: true, pilot: false, mongoku: false },
  platforms: { fabric: { workspaceName: "W" } }
}) as Record<string, unknown>;

test("project types: the written manifest has project.type, the modules block, and keeps workOrders, pilot and everything else", () => {
  const before = raw();
  const next = buildModulesManifest(before, new Set<ModuleId>(presetModules("perso")), "perso");
  assert.deepEqual(before, raw(), "the input is not changed");
  assert.equal((next.project as Record<string, unknown>).type, "perso");
  assert.deepEqual((next.project as Record<string, unknown>).id, "p");
  assert.deepEqual(Object.keys(next), ["schemaVersion", "project", "modules", "platforms"], "modules sits right after project");
  assert.deepEqual(next.platforms, before.platforms);
  const block = next.modules as Record<string, unknown>;
  assert.equal(block.workOrders, true, "workOrders kept");
  assert.equal(block.pilot, false, "pilot kept");
  assert.ok(!("mongoku" in block), "the legacy switch is not carried");
  assert.deepEqual(MODULE_IDS.filter(id => block[id] === true), presetModules("perso"));
  assert.deepEqual(validateProjectManifest(next), []);
  // Without a type (Choose Project Modules) project is untouched.
  const plain = buildModulesManifest(before, new Set<ModuleId>(["fabric"]));
  assert.equal((plain.project as Record<string, unknown>).type, "dev");
  assert.equal((plain.modules as Record<string, unknown>).workOrders, true);
  // A manifest without a modules block gets one after project.
  const none = buildModulesManifest({ schemaVersion: 2, project: { id: "p", title: "P" } }, new Set<ModuleId>(["databases"]), "dev");
  assert.deepEqual(Object.keys(none), ["schemaVersion", "project", "modules"]);
  assert.equal((none.project as Record<string, unknown>).type, "dev");
});

test("project types: running the command again with the same type keeps the file's own toggles", () => {
  const m = raw() as unknown as DataPassProjectManifest;
  // dev file with DiagramCloud on and Fabric off, and a core module (azure) left unlisted = on.
  assert.equal(keepsCurrentModules(m, "dev"), true);
  const start = startingModules(m, "dev");
  assert.ok(start.includes("diagramcloud"), "the add-on stays ticked");
  assert.ok(!start.includes("fabric"), "a module switched off stays off");
  assert.deepEqual(new Set(start), enabledModules(m));
  // Writing that start back changes nothing in the module list.
  const next = buildModulesManifest(raw(), new Set(start), "dev") as unknown as DataPassProjectManifest;
  assert.deepEqual(enabledList(next), start);
  assert.deepEqual(diffModules(enabledModules(m), new Set(start)), { switchedOn: [], switchedOff: [] });
  // A newly chosen type starts from its preset, and so does a file with no type or no modules block.
  assert.equal(keepsCurrentModules(m, "work"), false);
  assert.deepEqual(startingModules(m, "work"), presetModules("work"));
  assert.deepEqual(startingModules({ project: { type: "dev" } }, "dev"), presetModules("dev"));
  assert.deepEqual(startingModules({ project: {}, modules: { databases: true } }, "dev"), presetModules("dev"));
  // The diff against the file shows what switching type does to it.
  const toPerso = diffModules(enabledModules(m), new Set(presetModules("perso")));
  assert.deepEqual(toPerso.switchedOn, [], "infrastructure is unlisted in the file, so already on");
  assert.deepEqual(toPerso.switchedOff, ["databricks", "azure", "airflow", "powerbi", "grafana", "diagramcloud"]);
});

test("project types: the confirm text names the work-order effect of project.type", () => {
  assert.match(typeEffect("dev", "work"), /work-order defaults \(the file says work\).*work orders on, the agent merges its PRs when CI is green/);
  assert.match(typeEffect("work", undefined), /the file has no type, which counts as dev.*work orders off.*you merge/);
  assert.match(typeEffect("perso", "dev"), /datapass\.ai\.projectTypes still wins/);
});
