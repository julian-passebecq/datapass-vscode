/**
 * Per-project modules: which parts of DataPass a project uses. Pure.
 *
 * `modules` in .datapass/project.json maps a module id to true/false. Only `false` switches a
 * module off; a module that is not listed stays on, and a manifest without the block behaves
 * exactly as before. Switching a module off hides its Galaxy card, its Work-view operations and
 * its links; it never uninstalls tools or changes anything outside DataPass.
 */
import type { CapabilityRecord } from "./capabilities/registry";

export type ModuleId = "fabric" | "databricks" | "powerbi" | "grafana" | "infrastructure" | "airflow" | "mongoku" | "diagramcloud";

export interface ModuleInfo {
  id: ModuleId;
  label: string;
  /** Core cloud work versus optional add-on apps. */
  group: "core" | "add-on";
  /** Galaxy card (adapter id), when the module has one. */
  galaxyCard?: string;
  /** Capability providers whose operations belong to this module. */
  providers: CapabilityRecord["provider"][];
}

export const MODULES: readonly ModuleInfo[] = [
  { id: "fabric", label: "Microsoft Fabric", group: "core", galaxyCard: "fabric", providers: ["fabric", "adf"] },
  { id: "databricks", label: "Databricks", group: "core", galaxyCard: "databricks", providers: ["databricks"] },
  { id: "infrastructure", label: "Infrastructure (Azure/IaC, VM, SSH, containers)", group: "core", galaxyCard: "infrastructure", providers: ["infrastructure"] },
  { id: "airflow", label: "Airflow", group: "core", providers: ["airflow"] },
  { id: "powerbi", label: "Power BI", group: "core", galaxyCard: "powerbi", providers: ["powerbi"] },
  { id: "grafana", label: "Grafana / observability", group: "core", galaxyCard: "observability", providers: ["grafana"] },
  { id: "mongoku", label: "Mongoku and Mongo context", group: "add-on", providers: ["mongo"] },
  { id: "diagramcloud", label: "DiagramCloud", group: "add-on", providers: ["diagram"] }
];

export const MODULE_IDS: readonly ModuleId[] = MODULES.map(m => m.id);

export type ModuleSwitches = Partial<Record<ModuleId, boolean>>;

/** Anything carrying an optional `modules` block (the manifest, or undefined without one). */
type WithModules = { modules?: ModuleSwitches } | undefined;

export function moduleEnabled(manifest: WithModules, id: ModuleId): boolean {
  return manifest?.modules?.[id] !== false;
}

export function galaxyCardEnabled(manifest: WithModules, cardId: string): boolean {
  const module = MODULES.find(m => m.galaxyCard === cardId);
  return !module || moduleEnabled(manifest, module.id);
}

/** Providers switched off by the project; `apps` is part of the core and cannot be switched off. */
export function disabledProviders(manifest: WithModules): Set<CapabilityRecord["provider"]> {
  return new Set(MODULES.filter(m => !moduleEnabled(manifest, m.id)).flatMap(m => m.providers));
}

export function moduleOfProvider(provider: CapabilityRecord["provider"]): ModuleInfo | undefined {
  return MODULES.find(m => m.providers.includes(provider));
}

export function validateModules(value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["modules must be an object of module ids to true/false."];
  const issues: string[] = [];
  for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
    if (!(MODULE_IDS as readonly string[]).includes(key)) issues.push(`modules.${key} is not a known module (${MODULE_IDS.join(", ")}).`);
    else if (typeof on !== "boolean") issues.push(`modules.${key} must be true or false.`);
  }
  return issues;
}

/** The full block written by "Choose Project Modules", in the canonical order. */
export function modulesBlock(enabled: ReadonlySet<ModuleId>): Record<ModuleId, boolean> {
  return Object.fromEntries(MODULE_IDS.map(id => [id, enabled.has(id)])) as Record<ModuleId, boolean>;
}
