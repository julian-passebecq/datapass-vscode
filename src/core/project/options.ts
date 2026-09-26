/**
 * Architecture options (0.15): the alternatives an AI or a person prepared for a project, so they
 * can be compared before anything is built. Pure and deterministic.
 *
 *   .datapass/options.json
 *     criteria    what to compare (declared values, 1–5 scores, notes)
 *     decisions   one choice per level ("where do the PDFs live?"): the option graph.json implements
 *                 today (`current`), the alternatives, and how each one changes the architecture
 *     scenarios   named combinations of options ("Archi 2 — Google for documents")
 *
 * DataPass never decides and never rewrites graph.json from here. It applies the picked options to a
 * copy of the project (manifest + graph) and derives the consequences with the same model as the
 * real project: components added, removed or replaced, the official tools each architecture needs
 * and whether they are installed here, DataPass support, repositories, operations. Prices, scores,
 * pros and cons are declarations (with a source and a date), never observations.
 */
import { formatAmounts, isPriced, sumPickedOptions, type CostTotal } from "./costs";
import { anyOf, arr, constOf, enumOf, ID, obj, TEXT, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { GRAPH_ITEM_SCHEMA, GRAPH_RELATION_SCHEMA, parseGraphItems, type GraphDocRef, type GraphItem, type GraphRelation, type ProjectGraph } from "../workspace/graph";
import { isRemoteUrl, type DataPassProjectManifest, type RepositoryBinding } from "../projectManifestModel";
import { buildProjectMap, type MapProblem, type ProjectMap, type ProjectMapInput } from "./projectMap";
import { providerInfo } from "./providers";
import { artifactsOf, componentRepoKey } from "./resolve";
import { TOOL_INDEX, type ToolObservation } from "../capabilities/tools";
import { MODULES, moduleEnabled } from "../modules";

export const OPTIONS_PATH = ".datapass/options.json";
export const OPTIONS_FORMAT = "datapass.options";
export const CURRENCIES = ["USD", "EUR", "GBP", "CHF"] as const;

const ID_RE = /^[a-z][a-z0-9_.-]{0,79}$/;
const SHORT: Schema = { type: "string", minLength: 1, maxLength: 200 };
const LINE: Schema = { type: "string", minLength: 1, maxLength: 600 };
const HTTPS: Schema = { type: "string", maxLength: 2000, pattern: "^https://\\S+$" };
const DATE: Schema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const REL_PATH: Schema = { type: "string", minLength: 1, maxLength: 400, pattern: "^(?![/\\\\~])(?![A-Za-z]:)(?!.*(^|[/\\\\])\\.\\.([/\\\\]|$)).+$" };
/** "decision=option" */
export const PICK_PATTERN = "^[a-z][a-z0-9_.-]{0,79}=[a-z][a-z0-9_.-]{0,79}$";
const PICK: Schema = { type: "string", pattern: PICK_PATTERN };
const MONEY: Schema = { type: "number", minimum: 0, maximum: 1_000_000_000 };
/** A criterion value: short text, a number, or { text, score 1–5, note }. */
export const VALUE_SCHEMA: Schema = anyOf(
  { type: "string", minLength: 1, maxLength: 300 },
  { type: "number" },
  obj({ text: { type: "string", minLength: 1, maxLength: 300 }, score: { type: "integer", minimum: 1, maximum: 5 }, note: TEXT }, [])
);
/** Free-form string map checked by parseOptions; the editor schema expresses it with propertyNames. */
const VALUES_MAP: Schema = { type: "object", additionalProperties: false, properties: {}, required: [] };

const COST: Schema = obj({
  label: SHORT, service: SHORT, price: SHORT, monthly: MONEY, oneTime: MONEY, currency: enumOf(...CURRENCIES),
  basis: TEXT, source: HTTPS, asOf: DATE, note: TEXT
}, ["label"]);
const DOC: Schema = obj({ label: SHORT, url: HTTPS, path: REL_PATH, repoRef: ID }, ["label"]);
const NEW_REPO: Schema = obj({
  key: ID, label: SHORT, description: TEXT, planned: constOf(true),
  remote: obj({ url: { type: "string", maxLength: 500 }, branch: { type: "string", pattern: "^[A-Za-z0-9._/-]{1,200}$" } }, ["url"])
}, ["key"]);
const CHANGES: Schema = obj({
  add: arr(GRAPH_ITEM_SCHEMA, 100), replace: arr(GRAPH_ITEM_SCHEMA, 100), remove: arr(ID, 200),
  addRelations: arr(GRAPH_RELATION_SCHEMA, 500), removeRelations: arr(ID, 500), addRepositories: arr(NEW_REPO, 20)
}, []);
const OPTION: Schema = obj({
  id: ID, label: SHORT, summary: TEXT, changes: CHANGES, values: VALUES_MAP,
  pros: arr(LINE, 30), cons: arr(LINE, 30), consequences: arr(LINE, 30), costs: arr(COST, 40),
  requires: arr(PICK, 20), excludes: arr(PICK, 20), docs: arr(DOC, 20), rejected: { type: "boolean" }, note: TEXT
}, ["id", "label"]);
const DECISION: Schema = obj({
  id: ID, title: SHORT, question: TEXT, level: ID, subproject: ID, concerns: arr(ID, 100),
  current: ID, chosen: ID, decidedOn: DATE, decidedBy: SHORT, rationale: TEXT, options: arr(OPTION, 8, 1), notes: TEXT
}, ["id", "title", "current", "options"]);
const SCENARIO: Schema = obj({ id: ID, title: SHORT, description: TEXT, picks: arr(PICK, 50), recommended: { type: "boolean" }, notes: TEXT }, ["id", "title", "picks"]);
const CRITERION: Schema = obj({ id: ID, label: SHORT, description: TEXT, better: enumOf("lower", "higher"), unit: SHORT }, ["id", "label"]);

export const OPTIONS_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: constOf(OPTIONS_FORMAT), version: constOf("1"),
  title: SHORT, description: TEXT, currency: enumOf(...CURRENCIES),
  criteria: arr(CRITERION, 30), decisions: arr(DECISION, 40), scenarios: arr(SCENARIO, 20)
}, ["format", "version", "decisions"]);

