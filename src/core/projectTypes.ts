/**
 * Project types as presets of the module toggles (R852, feat-datapass-core-002). Pure.
 *
 * A type is only a starting list of `modules` (src/core/modules.ts); picking one writes that list
 * to `.datapass/project.json` and the existing toggles do the rest. Add-ons are switched on (or
 * any module off) on top of the preset: the saved `modules` block is the preset plus the person's
 * changes, so after saving there is nothing special about it. The type name is `project.type`,
 * the same field the work-order defaults read (core/workOrders/projectType.ts), so "personal" is
 * spelled `perso` in the file.
 *
 *   dev   — own development projects: Azure data services, databases, infrastructure, Airflow, Grafana.
 *   work  — client and FOIL data projects: every cloud-core module.
 *   perso — small personal projects: databases and infrastructure.
 *
 * The add-on group (DiagramCloud) is off in every preset: a person adds it on top. The work preset
 * is "every module of the core group", so a core module added to MODULES later joins it on purpose;
 * dev and perso are fixed lists and do not grow by themselves.
 *
 * `project.type` is not only a label: it also sets the work-order and merge defaults
 * (TYPE_DEFAULTS in core/workOrders/projectType.ts), so the confirm text names that effect.
 */
import { AI_SWITCH_IDS, MODULES, MODULE_IDS, moduleEnabled, modulesBlock, type ModuleId, type ModuleSwitches } from "./modules";
import { PROJECT_TYPES, type ProjectType } from "./workOrders/format";
import { TYPE_DEFAULTS } from "./workOrders/projectType";

export { PROJECT_TYPES, type ProjectType };

export interface ProjectTypePreset { type: ProjectType; label: string; explain: string; modules: readonly ModuleId[] }

const CORE_MODULES: readonly ModuleId[] = MODULES.filter(m => m.group === "core").map(m => m.id);

export const PROJECT_TYPE_PRESETS: Readonly<Record<ProjectType, ProjectTypePreset>> = {
  dev: { type: "dev", label: "Dev", explain: "your own development projects: Azure data services, databases, infrastructure, Airflow and Grafana", modules: ["azure", "databases", "infrastructure", "airflow", "grafana"] },
  work: { type: "work", label: "Work", explain: "client and FOIL data projects: every cloud-core module (Fabric, Databricks, Power BI and the rest)", modules: CORE_MODULES },
  perso: { type: "perso", label: "Personal", explain: "small personal projects: databases and infrastructure", modules: ["databases", "infrastructure"] }
};

/** The modules a type switches on, in the canonical module order. */
export function presetModules(type: ProjectType): ModuleId[] {
  const on = new Set(PROJECT_TYPE_PRESETS[type].modules);
  return MODULE_IDS.filter(id => on.has(id));
}

/** What a chosen module list adds to or removes from a type's preset (both in canonical order). */
export function diffFromPreset(type: ProjectType, enabled: ReadonlySet<ModuleId>): { addOns: ModuleId[]; removed: ModuleId[] } {
  const preset = new Set(PROJECT_TYPE_PRESETS[type].modules);
  return { addOns: MODULE_IDS.filter(id => enabled.has(id) && !preset.has(id)), removed: MODULE_IDS.filter(id => !enabled.has(id) && preset.has(id)) };
}

/** The part of a manifest the pickers read. */
type TypedManifest = { project: { type?: ProjectType }; modules?: ModuleSwitches } | undefined;

/**
 * The modules ticked when the second step opens. A newly chosen type starts from its preset; the same
 * type as the file already has starts from the file's own toggles, so running the command again never
 * resets an add-on or a module the person switched off. Without a `modules` block there is nothing to
 * keep, so the preset applies.
 */
export function startingModules(manifest: TypedManifest, type: ProjectType): ModuleId[] {
  return keepsCurrentModules(manifest, type) ? MODULE_IDS.filter(id => moduleEnabled(manifest, id)) : presetModules(type);
}

/** True when picking `type` starts from the file's own toggles: same type, and a `modules` block with cloud toggles. */
export function keepsCurrentModules(manifest: TypedManifest, type: ProjectType): boolean {
  return manifest?.project.type === type && MODULE_IDS.some(id => typeof manifest?.modules?.[id] === "boolean");
}

/** What changes between two module lists (both in canonical order). */
export function diffModules(before: ReadonlySet<ModuleId>, after: ReadonlySet<ModuleId>): { switchedOn: ModuleId[]; switchedOff: ModuleId[] } {
  return { switchedOn: MODULE_IDS.filter(id => after.has(id) && !before.has(id)), switchedOff: MODULE_IDS.filter(id => !after.has(id) && before.has(id)) };
}

/** The modules a manifest has on today. */
export function enabledModules(manifest: TypedManifest): Set<ModuleId> {
  return new Set(MODULE_IDS.filter(id => moduleEnabled(manifest, id)));
}

/** One sentence naming what `project.type` does beyond the modules (work orders and merge). */
export function typeEffect(type: ProjectType, previous: ProjectType | undefined): string {
  const d = TYPE_DEFAULTS[type];
  const was = previous ? `the file says ${previous}` : "the file has no type, which counts as dev";
  return `project.type "${type}" also sets the work-order defaults (${was}): ${d.explain}. The machine setting datapass.ai.projectTypes still wins, and work orders still need datapass.ai.workOrders.enabled on this computer.`;
}

/**
 * The manifest after "Choose Project Modules" / "Choose Project Type": the `modules` block placed right
 * after `project` (the full cloud list, in canonical order), `project.type` set when a type is given,
 * the `workOrders` / `pilot` switches and every other field exactly as the file has them. Pure: the caller validates and writes.
 */
export function buildModulesManifest(raw: Record<string, unknown>, enabled: ReadonlySet<ModuleId>, type?: ProjectType): Record<string, unknown> {
  const old = (raw.modules && typeof raw.modules === "object" && !Array.isArray(raw.modules) ? raw.modules : {}) as Record<string, unknown>;
  const block = { ...modulesBlock(enabled), ...Object.fromEntries(AI_SWITCH_IDS.filter(k => typeof old[k] === "boolean").map(k => [k, old[k]])) };
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "modules") continue;
    next[key] = key === "project" && type ? { ...(value as Record<string, unknown>), type } : value;
    if (key === "project") next.modules = block;
  }
  next.modules ??= block;
  return next;
}
