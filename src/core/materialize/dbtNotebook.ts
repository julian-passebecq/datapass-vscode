/**
 * DBTMAT1 (§ V5 W1, AC-N8, AC-V1): a dbt model → a Fabric notebook, as a MAT1 materialization proposal. Pure and deterministic.
 *
 *   readDbtArtifacts(files)            → models and sources from dbt's own `target/` artefacts (manifest.json, compiled/)
 *   materializeDbtModels(input)        → MAT1 candidate + stamped files + DETSPI1 materialization records + holes
 *   previewDbtDiff(result, existing)   → MAT1 diff, plus: never overwrite a notebook whose record says it was detached
 *
 * dbt stays canonical: the SQL is dbt's *compiled* SQL read from the artefacts dbt already wrote. DataPass never runs dbt,
 * never runs the notebook and never deploys; the output goes to a branch → MR through MAT1's flow (`materializationGitPlan`).
 * `ref()` / `source()` relations are rewritten to the table names of the chosen environment, from data (`DbtEnvironmentTables`),
 * never from hard-coded names. A model whose compiled SQL is missing is a hole, never a guessed notebook.
 *
 * Authority: every record written here says `authority: "dbt"`; only DETACH1 flips it to `notebook`.
 */
import { digestJson, digestNotebookSource, digestsEqual, unwrap, type Digest } from "@juliandatapass-group/semantic-core";
import {
  type ArchitectureCandidate,
  type CandidateUnit,
  type GeneratedFile,
  type NotebookUnit,
  type PipelineUnit,
  type ValidationIssue,
  generateCandidateFiles,
  validateGeneration
} from "./generator";
import { previewDiff, type DiffEntry } from "./flow";
import { GENERATOR_NAME, normalizeContent, readInlineStamp } from "./stamp";

// --- DETSPI1 stub ---------------------------------------------------------------------------------
// STUB until REPIN5: local copy of the reviewed Common `project-contracts` `datapass.materialization-detach/1` wire shape
// (DETSPI1 @79741eb: `schema` key, GitObjectId revision, semantic-core digest objects, actor `{kind, id}`, no clock time in
// the stamp, `recordedAt` outside it). Replace with the package import once the vendored project-contracts carries it.

export const MATERIALIZATION_DETACH_SCHEMA_ID = "datapass.materialization-detach/1" as const;
export type MaterializationAuthority = "dbt" | "notebook";
export type DetachOrigin = "declared" | "ai-proposed" | "ai-confirmed";
/** project-contracts `gitObjectIdSchema`. */
export type GitObjectId = { readonly algorithm: "git-sha1"; readonly oid: string } | { readonly algorithm: "git-sha256"; readonly oid: string };
/** EVACTOR1 `actorSchema`. */
export interface DetachActor { kind: "human" | "ai" | "tool"; id: string }

export interface DetachStamp {
  modelId: string;
  /** Git object id of the dbt project revision. */
  dbtRevision: GitObjectId;
  /** Repository-relative POSIX path of the notebook source file. */
  notebookPath: string;
  /** semantic-core `notebook-source-v1` digest (see `notebookSourceHash`). */
  notebookHash: Digest<"notebook-source-v1">;
  actor: DetachActor;
  origin: DetachOrigin;
}

export interface MaterializationDetach {
  schema: typeof MATERIALIZATION_DETACH_SCHEMA_ID;
  authority: MaterializationAuthority;
  stamp: DetachStamp;
  /** jcs-json digest of `stamp`. */
  stampDigest: Digest<"jcs-json">;
  /** When the record was written (ISO instant, UTC). Outside the stamp, so a re-run does not change the digest. */
  recordedAt: string;
  drift: null | { state: string; dbtRevision: GitObjectId | null; notebookHash: Digest<"notebook-source-v1"> | null; checkedAt: string };
  reattach: null | { proposalId: string; actor: DetachActor; at: string };
}

export function detachStampDigest(stamp: DetachStamp): Digest<"jcs-json"> {
  return unwrap(digestJson(stamp)) as Digest<"jcs-json">;
}

