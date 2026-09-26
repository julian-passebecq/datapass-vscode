/**
 * Project types (pass AI-2, Julian's answers Q3/Q4 in handoff/v3/09 §13.1). Pure.
 *
 *   dev   — Julian's own development projects: work orders on (once the machine setting is on),
 *           the agent merges its PRs when CI is green.
 *   perso — small personal projects: same defaults as dev.
 *   work  — FOIL and client projects: work orders off unless the project turns them on
 *           (`modules.workOrders: true`), and Julian merges.
 *
 * The type comes from `project.type` in .datapass/project.json, or from the machine setting
 * `datapass.ai.projectTypes` (project id → type), which wins: a person can always make a project
 * stricter on their own computer. Without either, a project is `dev` (Julian's global rule for any
 * project not listed). A repository can never switch work orders on by itself: the machine setting
 * `datapass.ai.workOrders.enabled` is required, and every launch is confirmed.
 */
import { PROJECT_TYPES, type MergePolicy, type ProjectType } from "./format";

export interface TypeDefaults { label: string; workOrders: boolean; merge: MergePolicy; explain: string }

export const TYPE_DEFAULTS: Readonly<Record<ProjectType, TypeDefaults>> = {
  dev: { label: "dev", workOrders: true, merge: "agent-when-green", explain: "development project: work orders on, the agent merges its PRs when CI is green" },
  perso: { label: "perso", workOrders: true, merge: "agent-when-green", explain: "personal project: work orders on, the agent merges its PRs when CI is green" },
  work: { label: "work", workOrders: false, merge: "person", explain: "work project (FOIL, clients): work orders off unless the project turns them on, and you merge" }
};

export interface ProjectTypeInfo { type: ProjectType; source: "machine" | "manifest" | "default" }

export const isProjectType = (v: unknown): v is ProjectType => typeof v === "string" && (PROJECT_TYPES as readonly string[]).includes(v);

/** The machine setting wins, then the manifest's `project.type`, else `dev`. Anything malformed is ignored. */
export function resolveProjectType(manifestType: unknown, machine: unknown, projectId: string | undefined): ProjectTypeInfo {
  if (projectId && machine && typeof machine === "object" && !Array.isArray(machine)) {
    const v = Object.prototype.hasOwnProperty.call(machine, projectId) ? (machine as Record<string, unknown>)[projectId] : undefined;
    if (isProjectType(v)) return { type: v, source: "machine" };
  }
  if (isProjectType(manifestType)) return { type: manifestType, source: "manifest" };
  return { type: "dev", source: "default" };
}

export interface WorkOrdersInput {
  machineEnabled: boolean;
  trusted: boolean;
  hasProject: boolean;
  type: ProjectType;
  /** `modules.workOrders` of the manifest: undefined when not listed. */
  moduleSwitch: boolean | undefined;
}

export type WorkOrdersVerdict = { allowed: true; why: string } | { allowed: false; why: string; fix?: "machine-setting" | "trust" | "project-module" | "project" };

/** Whether this project may write and launch work orders on this machine, and why in plain words. */
export function workOrdersVerdict(i: WorkOrdersInput): WorkOrdersVerdict {
  if (!i.hasProject) return { allowed: false, why: "Open a DataPass project first.", fix: "project" };
  if (!i.trusted) return { allowed: false, why: "Restricted Mode: trust this workspace to use work orders.", fix: "trust" };
  if (!i.machineEnabled) return { allowed: false, why: "Work orders are off on this computer (setting datapass.ai.workOrders.enabled). They use your Claude or Codex plan.", fix: "machine-setting" };
  if (i.moduleSwitch === false) return { allowed: false, why: "This project switches work orders off (modules.workOrders: false in .datapass/project.json).", fix: "project-module" };
  if (i.type === "work" && i.moduleSwitch !== true) return { allowed: false, why: "A work project (FOIL, clients) needs modules.workOrders: true in its .datapass/project.json before an agent can work on it.", fix: "project-module" };
  return { allowed: true, why: i.type === "work" ? "Work project with work orders turned on: you merge." : TYPE_DEFAULTS[i.type].explain };
}

/** The merge policy a new order starts with (the per-order switch stays). */
export function defaultMergePolicy(type: ProjectType, override?: unknown): MergePolicy {
  return override === "person" || override === "agent-when-green" ? override : TYPE_DEFAULTS[type].merge;
}
