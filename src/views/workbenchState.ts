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
import { fileStateText, keySourceText, keyStateText, type Readiness } from "../core/readiness/readiness";
import type { WbToolkit } from "./toolkitState";
import { toolStateText } from "../core/toolchain/toolchain";
import { extensionsJsonText } from "../core/toolchain/extensionsJson";
import { CONNECTION_STATE_TEXT } from "../core/toolchain/connections";
import { LINK_LABELS, linkText } from "../core/evidence/chain";
import type { ArchitectureImpact, CriterionValue, DerivedArchitecture, OptionsAnalysis, OptionsFile } from "../core/project/options";
import type { ProjectSheet, SheetDataset, SheetFormula, SheetRuntime } from "../core/project/sheet";
import type { BoardView } from "../core/project/board";
import { gitHostOf, repositoryWebLinks, type WebLinkId } from "../core/project/gitHosts";
import type { CostTotal } from "../core/project/costs";

/** 0.16: the board as the kanban shows it (built by the session; plain data). */
export type WbBoard = BoardView;

/** The previewed architecture as the session computed it. */
export interface PreviewInput { key: string; title: string; impact: ArchitectureImpact; derived: DerivedArchitecture; map: ProjectMap }

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
  id: string; label: string; kind: string; providerId?: string; providerLabel?: string; providerGlyph: string; providerAbout?: string; providerSupport?: string;
  nativeTool?: string; status?: string; description?: string; health: string; headline: string; nextStep: string; subprojects: string[];
  repoKey?: string; parent?: string; children: string[];
  artifacts?: { repoKey: string; root: string; profileLabel: string; profileAbout: string; availability: string; summary: { expected: number; found: number; missing: number; generatedMissing: number; optionalMissing: number }; entry?: string; files: WbFile[]; mustNotCommit: Array<{ path: string; why: string; tracked: boolean; tracking: "tracked" | "untracked" | "unknown"; trackingReason?: string }> };
  operations: WbOperation[]; checklist: WbChecklist[]; docs: Array<{ label: string; path?: string; url?: string; repoKey?: string }>;
  incoming: Array<{ id: string; label: string; relation: string }>; outgoing: Array<{ id: string; label: string; relation: string }>;
  problems: string[];
}
export interface WbRepository {
  key: string; label: string; state: string; coordination: boolean; remote?: string; branch?: string; folderName?: string; detail: string; nextStep?: string;
  behind?: number; ahead?: number; changes?: number; lastFetch?: string; usedBy: string[]; description?: string;
  /** 0.16: the Git host (GitHub, Azure DevOps, GitLab) and the pages DataPass can open (the extension rebuilds each URL). */
  host?: string;
  links: Array<{ id: WebLinkId; label: string }>;
}
export interface WbSubproject {
  id: string; title: string; objective?: string; implicit: boolean; health: string; nextStep: string; repoKey?: string;
  summary: { components: number; filesExpected: number; filesFound: number; opsReady: number; opsTotal: number };
  needs: { repositories: Array<{ key: string; label: string; state: string; nextStep?: string }>; tools: Array<{ label: string; extensionIds: string[]; neededFor: string[] }>; missingFiles: number; generationNeeded: number };
  checklist: WbChecklist[]; componentIds: string[]; docs: Array<{ label: string; path?: string; url?: string; repoKey?: string }>;
}
/** Environment readiness for the webview: names and states only (the Readiness never holds values). */
export interface WbReadiness {
  declared: boolean;
  files: Array<{ id: string; path: string; repoLabel?: string; optional: boolean; state: string; stateText: string; git: string }>;
  keys: Array<{ name: string; state: string; stateText: string; source: string; sourceText: string }>;
  identifiers: Array<{ id: string; label: string; provider?: string; kind?: string; envKey?: string; environments: string[] }>;
  companions: Array<{ module: string; label: string; state: string; detail: string }>;
  /** 0.18 (manifest v5): names, versions and states only; install commands carry no project value. */
  tools?: { entries: Array<{ tool: string; label: string; state: string; stateText: string; detail: string; optional: boolean; extensionId?: string; install?: "command" | "docs" }>; summary: { ok: number; attention: number; notChecked: number; total: number }; extensionsText: string; extensionsAttention: boolean };
  connections: Array<{ id: string; label: string; kind: string; environment?: string; state: string; stateText: string; detail: string; nextStep?: string; signIn: boolean; hasPortal: boolean; tool?: string }>;
  /** D-22: each integration's evidence chain; every link says observed (source, time) or unknown (why). */
  evidence: Array<{ id: string; label: string; kind: string; summary: string; tone: string; links: Array<{ link: string; name: string; state: string; holds?: boolean; text: string }> }>;
  checks: Array<{ severity: string; area: string; message: string; nextStep?: string }>;
  summary: Readiness["summary"];
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
  readiness?: WbReadiness;
  /** 0.15: architecture options with DataPass's analysis (absent without .datapass/options.json). */
  options?: WbOptions;
  optionsError?: string;
  /** 0.15: project sheet (absent without .datapass/sheet.json). */
  sheet?: WbSheet;
  sheetError?: string;
  /** 0.15: the architecture previewed on the diagram. */
  preview?: WbPreview;
  /** 0.16: the project board (absent without .datapass/board.json). */
  board?: WbBoard;
  boardError?: string;
  /** 0.19: the one-line Git card (counts only; absent until the Git view has checked the repositories). */
  git?: WbGit;
  /** 0.20: work orders of this project (the Work orders view and the Details timeline). */
  workOrders?: WbWorkOrders;
  /** 0.23: the toolkit catalogue (built-in baseline + the hub's files). */
  toolkit?: WbToolkit;
  /** 0.22 modes: Workbench views the mode hides, and whether components with alternatives are marked. */
  experience?: { hiddenViews: string[]; alternatives: boolean };
  /** 0.23 (package G): coding state per option ("decision=option"), per scenario and for the preview; absent when the mode hides the badge. */
  coding?: { options: Record<string, WbCoding>; scenarios: Record<string, WbCoding>; preview?: WbCoding };
}