// ------------------------------------------------------------------ types

export interface Criterion { id: string; label: string; description?: string; better?: "lower" | "higher"; unit?: string }
export type CriterionValue = string | number | { text?: string; score?: number; note?: string };
export interface CostLine {
  label: string; service?: string; price?: string; monthly?: number; oneTime?: number; currency?: typeof CURRENCIES[number];
  basis?: string; source?: string; asOf?: string; note?: string;
}
export interface NewRepository { key: string; label?: string; description?: string; planned?: true; remote?: { url: string; branch?: string } }
export interface OptionChanges {
  add?: GraphItem[]; replace?: GraphItem[]; remove?: string[];
  addRelations?: GraphRelation[]; removeRelations?: string[]; addRepositories?: NewRepository[];
}
export interface ArchOption {
  id: string; label: string; summary?: string; changes?: OptionChanges; values?: Record<string, CriterionValue>;
  pros?: string[]; cons?: string[]; consequences?: string[]; costs?: CostLine[];
  requires?: string[]; excludes?: string[]; docs?: GraphDocRef[]; rejected?: boolean; note?: string;
}
export interface Decision {
  id: string; title: string; question?: string; level?: string; subproject?: string; concerns?: string[];
  /** The option graph.json implements today. */
  current: string;
  /** The option decided (to apply when it differs from current). */
  chosen?: string; decidedOn?: string; decidedBy?: string; rationale?: string;
  options: ArchOption[]; notes?: string;
}
export interface Scenario { id: string; title: string; description?: string; picks: string[]; recommended?: boolean; notes?: string }
export interface OptionsFile {
  $schema?: string; format: typeof OPTIONS_FORMAT; version: "1"; title?: string; description?: string; currency?: typeof CURRENCIES[number];
  criteria?: Criterion[]; decisions: Decision[]; scenarios?: Scenario[];
}

export class OptionsError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

// ------------------------------------------------------------------ parsing

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function checkValues(v: unknown, where: string): void {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new OptionsError(`${where}.values must map criterion ids to values`);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 30) throw new OptionsError(`${where}.values has more than 30 criteria`);
  for (const [k, x] of entries) {
    if (!ID_RE.test(k)) throw new OptionsError(`${where}.values: "${k}" is not a criterion id`);
    const issues = validateSchema(VALUE_SCHEMA, x);
    if (issues.length) throw new OptionsError(`${where}.values.${k} must be text (≤ 300 characters), a number, or { "text", "score" 1–5, "note" }`);
    if (typeof x === "number" && !Number.isFinite(x)) throw new OptionsError(`${where}.values.${k} is not a finite number`);
    if (x && typeof x === "object" && (x as { text?: unknown }).text === undefined && (x as { score?: unknown }).score === undefined) throw new OptionsError(`${where}.values.${k} needs a text or a score`);
  }
}

export function parsePick(s: string): { decision: string; option: string } {
  const i = s.indexOf("=");
  return { decision: s.slice(0, i), option: s.slice(i + 1) };
}

