/**
 * V3 project model: repositories, expected files, component operations, sub-project needs,
 * cross-document problems, diagram layout, preparation pack. Two synthetic projects:
 *   A. a multi-repository document pipeline (Blob → ADF → Azure Function → Cosmos DB → review → MongoDB)
 *      plus a Databricks lab whose repository is not cloned, and a planned repository;
 *   B. a non-FOIL monorepo (Python → PostgreSQL/Neon), no Azure, no Mongo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectMap, operationKey, type ProjectMapInput } from "../src/core/project/projectMap";
import { artifactPlan, COORDINATION_KEY, normalizeRemote, obsKey, sameRemote, type FileObservation, type RepoObservation } from "../src/core/project/resolve";
import { parseGraph, type ProjectGraph } from "../src/core/workspace/graph";
import { validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import type { ToolObservation } from "../src/core/capabilities/tools";
import { layoutGraph } from "../src/core/project/layout";
import { buildPreparationPack } from "../src/core/project/preparation";
import { changedComponents, parseIncomingLog, parseNameStatus, syncVerdict } from "../src/core/project/gitSync";
import { mergeCatalogs, parseCatalog } from "../src/core/project/catalog";
import { upsertQualification } from "../src/core/qualification/qualification";
import { fileObsA, graphA, inputA, manifestA, repoObsA } from "./fixtures/v3/research";

const T = "2026-09-25T10:00:00Z";
const tools = (...present: string[]) => new Map<string, ToolObservation>(present.map(id => [id, { toolId: id, state: "present", observedAt: T }]));

test("A: the manifest and graph are valid V3 documents", () => {
  assert.deepEqual(validateProjectManifest(manifestA()), []);
  assert.equal(graphA().version, "0.2");
});

test("A: repositories are local, unbound (not cloned) or planned — never guessed from a folder name", () => {
  const map = buildProjectMap(inputA());
  const state = Object.fromEntries(map.repositories.map(r => [r.key, r.state]));
  assert.deepEqual(state, { ".": "local", pipeline: "local", lab: "unbound", infra: "planned" });
  const pipeline = map.repositories.find(r => r.key === "pipeline")!;
  assert.equal(pipeline.remote, "github.com/example-org/research-pipeline");
  assert.match(pipeline.detail, /2 to get/);
  assert.deepEqual(pipeline.usedBy.sort(), ["adf", "cosmos", "extract", "study-db"]);
  // A clone whose origin is another repository is refused.
  const wrong = repoObsA();
  wrong.set("pipeline", { ...wrong.get("pipeline")!, git: { ...wrong.get("pipeline")!.git, originUrl: "https://github.com/someone-else/research-pipeline" } });
  assert.equal(buildProjectMap(inputA({ repoObservations: wrong })).repositories.find(r => r.key === "pipeline")!.state, "wrong-remote");
});

test("A: expected files come from the profile plus declarations; missing is not unbound", () => {
  const map = buildProjectMap(inputA());
  const extract = map.components.find(c => c.id === "extract")!;
  const a = extract.artifacts!;
  assert.equal(a.repoKey, "pipeline", "inherits the scope's repository");
  assert.equal(a.profile.id, "azure-functions.python");
  assert.equal(a.entry?.path, "function_app.py");
  assert.equal(a.availability, "incomplete");
  const byPath = Object.fromEntries(a.files.map(f => [f.path, f.state]));
  assert.equal(byPath["function_app.py"], "found");
  assert.equal(byPath["requirements.txt"], "missing");
  assert.equal(byPath[".funcignore"], "missing");
  assert.equal(a.files.find(f => f.path === ".funcignore")!.optional, true, "recommended, never blocking");
  assert.deepEqual(a.summary, { expected: 4, found: 3, missing: 1, generatedMissing: 0, optionalMissing: 1 });
  assert.equal(extract.health, "blocked");
  assert.match(extract.nextStep, /requirements\.txt/);
  // The lab bundle's repository is not cloned: its files are unbound (unknown), not missing.
  const lab = map.components.find(c => c.id === "lab-bundle")!;
  assert.equal(lab.artifacts!.availability, "unbound");
  assert.ok(lab.artifacts!.files.every(f => f.state === "unbound"));
  assert.match(lab.nextStep, /Clone github\.com\/example-org\/research-lab/);
  assert.equal(map.components.find(c => c.id === "infra-store")!.health, "planned");
});

test("A: each operation has its own prerequisites (read ≠ test ≠ deploy)", () => {
  const map = buildProjectMap(inputA({ tools: tools("cli.python", "cli.func") }));
  const ops = Object.fromEntries(map.components.find(c => c.id === "extract")!.operations.map(o => [o.capability.id, o]));
  assert.equal(ops["generic.files.open"]!.result.status, "ready", "reading needs no account and no tool");
  assert.equal(ops["python.tests.run"]!.result.status, "blocked");
  assert.ok(ops["python.tests.run"]!.result.blockers.some(b => b.kind === "file" && /requirements\.txt/.test(b.detail)));
  const deploy = ops["azure-functions.deploy"]!;
  assert.equal(deploy.key, operationKey("extract", "azure-functions.deploy", "dev"));
  assert.equal(deploy.result.status, "blocked");
  assert.ok(deploy.result.satisfied.some(s => s.kind === "target" && /Development/.test(s.label)));
  // Once the AI's file is in the repository, testing is ready; deploying still needs the tool and the reviews.
  const updated = buildProjectMap(inputA({ tools: tools("cli.python", "cli.func", "ext.azure-functions"), fileObservations: fileObsA({ "functions/extract/requirements.txt": { state: "found", kind: "file", sha256: "r1" } }) }));
  const ops2 = Object.fromEntries(updated.components.find(c => c.id === "extract")!.operations.map(o => [o.capability.id, o]));
  assert.equal(ops2["python.tests.run"]!.result.status, "ready");
  assert.deepEqual(ops2["python.tests.run"]!.command, { text: "python -m pytest", cwd: "functions/extract" });
  assert.equal(ops2["azure-functions.deploy"]!.result.status, "needs-review");
  // A deploy without an environment is blocked with a precise instruction.
  const g = graphA();
  g.items.find(i => i.id === "adf")!.operations!.push({ capability: "adf.publish" });
  const noEnv = buildProjectMap(inputA({ graph: g })).components.find(c => c.id === "adf")!.operations.find(o => o.capability.id === "adf.publish" && !o.environmentId)!;
  assert.ok(noEnv.result.blockers.some(b => b.kind === "target" && /environment/.test(b.detail)));
});

test("A: reviews are bound to the component's files and target (a new file version asks again)", () => {
  const withReq = fileObsA({ "functions/extract/requirements.txt": { state: "found", kind: "file", sha256: "r1" } });
  const base = inputA({ tools: tools("cli.python", "cli.func", "ext.azure-functions"), fileObservations: withReq });
  const deploy = buildProjectMap(base).components.find(c => c.id === "extract")!.operations.find(o => o.capability.id === "azure-functions.deploy")!;
  const confirmed = new Set(Object.values(deploy.result.reviewKeys));
  assert.equal(buildProjectMap({ ...base, reviewsConfirmed: confirmed }).components.find(c => c.id === "extract")!.operations.find(o => o.capability.id === "azure-functions.deploy")!.result.status, "ready");
  const changed = fileObsA({ "functions/extract/requirements.txt": { state: "found", kind: "file", sha256: "r2" } });
  const after = buildProjectMap({ ...base, reviewsConfirmed: confirmed, fileObservations: changed }).components.find(c => c.id === "extract")!.operations.find(o => o.capability.id === "azure-functions.deploy")!;
  assert.equal(after.result.status, "needs-review", "the reviewed files changed");
});

test("A: remote-only operations do not need the clone; generated outputs need their producer", () => {
  const map = buildProjectMap(inputA({ tools: tools("cli.databricks") }));
  const adf = map.components.find(c => c.id === "adf")!;
  assert.equal(adf.operations.find(o => o.capability.id === "adf.studio.open")!.result.status, "ready");
  assert.ok(adf.operations.find(o => o.capability.id === "adf.validate")!.result.blockers.some(b => /linkedService/.test(b.label)), "validate needs the linked services");
  // Clone the lab: the bundle file is there, the generated campaign is not.
  const repos = repoObsA();
  repos.set("lab", { key: "lab", folder: "/work/research-lab", source: "sibling-folder", exists: true, isGitRepo: true, git: { branch: "main", head: "c".repeat(40), upstream: "origin/main", ahead: 0, behind: 0, changes: 0, originUrl: "git@github.com:example-org/research-lab.git" } });
  const files = fileObsA();
  files.set(obsKey("lab", ""), { state: "found", kind: "dir" });
  files.set(obsKey("lab", "databricks.yml"), { state: "found", kind: "file", sha256: "d1" });
  files.set(obsKey("lab", ".lab/build"), { state: "missing" });
  const lab = buildProjectMap(inputA({ tools: tools("cli.databricks"), repoObservations: repos, fileObservations: files })).components.find(c => c.id === "lab-bundle")!;
  assert.equal(lab.artifacts!.availability, "generation-needed");
  const validate = lab.operations.find(o => o.capability.id === "databricks.bundle.validate")!;
  assert.equal(validate.result.status, "blocked");
  assert.match(validate.result.blockers[0]!.detail, /lab campaign compiler/);
  assert.match(lab.nextStep, /Generate \.lab\/build\/\*\* with lab campaign compiler/);
});

test("A: each sub-project says which repositories and tools are still needed", () => {
  const map = buildProjectMap(inputA({ tools: tools("cli.python") }));
  const papers = map.subprojects.find(s => s.id === "papers")!;
  assert.deepEqual(papers.componentIds, ["pdf-archive", "adf", "extract", "cosmos", "review", "study-db"]);
  assert.equal(papers.needs.repositories.length, 0);
  const toolLabels = papers.needs.tools.map(t => t.label);
  assert.ok(toolLabels.some(l => /Azure Cosmos DB/.test(l)), toolLabels.join(" | "));
  assert.ok(papers.needs.tools.find(t => /Azure Cosmos DB/.test(t.label))!.extensionIds.includes("ms-azuretools.vscode-cosmosdb"));
  const lab = map.subprojects.find(s => s.id === "lab")!;
  assert.deepEqual(lab.needs.repositories.map(r => [r.key, r.state]).sort(), [["infra", "planned"], ["lab", "unbound"]]);
  assert.equal(map.summary.reposToBind, 2);
  assert.match(map.nextStep, /Simulation lab: Clone/);
});

test("A: cross-document problems (F10) are reported precisely", () => {
  const g = graphA();
  g.items.push({ id: "ghost", kind: "script", label: "Ghost", repoRef: "nowhere", path: "x.py" });
  g.items.find(i => i.id === "extract")!.operations!.push({ capability: "azure-functions.deploy", environment: "staging" }, { capability: "vendor.magic.do" });
  const m = manifestA();
  m.scopes![0]!.itemRefs!.push("missing-item");
  const map = buildProjectMap(inputA({ graph: g, manifest: m }));
  const text = map.problems.map(p => `${p.severity} ${p.where}: ${p.message}`).join("\n");
  assert.match(text, /error graph\.json items\.ghost: repoRef "nowhere" is not a repository declared/);
  assert.match(text, /error project\.json scopes\.papers: itemRefs names "missing-item"/);
  assert.match(text, /environment "staging", which project\.json does not declare/);
  assert.match(text, /"vendor\.magic\.do" is not known to this DataPass version \(unsupported\)/);
  assert.match(text, /info graph\.json: 1 component\(s\) belong to no sub-project/);
});

test("A: a web $schema is explained (it replaces the bundled schema); a local one is not", () => {
  const remote = buildProjectMap(inputA({ manifest: { $schema: "https://raw.githubusercontent.com/org/repo/main/p.schema.json", ...manifestA() } }));
  const hint = remote.problems.filter(p => p.message.startsWith('"$schema" points to a web address'));
  assert.deepEqual(hint.map(p => `${p.severity} ${p.where}`), ["info project.json"]);
  assert.match(hint[0]!.message, /Remove the "\$schema" line/);
  assert.equal(buildProjectMap(inputA()).problems.some(p => p.message.includes("$schema")), false);
  const local = buildProjectMap(inputA({ manifest: { $schema: "../schemas/datapass-project.schema.json", ...manifestA() } }));
  assert.equal(local.problems.some(p => p.message.includes("$schema")), false);
});

test("A: diagram layout follows the data flow left to right", () => {
  const map = buildProjectMap(inputA());
  const papers = map.subprojects.find(s => s.id === "papers")!;
  const edges = map.relations.filter(r => papers.componentIds.includes(r.from) && papers.componentIds.includes(r.to));
  const layout = layoutGraph(papers.componentIds, edges.map(r => ({ id: r.id, from: r.from, to: r.to, flow: r.flow })));
  const layer = Object.fromEntries(layout.nodes.map(n => [n.id, n.layer]));
  assert.ok(layer["pdf-archive"]! < layer["extract"]!);
  assert.ok(layer["extract"]! < layer["cosmos"]!);
  assert.ok(layer["cosmos"]! < layer["review"]!);
  assert.ok(layer["review"]! < layer["study-db"]!);
  assert.equal(layer["adf"], layer["extract"]! - 1, "the orchestrator sits just before what it runs");
  assert.ok(layout.edges.every(e => e.path.startsWith("M")));
  assert.deepEqual(layoutGraph(["a", "b"], [{ id: "x", from: "a", to: "b", flow: "data" }, { id: "y", from: "b", to: "a", flow: "data" }]).edges.filter(e => e.backward).length, 1, "cycles draw one edge backwards");
  // Deterministic.
  assert.deepEqual(layoutGraph(papers.componentIds, edges), layoutGraph(papers.componentIds, edges));
});

test("A: the preparation pack names repos, paths and blockers, never local paths or secrets", () => {
  const map = buildProjectMap(inputA({ tools: tools("cli.python") }));
  const pack = buildPreparationPack({ map, componentId: "extract", question: "prepare-missing", dataPassVersion: "0.13.0", generatedAt: T, revisions: { pipeline: "main@bbbbbbb" }, guideUrl: "https://github.com/julian-passebecq/datapass-vscode/blob/main/docs/PREPARING_A_PROJECT.md" });
  assert.match(pack.text, /Prepare the missing files/);
  assert.match(pack.text, /repository `pipeline` \(github\.com\/example-org\/research-pipeline\), folder `functions\/extract`/);
  assert.match(pack.text, /\[missing\] `requirements\.txt` \(dependencies\) — needed to develop, test, deploy, run/);
  assert.match(pack.text, /must never be committed: `local\.settings\.json`/);
  assert.match(pack.text, /Deploy \(dev\) — Deploy the Function App to Azure: \*\*blocked\*\*/);
  assert.ok(!pack.text.includes("/work/research-pipeline"), "no local folder");
  assert.ok(pack.sections.includes("Rules for your answer"));
  const g = graphA();
  g.items.find(i => i.id === "extract")!.description = 'Uses {"token": "DUMMY_SECRET_VALUE"} in C:\\Users\\someone\\file';
  const leaky = buildPreparationPack({ map: buildProjectMap(inputA({ graph: g })), componentId: "extract", question: "explain", dataPassVersion: "0.13.0", generatedAt: T });
  assert.ok(!leaky.text.includes("DUMMY_SECRET_VALUE") && !leaky.text.includes("someone"), "scrubbed");
  const sub = buildPreparationPack({ map, subprojectId: "lab", question: "explain", dataPassVersion: "0.13.0", generatedAt: T });
  assert.match(sub.text, /Repositories still needed: Simulation lab \(unbound\)/);
});

