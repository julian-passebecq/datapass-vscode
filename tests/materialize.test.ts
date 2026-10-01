import assert from "node:assert/strict";
import test from "node:test";
import { type ArchitectureCandidate, generateCandidateFiles, unitLogicalId, validateGeneration } from "../src/core/materialize/generator";
import { type RouteDecisionLike, deployHandoff, lineDelta, materializationGitPlan, previewDiff } from "../src/core/materialize/flow";
import { contentHash, parseStamp, readInlineStamp, sidecarPath, verifyStamp } from "../src/core/materialize/stamp";
import type { GitHostRepo } from "../src/core/project/gitHosts";

const candidate = (): ArchitectureCandidate => ({
  logicalId: "arch/wind-lab/candidate-a",
  revision: "0123456789abcdef0123456789abcdef01234567",
  environment: "dev",
  rootDirectory: "fabric",
  units: [
    { kind: "data-pipeline", name: "Daily load", activities: [
      { name: "ingest", runs: "Ingest turbines" },
      { name: "aggregate", runs: "Aggregate power", dependsOn: ["ingest"] }
    ] },
    { kind: "notebook", name: "Ingest turbines", cells: ["df = spark.read.table('bronze.turbines')", "df.write.saveAsTable('silver.turbines')"], defaultLakehouse: "lh_silver" },
    { kind: "spark-job-definition", name: "Aggregate power", mainFile: "aggregate.py" }
  ]
});

test("stamp: hash is LF-normalised and the inline stamp round-trips", () => {
  assert.equal(contentHash("a\r\nb\n"), contentHash("a\nb\n"));
  const files = generateCandidateFiles(candidate());
  const nb = files.find(f => f.path.endsWith("notebook-content.py"))!;
  assert.ok(nb.content.startsWith("# Fabric notebook source\n# datapass-provenance: "));
  const { stamp, body } = readInlineStamp(nb.content);
  assert.deepEqual(stamp, nb.stamp);
  assert.equal(contentHash(body), stamp!.contentHash);
  assert.equal(stamp!.evidenceOrigin, "generated");
  assert.equal(stamp!.sourceLogicalId, "arch/wind-lab/candidate-a#Ingest turbines");
  assert.equal(stamp!.environment, "dev");
  assert.equal(verifyStamp(nb.path, nb.content.replace(/\n/g, "\r\n")).verdict, "intact");
});

test("stamp: a hand edit makes the file detached; no stamp is unstamped; bad stamps are rejected", () => {
  const files = generateCandidateFiles(candidate());
  const nb = files.find(f => f.path.endsWith("notebook-content.py"))!;
  assert.equal(verifyStamp(nb.path, `${nb.content}print('edited')\n`).verdict, "detached");
  assert.equal(verifyStamp(nb.path, "# Fabric notebook source\n").verdict, "unstamped");
  const pipe = files.find(f => f.path.endsWith("pipeline-content.json"))!;
  const side = files.find(f => f.path === sidecarPath(pipe.path))!;
  assert.equal(verifyStamp(pipe.path, pipe.content, side.content).verdict, "intact");
  assert.equal(verifyStamp(pipe.path, pipe.content.replace("ingest", "x"), side.content).verdict, "detached");
  assert.equal(verifyStamp(pipe.path, pipe.content).verdict, "unstamped");
  assert.equal(parseStamp('{"schema":"datapass.provenance/v1"}'), undefined);
  assert.equal(parseStamp("not json"), undefined);
  assert.equal(parseStamp(side.content.replace('"generated"', '"runtime-observed"')), undefined);
});

test("generator: deterministic output, stable order, every item stamped", () => {
  const a = generateCandidateFiles(candidate());
  const reversed = candidate();
  reversed.units.reverse();
  const b = generateCandidateFiles(reversed);
  assert.deepEqual(a.map(f => [f.path, f.content]), b.map(f => [f.path, f.content]));
  assert.deepEqual(a.map(f => f.path), [
    ".datapass/provenance/fabric/Aggregate power.SparkJobDefinition/.platform.provenance.json",
    ".datapass/provenance/fabric/Aggregate power.SparkJobDefinition/SparkJobDefinitionV1.json.provenance.json",
    ".datapass/provenance/fabric/Daily load.DataPipeline/.platform.provenance.json",
    ".datapass/provenance/fabric/Daily load.DataPipeline/pipeline-content.json.provenance.json",
    ".datapass/provenance/fabric/Ingest turbines.Notebook/.platform.provenance.json",
    "fabric/Aggregate power.SparkJobDefinition/.platform",
    "fabric/Aggregate power.SparkJobDefinition/Main/aggregate.py",
    "fabric/Aggregate power.SparkJobDefinition/SparkJobDefinitionV1.json",
    "fabric/Daily load.DataPipeline/.platform",
    "fabric/Daily load.DataPipeline/pipeline-content.json",
    "fabric/Ingest turbines.Notebook/.platform",
    "fabric/Ingest turbines.Notebook/notebook-content.py"
  ]);
  assert.ok(a.every(f => !f.content.includes("\r")));
  assert.deepEqual(validateGeneration(candidate(), a), []);
  // A new revision changes the stamps, not the native bodies.
  const next = generateCandidateFiles({ ...candidate(), revision: "f".repeat(40) });
  const pipeA = a.find(f => f.path.endsWith("pipeline-content.json"))!;
  const pipeN = next.find(f => f.path.endsWith("pipeline-content.json"))!;
  assert.equal(pipeA.content, pipeN.content);
  assert.notEqual(pipeA.stamp.sourceRevision, pipeN.stamp.sourceRevision);
});

