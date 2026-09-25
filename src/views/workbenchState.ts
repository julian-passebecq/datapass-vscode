/**
 * What the Workbench webviews render: a serializable projection of the project map plus the
 * current selection and the diagram layout of the selected sub-project. Pure (no `vscode`).
 *
 * Only display data crosses into the webview: labels, states, repository-relative paths and plain
 * sentences. No absolute path, no file content, nothing a webview could turn into a command other
 * than the allowlisted messages handled by the extension.
 */
import { PHASE_LABELS } from "../core/capabilities/registry";
import type { ComponentView, MapChecklistEntry, OperationView, ProjectMap } from "../core/project/projectMap";
import type { LayoutEdgeInput } from "../core/project/layout";

export interface WbFile {
  path: string; repoPath: string; kind: "file" | "dir" | "glob"; role: string; requiredFor: string[]; optional: boolean;
  source: string; about?: string; generatedBy?: string; generatedHow?: string; state: string; count?: number;
}
export interface WbOperation {
  key: string; label: string; phase: string; phaseLabel: string; capabilityId: string; environmentId?: string; production: boolean;
  status: string; nextStep: string; blockers: Array<{ kind: string; label: string; detail: string }>; unknowns: Array<{ label: string; detail: string }>;
  reviews: Array<{ id: string; label: string }>; sideEffects: string[]; actionMode: string; implementation: string; native: boolean;
  command?: { text: string; cwd: string }; lastResult?: { result: string; at: string; stale: boolean };
}
export interface WbChecklist { key: string; id: string; label: string; state: string; note?: string }
export interface WbComponent {
  id: string; label: string; kind: string; providerLabel?: string; providerGlyph: string; providerAbout?: string; providerSupport?: string;
  nativeTool?: string; status?: string; description?: string; health: string; headline: string; nextStep: string; subprojects: string[];
  repoKey?: string; parent?: string; children: string[];
  artifacts?: { repoKey: string; root: string; profileLabel: string; profileAbout: string; availability: string; summary: { expected: number; found: number; missing: number; generatedMissing: number; optionalMissing: number }; entry?: string; files: WbFile[]; mustNotCommit: Array<{ path: string; why: string; tracked: boolean }> };
  operations: WbOperation[]; checklist: WbChecklist[]; docs: Array<{ label: string; path?: string; url?: string; repoKey?: string }>;
  incoming: Array<{ id: string; label: string; relation: string }>; outgoing: Array<{ id: string; label: string; relation: string }>;
  problems: string[];
}
export interface WbRepository {
  key: string; label: string; state: string; coordination: boolean; remote?: string; branch?: string; folderName?: string; detail: string; nextStep?: string;
  behind?: number; ahead?: number; changes?: number; lastFetch?: string; usedBy: string[]; description?: string;
}
export interface WbSubproject {
  id: string; title: string; objective?: string; implicit: boolean; health: string; nextStep: string; repoKey?: string;
  summary: { components: number; filesExpected: number; filesFound: number; opsReady: number; opsTotal: number };
  needs: { repositories: Array<{ key: string; label: string; state: string; nextStep?: string }>; tools: Array<{ label: string; extensionIds: string[]; neededFor: string[] }>; missingFiles: number; generationNeeded: number };
  checklist: WbChecklist[]; componentIds: string[]; docs: Array<{ label: string; path?: string; url?: string; repoKey?: string }>;
}
export interface WorkbenchState {
  version: string;
  hasRoot: boolean;
  hasManifest: boolean;
  manifestErrors: string[];
  graphError?: string;
  trusted: boolean;
  observedAt?: string;
  multipleProjectFolders: boolean;
  project?: { id: string; title: string; description?: string; schemaVersion: number; graphVersion?: string };
  summary?: ProjectMap["summary"];
  nextStep: string;
  environments: Array<{ id: string; title?: string; production?: boolean }>;
  repositories: WbRepository[];
  subprojects: WbSubproject[];
  components: WbComponent[];
  problems: Array<{ severity: string; where: string; message: string }>;
  selection: { subproject?: string; component?: string };
  /** Components and links of the diagram (selected sub-project, else the whole project); laid out by the webview for its width. */
  diagram: { nodeIds: string[]; edges: LayoutEdgeInput[] };
  docs: Array<{ label: string; path?: string; url?: string; repoKey?: string }>;
}

const checklist = (c: MapChecklistEntry): WbChecklist => ({ key: c.key, id: c.id, label: c.label, state: c.state, note: c.note });

