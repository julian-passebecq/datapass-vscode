/**
 * 0.22 modes (package B): the shipped presets validate against their schema, the resolver
 * (preset → overrides → effective surfaces, with origins and messages), and the package.json
 * contract — every contributed view has a surface id and a `when` clause, so a future view cannot
 * escape the modes, and menus that open a hidden surface are hidden with it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { emittedSchemaFiles } from "../src/core/contracts/schemaFiles";
import { experienceTooltip, hiddenSurfaces, isVisible, overridesFor, parsePresets, resolveExperience, ExperienceError } from "../src/core/experience/presets";
import { DEFAULT_PRESET, hiddenKey, PRESET_IDS, SURFACES, SURFACE_IDS } from "../src/core/experience/surfaces";
import { alternativesByComponent } from "../src/core/experience/alternatives";
import { optionsA } from "./fixtures/v3/researchOptions";

const RAW = readFileSync("resources/experience/presets.json", "utf8");
const presets = () => parsePresets(RAW);
const json = () => JSON.parse(RAW) as any;
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("experience: presets.json validates against its schema, and the committed schema is current", () => {
  const f = presets();
  assert.equal(f.default, DEFAULT_PRESET);
  assert.deepEqual(f.presets.map(p => p.id), [...PRESET_IDS]);
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(emittedSchemaFiles()["schemas/datapass-experience.schema.json"] as object);
  assert.ok(validate(json()), JSON.stringify(validate.errors));
  assert.deepEqual(JSON.parse(readFileSync("schemas/datapass-experience.schema.json", "utf8")), emittedSchemaFiles()["schemas/datapass-experience.schema.json"], "committed schema is up to date (npm run schemas)");
});

test("experience: unknown surface or preset ids, a missing preset and duplicates are rejected with a message", () => {
  const cases: Array<[(x: any) => void, RegExp]> = [
    [x => { x.presets[0].show.push("view.nope"); }, /presets\[0\]\.show\[\d+\] must be one of/],
    [x => { x.presets[1].id = "expert"; }, /presets\[1\]\.id must be one of/],
    [x => { x.default = "expert"; }, /\$\.default must be one of/],
    [x => { x.presets.pop(); }, /at least 4 items/],
    [x => { x.presets[3].id = "vanilla"; }, /no "advanced" preset/],
    [x => { x.presets[0].show.push("view.git"); }, /lists "view.git" twice/],
    [x => { x.format = "datapass.options"; }, /format must equal/],
    [x => { x.extra = true; }, /not an allowed property/]
  ];
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(emittedSchemaFiles()["schemas/datapass-experience.schema.json"] as object);
  for (const [mutate, message] of cases) {
    const x = json();
    mutate(x);
    assert.throws(() => parsePresets(JSON.stringify(x)), (e: unknown) => e instanceof ExperienceError && message.test(e.message), String(message));
    if (!/twice|no "advanced"/.test(String(message))) assert.equal(validate(x), false, `editor schema refuses too: ${message}`);
  }
});

test("experience: presets grow from Vanilla to Advanced, as the plan's table says", () => {
  const f = presets();
  const shown = (id: string) => new Set(f.presets.find(p => p.id === id)!.show);
  for (let i = 1; i < PRESET_IDS.length; i += 1) {
    const lighter = shown(PRESET_IDS[i - 1]!), heavier = shown(PRESET_IDS[i]!);
    for (const s of lighter) assert.ok(heavier.has(s), `${PRESET_IDS[i]} keeps ${s} from ${PRESET_IDS[i - 1]}`);
  }
  // Vanilla: Git view and the AI view with the guided tab only.
  assert.deepEqual([...shown("vanilla")].filter(s => s.startsWith("view.")).sort(), ["view.aiExchange", "view.git"]);
  assert.ok(!shown("vanilla").has("ai.agent") && !shown("vanilla").has("ai.manual"));
  // Standard adds the architecture and Details, lands on the architecture and marks alternatives instead of the Options section.
  for (const s of ["view.architecture", "view.details", "landing.architecture", "badge.alternatives"]) assert.ok(shown("standard").has(s), s);
  assert.ok(!shown("standard").has("project.options") && !shown("standard").has("view.project"));
  // DataPass: the board stays optional (off); work orders only from DataPass up (still opt-in elsewhere).
  assert.ok(!shown("datapass").has("project.board") && !shown("datapass").has("workbench.board"));
  assert.ok(shown("datapass").has("ai.agent") && shown("datapass").has("workbench.workOrders"));
  // Advanced shows everything.
  assert.deepEqual([...shown("advanced")].sort(), [...SURFACE_IDS].sort());
});

test("experience: resolution order preset → overrides, with each surface's origin", () => {
  const f = presets();
  const std = resolveExperience(f, undefined, undefined);
  assert.equal(std.preset, "standard");
  assert.deepEqual(std.messages, []);
  assert.ok(std.surfaces.every(s => s.origin === "preset"));
  const x = resolveExperience(f, "vanilla", { "view.architecture": true, "view.git": false, "view.aiExchange": true });
  assert.equal(x.preset, "vanilla");
  assert.equal(isVisible(x, "view.architecture"), true);
  assert.equal(isVisible(x, "view.git"), false);
  // An override equal to the preset changes nothing and is not reported as a change.
  assert.deepEqual(x.overrides, { "view.architecture": true, "view.git": false });
  assert.equal(x.surfaces.find(s => s.id === "view.architecture")!.origin, "override");
  assert.equal(x.surfaces.find(s => s.id === "view.aiExchange")!.origin, "preset");
  assert.ok(hiddenSurfaces(x).includes("view.project"));
  const tip = experienceTooltip(x);
  assert.match(tip, /DataPass mode: Vanilla/);
  assert.match(tip, /\+ shown: Architecture panel/);
  assert.match(tip, /− hidden: Git view/);
});

test("experience: an unknown mode or surface in the settings is ignored with a message", () => {
  const f = presets();
  const x = resolveExperience(f, "expert", { "view.nope": true, "view.git": "yes" });
  assert.equal(x.preset, "standard");
  assert.equal(x.messages.length, 3);
  assert.match(x.messages[0]!, /Unknown DataPass mode "expert".*using Standard/);
  assert.match(x.messages[1]!, /Unknown surface "view\.nope"/);
  assert.match(x.messages[2]!, /"view\.git" must be true or false/);
  assert.equal(isVisible(x, "view.git"), true);
  assert.match(resolveExperience(f, "advanced", ["view.git"]).messages[0]!, /must be an object/);
});

test("experience: customizing keeps only the differences from the preset", () => {
  const f = presets();
  const visible = new Set(f.presets.find(p => p.id === "standard")!.show);
  visible.delete("landing.architecture");
  visible.add("project.board");
  const o = overridesFor(f, "standard", visible);
  assert.deepEqual(o, { "project.board": true, "landing.architecture": false });
  const x = resolveExperience(f, "standard", o);
  assert.deepEqual(new Set(x.surfaces.filter(s => s.visible).map(s => s.id)), visible);
  // Switching mode keeps the changes that still differ from the new preset.
  assert.deepEqual(resolveExperience(f, "advanced", o).overrides, { "landing.architecture": false });
});

test("experience: every contributed view has a surface id and is gated by its when clause", () => {
  const views = (Object.values(pkg.contributes.views) as Array<Array<{ id: string; when?: string }>>).flat();
  const surfaceViews = SURFACES.filter(s => s.kind === "view");
  assert.deepEqual(views.map(v => v.id).sort(), surfaceViews.map(s => s.viewId).sort(), "the view list and the surface list agree");
  for (const v of views) {
    const s = surfaceViews.find(x => x.viewId === v.id)!;
    assert.equal(v.when, `!${hiddenKey(s.id)}`, `${v.id} is shown unless its mode hides it (visible before activation)`);
  }
  assert.equal(new Set(SURFACE_IDS).size, SURFACE_IDS.length, "surface ids are unique");
});

test("experience: settings follow the surface and preset lists; menus of hidden surfaces are hidden too", () => {
  const props = pkg.contributes.configuration.properties;
  assert.deepEqual(props["datapass.experience.preset"].enum, [...PRESET_IDS]);
  assert.equal(props["datapass.experience.preset"].default, DEFAULT_PRESET);
  assert.equal(props["datapass.experience.preset"].scope, "machine", "a repository's settings cannot choose the mode");
  assert.deepEqual(Object.keys(props["datapass.experience.overrides"].properties).sort(), [...SURFACE_IDS].sort());
  assert.equal(props["datapass.experience.overrides"].scope, "machine");
  const menus = [...pkg.contributes.menus["view/title"], ...pkg.contributes.menus["view/item/context"]] as Array<{ command: string; when: string }>;
  for (const m of menus.filter(x => x.command.startsWith("datapass.workOrders."))) assert.match(m.when, /!datapass\.hidden\.ai\.agent/, m.command);
  for (const m of menus.filter(x => x.command === "datapass.openBoard")) assert.match(m.when, /!datapass\.hidden\.workbench\.board/);
  // D-03: commands stay in the palette — the modes never add a commandPalette `when` on a surface key.
  for (const m of pkg.contributes.menus.commandPalette as Array<{ when?: string }>) assert.ok(!(m.when ?? "").includes("datapass.hidden."));
  for (const id of ["datapass.experience.switchMode", "datapass.experience.customize", "datapass.experience.resetOverrides"]) {
    assert.ok(pkg.contributes.commands.some((c: { command: string }) => c.command === id), id);
  }
});

test("experience: components an options.json decision can change are marked as having alternatives", () => {
  const o = optionsA();
  const alt = alternativesByComponent(o);
  assert.ok(alt.size > 0);
  for (const d of o.decisions) for (const id of d.concerns ?? []) assert.ok(alt.get(id)!.includes(d.title), `${id} ← ${d.title}`);
  assert.equal(alternativesByComponent(undefined).size, 0);
});
