/**
 * The Work model: what the Work tree shows for the selected scope. Pure and deterministic
 * so it can be tested without VS Code. It answers, in order:
 *   what are we trying to do (scope + objective) → what is next (checklist + preflight)
 *   → which operations are ready → which outputs are affected → which apps/exchanges exist.
 *
 * Checklist states are user-reported notes, never execution evidence.
 */
import type { PackStamp } from "../project/packStamp";
import type { AppDescriptor, DataPassProjectManifest, RepositoryBinding, WorkScope } from "../projectManifestModel";
import type { ProjectGraph } from "../workspace/graph";
import { resolveOutputs } from "../workspace/graph";
import type { DomainPack } from "../domainPacks/pack";
import { CAPABILITIES, CAPABILITY_INDEX, type CapabilityRecord } from "../capabilities/registry";
import { preflight, type FactNote, type PreflightResult } from "../capabilities/preflight";
import type { ToolObservation } from "../capabilities/tools";
import { analyzeImpact, type ImpactEntry } from "../impact/facets";
import { buildProgramme, type ProgrammeView } from "../programme/programme";
import type { RemoteObservation } from "../workspace/gitBase";
import { disabledProviders, moduleOfProvider } from "../modules";

export const CHECKLIST_STATES = ["todo", "done", "blocked", "problem", "skipped"] as const;
export type ChecklistState = typeof CHECKLIST_STATES[number];

export interface ChecklistRecord { state: ChecklistState; note?: string; at: string }

export type ExchangeKind = "app-request" | "app-result" | "candidate" | "brief" | "output-manifest" | "authority-snapshot" | "diagramcloud" | "ai-context";

export interface ExchangeRecord {
  id: string;
  kind: ExchangeKind;
  label: string;
  status: string;
  /** Path relative to the workspace root (always under .datapass/local). */
  file?: string;
  digest?: string;
  scopeRef: string;
  at: string;
  /** 0.27 (P1, D-23): an AI pack's selected variant and environment when it was copied (the AI view marks it stale when they change). */
  stamp?: PackStamp;
}

export interface WorkModelInput {
  manifest?: DataPassProjectManifest;
  graph?: ProjectGraph;
  packs: DomainPack[];
  tools: ReadonlyMap<string, ToolObservation>;
  facts: ReadonlyMap<string, string | boolean | undefined>;
  /** Declared-but-not-found and uncheckable file-backed facts (see workspace/facts.ts). */
  factNotes?: ReadonlyMap<string, FactNote>;
  reviewsConfirmed: ReadonlySet<string>;
  /** v5: tools present here whose version is outside the project's range (preflight warnings). */
  toolRangeWarnings?: ReadonlyMap<string, string>;
  selectedScopeId?: string;
  checklist: Readonly<Record<string, ChecklistRecord>>;
  impact?: ImpactEntry[];
  appObservations: Readonly<Record<string, RemoteObservation>>;
  exchanges: readonly ExchangeRecord[];
}

export interface WorkChecklistEntry {
  key: string;
  id: string;
  label: string;
  state: ChecklistState;
  note?: string;
  at?: string;
  capabilityRef?: string;
  preflight?: PreflightResult;
}

export interface WorkOperation { capability: CapabilityRecord; result: PreflightResult }

export interface WorkApp {
  app: AppDescriptor;
  repo?: RepositoryBinding;
  observation?: RemoteObservation;
  issue?: string;
}

export interface WorkModel {
  project?: { id: string; title: string; description?: string };
  scopes: WorkScope[];
  scope: WorkScope;
  scopeSource: "declared" | "implicit";
  checklist: WorkChecklistEntry[];
  operations: WorkOperation[];
  outputs: ImpactEntry[];
  apps: WorkApp[];
  programme: ProgrammeView[];
  exchanges: ExchangeRecord[];
  problems: string[];
  nextStep: string;
  progress: { done: number; total: number };
}

export const IMPLICIT_SCOPE_ID = "project";

export function checklistKey(scopeId: string, itemId: string): string {
  return `${scopeId}/${itemId}`;
}

/** Providers the project actually declares; used when a scope names no capabilities. */
export function relevantProviders(m: DataPassProjectManifest | undefined, graph: ProjectGraph | undefined): Set<CapabilityRecord["provider"]> {
  const out = new Set<CapabilityRecord["provider"]>();
  const p = m?.platforms ?? {};
  if (p.fabric) out.add("fabric");
  if (p.databricks || m?.repositories?.databricks) out.add("databricks");
  if (p.powerbi) out.add("powerbi");
  if (p.grafana) out.add("grafana");
  if (p.infrastructure || p.oracle || m?.resources?.length) out.add("infrastructure");
  if (p.airflow) out.add("airflow");
  if (m?.apps?.length) out.add("apps");
  if (graph?.items.length) out.add("diagram");
  for (const off of disabledProviders(m)) out.delete(off);
  return out;
}