export function parseOptions(raw: string | Uint8Array): OptionsFile {
  const doc = parseStrictJson(raw, { maxBytes: 2 * 1024 * 1024, maxEntries: 200_000 }) as Record<string, unknown>;
  const shape = structuredClone(doc) as Record<string, unknown>;
  // Free-form value maps and the graph items are checked separately, with their own rules.
  const itemLists: Array<{ where: string; list: unknown[] }> = [];
  const decisionsIn = Array.isArray(shape?.decisions) ? shape.decisions as Array<Record<string, unknown>> : [];
  decisionsIn.forEach((d, i) => {
    const opts = d && typeof d === "object" && Array.isArray(d.options) ? d.options as Array<Record<string, unknown>> : [];
    opts.forEach((o, j) => {
      if (!o || typeof o !== "object") return;
      const where = `decisions[${i}].options[${j}]`;
      if (o.values !== undefined) { checkValues(o.values, where); o.values = {}; }
      const ch = o.changes as Record<string, unknown> | undefined;
      if (ch && typeof ch === "object" && !Array.isArray(ch)) {
        for (const k of ["add", "replace"] as const) {
          if (!Array.isArray(ch[k])) continue;
          if ((ch[k] as unknown[]).length > 100) throw new OptionsError(`${where}.changes.${k} has more than 100 components`);
          itemLists.push({ where: `${where}.changes.${k}`, list: ch[k] as unknown[] });
          ch[k] = [];
        }
      }
    });
  });
  const issues = validateSchema(OPTIONS_SCHEMA, shape);
  if (issues.length) throw new OptionsError("Invalid options file", issues);
  for (const { where, list } of itemLists) {
    if (!list.length) continue;
    try { parseGraphItems(list); } catch (e) { throw new OptionsError(`${where}: ${errorText(e)}`); }
  }
  const file = doc as unknown as OptionsFile;

  // Identities and references inside the file.
  const criteria = new Set((file.criteria ?? []).map(c => c.id));
  if (criteria.size !== (file.criteria ?? []).length) throw new OptionsError("Duplicate criterion id");
  const decisionIds = new Set<string>();
  const optionIndex = new Map<string, Set<string>>();
  for (const d of file.decisions) {
    if (decisionIds.has(d.id)) throw new OptionsError(`Duplicate decision id "${d.id}"`);
    decisionIds.add(d.id);
    const ids = d.options.map(o => o.id);
    if (new Set(ids).size !== ids.length) throw new OptionsError(`Decision "${d.id}" has duplicate option ids`);
    optionIndex.set(d.id, new Set(ids));
    if (!ids.includes(d.current)) throw new OptionsError(`Decision "${d.id}": current "${d.current}" is not one of its options (${ids.join(", ")})`);
    if (d.chosen !== undefined && !ids.includes(d.chosen)) throw new OptionsError(`Decision "${d.id}": chosen "${d.chosen}" is not one of its options`);
    for (const o of d.options) {
      for (const k of Object.keys(o.values ?? {})) if (!criteria.has(k)) throw new OptionsError(`Decision "${d.id}", option "${o.id}": value for unknown criterion "${k}" (declare it in criteria)`);
      for (const doc of o.docs ?? []) if (Boolean(doc.url) === Boolean(doc.path)) throw new OptionsError(`Decision "${d.id}", option "${o.id}": doc "${doc.label}" needs exactly one of url or path`);
      for (const r of o.changes?.addRepositories ?? []) {
        if (r.remote && !isRemoteUrl(r.remote.url)) throw new OptionsError(`Decision "${d.id}", option "${o.id}": repository ${r.key} remote.url must be https:// or git@host:path, without credentials`);
        if (!r.remote && !r.planned) throw new OptionsError(`Decision "${d.id}", option "${o.id}": repository ${r.key} needs a remote or "planned": true`);
      }
      const added = (o.changes?.add ?? []).map(i => i.id);
      if (new Set(added).size !== added.length) throw new OptionsError(`Decision "${d.id}", option "${o.id}": duplicate component id in changes.add`);
    }
  }
  const checkPick = (p: string, where: string) => {
    const { decision, option } = parsePick(p);
    if (!optionIndex.has(decision)) throw new OptionsError(`${where}: unknown decision "${decision}"`);
    if (!optionIndex.get(decision)!.has(option)) throw new OptionsError(`${where}: decision "${decision}" has no option "${option}"`);
  };
  for (const d of file.decisions) for (const o of d.options) {
    for (const p of o.requires ?? []) checkPick(p, `Decision "${d.id}", option "${o.id}" requires`);
    for (const p of o.excludes ?? []) checkPick(p, `Decision "${d.id}", option "${o.id}" excludes`);
  }
  const scenarioIds = new Set<string>();
  for (const s of file.scenarios ?? []) {
    if (scenarioIds.has(s.id) || s.id === "current" || s.id === "decided" || s.id === "custom") throw new OptionsError(`Scenario id "${s.id}" is duplicate or reserved (current, decided, custom)`);
    scenarioIds.add(s.id);
    const seen = new Set<string>();
    for (const p of s.picks) {
      checkPick(p, `Scenario "${s.id}"`);
      const { decision } = parsePick(p);
      if (seen.has(decision)) throw new OptionsError(`Scenario "${s.id}" picks decision "${decision}" twice`);
      seen.add(decision);
    }
  }
  return file;
}

