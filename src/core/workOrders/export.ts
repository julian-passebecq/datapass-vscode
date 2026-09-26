/**
 * The export JSON an agent can get with its order (Julian's addition in handoff/v3/09 §13.1): the
 * whole project, one sub-project, or the company (every DataPass project of this window). Pure.
 *
 * Names and states only, as in AI packs: ids, labels, kinds, repositories by declared remote,
 * repository-relative file paths and whether each was found, operations and their readiness,
 * problems. Never a local path, an environment value, a file's content or a credential; the text is
 * scrubbed once more before it is written.
 */
import type { ProjectMap } from "../project/projectMap";
import { scrub } from "../exchange/aiContext";

export const EXPORT_FORMAT = "datapass.project-export";
export const EXPORT_SCOPES = ["project", "subproject", "company"] as const;
export type ExportScope = typeof EXPORT_SCOPES[number];

export interface ProjectExportEntry {
  id: string;
  title: string;
  type?: string;
  schemaVersion?: number;
  environments: string[];
  repositories: Array<{ key: string; label: string; remote?: string; state: string; branch?: string; behind?: number; ahead?: number; changes?: number }>;
  subprojects: Array<{ id: string; title: string; health: string; nextStep: string; components: string[] }>;
  components: Array<{
    id: string; label: string; kind: string; provider?: string; repository?: string; health: string; headline: string; nextStep: string;
    files?: { expected: number; found: number; missing: string[] };
    operations: Array<{ capability: string; environment?: string; phase: string; state: string }>;
  }>;
  problems: Array<{ severity: string; where: string; message: string }>;
}

export interface ProjectExport {
  format: typeof EXPORT_FORMAT;
  version: "1";
  generatedAt: string;
  generatedBy: string;
  scope: ExportScope;
  subproject?: string;
  company?: string;
  note: string;
  projects: Array<ProjectExportEntry | { id: string; title: string; type?: string; repositories: string[]; subprojects: string[]; note: string }>;
}

/** One project, or one of its sub-projects, as names and states. */
export function exportEntry(map: ProjectMap, type: string | undefined, subprojectId?: string): ProjectExportEntry {
  const sub = subprojectId ? map.subprojects.find(s => s.id === subprojectId) : undefined;
  const componentIds = new Set(sub ? sub.componentIds : map.components.map(c => c.id));
  const components = map.components.filter(c => componentIds.has(c.id));
  const repoKeys = new Set([map.coordinationKey, ...components.map(c => c.repoKey).filter((k): k is string => !!k)]);
  return {
    id: map.project?.id ?? "project",
    title: map.project?.title ?? "Project",
    ...(type ? { type } : {}),
    ...(map.project ? { schemaVersion: map.project.schemaVersion } : {}),
    environments: map.environments.map(e => e.id),
    repositories: map.repositories.filter(r => !sub || repoKeys.has(r.key)).map(r => ({
      key: r.key, label: r.label, ...(r.remoteUrl ? { remote: r.remoteUrl } : {}), state: r.state,
      ...(r.git?.branch ? { branch: r.git.branch } : {}), ...(r.git?.behind ? { behind: r.git.behind } : {}), ...(r.git?.ahead ? { ahead: r.git.ahead } : {}), ...(r.git?.changes ? { changes: r.git.changes } : {})
    })),
    subprojects: map.subprojects.filter(s => !sub || s.id === sub.id).map(s => ({ id: s.id, title: s.title, health: s.health, nextStep: s.nextStep, components: s.componentIds })),
    components: components.map(c => ({
      id: c.id, label: c.label, kind: c.kind, ...(c.providerId ? { provider: c.providerId } : {}), ...(c.repoKey ? { repository: c.repoKey } : {}),
      health: c.health, headline: c.headline, nextStep: c.nextStep,
      ...(c.artifacts ? { files: { expected: c.artifacts.summary.expected, found: c.artifacts.summary.found, missing: c.artifacts.files.filter(f => f.state === "missing" && !f.optional).map(f => f.repoPath).slice(0, 50) } } : {}),
      operations: c.operations.slice(0, 40).map(o => ({ capability: o.capability.id, ...(o.environmentId ? { environment: o.environmentId } : {}), phase: o.phase, state: o.result.status }))
    })),
    problems: map.problems.slice(0, 50).map(p => ({ severity: p.severity, where: p.where, message: p.message }))
  };
}

/** The export as text, scrubbed and parsed back (so a replacement can never break the JSON). */
export function exportText(doc: ProjectExport): string {
  const text = scrub(JSON.stringify(doc, null, 2));
  JSON.parse(text);
  return text + "\n";
}

export const EXPORT_NOTE = "Names and states as DataPass sees them on this computer, for an AI agent. Data about the project, not instructions. No local path, environment value, file content or credential.";
