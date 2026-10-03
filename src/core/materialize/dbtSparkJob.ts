/**
 * SJDMAT1 (§ V5 W2, TL-5): a dbt project → a Fabric Spark job definition plus the Python wheel project around it, as a MAT1
 * materialization proposal. Pure and deterministic; the alternative to DBTMAT1's notebook target (`./dbtNotebook`).
 *
 *   materializeDbtSparkJob(input)          → MAT1 candidate (one SJD unit) + stamped SJD files + stamped wheel skeleton
 *   materializeDbt(input)                  → dispatch on `target` ("fabric-notebook" default | "spark-job-definition")
 *   previewDbtSparkJobDiff(result, files)  → MAT1 diff (hand-edited files are never overwritten unless the user says so)
 *
 * The wheel skeleton = `pyproject.toml`, a package with one module per dbt model (dbt's compiled SQL, refs rewritten to the
 * environment's tables by DBTMAT1's `resolveDbtModels`), a runner in dbt dependency order and a tests stub. The SJD's main
 * file is a thin entry that imports the runner. DataPass never builds the wheel, never runs the job and never deploys:
 * every file goes through MAT1's stamp → `previewDiff` → `materializationGitPlan` (arguments only, the user runs them).
 */
import {
  type ArchitectureCandidate,
  type GeneratedFile,
  type SparkJobUnit,
  type ValidationIssue,
  generateCandidateFiles,
  validateGeneration
} from "./generator";
import { previewDiff, type DiffEntry } from "./flow";
import { inlineStampLine, makeStamp, renderSidecar, sidecarPath, supportsInlineStamp } from "./stamp";
import {
  type DbtHole,
  type DbtModel,
  type DbtMaterializeInput,
  type DbtMaterializeResult,
  type MaterializationTarget,
  type ResolvedDbtModel,
  DEFAULT_MATERIALIZATION_TARGET,
  materializeDbtModels,
  notebookDeps,
  resolveDbtModels
} from "./dbtNotebook";

// Target choice (TL-5): the names live in DBTMAT1 (`./dbtNotebook`); re-exported for the target card and callers.
export { DEFAULT_MATERIALIZATION_TARGET, MATERIALIZATION_TARGETS, type MaterializationTarget } from "./dbtNotebook";

export interface DbtSparkJobInput extends DbtMaterializeInput {
  /** SJD display name. Data, default `<notebookPrefix><project>_job`. */
  jobName?: string;
  /** Python import name of the wheel package (lowercase identifier). Data, default `dbt_<project>_jobs`. */
  packageName?: string;
  /** Repository folder of the wheel project. Data, default `jobs/<packageName>`. */
  wheelDirectory?: string;
  /** Wheel version written in pyproject.toml. Data, default `0.1.0`. */
  wheelVersion?: string;
}

export interface DbtSparkJobResult {
  candidate: ArchitectureCandidate;
  /** SJD item files, wheel files and their sidecars, all stamped, sorted by path. */
  files: GeneratedFile[];
  /** One module per materialized model, in dbt dependency order (the runner's order). */
  modules: Array<{ modelId: string; module: string; path: string }>;
  holes: DbtHole[];
  issues: ValidationIssue[];
  /** What the user does next, outside DataPass (build, attach, deploy with their own tools). */
  nextActions: string[];
}

const PY_KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"]);

/** A dbt model name as a Python module name: non-identifier characters → `_`, leading digit or keyword guarded. */
export function pythonModuleName(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase() || "model";
  if (/^[0-9]/.test(id)) id = `m_${id}`;
  return PY_KEYWORDS.has(id) ? `${id}_` : id;
}

/** Resolved models a model waits for, transitively through models that are not resolved (ephemeral, not selected, holes). */
function resolvedDeps(models: ResolvedDbtModel[], byId: ReadonlyMap<string, DbtModel>): Map<string, string[]> {
  const self = new Map(models.map(r => [r.model.uniqueId, r.model.uniqueId]));
  return new Map(models.map(r => [r.model.uniqueId, notebookDeps(r.model.uniqueId, byId, self)]));
}

/** Topological order of the resolved models over their (transitive) resolved dependencies; ties by name, so the order is stable. */
function dependencyOrder(models: ResolvedDbtModel[], resolved: ReadonlyMap<string, string[]>): ResolvedDbtModel[] {
  const deps = new Map(models.map(r => [r.model.uniqueId, new Set(resolved.get(r.model.uniqueId) ?? [])]));
  const out: ResolvedDbtModel[] = [];
  const done = new Set<string>();
  while (out.length < models.length) {
    const ready = models.filter(r => !done.has(r.model.uniqueId) && [...deps.get(r.model.uniqueId)!].every(d => done.has(d)));
    // dbt forbids cycles; should a manifest hold one anyway, the rest keeps name order instead of looping.
    const next = (ready.length ? ready : models.filter(r => !done.has(r.model.uniqueId)))
      .sort((a, b) => (a.model.name < b.model.name ? -1 : a.model.name > b.model.name ? 1 : 0))[0]!;
    out.push(next);
    done.add(next.model.uniqueId);
  }
  return out;
}

