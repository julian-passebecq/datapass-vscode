/**
 * The project map (V3): one model behind the Project tree, the Workbench, the architecture
 * diagram and the AI preparation pack. Pure and deterministic.
 *
 *   project ─► sub-projects (scopes) ─► components (graph items) ─► expected files ─► operations
 *
 * Every state shown comes from a declaration plus an observation: a component the AI declared as
 * "prepared" still shows its missing files; an operation is ready only when its own files, tools,
 * target and reviews are there.
 */
import type { DataPassProjectManifest, EnvironmentDecl, WorkScope } from "../projectManifestModel";
import type { GraphItem, ProjectGraph, GraphRelation, OperationDecl } from "../workspace/graph";
import { CAPABILITIES, CAPABILITY_INDEX, PHASES, type CapabilityRecord, type Phase } from "../capabilities/registry";
import { preflight, type FactNote, type PreflightResult, type SubjectRequirement } from "../capabilities/preflight";
import { TOOL_INDEX, type ToolObservation } from "../capabilities/tools";
import { disabledProviders, moduleOfProvider } from "../modules";
import { providerInfo, type ProviderInfo } from "./providers";
import { artifactsOf, componentRepoKey, resolveArtifacts, resolveRepositories, type ArtifactView, type FileObservation, type RepoObservation, type RepoView } from "./resolve";
import { findQualification, type QualificationRecord } from "../qualification/qualification";
import type { ChecklistRecord, ChecklistState } from "../work/workModel";

export interface ProjectMapInput {
  manifest?: DataPassProjectManifest;
  graph?: ProjectGraph;
  coordinationKey: string;
  repoObservations: ReadonlyMap<string, RepoObservation>;
  fileObservations: ReadonlyMap<string, FileObservation>;
  tools: ReadonlyMap<string, ToolObservation>;
  facts: ReadonlyMap<string, string | boolean | undefined>;
  factNotes?: ReadonlyMap<string, FactNote>;
  reviewsConfirmed: ReadonlySet<string>;
  checklist: Readonly<Record<string, ChecklistRecord>>;
  qualification: readonly QualificationRecord[];
}

export type Health = "ok" | "attention" | "blocked" | "planned" | "info";

export interface MapChecklistEntry { key: string; id: string; label: string; state: ChecklistState; note?: string; at?: string; capabilityRef?: string }

export interface OperationView {
  /** component:capability@environment */
  key: string;
  componentId: string;
  capability: CapabilityRecord;
  phase: Phase;
  label: string;
  source: "declared" | "profile";
  environment?: EnvironmentDecl;
  environmentId?: string;
  target?: Record<string, string>;
  result: PreflightResult;
  /** For copy-command operations: the command, run from `cwd` (relative to the repository). */
  command?: { text: string; cwd: string };
  lastResult?: { result: QualificationRecord["result"]; at: string; stale: boolean; note?: string };
}

export interface RelationView { id: string; source: string; target: string; relation: GraphRelation["relation"]; from: string; to: string; flow: "data" | "control" | "dependency" | "deployment" }

export interface DocView { label: string; repoKey?: string; path?: string; url?: string }

export interface ComponentView {
  id: string;
  label: string;
  kind: GraphItem["kind"];
  description?: string;
  providerId?: string;
  provider?: ProviderInfo;
  status?: GraphItem["status"];
  owner?: string;
  classification?: GraphItem["classification"];
  subprojects: string[];
  parent?: string;
  children: string[];
  repoKey?: string;
  artifacts?: ArtifactView;
  operations: OperationView[];
  checklist: MapChecklistEntry[];
  docs: DocView[];
  incoming: RelationView[];
  outgoing: RelationView[];
  problems: string[];
  health: Health;
  headline: string;
  nextStep: string;
}

export interface ToolNeed { id: string; label: string; toolIds: string[]; extensionIds: string[]; neededFor: string[] }

export interface SubprojectView {
  id: string;
  title: string;
  objective?: string;
  implicit: boolean;
  repoKey?: string;
  docs: DocView[];
  componentIds: string[];
  checklist: MapChecklistEntry[];
  needs: { repositories: RepoView[]; tools: ToolNeed[]; missingFiles: number; generationNeeded: number };
  summary: { components: number; filesExpected: number; filesFound: number; opsReady: number; opsTotal: number };
  health: Health;
  nextStep: string;
}

