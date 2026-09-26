/**
 * Variants (0.23, plan D-15/D-16): how far each architecture option and scenario is coded.
 *
 * A variant (version, proposal, alternative) is an option of a decision in options.json and a named
 * combination is a scenario: no new concept. Each option says which components it adds, replaces or
 * removes, and each component names its repository and files, so the variant → files map already
 * exists. This module reads it against what the session observed and derives, per option and per
 * scenario, a coding state with its reason. Nobody maintains it: it follows the files.
 *
 *   coded          every required file of its components is here (a removal-only option is coded)
 *   partly-coded   some are here, some are missing (or its components are in different states)
 *   not-coded      no file yet, no files declared, or only planned repositories
 *   unknown        the files cannot be seen here (repository not cloned, Restricted Mode, unverified…)
 *
 * Pure: declarations + observations in, states out.
 */
import type { DataPassProjectManifest } from "../projectManifestModel";
import type { GraphItem, ProjectGraph } from "../workspace/graph";
import { concernedItems, currentPicks, decidedPicks, picksFrom, type ArchOption, type Decision, type OptionsFile, type Picks } from "./options";
import { artifactsOf, componentRepoKey, resolveArtifacts, type FileObservation, type FileState, type RepoView } from "./resolve";

export type CodingState = "coded" | "partly-coded" | "not-coded" | "unknown";

export const CODING_LABELS: Readonly<Record<CodingState, string>> = {
  coded: "coded", "partly-coded": "partly coded", "not-coded": "not coded", unknown: "not checked here"
};

export interface VariantFileRef { repoKey: string; repoPath: string; state: FileState; optional: boolean }

export interface ComponentCoding {
  id: string;
  label: string;
  repoKey: string;
  /** "add" / "replace" for an alternative's components, "current" for the baseline ones. */
  role: "add" | "replace" | "current";
  state: CodingState;
  reason: string;
  files: VariantFileRef[];
}

export interface OptionCoding {
  /** "decision=option". */
  key: string;
  decision: string;
  option: string;
  label: string;
  current: boolean;
  state: CodingState;
  reason: string;
  components: ComponentCoding[];
  /** Baseline components this option removes (nothing to code). */
  removes: string[];
}

export interface ScenarioCoding {
  id: string;
  title: string;
  kind: "current" | "decided" | "declared";
  picks: string[];
  state: CodingState;
  reason: string;
}

/** A file some option needs, tagged with every option that needs it. */
export interface VariantFile { repoKey: string; repoPath: string; state: FileState; options: string[] }

export interface VariantsAnalysis {
  options: Record<string, OptionCoding>;
  scenarios: ScenarioCoding[];
  files: VariantFile[];
}