/** A 40- or 64-hex Git SHA as a GitObjectId (undefined for anything else). */
export function gitObjectId(sha: string): GitObjectId | undefined {
  return /^[0-9a-f]{40}$/.test(sha) ? { algorithm: "git-sha1", oid: sha } : /^[0-9a-f]{64}$/.test(sha) ? { algorithm: "git-sha256", oid: sha } : undefined;
}

export const sameGitObject = (a: GitObjectId, b: GitObjectId): boolean => a.algorithm === b.algorithm && a.oid === b.oid;

export const DETACH_DRIFT_STATES = ["in-sync", "dbt-changed", "notebook-edited", "both-changed", "unknown"] as const;
export type DetachDriftState = (typeof DETACH_DRIFT_STATES)[number];

/** Drift of a detached model against the stamp; a missing current value is `unknown` (DETSPI1 `detachDriftState`). */
export function detachDriftState(
  stamp: Pick<DetachStamp, "dbtRevision" | "notebookHash">,
  current: { readonly dbtRevision: GitObjectId | null; readonly notebookHash: Digest<"notebook-source-v1"> | null }
): DetachDriftState {
  if (current.dbtRevision === null || current.notebookHash === null) return "unknown";
  const dbt = !sameGitObject(current.dbtRevision, stamp.dbtRevision), notebook = !digestsEqual(current.notebookHash, stamp.notebookHash);
  return dbt && notebook ? "both-changed" : dbt ? "dbt-changed" : notebook ? "notebook-edited" : "in-sync";
}

const SHA256 = /^[0-9a-f]{64}$/;
const REPO_PATH = /^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[^\\]+$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;
const LABEL = /^\S(?:.*\S)?$/;
const WIRE_ID = /^\S{1,128}$/;
const ACTOR_KINDS: readonly unknown[] = ["human", "ai", "tool"];

/** project-contracts `gitObjectIdSchema` (untrusted JSON in). */
export function readGitObjectId(v: unknown): GitObjectId | undefined {
  const o = obj(v);
  if (Object.keys(o).length !== 2 || typeof o.oid !== "string") return undefined;
  return o.algorithm === "git-sha1" && /^[0-9a-f]{40}$/.test(o.oid) ? { algorithm: "git-sha1", oid: o.oid }
    : o.algorithm === "git-sha256" && SHA256.test(o.oid) ? { algorithm: "git-sha256", oid: o.oid } : undefined;
}

function readDigest<M extends "notebook-source-v1" | "jcs-json">(v: unknown, mode: M): Digest<M> | undefined {
  const o = obj(v);
  return Object.keys(o).length === 3 && o.algorithm === "sha256" && o.mode === mode && typeof o.value === "string" && SHA256.test(o.value)
    ? ({ algorithm: "sha256", mode, value: o.value } as Digest<M>) : undefined;
}

function readActor(v: unknown): DetachActor | undefined {
  const o = obj(v);
  return Object.keys(o).length === 2 && ACTOR_KINDS.includes(o.kind) && typeof o.id === "string" && LABEL.test(o.id) && o.id.length <= 256
    ? { kind: o.kind as DetachActor["kind"], id: o.id } : undefined;
}

/**
 * DETSPI1 `validateMaterializationDetach` on the reviewed wire shape (the fields DETACH1 relies on), and the stamp digest is
 * checked so a hand-edited stamp is rejected. Untrusted JSON in; a reason string out on failure.
 */