/** 0.20: one work order as the Workbench shows it (no local path, no goal text; the agent's words only as "the agent says"). */
export interface WbOrder {
  id: string;
  short: string;
  title: string;
  kind: string;
  createdAt: string;
  status: string;
  agent: string;
  scope: string;
  components: string[];
  subproject?: string;
  outputs: Array<{ ref: string; text: string; state: string; url?: string; ci?: string }>;
  result: { state: "none" | "valid" | "refused"; status?: string; summary?: string; questions: string[]; followUps: Array<{ title: string; why?: string }>; checks: string[]; warnings: string[]; message?: string };
  needs: string[];
  next: string;
  suggestDone: boolean;
  canLaunch: boolean;
  canResume: boolean;
  closed: boolean;
  changesCoordination: boolean;
  proposed: string[];
  timeline: Array<{ at?: string; what: string; detail?: string[]; tone?: string }>;
  error?: string;
  /** 0.24 (AI-3): the conversation Claude Control linked to this order (status, where, tokens); no text of it. */
  conversation?: { status: string; text: string; tokens?: string; linked: string; openable: boolean; last?: string; others: number };
}
export interface WbWorkOrders {
  allowed: boolean; why: string; typeLine: string; orders: WbOrder[]; selected?: string; open: number; needs: number;
  /** 0.24: whether Claude Control's conversation data is shown (on), unavailable (off) or switched off (disabled). */
  control?: "on" | "off" | "disabled" | "unknown" | "bad-url";
}

/** 0.19: what the Workbench overview says about Git (no path, no branch content, only counts and one sentence). */
export interface WbGit { needsYou: number; repositories: number; checked: number; openPrs: number; failing: number; oldestFetch?: string; top?: string; restricted: boolean }


export function wbReadiness(r: Readiness): WbReadiness {
  return {
    declared: r.declared,
    files: r.files.map(f => ({ id: f.id, path: f.path, repoLabel: f.repoLabel, optional: f.optional, state: f.state, stateText: fileStateText(f), git: f.git })),
    keys: r.keys.map(k => ({ name: k.name, state: k.state, stateText: keyStateText(k), source: k.source, sourceText: keySourceText(k) })),
    identifiers: r.identifiers.map(d => ({ id: d.id, label: d.label, provider: d.provider, kind: d.kind, envKey: d.envKey, environments: [...d.environments] })),
    companions: r.companions.map(c => ({ module: c.module, label: c.label, state: c.state, detail: c.detail })),
    tools: r.toolchain.declared ? {
      entries: r.toolchain.entries.map(e => ({ tool: e.tool, label: e.label, state: e.state, stateText: toolStateText(e), detail: e.detail, optional: e.optional, extensionId: e.extensionId, install: e.install?.command ? "command" as const : e.install?.docs ? "docs" as const : undefined })),
      summary: r.toolchain.summary, extensionsText: extensionsJsonText(r.extensions),
      extensionsAttention: r.extensions.state === "invalid" || r.extensions.expected.some(x => (!x.recommended && !x.optional) || x.unwanted)
    } : undefined,
    connections: r.connections.map(c => ({ id: c.id, label: c.label, kind: c.kind, environment: c.environment, state: c.state, stateText: CONNECTION_STATE_TEXT[c.state], detail: c.detail, nextStep: c.nextStep, signIn: Boolean(c.signIn), hasPortal: Boolean(c.hasPortal), tool: c.tool })),
    evidence: r.evidence.map(e => ({ id: e.id, label: e.label, kind: e.kind, summary: e.summary, tone: e.tone,
      links: e.chain.map(l => ({ link: l.link, name: LINK_LABELS[l.link].name, state: l.state, ...(l.state === "observed" ? { holds: l.holds } : {}), text: linkText(l) })) })),
    checks: r.checks.slice(0, 30).map(c => ({ severity: c.severity, area: c.area, message: c.message, nextStep: c.nextStep })),
    summary: r.summary
  };
}

