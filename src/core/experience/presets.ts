/**
 * 0.22 modes (package B): presentation presets (`resources/experience/presets.json`, format
 * `datapass.experience` 1) and the pure resolver preset → overrides → effective surfaces.
 *
 * Presets are presentation only (D-01..D-03): switching writes no project file, and nothing here
 * decides safety. Pure (no `vscode`), so the unit tests check it without an editor.
 */
import { arr, constOf, enumOf, obj, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { PRESET_IDS, SURFACES, SURFACE_IDS, type PresetId, type Surface } from "./surfaces";

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  /** Surfaces this preset shows; every other surface is hidden. */
  show: string[];
}

export interface PresetsFile {
  format: "datapass.experience";
  version: 1;
  default: PresetId;
  presets: Preset[];
}

const LABEL: Schema = { type: "string", minLength: 1, maxLength: 40 };
const DESCRIPTION: Schema = { type: "string", minLength: 1, maxLength: 300 };

export const EXPERIENCE_SCHEMA: Schema = obj({
  $schema: { type: "string", minLength: 1, maxLength: 200 },
  format: constOf("datapass.experience"),
  version: constOf(1),
  default: enumOf(...PRESET_IDS),
  presets: arr(obj({
    id: enumOf(...PRESET_IDS),
    label: LABEL,
    description: DESCRIPTION,
    show: arr(enumOf(...SURFACE_IDS), SURFACE_IDS.length)
  }), PRESET_IDS.length, PRESET_IDS.length)
}, ["format", "version", "default", "presets"]);

export class ExperienceError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

/** Parse and check presets.json: the schema, then one preset per id and no duplicate surface. */
export function parsePresets(raw: string | Uint8Array): PresetsFile {
  const doc = parseStrictJson(raw, { maxBytes: 256 * 1024 });
  const issues = validateSchema(EXPERIENCE_SCHEMA, doc);
  if (issues.length) throw new ExperienceError("Invalid presets.json", issues);
  const f = doc as PresetsFile;
  for (const id of PRESET_IDS) if (!f.presets.some(p => p.id === id)) throw new ExperienceError(`presets.json has no "${id}" preset`);
  for (const p of f.presets) {
    const dup = p.show.find((s, i) => p.show.indexOf(s) !== i);
    if (dup) throw new ExperienceError(`Preset "${p.id}" lists "${dup}" twice`);
  }
  return f;
}

export type SurfaceOrigin = "preset" | "override";

export interface EffectiveSurface extends Surface {
  visible: boolean;
  origin: SurfaceOrigin;
}

export interface Experience {
  preset: PresetId;
  label: string;
  surfaces: EffectiveSurface[];
  /** Valid overrides that change what the preset shows (id → visible). */
  overrides: Record<string, boolean>;
  /** Problems in the settings (unknown mode or surface, wrong value), shown once to the person. */
  messages: string[];
}

const isPreset = (v: unknown): v is PresetId => typeof v === "string" && (PRESET_IDS as readonly string[]).includes(v);

/**
 * Effective surfaces: the preset's list, then each valid override. An unknown mode falls back to the
 * file's default and an unknown surface or a non-boolean value is ignored, each with a message.
 */
export function resolveExperience(file: PresetsFile, requested: unknown, overrides: unknown): Experience {
  const messages: string[] = [];
  let id: PresetId = file.default;
  if (requested !== undefined && requested !== null && requested !== "") {
    if (isPreset(requested)) id = requested;
    else messages.push(`Unknown DataPass mode "${String(requested).slice(0, 40)}" in datapass.experience.preset: using ${labelOf(file, file.default)}. Known modes: ${PRESET_IDS.join(", ")}.`);
  }
  const preset = file.presets.find(p => p.id === id)!;
  const shown = new Set(preset.show);
  const applied: Record<string, boolean> = {};
  if (overrides !== undefined && overrides !== null) {
    if (typeof overrides !== "object" || Array.isArray(overrides)) messages.push("datapass.experience.overrides must be an object of surface ids to true or false: ignored.");
    else for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
      if (!SURFACE_IDS.includes(key)) { messages.push(`Unknown surface "${key.slice(0, 60)}" in datapass.experience.overrides: ignored.`); continue; }
      if (typeof value !== "boolean") { messages.push(`datapass.experience.overrides "${key}" must be true or false: ignored.`); continue; }
      if (value !== shown.has(key)) applied[key] = value;
    }
  }
  return {
    preset: id,
    label: preset.label,
    surfaces: SURFACES.map(s => s.id in applied ? { ...s, visible: applied[s.id]!, origin: "override" as const } : { ...s, visible: shown.has(s.id), origin: "preset" as const }),
    overrides: applied,
    messages
  };
}

export function labelOf(file: PresetsFile, id: PresetId): string {
  return file.presets.find(p => p.id === id)?.label ?? id;
}

export function isVisible(x: Experience, id: string): boolean {
  return x.surfaces.find(s => s.id === id)?.visible ?? true;
}

export function hiddenSurfaces(x: Experience): string[] {
  return x.surfaces.filter(s => !s.visible).map(s => s.id);
}

/** The overrides that make `visible` the effective set for `preset` (only the differences are kept). */
export function overridesFor(file: PresetsFile, preset: PresetId, visible: ReadonlySet<string>): Record<string, boolean> {
  const shown = new Set(file.presets.find(p => p.id === preset)?.show ?? []);
  const out: Record<string, boolean> = {};
  for (const id of SURFACE_IDS) if (visible.has(id) !== shown.has(id)) out[id] = visible.has(id);
  return out;
}

/** Status-bar tooltip: the effective mode, then each override. */
export function experienceTooltip(x: Experience): string {
  const lines = [`DataPass mode: ${x.label}`];
  const changed = x.surfaces.filter(s => s.origin === "override");
  if (changed.length) {
    lines.push("", "Your changes to this mode:");
    for (const s of changed) lines.push(`${s.visible ? "+ shown" : "− hidden"}: ${s.label}`);
  }
  lines.push("", "Modes change what is shown, never your files or the safety checks.", "Click to switch mode.");
  return lines.join("\n");
}