function operation(o: OperationView): WbOperation {
  return {
    key: o.key, label: o.label, phase: o.phase, phaseLabel: PHASE_LABELS[o.phase], capabilityId: o.capability.id, environmentId: o.environmentId,
    production: Boolean(o.environment?.production), status: o.result.status, nextStep: o.result.nextStep,
    blockers: o.result.blockers.map(b => ({ kind: b.kind, label: b.label, detail: b.detail })),
    unknowns: o.result.unknowns.map(u => ({ label: u.label, detail: u.detail })),
    reviews: o.result.pendingReviews.map(r => ({ id: r.id, label: r.label })),
    sideEffects: [...o.result.sideEffects], actionMode: o.capability.actionMode, implementation: o.capability.implementation,
    native: o.capability.implementation === "documented-only" || o.capability.actionMode === "manual-in-native-tool",
    command: o.command, lastResult: o.lastResult ? { result: o.lastResult.result, at: o.lastResult.at, stale: o.lastResult.stale } : undefined
  };
}

function component(c: ComponentView, map: ProjectMap): WbComponent {
  const label = (id: string) => map.components.find(x => x.id === id)?.label ?? id;
  const a = c.artifacts;
  return {
    id: c.id, label: c.label, kind: c.kind, providerLabel: c.provider?.label ?? c.providerId, providerGlyph: c.provider?.glyph ?? "◻",
    providerAbout: c.provider?.about, providerSupport: c.provider?.support, nativeTool: c.provider?.nativeTool?.label,
    status: c.status, description: c.description, health: c.health, headline: c.headline, nextStep: c.nextStep, subprojects: c.subprojects,
    repoKey: c.repoKey, parent: c.parent, children: c.children,
    artifacts: a ? {
      repoKey: a.repoKey, root: a.root, profileLabel: a.profile.label, profileAbout: a.profile.about, availability: a.availability, summary: a.summary, entry: a.entry?.path,
      files: a.files.map(f => ({ path: f.path, repoPath: f.repoPath, kind: f.kind, role: f.role, requiredFor: f.requiredFor, optional: f.optional, source: f.source, about: f.about, generatedBy: f.generated?.producer, generatedHow: f.generated?.how, state: f.state, count: f.count })),
      mustNotCommit: a.mustNotCommit.map(m => ({ path: m.path, why: m.why, tracked: m.tracked }))
    } : undefined,
    operations: c.operations.map(operation), checklist: c.checklist.map(checklist), docs: c.docs,
    incoming: c.incoming.map(r => ({ id: r.from, label: label(r.from), relation: r.relation })),
    outgoing: c.outgoing.map(r => ({ id: r.to, label: label(r.to), relation: r.relation })),
    problems: c.problems
  };
}

export interface StateInput {
  map: ProjectMap;
  selection: { subproject?: string; component?: string };
  version: string;
  hasRoot: boolean;
  hasManifest: boolean;
  manifestErrors: string[];
  graphError?: string;
  trusted: boolean;
  observedAt?: string;
  multipleProjectFolders: boolean;
}

export function workbenchState(input: StateInput): WorkbenchState {
  const { map } = input;
  const sub = map.subprojects.find(s => s.id === input.selection.subproject);
  // The diagram shows the selected sub-project, or the whole project when none is selected.
  const ids = sub ? sub.componentIds : map.components.map(c => c.id);
  const idSet = new Set(ids);
  const diagram = { nodeIds: ids, edges: map.relations.filter(r => idSet.has(r.from) && idSet.has(r.to)).map(r => ({ id: r.id, from: r.from, to: r.to, flow: r.flow })) };
  return {
    version: input.version, hasRoot: input.hasRoot, hasManifest: input.hasManifest, manifestErrors: input.manifestErrors.slice(0, 20), graphError: input.graphError,
    trusted: input.trusted, observedAt: input.observedAt, multipleProjectFolders: input.multipleProjectFolders,
    project: map.project, summary: map.project ? map.summary : undefined, nextStep: map.nextStep,
    environments: map.environments.map(e => ({ id: e.id, title: e.title, production: e.production })),
    repositories: map.repositories.map(r => ({
      key: r.key, label: r.label, state: r.state, coordination: r.coordination, remote: r.remote, branch: r.branch, folderName: r.folderName, detail: r.detail, nextStep: r.nextStep,
      behind: r.git?.behind, ahead: r.git?.ahead, changes: r.git?.changes, lastFetch: r.git?.lastFetch, usedBy: r.usedBy, description: r.description
    })),
    subprojects: map.subprojects.map(s => ({
      id: s.id, title: s.title, objective: s.objective, implicit: s.implicit, health: s.health, nextStep: s.nextStep, repoKey: s.repoKey, summary: s.summary,
      needs: { repositories: s.needs.repositories.map(r => ({ key: r.key, label: r.label, state: r.state, nextStep: r.nextStep })), tools: s.needs.tools.map(t => ({ label: t.label, extensionIds: t.extensionIds, neededFor: t.neededFor })), missingFiles: s.needs.missingFiles, generationNeeded: s.needs.generationNeeded },
      checklist: s.checklist.map(checklist), componentIds: s.componentIds, docs: s.docs
    })),
    components: map.components.map(c => component(c, map)),
    problems: map.problems.slice(0, 50),
    selection: input.selection,
    diagram,
    docs: map.docs
  };
}
