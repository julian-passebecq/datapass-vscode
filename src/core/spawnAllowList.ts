/**
 * V5HOLE3: the ONE list of processes DataPass may start (handoff V5-ACCEPTANCE, boundary audit).
 *
 * Every spawn site (core/detection.ts, work/gitObserver.ts, work/session.ts gitRunner,
 * work/openClientProject.ts, work/connectionChecks.ts, core/external.ts) asks `checkSpawn` first and
 * refuses what is not declared here; tests/spawnAllowList.test.ts fails on an undeclared spawn site or
 * an undeclared probe. The V5 acceptance harness reads `SPAWN_ALLOW_LIST` (data only) to judge its
 * spawn log: a `read-only` entry may appear on any journey, a `lazy-probe` only after the journey
 * opened a view or ran a command needing that tool, a `user-command` only after that command.
 *
 * Groups:
 *   - GIT_READ_ONLY (TL-4): read-only Git verbs, with the forms that would write refused
 *     (`git remote -v` and `git --version` belong here);
 *   - GIT_USER_COMMANDS: fetch, clone, fast-forward merge and ls-remote, run only by an explicit command;
 *   - TOOL_PROBES: `--version`-style detection of an installed tool. Environment detection, never
 *     client code; run lazily (a view or command that needs the tool), never at activation;
 *   - HOST_READS / CONNECTION_CHECKS / FABRIC_READS: fixed read-only host-CLI commands, on demand;
 *   - APP_LAUNCH: the user's own configured desktop app (Power Ops), started with no arguments.
 * Pure: no I/O.
 */

export type SpawnTrigger = "read-only" | "lazy-probe" | "user-command";

export interface SpawnDecl {
  id: string;
  /** Bare command name (no directory, no .exe/.cmd). */
  command: string;
  trigger: SpawnTrigger;
  /** Human text of the accepted arguments, for the harness report. */
  args: string;
}

export interface ToolProbeDecl {
  /** Tool id (capabilities/tools.ts) or Galaxy adapter tool id. */
  id: string;
  command: string;
  windowsCommand?: string;
  args: readonly string[];
}

// ------------------------------------------------------------------ git (TL-4)

/** Option tokens that would write a file, run another program or change config, refused for every Git verb. */
const GIT_FORBIDDEN = /^(--output(=.*)?|--ext-diff|--textconv|--upload-pack(=.*)?|--receive-pack(=.*)?|--exec(=.*)?|--config(=.*)?|--template(=.*)?|--open-files-in-pager.*)$/;
/** The only `-c` a caller may put before the verb. */
const GIT_PREFIX = ["-c", "core.fsmonitor=false"] as const;

const anyArgs = () => true;
const positional = (args: readonly string[]) => {
  const out: string[] = [];
  let rest = false;
  for (const a of args) { if (rest || !a.startsWith("-")) out.push(a); else if (a === "--") rest = true; }
  return out;
};

interface GitVerb { verb: string; args: string; ok: (rest: readonly string[]) => boolean }

/** TL-4: read-only Git verbs. A verb's write forms are refused by its `ok`. */
export const GIT_READ_ONLY: readonly GitVerb[] = [
  { verb: "--version", args: "(none)", ok: rest => rest.length === 0 },
  { verb: "status", args: "any read flags", ok: anyArgs },
  { verb: "rev-parse", args: "any", ok: anyArgs },
  { verb: "log", args: "any read flags", ok: anyArgs },
  { verb: "show", args: "<rev>:<path> | <rev>", ok: anyArgs },
  { verb: "diff", args: "any read flags", ok: anyArgs },
  { verb: "ls-files", args: "any", ok: anyArgs },
  { verb: "cat-file", args: "-e | -t | -p | -s <object>", ok: anyArgs },
  { verb: "check-ignore", args: "-q -- <path>", ok: rest => !rest.some(a => a === "--stdin") },
  { verb: "for-each-ref", args: "--format … refs/…", ok: anyArgs },
  { verb: "merge-base", args: "[--is-ancestor] <a> <b>", ok: anyArgs },
  { verb: "hash-object", args: "-- <files> (never -w)", ok: rest => !rest.some(a => a === "-w" || a === "--stdin-paths") },
  { verb: "symbolic-ref", args: "[-q] [--short] <name> (read form)", ok: rest => !rest.some(a => a === "-d" || a === "--delete" || a === "-m") && positional(rest).length === 1 },
  { verb: "reflog", args: "[show] -n <n> --format … <ref>", ok: rest => rest.length === 0 || rest[0] === "show" || rest[0]!.startsWith("-") },
  { verb: "worktree", args: "list [--porcelain]", ok: rest => rest[0] === "list" },
  { verb: "remote", args: "(none) | -v | get-url <name>", ok: rest => rest.length === 0 || (rest.length === 1 && (rest[0] === "-v" || rest[0] === "--verbose")) || (rest[0] === "get-url" && rest.length === 2) },
  { verb: "config", args: "--get | --get-all | --get-regexp | --list", ok: rest => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(rest[0] ?? "") && !rest.some(a => /^(--add|--unset.*|--replace-all|--edit|-e|--rename-section|--remove-section)$/.test(a)) }
];