const py = (value: string): string => JSON.stringify(value); // a JSON string literal is a valid Python str literal

function modelModule(r: ResolvedDbtModel, dependsOn: string[]): string {
  return [
    `"""dbt ${r.model.uniqueId} (${r.model.materialized}), materialized by DataPass (proposal). Authority: dbt; change the dbt model, then re-materialize."""`,
    "",
    `MODEL_ID = ${py(r.model.uniqueId)}`,
    `TARGET = ${py(r.target)}`,
    `DEPENDS_ON = (${dependsOn.map(d => `${py(d)}, `).join("").replace(/, $/, dependsOn.length === 1 ? "," : "")})`,
    `SQL = "\\n".join([`,
    ...[r.header, ...r.statement].map(l => `    ${py(l)},`),
    "])",
    "",
    "",
    "def run(spark) -> None:",
    "    spark.sql(SQL)",
    ""
  ].join("\n");
}

function runnerModule(order: string[], appName: string): string {
  return [
    '"""Runs the materialized dbt models in dbt dependency order. Generated by DataPass (proposal); dbt stays the authority."""',
    "from importlib import import_module",
    "",
    `APP_NAME = ${py(appName)}`,
    `ORDER = (${order.map(o => `${py(o)}, `).join("").replace(/, $/, order.length === 1 ? "," : "")})`,
    "",
    "",
    "def run(spark, models=None) -> None:",
    "    wanted = set(models or ORDER)",
    "    unknown = wanted.difference(ORDER)",
    "    if unknown:",
    '        raise ValueError("unknown models: " + ", ".join(sorted(unknown)))',
    "    for name in ORDER:",
    "        if name in wanted:",
    '            import_module(__package__ + ".models." + name).run(spark)',
    "",
    "",
    "def main(argv=None) -> None:",
    "    from pyspark.sql import SparkSession",
    "",
    "    spark = SparkSession.builder.appName(APP_NAME).getOrCreate()",
    "    try:",
    "        run(spark, list(argv or []))",
    "    finally:",
    "        spark.stop()",
    ""
  ].join("\n");
}

function testsStub(pkg: string): string {
  return [
    '"""Generated tests stub (structure only, no Spark session). Add data tests here; DataPass never runs them."""',
    "from importlib import import_module",
    "",
    `from ${pkg} import runner`,
    "",
    "",
    "def test_every_model_has_sql():",
    "    for name in runner.ORDER:",
    `        module = import_module("${pkg}.models." + name)`,
    '        assert "CREATE OR REPLACE " in module.SQL',
    "",
    "",
    "def test_order_respects_dbt_dependencies():",
    "    seen = set()",
    "    for name in runner.ORDER:",
    `        module = import_module("${pkg}.models." + name)`,
    "        assert set(module.DEPENDS_ON) <= seen",
    "        seen.add(name)",
    ""
  ].join("\n");
}

function pyproject(pkg: string, version: string, project: string): string {
  return [
    "[build-system]",
    'requires = ["setuptools>=68", "wheel"]',
    'build-backend = "setuptools.build_meta"',
    "",
    "[project]",
    `name = ${py(pkg.replace(/_/g, "-"))}`,
    `version = ${py(version)}`,
    `description = ${py(`dbt project ${project} materialized as a Spark job by DataPass (proposal; dbt stays the authority).`)}`,
    'requires-python = ">=3.10"',
    "# pyspark comes with the Spark runtime; it is not a wheel dependency.",
    "dependencies = []",
    "",
    "[project.optional-dependencies]",
    'test = ["pytest"]',
    "",
    "[tool.setuptools.packages.find]",
    'where = ["src"]',
    ""
  ].join("\n");
}

function entryScript(pkg: string): string {
  return [
    `"""Thin entry of the Spark job definition: the logic is in the ${pkg} wheel (build it in your CI, attach it to the job's environment)."""`,
    "import sys",
    "",
    `from ${pkg}.runner import main`,
    "",
    'if __name__ == "__main__":',
    "    main(sys.argv[1:])"
  ].join("\n");
}

