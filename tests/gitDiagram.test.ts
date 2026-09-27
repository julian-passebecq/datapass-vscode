/**
 * V3-GITDIAG: Git on the diagram and Show File History. The `-z` parsers fed with real `git` output
 * (a rename, an untracked file, unpushed commits), the mapping of change sets onto components (renames,
 * files outside every component, several repositories), the badge's worst state, and the history bounds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  badgeTitle, LOCAL_STATUS_ARGS, mapChangeSets, MAX_FILES, nameStatusPaths, porcelainPaths, prDiffArgs, UNPUSHED_ARGS, worstState, type ChangeSet
} from "../src/core/git/diagramGit";
import { LOG_LIMIT, historyLabel, parseFileLog, previousPath, type FileRevision } from "../src/core/git/fileVersions";

const run = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });

const comp = (id: string, repoKey: string, root: string, files: Array<{ repoPath: string; kind?: "file" | "dir" | "glob" }>) =>
  ({ id, label: id.toUpperCase(), artifacts: { repoKey, root, files: files.map(f => ({ kind: "file" as const, ...f })) } });
// Only what the mapping reads (id, label, artifacts' repository, root and files).
const MAP = {
  components: [
    comp("ingest", "pipes", "jobs/ingest", [{ repoPath: "jobs/ingest/main.py" }]),
    comp("report", "pipes", "", [{ repoPath: "sql/report.sql" }, { repoPath: "sql/views", kind: "dir" }]),
    comp("docs", "coord", "docs", [{ repoPath: "docs/index.md" }]),
    { id: "planned", label: "Planned" }
  ]
} as unknown as Parameters<typeof mapChangeSets>[0];

const set = (o: Partial<ChangeSet> & Pick<ChangeSet, "repoKey" | "kind" | "key" | "files">): ChangeSet => ({ repoLabel: o.repoKey, title: o.key, truncated: false, ...o });

test("porcelain -z: modified, untracked and a rename (both paths) from real git status", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dp-gitdiag-"));
  try {
    run(dir, "init", "-q", "-b", "main");
    mkdirSync(path.join(dir, "jobs", "ingest"), { recursive: true });
    writeFileSync(path.join(dir, "jobs", "ingest", "main.py"), "a\n");
    writeFileSync(path.join(dir, "old name.sql"), "select 1;\n");
    run(dir, "add", "-A"); run(dir, "commit", "-q", "-m", "one");
    writeFileSync(path.join(dir, "jobs", "ingest", "main.py"), "b\n");
    renameSync(path.join(dir, "old name.sql"), path.join(dir, "new name.sql"));
    run(dir, "add", "-A", "--", "old name.sql", "new name.sql");
    writeFileSync(path.join(dir, "notes.md"), "x\n");
    const p = porcelainPaths(run(dir, ...LOCAL_STATUS_ARGS));
    assert.deepEqual([...p.files].sort(), ["jobs/ingest/main.py", "new name.sql", "notes.md", "old name.sql"]);
    assert.equal(p.truncated, false);

    // Unpushed: a bare "origin", one commit ahead of it; @{u}...HEAD lists that commit's files (rename: both).
    const bare = mkdtempSync(path.join(tmpdir(), "dp-gitdiag-bare-"));
    try {
      run(bare, "init", "-q", "--bare", "-b", "main");
      run(dir, "commit", "-q", "-am", "two");
      run(dir, "remote", "add", "origin", bare);
      run(dir, "push", "-q", "-u", "origin", "HEAD~1:refs/heads/main");
      run(dir, "branch", "-q", "--set-upstream-to=origin/main");
      const u = nameStatusPaths(run(dir, ...UNPUSHED_ARGS));
      assert.deepEqual([...u.files].sort(), ["jobs/ingest/main.py", "new name.sql", "old name.sql"]);
    } finally { rmSync(bare, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parsers are bounded to MAX_FILES and flag truncation; junk is ignored", () => {
  const many = Array.from({ length: MAX_FILES + 30 }, (_, i) => `M\0f${i}.py\0`).join("");
  const n = nameStatusPaths(many);
  assert.equal(n.files.length, MAX_FILES);
  assert.equal(n.truncated, true);
  assert.deepEqual(nameStatusPaths("R087\0a.py\0b.py\0garbage\0M\0c.py\0").files, ["a.py", "b.py", "c.py"]);
  assert.deepEqual(porcelainPaths("?? x\\y.txt\0\0bad\0").files, ["x/y.txt"]);
});

test("prDiffArgs refuses unsafe branch names (no option injection, no ranges)", () => {
  assert.deepEqual(prDiffArgs("main", "feature/x"), ["diff", "--name-status", "-z", "-M", "refs/remotes/origin/main...refs/remotes/origin/feature/x"]);
  assert.equal(prDiffArgs("main", "--output=x"), undefined);
  assert.equal(prDiffArgs("main", "a..b"), undefined);
});

test("mapping: renames, files outside components, several repositories, directory entries", () => {
  const sets = [
    // A rename out of the ingest folder: the old path still places it on ingest.
    set({ repoKey: "pipes", kind: "local", key: "local:pipes", files: ["jobs/ingest/old.py", "archive/old.py", "README.md"] }),
    set({ repoKey: "pipes", kind: "pr", key: "pr:pipes#4", number: 4, ci: "failing", files: ["sql/views/v1.sql", "jobs/ingest/main.py"] }),
    set({ repoKey: "pipes", kind: "pr", key: "pr:pipes#5", number: 5, ci: "passing", files: ["sql/report.sql"] }),
    // Same path in another repository: never placed on a component of "pipes".
    set({ repoKey: "coord", kind: "pr", key: "pr:coord#1", number: 1, ci: "running", files: ["docs/index.md", "jobs/ingest/main.py"] })
  ];
  const g = mapChangeSets(MAP, sets);
  assert.deepEqual(Object.keys(g.byComponent).sort(), ["docs", "ingest", "report"]);
  assert.deepEqual(g.byComponent.ingest!.sets.map(s => s.key), ["local:pipes", "pr:pipes#4"]);
  assert.equal(g.byComponent.ingest!.worst, "failing");
  assert.deepEqual(g.byComponent.report!.sets.map(s => s.key), ["pr:pipes#4", "pr:pipes#5"]);
  assert.equal(g.byComponent.report!.count, 2);
  assert.equal(g.byComponent.docs!.worst, "running");
  assert.deepEqual(g.outside.map(o => [o.key, o.files]), [["local:pipes", 2], ["pr:coord#1", 1]]);
});

test("badge: worst state order, local only, tooltip lists every change set", () => {
  assert.equal(worstState(["local", "passing", "none"]), "passing");
  assert.equal(worstState(["passing", "unknown"]), "unknown");
  assert.equal(worstState(["running", "failing", "local"]), "failing");
  assert.equal(worstState(["local"]), "local");
  const g = mapChangeSets(MAP, [set({ repoKey: "pipes", kind: "local", key: "local:pipes", title: "Local changes in pipes", files: ["jobs/ingest/main.py"] })]);
  assert.equal(g.byComponent.ingest!.worst, "local");
  const t = badgeTitle(mapChangeSets(MAP, [
    set({ repoKey: "pipes", kind: "local", key: "local:pipes", title: "Local changes", files: ["jobs/ingest/main.py"] }),
    set({ repoKey: "pipes", kind: "pr", key: "pr:pipes#7", number: 7, title: "Faster ingest", ci: "failing", files: ["jobs/ingest/a.py", "jobs/ingest/b.py"] })
  ]).byComponent.ingest!);
  assert.match(t, /^Git: 2 change sets touch this block/);
  assert.match(t, /Local — Local changes \(on this computer, 1 file\)/);
  assert.match(t, /PR #7 — Faster ingest \(CI failing, 2 files\)/);
});

test("file history: at most LOG_LIMIT commits, each diffed with the previous version (renames followed)", () => {
  const rec = (i: number) => `\x1e${String(i).padStart(40, "a").slice(-40).replace(/\d/g, "b")}\x1fT\x1f2026-09-0${(i % 9) + 1}T00:00:00Z\x1fcommit ${i}\n\nfile.py\n`;
  const log = Array.from({ length: LOG_LIMIT + 10 }, (_, i) => rec(i)).join("");
  assert.equal(parseFileLog(log, "file.py").length, LOG_LIMIT);
  const revs: FileRevision[] = [
    { sha: "c".repeat(40), author: "T", date: "2026-09-03", subject: "tweak", path: "src/new.py" },
    { sha: "b".repeat(40), author: "T", date: "2026-09-02", subject: "rename", path: "src/new.py" },
    { sha: "a".repeat(40), author: "T", date: "2026-09-01", subject: "create", path: "src/old.py" }
  ];
  assert.equal(previousPath(revs, 0), "src/new.py");
  assert.equal(previousPath(revs, 1), "src/old.py");
  assert.equal(previousPath(revs, 2), "src/old.py");
  assert.match(historyLabel(revs[1]!, 1, revs).detail, /^renamed src\/old\.py → src\/new\.py/);
  assert.equal(historyLabel(revs[0]!, 0, revs).detail, "opens the diff with the previous version");
});
