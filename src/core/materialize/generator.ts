/**
 * Materialization (V4 MAT1, brief § 27): architecture candidate → candidate native Fabric files, in
 * the Fabric Git folder format (`<Name>.<Type>/.platform` + the item definition). Pure and
 * deterministic: no clock, no randomness, fixed key and file order, LF line endings.
 *
 *   generateCandidateFiles(candidate)  → GeneratedFile[] (each stamped, see ./stamp)
 *   validateGeneration(candidate, files) → issues (names, references, cycles, stamps)
 *
 * The output is a *candidate*: it is written to a branch and reviewed as a Git diff before a native
 * tool deploys it. Nothing here calls a provider. Fabric item ids are unknown until deployment, so
 * items reference each other by their `.platform` logicalId (a GUID derived from the source id and
 * the unit name), which fabric-cicd and Fabric Git resolve at deploy time.
 */
import { createHash } from "node:crypto";
import {
  type NativeKind,
  type ProvenanceStamp,
  inlineStampLine,
  makeStamp,
  renderSidecar,
  sidecarPath,
  supportsInlineStamp,
  verifyStamp
} from "./stamp";

// --- Candidate (local contract; lift to a Common `materialize-contracts` package later) ------------

export interface NotebookUnit {
  kind: "notebook";
  name: string;
  description?: string;
  /** Code cells (PySpark). A cell is untrusted text and is written as-is, never executed. */
  cells: string[];
  /** Default lakehouse, by name (resolved by the native tool / parameter file per environment). */
  defaultLakehouse?: string;
}

export interface SparkJobUnit {
  kind: "spark-job-definition";
  name: string;
  description?: string;
  /** File name of the main definition file, e.g. `main.py`. */
  mainFile: string;
  /** Body of the main file (stub when omitted). */
  mainSource?: string;
  commandLineArguments?: string;
  defaultLakehouse?: string;
}

export interface PipelineActivity {
  name: string;
  /** Name of the notebook or Spark job unit this activity runs (same candidate). */
  runs: string;
  dependsOn?: string[];
}

export interface PipelineUnit {
  kind: "data-pipeline";
  name: string;
  description?: string;
  activities: PipelineActivity[];
}

export type CandidateUnit = NotebookUnit | SparkJobUnit | PipelineUnit;

export interface ArchitectureCandidate {
  /** Logical id of the candidate in the architecture model. */
  logicalId: string;
  /** Exact source revision (Git SHA or candidate digest). */
  revision: string;
  environment: string;
  /** Repository-relative folder the Fabric items go in (e.g. `fabric`). */
  rootDirectory: string;
  units: CandidateUnit[];
}

export interface GeneratedFile {
  /** Repository-relative, forward slashes. */
  path: string;
  content: string;
  /** "item" = a native file; "sidecar" = the provenance sidecar of a native file. */
  role: "item" | "sidecar";
  unit: string;
  stamp: ProvenanceStamp;
}

const FABRIC_TYPE: Record<NativeKind, string> = {
  "notebook": "Notebook",
  "spark-job-definition": "SparkJobDefinition",
  "data-pipeline": "DataPipeline"
};

const PLATFORM_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json";
const PLACEHOLDER_WORKSPACE = "00000000-0000-0000-0000-000000000000";