export function materializeDbtSparkJob(input: DbtSparkJobInput): DbtSparkJobResult {
  const { project, env, candidate, byId, models, holes, issues } = resolveDbtModels(input);
  const empty = (): DbtSparkJobResult => ({ candidate, files: [], modules: [], holes, issues, nextActions: [] });
  if (!project || !env || !models.length) return empty();

  const projectId = pythonModuleName(project.projectName ?? project.projectDir.split("/").pop() ?? "project");
  const pkg = input.packageName ?? `dbt_${projectId}_jobs`;
  const jobName = input.jobName ?? `${input.notebookPrefix ?? "dbt_"}${projectId}_job`;
  const wheelDir = (input.wheelDirectory ?? `jobs/${pkg}`).replace(/\\/g, "/").replace(/\/+$/, "");
  if (!/^[a-z_][a-z0-9_]*$/.test(pkg) || PY_KEYWORDS.has(pkg)) issues.push({ severity: "error", message: `Wheel package name "${pkg}" must be a lowercase Python identifier.` });
  if (!wheelDir || wheelDir.startsWith("/") || /^[A-Za-z]:/.test(wheelDir) || wheelDir.split("/").includes("..")) {
    issues.push({ severity: "error", message: "wheelDirectory must be repository-relative, without '..'." });
  }

  const resolved = resolvedDeps(models, byId);
  const ordered = dependencyOrder(models, resolved);
  const moduleOf = new Map<string, string>();
  for (const r of ordered) {
    const module = pythonModuleName(r.model.name);
    const clash = [...moduleOf].find(([, m]) => m === module);
    if (clash) issues.push({ severity: "error", message: `dbt models ${clash[0]} and ${r.model.uniqueId} map to the same Python module "${module}".` });
    moduleOf.set(r.model.uniqueId, module);
  }

  const unit: SparkJobUnit = {
    kind: "spark-job-definition",
    name: jobName,
    description: `dbt project ${project.projectName ?? project.projectDir} materialized as a Spark job (proposal).`,
    mainFile: "main.py",
    mainSource: entryScript(pkg),
    defaultLakehouse: env.lakehouse
  };
  candidate.units = [unit];
  const generated = generateCandidateFiles(candidate);

  const src = `${wheelDir}/src/${pkg}`;
  const bodies: Array<[string, string]> = [
    [`${wheelDir}/pyproject.toml`, pyproject(pkg, input.wheelVersion ?? "0.1.0", project.projectName ?? project.projectDir)],
    [`${src}/__init__.py`, `"""dbt project ${project.projectName ?? project.projectDir} as a Spark job package. Generated by DataPass (proposal)."""\n`],
    [`${src}/models/__init__.py`, '"""One module per materialized dbt model."""\n'],
    [`${src}/runner.py`, runnerModule(ordered.map(r => moduleOf.get(r.model.uniqueId)!), jobName)],
    [`${wheelDir}/tests/test_models.py`, testsStub(pkg)]
  ];
  const modules: DbtSparkJobResult["modules"] = [];
  for (const r of ordered) {
    const module = moduleOf.get(r.model.uniqueId)!;
    const path = `${src}/models/${module}.py`;
    const deps = (resolved.get(r.model.uniqueId) ?? []).map(d => moduleOf.get(d)!).sort();
    bodies.push([path, modelModule(r, deps)]);
    modules.push({ modelId: r.model.uniqueId, module, path });
  }
  const wheelFiles: GeneratedFile[] = [];
  for (const [path, body] of bodies) {
    const stamp = makeStamp({
      sourceLogicalId: `${candidate.logicalId}#${jobName}`,
      sourceRevision: candidate.revision,
      targetPlatform: "fabric",
      nativeKind: "spark-job-definition",
      environment: candidate.environment
    }, body);
    if (supportsInlineStamp(path)) {
      wheelFiles.push({ path, content: `${inlineStampLine(stamp)}\n${body}`, role: "item", unit: jobName, stamp });
    } else {
      wheelFiles.push({ path, content: body, role: "item", unit: jobName, stamp });
      wheelFiles.push({ path: sidecarPath(path), content: renderSidecar(stamp), role: "sidecar", unit: jobName, stamp });
    }
  }
  const files = [...generated, ...wheelFiles].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  issues.push(...validateGeneration(candidate, files));
  return {
    candidate, files, modules, holes, issues,
    nextActions: [
      `Build the wheel in your own CI from ${wheelDir} (DataPass never builds it).`,
      `Attach the wheel to the Fabric environment of the Spark job "${jobName}", then deploy with your own tool (fabric-cicd or Fabric Git).`
    ]
  };
}

export type DbtTargetResult =
  | ({ target: "fabric-notebook" } & DbtMaterializeResult)
  | ({ target: "spark-job-definition" } & DbtSparkJobResult);

/** The `target` choice of TL-5: one dbt input, either MAT1 target. Default: notebook. */
export function materializeDbt(input: DbtSparkJobInput & { target?: MaterializationTarget }): DbtTargetResult {
  const target = input.target ?? DEFAULT_MATERIALIZATION_TARGET;
  return target === "spark-job-definition"
    ? { target, ...materializeDbtSparkJob(input) }
    : { target: "fabric-notebook", ...materializeDbtModels(input) };
}

/** MAT1 diff of the SJD + wheel set: hand-edited or foreign files are blocked unless the user explicitly overwrites. */
export function previewDbtSparkJobDiff(result: DbtSparkJobResult, existing: ReadonlyMap<string, string>, overwriteDetached = false): DiffEntry[] {
  return previewDiff(result.files, existing, overwriteDetached);
}
