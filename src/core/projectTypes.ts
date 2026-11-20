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
 * The add-on group (DiagramCloud) is off in every preset: a person adds it on top.
 */
import { MODULES, MODULE_IDS, type ModuleId } from "./modules";
import { PROJECT_TYPES, type ProjectType } from "./workOrders/format";

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

/** The preset plus the add-ons switched on top of it, in the canonical module order. */
export function modulesForType(type: ProjectType, addOns: Iterable<ModuleId> = []): ModuleId[] {
  const on = new Set<ModuleId>([...PROJECT_TYPE_PRESETS[type].modules, ...addOns]);
  return MODULE_IDS.filter(id => on.has(id));
}

/** What a chosen module list adds to or removes from a type's preset (both in canonical order). */
export function diffFromPreset(type: ProjectType, enabled: ReadonlySet<ModuleId>): { addOns: ModuleId[]; removed: ModuleId[] } {
  const preset = new Set(PROJECT_TYPE_PRESETS[type].modules);
  return { addOns: MODULE_IDS.filter(id => enabled.has(id) && !preset.has(id)), removed: MODULE_IDS.filter(id => !enabled.has(id) && preset.has(id)) };
}