test("A: last results are per operation and target, and go stale when the files change", () => {
  const withReq = fileObsA({ "functions/extract/requirements.txt": { state: "found", kind: "file", sha256: "r1" } });
  const base = inputA({ fileObservations: withReq });
  const op = buildProjectMap(base).components.find(c => c.id === "extract")!.operations.find(o => o.capability.id === "azure-functions.deploy")!;
  const artifactDigest = buildProjectMap(base).components.find(c => c.id === "extract")!.artifacts!.digest;
  const records = upsertQualification([], { capabilityId: op.capability.id, label: op.label, result: "worked", projectId: "research-library", scopeId: "project", operationKey: op.key, targetDigest: op.result.targetDigest, artifactDigest, preflight: "ready", at: T, dataPassVersion: "0.13.0", tools: {} });
  assert.equal(buildProjectMap({ ...base, qualification: records }).components.find(c => c.id === "extract")!.operations.find(o => o.key === op.key)!.lastResult?.stale, false);
  const changed = fileObsA({ "functions/extract/requirements.txt": { state: "found", kind: "file", sha256: "r2" } });
  const later = buildProjectMap({ ...base, qualification: records, fileObservations: changed }).components.find(c => c.id === "extract")!.operations.find(o => o.capability.id === "azure-functions.deploy")!;
  assert.equal(later.lastResult?.result, "worked");
  assert.equal(later.lastResult?.stale, true, "the result describes the previous files, not these");
});

