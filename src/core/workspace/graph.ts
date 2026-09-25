/**
 * The project graph file (.datapass/graph.json): logical items, declared outputs with their
 * dependency facets, and typed relations. Kept separate from project.json so bindings,
 * architecture semantics and artifact indexes stay small, separable files.
 *
 * Version 0.2 (DataPass V3) lets an item describe the native unit behind it: its provider, the
 * files it expects in which repository (`artifacts`), the operations that apply per environment,
 * its own checklist and docs. Declaring files never creates them and never proves they exist.
 */
import { arr, constOf, enumOf, ID, obj, TEXT, validateSchema, anyOf, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import type { DependencyDeclaration, DerivedOutput } from "../impact/facets";
import type { DomainPack } from "../domainPacks/pack";
import { PHASES, type Phase } from "../capabilities/registry";
import { COMPONENT_PROVIDERS } from "../project/providers";
import { FILE_ROLES, PROFILE_IDS, type FileRole } from "../project/profiles";

export const ITEM_KINDS = [
  "notebook", "workflow", "dataflow", "streaming-flow", "script", "package", "dataset", "dataset-snapshot",
  "application", "dashboard", "semantic-model", "infrastructure-definition", "domain-config",
  "artifact-bundle", "report", "model", "resource", "study", "question", "decision",
  // V3 kinds for architecture components
  "function", "pipeline", "storage", "database", "contract", "step"
] as const;
export type ItemKind = typeof ITEM_KINDS[number];
export const RELATIONS = ["contains", "uses", "produces", "consumes", "runsOn", "deployedFrom", "observedBy", "derivedFrom", "supersedes", "dependsOn", "invokes", "feeds", "orchestrates"] as const;
export const GRAPH_VERSIONS = ["0.1-draft", "0.2"] as const;
export type GraphVersion = typeof GRAPH_VERSIONS[number];
/** Declared intent, not an observation: "prepared" means someone says the files are ready. */
export const ITEM_STATUSES = ["planned", "in-progress", "prepared", "active", "retired"] as const;
export type ItemStatus = typeof ITEM_STATUSES[number];
/** Item fields that need graph version 0.2. */
export const V02_ITEM_FIELDS = ["provider", "status", "artifacts", "operations", "checklist", "docs", "owner"] as const;

const SHORT: Schema = { type: "string", minLength: 1, maxLength: 200 };
const REL_PATH: Schema = { type: "string", minLength: 1, maxLength: 400, pattern: "^(?![/\\\\~])(?![A-Za-z]:)(?!.*(^|[/\\\\])\\.\\.([/\\\\]|$)).+$" };
const HTTPS: Schema = { type: "string", maxLength: 2000, pattern: "^https://\\S+$" };
const CAPABILITY_ID: Schema = { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z0-9-]+){1,4}$" };
const OPEN_ID = (known: readonly string[]): Schema => anyOf(enumOf(...known), { type: "string", pattern: "^[a-z][a-z0-9.-]{0,79}$" });
const PHASE_LIST: Schema = { type: "array", items: enumOf(...PHASES), maxItems: PHASES.length, minItems: 0 };

const FILE_ENTRY: Schema = anyOf(REL_PATH, obj({ path: REL_PATH, role: enumOf(...FILE_ROLES), requiredFor: PHASE_LIST, optional: { type: "boolean" }, description: TEXT }, ["path"]));
const GENERATED: Schema = obj({ path: REL_PATH, producer: SHORT, how: TEXT, requiredFor: PHASE_LIST }, ["path", "producer"]);
const ARTIFACTS: Schema = obj({
  repoRef: ID, root: REL_PATH, profile: OPEN_ID(PROFILE_IDS), entry: REL_PATH,
  files: arr(FILE_ENTRY, 200), generated: arr(GENERATED, 50)
}, []);
const OPERATION: Schema = obj({
  capability: CAPABILITY_ID, environment: ID, label: SHORT,
  // A string map (names, never credentials), checked by parseGraph and expressed with propertyNames in the editor schema.
  target: { type: "object", additionalProperties: false, properties: {}, required: [] } as Schema
}, ["capability"]);
const CHECK: Schema = obj({ id: ID, label: SHORT, capabilityRef: CAPABILITY_ID }, ["id", "label"]);
const DOC: Schema = obj({ label: SHORT, path: REL_PATH, repoRef: ID, url: HTTPS }, ["label"]);

