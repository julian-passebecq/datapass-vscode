/**
 * V5 GITMR2: cross-repository history view data — the read-only log parser, per-repo lanes (diff-history kind),
 * the repository → component Sankey (graph kind, NAVREN2 `datapass.graph-view/1` shape), catalog registration and
 * labels as data; plus `git log` on a synthetic repository in a temporary folder.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import {
  buildRepoLanes, buildRepoSankey, parseRepoLog, readRepoLogs, repoHistoryBinding, repoHistoryLabels, repoLogArgs, withRepoHistoryViews,
  DEFAULT_REPO_HISTORY_LABELS, REPO_COMPONENTS_VIEW, REPO_LANES_VIEW, type RepoLog
} from "../src/core/gitmr/repoHistory";
import type { ComponentPlace } from "../src/core/exchange/fileContext";
import type { RepoSet } from "../src/core/gitmr/repoSetContract";
import { DEFAULT_VIEW_CATALOG, resolveViews, validateViewCatalog } from "../src/core/navigation/navTypes";

const S = "\x1f", R = "\x1e";
const sha = (c: string) => c.repeat(40);
const set: Pick<RepoSet, "repos"> = {
  repos: [
    { id: "app", repositoryId: null, path: ".", role: "app", remote: null, defaultBranch: "main", source: "workspace-folder" },
    { id: "common", repositoryId: "grp/common", path: "libs/common", role: "common", remote: null, defaultBranch: "main", source: "submodule" },
    { id: "docs", repositoryId: null, path: "docs", role: "docs", remote: null, defaultBranch: null, source: "repos-json" }
  ]
};
const commit = (rev: string, date: string, files: string[], message = "m") => ({ rev: sha(rev), author: "a", date, message, files });
const logs: RepoLog[] = [
  { repo: "app", commits: [commit("a", "2026-09-01T10:00:00Z", ["src/ui/x.ts", "src/ui/y.ts"]), commit("b", "2026-09-03T10:00:00Z", ["src/api/z.ts", "README.md"])] },
  { repo: "common", commits: [commit("c", "2026-09-02T10:00:00Z", ["pkg/a.ts"])] },
  { repo: "docs", commits: [], error: "not a git repository" }
];
const components: ComponentPlace[] = [
  { id: "ui", label: "UI", repoKey: "app", root: "src/ui", scopes: [] },
  { id: "api", label: "API", repoKey: "app", root: "src/api", scopes: [] },
  { id: "core", label: "Core", repoKey: "grp/common", root: ".", scopes: [] },
  { id: "other", label: "Elsewhere", repoKey: "unrelated", root: ".", scopes: [] }
];

test("parseRepoLog reads records with changed files and skips junk", () => {
  const out = `${R}${sha("1")}${S}Ann${S}2026-09-01T10:00:00+02:00${S}feat: a${S}b\n\nsrc/a.ts\nsrc/b.ts\n${R}nothex${S}x${S}y${S}z\n${R}${sha("2")}${S}Bob${S}2026-08-01T10:00:00Z${S}empty\n`;
  const rows = parseRepoLog(out);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { rev: sha("1"), author: "Ann", date: "2026-09-01T10:00:00+02:00", message: `feat: a${S}b`, files: ["src/a.ts", "src/b.ts"] });
  assert.deepEqual(rows[1]!.files, []);
  assert.equal(parseRepoLog(out, 1).length, 1);
  assert.ok(repoLogArgs().includes("--no-merges") && !repoLogArgs().some(a => /fetch|pull|push/.test(a)));
});

test("lanes: one per readable repo, in repo-set order, newest first; unreadable repo is a hole", () => {
  const d = buildRepoLanes(set, logs);
  assert.deepEqual(d.lanes.map(l => [l.repo, l.label, l.role]), [["app", "app", "app"], ["common", "common", "common"]]);
  assert.deepEqual(d.lanes[0]!.commits.map(c => c.rev), [sha("b"), sha("a")]);
  assert.deepEqual(d.holes.map(h => [h.kind, h.field]), [["git-log-failed", "docs"]]);
  assert.match(d.holes[0]!.reason, /not a git repository/);
});

test("sankey: repo → component flows count commits once per component, by repo id or repositoryId", () => {
  const { graph, holes } = buildRepoSankey(set, logs, components);
  assert.equal(graph.schema, "datapass.graph-view/1");
  assert.deepEqual(graph.nodes.map(n => n.id), ["repo:app", "repo:common", "component:api", "component:core", "component:ui"]);
  const flows = Object.fromEntries(graph.edges.map(e => [e.id, e.volumetry!.label]));
  assert.deepEqual(flows, { "flow:app:api": "1 commits", "flow:app:ui": "1 commits", "flow:common:core": "1 commits" });
  for (const e of graph.edges) assert.ok(graph.nodes.some(n => n.id === e.fromId) && graph.nodes.some(n => n.id === e.toId));
  // README.md belongs to no app component: counted as a hole, never guessed onto one.
  assert.deepEqual(holes.map(h => [h.kind, h.field]), [["git-log-failed", "docs"], ["unplaced-files", "app"]]);
  assert.ok(!graph.nodes.some(n => n.id === "component:other"));
});

test("sankey: band width grows with commits; a repo with no component is a hole", () => {
  const busy: RepoLog[] = [{ repo: "app", commits: [1, 2, 3].map(i => commit(String(i), `2026-09-0${i}T00:00:00Z`, ["src/ui/a.ts"])).concat([commit("4", "2026-09-04T00:00:00Z", ["src/api/b.ts"])]) }];
  const { graph } = buildRepoSankey(set, busy, components);
  const w = Object.fromEntries(graph.edges.map(e => [e.toId, e.style.width]));
  assert.ok(w["component:ui"]! > w["component:api"]!);
  assert.equal(graph.edges[0]!.toId, "component:ui");
  const lonely = buildRepoSankey(set, [{ repo: "app", commits: busy[0]!.commits }], []);
  assert.deepEqual(lonely.holes.map(h => h.kind), ["no-component"]);
  assert.equal(lonely.graph.edges.length, 0);
});

test("catalog: both views offered at project and sub-project, valid, idempotent, titles from labels", () => {
  const labels = repoHistoryLabels({ lanesTitle: "Historique", commits: "{n} commits!", bogus: "x", repositories: 5 });
  const cat = withRepoHistoryViews(withRepoHistoryViews(DEFAULT_VIEW_CATALOG), labels);
  assert.ok(validateViewCatalog(cat).ok);
  for (const level of ["project", "subproject"] as const) {
    const views = resolveViews(cat, null, level, level);
    assert.equal(views.filter(v => v.id === REPO_LANES_VIEW).length, 1);
    assert.equal(views.find(v => v.id === REPO_LANES_VIEW)!.title, "Historique");
    assert.equal(views.find(v => v.id === REPO_LANES_VIEW)!.layout, "diff-history");
    assert.equal(views.find(v => v.id === REPO_COMPONENTS_VIEW)!.layout, "graph");
  }
  assert.ok(!resolveViews(cat, null, "spark-job", "artifact").some(v => v.id === REPO_LANES_VIEW));
  assert.equal(labels.repositories, DEFAULT_REPO_HISTORY_LABELS.repositories);
  assert.equal(buildRepoSankey(set, logs, components, labels).graph.edges[0]!.volumetry!.label, "1 commits!");
  assert.equal(repoHistoryLabels("nope"), DEFAULT_REPO_HISTORY_LABELS);
});

test("binding provider picks the facet", () => {
  assert.ok("lanes" in repoHistoryBinding("lanes", set, logs, components));
  assert.ok("graph" in repoHistoryBinding("sankey", set, logs, components));
  assert.ok("lanes" in repoHistoryBinding(undefined, set, logs, components));
});

const hasGit = (() => { try { execFileSync("git", ["--version"]); return true; } catch { return false; } })();
test("readRepoLogs runs a read-only git log per repo; a missing repo is an error, not a throw", { skip: !hasGit }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-repohist-"));
  try {
    const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: root, stdio: "pipe" });
    g("init", "-q");
    fs.mkdirSync(path.join(root, "src", "ui"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "ui", "a.ts"), "x");
    g("add", "."); g("commit", "-q", "-m", "first");
    const git = (args: string[], cwd: string, timeout: number) => new Promise<{ ok: boolean; stdout: string; stderr?: string }>(res =>
      execFile("git", args, { cwd, timeout }, (err, stdout, stderr) => res({ ok: !err, stdout: String(stdout), stderr: String(stderr) })));
    const two: Pick<RepoSet, "repos"> = { repos: [set.repos[0]!, { ...set.repos[2]!, path: "missing" }] };
    const got = await readRepoLogs(two, p => (p === "." ? root : path.join(root, p)), git);
    assert.equal(got[0]!.commits.length, 1);
    assert.deepEqual(got[0]!.commits[0]!.files, ["src/ui/a.ts"]);
    assert.equal(got[0]!.commits[0]!.message, "first");
    assert.ok(got[1]!.error);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