export interface MapProblem { severity: "error" | "warning" | "info"; where: string; message: string }

export interface ProjectMap {
  project?: { id: string; title: string; description?: string; schemaVersion: number; graphVersion?: string };
  coordinationKey: string;
  environments: EnvironmentDecl[];
  docs: DocView[];
  repositories: RepoView[];
  subprojects: SubprojectView[];
  components: ComponentView[];
  relations: RelationView[];
  problems: MapProblem[];
  summary: { components: number; filesExpected: number; filesFound: number; filesMissing: number; reposToBind: number; opsReady: number; opsTotal: number };
  nextStep: string;
}

export const OTHER_SUBPROJECT = "other-components";
const DEPLOYISH: ReadonlySet<Phase> = new Set(["deploy", "run", "publish"]);

export function componentChecklistKey(componentId: string, itemId: string): string {
  return `component:${componentId}/${itemId}`;
}

export function operationKey(componentId: string, capabilityId: string, environment?: string): string {
  return `${componentId}:${capabilityId}@${environment ?? "-"}`;
}

function relationView(r: GraphRelation): RelationView {
  switch (r.relation) {
    case "consumes": return { ...r, from: r.target, to: r.source, flow: "data" };
    case "produces": case "feeds": return { ...r, from: r.source, to: r.target, flow: "data" };
    case "invokes": case "orchestrates": return { ...r, from: r.source, to: r.target, flow: "control" };
    case "dependsOn": case "derivedFrom": return { ...r, from: r.target, to: r.source, flow: "dependency" };
    case "deployedFrom": return { ...r, from: r.target, to: r.source, flow: "deployment" };
    case "runsOn": return { ...r, from: r.source, to: r.target, flow: "deployment" };
    default: return { ...r, from: r.source, to: r.target, flow: "dependency" };
  }
}

/** Where a component's copy-command runs, relative to its repository. */
function commandFor(cap: CapabilityRecord, artifacts: ArtifactView | undefined, target: Record<string, string> | undefined, environment: string | undefined): OperationView["command"] {
  const template = artifacts?.profile.commands?.[cap.id];
  if (!template || !artifacts) return undefined;
  const t = target?.bundleTarget ?? environment ?? "dev";
  return { text: template.replace(/\{target\}/g, t), cwd: artifacts.root };
}

/**
 * The repository of each component that has files: its own repoRef, else the single repoRef of the
 * scopes containing it (containment inherited), else the coordination repository. Used both to plan
 * observations and to build the map, so both always agree.
 */
export function componentRepositories(manifest: DataPassProjectManifest | undefined, graph: ProjectGraph | undefined, coordinationKey: string): Array<{ item: GraphItem; repoKey: string }> {
  const scopes = manifest?.scopes ?? [];
  const children = new Map<string, string[]>();
  for (const r of graph?.relations ?? []) if (r.relation === "contains") (children.get(r.source) ?? children.set(r.source, []).get(r.source)!).push(r.target);
  const scopeRepos = new Map<string, Set<string>>();
  const mark = (id: string, repo: string, depth = 0) => {
    if (depth > 20) return;
    (scopeRepos.get(id) ?? scopeRepos.set(id, new Set()).get(id)!).add(repo);
    for (const c of children.get(id) ?? []) mark(c, repo, depth + 1);
  };
  for (const s of scopes) if (s.repoRef) for (const ref of s.itemRefs ?? []) mark(ref, s.repoRef);
  const out: Array<{ item: GraphItem; repoKey: string }> = [];
  for (const item of graph?.items ?? []) {
    if (!artifactsOf(item) && !item.repoRef) continue;
    const repos = [...(scopeRepos.get(item.id) ?? [])];
    out.push({ item, repoKey: componentRepoKey(item, repos.length === 1 ? repos[0] : undefined, coordinationKey) });
  }
  return out;
}

