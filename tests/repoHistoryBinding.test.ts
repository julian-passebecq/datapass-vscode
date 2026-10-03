/** V5HOLE17 (V5 acceptance row 03): the `repo-history` binding shapes what the host read; it never guesses. */
import assert from "node:assert/strict";
import test from "node:test";
import { repoHistoryProvider, REPO_HISTORY_LOADING } from "../src/core/gitmr/repoHistory.binding";
import type { RepoSetRepo } from "../src/core/gitmr/repoSetContract";

const repo = (id: string): RepoSetRepo => ({ id, repositoryId: null, path: id, role: "data", remote: null, defaultBranch: null, source: "repos-json" });
const commit = (n: number, message: string) => ({ rev: String(n).repeat(40).slice(0, 40), author: "QA", date: `2026-09-1${n}T09:00:00Z`, message, files: ["a.sql"] });
const location = { level: "project", nodeId: "p" } as never;

test("repo-history: loading, no host, lanes as rows (one per commit, newest first) and a failed log as a hole", () => {
  assert.equal(repoHistoryProvider.provide({ location, repoHistory: () => "loading" }).holes[0]?.reason, REPO_HISTORY_LOADING);
  assert.equal(repoHistoryProvider.provide({ location }).holes[0]?.kind, "binding-unavailable");
  const r = repoHistoryProvider.provide({ location, params: { facet: "lanes" }, repoHistory: () => ({
    set: { repos: [repo("ingest"), repo("transform")] },
    logs: [{ repo: "ingest", commits: [], error: "not a git repository" }, { repo: "transform", commits: [commit(1, "transform: stg_orders"), commit(2, "transform: fct_orders")] }]
  }) });
  assert.deepEqual(r.rows?.map(x => [x.label, x.repository]), [["transform: fct_orders", "transform"], ["transform: stg_orders", "transform"]]);
  assert.equal(r.holes.length, 1);
  assert.match(r.holes[0]!.reason, /not a git repository/);
});
