/**
 * V5HOLE3: every process DataPass starts is declared in src/core/spawnAllowList.ts. An undeclared
 * spawn site, an undeclared probe or a Git command outside TL-4 fails here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkSpawn, galaxyGathers, GIT_READ_ONLY, SPAWN_ALLOW_LIST, SPAWN_SITES, TOOL_PROBES } from "../src/core/spawnAllowList";
import { TOOLS } from "../src/core/capabilities/tools";

const ROOT = join(__dirname, "..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const SRC = sources(join(ROOT, "src")).map(p => ({ path: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));

test("only the declared spawn sites import child_process, and each checks the allow-list", () => {
  const importing = SRC.filter(f => /from "(node:)?child_process"|require\("(node:)?child_process"\)/.test(f.text)).map(f => f.path).sort();
  assert.deepEqual(importing, [...SPAWN_SITES].sort(), "a new file starts processes: declare it in SPAWN_SITES and call checkSpawn before spawning");
  for (const path of SPAWN_SITES) {
    const text = SRC.find(f => f.path === path)!.text;
    const spawns = (text.match(/\b(execFile|spawn|exec|execFileSync|spawnSync|execSync|fork)\(/g) ?? []).length;
    const checks = (text.match(/\bcheckSpawn\(/g) ?? []).length;
    assert.ok(spawns >= 1 && checks >= spawns, `${path}: ${spawns} spawn call(s), ${checks} checkSpawn call(s)`);
  }
});

test("every CLI probe of the tool catalogue is a declared lazy probe", () => {
  for (const t of TOOLS.filter(x => x.kind === "cli")) {
    for (const command of [t.cli!.command, t.cli!.windowsCommand].filter((c): c is string => !!c)) {
      const d = checkSpawn(command, t.cli!.args);
      assert.ok(d.allowed && d.trigger === "lazy-probe", `${t.id}: ${command} ${t.cli!.args.join(" ")} is not declared in TOOL_PROBES`);
    }
    assert.ok(TOOL_PROBES.some(p => p.id === t.id), `${t.id} has no TOOL_PROBES entry`);
  }
});

test("every Galaxy adapter probe is declared", () => {
  let seen = 0;
  for (const f of SRC.filter(x => x.path.startsWith("src/adapters/"))) {
    for (const m of f.text.matchAll(/command: (?:process\.platform === "win32" \? "([^"]+)" : )?"([^"]+)", args: \[([^\]]*)\]/g)) {
      const args = [...m[3]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(a => a[1]!);
      for (const command of [m[1], m[2]].filter((c): c is string => !!c)) {
        seen++;
        const d = checkSpawn(command, args);
        assert.ok(d.allowed && d.trigger === "lazy-probe", `${f.path}: ${command} ${args.join(" ")} is not declared`);
      }
    }
  }
  assert.ok(seen >= 10, `only ${seen} adapter probes found: the pattern no longer matches src/adapters`);
});

/** Git verbs a literal argument list may start with (read and write), to sweep the sources. */
const GIT_VERBS = new Set(["status", "rev-parse", "log", "show", "diff", "ls-files", "cat-file", "check-ignore", "for-each-ref", "merge-base", "hash-object", "symbolic-ref", "reflog", "worktree", "remote", "config", "fetch", "clone", "merge", "ls-remote", "push", "pull", "checkout", "reset", "commit", "add", "switch", "restore", "branch", "tag", "stash", "rebase", "cherry-pick", "clean", "init", "apply", "update-ref", "update-index", "gc"]);
const GIT_CALL = /(?:gitRunner|\bgit|this\.git|gitRead\(git,|\brun|runner\("git",)\(\s*\[([^\]]*)\]/g;

test("every literal Git command in the sources is on the allow-list", () => {
  let seen = 0;
  for (const f of SRC) {
    if (f.path === "src/core/spawnAllowList.ts") continue;
    for (const m of f.text.matchAll(GIT_CALL)) {
      const parts = m[1]!.split(/,(?![^`]*`)/).map(s => s.trim()).filter(Boolean);
      const first = /^"([^"]+)"$/.exec(parts[0] ?? "")?.[1];
      if (!first || !GIT_VERBS.has(first)) continue;
      seen++;
      const args = parts.filter(p => !p.startsWith("...")).map(p => /^"([^"]*)"$/.exec(p)?.[1] ?? "X");
      const d = checkSpawn("git", args);
      assert.ok(d.allowed, `${f.path}: git ${args.join(" ")} — ${d.allowed ? "" : d.reason}`);
    }
  }
  assert.ok(seen >= 30, `only ${seen} literal git calls found: the sweep pattern no longer matches`);
});