export function validateMaterializationDetach(value: unknown): { ok: true; record: MaterializationDetach } | { ok: false; reason: string } {
  const r = obj(value), s = obj(r.stamp);
  const bad = (reason: string) => ({ ok: false as const, reason });
  if (r.schema !== MATERIALIZATION_DETACH_SCHEMA_ID) return bad("schema is not datapass.materialization-detach/1");
  if (r.authority !== "dbt" && r.authority !== "notebook") return bad("authority must be dbt or notebook");
  if (typeof s.modelId !== "string" || !/^\S+$/.test(s.modelId)) return bad("stamp.modelId");
  const dbtRevision = readGitObjectId(s.dbtRevision);
  if (!dbtRevision) return bad("stamp.dbtRevision");
  if (typeof s.notebookPath !== "string" || !REPO_PATH.test(s.notebookPath)) return bad("stamp.notebookPath");
  const notebookHash = readDigest(s.notebookHash, "notebook-source-v1");
  if (!notebookHash) return bad("stamp.notebookHash");
  const actor = readActor(s.actor);
  if (!actor) return bad("stamp.actor");
  if (s.origin !== "declared" && s.origin !== "ai-proposed" && s.origin !== "ai-confirmed") return bad("stamp.origin");
  const stamp: DetachStamp = { modelId: s.modelId, dbtRevision, notebookPath: s.notebookPath, notebookHash, actor, origin: s.origin };
  const stampDigest = readDigest(r.stampDigest, "jcs-json");
  if (!stampDigest || !digestsEqual(detachStampDigest(stamp), stampDigest)) return bad("stampDigest does not match the stamp (hand-edited?)");
  if (typeof r.recordedAt !== "string" || !INSTANT.test(r.recordedAt)) return bad("recordedAt");
  const d = r.drift === null || r.drift === undefined ? null : obj(r.drift);
  if (d && (!(DETACH_DRIFT_STATES as readonly unknown[]).includes(d.state) || typeof d.checkedAt !== "string" || !INSTANT.test(d.checkedAt))) return bad("drift");
  const re = r.reattach === null || r.reattach === undefined ? null : obj(r.reattach);
  const reActor = re ? readActor(re.actor) : undefined;
  if (re && (typeof re.proposalId !== "string" || !WIRE_ID.test(re.proposalId) || !reActor || typeof re.at !== "string" || !INSTANT.test(re.at))) return bad("reattach");
  return {
    ok: true,
    record: {
      schema: MATERIALIZATION_DETACH_SCHEMA_ID, authority: r.authority, stamp, stampDigest, recordedAt: r.recordedAt,
      drift: d ? { state: d.state as string, dbtRevision: readGitObjectId(d.dbtRevision) ?? null, notebookHash: readDigest(d.notebookHash, "notebook-source-v1") ?? null, checkedAt: d.checkedAt as string } : null,
      reattach: re ? { proposalId: re.proposalId as string, actor: reActor!, at: re.at as string } : null
    }
  };
}

// --- dbt artefacts --------------------------------------------------------------------------------

export interface DbtFile { path: string; text: string }

export interface DbtModel {
  uniqueId: string;
  name: string;
  packageName: string;
  alias: string;
  materialized: string;
  originalFilePath: string;
  /** The relation dbt compiled references to this model to (dbt's `relation_name`), when it has one. */
  relationName?: string;
  compiledSql?: string;
  /** unique ids of the nodes and sources this model reads. */
  dependsOn: string[];
  /** Repository-relative folder of the dbt project. */
  projectDir: string;
}

export interface DbtSource {
  uniqueId: string;
  sourceName: string;
  name: string;
  identifier: string;
  relationName?: string;
}

export interface DbtArtifacts {
  projectName?: string;
  projectDir: string;
  models: DbtModel[];
  sources: DbtSource[];
}

export interface DbtHole {
  code:
    | "dbt.manifest-missing"
    | "dbt.manifest-unreadable"
    | "dbt.model-unknown"
    | "dbt.compiled-sql-missing"
    | "dbt.compiled-sql-jinja"
    | "dbt.ephemeral-not-materialized"
    | "dbt.incremental-full-refresh"
    | "dbt.ref-unresolved"
    | "dbt.environment-unknown"
    | "dbt.materialization-unknown";
  severity: "error" | "warning";
  modelId?: string;
  path: string;
  nextAction: string;
}

const MANIFEST = /(^|\/)target\/manifest\.json$/;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Reads every `target/manifest.json` (untrusted JSON) and, for a model whose manifest lacks compiled code, the file
 * `target/compiled/<package>/<original_file_path>`. Never runs dbt: no artefact → a `dbt.manifest-missing` hole.
 */
