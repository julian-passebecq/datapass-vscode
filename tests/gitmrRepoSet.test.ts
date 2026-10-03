/**
 * V5 GITMR1: repo-set discovery (workspace folders, submodules, `.datapass/repos.json`) and the read-only status per repo,
 * on synthetic Git repositories in a temporary folder; plus the "Repositories" Context section text and the Git-lens rows
 * the set adds (GITMR2, one repo-status surface).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { discoverRepoSet, parseGitmodules, repoSetStatus, repoSlug, workspaceRelative, type RepoSetDeps } from "../src/core/gitmr/repoSet";
import { redactRemoteUrl, remoteHost } from "../src/core/gitmr/repoSetContract";
import { createRepositoriesProvider, repositoriesBody, repositoriesLabels } from "../src/views/gitmr/repoSection";
import { repoSetLensTargets, REPO_SET_KEY_PREFIX } from "../src/core/gitmr/lensTargets";
import type { GitRunner } from "../src/core/workspace/gitBase";
import { GitWriteRefused, gitReadOnly, readOnlyGit } from "../src/core/gitmr/readOnly";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=DataPass test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, stdio: "pipe" }).toString();
const cleanup = (dir: string) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

/** The real runner shape, recording every argv so the test can prove nothing but reads ran. */
function recordingRunner(calls: string[][]): GitRunner {
  return (args, cwd, timeoutMs) => new Promise(resolve => {
    calls.push(args);
    execFile("git", ["-c", "core.fsmonitor=false", ...args], { cwd, timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }));
  });
}
const deps = (calls: string[][]): RepoSetDeps => ({
  git: recordingRunner(calls),
  readFile: async p => { try { return await fs.promises.readFile(p, "utf8"); } catch { return undefined; } }
});

function commit(dir: string, file: string, text: string, msg: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, "add", "--", file);
  git(dir, "commit", "-q", "-m", msg);
}

