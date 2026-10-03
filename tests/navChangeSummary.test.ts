/**
 * V4-NAV NAVCHG1: the `change-summary` binding (summary, impact graph, per-file rows) and the `changes` pack.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { GitRunner } from "../src/core/workspace/gitBase";
import {
  changeDiffOpen, changeExplainOrderDraft, changeListArgs, changeSummaryBinding, changeSummaryProvider, collectChangeSummary,
  componentImpact, explainChangePathOf, fileKind, fileKindRules, impactGraphView, isRangeRef, lineageImpact, parseNameStatus,
  parsePorcelainStatus, readChangeExplanation, gitSemanticDiffer, readSide, WORKTREE, setCurrentChangeSummary, vetChangeMessage, CHANGE_EXPLANATION_SCHEMA_ID,
  type ChangeTarget, type ImpactLineageLike
} from "../src/core/navigation/bindings/changeSummary.binding";
import { CHANGES_PACK, CHANGE_VIEWS } from "../src/core/navigation/packs/changes.pack";
import { resolveViews, DEFAULT_VIEW_CATALOG } from "../src/core/navigation/navTypes";

const BASE = "a".repeat(40), HEAD = "b".repeat(40);
const range: ChangeTarget = { kind: "range", repo: "/r", repoKey: "app", repoLabel: "App", base: "main", head: "feature" };

function fakeGit(listing: string, opts: { failRev?: boolean } = {}): GitRunner {
  return async (args) => {
    if (args[0] === "rev-parse") {
      if (opts.failRev) return { ok: false, stdout: "" };
      return { ok: true, stdout: `${args[3]!.startsWith("main") || args[3]!.startsWith("HEAD") ? BASE : HEAD}\n` };
    }
    if (args[0] === "merge-base") return { ok: true, stdout: `${BASE}\n` };
    return { ok: true, stdout: listing };
  };
}
const NAME_STATUS = ["M", "models/orders.sql", "A", "dags/daily.py", "D", "notebooks/old.ipynb", "R087", "sql/a.sql", "sql/b.sql", ""].join("\0");

test("parsers: name-status and porcelain give status, path and the old path of a rename", () => {
  assert.deepEqual(parseNameStatus(NAME_STATUS), [
    { path: "models/orders.sql", status: "modified" }, { path: "dags/daily.py", status: "added" },
    { path: "notebooks/old.ipynb", status: "removed" }, { path: "sql/b.sql", oldPath: "sql/a.sql", status: "renamed" }
  ]);
  const porcelain = [" M a.sql", "?? new.py", " D gone.sql", "R  to.sql", "from.sql", "A  added.tf", ""].join("\0");
  assert.deepEqual(parsePorcelainStatus(porcelain).map(f => `${f.status}:${f.path}${f.oldPath ? `<${f.oldPath}` : ""}`),
    ["modified:a.sql", "added:new.py", "removed:gone.sql", "renamed:to.sql<from.sql", "added:added.tf"]);
});

test("refs: a range never takes an option, a `..` or a lock ref; PR refs go through the branch-name check", () => {
  for (const ok of ["main", "HEAD~2", "feature/x", "1a2b3c4", "v1.2.0"]) assert.ok(isRangeRef(ok), ok);
  for (const bad of ["-x", "--output=/tmp/x", "a..b", "x.lock", "", "a b", "x/"]) assert.ok(!isRangeRef(bad), bad);
  assert.equal(changeListArgs({ ...range, base: "--all" }), undefined);
  assert.deepEqual(changeListArgs(range), ["diff", "--name-status", "-z", "-M", "main..feature", "--"]);
  assert.equal(changeListArgs({ kind: "pr", repo: "/r", repoKey: "app", repoLabel: "App", defaultBranch: "main", head: "-bad", number: 3, title: "t" }), undefined);
});

test("file kinds: built-in rules, overridable by data; a bad pattern is skipped", () => {
  assert.equal(fileKind("models/orders.sql"), "dbt-model");
  assert.equal(fileKind("sql/x.sql"), "sql-script");
  assert.equal(fileKind("dags/daily.py"), "airflow-dag");
  assert.equal(fileKind("infra/main.tf"), "iac");
  assert.equal(fileKind("README.md"), "other");
  const rules = fileKindRules([{ pattern: "(", kind: "x" }, { pattern: "\\.md$", kind: "docs" }]);
  assert.equal(fileKind("README.md", rules), "docs");
});

test("AI explanation: exact range, ai-proposed only, text lists, no credentials", () => {
  const r = { base: BASE, head: HEAD };
  const good = { schema: CHANGE_EXPLANATION_SCHEMA_ID, range: { base: BASE.slice(0, 12), head: HEAD }, origin: "ai-proposed", assumptions: ["orders has one row per order"], expectations: ["daily DAG writes sales_daily"], writtenAt: "2026-10-01T03:00:00Z" };
  const ok = readChangeExplanation(JSON.stringify(good), r);
  assert.ok(ok.ok && ok.file.assumptions.length === 1 && ok.file.expectations[0] === "daily DAG writes sales_daily");
  assert.deepEqual(readChangeExplanation({ ...good, range: { base: HEAD, head: HEAD } }, r), { ok: false, reason: "the file explains another range" });
  assert.equal((readChangeExplanation({ ...good, origin: "owner-stated" }, r) as { reason: string }).reason, "origin must be ai-proposed");
  assert.equal((readChangeExplanation({ ...good, assumptions: ["uses postgres://u:p@h/db"] }, r) as { reason: string }).reason, "contains credential-shaped text");
  assert.equal(explainChangePathOf(r), `.datapass/explain/changes/${BASE.slice(0, 12)}..${HEAD.slice(0, 12)}.json`);
  const d = changeExplainOrderDraft("PR #3", r, [{ path: "a.sql", status: "modified" }]);
  assert.equal(d.kind, "prepare-files");
  assert.match(d.goal, /explain\/changes\/a{12}\.\.b{12}\.json/);
});

test("collect: a range gives rows, counts by status and kind, component impact, holes for what is unknown", async () => {
  const s = await collectChangeSummary(range, {
    git: fakeGit(NAME_STATUS), trusted: true, readFile: async () => null,
    components: paths => [{ id: "orders", label: "Orders", files: paths.filter(p => p.startsWith("models/") || p.startsWith("sql/")) }]
  });
  assert.deepEqual(s.range, { base: BASE, head: HEAD });
  assert.equal(s.files.length, 4);
  assert.deepEqual(s.byStatus, { modified: 1, added: 1, removed: 1, renamed: 1 });
  assert.equal(s.byKind["sql-script"], 1);
  assert.equal(s.impact?.basis, "components");
  assert.deepEqual(s.impact?.nodes.map(n => [n.id, n.status]), [["orders", "modified"]]);
  const reasons = s.holes.map(h => h.reason).join("\n");
  assert.match(reasons, /no lineage graph/);
  assert.match(reasons, /2 changed file\(s\) belong to no component/);
  assert.match(reasons, /semantic diff/);
  assert.ok(s.holes.some(h => h.fill === "ask-ai" && h.part === "summary"));
});

test("collect: restricted mode and unresolvable refs are holes, never a guess", async () => {
  const r = await collectChangeSummary(range, { git: fakeGit(NAME_STATUS), trusted: false, readFile: async () => null });
  assert.equal(r.files.length, 0);
  assert.match(r.holes[0]!.reason, /Restricted Mode/);
  const f = await collectChangeSummary(range, { git: fakeGit(NAME_STATUS, { failRev: true }), trusted: true, readFile: async () => null });
  assert.equal(f.range, null);
  assert.ok(f.holes.some(h => /could not resolve main/.test(h.reason)));
});

test("collect + binding: the AI file fills Assumptions and Expectations as ai-proposed cards", async () => {
  const file = JSON.stringify({ schema: CHANGE_EXPLANATION_SCHEMA_ID, range: { base: BASE, head: HEAD }, origin: "ai-proposed", assumptions: ["A1"], expectations: ["E1", "E2"] });
  const s = await collectChangeSummary(range, { git: fakeGit(NAME_STATUS), trusted: true, readFile: async (_r, rel) => (rel.startsWith(".datapass/explain/changes/") ? file : null), semantic: async () => ({ tables: { added: [{ name: "sales", access: "writes" }], removed: [] }, notes: [], formatOnly: false }) });
  const b = changeSummaryBinding(s, "summary");
  assert.deepEqual(b.cards?.map(c => [c.title, c.fields[c.fields.length - 1]!.origin]), [["Summary", "static"], ["Assumptions", "ai-proposed"], ["Expectations", "ai-proposed"]]);
  assert.ok(!b.holes.some(h => /No AI assumptions/.test(h.reason)));
  assert.equal(b.metrics?.find(m => m.id === "files")?.value, 4);
  const files = changeSummaryBinding(s, "files");
  assert.equal(files.rows?.[0]?.semantic, "+writes sales");
  assert.ok(!files.holes.some(h => /semantic diff/.test(h.reason)));
});

const LINEAGE: ImpactLineageLike = {
  nodes: [
    { id: "t:orders", kind: "table", name: "orders", evidence: [{ locator: { path: "models/orders.sql" } }] },
    { id: "t:sales", kind: "table", name: "sales", evidence: [] },
    { id: "r:report", kind: "report", name: "Sales report", evidence: [] },
    { id: "t:other", kind: "table", name: "other", evidence: [] }
  ],
  edges: [
    { id: "e1", kind: "derives", fromId: "t:orders", toId: "t:sales" },
    { id: "e2", kind: "reads", fromId: "t:sales", toId: "r:report" },
    { id: "e3", kind: "derives", fromId: "t:other", toId: "t:orders" }
  ]
};

test("impact: lineage seeds from changed files, downstream only, bounded by depth", () => {
  const files = parseNameStatus(NAME_STATUS);
  const i = lineageImpact(LINEAGE, files)!;
  assert.deepEqual(i.nodes.map(n => `${n.id}:${n.status}:${n.distance}`), ["t:orders:modified:0", "t:sales:impacted:1", "r:report:impacted:2"]);
  assert.deepEqual(lineageImpact(LINEAGE, files, { depth: 1 })!.nodes.map(n => n.id), ["t:orders", "t:sales"]);
  assert.equal(lineageImpact(LINEAGE, [{ path: "x.sql", status: "added" }]), null);
  const g = impactGraphView(i);
  assert.equal(g.schema, "datapass.graph-view/1");
  assert.deepEqual(g.legend.map(l => l.ruleId), ["change-modified", "change-impacted"]);
  assert.ok(g.nodes.every(n => n.groupId === null && Array.isArray(n.memberIds) && typeof n.style.color === "string"));
  assert.deepEqual(componentImpact([{ id: "c", label: "C", files: ["a", "b"] }], [{ path: "a", status: "added" }, { path: "b", status: "added" }]).nodes[0]!.status, "added");
});

test("binding: impact graph with legend override, artifact scope, no summary yet = hole", async () => {
  const s = await collectChangeSummary(range, { git: fakeGit(NAME_STATUS), trusted: true, readFile: async () => null, lineage: LINEAGE,
    components: paths => [{ id: "orders", label: "Orders", files: paths.filter(p => p.startsWith("models/")) }] });
  const impact = changeSummaryBinding(s, "impact", { legend: { impacted: { label: "Downstream" } } });
  const g = (impact.graph as unknown as { graphView: ReturnType<typeof impactGraphView> }).graphView;
  assert.equal(impact.graph?.nodes.length, 3);
  assert.deepEqual(impact.graph?.edges.map(e => ("source" in e ? `${e.source}>${e.target}` : `${e.fromId}>${e.toId}`)), ["t:orders>t:sales", "t:sales>r:report"]);
  assert.ok(g.legend.some(l => l.label === "Downstream"));
  const art = changeSummaryBinding(s, "files", { location: { level: "artifact", nodeId: "orders", artifactKind: "other" } });
  assert.deepEqual(art.rows?.map(r => r.label), ["models/orders.sql"]);
  setCurrentChangeSummary(null);
  assert.match(changeSummaryProvider.provide({ location: { level: "project", nodeId: "p", artifactKind: "project" }, params: { part: "files" } }).holes[0]!.reason, /pick a change/);
  setCurrentChangeSummary(s);
  assert.equal(changeSummaryProvider.provide({ location: { level: "project", nodeId: "p", artifactKind: "project" }, params: { part: "files" } }).rows?.length, 4);
  setCurrentChangeSummary(null);
});

test("per-file diff: read-only revisions, the working file for local changes; messages are vetted", async () => {
  const s = await collectChangeSummary(range, { git: fakeGit(NAME_STATUS), trusted: true, readFile: async () => null });
  const [mod, add, del, ren] = s.files;
  assert.deepEqual(changeDiffOpen(s, mod!, r => `/w/${r}`), { kind: "diff", left: { repo: "/r", sha: BASE, path: "models/orders.sql" }, right: { repo: "/r", sha: HEAD, path: "models/orders.sql" }, title: `orders.sql (${BASE.slice(0, 12)}..${HEAD.slice(0, 12)})` });
  assert.equal(changeDiffOpen(s, add!, r => r)!.kind, "revision");
  assert.deepEqual((changeDiffOpen(s, del!, r => r) as { rev: unknown }).rev, { repo: "/r", sha: BASE, path: "notebooks/old.ipynb" });
  assert.equal((changeDiffOpen(s, ren!, r => r) as { left: { path: string } }).left.path, "sql/a.sql");
  const local = { ...s, target: { kind: "local", repo: "/r", repoKey: "app", repoLabel: "App" } as ChangeTarget, range: { base: BASE, head: "worktree" } };
  assert.equal((changeDiffOpen(local, mod!, r => `/w/${r}`) as { right: unknown }).right, "/w/models/orders.sql");
  assert.equal(vetChangeMessage({ rowId: mod!.id, action: "open-diff" }, s.files), mod);
  assert.equal(vetChangeMessage({ rowId: mod!.id, action: "checkout" }, s.files), undefined);
  assert.equal(vetChangeMessage({ rowId: "nope", action: "open-diff" }, s.files), undefined);
});

test("pack: three change views at project and artifact levels, any artifact kind", () => {
  assert.deepEqual(CHANGES_PACK.map(e => e.level), ["project", "artifact"]);
  assert.deepEqual(CHANGE_VIEWS.map(v => v.layout), ["detail-card", "graph", "table"]);
  const catalog = { schema: DEFAULT_VIEW_CATALOG.schema, entries: CHANGES_PACK };
  const ids = resolveViews(catalog, null, "sql-script", "artifact").map(v => v.id);
  assert.deepEqual(ids, ["change-summary", "change-impact", "change-files"]);
  assert.deepEqual(resolveViews(catalog, null, "project", "step"), []);
});

test("semantic facts: Common semantic-diff over read-only revisions; traversal, binary and non-hash refs are never read", async () => {
  const shown: string[] = [];
  const git: GitRunner = async (args) => {
    shown.push(args[1] ?? "");
    if (args[1] === `${BASE}:models/orders.sql`) return { ok: true, stdout: "insert into sales select * from orders" };
    if (args[1] === `${HEAD}:models/orders.sql`) return { ok: true, stdout: "insert into sales select * from orders_v2" };
    if (args[1] === `${HEAD}:bin.dat`) return { ok: true, stdout: "a b" };
    return { ok: false, stdout: "" };
  };
  const differ = gitSemanticDiffer(git, "/r", async () => null);
  const d = await differ({ path: "models/orders.sql", status: "modified" }, { base: BASE, head: HEAD });
  assert.ok(d && d.tables.added.some(t => t.name === "orders_v2") && d.tables.removed.some(t => t.name === "orders"), JSON.stringify(d?.tables));
  assert.deepEqual(await readSide(git, "/r", HEAD, "bin.dat", async () => null), { skipped: "binary" });
  assert.deepEqual(await readSide(git, "/r", HEAD, "../etc/passwd", async () => null), { skipped: "unreadable" });
  assert.deepEqual(await readSide(git, "/r", "main", "a.sql", async () => null), { skipped: "unreadable" });
  assert.equal(await readSide(git, "/r", WORKTREE, "a.sql", async rel => `select 1 -- ${rel}`), "select 1 -- a.sql");
  assert.ok(!shown.some(x => x.includes("..") || x.startsWith("main")));
});
