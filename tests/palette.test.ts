/**
 * V1-SURF: the Command Palette per mode. package.json `menus.commandPalette` matches the tier
 * table of src/core/experience/palette.ts, every listable command is classified, the lighter modes
 * stay under ~60 entries with one prefix, client-named commands stay off the default surface, and
 * the list per mode matches the committed snapshot (update it on purpose with
 * `PALETTE_SNAPSHOT=update npx tsx --test tests/palette.test.ts`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { paletteWhen, PALETTE_TIERS } from "../src/core/experience/palette";
import { parsePresets, resolveExperience } from "../src/core/experience/presets";
import { DEFAULT_PRESET, PRESET_IDS, SURFACE_IDS } from "../src/core/experience/surfaces";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const presets = parsePresets(readFileSync("resources/experience/presets.json", "utf8"));
const SNAPSHOT = "tests/fixtures/palette-snapshot.json";
const commands = pkg.contributes.commands as Array<{ command: string; title: string }>;
const palette = pkg.contributes.menus.commandPalette as Array<{ command: string; when: string }>;
const title = (id: string) => commands.find(c => c.command === id)!.title;

/** Evaluate a palette `when` of the forms this repository uses: "false", or `!datapass.hidden.<surface>`. */
function listed(command: string, shown: ReadonlySet<string>): boolean {
  const e = palette.find(x => x.command === command);
  if (!e) return true;
  if (e.when === "false") return false;
  const m = /^!datapass\.hidden\.([\w.]+)$/.exec(e.when);
  assert.ok(m, `${command}: unexpected palette when "${e.when}"`);
  return shown.has(m[1]!);
}

const shownIn = (preset: string) => new Set(resolveExperience(presets, preset, undefined).surfaces.filter(s => s.visible).map(s => s.id));
const paletteOf = (preset: string) => commands.map(c => c.command).filter(c => listed(c, shownIn(preset))).map(title).sort();

test("palette: every listable command is classified, and package.json carries exactly the table's when clauses", () => {
  const hidden = new Set(palette.filter(e => e.when === "false").map(e => e.command));
  for (const c of commands) {
    if (hidden.has(c.command)) { assert.ok(!PALETTE_TIERS.has(c.command), `${c.command} is never in the palette`); continue; }
    assert.ok(PALETTE_TIERS.has(c.command), `${c.command}: classify it in src/core/experience/palette.ts (core or a surface)`);
    assert.equal(palette.find(e => e.command === c.command)?.when, paletteWhen(c.command), c.command);
  }
  for (const [c, s] of PALETTE_TIERS) {
    assert.ok(commands.some(x => x.command === c), `${c} is a contributed command`);
    if (s) assert.ok(SURFACE_IDS.includes(s), `${c}: ${s} is a surface id`);
  }
  assert.equal(new Set(palette.map(e => e.command)).size, palette.length, "one palette entry per command");
});

test("palette: lighter modes stay short, grow towards Advanced, and Advanced lists every command", () => {
  const counts = PRESET_IDS.map(p => paletteOf(p).length);
  for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i]! >= counts[i - 1]!, `${PRESET_IDS[i]} lists at least as many as ${PRESET_IDS[i - 1]}`);
  // V1.1.x-POLISH-4: 63 → 66 for Home, Appearance and "Show DataPass in the Activity Bar", listed in every mode
  // (the last one is how the DataPass side bar comes back when its icon is gone).
  // V5HOLE2: 66 → 67 for "Pick a View Here…", listed wherever the Navigator is shown (V5 acceptance row 05).
  for (const p of PRESET_IDS.filter(x => x !== "advanced")) assert.ok(paletteOf(p).length <= 67, `${p}: ${paletteOf(p).length} entries`);
  assert.ok(paletteOf(DEFAULT_PRESET).length <= 60);
  assert.equal(paletteOf("advanced").length, PALETTE_TIERS.size);
  for (const p of PRESET_IDS) for (const t of paletteOf(p)) assert.match(t, /^DataPass: \S/, `${p}: consistent prefix`);
  // Customize can list everything in any mode.
  const all = new Set(resolveExperience(presets, "vanilla", { "palette.full": true }).surfaces.filter(s => s.visible).map(s => s.id));
  assert.ok(all.has("palette.full"));
});

test("palette: no client-named command or setting on the default surface", () => {
  for (const p of PRESET_IDS.filter(x => x !== "advanced")) for (const t of paletteOf(p)) assert.doesNotMatch(t, /foil/i, `${p}: ${t}`);
  // V1-FOILSURF (journey R04): no setting is client-named, even in advanced mode.
  for (const k of Object.keys(pkg.contributes.configuration.properties)) assert.doesNotMatch(k, /foil/i, k);
});

test("palette: the list per mode matches the committed snapshot", () => {
  const now = Object.fromEntries(PRESET_IDS.map(p => [p, paletteOf(p)]));
  if (process.env.PALETTE_SNAPSHOT === "update") writeFileSync(SNAPSHOT, JSON.stringify(now, null, 2) + "\n");
  assert.deepEqual(now, JSON.parse(readFileSync(SNAPSHOT, "utf8")), "palette changed: review it, then PALETTE_SNAPSHOT=update");
});

test("palette: Pick a View Here is offered wherever the Navigator is shown, not only in Advanced (V5HOLE2)", () => {
  // V5E2E1 hole 2: gated on palette.full, it vanished once .datapass/project.json activated DataPass
  // (the default mode sets datapass.hidden.palette.full). The Navigator's own key decides it now.
  assert.equal(palette.find(e => e.command === "datapass.nav.pickView")?.when, "!datapass.hidden.view.navigator");
  assert.equal(PALETTE_TIERS.get("datapass.nav.pickView"), "view.navigator");
  for (const p of PRESET_IDS) {
    assert.ok(shownIn(p).has("view.navigator"), `${p} shows the Navigator`);
    assert.ok(!shownIn(p).has("palette.full") || p === "advanced", `${p}: palette.full is Advanced-only`);
    assert.ok(paletteOf(p).includes("DataPass: Pick a View Here…"), `${p}: Pick a View Here is listed`);
  }
  // Hiding the Navigator (Customize) hides its palette entry with it.
  const noNav = new Set(resolveExperience(presets, DEFAULT_PRESET, { "view.navigator": false }).surfaces.filter(s => s.visible).map(s => s.id));
  assert.ok(!listed("datapass.nav.pickView", noNav));
});