export function buildProjectMap(input: ProjectMapInput): ProjectMap {
  const m = input.manifest;
  const g = input.graph;
  const problems: MapProblem[] = [];
  const scopes: WorkScope[] = m?.scopes ?? [];
  const items = g?.items ?? [];
  const itemIndex = new Map(items.map(i => [i.id, i]));
  const envs = new Map((m?.environments ?? []).map(e => [e.id, e]));
  const repoKeys = new Set([input.coordinationKey, ...Object.keys(m?.repositories ?? {})]);
  const off = disabledProviders(m);

  // ---- containment: children inherit their parent's sub-projects
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const r of g?.relations ?? []) if (r.relation === "contains") { (children.get(r.source) ?? children.set(r.source, []).get(r.source)!).push(r.target); parentOf.set(r.target, r.source); }
  const scopesOf = new Map<string, Set<string>>();
  const addScope = (itemId: string, scopeId: string, depth = 0) => {
    if (depth > 20) return;
    (scopesOf.get(itemId) ?? scopesOf.set(itemId, new Set()).get(itemId)!).add(scopeId);
    for (const c of children.get(itemId) ?? []) addScope(c, scopeId, depth + 1);
  };
  for (const s of scopes) {
    for (const ref of s.itemRefs ?? []) {
      if (!itemIndex.has(ref)) problems.push({ severity: "error", where: `project.json scopes.${s.id}`, message: `itemRefs names "${ref}", which is not an item of the graph.` });
      else addScope(ref, s.id);
    }
  }
  // ---- repositories (with usage)
  const repoOf = new Map<string, string>();
  const usage = new Map<string, string[]>();
  for (const { item, repoKey: key } of componentRepositories(m, g, input.coordinationKey)) {
    repoOf.set(item.id, key);
    (usage.get(key) ?? usage.set(key, []).get(key)!).push(item.id);
    if (!repoKeys.has(key)) problems.push({ severity: "error", where: `graph.json items.${item.id}`, message: `repoRef "${key}" is not a repository declared in project.json.` });
  }
  const repositories = resolveRepositories(m, input.repoObservations, input.coordinationKey, usage);
  const repoIndex = new Map(repositories.map(r => [r.key, r]));

  const relations = (g?.relations ?? []).filter(r => r.relation !== "contains" && r.relation !== "supersedes").map(relationView);
  const projectId = m?.project.id ?? "project";

  // ---- components
  const components: ComponentView[] = items.map(item => {
    const cproblems: string[] = [];
    const provider = providerInfo(item.provider);
    if (item.provider && !provider) cproblems.push(`provider "${item.provider}" is not known to this DataPass version; only its files are shown`);
    else if (provider?.support === "unsupported") cproblems.push(`${provider.label}: DataPass has no operations for this service yet (files only)`);
    const decl = artifactsOf(item);
    const repoKey = repoOf.get(item.id);
    const artifacts = decl && repoKey ? resolveArtifacts(item, decl, repoKey, repoIndex.get(repoKey), input.fileObservations) : undefined;
    if (artifacts) cproblems.push(...artifacts.issues);

    // Operations: declared ones, else the profile's (or the provider's) usual operations.
    const declared: Array<OperationDecl & { source: "declared" | "profile" }> = (item.operations ?? []).map(o => ({ ...o, source: "declared" }));
    let wanted: Array<OperationDecl & { source: "declared" | "profile" }>;
    if (declared.length) {
      wanted = [...(artifacts && !declared.some(d => d.capability === "generic.files.open") ? [{ capability: "generic.files.open", source: "profile" as const }] : []), ...declared];
    } else {
      const ids = artifacts ? artifacts.profile.operations : provider?.capabilityProvider ? CAPABILITIES.filter(c => c.provider === provider.capabilityProvider).map(c => c.id) : [];
      wanted = ids.map(id => ({ capability: id, source: "profile" as const }));
    }
    const operations: OperationView[] = [];
    for (const want of wanted) {
      const cap = CAPABILITY_INDEX.get(want.capability);
      if (!cap) { cproblems.push(`operation "${want.capability}" is not known to this DataPass version (unsupported)`); continue; }
      if (off.has(cap.provider)) { if (want.source === "declared") cproblems.push(`operation "${cap.id}" is hidden: the ${moduleOfProvider(cap.provider)?.label ?? cap.provider} module is switched off`); continue; }
      if (want.source === "declared" && provider?.capabilityProvider && cap.provider !== provider.capabilityProvider && cap.provider !== "generic" && cap.provider !== "python") {
        cproblems.push(`operation "${cap.id}" belongs to ${cap.provider}, but the component is ${provider.label}`);
      }
      const env = want.environment ? envs.get(want.environment) : undefined;
      if (want.environment && !env) cproblems.push(`operation "${cap.id}" names environment "${want.environment}", which project.json does not declare`);
      const requirements: SubjectRequirement[] = [];
      if (cap.localFiles !== false && artifacts) {
        const repo = repoIndex.get(artifacts.repoKey);
        const rname = repo?.label ?? artifacts.repoKey;
        if (!repo || repo.state === "planned") requirements.push({ kind: "repository", id: artifacts.repoKey, label: `Repository ${rname}`, state: "missing", detail: `Repository "${rname}" is planned and does not exist yet: create it, then clone it here.` });
        else if (repo.state === "restricted") requirements.push({ kind: "repository", id: repo.key, label: `Repository ${rname}`, state: "unknown", detail: "Restricted Mode: trust this workspace so DataPass can read the repository." });
        else if (repo.state === "unbound" || repo.state === "missing" || repo.state === "wrong-remote") requirements.push({ kind: "repository", id: repo.key, label: `Repository ${rname}`, state: "missing", detail: repo.nextStep ?? repo.detail });
        else {
          requirements.push({ kind: "repository", id: repo.key, label: `Repository ${rname}`, state: "ok", detail: repo.detail });
          for (const f of artifacts.files) {
            if (!f.requiredFor.includes(cap.phase)) continue;
            const where = `${rname}/${f.repoPath}`;
            if (f.state === "found") requirements.push({ kind: "file", id: f.repoPath, label: f.path, state: "ok", detail: where });
            else if (f.state === "missing") requirements.push({ kind: "file", id: f.repoPath, label: f.path, state: "missing", detail: f.generated ? `${f.path} has not been generated: produce it with ${f.generated.producer}${f.generated.how ? ` (${f.generated.how})` : ""}, then re-inspect.` : `${f.path} is missing in ${where} (needed to ${cap.phase}). Ask the AI to prepare it, or add it yourself.` });
            else requirements.push({ kind: "file", id: f.repoPath, label: f.path, state: "unknown", detail: `${where} could not be checked.` });
          }
        }
      }
      if (DEPLOYISH.has(cap.phase)) {
        if (!want.environment) requirements.push({ kind: "target", id: "environment", label: "Environment", state: "missing", detail: `Say which environment this ${cap.phase} targets: give the operation an "environment" (for example dev) in graph.json, declared in project.json environments.` });
        else if (!env) requirements.push({ kind: "target", id: "environment", label: `Environment ${want.environment}`, state: "missing", detail: `Declare environment "${want.environment}" in project.json environments.` });
        else requirements.push({ kind: "target", id: "environment", label: `Environment ${env.title ?? env.id}${env.production ? " (production)" : ""}`, state: "ok", detail: env.production ? "Production: mistakes affect real users or data." : "Declared environment." });
      }
      // Facts that a component answers itself (its own bundle folder, its declared target names).
      const facts = new Map(input.facts);
      const notes = new Map(input.factNotes ?? []);
      const target = want.target;
      if (artifacts) {
        const entryFound = artifacts.entry?.state === "found" || (!artifacts.entry && artifacts.availability === "complete");
        const own = (fact: string, value: string | boolean | undefined) => { facts.set(fact, value); notes.delete(fact); };
        if (cap.provider === "databricks") own("databricks.bundleRoot", entryFound ? true : undefined);
        if (cap.id === "infra.tofu.plan") own("infrastructure.root", artifacts.availability === "complete" ? true : undefined);
        if (cap.provider === "powerbi") { own("powerbi.pbip", entryFound ? true : undefined); }
      }
      if (cap.provider === "databricks" && (target?.bundleTarget ?? want.environment)) facts.set("databricks.target", target?.bundleTarget ?? want.environment);
      if (cap.provider === "fabric" && target?.workspace) { facts.set("fabric.workspace", target.workspace); facts.set("fabric.workspaceName", target.workspace); }
      const key = operationKey(item.id, cap.id, want.environment);
      const result = preflight(cap, {
        tools: input.tools, facts, factNotes: notes, reviewsConfirmed: input.reviewsConfirmed,
        subject: { key, environment: want.environment, target, artifactDigest: artifacts?.digest, requirements }
      });
      // The result for exactly this target and these files; otherwise the latest one for this operation, shown as stale.
      const exact = findQualification(input.qualification, { projectId, scopeId: "project", capabilityId: cap.id, operationKey: key, targetDigest: result.targetDigest });
      const q = exact ?? input.qualification.find(r => r.projectId === projectId && r.operationKey === key);
      operations.push({
        key, componentId: item.id, capability: cap, phase: cap.phase, label: want.label ?? cap.label, source: want.source,
        environment: env, environmentId: want.environment, target, result,
        command: cap.actionMode === "copy-command" ? commandFor(cap, artifacts, target, want.environment) : undefined,
        lastResult: q ? { result: q.result, at: q.at, note: q.note, stale: !exact } : undefined
      });
    }
    operations.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));

    const checklist: MapChecklistEntry[] = (item.checklist ?? []).map(c => {
      const key = componentChecklistKey(item.id, c.id);
      const rec = input.checklist[key];
      return { key, id: c.id, label: c.label, state: rec?.state ?? "todo", note: rec?.note, at: rec?.at, capabilityRef: c.capabilityRef };
    });
    const docs: DocView[] = (item.docs ?? []).map(d => ({ label: d.label, url: d.url, path: d.path, repoKey: d.path ? d.repoRef ?? repoKey ?? input.coordinationKey : undefined }));
    for (const d of item.docs ?? []) if (d.repoRef && !repoKeys.has(d.repoRef)) cproblems.push(`doc "${d.label}" names repository "${d.repoRef}", which is not declared`);

    const { health, headline, nextStep } = summarizeComponent(item, artifacts, operations, repoOf.get(item.id) ? repoIndex.get(repoOf.get(item.id)!) : undefined, provider);
    return {
      id: item.id, label: item.label, kind: item.kind, description: item.description, providerId: item.provider, provider, status: item.status,
      owner: item.owner, classification: item.classification, subprojects: [...(scopesOf.get(item.id) ?? [])], parent: parentOf.get(item.id), children: children.get(item.id) ?? [],
      repoKey, artifacts, operations, checklist, docs,
      incoming: relations.filter(r => r.to === item.id), outgoing: relations.filter(r => r.from === item.id),
      problems: cproblems, health, headline, nextStep
    };
  });
  for (const c of components) for (const p of c.problems) problems.push({ severity: /not known|not declared|does not declare|is committed|not a relative path|belongs to/.test(p) ? "warning" : "info", where: `graph.json items.${c.id}`, message: p });
  const byId = new Map(components.map(c => [c.id, c]));

  // ---- sub-projects
  const sub = (scope: WorkScope | undefined, ids: string[]): SubprojectView => {
    const comps = ids.map(id => byId.get(id)!).filter(Boolean);
    const checklist: MapChecklistEntry[] = (scope?.checklist ?? []).map(c => {
      const key = `${scope!.id}/${c.id}`;
      const rec = input.checklist[key];
      return { key, id: c.id, label: c.label, state: rec?.state ?? "todo", note: rec?.note, at: rec?.at, capabilityRef: c.capabilityRef };
    });
    const repoSet = new Map<string, RepoView>();
    for (const c of comps) if (c.repoKey) { const r = repoIndex.get(c.repoKey); if (r && r.state !== "local" && r.state !== "not-a-repo") repoSet.set(r.key, r); }
    const tools = toolNeeds(comps, input.tools);
    const ops = comps.flatMap(c => c.operations);
    const summary = {
      components: comps.length,
      filesExpected: comps.reduce((n, c) => n + (c.artifacts?.summary.expected ?? 0), 0),
      filesFound: comps.reduce((n, c) => n + (c.artifacts?.summary.found ?? 0), 0),
      opsReady: ops.filter(o => o.result.status === "ready").length,
      opsTotal: ops.length
    };
    const missingFiles = comps.reduce((n, c) => n + (c.artifacts?.summary.missing ?? 0), 0);
    const generationNeeded = comps.reduce((n, c) => n + (c.artifacts?.summary.generatedMissing ?? 0), 0);
    const repos = [...repoSet.values()];
    const health: Health = repos.some(r => r.state === "planned") && !summary.filesFound ? "planned"
      : repos.length || missingFiles ? "attention"
      : comps.some(c => c.health === "blocked") ? "attention"
      : "ok";
    const open = checklist.find(c => c.state === "blocked" || c.state === "problem") ?? checklist.find(c => c.state === "todo");
    const firstComp = comps.find(c => c.health !== "ok" && c.health !== "info");
    const nextStep = repos[0]?.nextStep ? `${repos[0].label}: ${repos[0].nextStep}`
      : missingFiles && firstComp ? `${firstComp.label}: ${firstComp.nextStep}`
      : open ? `${open.label}${open.state !== "todo" ? ` (${open.state})` : ""}`
      : firstComp ? `${firstComp.label}: ${firstComp.nextStep}`
      : comps.length ? "Everything declared here is present. Pick an operation to run in its native tool." : "Add components to this sub-project (itemRefs) in project.json.";
    return {
      id: scope?.id ?? OTHER_SUBPROJECT, title: scope?.title ?? (scopes.length ? "Other components" : m ? `${m.project.title} (whole project)` : "Project"),
      objective: scope?.objective, implicit: !scope, repoKey: scope?.repoRef,
      docs: (scope?.docs ?? []).map(d => ({ label: d.label, url: d.url, path: d.path, repoKey: d.path ? d.repoRef ?? scope?.repoRef ?? input.coordinationKey : undefined })),
      componentIds: comps.map(c => c.id), checklist,
      needs: { repositories: repos, tools, missingFiles, generationNeeded },
      summary, health, nextStep
    };
  };
  const subprojects = scopes.map(s => sub(s, items.filter(i => scopesOf.get(i.id)?.has(s.id)).map(i => i.id)));
  const orphans = items.filter(i => !scopesOf.has(i.id)).map(i => i.id);
  if (orphans.length || !scopes.length) subprojects.push(sub(undefined, orphans.length ? orphans : items.map(i => i.id)));
  if (scopes.length && orphans.length) problems.push({ severity: "info", where: "graph.json", message: `${orphans.length} component(s) belong to no sub-project (scope itemRefs): ${orphans.slice(0, 8).join(", ")}${orphans.length > 8 ? "…" : ""}.` });
  if (scopes.some(s => s.itemRefs?.length) && !g) problems.push({ severity: "warning", where: "project.json", message: "Scopes list components (itemRefs) but no graph was loaded (.datapass/graph.json)." });

  const all = components.flatMap(c => c.operations);
  const summary = {
    components: components.length,
    filesExpected: components.reduce((n, c) => n + (c.artifacts?.summary.expected ?? 0), 0),
    filesFound: components.reduce((n, c) => n + (c.artifacts?.summary.found ?? 0), 0),
    filesMissing: components.reduce((n, c) => n + (c.artifacts?.summary.missing ?? 0), 0),
    reposToBind: repositories.filter(r => r.state !== "local" && r.state !== "not-a-repo" && r.usedBy.length).length,
    opsReady: all.filter(o => o.result.status === "ready").length,
    opsTotal: all.length
  };
  const unboundUsed = repositories.find(r => r.state !== "local" && r.state !== "not-a-repo" && r.state !== "planned" && r.usedBy.length);
  const nextStep = !m ? "Initialize a project manifest (.datapass/project.json)."
    : !items.length ? "Describe the architecture in .datapass/graph.json (components, their repository and files), or ask the AI to prepare it."
    : unboundUsed ? `${unboundUsed.label}: ${unboundUsed.nextStep ?? unboundUsed.detail}`
    : subprojects.find(s => s.health !== "ok")?.nextStep ?? "Everything declared is present. Pick a component and an operation.";

  return {
    project: m ? { id: m.project.id, title: m.project.title, description: m.project.description, schemaVersion: m.schemaVersion, graphVersion: g?.version } : undefined,
    coordinationKey: input.coordinationKey,
    environments: m?.environments ?? [],
    docs: (m?.docs ?? []).map(d => ({ label: d.label, url: d.url, path: d.path, repoKey: d.path ? d.repoRef ?? input.coordinationKey : undefined })),
    repositories, subprojects, components, relations, problems, summary, nextStep
  };
}