test("a workspace with a submodule, a declared repos.json and a plain folder gives one typed repo set with read-only status", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-reposet-"));
  try {
    const up = path.join(tmp, "up.git"); git(tmp, "init", "-q", "--bare", "-b", "main", up);
    const ws = path.join(tmp, "Wind Workspace"); fs.mkdirSync(ws);
    git(ws, "init", "-q", "-b", "main");
    commit(ws, "README.md", "synthetic\n", "one");
    git(ws, "remote", "add", "origin", up);
    git(ws, "push", "-q", "-u", "origin", "main");
    git(ws, "remote", "set-head", "origin", "main");
    commit(ws, "b.txt", "b\n", "two");                                    // one ahead of the last fetch
    git(ws, "remote", "set-url", "origin", "https://ci:s3cret@gitlab.com/syn/wind.git?private_token=x#frag");
    fs.writeFileSync(path.join(ws, "untracked.txt"), "x\n");

    const common = path.join(ws, "libs", "common"); fs.mkdirSync(common, { recursive: true });
    git(common, "init", "-q", "-b", "trunk");
    commit(common, "c.txt", "c\n", "c");
    fs.writeFileSync(path.join(ws, ".gitmodules"), '[submodule "common"]\n\tpath = libs/common\n\turl = https://token@github.com/syn/common.git\n[submodule "escape"]\n\tpath = ../../evil\n\turl = ../evil.git\n');
    const plain = path.join(ws, "notes"); fs.mkdirSync(plain);
    fs.mkdirSync(path.join(ws, ".datapass"));
    fs.writeFileSync(path.join(ws, ".datapass", "repos.json"), JSON.stringify({
      repos: [
        { path: ".", id: "wind", role: "app" },
        { path: "libs/common", id: "common", role: "common", defaultBranch: "trunk" },
        { path: "infra", role: "infra", remote: "https://dev.azure.com/syn/wind/_git/infra" },
        { path: "../outside" },
        { path: "notes", role: "boss" }
      ],
      edges: [{ from: "wind", to: "common", kind: "vendors", reason: "npm run sync:common" }, { from: "wind", to: "ghost", kind: "depends" }],
      pins: [{ repo: "wind", package: "@syn/contracts", pinnedSha: "a".repeat(40), sourceRepo: "common", version: "0.2.0", digest: `sha256:${"B".repeat(64)}` }, { repo: "common", package: "@syn/x", pinnedSha: "c".repeat(40), sourceRepo: "wind", digest: "b".repeat(64) }]
    }));

    const calls: string[][] = [];
    const { set, issues } = await discoverRepoSet(ws, [ws, plain], deps(calls));
    assert.equal(set.schema, "datapass.repo-set/1");
    assert.ok(!("schemaId" in set));
    assert.deepEqual(set.repos.map(r => [r.id, r.path, r.role, r.source, r.remote?.url ?? null, r.remote?.host ?? null, r.defaultBranch]), [
      ["wind", ".", "app", "workspace-folder", "https://gitlab.com/syn/wind.git", "gitlab", "main"],
      ["infra", "infra", "infra", "repos-json", "https://dev.azure.com/syn/wind/_git/infra", "azure-devops", null],
      ["common", "libs/common", "common", "submodule", "https://github.com/syn/common.git", "github", "trunk"],
      ["notes", "notes", "other", "workspace-folder", null, null, null]
    ]);
    assert.deepEqual(set.edges, [{ from: "wind", to: "common", kind: "vendors", reason: "npm run sync:common" }]);
    assert.deepEqual(set.pins, [
      { repo: "wind", package: "@syn/contracts", pinnedSha: { algorithm: "git-sha1", oid: "a".repeat(40) }, sourceRepo: "common", version: "0.2.0", digest: { algorithm: "sha256", mode: "exact-bytes", value: "b".repeat(64) } },
      { repo: "common", package: "@syn/x", pinnedSha: { algorithm: "git-sha1", oid: "c".repeat(40) }, sourceRepo: "wind", version: null, digest: null }
    ]);
    assert.ok(!JSON.stringify(set).includes("s3cret") && !JSON.stringify(set).includes("token"), "no credential reaches the set");
    assert.deepEqual(issues.map(i => i.reason).sort(), [
      'submodule "escape" path leaves its repository', "edge wind → ghost names an unknown repo",
      "repo without a path inside the workspace", 'unknown role "boss"', "pin @syn/x digest is not sha256:<hex>"
    ].sort());

    const status = await repoSetStatus(set, ws, deps(calls).git!);
    const wind = status.find(s => s.id === "wind")!;
    assert.deepEqual([wind.state, wind.branch, wind.upstream, wind.ahead, wind.behind], ["ok", "main", "origin/main", 1, 0]);
    assert.ok((wind.dirty ?? 0) >= 1);
    const sub = status.find(s => s.id === "common")!;
    assert.deepEqual([sub.state, sub.branch, sub.upstream, sub.dirty], ["ok", "trunk", undefined, 0]);
    assert.equal(status.find(s => s.id === "infra")!.state, "not-a-repo");
    assert.equal(status.find(s => s.id === "notes")!.state, "not-a-repo", "a plain folder inside a repo is not that repo");

    // Read-only: every call went through gitReadOnly (lock-free, allow-listed verb).
    assert.ok(calls.length > 0);
    for (const args of calls) assert.ok(args[0] === "--no-optional-locks" && ["rev-parse", "config", "symbolic-ref", "status"].includes(args[1]!), args.join(" "));

    const body = repositoriesBody(set, status, repositoriesLabels({ roles: { app: "Application" }, clean: "propre" }));
    assert.match(body, /^- wind \(Application\) · \. · main · ↑1 ↓0 · \d+ changes? · https:\/\/gitlab\.com\/syn\/wind\.git$/m);
    assert.match(body, /^- common \(Common\) · libs\/common · trunk · no upstream · propre · https:\/\/github\.com\/syn\/common\.git$/m);
    assert.match(body, /^- infra \(Infrastructure\) · infra · not a Git repository/m);
    assert.match(body, /^- wind → common \(vendors: npm run sync:common\)$/m);
    const section = await createRepositoriesProvider(async () => ({ set, statuses: status, issues })).provide();
    assert.equal(section.origin, "observed");
    assert.equal(section.holes.length, issues.length);

    // Git lens (GITMR2): the set's repos become Git-view rows, except folders the project map already shows.
    const rows = repoSetLensTargets(set, tmp, [tmp]);
    assert.ok(!rows.some(r => r.folder === tmp), "the root repo is already a project row");
    const commonRow = rows.find(r => r.key === `${REPO_SET_KEY_PREFIX}common`)!;
    assert.equal(commonRow.folder, path.join(tmp, "libs", "common"));
    assert.equal(commonRow.remoteUrl, "https://github.com/syn/common.git");
    assert.equal(commonRow.role, "common");
    assert.equal(commonRow.defaultHint, "trunk");
    assert.deepEqual(rows.map(r => r.key), set.repos.filter(r => r.path !== ".").map(r => `${REPO_SET_KEY_PREFIX}${r.id}`));
  } finally { cleanup(tmp); }
});