/** Git commands that touch a remote or the work tree: only ever run by an explicit user command. */
export const GIT_USER_COMMANDS: readonly GitVerb[] = [
  { verb: "fetch", args: "[--quiet] [--prune] [origin [<branch>]] (Fetch all, Update clone, work orders)", ok: anyArgs },
  { verb: "clone", args: "--origin origin -- <url> <folder> (Open Client Project)", ok: rest => rest.includes("--") && !rest.slice(0, rest.indexOf("--")).includes("-u") },
  { verb: "merge", args: "--ff-only @{u} (Update clone)", ok: rest => rest.length === 2 && rest[0] === "--ff-only" && rest[1] === "@{u}" },
  { verb: "ls-remote", args: "-- <url> <ref> (capture base)", ok: rest => rest[0] === "--" }
];

// ------------------------------------------------------------------ tool probes (lazy)

/** Every installed-tool detection DataPass runs. Fixed arguments; nothing from a project reaches them. */
export const TOOL_PROBES: readonly ToolProbeDecl[] = [
  { id: "cli.java", command: "java", args: ["-version"] },
  { id: "cli.fab", command: "fab", args: ["--version"] },
  { id: "cli.python", command: "python3", windowsCommand: "python", args: ["--version"] },
  { id: "cli.az", command: "az", args: ["version"] },
  { id: "cli.databricks", command: "databricks", args: ["--version"] },
  { id: "cli.copilot", command: "copilot", args: ["--version"] },
  { id: "cli.gcx", command: "gcx", args: ["--version"] },
  { id: "cli.tofu", command: "tofu", args: ["version"] },
  { id: "cli.terraform", command: "terraform", args: ["version"] },
  { id: "cli.ssh", command: "ssh", args: ["-V"] },
  { id: "cli.mongosh", command: "mongosh", args: ["--version"] },
  { id: "cli.git", command: "git", args: ["--version"] },
  { id: "cli.func", command: "func", args: ["--version"] },
  { id: "cli.psql", command: "psql", args: ["--version"] },
  { id: "cli.docker", command: "docker", args: ["--version"] },
  { id: "cli.gcloud", command: "gcloud", args: ["--version"] },
  // Galaxy adapters (run when the Galaxy view is showing or a Galaxy command runs).
  { id: "fat", command: "fat", args: ["--help"] },
  { id: "pwsh", command: "pwsh", args: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"] },
  { id: "dotnet", command: "dotnet", args: ["--version"] },
  { id: "kubectl", command: "kubectl", args: ["version", "--client"] }
];

// ------------------------------------------------------------------ host CLIs (on demand)

interface FixedRead { id: string; command: string; prefix: readonly string[]; args: string }

/** Read-only host commands of the Git view (refreshed while it is visible) and work orders. */
export const HOST_READS: readonly FixedRead[] = [
  { id: "gh.auth-status", command: "gh", prefix: ["auth", "status", "--hostname", "github.com"], args: "auth status --hostname github.com" },
  { id: "gh.pr-list", command: "gh", prefix: ["pr", "list"], args: "pr list --repo … --json …" },
  { id: "gh.repo-view", command: "gh", prefix: ["repo", "view"], args: "repo view <owner/name> --json visibility" },
  { id: "az.pr-list", command: "az", prefix: ["repos", "pr", "list"], args: "repos pr list … --output json" },
  { id: "glab.mr-list", command: "glab", prefix: ["mr", "list"], args: "mr list --repo … --output json" }
];

/** "Check Connections" (core/toolchain/connections.ts SIGN_IN_CHECKS). */
export const CONNECTION_CHECKS: readonly FixedRead[] = [
  { id: "az.account-show", command: "az", prefix: ["account", "show", "--output", "json"], args: "account show --output json" },
  { id: "databricks.auth-profiles", command: "databricks", prefix: ["auth", "profiles", "--output", "json"], args: "auth profiles --output json" },
  { id: "fab.auth-status", command: "fab", prefix: ["auth", "status"], args: "auth status" }
];

/** Galaxy Fabric workspace reads (core/actions.ts, core/commands.ts fabricCliArgs). */
export const FABRIC_READS: readonly FixedRead[] = [
  { id: "fab.get", command: "fab", prefix: ["get"], args: "get <workspace>.Workspace" },
  { id: "fab.ls", command: "fab", prefix: ["ls"], args: "ls [<workspace>.Workspace -l]" }
];

/**
 * V5HOLE3: what a Galaxy refresh may do. The platform probes (Galaxy adapters, CLI `--version`) run
 * when the Galaxy view is showing or a Galaxy command asked for them (Refresh, the test API); an
 * automatic refresh (activation, file watchers, settings) with the view hidden only re-renders the
 * last known state.
 */
export type GalaxyRefreshTrigger = "automatic" | "command";
export function galaxyGathers(trigger: GalaxyRefreshTrigger, viewVisible: boolean): boolean {
  return viewVisible || trigger === "command";
}

/** The configured desktop app (datapass.powerOps.path), started detached with no arguments. */
export const APP_LAUNCH_ID = "app.launch";

// ------------------------------------------------------------------ check

export type SpawnDecision = { allowed: true; id: string; trigger: SpawnTrigger } | { allowed: false; reason: string };

/** `C:\Program Files\Git\cmd\git.exe` → `git`. */
export function commandName(command: string): string {
  const base = command.split(/[\\/]/).pop() ?? command;
  return base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

const sameArgs = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const startsWith = (a: readonly string[], prefix: readonly string[]) => prefix.every((x, i) => a[i] === x);

function checkGit(args: readonly string[]): SpawnDecision {
  let rest = [...args];
  if (startsWith(rest, GIT_PREFIX)) rest = rest.slice(GIT_PREFIX.length);
  // `--no-optional-locks` (GITMR1 readOnlyGit) only removes writes: git skips even the index refresh.
  if (rest[0] === "--no-optional-locks") rest = rest.slice(1);
  const [verb, ...tail] = rest;
  if (!verb) return { allowed: false, reason: "git with no command" };
  const options = tail.slice(0, tail.includes("--") ? tail.indexOf("--") : tail.length);
  const bad = options.find(a => GIT_FORBIDDEN.test(a) || a === "-c");
  if (bad) return { allowed: false, reason: `git ${verb} ${bad} is not allowed` };
  const read = GIT_READ_ONLY.find(v => v.verb === verb);
  if (read) return read.ok(tail) ? { allowed: true, id: `git.${verb.replace(/^--/, "")}`, trigger: "read-only" } : { allowed: false, reason: `git ${verb} ${tail.join(" ")}: not the read-only form` };
  const user = GIT_USER_COMMANDS.find(v => v.verb === verb);
  if (user) return user.ok(tail) ? { allowed: true, id: `git.${verb}`, trigger: "user-command" } : { allowed: false, reason: `git ${verb} ${tail.join(" ")}: not the declared form` };
  return { allowed: false, reason: `git ${verb} is not on the allow-list` };
}

/**
 * Whether DataPass may start `command args`. `command` may be a full path; the check is on its bare
 * name. `{ launch: true }` is the desktop-app launcher (no arguments).
 */
export function checkSpawn(command: string, args: readonly string[], opts: { launch?: boolean } = {}): SpawnDecision {
  if (opts.launch) return args.length === 0 ? { allowed: true, id: APP_LAUNCH_ID, trigger: "user-command" } : { allowed: false, reason: "an app is launched with no arguments" };
  const name = commandName(command);
  const probe = TOOL_PROBES.find(p => (commandName(p.command) === name || (p.windowsCommand && commandName(p.windowsCommand) === name)) && sameArgs(p.args, args));
  if (probe) return { allowed: true, id: `probe.${probe.id}`, trigger: "lazy-probe" };
  if (name === "git") return checkGit(args);
  for (const r of [...HOST_READS, ...CONNECTION_CHECKS, ...FABRIC_READS]) {
    if (r.command === name && startsWith(args, r.prefix)) return { allowed: true, id: r.id, trigger: HOST_READS.includes(r) ? "read-only" : "user-command" };
  }
  return { allowed: false, reason: `${name} ${args.join(" ")} is not on the DataPass spawn allow-list` };
}

/** The message a spawn site returns when `checkSpawn` refuses. */
export const refusal = (d: SpawnDecision) => d.allowed ? "" : `DataPass refused to start a process: ${d.reason} (core/spawnAllowList.ts).`;

/** Data form for the acceptance harness and reports: every declared spawn. */
export const SPAWN_ALLOW_LIST: readonly SpawnDecl[] = [
  ...GIT_READ_ONLY.map(v => ({ id: `git.${v.verb.replace(/^--/, "")}`, command: "git", trigger: "read-only" as const, args: `${v.verb} ${v.args}` })),
  ...GIT_USER_COMMANDS.map(v => ({ id: `git.${v.verb}`, command: "git", trigger: "user-command" as const, args: `${v.verb} ${v.args}` })),
  ...TOOL_PROBES.map(p => ({ id: `probe.${p.id}`, command: p.windowsCommand ? `${p.command}|${p.windowsCommand}` : p.command, trigger: "lazy-probe" as const, args: p.args.join(" ") })),
  ...HOST_READS.map(r => ({ id: r.id, command: r.command, trigger: "read-only" as const, args: r.args })),
  ...[...CONNECTION_CHECKS, ...FABRIC_READS].map(r => ({ id: r.id, command: r.command, trigger: "user-command" as const, args: r.args })),
  { id: APP_LAUNCH_ID, command: "(datapass.powerOps.path)", trigger: "user-command", args: "(none)" }
];

/** The only source files allowed to import node:child_process; each must call checkSpawn. */
export const SPAWN_SITES: readonly string[] = [
  "src/core/detection.ts",
  "src/core/external.ts",
  "src/work/connectionChecks.ts",
  "src/work/gitObserver.ts",
  "src/work/openClientProject.ts",
  "src/work/session.ts"
];