test("generator: logical ids are GUIDs and the pipeline references them by kind", () => {
  const id = unitLogicalId("arch/x", "Ingest turbines");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(id, unitLogicalId("arch/x", "Ingest turbines"));
  assert.notEqual(id, unitLogicalId("arch/y", "Ingest turbines"));
  const c = candidate();
  const files = generateCandidateFiles(c);
  const pipe = JSON.parse(files.find(f => f.path.endsWith("pipeline-content.json"))!.content);
  const [ingest, aggregate] = pipe.properties.activities;
  assert.equal(ingest.type, "TridentNotebook");
  assert.equal(ingest.typeProperties.notebookId, unitLogicalId(c.logicalId, "Ingest turbines"));
  assert.equal(aggregate.type, "SparkJobDefinition");
  assert.equal(aggregate.typeProperties.sparkJobDefinitionId, unitLogicalId(c.logicalId, "Aggregate power"));
  assert.deepEqual(aggregate.dependsOn, [{ activity: "ingest", dependencyConditions: ["Succeeded"] }]);
  const platform = JSON.parse(files.find(f => f.path === "fabric/Ingest turbines.Notebook/.platform")!.content);
  assert.equal(platform.metadata.type, "Notebook");
  assert.equal(platform.config.logicalId, unitLogicalId(c.logicalId, "Ingest turbines"));
  const sjd = JSON.parse(files.find(f => f.path.endsWith("SparkJobDefinitionV1.json"))!.content);
  assert.equal(sjd.executableFile, "Main/aggregate.py");
});

test("validate: names, references, cycles, paths and tampered files", () => {
  const c = candidate();
  c.rootDirectory = "../outside";
  c.environment = "prod env";
  c.units.push({ kind: "notebook", name: "bad/name", cells: [] });
  c.units.push({ kind: "notebook", name: "Ingest turbines", cells: [] });
  c.units.push({ kind: "spark-job-definition", name: "Job", mainFile: "../x.py" });
  c.units.push({ kind: "data-pipeline", name: "Loop", activities: [
    { name: "a", runs: "Ingest turbines", dependsOn: ["b"] },
    { name: "b", runs: "Missing", dependsOn: ["a", "zz"] },
    { name: "c", runs: "Daily load" }
  ] });
  const messages = validateGeneration(c, []).map(i => i.message).join("\n");
  for (const expected of ["repository-relative", "Environment", "not a valid Fabric item name", "Duplicate unit name", "plain .py", "which is not a unit", "unknown activity \"zz\"", "only notebooks and Spark jobs", "dependency cycle"]) {
    assert.ok(messages.includes(expected), `missing: ${expected}`);
  }
  const files = generateCandidateFiles(candidate());
  const tampered = files.map(f => (f.path.endsWith("pipeline-content.json") ? { ...f, content: `${f.content} ` } : f));
  assert.equal(validateGeneration(candidate(), tampered).length, 1);
});