export function readDbtArtifacts(files: readonly DbtFile[]): { projects: DbtArtifacts[]; holes: DbtHole[] } {
  const byPath = new Map(files.map(f => [f.path.replace(/\\/g, "/"), f.text]));
  const manifests = [...byPath.keys()].filter(p => MANIFEST.test(p)).sort();
  const holes: DbtHole[] = [];
  if (!manifests.length) {
    holes.push({ code: "dbt.manifest-missing", severity: "error", path: "target/manifest.json", nextAction: "Run `dbt compile` in your own environment, then refresh: DataPass reads dbt's artefacts and never runs dbt." });
  }
  const projects: DbtArtifacts[] = [];
  for (const path of manifests) {
    const projectDir = path.replace(/(^|\/)target\/manifest\.json$/, "") || ".";
    let raw: Record<string, unknown>;
    try { raw = obj(JSON.parse(byPath.get(path)!)); } catch {
      holes.push({ code: "dbt.manifest-unreadable", severity: "error", path, nextAction: "Re-run `dbt compile`: the manifest is not valid JSON." });
      continue;
    }
    const prefix = projectDir === "." ? "" : `${projectDir}/`;
    const models: DbtModel[] = [];
    for (const [uniqueId, value] of Object.entries(obj(raw.nodes))) {
      const n = obj(value);
      if (n.resource_type !== "model") continue;
      const name = str(n.name) ?? uniqueId;
      const packageName = str(n.package_name) ?? "";
      const originalFilePath = (str(n.original_file_path) ?? "").replace(/\\/g, "/");
      const compiledFile = byPath.get(`${prefix}target/compiled/${packageName}/${originalFilePath}`);
      models.push({
        uniqueId, name, packageName, originalFilePath, projectDir,
        alias: str(n.alias) ?? name,
        materialized: str(obj(n.config).materialized) ?? "view",
        relationName: str(n.relation_name),
        compiledSql: str(n.compiled_code) ?? str(n.compiled_sql) ?? (compiledFile !== undefined && compiledFile.trim() ? compiledFile : undefined),
        dependsOn: (Array.isArray(obj(n.depends_on).nodes) ? (obj(n.depends_on).nodes as unknown[]) : []).filter((d): d is string => typeof d === "string")
      });
    }
    const sources: DbtSource[] = Object.entries(obj(raw.sources)).map(([uniqueId, value]) => {
      const s = obj(value);
      const name = str(s.name) ?? uniqueId;
      return { uniqueId, name, sourceName: str(s.source_name) ?? "", identifier: str(s.identifier) ?? name, relationName: str(s.relation_name) };
    });
    models.sort((a, b) => (a.uniqueId < b.uniqueId ? -1 : 1));
    sources.sort((a, b) => (a.uniqueId < b.uniqueId ? -1 : 1));
    projects.push({ projectName: str(obj(raw.metadata).project_name), projectDir, models, sources });
  }
  return { projects, holes };
}

// --- Environment table mapping (data, from the project config) -------------------------------------

/** Where one environment's tables live. Keyed by the project manifest's environment id. */
export interface DbtEnvironmentTables {
  /** Fabric lakehouse the notebook writes to and reads from (also the notebook's default lakehouse). */
  lakehouse: string;
  /** Optional schema inside the lakehouse (schema-enabled lakehouses). */
  schema?: string;
  /** Explicit table name per dbt model name or unique id; wins over the lakehouse default. */
  tables?: Record<string, string>;
  /** Explicit table name per `<source_name>.<table>` or source unique id; default `<lakehouse>[.<schema>].<identifier>`. */
  sources?: Record<string, string>;
}

/** MAT1 targets a dbt model can be materialized to (TL-5): notebooks here, the Spark job definition in `./dbtSparkJob`. */
export const MATERIALIZATION_TARGETS = ["fabric-notebook", "spark-job-definition"] as const;
export type MaterializationTarget = typeof MATERIALIZATION_TARGETS[number];
export const DEFAULT_MATERIALIZATION_TARGET: MaterializationTarget = "fabric-notebook";