// ------------------------------------------------------------------ project B (non-FOIL monorepo)

test("B: a Python → PostgreSQL/Neon monorepo works without Azure, Mongo or FOIL", () => {
  const manifest: DataPassProjectManifest = {
    schemaVersion: 3, project: { id: "catalog-import", title: "Supplier catalogue import" },
    environments: [{ id: "test", title: "Test branch" }],
    graph: ".datapass/graph.json",
    scopes: [{ id: "import", title: "Clean and load the catalogue", itemRefs: ["clean", "db"] }]
  };
  assert.deepEqual(validateProjectManifest(manifest), []);
  const graph = parseGraph(JSON.stringify({
    format: "datapass.graph", version: "0.2",
    items: [
      { id: "clean", kind: "script", label: "Clean the CSV", provider: "python", artifacts: { profile: "python.script", root: "etl", entry: "clean.py", files: ["tests/test_clean.py"] } },
      { id: "db", kind: "database", label: "Catalogue tables", provider: "neon", artifacts: { profile: "postgres.migrations", root: "db" },
        operations: [{ capability: "postgres.browse" }, { capability: "postgres.migrations.apply", environment: "test", target: { branch: "test" } }] }
    ],
    relations: [{ id: "load", source: "clean", target: "db", relation: "feeds" }]
  }));
  const files = new Map<string, FileObservation>([
    [obsKey(".", "etl"), { state: "found", kind: "dir" }], [obsKey(".", "etl/clean.py"), { state: "found", kind: "file", sha256: "c" }],
    [obsKey(".", "etl/tests/test_clean.py"), { state: "found", kind: "file", sha256: "t" }], [obsKey(".", "etl/tests"), { state: "found", kind: "dir" }],
    [obsKey(".", "etl/requirements.txt"), { state: "missing" }],
    [obsKey(".", "db"), { state: "found", kind: "dir" }], [obsKey(".", "db/*.sql"), { state: "found", count: 2 }]
  ]);
  const input: ProjectMapInput = {
    manifest, graph, coordinationKey: ".", fileObservations: files, tools: tools("cli.python", "cli.psql"), facts: new Map(), reviewsConfirmed: new Set(), checklist: {}, qualification: [],
    repoObservations: new Map([[".", { key: ".", source: "coordination", exists: true, isGitRepo: true, git: { branch: "main", head: "d".repeat(40), changes: 0 } }]])
  };
  const map = buildProjectMap(input);
  assert.deepEqual(map.problems, []);
  const clean = map.components.find(c => c.id === "clean")!;
  assert.equal(clean.artifacts!.availability, "complete");
  assert.ok(clean.operations.every(o => o.result.status === "ready"), clean.operations.map(o => `${o.capability.id}:${o.result.status}`).join(", "));
  const apply = map.components.find(c => c.id === "db")!.operations.find(o => o.capability.id === "postgres.migrations.apply")!;
  assert.equal(apply.result.status, "needs-review");
  const reviewed = buildProjectMap({ ...input, reviewsConfirmed: new Set(Object.values(apply.result.reviewKeys)) });
  assert.equal(reviewed.components.find(c => c.id === "db")!.operations.find(o => o.key === apply.key)!.result.status, "ready");
  assert.ok(map.components.every(c => !c.operations.some(o => ["adf", "azure-functions", "cosmos", "mongodb"].includes(o.capability.provider))));
  // The observation plan asks only for these files, in this repository.
  const plan = artifactPlan(graph.items.map(item => ({ item, repoKey: "." })));
  assert.ok(plan.some(p => p.repoPath === "db/*.sql" && p.kind === "glob"));
  assert.ok(plan.every(p => p.repoKey === "."));
});

