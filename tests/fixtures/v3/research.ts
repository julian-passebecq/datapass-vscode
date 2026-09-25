/**
 * Synthetic V3 project A (no FOIL content): a multi-repository document pipeline
 * (Blob → Data Factory → Azure Function → Cosmos DB → review → MongoDB Atlas), a Databricks lab
 * whose repository is not cloned, and a planned infrastructure repository. Shared by the unit
 * tests, the Workbench preview and the desktop fixtures.
 */
import { COORDINATION_KEY, obsKey, type FileObservation, type RepoObservation } from "../../../src/core/project/resolve";
import { parseGraph, type ProjectGraph } from "../../../src/core/workspace/graph";
import type { DataPassProjectManifest } from "../../../src/core/projectManifestModel";
import type { ProjectMapInput } from "../../../src/core/project/projectMap";


export function manifestA(): DataPassProjectManifest {
  return {
    schemaVersion: 3,
    project: { id: "research-library", title: "Research library", description: "Find answers in papers, cite the PDF and page." },
    repositories: {
      pipeline: { label: "Document pipeline", remote: { url: "https://github.com/example-org/research-pipeline", branch: "main" }, description: "ADF, Functions, Cosmos and Mongo definitions" },
      lab: { label: "Simulation lab", remote: { url: "git@github.com:example-org/research-lab.git" } },
      infra: { label: "Archive infrastructure", planned: true, remote: { url: "https://github.com/example-org/research-infra" } }
    },
    environments: [{ id: "dev", title: "Development" }, { id: "prod", title: "Production", production: true }],
    graph: ".datapass/graph.json",
    scopes: [
      { id: "papers", title: "Papers pipeline", objective: "PDF to reviewed JSON in MongoDB", repoRef: "pipeline", itemRefs: ["pdf-archive", "adf", "extract", "cosmos", "review", "study-db"],
        checklist: [{ id: "inventory", label: "Inventory the PDFs and reading rights" }] },
      { id: "lab", title: "Simulation lab", itemRefs: ["lab-bundle", "infra-store"] }
    ]
  };
}

export function graphA(): ProjectGraph {
  return parseGraph(JSON.stringify(graphAJson()));
}

export function graphAJson(): Record<string, unknown> {
  return ({
    format: "datapass.graph", version: "0.2",
    items: [
      { id: "pdf-archive", kind: "storage", label: "PDF archive", provider: "azure-storage", status: "planned" },
      { id: "adf", kind: "pipeline", label: "Build candidates pipeline", provider: "azure-data-factory",
        artifacts: { profile: "adf.factory", root: "adf", entry: "pipeline/build_candidates.json" },
        operations: [{ capability: "adf.studio.open" }, { capability: "adf.validate" }, { capability: "adf.publish", environment: "dev" }] },
      { id: "extract", kind: "function", label: "PDF extraction", provider: "azure-functions", description: "Reads a PDF, keeps page numbers.",
        artifacts: { profile: "azure-functions.python", root: "functions/extract", files: ["tests/test_extract.py"] },
        operations: [{ capability: "python.tests.run" }, { capability: "azure-functions.run-local" }, { capability: "azure-functions.deploy", environment: "dev", target: { functionApp: "func-papers-dev" } }],
        checklist: [{ id: "pages", label: "Keep physical page numbers" }] },
      { id: "cosmos", kind: "database", label: "Cosmos staging", provider: "cosmos-nosql", artifacts: { profile: "cosmos-nosql.container", root: "cosmos" } },
      { id: "review", kind: "step", label: "Human review", provider: "manual", checklist: [{ id: "batch", label: "Review the candidate batch" }] },
      { id: "study-db", kind: "database", label: "Published knowledge", provider: "mongodb-atlas", artifacts: { profile: "mongodb.database", root: "mongo" } },
      { id: "lab-bundle", kind: "artifact-bundle", label: "Lab bundle", provider: "databricks",
        artifacts: { repoRef: "lab", profile: "databricks.bundle", root: ".", generated: [{ path: ".lab/build/**", producer: "lab campaign compiler", how: "compile, then apply the campaign" }] },
        operations: [{ capability: "databricks.bundle.validate" }, { capability: "databricks.bundle.deploy", environment: "dev" }] },
      { id: "infra-store", kind: "infrastructure-definition", label: "Archive storage (IaC)", provider: "terraform", artifacts: { repoRef: "infra", profile: "terraform", root: "." } }
    ],
    relations: [
      { id: "r1", source: "adf", target: "extract", relation: "orchestrates" },
      { id: "r2", source: "extract", target: "pdf-archive", relation: "consumes" },
      { id: "r3", source: "extract", target: "cosmos", relation: "produces" },
      { id: "r4", source: "review", target: "cosmos", relation: "consumes" },
      { id: "r5", source: "review", target: "study-db", relation: "produces" }
    ]
  });
}

export const repoObsA = (): Map<string, RepoObservation> => new Map([
  [COORDINATION_KEY, { key: COORDINATION_KEY, source: "coordination", exists: true, isGitRepo: true, git: { branch: "main", head: "a".repeat(40), upstream: "origin/main", ahead: 0, behind: 0, changes: 0 } }],
  ["pipeline", { key: "pipeline", folder: "/work/research-pipeline", source: "sibling-folder", exists: true, isGitRepo: true, git: { branch: "main", head: "b".repeat(40), upstream: "origin/main", ahead: 0, behind: 2, changes: 0, trackedChanges: 0, originUrl: "https://github.com/Example-Org/research-pipeline.git" } }]
]);

export function fileObsA(extra: Record<string, FileObservation> = {}): Map<string, FileObservation> {
  const found = (sha?: string): FileObservation => ({ state: "found", kind: "file", sha256: sha });
  const dir = (count = 1): FileObservation => ({ state: "found", kind: "dir", count });
  const missing: FileObservation = { state: "missing" };
  const entries: Record<string, FileObservation> = {
    "functions/extract": dir(), "functions/extract/function_app.py": found("f1"), "functions/extract/host.json": found("h1"),
    "functions/extract/requirements.txt": missing, "functions/extract/.funcignore": missing, "functions/extract/tests": dir(),
    "functions/extract/tests/test_extract.py": found("t1"), "functions/extract/local.settings.json": { state: "missing", tracked: false },
    adf: dir(), "adf/pipeline": dir(2), "adf/pipeline/build_candidates.json": found("p1"), "adf/linkedService": missing, "adf/dataset": missing, "adf/trigger": missing,
    cosmos: dir(), "cosmos/containers": dir(), "cosmos/queries": missing,
    mongo: missing, "mongo/schemas": missing, "mongo/playgrounds": missing,
    ...extra
  };
  return new Map(Object.entries(entries).map(([p, o]) => [obsKey("pipeline", p), o]));
}

export function inputA(over: Partial<ProjectMapInput> = {}): ProjectMapInput {
  return {
    manifest: manifestA(), graph: graphA(), coordinationKey: COORDINATION_KEY,
    repoObservations: repoObsA(), fileObservations: fileObsA(), tools: new Map(), facts: new Map(),
    reviewsConfirmed: new Set(), checklist: {}, qualification: [], ...over
  };
}