export interface DbtMaterializeInput {
  files: readonly DbtFile[];
  /** MAT1 target, default `fabric-notebook`. Read by `materializeDbt` (`./dbtSparkJob`), the dispatcher; `materializeDbtModels` is the notebook target. */
  target?: MaterializationTarget;
  environment: string;
  environments: Readonly<Record<string, DbtEnvironmentTables>>;
  /** Exact Git SHA of the dbt project revision (40 or 64 hex). */
  dbtRevision: string;
  /** Model names or unique ids; default: every model of the root project. */
  models?: readonly string[];
  /** Repository folder of the Fabric items (MAT1 `rootDirectory`). */
  rootDirectory: string;
  /** Notebook display name = prefix + model name. Data, default `dbt_`. */
  notebookPrefix?: string;
  /** When set, a data pipeline of that name runs the notebooks in dbt dependency order. */
  pipelineName?: string;
  /** Who asks for the materialization (default: the DataPass generator as a tool), and when (ISO instant, UTC `Z`, the
   * record's `recordedAt`, never in the stamp). Passed in: this module reads no clock. */
  actor?: DetachActor;
  at: string;
  origin?: DetachOrigin;
  /** Cell language. Spark SQL now; PySpark (`spark.sql(...)`) is a later option. */
  language?: "sparksql";
}

export interface DbtMaterializeResult {
  candidate: ArchitectureCandidate;
  /** MAT1 files + one DETSPI1 record per notebook (role "sidecar"), sorted by path. */
  files: GeneratedFile[];
  records: Array<{ modelId: string; path: string; record: MaterializationDetach }>;
  holes: DbtHole[];
  issues: ValidationIssue[];
}

export const RECORD_ROOT = ".datapass/materialization";

export function recordPath(notebookPath: string): string {
  return `${RECORD_ROOT}/${notebookPath.replace(/\\/g, "/")}.detach.json`;
}

/**
 * Notebook hash for DETSPI1 (`notebook-source-v1`): the whole Fabric `.py` source without its MAT1 stamp line, LF, as one
 * raw cell. DETACH1 recomputes it from the file alone with this same function.
 */
export function notebookSourceHash(fileContent: string): Digest<"notebook-source-v1"> {
  const { body } = readInlineStamp(normalizeContent(fileContent));
  return unwrap(digestNotebookSource({
    splitterVersion: "datapass-fabric-py-whole-file/1",
    cells: [{ cellId: null, kind: "raw", language: "fabric-notebook-py", exactSourceText: body }],
    analysisMetadata: {}
  })) as Digest<"notebook-source-v1">;
}

const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quoteIdent = (part: string): string => (PLAIN_IDENT.test(part) ? part : `\`${part.replace(/`/g, "``")}\``);
/** A configured dotted name, each part quoted when it is not a plain identifier. */
const qualified = (name: string): string => name.split(".").map(p => quoteIdent(p.replace(/^`|`$/g, ""))).join(".");
const join = (...parts: Array<string | undefined>): string => parts.filter((p): p is string => !!p).map(quoteIdent).join(".");

function modelTable(env: DbtEnvironmentTables, m: DbtModel): string {
  const explicit = env.tables?.[m.uniqueId] ?? env.tables?.[m.name];
  return explicit ? qualified(explicit) : join(env.lakehouse, env.schema, m.alias);
}

function sourceTable(env: DbtEnvironmentTables, s: DbtSource): string {
  const explicit = env.sources?.[s.uniqueId] ?? env.sources?.[`${s.sourceName}.${s.name}`];
  return explicit ? qualified(explicit) : join(env.lakehouse, env.schema, s.identifier);
}

/** Replaces every occurrence of `from` (a dbt relation name, literal text) with `to`. */
function replaceRelation(sql: string, from: string, to: string): { sql: string; found: boolean } {
  const parts = sql.split(from);
  return { sql: parts.join(to), found: parts.length > 1 };
}

const SQL_KEYWORD_FOR: Record<string, "TABLE" | "VIEW"> = { table: "TABLE", incremental: "TABLE", view: "VIEW", materialized_view: "VIEW" };

/**
 * Notebooks a model waits for: its direct dependencies that have a notebook, and, through a dependency that has none
 * (ephemeral, not selected, or a hole), that dependency's own dependencies, transitively. Sources end the walk.
 * Also SJDMAT1's job order (`./dbtSparkJob`), with model id → module name as `notebookOf`.
 */
export function notebookDeps(id: string, byId: ReadonlyMap<string, DbtModel>, notebookOf: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>();
  const seen = new Set<string>([id]);
  const walk = (deps: readonly string[]) => {
    for (const d of deps) {
      if (seen.has(d)) continue;
      seen.add(d);
      const nb = notebookOf.get(d);
      if (nb) out.add(nb);
      else if (byId.has(d)) walk(byId.get(d)!.dependsOn);
    }
  };
  walk(byId.get(id)?.dependsOn ?? []);
  return [...out];
}