// ------------------------------------------------------------------ 0.1 graphs, remotes, sync, catalog

test("a 0.1-draft item with repoRef + path still resolves as a one-file component", () => {
  const graph = parseGraph(JSON.stringify({ format: "datapass.graph", version: "0.1-draft", items: [{ id: "dab", kind: "artifact-bundle", label: "DAB", nativeType: "databricks.bundle", repoRef: "databricks", path: "databricks.yml" }] }));
  const manifest: DataPassProjectManifest = { schemaVersion: 2, project: { id: "p", title: "P" }, repositories: { databricks: { remote: { url: "https://github.com/example/dab" }, management: "remote-only" } } };
  const map = buildProjectMap({ manifest, graph, coordinationKey: ".", repoObservations: new Map(), fileObservations: new Map(), tools: new Map(), facts: new Map(), reviewsConfirmed: new Set(), checklist: {}, qualification: [] });
  const dab = map.components[0]!;
  assert.equal(dab.artifacts!.profile.id, "databricks.bundle");
  assert.equal(dab.artifacts!.availability, "unbound");
  assert.ok(dab.operations.some(o => o.capability.id === "databricks.bundle.validate"));
});

test("graph 0.2 fields need version 0.2; targets hold names, never credentials", () => {
  assert.throws(() => parseGraph(JSON.stringify({ format: "datapass.graph", version: "0.1-draft", items: [{ id: "a", kind: "function", label: "A", provider: "azure-functions" }] })), /requires graph version 0\.2/);
  const withTarget = (target: unknown) => JSON.stringify({ format: "datapass.graph", version: "0.2", items: [{ id: "a", kind: "function", label: "A", operations: [{ capability: "azure-functions.deploy", environment: "dev", target }] }] });
  assert.ok(parseGraph(withTarget({ functionApp: "func-a-dev", resourceGroup: "rg-a" })));
  assert.throws(() => parseGraph(withTarget({ connection: "AccountKey=abc" })), /looks like a credential/);
  assert.throws(() => parseGraph(withTarget({ url: "https://user:pw@host/x" })), /looks like a credential/);
  assert.throws(() => parseGraph(JSON.stringify({ format: "datapass.graph", version: "0.2", items: [{ id: "a", kind: "script", label: "A", artifacts: { root: "../outside" } }] })), /Invalid project graph/);
});