export interface VariantsInput {
  options: OptionsFile;
  manifest?: DataPassProjectManifest;
  graph?: ProjectGraph;
  coordinationKey: string;
  /** The real project's repositories as resolved (ProjectMap.repositories). */
  repositories: readonly RepoView[];
  fileObservations: ReadonlyMap<string, FileObservation>;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The coding state of one component in the repository that would hold it. */
function componentCoding(item: GraphItem, role: ComponentCoding["role"], repoKey: string, repo: RepoView | undefined, plannedHere: boolean, input: VariantsInput): ComponentCoding {
  const base = { id: item.id, label: item.label ?? item.id, repoKey, role };
  const decl = artifactsOf(item);
  if (!decl) return { ...base, state: "not-coded", reason: "no files declared", files: [] };
  if (plannedHere || repo?.state === "planned") return { ...base, state: "not-coded", reason: `repository ${repo?.label ?? repoKey} is planned`, files: [] };
  if (!repo) return { ...base, state: "unknown", reason: `repository ${repoKey} is declared only in options.json and not located here`, files: [] };
  const a = resolveArtifacts(item, decl, repoKey, repo, input.fileObservations);
  const files = a.files.map(f => ({ repoKey, repoPath: f.repoPath, state: f.state, optional: f.optional }));
  switch (a.availability) {
    case "complete": return { ...base, state: "coded", reason: plural(a.summary.found, "file") + " here", files };
    case "generation-needed": return { ...base, state: "coded", reason: `source files here; ${plural(a.summary.generatedMissing, "generated file")} still to produce`, files };
    case "none-declared": return { ...base, state: "not-coded", reason: "no files declared", files };
    case "incomplete": {
      const missing = a.files.filter(f => !f.optional && f.state === "missing" && f.source !== "generated").map(f => f.path);
      const list = `${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`;
      return a.summary.found > 0
        ? { ...base, state: "partly-coded", reason: `${a.summary.found} of ${a.summary.expected} files here; missing ${list}`, files }
        : { ...base, state: "not-coded", reason: `no file yet (missing ${list})`, files };
    }
    case "planned-repo": return { ...base, state: "not-coded", reason: `repository ${repo.label} is planned`, files };
    case "unbound": return { ...base, state: "unknown", reason: `repository ${repo.label} is not cloned here`, files };
    case "restricted": return { ...base, state: "unknown", reason: "not inspected (Restricted Mode)", files };
    default: return { ...base, state: "unknown", reason: repo.state === "unverified" ? repo.detail : "some files could not be checked", files };
  }
}

/**
 * Several states into one: known states that differ → partly coded (true whatever the unknown ones
 * are); otherwise any unknown → unknown (a gap nobody saw is not claimed); else the common state.
 */
export function combineStates(states: readonly CodingState[]): CodingState {
  if (!states.length) return "coded";
  const known = [...new Set(states.filter(s => s !== "unknown"))];
  if (known.length > 1 || known[0] === "partly-coded") return "partly-coded";
  if (known.length < 1 || states.includes("unknown")) return "unknown";
  return known[0]!;
}

function summarize(components: readonly ComponentCoding[]): string {
  const by = (s: CodingState) => components.filter(c => c.state === s);
  if (components.length === 1) return components[0]!.reason;
  const parts = (["coded", "partly-coded", "not-coded", "unknown"] as const).filter(s => by(s).length).map(s => `${by(s).length} ${CODING_LABELS[s]}`);
  const firstGap = components.find(c => c.state !== "coded");
  return `${plural(components.length, "component")}: ${parts.join(", ")}${firstGap ? ` — ${firstGap.label}: ${firstGap.reason}` : ""}`;
}

function scopeRepoOf(input: VariantsInput, d: Decision, itemId?: string): string | undefined {
  const scopes = input.manifest?.scopes ?? [];
  const byItem = itemId ? scopes.find(s => s.itemRefs?.includes(itemId)) : undefined;
  return (byItem ?? scopes.find(s => s.id === d.subproject))?.repoRef;
}

function optionCoding(d: Decision, o: ArchOption, input: VariantsInput, repoIndex: ReadonlyMap<string, RepoView>): OptionCoding {
  const current = o.id === d.current;
  const key = `${d.id}=${o.id}`;
  const head = { key, decision: d.id, option: o.id, label: o.label, current };
  const components: ComponentCoding[] = [];
  if (current) {
    // The baseline components this decision is about, as graph.json describes them today.
    const items = new Map((input.graph?.items ?? []).map(i => [i.id, i]));
    for (const id of concernedItems(d)) {
      const item = items.get(id);
      // A baseline component without files (a storage account, a manual step) is a resource, not code.
      if (!item || !artifactsOf(item)) continue;
      const repoKey = componentRepoKey(item, scopeRepoOf(input, d, id), input.coordinationKey);
      components.push(componentCoding(item, "current", repoKey, repoIndex.get(repoKey), false, input));
    }
    if (!components.length) return { ...head, state: "coded", reason: "the current architecture (graph.json)", components, removes: [] };
  } else {
    const planned = new Set((o.changes?.addRepositories ?? []).filter(r => r.planned || !r.remote).map(r => r.key));
    const scopeRepo = scopeRepoOf(input, d);
    for (const [role, list] of [["replace", o.changes?.replace ?? []], ["add", o.changes?.add ?? []]] as const) {
      for (const item of list) {
        const repoKey = componentRepoKey(item, scopeRepo, input.coordinationKey);
        components.push(componentCoding(item, role, repoKey, repoIndex.get(repoKey), planned.has(repoKey) && !repoIndex.has(repoKey), input));
      }
    }
  }
  const removes = current ? [] : [...(o.changes?.remove ?? [])];
  if (!components.length) {
    return removes.length
      ? { ...head, state: "coded", reason: `only removes ${removes.slice(0, 3).join(", ")}${removes.length > 3 ? "…" : ""}: nothing to code`, components, removes }
      : { ...head, state: "coded", reason: "changes no component", components, removes };
  }
  return { ...head, state: combineStates(components.map(c => c.state)), reason: summarize(components), components, removes };
}

/** The coding state of any set of picks (a declared scenario, or a combination previewed on the diagram). */
export function codingOfPicks(options: OptionsFile, analysis: VariantsAnalysis, picks: Picks): Pick<ScenarioCoding, "state" | "reason" | "picks"> {
  return scenarioCoding("", "", "declared", picks, { options } as VariantsInput, analysis.options);
}

function scenarioCoding(id: string, title: string, kind: ScenarioCoding["kind"], picks: Picks, input: Pick<VariantsInput, "options">, byKey: Record<string, OptionCoding>): ScenarioCoding {
  const chosen = input.options.decisions.map(d => byKey[`${d.id}=${picks.get(d.id) ?? d.current}`]).filter((x): x is OptionCoding => !!x);
  const state = combineStates(chosen.map(c => c.state));
  const gaps = chosen.filter(c => c.state !== "coded");
  const reason = gaps.length
    ? gaps.slice(0, 3).map(c => `${c.label}: ${CODING_LABELS[c.state]}`).join("; ") + (gaps.length > 3 ? "…" : "")
    : chosen.length ? "every picked option is coded" : "no decision";
  return { id, title, kind, picks: chosen.filter(c => !c.current).map(c => c.key), state, reason };
}

/** Coding state of every option and scenario, and the file → options map. */
export function deriveVariants(input: VariantsInput): VariantsAnalysis {
  const repoIndex = new Map(input.repositories.map(r => [r.key, r]));
  const options: Record<string, OptionCoding> = {};
  for (const d of input.options.decisions) for (const o of d.options) options[`${d.id}=${o.id}`] = optionCoding(d, o, input, repoIndex);

  const o = input.options;
  const scenarios: ScenarioCoding[] = [scenarioCoding("current", "Current architecture (graph.json)", "current", currentPicks(o), input, options)];
  if (o.decisions.some(d => d.chosen && d.chosen !== d.current)) scenarios.push(scenarioCoding("decided", "Decided (to apply)", "decided", decidedPicks(o), input, options));
  for (const s of o.scenarios ?? []) scenarios.push(scenarioCoding(s.id, s.title, "declared", picksFrom(o, s.picks), input, options));

  // Every file an option needs, tagged with all the options that need it (a shared file has several).
  const files = new Map<string, VariantFile>();
  for (const oc of Object.values(options)) {
    for (const c of oc.components) {
      for (const f of c.files) {
        const k = `${f.repoKey}\u0000${f.repoPath}`;
        const v = files.get(k) ?? { repoKey: f.repoKey, repoPath: f.repoPath, state: f.state, options: [] };
        if (!v.options.includes(oc.key)) v.options.push(oc.key);
        files.set(k, v);
      }
    }
  }
  return { options, scenarios, files: [...files.values()].sort((a, b) => a.repoKey.localeCompare(b.repoKey) || a.repoPath.localeCompare(b.repoPath)) };
}