// ------------------------------------------------------------------ 0.15 options, sheet, preview

export interface WbImpact {
  key: string;
  picks: Array<{ decision: string; option: string; changed: boolean }>;
  components: { total: number; added: Array<{ id: string; label: string; provider?: string }>; removed: Array<{ id: string; label: string; provider?: string }>; replaced: Array<{ id: string; label: string; provider?: string; from?: string }> };
  relations: { added: number; removed: number };
  providers: Array<{ id: string; label: string; support: string; nativeTool?: string; moduleLabel?: string; moduleOff: boolean; count: number }>;
  providersAdded: string[];
  providersRemoved: string[];
  tools: { newlyNeeded: Array<{ label: string; state: string; extensionId?: string; why: string[] }>; noLongerNeeded: string[]; missing: Array<{ label: string; extensionId?: string }> };
  support: { operations: number; files: number; unsupported: number };
  operations: { total: number; ready: number };
  repositories: { used: string[]; planned: string[]; newlyUsed: string[] };
  costs: { monthly: Record<string, number>; oneTime: Record<string, number>; missing: string[]; total: CostTotal };
  problems: Array<{ severity: string; message: string }>;
}
export interface WbCost { label: string; service?: string; price?: string; monthly?: number; oneTime?: number; currency: string; basis?: string; source?: string; asOf?: string; note?: string; shared?: string; use?: "any" | "learning-only" }
export interface WbOption {
  id: string; label: string; summary?: string; current: boolean; chosen: boolean; rejected: boolean; note?: string;
  values: Record<string, { text: string; score?: number; note?: string }>;
  pros: string[]; cons: string[]; consequences: string[]; costs: WbCost[]; requires: string[]; excludes: string[];
  docs: Array<{ label: string; url?: string; path?: string }>;
  impact: WbImpact;
}
export interface WbDecision {
  id: string; title: string; question?: string; level?: string; subproject?: string; concerns: string[];
  current: string; chosen?: string; decidedOn?: string; decidedBy?: string; rationale?: string; notes?: string; options: WbOption[];
}
export interface WbCoding { state: "coded" | "partly-coded" | "not-coded" | "unknown"; label: string; reason: string }
export interface WbScenario { id: string; title: string; description?: string; recommended: boolean; kind: string; impact: WbImpact }
export interface WbOptions {
  title?: string; description?: string; currency: string;
  criteria: Array<{ id: string; label: string; description?: string; better?: string; unit?: string }>;
  decisions: WbDecision[]; scenarios: WbScenario[];
  problems: Array<{ severity: string; where: string; message: string }>;
}
export interface WbSheet {
  summary?: string; asOf?: string;
  datasets: SheetDataset[]; formulas: SheetFormula[]; runtimes: SheetRuntime[]; glossary: Array<{ term: string; meaning: string }>;
}
export interface WbPreview {
  key: string; title: string;
  /** Components that exist only in this architecture, or are different in it (drawn and detailed from here). */
  components: WbComponent[];
  /** Components this architecture removes (drawn faded). */
  ghosts: Array<{ id: string; label: string; kind: string; providerId?: string; providerLabel?: string; providerGlyph: string; subprojects: string[]; repoKey?: string }>;
  diff: Record<string, "added" | "replaced" | "removed">;
  diagram: { nodeIds: string[]; edges: Array<LayoutEdgeInput & { diff?: "added" | "removed" }> };
  impact: WbImpact;
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
    id: c.id, label: c.label, kind: c.kind, providerId: c.providerId, providerLabel: c.provider?.label ?? c.providerId, providerGlyph: c.provider?.glyph ?? "◻",
    providerAbout: c.provider?.about, providerSupport: c.provider?.support, nativeTool: c.provider?.nativeTool?.label,
    status: c.status, description: c.description, health: c.health, headline: c.headline, nextStep: c.nextStep, subprojects: c.subprojects,
    repoKey: c.repoKey, parent: c.parent, children: c.children,
    artifacts: a ? {
      repoKey: a.repoKey, root: a.root, profileLabel: a.profile.label, profileAbout: a.profile.about, availability: a.availability, summary: a.summary, entry: a.entry?.path,
      files: a.files.map(f => ({ path: f.path, repoPath: f.repoPath, kind: f.kind, role: f.role, requiredFor: f.requiredFor, optional: f.optional, source: f.source, about: f.about, generatedBy: f.generated?.producer, generatedHow: f.generated?.how, state: f.state, count: f.count })),
      mustNotCommit: a.mustNotCommit.map(m => ({ path: m.path, why: m.why, tracked: m.tracked, tracking: m.tracking, trackingReason: m.trackingReason }))
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
  readiness?: Readiness;
  options?: OptionsFile;
  analysis?: OptionsAnalysis;
  optionsError?: string;
  sheet?: ProjectSheet;
  sheetError?: string;
  preview?: PreviewInput;
  board?: BoardView;
  boardError?: string;
  git?: WbGit;
  workOrders?: WbWorkOrders;
  toolkit?: WbToolkit;
}

function impact(i: ArchitectureImpact): WbImpact {
  return {
    key: i.key, picks: i.picks, components: i.components, relations: i.relations,
    providers: i.providers.map(p => ({ id: p.id, label: p.label, support: p.support, nativeTool: p.nativeTool, moduleLabel: p.moduleLabel, moduleOff: p.moduleOff, count: p.components.length })),
    providersAdded: i.providersAdded, providersRemoved: i.providersRemoved,
    tools: {
      newlyNeeded: i.tools.newlyNeeded.map(t => ({ label: t.label, state: t.state, extensionId: t.extensionId, why: t.why.slice(0, 4) })),
      noLongerNeeded: i.tools.noLongerNeeded.map(t => t.label),
      missing: i.tools.needed.filter(t => t.state === "absent").map(t => ({ label: t.label, extensionId: t.extensionId }))
    },
    support: i.support, operations: i.operations, repositories: i.repositories,
    costs: { monthly: i.costs.monthly, oneTime: i.costs.oneTime, missing: i.costs.missing, total: i.costs.total },
    problems: i.problems.map(p => ({ severity: p.severity, message: p.message }))
  };
}

const value = (v: CriterionValue): { text: string; score?: number; note?: string } =>
  typeof v === "string" ? { text: v } : typeof v === "number" ? { text: String(v) } : { text: v.text ?? "", score: v.score, note: v.note };

function optionsState(o: OptionsFile, a: OptionsAnalysis): WbOptions {
  const currency = o.currency ?? "USD";
  return {
    title: o.title, description: o.description, currency,
    criteria: (o.criteria ?? []).map(c => ({ id: c.id, label: c.label, description: c.description, better: c.better, unit: c.unit })),
    decisions: o.decisions.map(d => ({
      id: d.id, title: d.title, question: d.question, level: d.level, subproject: d.subproject,
      concerns: [...new Set([...(d.concerns ?? []), ...d.options.filter(x => x.id !== d.current).flatMap(x => [...(x.changes?.remove ?? []), ...(x.changes?.replace ?? []).map(i => i.id)])])],
      current: d.current, chosen: d.chosen, decidedOn: d.decidedOn, decidedBy: d.decidedBy, rationale: d.rationale, notes: d.notes,
      options: d.options.map(x => ({
        id: x.id, label: x.label, summary: x.summary, current: x.id === d.current, chosen: x.id === d.chosen, rejected: Boolean(x.rejected), note: x.note,
        values: Object.fromEntries(Object.entries(x.values ?? {}).map(([k, v]) => [k, value(v)])),
        pros: x.pros ?? [], cons: x.cons ?? [], consequences: x.consequences ?? [],
        costs: (x.costs ?? []).map(c => ({ ...c, currency: c.currency ?? currency })),
        requires: x.requires ?? [], excludes: x.excludes ?? [],
        docs: (x.docs ?? []).map(doc => ({ label: doc.label, url: doc.url, path: doc.path })),
        impact: impact(a.byOption[`${d.id}=${x.id}`] ?? a.current)
      }))
    })),
    scenarios: a.scenarios.map(s => ({ id: s.id, title: s.title, description: s.description, recommended: Boolean(s.recommended), kind: s.kind, impact: impact(s.impact) })),
    problems: a.problems.slice(0, 50).map(p => ({ severity: p.severity, where: p.where, message: p.message }))
  };
}

function previewState(p: PreviewInput, base: ProjectMap, selection: { subproject?: string }): WbPreview {
  const d = p.derived;
  const diff: WbPreview["diff"] = {};
  for (const id of d.diff.added) diff[id] = "added";
  for (const id of d.diff.replaced) diff[id] = "replaced";
  for (const id of d.diff.removed) diff[id] = "removed";
  const sub = p.map.subprojects.find(s => s.id === selection.subproject);
  const baseSub = base.subprojects.find(s => s.id === selection.subproject);
  const ghostIds = d.ghosts.items.map(i => i.id).filter(id => !sub || baseSub?.componentIds.includes(id));
  const ids = [...(sub ? sub.componentIds : p.map.components.map(c => c.id)), ...ghostIds];
  const idSet = new Set(ids);
  const added = new Set(d.diff.addedRelations);
  const edges: WbPreview["diagram"]["edges"] = [
    ...p.map.relations.filter(r => idSet.has(r.from) && idSet.has(r.to)).map(r => ({ id: r.id, from: r.from, to: r.to, flow: r.flow, diff: added.has(r.id) ? "added" as const : undefined })),
    ...base.relations.filter(r => d.diff.removedRelations.includes(r.id) && idSet.has(r.from) && idSet.has(r.to)).map(r => ({ id: r.id, from: r.from, to: r.to, flow: r.flow, diff: "removed" as const }))
  ];
  return {
    key: p.key, title: p.title,
    components: p.map.components.filter(c => diff[c.id] === "added" || diff[c.id] === "replaced").map(c => component(c, p.map)),
    ghosts: base.components.filter(c => diff[c.id] === "removed").map(c => ({ id: c.id, label: c.label, kind: c.kind, providerId: c.providerId, providerLabel: c.provider?.label ?? c.providerId, providerGlyph: c.provider?.glyph ?? "◻", subprojects: c.subprojects, repoKey: c.repoKey })),
    diff, diagram: { nodeIds: ids, edges }, impact: impact(p.impact)
  };
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
    repositories: map.repositories.map(r => {
      // A planned repository does not exist yet: it has no pages to open.
      const url = r.state === "planned" ? undefined : r.remoteUrl ?? r.git?.originUrl;
      return {
        key: r.key, label: r.label, state: r.state, coordination: r.coordination, remote: r.remote, branch: r.branch, folderName: r.folderName, detail: r.detail, nextStep: r.nextStep,
        behind: r.git?.behind, ahead: r.git?.ahead, changes: r.git?.changes, lastFetch: r.git?.lastFetch, usedBy: r.usedBy, description: r.description,
        host: gitHostOf(url)?.label, links: repositoryWebLinks(url).map(l => ({ id: l.id, label: l.label }))
      };
    }),
    subprojects: map.subprojects.map(s => ({
      id: s.id, title: s.title, objective: s.objective, implicit: s.implicit, health: s.health, nextStep: s.nextStep, repoKey: s.repoKey, summary: s.summary,
      needs: { repositories: s.needs.repositories.map(r => ({ key: r.key, label: r.label, state: r.state, nextStep: r.nextStep })), tools: s.needs.tools.map(t => ({ label: t.label, extensionIds: t.extensionIds, neededFor: t.neededFor })), missingFiles: s.needs.missingFiles, generationNeeded: s.needs.generationNeeded },
      checklist: s.checklist.map(checklist), componentIds: s.componentIds, docs: s.docs
    })),
    components: map.components.map(c => component(c, map)),
    problems: map.problems.slice(0, 50),
    selection: input.selection,
    diagram,
    docs: map.docs,
    readiness: input.readiness ? wbReadiness(input.readiness) : undefined,
    options: input.options && input.analysis ? optionsState(input.options, input.analysis) : undefined,
    optionsError: input.optionsError,
    sheet: input.sheet ? { summary: input.sheet.summary, asOf: input.sheet.asOf, datasets: input.sheet.datasets ?? [], formulas: input.sheet.formulas ?? [], runtimes: input.sheet.runtimes ?? [], glossary: input.sheet.glossary ?? [] } : undefined,
    sheetError: input.sheetError,
    preview: input.preview && input.preview.derived.picks.some(p => p.changed) ? previewState(input.preview, map, input.selection) : undefined,
    board: input.board,
    boardError: input.boardError,
    git: input.git,
    workOrders: input.workOrders,
    toolkit: input.toolkit
  };
}