function summarizeComponent(item: GraphItem, a: ArtifactView | undefined, ops: OperationView[], repo: RepoView | undefined, provider: ProviderInfo | undefined): { health: Health; headline: string; nextStep: string } {
  const ready = ops.filter(o => o.result.status === "ready");
  const phaseWord = (o: OperationView) => o.phase;
  const firstBlocked = ops.find(o => o.result.status === "blocked" || o.result.status === "needs-config");
  // "3/4 files" when files are required; otherwise count what is there (all files optional).
  const foundAny = a ? a.files.filter(f => f.state === "found").length : 0;
  const files = a ? (a.summary.expected ? `${a.summary.found}/${a.summary.expected} files` : foundAny ? `${foundAny} file${foundAny === 1 ? "" : "s"}` : "no required file") : undefined;
  if (a?.availability === "planned-repo") return { health: "planned", headline: "repository planned", nextStep: repo?.nextStep ?? "Create the repository, then clone it." };
  if (a?.availability === "unbound") return { health: "attention", headline: "repository not cloned here", nextStep: repo?.nextStep ?? "Clone or locate the repository." };
  if (a?.availability === "restricted") return { health: "info", headline: "not inspected (Restricted Mode)", nextStep: "Trust this workspace to inspect its files." };
  if (repo && (repo.state === "missing" || repo.state === "wrong-remote")) return { health: "attention", headline: repo.detail, nextStep: repo.nextStep ?? repo.detail };
  if (a && a.summary.missing) {
    const missing = a.files.filter(f => !f.optional && f.state === "missing" && f.source !== "generated").map(f => f.path);
    return { health: "blocked", headline: `${files} · missing ${missing.slice(0, 2).join(", ")}${missing.length > 2 ? "…" : ""}`, nextStep: `Missing: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}. Ask the AI to prepare ${missing.length === 1 ? "it" : "them"} in the repository, then get the update.` };
  }
  if (a?.availability === "generation-needed") {
    const g = a.files.find(f => f.source === "generated" && f.state === "missing")!;
    return { health: "attention", headline: `${files} · ${g.path} not generated`, nextStep: `Generate ${g.path} with ${g.generated?.producer ?? "its producer"}, then re-inspect.` };
  }
  if (!a && item.status === "planned") return { health: "planned", headline: "planned", nextStep: "Declare its repository and files (artifacts) in graph.json when it is prepared." };
  if (!a && !ops.length) {
    return { health: "info", headline: provider?.support === "unsupported" ? "not supported yet" : item.status ? `declared ${item.status}` : "no files or operations declared", nextStep: provider?.support === "unsupported" ? `${provider.label} has no DataPass operations yet.` : "No files or operations declared for this component." };
  }
  const readyText = ready.length ? `${ready.map(phaseWord).filter((p, i, arr) => arr.indexOf(p) === i).join(", ")} ready` : "no operation ready";
  if (firstBlocked) return { health: ready.length ? "attention" : "blocked", headline: [files, readyText].filter(Boolean).join(" · "), nextStep: `${firstBlocked.label}: ${firstBlocked.result.nextStep}` };
  const review = ops.find(o => o.result.status === "needs-review" || o.result.status === "unknown");
  // Nothing ready and something that could not be checked: not green.
  if (!ready.length && review) return { health: "info", headline: [files, readyText].filter(Boolean).join(" · "), nextStep: `${review.label}: ${review.result.nextStep}` };
  return { health: "ok", headline: [files, readyText].filter(Boolean).join(" · "), nextStep: review ? `${review.label}: ${review.result.nextStep}` : ready[0] ? `${ready[0].label}: ready.` : "Nothing to do." };
}

/** Tools missing for the operations of these components, grouped by requirement. */
function toolNeeds(comps: ComponentView[], tools: ReadonlyMap<string, ToolObservation>): ToolNeed[] {
  const needs = new Map<string, ToolNeed>();
  for (const c of comps) {
    for (const o of c.operations) {
      for (const req of o.capability.requirements) {
        if (req.need !== "required") continue;
        if (req.anyOf.some(id => tools.get(id)?.state === "present")) continue;
        const id = req.anyOf.join("|");
        const n = needs.get(id) ?? {
          id, label: req.anyOf.map(t => TOOL_INDEX.get(t)?.label ?? t).join(" or "), toolIds: [...req.anyOf],
          extensionIds: req.anyOf.map(t => TOOL_INDEX.get(t)?.extensionIds?.[0]).filter((x): x is string => !!x), neededFor: []
        };
        const what = `${c.label}: ${o.phase}`;
        if (!n.neededFor.includes(what)) n.neededFor.push(what);
        needs.set(id, n);
      }
    }
  }
  return [...needs.values()];
}