test("diff preview: added / unchanged / modified / blocked-detached (and its sidecar)", () => {
  const files = generateCandidateFiles(candidate());
  assert.ok(previewDiff(files, new Map()).every(e => e.status === "added" && e.addedLines > 0));

  const existing = new Map(files.map(f => [f.path, f.content.replace(/\n/g, "\r\n")]));
  assert.ok(previewDiff(files, existing).every(e => e.status === "unchanged"));

  // Previous generation with an older revision: stamps intact → modified.
  const old = generateCandidateFiles({ ...candidate(), revision: "a".repeat(40) });
  const fromOld = previewDiff(files, new Map(old.map(f => [f.path, f.content])));
  assert.equal(fromOld.find(e => e.path.endsWith("notebook-content.py"))!.status, "modified");

  // Hand-edited pipeline: blocked, and its new sidecar is blocked with it.
  const pipePath = "fabric/Daily load.DataPipeline/pipeline-content.json";
  const edited = new Map(old.map(f => [f.path, f.path === pipePath ? f.content.replace("ingest", "ingest_v2") : f.content]));
  const diff = previewDiff(files, edited);
  assert.equal(diff.find(e => e.path === pipePath)!.status, "blocked-detached");
  assert.equal(diff.find(e => e.path === sidecarPath(pipePath))!.status, "blocked-detached");
  assert.equal(previewDiff(files, edited, true).find(e => e.path === pipePath)!.status, "modified");

  // A foreign (unstamped) notebook is never overwritten silently.
  const foreign = new Map([["fabric/Ingest turbines.Notebook/notebook-content.py", "# Fabric notebook source\nprint(1)\n"]]);
  assert.equal(previewDiff(files, foreign).find(e => e.path.endsWith("notebook-content.py"))!.status, "blocked-detached");

  assert.deepEqual(lineDelta("a\nb\nc\n", "a\nx\nc\nd\n"), { added: 2, removed: 1 });
});

const gitlab: GitHostRepo = { kind: "gitlab", label: "GitLab", host: "gitlab.com", web: "https://gitlab.com/g/r", name: "r" } as GitHostRepo;

test("git plan: explicit action, review branch, validation gate, MR only on request", () => {
  const c = candidate();
  const files = generateCandidateFiles(c);
  const diff = previewDiff(files, new Map());
  const base = { userAction: "user-confirmed" as const, branch: "datapass/materialize-dev", baseBranch: "main", candidate: c, files, diff, issues: [], openMergeRequest: false };

  const plan = materializationGitPlan(base);
  assert.equal(plan.writes.length, files.length);
  assert.deepEqual(plan.commands.map(x => x.args[0]), ["switch", "add", "commit", "push"]);
  assert.ok(plan.commitMessage.includes("Not deployed"));
  assert.ok(!plan.commands.some(x => x.tool !== "git"));

  const withMr = materializationGitPlan({ ...base, openMergeRequest: true, host: gitlab });
  const mr = withMr.commands.at(-1)!;
  assert.equal(mr.tool, "glab");
  assert.deepEqual(mr.args.slice(0, 4), ["mr", "create", "--repo", "https://gitlab.com/g/r"]);
  assert.ok(materializationGitPlan({ ...base, openMergeRequest: true }).mergeRequestNote);

  assert.throws(() => materializationGitPlan({ ...base, userAction: "auto" as never }), /explicit user action/);
  assert.throws(() => materializationGitPlan({ ...base, branch: "main" }), /review branch/);
  assert.throws(() => materializationGitPlan({ ...base, branch: "-x" }), /plain Git branch/);
  assert.throws(() => materializationGitPlan({ ...base, issues: [{ severity: "error", message: "x" }] }), /Validation failed/);
  const unchanged = previewDiff(files, new Map(files.map(f => [f.path, f.content])));
  assert.throws(() => materializationGitPlan({ ...base, diff: unchanged }), /Nothing to materialize/);
  // No command ever deploys, publishes or applies.
  const all = JSON.stringify(withMr.commands);
  assert.ok(!/publish|apply|deploy/i.test(all.replace(/Not deployed|deployment goes|Nothing is deployed|native deployment tool/g, "")));
});

test("deploy hand-off: follows the router's preferred / fallback candidate, never runs anything", () => {
  const c = candidate();
  const decision: RouteDecisionLike = {
    operationId: "fabric.workspace.deploy",
    preferred: { candidateId: "fabric-cicd", reason: "official, Git-authoritative project" },
    fallback: { candidateId: "fabric-git", reason: "portal" },
    candidates: [
      { candidateId: "fabric-cicd", providerId: "microsoft/fabric-cicd", readiness: "READY", routeKind: "deploy" },
      { candidateId: "fabric-git", providerId: "fabric-git", readiness: "AVAILABLE", routeKind: "portal" }
    ]
  };
  const h = deployHandoff(decision, c);
  assert.equal(h.candidateId, "fabric-cicd");
  assert.equal(h.providerId, "microsoft/fabric-cicd");
  assert.ok(h.instructions[0]!.includes("fabric-cicd") && h.instructions[0]!.includes("After the merge request"));

  const fb = deployHandoff({ ...decision, preferred: null }, c);
  assert.equal(fb.candidateId, "fabric-git");
  const none = deployHandoff({ ...decision, preferred: null, fallback: null }, c);
  assert.equal(none.candidateId, undefined);
  assert.throws(() => deployHandoff({ ...decision, operationId: "onelake.read" }, c), /not a deployment route/);
});