test("TL-4 read-only Git: allowed forms, including git remote -v and git --version", () => {
  for (const args of [["--version"], ["remote"], ["remote", "-v"], ["status", "--porcelain=v2"], ["-c", "core.fsmonitor=false", "log", "-n", "5"],
    ["config", "--get", "remote.origin.url"], ["worktree", "list", "--porcelain"], ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], ["reflog", "-n", "20", "HEAD"], ["--no-optional-locks", "status", "--porcelain=v2", "--branch"]]) {
    const d = checkSpawn("C:\\Program Files\\Git\\cmd\\git.exe", args);
    assert.ok(d.allowed, `git ${args.join(" ")}`);
  }
  assert.equal((checkSpawn("git", ["remote", "-v"]) as { trigger: string }).trigger, "read-only");
  assert.ok(GIT_READ_ONLY.some(v => v.verb === "remote") && GIT_READ_ONLY.some(v => v.verb === "--version"));
});

test("undeclared spawns are refused", () => {
  const refused: Array<[string, string[]]> = [
    ["git", ["push"]], ["git", ["pull"]], ["git", ["checkout", "main"]], ["git", ["reset", "--hard"]], ["git", ["commit", "-m", "x"]],
    ["git", ["config", "user.name", "x"]], ["git", ["config", "--get", "x", "--add"]], ["git", ["worktree", "add", "x"]],
    ["git", ["symbolic-ref", "HEAD", "refs/heads/x"]], ["git", ["remote", "add", "o", "u"]], ["git", ["reflog", "expire"]],
    ["git", ["diff", "--output=f"]], ["git", ["diff", "--ext-diff"]], ["git", ["-c", "core.pager=x", "status"]], ["git", ["status", "-c", "x"]],
    ["git", ["hash-object", "-w", "--", "f"]], ["git", ["fetch", "--upload-pack=x"]], ["git", ["clone", "-u", "x", "--", "u", "f"]],
    ["git", ["merge", "main"]], ["git", []], ["git", ["--no-optional-locks", "push"]],
    ["java", ["-jar", "app.jar"]], ["java", ["--version"]], ["python", ["script.py"]], ["python3", ["-c", "print(1)"]], ["node", ["x.js"]],
    ["docker", ["run", "x"]], ["kubectl", ["apply", "-f", "x"]], ["dotnet", ["run"]], ["psql", ["-c", "select 1"]], ["gcloud", ["auth", "login"]],
    ["fab", ["auth", "login"]], ["az", ["login"]], ["gh", ["pr", "merge"]], ["powershell", ["-Command", "x"]], ["cmd", ["/c", "dir"]]
  ];
  for (const [command, args] of refused) assert.equal(checkSpawn(command, args).allowed, false, `${command} ${args.join(" ")} must be refused`);
  assert.equal(checkSpawn("C:\\Tools\\PowerOps.exe", ["--x"], { launch: true }).allowed, false);
  assert.equal(checkSpawn("C:\\Tools\\PowerOps.exe", [], { launch: true }).allowed, true);
});

test("the harness list is complete data with unique ids", () => {
  const ids = SPAWN_ALLOW_LIST.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate ids");
  for (const d of SPAWN_ALLOW_LIST) assert.ok(["read-only", "lazy-probe", "user-command"].includes(d.trigger) && d.command && d.args, d.id);
  for (const tool of ["java", "python", "psql", "docker", "gcloud", "kubectl", "dotnet"]) {
    assert.ok(SPAWN_ALLOW_LIST.some(d => d.trigger === "lazy-probe" && d.command.split("|").some(c => c.startsWith(tool))), `${tool} probe declared`);
  }
});

test("Galaxy platform probes: gathered when the view shows or a Galaxy command asks, never on an automatic refresh with the view hidden", () => {
  assert.equal(galaxyGathers("automatic", false), false, "activation / watchers with the view hidden stay lazy");
  assert.equal(galaxyGathers("automatic", true), true);
  // Standard hides the Galaxy view: Refresh (and the test API) must still render platform state.
  assert.equal(galaxyGathers("command", false), true);
  assert.equal(galaxyGathers("command", true), true);
});