test("remote identity ignores protocol, credentials, case and .git", () => {
  assert.equal(normalizeRemote("https://github.com/Org/Repo.git"), "github.com/org/repo");
  assert.equal(normalizeRemote("git@github.com:org/repo.git"), "github.com/org/repo");
  assert.equal(normalizeRemote("ssh://git@github.com/org/repo"), "github.com/org/repo");
  assert.equal(normalizeRemote("https://token@github.com/org/repo/"), "github.com/org/repo");
  assert.ok(sameRemote("git@github.com:org/repo.git", "https://github.com/ORG/repo"));
  assert.ok(!sameRemote("https://github.com/org/repo", "https://github.com/org/repo2"));
  assert.equal(normalizeRemote("not a url"), undefined);
});

test("get-updates only fast-forwards a clean branch that is strictly behind", () => {
  assert.equal(syncVerdict({ upstream: "origin/main", ahead: 0, behind: 3, trackedChanges: 0 }).kind, "can-fast-forward");
  assert.equal(syncVerdict({ upstream: "origin/main", ahead: 0, behind: 3, trackedChanges: 1 }).kind, "local-changes");
  assert.equal(syncVerdict({ upstream: "origin/main", ahead: 1, behind: 3 }).kind, "diverged");
  assert.equal(syncVerdict({ upstream: "origin/main", ahead: 2, behind: 0 }).kind, "ahead-only");
  assert.equal(syncVerdict({ ahead: 0, behind: 0 }).kind, "no-upstream");
  assert.equal(syncVerdict({ upstream: "origin/main", ahead: 0, behind: 0 }).kind, "up-to-date");
  const commits = parseIncomingLog(`${"e".repeat(40)}\u001fClaude\u001f2026-09-25T09:00:00+02:00\u001fAdd requirements.txt for extraction\n`);
  assert.deepEqual(commits.map(c => c.subject), ["Add requirements.txt for extraction"]);
  assert.deepEqual(parseNameStatus("A\tfunctions/extract/requirements.txt\nR100\told.py\tfunctions/extract/new.py\n"), ["functions/extract/requirements.txt", "functions/extract/new.py"]);
  const map = buildProjectMap(inputA());
  assert.deepEqual(changedComponents(map, "pipeline", ["functions/extract/requirements.txt", "README.md"]).map(c => c.id), ["extract"]);
});