const ITEM = obj({
  id: ID, kind: enumOf(...ITEM_KINDS), label: SHORT, nativeType: SHORT,
  views: arr(ID, 20), tags: arr(ID, 30), authority: SHORT, repoRef: ID, path: REL_PATH,
  classification: enumOf("public", "internal", "confidential"), role: ID, description: TEXT,
  provider: OPEN_ID(COMPONENT_PROVIDERS), status: enumOf(...ITEM_STATUSES), artifacts: ARTIFACTS,
  operations: arr(OPERATION, 30), checklist: arr(CHECK, 50), docs: arr(DOC, 20), owner: SHORT
}, ["id", "kind", "label"]);

const OUTPUT = obj({
  id: ID, label: SHORT, itemRef: ID,
  dependsOn: arr(obj({ ref: ID, facets: anyOf(arr(ID, 50, 1), constOf("*")) }), 50),
  producedFrom: { type: "object", additionalProperties: false, properties: {}, required: [] } as Schema
}, ["id", "label"]);

export const GRAPH_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: constOf("datapass.graph"),
  version: enumOf(...GRAPH_VERSIONS),
  roles: { type: "object", additionalProperties: false, properties: {}, required: [] } as Schema,
  items: arr(ITEM, 2000),
  outputs: arr(OUTPUT, 1000),
  relations: arr(obj({ id: ID, source: ID, target: ID, relation: enumOf(...RELATIONS) }), 5000)
}, ["format", "version", "items"]);

export interface ArtifactFileDecl { path: string; role?: FileRole; requiredFor?: Phase[]; optional?: boolean; description?: string }
export interface ArtifactsDecl {
  repoRef?: string;
  root?: string;
  profile?: string;
  entry?: string;
  files?: Array<string | ArtifactFileDecl>;
  generated?: Array<{ path: string; producer: string; how?: string; requiredFor?: Phase[] }>;
}
export interface OperationDecl { capability: string; environment?: string; target?: Record<string, string>; label?: string }
export interface GraphDocRef { label: string; path?: string; repoRef?: string; url?: string }

export interface GraphItem {
  id: string; kind: ItemKind; label: string; nativeType?: string; views?: string[]; tags?: string[];
  authority?: string; repoRef?: string; path?: string; classification?: "public" | "internal" | "confidential";
  role?: string; description?: string;
  /** 0.2 */
  provider?: string; status?: ItemStatus; artifacts?: ArtifactsDecl; operations?: OperationDecl[];
  checklist?: Array<{ id: string; label: string; capabilityRef?: string }>; docs?: GraphDocRef[]; owner?: string;
}
export interface GraphOutput { id: string; label: string; itemRef?: string; dependsOn?: DependencyDeclaration[]; producedFrom?: Record<string, string> }
export interface GraphRelation { id: string; source: string; target: string; relation: typeof RELATIONS[number] }
export interface ProjectGraph {
  $schema?: string;
  format: "datapass.graph"; version: GraphVersion;
  roles?: Record<string, string>;
  items: GraphItem[]; outputs?: GraphOutput[]; relations?: GraphRelation[];
}

export class GraphError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

function isStringMap(v: unknown, maxValue = 200): boolean {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length <= 50
    && Object.entries(v).every(([k, x]) => /^[a-z][a-zA-Z0-9_.-]{0,79}$/.test(k) && typeof x === "string" && x.length > 0 && x.length <= maxValue);
}