// ------------------------------------------------------------------ checks against the project

/** Baseline components a decision can change: declared concerns plus what its options remove or replace. */
export function concernedItems(d: Decision): string[] {
  const ids = new Set(d.concerns ?? []);
  for (const o of d.options) {
    if (o.id === d.current) continue;
    for (const id of o.changes?.remove ?? []) ids.add(id);
    for (const i of o.changes?.replace ?? []) ids.add(i.id);
  }
  return [...ids];
}

/** What does not match the project's manifest and graph (warnings: the graph may be updated separately). */
export function optionsProblems(options: OptionsFile, manifest: DataPassProjectManifest | undefined, graph: ProjectGraph | undefined): MapProblem[] {
  const out: MapProblem[] = [];
  const items = new Set((graph?.items ?? []).map(i => i.id));
  const rels = new Set((graph?.relations ?? []).map(r => r.id));
  const scopes = new Set((manifest?.scopes ?? []).map(s => s.id));
  const repos = new Set(Object.keys(manifest?.repositories ?? {}));
  const where = (d: Decision, o?: ArchOption) => `options.json ${d.id}${o ? `=${o.id}` : ""}`;
  for (const d of options.decisions) {
    if (d.subproject && !scopes.has(d.subproject)) out.push({ severity: "warning", where: where(d), message: `subproject "${d.subproject}" is not a sub-project (scope) of project.json.` });
    for (const id of d.concerns ?? []) if (!items.has(id)) out.push({ severity: "warning", where: where(d), message: `concerns "${id}", which is not a component of graph.json.` });
    if (d.options.length < 2) out.push({ severity: "info", where: where(d), message: "only one option: nothing to compare yet." });
    for (const o of d.options) {
      const ch = o.changes ?? {};
      const touches = (ch.add?.length ?? 0) + (ch.replace?.length ?? 0) + (ch.remove?.length ?? 0) + (ch.addRelations?.length ?? 0) + (ch.removeRelations?.length ?? 0);
      if (o.id === d.current) {
        if (touches) out.push({ severity: "warning", where: where(d, o), message: "this is the current option: graph.json already describes it, so its changes are ignored. Put the changes on the alternatives." });
        continue;
      }
      const newRepos = new Set((ch.addRepositories ?? []).map(r => r.key));
      for (const r of newRepos) if (repos.has(r)) out.push({ severity: "warning", where: where(d, o), message: `addRepositories "${r}" is already declared in project.json.` });
      for (const id of ch.remove ?? []) if (!items.has(id)) out.push({ severity: "warning", where: where(d, o), message: `removes "${id}", which is not a component of graph.json.` });
      for (const i of ch.replace ?? []) if (!items.has(i.id)) out.push({ severity: "warning", where: where(d, o), message: `replaces "${i.id}", which is not a component of graph.json (it will be added instead).` });
      for (const i of ch.add ?? []) if (items.has(i.id)) out.push({ severity: "warning", where: where(d, o), message: `adds "${i.id}", which already exists in graph.json: use "replace" to change it.` });
      for (const id of ch.removeRelations ?? []) if (!rels.has(id)) out.push({ severity: "warning", where: where(d, o), message: `removes link "${id}", which is not a relation of graph.json.` });
      for (const i of [...(ch.add ?? []), ...(ch.replace ?? [])]) {
        const ref = i.artifacts?.repoRef ?? i.repoRef;
        if (ref && !repos.has(ref) && !newRepos.has(ref)) out.push({ severity: "warning", where: where(d, o), message: `component "${i.id}" names repository "${ref}", which neither project.json nor this option declares.` });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ picks

export type Picks = ReadonlyMap<string, string>;

export function currentPicks(o: OptionsFile): Map<string, string> {
  return new Map(o.decisions.map(d => [d.id, d.current]));
}

/** The decided architecture: each decision's chosen option, else its current one. */
export function decidedPicks(o: OptionsFile): Map<string, string> {
  return new Map(o.decisions.map(d => [d.id, d.chosen ?? d.current]));
}

/** Current picks overridden by a list of "decision=option" (unknown entries are ignored). */
export function picksFrom(o: OptionsFile, list: readonly string[]): Map<string, string> {
  const picks = currentPicks(o);
  for (const p of list) {
    if (!new RegExp(PICK_PATTERN).test(p)) continue;
    const { decision, option } = parsePick(p);
    const d = o.decisions.find(x => x.id === decision);
    if (d?.options.some(x => x.id === option)) picks.set(decision, option);
  }
  return picks;
}

export function scenarioPicks(o: OptionsFile, scenarioId: string): Map<string, string> | undefined {
  if (scenarioId === "current") return currentPicks(o);
  if (scenarioId === "decided") return decidedPicks(o);
  const s = o.scenarios?.find(x => x.id === scenarioId);
  return s ? picksFrom(o, s.picks) : undefined;
}

export const pickList = (picks: Picks): string[] => [...picks].map(([d, o]) => `${d}=${o}`);

// ------------------------------------------------------------------ applying picks to a copy of the project

export interface DerivedArchitecture {
  manifest?: DataPassProjectManifest;
  graph: ProjectGraph;
  /** Every decision with its picked option; changed = the option is not the current one. */
  picks: Array<{ decision: Decision; option: ArchOption; changed: boolean }>;
  diff: { added: string[]; removed: string[]; replaced: string[]; addedRelations: string[]; removedRelations: string[] };
  /** Removed components and links, kept to draw them as "removed" in a preview. */
  ghosts: { items: GraphItem[]; relations: GraphRelation[] };
  /** Which decision changed each component. */
  changedBy: Record<string, string>;
  /** Which decision added or removed each link. */
  relationsChangedBy: Record<string, string>;
  problems: MapProblem[];
}

/**
 * The project as it would be with these picks: each non-current option's changes applied, in the
 * order of the decisions. Conflicts (two decisions changing the same component) are reported, the
 * first one wins. Links whose component was removed disappear with it.
 */
export function applyPicks(manifest: DataPassProjectManifest | undefined, graph: ProjectGraph | undefined, options: OptionsFile, picks: Picks): DerivedArchitecture {
  const problems: MapProblem[] = [];
  const baseItems = new Map((graph?.items ?? []).map(i => [i.id, i]));
  const items = new Map(baseItems);
  const baseRels = new Map((graph?.relations ?? []).map(r => [r.id, r]));
  const rels = new Map(baseRels);
  const diff: DerivedArchitecture["diff"] = { added: [], removed: [], replaced: [], addedRelations: [], removedRelations: [] };
  const ghosts: DerivedArchitecture["ghosts"] = { items: [], relations: [] };
  const changedBy: Record<string, string> = {};
  const relationsChangedBy: Record<string, string> = {};
  const addedTo = new Map<string, string | undefined>();
  const newRepos = new Map<string, RepositoryBinding>();
  const chosen: DerivedArchitecture["picks"] = [];
  const conflict = (id: string, d: Decision) => problems.push({ severity: "error", where: `options.json ${d.id}`, message: `"${id}" is also changed by decision "${changedBy[id]}": pick options that do not change the same component (the first decision wins).` });

  for (const d of options.decisions) {
    const optionId = picks.get(d.id) ?? d.current;
    const option = d.options.find(o => o.id === optionId) ?? d.options.find(o => o.id === d.current)!;
    const changed = option.id !== d.current;
    chosen.push({ decision: d, option, changed });
    if (!changed) continue;
    const ch = option.changes ?? {};
    for (const r of ch.addRepositories ?? []) {
      if (manifest?.repositories?.[r.key] || newRepos.has(r.key)) continue;
      newRepos.set(r.key, { label: r.label, description: r.description, ...(r.remote ? { remote: r.remote } : {}), ...(r.planned || !r.remote ? { planned: true as const } : {}) });
    }
    for (const id of ch.remove ?? []) {
      if (changedBy[id]) { conflict(id, d); continue; }
      const it = items.get(id);
      if (!it) continue;
      items.delete(id);
      if (baseItems.has(id)) { ghosts.items.push(it); diff.removed.push(id); }
      changedBy[id] = d.id;
    }
    for (const it of ch.replace ?? []) {
      if (changedBy[it.id]) { conflict(it.id, d); continue; }
      const existed = items.has(it.id);
      items.set(it.id, it);
      (existed ? diff.replaced : diff.added).push(it.id);
      if (!existed) addedTo.set(it.id, d.subproject);
      changedBy[it.id] = d.id;
    }
    for (const it of ch.add ?? []) {
      if (items.has(it.id)) {
        if (changedBy[it.id]) conflict(it.id, d);
        else problems.push({ severity: "error", where: `options.json ${d.id}=${option.id}`, message: `adds "${it.id}", which already exists: use "replace".` });
        continue;
      }
      items.set(it.id, it);
      diff.added.push(it.id);
      addedTo.set(it.id, d.subproject);
      changedBy[it.id] = d.id;
    }
    for (const id of ch.removeRelations ?? []) {
      const r = rels.get(id);
      if (!r) continue;
      rels.delete(id);
      if (baseRels.has(id)) { ghosts.relations.push(r); diff.removedRelations.push(id); }
      relationsChangedBy[id] = d.id;
    }
    for (const r of ch.addRelations ?? []) {
      if (rels.has(r.id)) { problems.push({ severity: "error", where: `options.json ${d.id}=${option.id}`, message: `link id "${r.id}" already exists: give the new link another id.` }); continue; }
      rels.set(r.id, r);
      diff.addedRelations.push(r.id);
      relationsChangedBy[r.id] = d.id;
    }
  }
  // Links need both ends; a baseline link to a removed component goes away with it.
  for (const [id, r] of [...rels]) {
    if (items.has(r.source) && items.has(r.target)) continue;
    rels.delete(id);
    if (baseRels.has(id)) { ghosts.relations.push(r); diff.removedRelations.push(id); }
    else {
      diff.addedRelations.splice(diff.addedRelations.indexOf(id), 1);
      problems.push({ severity: "error", where: `options.json ${relationsChangedBy[id] ?? ""}`.trim(), message: `link "${id}" needs "${items.has(r.source) ? r.target : r.source}", which is not in this architecture.` });
    }
  }
  // Compatibility declared by the options themselves.
  for (const { decision, option } of chosen) {
    for (const p of option.requires ?? []) {
      const need = parsePick(p);
      if ((picks.get(need.decision) ?? options.decisions.find(x => x.id === need.decision)?.current) !== need.option) {
        problems.push({ severity: "warning", where: `options.json ${decision.id}=${option.id}`, message: `${option.label} requires ${labelOf(options, need.decision, need.option)}.` });
      }
    }
    for (const p of option.excludes ?? []) {
      const ex = parsePick(p);
      if ((picks.get(ex.decision) ?? options.decisions.find(x => x.id === ex.decision)?.current) === ex.option) {
        problems.push({ severity: "warning", where: `options.json ${decision.id}=${option.id}`, message: `${option.label} does not work with ${labelOf(options, ex.decision, ex.option)}.` });
      }
    }
  }

  const derivedGraph: ProjectGraph = { format: "datapass.graph", version: "0.2", roles: graph?.roles, items: [...items.values()], outputs: graph?.outputs, relations: [...rels.values()] };
  let derivedManifest = manifest;
  if (manifest) {
    const removed = new Set(diff.removed);
    derivedManifest = {
      ...manifest,
      repositories: newRepos.size ? { ...(manifest.repositories ?? {}), ...Object.fromEntries(newRepos) } : manifest.repositories,
      scopes: manifest.scopes?.map(s => {
        const refs = (s.itemRefs ?? []).filter(id => !removed.has(id));
        for (const [id, sub] of addedTo) if (sub === s.id && !refs.includes(id)) refs.push(id);
        return { ...s, itemRefs: refs };
      })
    };
  }
  return { manifest: derivedManifest, graph: derivedGraph, picks: chosen, diff, ghosts, changedBy, relationsChangedBy, problems };
}

function labelOf(o: OptionsFile, decision: string, option: string): string {
  const d = o.decisions.find(x => x.id === decision);
  const opt = d?.options.find(x => x.id === option);
  return `${d?.title ?? decision}: ${opt?.label ?? option}`;
}

/**
 * Components the alternatives would add or replace, with the repository that would hold them: the
 * session observes their files too, so a comparison can say "already prepared" for an alternative.
 */
export function optionComponentRepositories(options: OptionsFile | undefined, manifest: DataPassProjectManifest | undefined, coordinationKey: string): Array<{ item: GraphItem; repoKey: string }> {
  const out: Array<{ item: GraphItem; repoKey: string }> = [];
  for (const d of options?.decisions ?? []) {
    const scopeRepo = manifest?.scopes?.find(s => s.id === d.subproject)?.repoRef;
    for (const o of d.options) {
      if (o.id === d.current) continue;
      for (const item of [...(o.changes?.add ?? []), ...(o.changes?.replace ?? [])]) {
        if (!artifactsOf(item) && !item.repoRef) continue;
        out.push({ item, repoKey: componentRepoKey(item, scopeRepo, coordinationKey) });
      }
    }
  }
  return out.slice(0, 400);
}

// ------------------------------------------------------------------ consequences

export interface ToolStatus { id: string; label: string; state: "present" | "absent" | "unknown"; extensionId?: string; why: string[] }
export interface ProviderUse {
  id: string; label: string; support: "operations" | "files" | "unsupported"; nativeTool?: string;
  module?: string; moduleLabel?: string; moduleOff: boolean; components: string[];
}
export interface ComponentRef { id: string; label: string; provider?: string }

export interface ArchitectureImpact {
  key: string;
  picks: Array<{ decision: string; option: string; changed: boolean }>;
  components: { total: number; added: ComponentRef[]; removed: ComponentRef[]; replaced: Array<ComponentRef & { from?: string }> };
  relations: { added: number; removed: number };
  providers: ProviderUse[];
  providersAdded: string[];
  providersRemoved: string[];
  tools: { needed: ToolStatus[]; newlyNeeded: ToolStatus[]; noLongerNeeded: ToolStatus[] };
  support: { operations: number; files: number; unsupported: number };
  operations: { total: number; ready: number };
  repositories: { used: string[]; planned: string[]; newlyUsed: string[] };
  /** 0.22 (F01/F08): per currency, never converted; `missing` = decisions not fully priced; `total` says how many are. */
  costs: { monthly: Record<string, number>; oneTime: Record<string, number>; lines: Array<CostLine & { decision: string; option: string }>; missing: string[]; total: CostTotal };
  problems: MapProblem[];
}

export interface OptionsAnalysis {
  problems: MapProblem[];
  current: ArchitectureImpact;
  /** "decision=option" → the consequences of that one option (the other decisions stay current). */
  byOption: Record<string, ArchitectureImpact>;
  scenarios: Array<{ id: string; title: string; description?: string; recommended?: boolean; kind: "current" | "decided" | "declared"; impact: ArchitectureImpact }>;
}

function toolNeeds(map: ProjectMap, tools: ReadonlyMap<string, ToolObservation>): Map<string, ToolStatus> {
  const out = new Map<string, ToolStatus>();
  const add = (anyOf: readonly string[], why: string) => {
    const key = [...anyOf].sort().join("|");
    const states = anyOf.map(id => tools.get(id)?.state);
    const state: ToolStatus["state"] = states.includes("present") ? "present" : states.every(s => s === "absent") ? "absent" : "unknown";
    const t = out.get(key) ?? {
      id: key, label: anyOf.map(id => TOOL_INDEX.get(id)?.label ?? id).join(" or "), state,
      extensionId: anyOf.map(id => TOOL_INDEX.get(id)?.extensionIds?.[0]).find(Boolean), why: []
    };
    if (!t.why.includes(why) && t.why.length < 8) t.why.push(why);
    out.set(key, t);
  };
  for (const c of map.components) {
    for (const id of c.provider?.nativeTool?.toolIds ?? []) add([id], c.label);
    for (const o of c.operations) for (const r of o.capability.requirements) if (r.need === "required") add(r.anyOf, `${c.label}: ${o.phase}`);
  }
  return out;
}

function providersOf(map: ProjectMap, manifest: DataPassProjectManifest | undefined): ProviderUse[] {
  const by = new Map<string, ProviderUse>();
  for (const c of map.components) {
    const id = c.providerId ?? "(none)";
    const p = providerInfo(c.providerId);
    const module = p?.module;
    const use = by.get(id) ?? {
      id, label: p?.label ?? c.providerId ?? "No service declared",
      support: p?.support ?? (c.providerId ? "unsupported" : "files"),
      nativeTool: p?.nativeTool?.label, module, moduleLabel: MODULES.find(m => m.id === module)?.label,
      moduleOff: Boolean(module && !moduleEnabled(manifest, module)), components: []
    };
    use.components.push(c.id);
    by.set(id, use);
  }
  return [...by.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function impactFrom(key: string, options: OptionsFile, derived: DerivedArchitecture, map: ProjectMap, base: { map: ProjectMap; manifest?: DataPassProjectManifest }, tools: ReadonlyMap<string, ToolObservation>): ArchitectureImpact {
  const ref = (m: ProjectMap, id: string): ComponentRef => { const c = m.components.find(x => x.id === id); return { id, label: c?.label ?? id, provider: c?.provider?.label ?? c?.providerId }; };
  const providers = providersOf(map, derived.manifest);
  const baseProviders = new Set(providersOf(base.map, base.manifest).map(p => p.id));
  const now = new Set(providers.map(p => p.id));
  const needs = toolNeeds(map, tools), baseNeeds = toolNeeds(base.map, tools);
  const used = map.repositories.filter(r => r.usedBy.length).map(r => r.key);
  const baseUsed = new Set(base.map.repositories.filter(r => r.usedBy.length).map(r => r.key));
  const support = { operations: 0, files: 0, unsupported: 0 };
  for (const p of providers) support[p.support] += p.components.length;
  const currency = options.currency ?? "USD";
  const total = sumPickedOptions(derived.picks.map(p => p.option), currency);
  const costs: ArchitectureImpact["costs"] = { monthly: total.monthly, oneTime: total.oneTime, lines: [], missing: [], total };
  for (const { decision, option } of derived.picks) {
    const lines = option.costs ?? [];
    if (!lines.length || lines.some(l => !isPriced(l))) costs.missing.push(decision.id);
    for (const l of lines) costs.lines.push({ ...l, decision: decision.id, option: option.id });
  }
  return {
    key,
    picks: derived.picks.map(p => ({ decision: p.decision.id, option: p.option.id, changed: p.changed })),
    components: {
      total: map.components.length,
      added: derived.diff.added.map(id => ref(map, id)),
      removed: derived.diff.removed.map(id => ref(base.map, id)),
      replaced: derived.diff.replaced.map(id => ({ ...ref(map, id), from: ref(base.map, id).provider }))
    },
    relations: { added: derived.diff.addedRelations.length, removed: derived.diff.removedRelations.length },
    providers,
    providersAdded: providers.filter(p => !baseProviders.has(p.id)).map(p => p.id),
    providersRemoved: [...baseProviders].filter(id => !now.has(id)),
    tools: {
      needed: [...needs.values()],
      newlyNeeded: [...needs.values()].filter(t => !baseNeeds.has(t.id)),
      noLongerNeeded: [...baseNeeds.values()].filter(t => !needs.has(t.id))
    },
    support,
    operations: { total: map.summary.opsTotal, ready: map.summary.opsReady },
    repositories: {
      used,
      planned: map.repositories.filter(r => r.usedBy.length && r.state === "planned").map(r => r.key),
      newlyUsed: used.filter(k => !baseUsed.has(k))
    },
    costs,
    problems: derived.problems
  };
}

export interface AnalyzeInput {
  /** The real project's map input: observations, tools, reviews, results. */
  base: ProjectMapInput;
  options: OptionsFile;
  /** The real project's map (built from `base`), when the caller already has it. */
  baseMap?: ProjectMap;
}

/** The consequences of any set of picks, with the project map of that architecture. */
export function evaluatePicks(input: AnalyzeInput, picks: Picks, key: string): { impact: ArchitectureImpact; derived: DerivedArchitecture; map: ProjectMap } {
  const baseMap = input.baseMap ?? buildProjectMap(input.base);
  const derived = applyPicks(input.base.manifest, input.base.graph, input.options, picks);
  const map = derived.picks.some(p => p.changed) ? buildProjectMap({ ...input.base, manifest: derived.manifest, graph: derived.graph }) : baseMap;
  return { impact: impactFrom(key, input.options, derived, map, { map: baseMap, manifest: input.base.manifest }, input.base.tools), derived, map };
}

/** Every option on its own (the other decisions stay current), the decided architecture and every scenario. */
export function analyzeOptions(input: AnalyzeInput): OptionsAnalysis {
  const baseMap = input.baseMap ?? buildProjectMap(input.base);
  const withMap = { ...input, baseMap };
  const problems = optionsProblems(input.options, input.base.manifest, input.base.graph);
  const current = evaluatePicks(withMap, currentPicks(input.options), "current").impact;
  const byOption: Record<string, ArchitectureImpact> = {};
  for (const d of input.options.decisions) {
    for (const o of d.options) {
      const key = `${d.id}=${o.id}`;
      byOption[key] = o.id === d.current ? { ...current, key } : evaluatePicks(withMap, new Map([...currentPicks(input.options), [d.id, o.id]]), key).impact;
    }
  }
  const scenarios: OptionsAnalysis["scenarios"] = [{ id: "current", title: "Current architecture (graph.json)", kind: "current", impact: current }];
  if (input.options.decisions.some(d => d.chosen && d.chosen !== d.current)) {
    scenarios.push({ id: "decided", title: "Decided (to apply)", description: "Each decision's chosen option: what the AI still has to apply to graph.json and the native files.", kind: "decided", impact: evaluatePicks(withMap, decidedPicks(input.options), "decided").impact });
  }
  for (const s of input.options.scenarios ?? []) {
    scenarios.push({ id: s.id, title: s.title, description: s.description, recommended: s.recommended, kind: "declared", impact: evaluatePicks(withMap, picksFrom(input.options, s.picks), `scenario:${s.id}`).impact });
  }
  for (const s of scenarios) for (const p of s.impact.problems) if (!problems.some(x => x.message === p.message)) problems.push({ ...p, where: `${p.where} (${s.title})` });
  return { problems, current, byOption, scenarios };
}

/** Shortest readable form of a money amount per currency: "≈ 12.5 USD/month" (one term per currency, never converted). */
export function formatMoney(amounts: Record<string, number>, suffix = ""): string {
  return formatAmounts(amounts, suffix);
}