export function buildWorkModel(input: WorkModelInput): WorkModel {
  const m = input.manifest;
  const problems: string[] = [];
  const scopes = m?.scopes ?? [];
  // "Whole project" is an explicit choice, not a missing one: it must not fall back to the first scope.
  const declared = scopes.find(s => s.id === input.selectedScopeId) ?? (input.selectedScopeId === IMPLICIT_SCOPE_ID ? undefined : scopes[0]);
  if (input.selectedScopeId && input.selectedScopeId !== IMPLICIT_SCOPE_ID && !scopes.some(s => s.id === input.selectedScopeId)) {
    problems.push(`Selected scope "${input.selectedScopeId}" is no longer declared; showing ${declared ? `"${declared.id}"` : "the whole project"}.`);
  }
  const scope: WorkScope = declared ?? {
    id: IMPLICIT_SCOPE_ID,
    title: m ? `${m.project.title} (whole project)` : "No project manifest",
    objective: m?.project.description
  };

  const ctx = { tools: input.tools, facts: input.facts, factNotes: input.factNotes, reviewsConfirmed: input.reviewsConfirmed, toolRangeWarnings: input.toolRangeWarnings };

  // Operations: declared capabilityRefs first, then those referenced by checklist items.
  const refs = new Set<string>(scope.capabilityRefs ?? []);
  for (const c of scope.checklist ?? []) if (c.capabilityRef) refs.add(c.capabilityRef);
  let caps: CapabilityRecord[];
  if (refs.size) {
    caps = [];
    const off = disabledProviders(m);
    for (const r of refs) {
      const cap = CAPABILITY_INDEX.get(r);
      if (!cap) problems.push(`Scope "${scope.id}" references unknown capability "${r}".`);
      else if (off.has(cap.provider)) problems.push(`Scope "${scope.id}" uses "${r}", but the ${moduleOfProvider(cap.provider)?.label ?? cap.provider} module is switched off for this project.`);
      else caps.push(cap);
    }
  } else {
    const providers = relevantProviders(m, input.graph);
    caps = CAPABILITIES.filter(c => providers.has(c.provider));
  }
  const operations: WorkOperation[] = caps.map(capability => ({ capability, result: preflight(capability, ctx) }));
  const byCap = new Map(operations.map(o => [o.capability.id, o.result]));

  const checklist: WorkChecklistEntry[] = (scope.checklist ?? []).map(item => {
    const key = checklistKey(scope.id, item.id);
    const rec = input.checklist[key];
    return {
      key, id: item.id, label: item.label,
      state: rec?.state ?? "todo", note: rec?.note, at: rec?.at,
      capabilityRef: item.capabilityRef,
      preflight: item.capabilityRef ? byCap.get(item.capabilityRef) : undefined
    };
  });

  const pack = input.packs[0];
  if (input.packs.length > 1) problems.push(`Several domain packs are declared; the Programme view uses ${pack!.namespace}.`);
  const outputs = input.impact ?? analyzeImpact(resolveOutputs(input.graph, pack), new Map());
  const programme = buildProgramme(input.graph?.items ?? [], pack, outputs);

  const apps: WorkApp[] = (m?.apps ?? []).map(app => {
    const repo = m?.repositories?.[app.repoRef];
    const issue = !repo ? `Repository "${app.repoRef}" is not declared.`
      : !repo.remote?.url && !repo.path ? "Repository has neither a local path nor a remote." : undefined;
    return { app, repo, observation: input.appObservations[app.id], issue };
  });

  const exchanges = input.exchanges.filter(e => e.scopeRef === scope.id).slice().sort((a, b) => b.at.localeCompare(a.at));
  const done = checklist.filter(c => c.state === "done" || c.state === "skipped").length;

  return {
    project: m ? { id: m.project.id, title: m.project.title, description: m.project.description } : undefined,
    scopes, scope, scopeSource: declared ? "declared" : "implicit",
    checklist, operations, outputs, apps, programme, exchanges, problems,
    nextStep: nextStepFor(m, checklist, operations, outputs),
    progress: { done, total: checklist.length }
  };
}

function nextStepFor(m: DataPassProjectManifest | undefined, checklist: WorkChecklistEntry[], ops: WorkOperation[], outputs: ImpactEntry[]): string {
  if (!m) return "Initialize a project manifest (.datapass/project.json).";
  const blocked = checklist.find(c => c.state === "blocked" || c.state === "problem");
  if (blocked) return `Resolve "${blocked.label}" (${blocked.state}${blocked.note ? `: ${blocked.note}` : ""}).`;
  const open = checklist.find(c => c.state === "todo");
  if (open) {
    if (open.preflight && open.preflight.status !== "ready") return `${open.label}: ${open.preflight.nextStep}`;
    return `${open.label}${open.preflight ? ` — ${open.preflight.nextStep}` : ""}`;
  }
  const stale = outputs.find(o => o.state === "stale" || o.state === "stale-upstream");
  if (stale) return `Regenerate or review stale output "${stale.label}" with its producer.`;
  const notReady = ops.find(o => o.result.status === "blocked" || o.result.status === "needs-config");
  if (notReady) return `${notReady.capability.label}: ${notReady.result.nextStep}`;
  if (checklist.length) return "Checklist complete (user-reported). Record evidence or select the next scope.";
  return m.scopes?.length ? "Add checklist items to this scope in .datapass/project.json." : "Declare a work scope with an objective and checklist (manifest schemaVersion 2).";
}