/** A target value names a resource; anything that looks like a credential or a URL with secrets is refused. */
function credentialShaped(value: string): boolean {
  return /[\s"'`]/.test(value) || /:\/\/[^/]*@/.test(value) || /(password|secret|token|accountkey|sharedaccesskey|sig=)/i.test(value);
}

export function parseGraph(raw: string | Uint8Array): ProjectGraph {
  const doc = parseStrictJson(raw, { maxBytes: 4 * 1024 * 1024, maxEntries: 200_000 }) as Record<string, unknown>;
  // Free-form string maps are checked separately from the fixed-shape schema.
  const roles = doc?.roles;
  const outputs = Array.isArray(doc?.outputs) ? doc.outputs as Array<Record<string, unknown>> : [];
  const items = Array.isArray(doc?.items) ? doc.items as Array<Record<string, unknown>> : [];
  const shape = structuredClone(doc);
  if (roles !== undefined) { if (!isStringMap(roles)) throw new GraphError("roles must map role ids to item ids"); shape.roles = {}; }
  (shape.outputs as Array<Record<string, unknown>> | undefined)?.forEach((o, i) => {
    if (o.producedFrom !== undefined) { if (!isStringMap(outputs[i]!.producedFrom)) throw new GraphError(`outputs[${i}].producedFrom must map refs to revisions`); o.producedFrom = {}; }
  });
  (shape.items as Array<Record<string, unknown>> | undefined)?.forEach((it, i) => {
    const ops = Array.isArray(it?.operations) ? it.operations as Array<Record<string, unknown>> : [];
    ops.forEach((op, j) => {
      if (op?.target === undefined) return;
      const target = (items[i]!.operations as Array<Record<string, unknown>>)[j]!.target;
      if (!isStringMap(target, 120)) throw new GraphError(`items[${i}].operations[${j}].target must map names to short strings`);
      const bad = Object.entries(target as Record<string, string>).find(([, v]) => credentialShaped(v));
      if (bad) throw new GraphError(`items[${i}].operations[${j}].target.${bad[0]} looks like a credential or contains spaces; targets hold resource names only`);
      op.target = {};
    });
  });
  const issues = validateSchema(GRAPH_SCHEMA, shape);
  if (issues.length) throw new GraphError("Invalid project graph", issues);
  const graph = doc as unknown as ProjectGraph;
  if (graph.version === "0.1-draft") {
    for (const [i, item] of graph.items.entries()) {
      const used = V02_ITEM_FIELDS.find(f => (item as unknown as Record<string, unknown>)[f] !== undefined);
      if (used) throw new GraphError(`items[${i}].${used} requires graph version 0.2 (set "version": "0.2")`);
    }
  }
  const ids = [...graph.items.map(i => i.id), ...(graph.outputs ?? []).map(o => o.id)];
  if (new Set(ids).size !== ids.length) throw new GraphError("Duplicate item/output id");
  const known = new Set(ids);
  for (const r of graph.relations ?? []) {
    if (!known.has(r.source) || !known.has(r.target)) throw new GraphError(`Relation ${r.id} has a dangling endpoint`);
    if (r.relation === "contains" && r.source === r.target) throw new GraphError(`Relation ${r.id} contains itself`);
  }
  assertContainmentAcyclic(graph.relations ?? []);
  for (const [role, item] of Object.entries(graph.roles ?? {})) if (!known.has(item)) throw new GraphError(`Role ${role} points to unknown item ${item}`);
  for (const item of graph.items) {
    const checks = item.checklist?.map(c => c.id) ?? [];
    if (new Set(checks).size !== checks.length) throw new GraphError(`Item ${item.id} has duplicate checklist ids`);
    for (const d of item.docs ?? []) if (Boolean(d.path) === Boolean(d.url)) throw new GraphError(`Item ${item.id}: doc "${d.label}" needs exactly one of path or url`);
  }
  return graph;
}

/** Navigation containment must be acyclic; data-flow relations may legitimately loop. */
function assertContainmentAcyclic(relations: GraphRelation[]): void {
  const children = new Map<string, string[]>();
  for (const r of relations) if (r.relation === "contains") (children.get(r.source) ?? children.set(r.source, []).get(r.source)!).push(r.target);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) throw new GraphError(`Containment cycle at ${n}`);
    state.set(n, 1);
    for (const c of children.get(n) ?? []) visit(c);
    state.set(n, 2);
  };
  for (const n of children.keys()) visit(n);
}

/** Pack outputs reference roles ("case"); the project graph binds roles to concrete items. */
export function resolveOutputs(graph: ProjectGraph | undefined, pack: DomainPack | undefined): DerivedOutput[] {
  const roles = graph?.roles ?? {};
  const bind = (ref: string) => roles[ref] ?? ref;
  const fromPack: DerivedOutput[] = (pack?.outputs ?? []).map(o => ({ id: o.id, label: o.label, dependsOn: o.dependsOn.map(d => ({ ...d, ref: bind(d.ref) })) }));
  const fromGraph: DerivedOutput[] = (graph?.outputs ?? []).map(o => ({ id: o.id, label: o.label, dependsOn: o.dependsOn, producedFrom: o.producedFrom }));
  const graphIds = new Set(fromGraph.map(o => o.id));
  return [...fromPack.filter(o => !graphIds.has(o.id)), ...fromGraph];
}

/** A new graph uses the current version (0.2); 0.1-draft graphs keep loading unchanged. */
export function emptyGraph(): ProjectGraph {
  return { format: "datapass.graph", version: "0.2", roles: {}, items: [], outputs: [], relations: [] };
}