/** A deterministic GUID-shaped id for a unit (name-based, version nibble 5 as in RFC 4122 § 4.3). */
export function unitLogicalId(candidateLogicalId: string, unitName: string): string {
  const h = createHash("sha256").update(`${candidateLogicalId}\u0000${unitName}`, "utf8").digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function itemFolder(candidate: ArchitectureCandidate, unit: CandidateUnit): string {
  const root = candidate.rootDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${root ? `${root}/` : ""}${unit.name}.${FABRIC_TYPE[unit.kind]}`;
}

/** Candidate native files, stamped, in a stable order (units by kind then name; files by path). */
export function generateCandidateFiles(candidate: ArchitectureCandidate): GeneratedFile[] {
  const out: GeneratedFile[] = [];
  const byName = new Map(candidate.units.map(u => [u.name, u]));
  for (const unit of sortedUnits(candidate.units)) {
    const folder = itemFolder(candidate, unit);
    const bodies: Array<[string, string]> = [[`${folder}/.platform`, platformFile(candidate, unit)]];
    if (unit.kind === "notebook") bodies.push([`${folder}/notebook-content.py`, notebookContent(unit)]);
    else if (unit.kind === "spark-job-definition") {
      bodies.push([`${folder}/SparkJobDefinitionV1.json`, sparkJobDefinition(unit)]);
      bodies.push([`${folder}/Main/${unit.mainFile}`, sparkMainFile(unit)]);
    } else bodies.push([`${folder}/pipeline-content.json`, pipelineContent(candidate, unit, byName)]);

    for (const [path, body] of bodies) {
      const stamp = makeStamp({
        sourceLogicalId: `${candidate.logicalId}#${unit.name}`,
        sourceRevision: candidate.revision,
        targetPlatform: "fabric",
        nativeKind: unit.kind,
        environment: candidate.environment
      }, body);
      if (supportsInlineStamp(path)) {
        out.push({ path, content: withInlineStamp(body, stamp), role: "item", unit: unit.name, stamp });
      } else {
        out.push({ path, content: body, role: "item", unit: unit.name, stamp });
        out.push({ path: sidecarPath(path), content: renderSidecar(stamp), role: "sidecar", unit: unit.name, stamp });
      }
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function sortedUnits(units: CandidateUnit[]): CandidateUnit[] {
  const order: NativeKind[] = ["notebook", "spark-job-definition", "data-pipeline"];
  return [...units].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The stamp goes on the line after the first line (Fabric's `# Fabric notebook source` header stays first). */
function withInlineStamp(body: string, stamp: ProvenanceStamp): string {
  const nl = body.indexOf("\n");
  const first = nl < 0 ? body : body.slice(0, nl);
  const rest = nl < 0 ? "" : body.slice(nl + 1);
  if (first.startsWith("# Fabric notebook source")) return `${first}\n${inlineStampLine(stamp)}\n${rest}`;
  return `${inlineStampLine(stamp)}\n${body}`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function platformFile(candidate: ArchitectureCandidate, unit: CandidateUnit): string {
  return json({
    $schema: PLATFORM_SCHEMA,
    metadata: { type: FABRIC_TYPE[unit.kind], displayName: unit.name, description: unit.description ?? "" },
    config: { version: "2.0", logicalId: unitLogicalId(candidate.logicalId, unit.name) }
  });
}

function notebookContent(unit: NotebookUnit): string {
  const meta = {
    kernel_info: { name: "synapse_pyspark" },
    dependencies: unit.defaultLakehouse ? { lakehouse: { default_lakehouse_name: unit.defaultLakehouse } } : {}
  };
  const lines = ["# Fabric notebook source", "", "# METADATA ********************", ""];
  for (const l of JSON.stringify(meta, null, 2).split("\n")) lines.push(`# META ${l}`);
  const cells = unit.cells.length ? unit.cells : ["# TODO: generated stub, add the transformation"];
  for (const cell of cells) {
    lines.push("", "# CELL ********************", "", ...cell.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n"));
  }
  return `${lines.join("\n")}\n`;
}

function sparkJobDefinition(unit: SparkJobUnit): string {
  return json({
    executableFile: `Main/${unit.mainFile}`,
    defaultLakehouseArtifactId: null,
    mainClass: null,
    additionalLakehouseIds: [],
    retryPolicy: null,
    commandLineArguments: unit.commandLineArguments ?? "",
    additionalLibraryUris: [],
    language: "Python",
    environmentArtifactId: null
  });
}

function sparkMainFile(unit: SparkJobUnit): string {
  const src = unit.mainSource ?? [
    "from pyspark.sql import SparkSession",
    "",
    "",
    "def main() -> None:",
    `    spark = SparkSession.builder.appName(${JSON.stringify(unit.name)}).getOrCreate()`,
    "    # TODO: generated stub, add the job logic",
    "    spark.stop()",
    "",
    "",
    "if __name__ == \"__main__\":",
    "    main()"
  ].join("\n");
  return `${src.replace(/\r\n?/g, "\n").replace(/\n+$/, "")}\n`;
}

function pipelineContent(candidate: ArchitectureCandidate, unit: PipelineUnit, byName: Map<string, CandidateUnit>): string {
  const activities = unit.activities.map(a => {
    const target = byName.get(a.runs);
    const id = unitLogicalId(candidate.logicalId, a.runs);
    const isJob = target?.kind === "spark-job-definition";
    return {
      name: a.name,
      type: isJob ? "SparkJobDefinition" : "TridentNotebook",
      dependsOn: (a.dependsOn ?? []).map(d => ({ activity: d, dependencyConditions: ["Succeeded"] })),
      policy: { timeout: "0.12:00:00", retry: 0, retryIntervalInSeconds: 30, secureInput: false, secureOutput: false },
      typeProperties: isJob
        ? { sparkJobDefinitionId: id, workspaceId: PLACEHOLDER_WORKSPACE }
        : { notebookId: id, workspaceId: PLACEHOLDER_WORKSPACE }
    };
  });
  return json({ properties: { activities } });
}

// --- Validate ------------------------------------------------------------------------------------

export interface ValidationIssue {
  severity: "error" | "warning";
  unit?: string;
  path?: string;
  message: string;
}

const FORBIDDEN_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

/** Checks the candidate and the generated set; an empty error list means the set may go to a branch. */
export function validateGeneration(candidate: ArchitectureCandidate, files: GeneratedFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string, unit?: string, path?: string) => issues.push({ severity: "error", unit, path, message });

  if (!candidate.logicalId.trim()) err("Candidate logicalId is required.");
  if (!candidate.revision.trim()) err("Candidate revision is required (exact Git SHA or digest).");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(candidate.environment)) err("Environment must be 1-64 letters, digits, '-' or '_'.");
  const root = candidate.rootDirectory.replace(/\\/g, "/");
  if (root.startsWith("/") || /^[A-Za-z]:/.test(root) || root.split("/").includes("..")) err("rootDirectory must be repository-relative, without '..'.");

  const seen = new Set<string>();
  for (const u of candidate.units) {
    if (!u.name.trim() || u.name !== u.name.trim() || u.name.length > 256 || FORBIDDEN_NAME.test(u.name) || u.name.endsWith(".")) {
      err(`Unit name "${u.name}" is not a valid Fabric item name.`, u.name);
    }
    if (seen.has(u.name)) err(`Duplicate unit name "${u.name}".`, u.name);
    seen.add(u.name);
    if (u.kind === "spark-job-definition" && !/^[A-Za-z0-9_.-]{1,128}\.py$/.test(u.mainFile)) {
      err(`Spark job main file "${u.mainFile}" must be a plain .py file name.`, u.name);
    }
    if (u.kind === "data-pipeline") validatePipeline(u, candidate, err);
  }

  for (const f of files) {
    if (f.role !== "item") continue;
    const sidecar = files.find(s => s.role === "sidecar" && s.path === sidecarPath(f.path));
    const { verdict } = verifyStamp(f.path, f.content, sidecar?.content);
    if (verdict !== "intact") err(`Generated file is not ${verdict === "detached" ? "matching its stamp" : "stamped"}.`, f.unit, f.path);
  }
  return issues;
}

function validatePipeline(p: PipelineUnit, candidate: ArchitectureCandidate, err: (m: string, u?: string) => void): void {
  const names = new Set(p.activities.map(a => a.name));
  if (names.size !== p.activities.length) err(`Pipeline "${p.name}" has duplicate activity names.`, p.name);
  for (const a of p.activities) {
    const target = candidate.units.find(u => u.name === a.runs);
    if (!target) err(`Activity "${a.name}" runs "${a.runs}", which is not a unit of this candidate.`, p.name);
    else if (target.kind === "data-pipeline") err(`Activity "${a.name}" runs a pipeline; only notebooks and Spark jobs are supported.`, p.name);
    for (const d of a.dependsOn ?? []) if (!names.has(d)) err(`Activity "${a.name}" depends on unknown activity "${d}".`, p.name);
  }
  // Cycle check (depth-first on dependsOn).
  const deps = new Map(p.activities.map(a => [a.name, a.dependsOn ?? []]));
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 2) return false;
    if (state.get(n) === 1) return true;
    state.set(n, 1);
    const cyclic = (deps.get(n) ?? []).some(d => deps.has(d) && visit(d));
    state.set(n, 2);
    return cyclic;
  };
  if (p.activities.some(a => visit(a.name))) err(`Pipeline "${p.name}" has a dependency cycle.`, p.name);
}