function sqlCell(lines: string[]): string {
  return ["%%sql", ...lines].map(l => (l ? `# MAGIC ${l}` : "# MAGIC")).join("\n");
}

/** One dbt model resolved for one environment: its compiled SQL with refs/sources rewritten, ready for any MAT1 target. */
export interface ResolvedDbtModel {
  model: DbtModel;
  /** Repository-relative path of the dbt model file (or its unique id). */
  path: string;
  kind: "TABLE" | "VIEW";
  /** Fully qualified target table of the environment. */
  target: string;
  /** One SQL comment line naming the model, environment and authority. */
  header: string;
  /** `CREATE OR REPLACE … AS` followed by the rewritten compiled SQL, one entry per line. */
  statement: string[];
}

export interface ResolvedDbtProject {
  project?: DbtArtifacts;
  env?: DbtEnvironmentTables;
  /** Candidate shell (no units yet): logical id, revision, environment, root directory. */
  candidate: ArchitectureCandidate;
  byId: Map<string, DbtModel>;
  /** Resolved models in selection order (ephemeral, missing or Jinja-holding models are holes instead). */
  models: ResolvedDbtModel[];
  holes: DbtHole[];
  issues: ValidationIssue[];
}

/**
 * The target-independent half of DBTMAT1: read the artefacts, pick the models, rewrite refs/sources to the environment's
 * tables. Shared by the notebook target (below) and the Spark job target (SJDMAT1, `./dbtSparkJob`).
 */