test("catalog: entry points to projects, matched to local clones by remote identity", () => {
  const catalog = parseCatalog(JSON.stringify({
    format: "datapass.catalog", version: "1", title: "My projects",
    projects: [
      { id: "research", title: "Research library", organization: "Example Org", repository: { url: "https://github.com/example-org/research-hub" } },
      { id: "catalog-import", title: "Catalogue import", repository: { url: "git@github.com:example-org/catalog-import.git", branch: "main" } }
    ]
  }));
  const entries = mergeCatalogs([{ source: "My projects", catalog }], [{ folder: "/work/research-hub", originUrl: "https://github.com/Example-Org/research-hub.git" }]);
  assert.equal(entries.find(e => e.id === "research")!.localFolder, "/work/research-hub");
  assert.equal(entries.find(e => e.id === "catalog-import")!.localFolder, undefined);
  assert.throws(() => parseCatalog(JSON.stringify({ format: "datapass.catalog", version: "1", projects: [{ id: "x", title: "X", repository: { url: "https://u:p@github.com/a/b" } }] })), /without credentials/);
  assert.throws(() => parseCatalog(JSON.stringify({ format: "datapass.catalog", version: "1", projects: [{ id: "x", title: "X", repository: { url: "https://github.com/a/b" } }, { id: "x", title: "Y", repository: { url: "https://github.com/a/c" } }] })), /duplicate/);
});
