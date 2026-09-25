/**
 * Per-project modules: which parts of DataPass a project uses. Pure.
 *
 * `modules` in .datapass/project.json maps a module id to true/false. Only `false` switches a
 * module off; a module that is not listed stays on, and a manifest without the block behaves
 * exactly as before. Switching a module off hides its Galaxy card, its Work-view operations and
 * its links; it never uninstalls tools or changes anything outside DataPass.
 */
import type { CapabilityRecord } from "./capabilities/registry";

export type ModuleId = "fabric" | "databricks" | "powerbi" | "grafana" | "infrastructure" | "airflow" | "azure" | "databases" | "mongoku" | "diagramcloud";

export interface ModuleInfo {
  id: ModuleId;
  label: string;
  /** Core cloud work versus optional add-on apps. */
  group: "core" | "add-on";
  /** Galaxy card (adapter id), when the module has one. */
  galaxyCard?: string;
  /** Capability providers whose operations belong to this module. */
  providers: CapabilityRecord["provider"][];
  /** Shown next to the module when projects choose their modules. */
  note?: string;
}

export const MODULES: readonly ModuleInfo[] = [
  { id: "fabric", label: "Microsoft Fabric", group: "core", galaxyCard: "fabric", providers: ["fabric"] },
  { id: "databricks", label: "Databricks", group: "core", galaxyCard: "databricks", providers: ["databricks"] },
  // Azure Data Factory is its own service, not part of Fabric (Fabric has its own Data Factory items).
  { id: "azure", label: "Azure data services (Data Factory, Functions, Storage, Cosmos DB)", group: "core", providers: ["adf", "azure-functions", "azure-storage", "cosmos"] },
  { id: "databases", label: "Databases (MongoDB Atlas, PostgreSQL / Neon)", group: "core", providers: ["mongodb", "postgres"] },
  { id: "infrastructure", label: "Infrastructure (Azure/IaC, VM, SSH, containers)", group: "core", galaxyCard: "infrastructure", providers: ["infrastructure"] },
  { id: "airflow", label: "Airflow", group: "core", providers: ["airflow"] },
  { id: "powerbi", label: "Power BI", group: "core", galaxyCard: "powerbi", providers: ["powerbi"] },
  { id: "grafana", label: "Grafana / observability", group: "core", galaxyCard: "observability", providers: ["grafana"] },
  { id: "mongoku", label: "Mongoku and Mongo context", group: "add-on", providers: ["mongo"],
    note: "frozen: Mongoku reads board.json and project.json from GitHub; DataPass never connects to it. Off for new projects." },
  { id: "diagramcloud", label: "DiagramCloud", group: "add-on", providers: ["diagram"] }
];

export const MODULE_IDS: readonly ModuleId[] = MODULES.map(m => m.id);

/**
 * 0.20: switches that are not cloud modules. `workOrders` (AI agents working from a DataPass work
 * order) and `pilot` (later). Their defaults depend on the project type (core/workOrders/projectType.ts),
 * so they are not in MODULES and "Choose Project Modules" keeps them as they are.
 */
export type AiSwitchId = "workOrders" | "pilot";
export const AI_SWITCH_IDS: readonly AiSwitchId[] = ["workOrders", "pilot"];

export type ModuleSwitches = Partial<Record<ModuleId | AiSwitchId, boolean>>;

/** Anything carrying an optional `modules` block (the manifest, or undefined without one). */
type WithModules = { modules?: ModuleSwitches } | undefined;

export function moduleEnabled(manifest: WithModules, id: ModuleId): boolean {
  return manifest?.modules?.[id] !== false;
}

export function galaxyCardEnabled(manifest: WithModules, cardId: string): boolean {
  const module = MODULES.find(m => m.galaxyCard === cardId);
  return !module || moduleEnabled(manifest, module.id);
}

/** Operations every project has (external apps, Python code, opening files, its Git host's CI): never switched off. */
export const ALWAYS_ON_PROVIDERS: ReadonlySet<CapabilityRecord["provider"]> = new Set(["apps", "python", "generic", "devops"]);

/** Providers switched off by the project; ALWAYS_ON_PROVIDERS cannot be switched off. */
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
    if (![...MODULE_IDS, ...AI_SWITCH_IDS].includes(key as ModuleId)) issues.push(`modules.${key} is not a known module (${[...MODULE_IDS, ...AI_SWITCH_IDS].join(", ")}).`);
    else if (typeof on !== "boolean") issues.push(`modules.${key} must be true or false.`);
  }
  return issues;
}

/** The full block written by "Choose Project Modules", in the canonical order. */
export function modulesBlock(enabled: ReadonlySet<ModuleId>): Record<ModuleId, boolean> {
  return Object.fromEntries(MODULE_IDS.map(id => [id, enabled.has(id)])) as Record<ModuleId, boolean>;
}