export function resolveDbtModels(input: DbtMaterializeInput): ResolvedDbtProject {
  const { projects, holes } = readDbtArtifacts(input.files);
  const env = input.environments[input.environment];
  const project = projects.find(p => p.projectDir === ".") ?? projects[0];
  const candidate: ArchitectureCandidate = {
    logicalId: `dbt:${project?.projectName ?? project?.projectDir ?? "project"}`,
    revision: input.dbtRevision,
    environment: input.environment,
    rootDirectory: input.rootDirectory,
    units: []
  };
  const issues: ValidationIssue[] = [];
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.dbtRevision)) issues.push({ severity: "error", message: "dbtRevision must be an exact Git SHA (40 or 64 lowercase hex)." });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(input.at)) issues.push({ severity: "error", message: "`at` must be an ISO instant in UTC (…Z)." });
  if (!env) {
    holes.push({ code: "dbt.environment-unknown", severity: "error", path: input.environment, nextAction: `Add the table mapping of environment "${input.environment}" to the project config.` });
  }
  const byId = new Map((project?.models ?? []).map(m => [m.uniqueId, m]));
  if (!project || !env) return { project, env, candidate, byId, models: [], holes, issues };

  const sources = new Map(project.sources.map(s => [s.uniqueId, s]));
  const wanted = input.models?.length
    ? input.models.map(sel => {
      const m = byId.get(sel) ?? project.models.find(x => x.name === sel && (!project.projectName || x.packageName === project.projectName)) ?? project.models.find(x => x.name === sel);
      if (!m) holes.push({ code: "dbt.model-unknown", severity: "error", path: sel, nextAction: `No model "${sel}" in the manifest: check the name or re-run \`dbt compile\`.` });
      return m;
    }).filter((m): m is DbtModel => !!m)
    : project.models.filter(m => !project.projectName || m.packageName === project.projectName);

  const models: ResolvedDbtModel[] = [];
  for (const m of [...new Set(wanted)]) {
    const path = m.originalFilePath ? (m.projectDir === "." ? m.originalFilePath : `${m.projectDir}/${m.originalFilePath}`) : m.uniqueId;
    if (m.materialized === "ephemeral") {
      holes.push({ code: "dbt.ephemeral-not-materialized", severity: "warning", modelId: m.uniqueId, path, nextAction: "Ephemeral models are inlined into their consumers' compiled SQL; no notebook is generated." });
      continue;
    }
    if (!m.compiledSql) {
      holes.push({ code: "dbt.compiled-sql-missing", severity: "error", modelId: m.uniqueId, path, nextAction: "Run `dbt compile` in your own environment: DataPass materializes dbt's compiled SQL only and never runs dbt." });
      continue;
    }
    let sql = normalizeContent(m.compiledSql).trim().replace(/;+\s*$/, "");
    if (/\{\{|\{%/.test(sql)) {
      holes.push({ code: "dbt.compiled-sql-jinja", severity: "error", modelId: m.uniqueId, path, nextAction: "The compiled SQL still holds Jinja: re-run `dbt compile`." });
      continue;
    }
    // Longest relation names first, so a name that contains another is rewritten whole.
    const rewrites = m.dependsOn.map(dep => {
      const model = byId.get(dep), source = sources.get(dep);
      if (model) return { dep, from: model.relationName, to: model.materialized === "ephemeral" ? undefined : modelTable(env, model) };
      if (source) return { dep, from: source.relationName, to: sourceTable(env, source) };
      return { dep, from: undefined, to: undefined };
    }).filter(r => !(r.from === undefined && byId.get(r.dep)?.materialized === "ephemeral"))
      .sort((a, b) => (b.from?.length ?? 0) - (a.from?.length ?? 0));
    for (const r of rewrites) {
      if (!r.from || !r.to) {
        holes.push({ code: "dbt.ref-unresolved", severity: "warning", modelId: m.uniqueId, path, nextAction: `Dependency ${r.dep} has no relation name in the manifest: check the generated SQL by hand.` });
        continue;
      }
      const out = replaceRelation(sql, r.from, r.to);
      if (!out.found) holes.push({ code: "dbt.ref-unresolved", severity: "warning", modelId: m.uniqueId, path, nextAction: `Relation ${r.from} (${r.dep}) is not in the compiled SQL: check the generated SQL by hand.` });
      sql = out.sql;
    }
    if (m.materialized === "incremental") {
      holes.push({ code: "dbt.incremental-full-refresh", severity: "warning", modelId: m.uniqueId, path, nextAction: "Incremental model generated as a full refresh (CREATE OR REPLACE): add the merge logic by hand if needed." });
    }
    const known = SQL_KEYWORD_FOR[m.materialized];
    if (!known) {
      holes.push({ code: "dbt.materialization-unknown", severity: "warning", modelId: m.uniqueId, path, nextAction: `Materialization "${m.materialized}" is not one DataPass knows: generated as a Delta TABLE, check the generated SQL by hand.` });
    }
    const kind = known ?? "TABLE";
    const target = modelTable(env, m);
    models.push({
      model: m, path, kind, target,
      header: `-- dbt ${m.uniqueId} (${m.materialized}) for environment ${input.environment}. Authority: dbt; change the dbt model, then re-materialize.`,
      statement: [`CREATE OR REPLACE ${kind} ${target}${kind === "TABLE" ? " USING DELTA" : ""} AS`, ...sql.split("\n")]
    });
  }
  return { project, env, candidate, byId, models, holes, issues };
}

export function materializeDbtModels(input: DbtMaterializeInput): DbtMaterializeResult {
  const { project, env, candidate, byId, models, holes, issues } = resolveDbtModels(input);
  if (!project || !env) return { candidate, files: [], records: [], holes, issues };
  const prefix = input.notebookPrefix ?? "dbt_";

  const notebookOf = new Map<string, string>();
  const units: CandidateUnit[] = [];
  for (const r of models) {
    const m = r.model;
    const name = `${prefix}${m.name}`;
    notebookOf.set(m.uniqueId, name);
    const cell = sqlCell([r.header, ...r.statement]);
    const unit: NotebookUnit = { kind: "notebook", name, description: `dbt ${m.uniqueId} materialized as a notebook (proposal).`, cells: [cell], defaultLakehouse: env.lakehouse };
    units.push(unit);
  }
  if (input.pipelineName && units.length) {
    const ids = [...notebookOf.keys()];
    const pipeline: PipelineUnit = {
      kind: "data-pipeline",
      name: input.pipelineName,
      description: "Runs the materialized dbt notebooks in dbt dependency order (proposal).",
      activities: ids.map(id => ({
        name: notebookOf.get(id)!,
        runs: notebookOf.get(id)!,
        dependsOn: notebookDeps(id, byId, notebookOf)
      }))
    };
    units.push(pipeline);
  }
  candidate.units = units;

  const generated = generateCandidateFiles(candidate);
  issues.push(...validateGeneration(candidate, generated));
  const records: DbtMaterializeResult["records"] = [];
  const recordFiles: GeneratedFile[] = [];
  // No record without an exact revision (the validation issue above already says why).
  const dbtRevision = gitObjectId(input.dbtRevision);
  for (const [modelId, name] of notebookOf) {
    const notebook = generated.find(f => f.unit === name && f.path.endsWith("/notebook-content.py"));
    if (!notebook || !dbtRevision) continue;
    const stamp: DetachStamp = {
      modelId,
      dbtRevision,
      notebookPath: notebook.path,
      notebookHash: notebookSourceHash(notebook.content),
      actor: input.actor ?? { kind: "tool", id: GENERATOR_NAME },
      origin: input.origin ?? "declared"
    };
    const record: MaterializationDetach = { schema: MATERIALIZATION_DETACH_SCHEMA_ID, authority: "dbt", stamp, stampDigest: detachStampDigest(stamp), recordedAt: input.at, drift: null, reattach: null };
    const path = recordPath(notebook.path);
    records.push({ modelId, path, record });
    recordFiles.push({ path, content: `${JSON.stringify(record, null, 2)}\n`, role: "sidecar", unit: name, stamp: notebook.stamp });
  }
  const files = [...generated, ...recordFiles].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { candidate, files, records, holes, issues };
}

/** The existing record when it already says the same thing (same authority, dbt revision and notebook hash). */
function sameRecord(existingText: string | undefined, record: MaterializationDetach): boolean {
  if (existingText === undefined) return false;
  let old: Record<string, unknown>;
  try { old = obj(JSON.parse(existingText)); } catch { return false; }
  const stamp = obj(old.stamp), rev = obj(stamp.dbtRevision), hash = obj(stamp.notebookHash);
  return old.authority === record.authority
    && (rev.algorithm === "git-sha1" || rev.algorithm === "git-sha256") && typeof rev.oid === "string" && sameGitObject(rev as GitObjectId, record.stamp.dbtRevision)
    && typeof hash.value === "string" && digestsEqual(hash as unknown as Digest, record.stamp.notebookHash);
}

/**
 * MAT1 diff, plus three rules: a record that already says the same thing (authority, dbt revision, notebook hash) is kept
 * as is ("unchanged"), so a re-run at the same revision does not rewrite it for a new `at`/`actor`; and two guards: a notebook whose existing record says `authority: "notebook"` (detached by DETACH1) is
 * never overwritten, even with `overwriteDetached` (re-attach is a new proposal, DETACH1); and a record follows its
 * notebook (blocked notebook → blocked record).
 */
export function previewDbtDiff(result: DbtMaterializeResult, existing: ReadonlyMap<string, string>, overwriteDetached = false): DiffEntry[] {
  const files = result.files.map(f => {
    const rec = result.records.find(r => r.path === f.path);
    const old = existing.get(f.path);
    return rec && old !== undefined && sameRecord(old, rec.record) ? { ...f, content: old } : f;
  });
  const entries = previewDiff(files, existing, overwriteDetached);
  const byPath = new Map(entries.map(e => [e.path, e]));
  const block = (path: string, reason: string) => {
    const e = byPath.get(path);
    if (!e || e.status === "unchanged") return;
    e.status = "blocked-detached";
    e.addedLines = e.removedLines = 0;
    e.reason = reason;
  };
  for (const { path, record } of result.records) {
    let authority: unknown;
    try { authority = obj(JSON.parse(existing.get(path) ?? "null")).authority; } catch { authority = undefined; }
    if (authority === "notebook") {
      const reason = "Detached: the notebook is the authority. Re-attach is a new materialization proposal, never an overwrite.";
      block(record.stamp.notebookPath, reason);
      block(path, reason);
    } else if (byPath.get(record.stamp.notebookPath)?.status === "blocked-detached") {
      block(path, "Record of a blocked notebook.");
    }
  }
  return entries;
}