test("an unreadable repos.json and a workspace without repos are holes, never guesses", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-reposet-"));
  try {
    fs.mkdirSync(path.join(tmp, ".datapass")); fs.writeFileSync(path.join(tmp, ".datapass", "repos.json"), "{ nope");
    const { set, issues } = await discoverRepoSet(tmp, [path.join(os.tmpdir(), "elsewhere")], deps([]));
    assert.deepEqual(set.repos, []);
    assert.deepEqual(issues.map(i => i.reason), ["workspace folder outside the workspace root", "not valid JSON"]);
    assert.equal(repositoriesBody(set, []), "No repository found in this workspace.");
    assert.deepEqual(repoSetLensTargets(set, tmp, []), []);
  } finally { cleanup(tmp); }
});

test("parsers: .gitmodules, workspace-relative paths, slugs, remote redaction and hosts", () => {
  assert.deepEqual(parseGitmodules('# c\n[core]\n\tbare = false\n[submodule "a b"]\n\tpath = "x/a b"\n\turl = git@gitlab.com:g/a.git\n[submodule "nopath"]\n\turl = u\n'),
    [{ name: "a b", path: "x/a b", url: "git@gitlab.com:g/a.git" }]);
  const root = path.resolve("/w");
  assert.equal(workspaceRelative(root, root), ".");
  assert.equal(workspaceRelative(root, path.join(root, "a", "b")), "a/b");
  assert.equal(workspaceRelative(root, path.resolve("/x")), undefined);
  assert.equal(repoSlug("Wind Workspace"), "wind-workspace");
  assert.equal(repoSlug("--"), "repo");
  assert.equal(redactRemoteUrl("http://u:p@GitLab.com/g/r.git?x#y"), "https://gitlab.com/g/r.git");
  assert.equal(redactRemoteUrl("tok@github.com:g/r.git"), "git@github.com:g/r.git");
  assert.equal(redactRemoteUrl("C:\\repos\\r"), null);
  assert.equal(redactRemoteUrl("../r.git"), null);
  assert.equal(remoteHost("git@ssh.dev.azure.com:v3/o/p/r"), "azure-devops");
  assert.equal(remoteHost("https://gitlab.example.invalid/g/r.git"), "gitlab");
  assert.equal(remoteHost("https://code.example.invalid/r.git"), "other");
});

test("gitReadOnly: the TL-4 allow-list passes lock-free, every write verb or writing flag throws before spawning", async () => {
  assert.deepEqual(gitReadOnly(["status", "--porcelain=v2"]), ["--no-optional-locks", "status", "--porcelain=v2"]);
  assert.deepEqual(gitReadOnly(["--no-optional-locks", "log", "-1"]), ["--no-optional-locks", "log", "-1"]);
  assert.deepEqual(gitReadOnly(["diff", "HEAD"]), ["--no-optional-locks", "diff", "--no-ext-diff", "HEAD"]);
  assert.deepEqual(gitReadOnly(["config", "--get", "remote.origin.url"]), ["--no-optional-locks", "config", "--get", "remote.origin.url"]);
  assert.deepEqual(gitReadOnly(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).slice(1, 2), ["symbolic-ref"]);
  for (const ok of [["rev-parse", "HEAD"], ["for-each-ref", "refs/heads"], ["ls-files", "-z"], ["submodule", "status", "--recursive"]]) gitReadOnly(ok);
  for (const bad of [
    ["commit", "-m", "x"], ["checkout", "main"], ["fetch"], ["pull"], ["push"], ["reset", "--hard"], ["add", "."], ["gc"], [],
    ["-c", "core.pager=evil", "log"], ["log", "--output=x.txt"], ["diff", "--ext-diff"], ["log", "--textconv"],
    ["submodule", "update"], ["symbolic-ref", "HEAD", "refs/heads/x"], ["symbolic-ref", "-d", "HEAD"],
    ["config", "user.name", "x"], ["config", "--get"], ["config", "--unset", "a.b"], ["config", "--global", "--get", "a.b"]
  ]) assert.throws(() => gitReadOnly(bad), GitWriteRefused, bad.join(" "));
  let spawned = 0;
  const git = readOnlyGit(async () => { spawned++; return { ok: true, stdout: "" }; });
  await assert.rejects(git(["push", "origin", "main"], ".", 1000), GitWriteRefused);
  assert.equal(spawned, 0);
  await git(["status"], ".", 1000);
  assert.equal(spawned, 1);
});
