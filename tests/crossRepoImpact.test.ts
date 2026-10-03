/**
 * V5 GITMR3: cross-repository change impact (lineage + vendored copies + unexplained edges as holes) and Common pin
 * drift (ok, behind, digest-mismatch, unknown) through the read-only git wrapper, against a real temporary Common clone.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CROSS_REPO_IMPACT_VIEW, PIN_DRIFT_VIEW, crossRepoGraph, crossRepoImpact, crossRepoLabels, crossRepoOnly, owningRepo, withCrossRepoViews
} from "../src/core/gitmr/crossRepoImpact";
import {
  classifyPins, compareVersions, formatPinDriftText, mergePins, packageDirs, parseCommitDelta, parseVendorManifest, pinsFromRepoSet,
  readCommonFacts, resolveCommonMain, type CommonFacts, type Pin
} from "../src/core/gitmr/pinDrift";
import { GitWriteRefused, readOnlyGit } from "../src/core/gitmr/readOnly";
import type { GitRunner } from "../src/core/workspace/gitBase";
import type { ImpactLineageLike, RepoSetLike } from "../src/core/gitmr/stubs";
import type { ViewCatalog } from "../src/core/navigation/navTypes";

const SET: RepoSetLike = {
  repos: [
    { id: "app", path: "app", role: "app", defaultBranch: "main" },
    { id: "data", path: "data", role: "data", defaultBranch: "main" },
    { id: "common", path: "common", role: "common", defaultBranch: "main" },
    { id: "docs", path: "docs", role: "docs", defaultBranch: "main" }
  ],
  edges: [
    { from: "app", to: "data", kind: "lineage", reason: null },
    { from: "docs", to: "data", kind: "depends", reason: null },
    { from: "app", to: "common", kind: "vendors", reason: null }
  ],
  pins: [{ repo: "app", package: "@juliandatapass-group/lineage-core", pinnedSha: "a".repeat(40), sourceRepo: "common", version: "0.1.0-alpha.1", digest: "sha256:abc" }]
};
const node = (id: string, path: string) => ({ id, kind: "table", name: id, evidence: [{ locator: { path } }] });
const LINEAGE: ImpactLineageLike = {
  nodes: [node("raw", "data/sql/raw.sql"), node("silver", "data/sql/silver.sql"), node("report", "app/reports/sales.pbix"), node("ext", "elsewhere/x.sql")],
  edges: [
    { id: "e1", kind: "derives", fromId: "raw", toId: "silver" },
    { id: "e2", kind: "reads", fromId: "silver", toId: "report" },
    { id: "e3", kind: "reads", fromId: "silver", toId: "ext" },
    { id: "e4", kind: "documents", fromId: "silver", toId: "report" }
  ]
};

test("owningRepo: deepest root wins; outside every root is undefined", () => {
  assert.equal(owningRepo(SET.repos, "app/reports/x")?.id, "app");
  assert.equal(owningRepo(SET.repos, "apple/x"), undefined);
  assert.equal(owningRepo([...SET.repos, { id: "root", path: ".", role: "other", defaultBranch: null }], "apple/x")?.id, "root");
});

test("crossRepoImpact: a change in data reaches the app report through lineage; unexplained edges are holes", () => {
  const impact = crossRepoImpact({ set: SET, sourceRepo: "data", files: [{ path: "sql/raw.sql", status: "modified" }], lineage: LINEAGE, pins: [] });
  const byId = new Map(impact.nodes.map(n => [n.id, n]));
  assert.equal(byId.get("raw")?.status, "modified");
  assert.equal(byId.get("raw")?.via, "change");
  assert.deepEqual([byId.get("report")?.repo, byId.get("report")?.status, byId.get("report")?.distance], ["app", "impacted", 2]);
  assert.equal(byId.get("ext")?.repo, null);
  assert.ok(!impact.edges.some(e => e.kind === "documents"));
  assert.deepEqual(impact.byRepo, [{ repo: "app", artifacts: 1, vendored: 0 }]);
  assert.deepEqual(impact.holes.map(h => [h.kind, h.repo]), [["unplaced-node", undefined], ["unexplained-edge", "docs"]]);
  const only = crossRepoOnly(impact);
  assert.deepEqual(only.nodes.map(n => n.id).sort(), ["report", "silver"]);
});

test("crossRepoImpact: a Common package change reaches its vendored copies; tests and no-lineage are not guessed", () => {
  const impact = crossRepoImpact({
    set: SET, sourceRepo: "common", lineage: null, pins: pinsFromRepoSet(SET),
    files: [{ path: "packages/lineage-core/src/graph.ts", status: "modified" }, { path: "packages/semantic-core/tests/a.test.ts", status: "added" }]
  });
  assert.deepEqual(impact.nodes.map(n => [n.id, n.status]), [["package:common:lineage-core", "modified"], ["vendored:app:@juliandatapass-group/lineage-core", "vendored"]]);
  assert.deepEqual(impact.byRepo, [{ repo: "app", artifacts: 0, vendored: 1 }]);
  assert.deepEqual(impact.holes.map(h => h.kind), ["no-lineage"]);
  const none = crossRepoImpact({ set: SET, sourceRepo: "app", files: [], lineage: LINEAGE, pins: [] });
  assert.deepEqual(none.holes.map(h => h.kind), ["no-change"]);
});

test("crossRepoImpact: depth and maxNodes bound the walk", () => {
  const shallow = crossRepoImpact({ set: SET, sourceRepo: "data", files: [{ path: "sql/raw.sql", status: "modified" }], lineage: LINEAGE, pins: [] }, { depth: 1 });
  assert.deepEqual(shallow.nodes.map(n => n.id).sort(), ["raw", "silver"]);
  const capped = crossRepoImpact({ set: SET, sourceRepo: "data", files: [{ path: "sql/raw.sql", status: "modified" }], lineage: LINEAGE, pins: [] }, { maxNodes: 2 });
  assert.equal(capped.truncated, true);
});

test("crossRepoGraph + labels + catalog: groups per repo, legend from data, labels overridable, views idempotent", () => {
  const impact = crossRepoImpact({ set: SET, sourceRepo: "data", files: [{ path: "sql/raw.sql", status: "added" }], lineage: LINEAGE, pins: [] });
  const labels = crossRepoLabels({ impactTitle: "Impact across repos", repoGroup: "Repo {repo}", bogus: "x", pinDriftTitle: 3 });
  const data = crossRepoGraph(impact, labels);
  assert.equal(data.graph.schema, "datapass.graph-view/1");
  assert.deepEqual(data.graph.groups.map(g => g.label).sort(), ["Repo app", "Repo data"]);
  assert.deepEqual(data.graph.legend.map(l => l.ruleId).sort(), ["status:added", "status:impacted"]);
  const catalog: ViewCatalog = { entries: [{ artifactKind: "project", level: "project", views: [] }, { artifactKind: "*", level: "artifact", views: [] }] } as unknown as ViewCatalog;
  const once = withCrossRepoViews(catalog, labels);
  const twice = withCrossRepoViews(once, labels);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.entries[0]!.views.map(v => [v.id, v.title]), [[CROSS_REPO_IMPACT_VIEW, "Impact across repos"], [PIN_DRIFT_VIEW, "Common pin drift"]]);
  assert.equal(once.entries[1]!.views.length, 0);
});

test("vendor manifest pins: tarball name/version, per-artifact source commit, manifest wins over repo-set", () => {
  const { pins } = parseVendorManifest({
    schema: "datapass.vendored-common/1", sourceCommit: "b".repeat(40),
    artifacts: [{ file: "juliandatapass-group-lineage-core-0.1.0-alpha.2.tgz", sha256: "d1" }, { file: "juliandatapass-group-semantic-core-0.1.0-alpha.4.tgz", sourceCommit: "c".repeat(40) }, { file: "other.tgz" }]
  }, "app");
  assert.deepEqual(pins.map(p => [p.name, p.version, p.sourceCommit?.[0]]), [["@juliandatapass-group/lineage-core", "0.1.0-alpha.2", "b"], ["@juliandatapass-group/semantic-core", "0.1.0-alpha.4", "c"]]);
  assert.match(parseVendorManifest({ schema: "x" }, "app").error ?? "", /not a datapass.vendored-common\/1/);
  assert.equal(pinsFromRepoSet(SET)[0]!.sha256, "abc");
  assert.equal(mergePins(pins, pinsFromRepoSet(SET)).find(p => p.name.endsWith("lineage-core"))?.version, "0.1.0-alpha.2");
});

test("compareVersions and parseCommitDelta", () => {
  assert.ok(compareVersions("0.1.0-alpha.10", "0.1.0-alpha.9") > 0);
  assert.ok(compareVersions("0.1.0", "0.1.0-alpha.9") > 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  const delta = parseCommitDelta(
    "M\tpackages/a/src/x.ts\nM\tpackages/b/tests/x.test.ts\nD\tpackages/c/package.json\nM\tpackages/d/package.json\n",
    "diff --git a/packages/d/package.json b/packages/d/package.json\n--- a/packages/d/package.json\n+++ b/packages/d/package.json\n@@ -3 +3 @@\n-  \"version\": \"0.1.0\",\n+  \"version\": \"0.2.0\",\n"
  );
  assert.deepEqual(delta, { changed: ["a", "c", "d"], removed: ["c"], versionAtRef: { d: "0.2.0" } });
});

test("classifyPins: ok, behind, digest-mismatch, unknown (PINDRIFT1 report shape)", () => {
  const s1 = "1".repeat(40), s2 = "2".repeat(40);
  const pin = (name: string, version: string | null, sourceCommit: string | null): Pin => ({ repo: "app", name: `@juliandatapass-group/${name}`, version, sha256: null, sourceCommit });
  const facts: CommonFacts = {
    ref: "origin/main", commit: "f".repeat(40),
    dirOf: Object.fromEntries(["same", "bumped", "drifted", "ahead", "gone"].map(d => [`@juliandatapass-group/${d}`, d])),
    bySha: { [s1]: { changed: ["bumped", "drifted", "gone"], removed: ["gone"], versionAtRef: { bumped: "0.1.0-alpha.3", ahead: "0.1.0-alpha.1" } }, [s2]: null }
  };
  const report = classifyPins([pin("same", "0.1.0", s1), pin("bumped", "0.1.0-alpha.2", s1), pin("drifted", "0.1.0", s1), pin("ahead", "0.1.0-alpha.2", s1),
    pin("gone", "0.1.0", s1), pin("same", "0.1.0", s2), pin("same", "0.1.0", null), pin("same", null, s1), pin("nope", "1.0.0", s1)], facts);
  assert.equal(report.schema, "datapass.pin-drift-report/1");
  assert.deepEqual(report.packages.map(p => p.status), ["ok", "behind", "digest-mismatch", "unknown", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  assert.deepEqual(report.counts, { ok: 1, behind: 1, "digest-mismatch": 1, unknown: 6 });
  assert.equal(report.drift, true);
  assert.match(formatPinDriftText(report, "app"), /^app: Common pin drift vs origin\/main \(fffffffff\): ok 1, behind 1/);
});

test("readOnlyGit refuses writes before spawning anything", async () => {
  let spawned = 0;
  const ro = readOnlyGit(async () => { spawned++; return { ok: true, stdout: "" }; });
  for (const args of [["fetch"], ["checkout", "main"], ["diff", "--output=x"], ["config", "user.name", "x"]]) await assert.rejects(ro(args, ".", 1000), GitWriteRefused);
  assert.equal(spawned, 0);
});

test("pin drift against a real local Common clone, read-only argv only", async t => {
  const dir = mkdtempSync(join(tmpdir(), "gitmr3-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
  const pkg = (d: string, version: string, src: string) => {
    mkdirSync(join(dir, "packages", d, "src"), { recursive: true });
    writeFileSync(join(dir, "packages", d, "package.json"), JSON.stringify({ name: `@juliandatapass-group/${d}`, version }, null, 2) + "\n");
    writeFileSync(join(dir, "packages", d, "src", "index.ts"), src);
  };
  g("init", "-q", "-b", "main");
  pkg("stable", "0.1.0", "a"); pkg("bumped", "0.1.0-alpha.1", "a"); pkg("drifted", "0.1.0", "a");
  g("add", "."); g("commit", "-q", "-m", "pin");
  const pinned = g("rev-parse", "HEAD");
  pkg("bumped", "0.1.0-alpha.2", "b"); pkg("drifted", "0.1.0", "b");
  mkdirSync(join(dir, "packages", "stable", "tests"), { recursive: true });
  writeFileSync(join(dir, "packages", "stable", "tests", "x.test.ts"), "t");
  g("add", "."); g("commit", "-q", "-m", "main moves");

  const seen: string[][] = [];
  const runner: GitRunner = (args, cwd, timeoutMs) => new Promise(resolve => {
    seen.push(args);
    try { resolve({ ok: true, stdout: execFileSync("git", args, { cwd, timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) }); } catch (e) { resolve({ ok: false, stdout: "", stderr: String(e) }); }
  });
  const main = await resolveCommonMain(runner, dir, null);
  assert.deepEqual(main, { ref: "main", commit: g("rev-parse", "HEAD") });
  const pins: Pin[] = ["stable", "bumped", "drifted"].map(d => ({ repo: "app", name: `@juliandatapass-group/${d}`, version: d === "bumped" ? "0.1.0-alpha.1" : "0.1.0", sha256: null, sourceCommit: pinned }));
  pins.push({ repo: "app", name: "@juliandatapass-group/stable", version: "0.1.0", sha256: null, sourceCommit: "9".repeat(40) });
  const dirOf = packageDirs(["stable", "bumped", "drifted"].map(d => ({ dir: d, json: JSON.stringify({ name: `@juliandatapass-group/${d}` }) })), pins.map(p => p.name));
  const report = classifyPins(pins, await readCommonFacts(runner, dir, main!, pins, dirOf));
  assert.deepEqual(report.packages.map(p => p.status), ["ok", "behind", "digest-mismatch", "unknown"]);
  assert.ok(seen.every(a => a[0] === "--no-optional-locks" && ["rev-parse", "diff"].includes(a[1]!)), JSON.stringify(seen));
});
