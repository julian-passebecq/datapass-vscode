/**
 * Git module (0.19, pass AI-1): the read-only Git and host-CLI observation behind the Git view.
 *
 * Per repository — the coordination repository, the project's resolved clones, their worktrees and,
 * when the "Other repositories" section is opened, the repositories directly under
 * `datapass.projectsFolders` (at most 60) — it reads the branch or detached HEAD, upstream
 * ahead/behind, the last fetch, staged/unstaged/untracked counts, worktrees, open PRs with their CI
 * rollup and review decision, and the last three merges.
 *
 * Rules (handoff/v3/09 §6 and §9):
 *   - read-only commands only, each with `core.fsmonitor=false`, GIT_OPTIONAL_LOCKS=0 (no index
 *     refresh write), a 5 s timeout, and at most four at once; a repository that times out is "not checked";
 *   - no Git at all in Restricted Mode;
 *   - executables resolved from absolute PATH entries only (core/exec.ts), or the machine-level
 *     setting datapass.git.ghPath (never a workspace value);
 *   - no automatic fetch: *Fetch all* is an explicit command, plain `git fetch`, never --prune;
 *   - data is refreshed when the view is visible (cache 60 s for Git, 120 s for host CLIs), never while hidden.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { checkSpawn, refusal } from "../core/spawnAllowList";
import { executablePath, resolveCommandOrScript } from "../core/exec";
import { gitHostOf, remoteIdentity, type GitHostRepo } from "../core/project/gitHosts";
import type { RepoView } from "../core/project/resolve";
import { interpretOrigin } from "../core/project/observation";
import { isBranchName, isSha, oldestDate, parseDefaultBranch, parseMergeLog, parseRefList, parseWorktrees, statusCounts, type StatusCounts } from "../core/git/porcelain";
import { parseStatusV2 } from "../core/inventory/inventory";
import { azPrListArgs, ghPrListArgs, glabMrListArgs, parseAzPrs, parseGhClosed, parseGhOpen, parseGlabMrs, recentMerged, type HostPrs } from "../core/git/hostPrs";
import { gitSummary, hasRemoteFor, needsYou, statusFailureReport, type GitRepoReport, type GitSummary, type HostData, type NeedsYou, type RepoRole, type Unpushed, type WorktreeReport } from "../core/git/gitReport";
import { cmdLine, Limiter, retryOnTimeout, RETRY_TIMEOUT_MS, settleWithin, SPAWN_GRACE_MS } from "../core/git/run";
import type { WorkSession } from "./session";
import { cloneParents } from "./session";
import { discoverRepoSet } from "../core/gitmr/repoSet";
import { repoSetLensTargets } from "../core/gitmr/lensTargets";
import { gitReadOnly } from "../core/gitmr/readOnly";
import { parseRepoLog, repoLogArgs, REPO_TREE_HISTORY_LIMIT, type RepoLog } from "../core/gitmr/repoHistory";

export const COMMAND_TIMEOUT_MS = 5000;
export const MAX_PARALLEL = 4;
/**
 * V5HOLE14: one repository's whole check (status, origin, worktrees, PRs, merges) settles within this, else it is
 * "not checked" and the others are shown; the next refresh asks again. Discovery of the repo set is bounded the same way.
 */
export const REPO_CHECK_DEADLINE_MS = 3 * (COMMAND_TIMEOUT_MS + RETRY_TIMEOUT_MS);
/** V5HOLE17: discovery of the repo set (files only, no Git) is given this long; past it the view goes on without it. */
export const DISCOVERY_DEADLINE_MS = 5000;
export const MAX_OTHER_REPOSITORIES = 60;
const GIT_TTL_MS = 60_000;
const HOST_TTL_MS = 120_000;
const AUTH_TTL_MS = 600_000;
const FETCH_TIMEOUT_MS = 60_000;

type Tool = "git" | "gh" | "az" | "glab";
export interface RunResult { ok: boolean; code?: number; stdout: string; stderr: string; timedOut: boolean; missing?: boolean }

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GCM_INTERACTIVE: "never", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };
const HOST_ENV = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1", NO_COLOR: "1", CLICOLOR: "0", GLAB_NO_PROMPT: "1", NO_PROMPT: "1", AZURE_CORE_NO_COLOR: "1", AZURE_CORE_ONLY_SHOW_ERRORS: "1", GIT_TERMINAL_PROMPT: "0" };

interface ToolCommand { file: string; prefix: string[]; env: Record<string, string>; viaCmd?: boolean }

/** datapass.git.ghPath, from the user's (machine) settings only: a workspace cannot choose which program runs. */
export function ghPathSetting(): string | undefined {
  const v = vscode.workspace.getConfiguration("datapass").inspect<string>("git.ghPath")?.globalValue;
  return typeof v === "string" && v.trim() && path.isAbsolute(v.trim()) ? v.trim() : undefined;
}

function toolCommand(tool: Tool): ToolCommand | undefined {
  switch (tool) {
    case "git": {
      const git = executablePath("git");
      return git ? { file: git, prefix: ["-c", "core.fsmonitor=false"], env: GIT_ENV } : undefined;
    }
    case "gh": {
      const configured = ghPathSetting();
      if (configured) {
        if (!fs.existsSync(configured)) return undefined;
        // A JavaScript wrapper (tests, or your own wrapper) runs with VS Code's own Node.
        if (/\.(c|m)?js$/i.test(configured)) return { file: process.execPath, prefix: [configured], env: { ...HOST_ENV, ELECTRON_RUN_AS_NODE: "1" } };
        if (process.platform === "win32" && !/\.(exe|com)$/i.test(configured)) return undefined;
        return { file: configured, prefix: [], env: HOST_ENV };
      }
      const gh = executablePath("gh");
      return gh ? { file: gh, prefix: [], env: HOST_ENV } : undefined;
    }
    case "az": {
      const az = resolveCommandOrScript("az");
      if (!az) return undefined;
      return az.script ? { file: az.path, prefix: [], env: HOST_ENV, viaCmd: true } : { file: az.path, prefix: [], env: HOST_ENV };
    }
    case "glab": {
      const glab = executablePath("glab");
      return glab ? { file: glab, prefix: [], env: HOST_ENV } : undefined;
    }
  }
}

function spawnTool(cmd: ToolCommand, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise(resolve => {
    let file = cmd.file, argv = [...cmd.prefix, ...args];
    const opts: Parameters<typeof execFile>[2] = { cwd: cwd || undefined, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...cmd.env } };
    if (cmd.viaCmd) {
      const line = cmdLine(cmd.file, argv);
      const comspec = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
      if (!line || !path.isAbsolute(comspec)) { resolve({ ok: false, stdout: "", stderr: "arguments cannot be passed to a .cmd script safely", timedOut: false }); return; }
      file = comspec; argv = ["/d", "/s", "/c", line];
      opts.windowsVerbatimArguments = true;
    }
    let settled = false;
    const finish = (r: RunResult) => { if (!settled) { settled = true; clearTimeout(hard); resolve(r); } };
    let child: ReturnType<typeof execFile> | undefined;
    // V5HOLE14: execFile reports only once stdout/stderr close; a grandchild holding them would keep this pending forever.
    const hard = timeoutMs > 0 ? setTimeout(() => { try { child?.kill(); } catch { /* already gone */ } finish({ ok: false, stdout: "", stderr: "timed out", timedOut: true }); }, timeoutMs + SPAWN_GRACE_MS) : undefined;
    try {
      child = execFile(file, argv, opts, (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        finish({ ok: !e, code: typeof e?.code === "number" ? e.code : e ? undefined : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut: Boolean(e?.killed) });
      });
    } catch (e) { finish({ ok: false, stdout: "", stderr: String((e as Error)?.message ?? e), timedOut: false }); }
  });
}

interface Target {
  localOnly?: boolean;
  key: string;
  label: string;
  section: "project" | "other";
  role: RepoRole;
  folder?: string;
  /** Declared remote (project) — the clone's origin is read when absent. */
  remoteUrl?: string;
  defaultHint?: string;
  view?: RepoView;
  /** V5HOLE17: an undeclared workspace folder: no lane when it is not a Git repository. */
  optional?: boolean;
}

/** A lane whose check has not settled yet (V5HOLE17): shown at once, replaced by the real report. */
function checkingReport(t: Target): GitRepoReport {
  return { key: t.key, label: t.label, section: t.section, role: t.role, state: "not-checked", detail: "checking…", worktrees: [], merges: [], hostData: { kind: "no-host" } };
}

/** Folder identity for comparisons (case-insensitive on Windows). */
const same = (a: string, b: string) => {
  const n = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

export interface GitObservation {
  restricted: boolean;
  project: GitRepoReport[];
  /** Undefined until the "Other repositories" section was opened. */
  others?: GitRepoReport[];
  needsYou: NeedsYou[];
  othersNeedsYou: NeedsYou[];
  summary: GitSummary;
  checking: boolean;
  checkedAt?: string;
  /** The folders searched for other repositories. */
  otherFolders: string[];
}

export class GitObserver implements vscode.Disposable {
  /** Hub reuses this observer/limiter/runner; reading another declared project never launches an SCM write. */
  async hubReport(target: { key: string; label: string; folder?: string; remoteUrl?: string }, online = false): Promise<GitRepoReport> {
    if (target.folder) this.folders.set(target.key, target.folder);
    return this.observeBounded({ ...target, role: 'project', section: 'project', localOnly: !online });
  }
  hubRead(tool: Tool, args: string[], cwd: string, fresh = false): Promise<RunResult> { return this.run(tool, args, cwd, fresh ? 0 : 15_000); }
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly limiter = new Limiter(MAX_PARALLEL);
  private readonly cache = new Map<string, { at: number; value: Promise<RunResult> }>();
  private project: GitRepoReport[] = [];
  private others?: GitRepoReport[];
  private readonly folders = new Map<string, string>();
  /** The last definite answer to "does this clone have a remote?" (a failed origin lookup keeps it). */
  private readonly remoteKnown = new Map<string, boolean>();
  private running?: Promise<void>;
  private rerun = false;
  private othersRunning?: Promise<void>;
  private checkedAt?: string;
  /** Test seam: replaces how tools are run (the desktop suite uses the real one with a stub gh). */
  runner: (tool: Tool, args: string[], cwd: string, timeoutMs: number) => Promise<RunResult> = (tool, args, cwd, timeoutMs) => {
    // V5HOLE3: only what core/spawnAllowList.ts declares is started.
    const allowed = checkSpawn(tool, args);
    if (!allowed.allowed) return Promise.resolve({ ok: false, stdout: "", stderr: refusal(allowed), timedOut: false });
    const cmd = toolCommand(tool);
    if (!cmd) return Promise.resolve({ ok: false, stdout: "", stderr: `${tool} was not found`, timedOut: false, missing: true });
    return spawnTool(cmd, args, cwd, timeoutMs);
  };

  constructor(private readonly session: WorkSession) {}

  dispose(): void { this.emitter.dispose(); }

  /** Absolute folder of a repository or worktree the view shows (extension host only). */
  folderOf(key: string): string | undefined { return this.folders.get(key); }

  /**
   * V5HOLE8: a repository's recent commits for the Git view (read-only `git log`, through the spawn allow-list and the
   * GITMR read-only allow-list; cached like every other Git answer). Works with no DataPass project: any observed repo.
   */
  async history(key: string, limit = REPO_TREE_HISTORY_LIMIT): Promise<RepoLog> {
    const folder = this.folders.get(key);
    if (!folder) return { repo: key, commits: [], error: "not cloned here" };
    if (!vscode.workspace.isTrusted) return { repo: key, commits: [], error: "not inspected in Restricted Mode" };
    const res = await this.git(gitReadOnly(repoLogArgs(limit)), folder);
    return res.ok ? { repo: key, commits: parseRepoLog(res.stdout, limit) }
      : { repo: key, commits: [], error: res.timedOut ? "Git took too long" : (res.stderr ?? "").trim().split(/\r?\n/)[0] || "git log failed" };
  }

  report(key: string): GitRepoReport | undefined {
    return this.project.find(r => r.key === key) ?? this.others?.find(r => r.key === key);
  }

  /** Needs you rule 8 (work orders without a PR), supplied by the work-order service (pass AI-2). */
  private extraNeeds?: () => NeedsYou[];
  setExtraNeeds(fn: () => NeedsYou[]): void { this.extraNeeds = fn; }
  /** Something the extra needs depend on changed (a result, an order): views re-read the observation. */
  notifyChanged(): void { this.emitter.fire(); }

  observation(): GitObservation {
    let extra: NeedsYou[] = [];
    try { extra = this.extraNeeds?.() ?? []; } catch { extra = []; }
    const items = [...needsYou(this.project), ...extra].sort((a, b) => a.rank - b.rank);
    return {
      restricted: !vscode.workspace.isTrusted,
      project: this.project, others: this.others,
      needsYou: items, othersNeedsYou: this.others ? needsYou(this.others) : [],
      summary: gitSummary(this.project, items),
      checking: Boolean(this.running || this.othersRunning), checkedAt: this.checkedAt,
      otherFolders: cloneParents()
    };
  }

  /** Drop cached command results (all, or those run in these folders). */
  invalidate(folders?: readonly string[]): void {
    if (!folders) { this.cache.clear(); return; }
    for (const k of [...this.cache.keys()]) if (folders.some(f => k.includes(`\0${f}\0`))) this.cache.delete(k);
  }

  private run(tool: Tool, args: string[], cwd: string, ttl: number, timeoutMs = COMMAND_TIMEOUT_MS): Promise<RunResult> {
    const key = `${tool}\0${cwd}\0${args.join("\u0001")}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    // DESKHARD3: a command that timed out (CI load, gh starting slowly) is asked once more with 20 s, outside the slot it held.
    const value = retryOnTimeout(t => this.limiter.run(() => this.runner(tool, args, cwd, t)), timeoutMs);
    this.cache.set(key, { at: Date.now(), value });
    // A timeout or failure is not remembered: the next refresh tries again.
    void value.then(r => { if (!r.ok && !r.missing && this.cache.get(key)?.value === value) this.cache.delete(key); });
    return value;
  }

  private git(args: string[], cwd: string, ttl = GIT_TTL_MS) { return this.run("git", args, cwd, ttl); }

  /** Re-read the project's repositories (coalesced; cached results are reused within their TTL). */
  refresh(force = false): Promise<void> {
    if (force) this.invalidate();
    if (this.running) { this.rerun = true; return this.running; }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          this.project = await this.observeProject();
          this.checkedAt = new Date().toISOString();
          this.emitter.fire();
        } while (this.rerun);
      } finally { this.running = undefined; this.emitter.fire(); }
    })();
    this.emitter.fire();
    return this.running;
  }

  /** Read the repositories under datapass.projectsFolders (on first opening of the section, then on refresh). */
  loadOthers(force = false): Promise<void> {
    if (force) this.invalidate();
    if (this.othersRunning) return this.othersRunning;
    this.othersRunning = (async () => {
      try {
        const targets = await this.otherTargets();
        this.others = await Promise.all(targets.map(t => this.observeBounded(t)));
      } finally { this.othersRunning = undefined; this.emitter.fire(); }
    })();
    this.emitter.fire();
    return this.othersRunning;
  }

  othersLoaded(): boolean { return this.others !== undefined; }

  private projectTargets(): Target[] {
    const map = this.session.projectMap();
    // V5HOLE17: with no DataPass project, the workspace root is a lane only when it is a clone (else the repo set decides).
    return map.repositories.filter(r => map.project || r.state === "local").map(r => ({
      // The coordination repository by its folder name: "This repository" means nothing in a list of repositories.
      key: r.key, label: r.coordination && r.folderName ? r.folderName : r.label, section: "project" as const, role: r.coordination ? "coordination" as const : "project" as const,
      folder: this.session.repoFolder(r.key)?.fsPath, remoteUrl: r.state === "planned" ? undefined : r.remoteUrl, defaultHint: r.branch, view: r
    }));
  }

  private async otherTargets(): Promise<Target[]> {
    const taken = [...this.project.map(r => this.folders.get(r.key)).filter((f): f is string => !!f), ...this.project.flatMap(r => r.worktrees.map(w => w.path))];
    const out: Target[] = [];
    for (const [i, parent] of cloneParents().entries()) {
      let entries: fs.Dirent[];
      try { entries = await fs.promises.readdir(parent, { withFileTypes: true }); } catch { continue; }
      for (const e of entries.filter(d => d.isDirectory() && !d.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= MAX_OTHER_REPOSITORIES) break;
        const folder = path.join(parent, e.name);
        // A main clone has a .git folder; a .git file is a worktree or submodule (shown under its repository).
        try { if (!(await fs.promises.stat(path.join(folder, ".git"))).isDirectory()) continue; } catch { continue; }
        if (taken.some(t => same(t, folder))) continue;
        out.push({ key: `other:${i}:${e.name}`, label: e.name, section: "other", role: "other", folder });
      }
    }
    return out;
  }

  /**
   * V5HOLE17: the lanes are published as soon as the targets are known (from files only, no Git), each one "checking…"
   * until its own check settles, and every settled check replaces its lane at once: the view never waits for the slowest
   * repository (row 03 stayed on "Checking the repositories…" while discovery and every check ran one after the other).
   */
  private async observeProject(): Promise<GitRepoReport[]> {
    const targets = this.projectTargets();
    // V5HOLE14: discovery and every repository settle in bounded time; one stuck check never holds the others.
    targets.push(...await settleWithin(this.repoSetTargets(targets), this.discoveryDeadlineMs, () => []));
    const previous = new Map(this.project.map(r => [r.key, r]));
    const lanes: Array<GitRepoReport | undefined> = targets.map(t => previous.get(t.key) ?? checkingReport(t));
    this.project = lanes.filter((l): l is GitRepoReport => !!l);
    this.emitter.fire();
    const gen = ++this.generation;
    const settled = await Promise.all(targets.map(async (t, i): Promise<GitRepoReport | undefined> => {
      // V5HOLE17: a lane shows its branch, ahead/behind and changes as soon as `git status` answered (one spawn), while
      // the rest (origin, worktrees, PRs, merges) is still read: each process start can block the host on Windows.
      const r = await this.observeBounded(t, early => {
        if (lanes[i]?.state === "not-checked" && this.generation === gen) { lanes[i] = early; this.project = lanes.filter((l): l is GitRepoReport => !!l); this.emitter.fire(); }
      });
      const shown = t.optional && r.state === "not-a-repo" ? undefined : r;
      lanes[i] = shown;
      if (this.generation === gen) { this.project = lanes.filter((l): l is GitRepoReport => !!l); this.emitter.fire(); }
      return shown;
    }));
    return settled.filter((l): l is GitRepoReport => !!l);
  }
  private generation = 0;

  /** GITMR2: the workspace's repo set (folders, submodules, .datapass/repos.json) beyond the project map's repositories. */
  private async repoSetTargets(project: readonly Target[]): Promise<Target[]> {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    if (!folders.length || !vscode.workspace.isTrusted) return [];
    const readFile = (p: string) => fs.promises.readFile(p, "utf8").catch(() => undefined);
    try {
      // V5HOLE17: no Git here (folders, .gitmodules, repos.json): each lane's own check reads its clone.
      const { set } = await discoverRepoSet(folders[0]!, folders, { readFile });
      const shown = project.map(t => t.folder).filter((f): f is string => !!f);
      return repoSetLensTargets(set, folders[0]!, shown).map(t => ({ ...t, section: "project" as const, role: "project" as const }));
    } catch { return []; }
  }

  /** Test seam: the per-repository deadline (REPO_CHECK_DEADLINE_MS). */
  repoDeadlineMs = REPO_CHECK_DEADLINE_MS;
  /** Test seam: the discovery deadline (DISCOVERY_DEADLINE_MS). */
  discoveryDeadlineMs = DISCOVERY_DEADLINE_MS;

  private observeBounded(t: Target, early?: (r: GitRepoReport) => void): Promise<GitRepoReport> {
    // A repository whose `git status` answered keeps that answer when the rest (origin, worktrees, PRs, merges) is past the
    // deadline: "not checked" means Git never answered, not that a later read was slow (V5HOLE17 shows that lane at once).
    let partial: GitRepoReport | undefined;
    const seen = (r: GitRepoReport) => { partial = r; early?.(r); };
    return settleWithin(this.observe(t, seen), this.repoDeadlineMs, () => partial ?? ({
      key: t.key, label: t.label, section: t.section, role: t.role, state: "not-checked" as const, detail: "not checked (Git did not answer in time)",
      worktrees: [], merges: [], hostData: { kind: "no-host" as const }
    }));
  }

  /** One repository: status, default branch, worktrees, host PRs, merges and the derived facts. */
  private async observe(t: Target, early?: (r: GitRepoReport) => void): Promise<GitRepoReport> {
    const base: GitRepoReport = { key: t.key, label: t.label, section: t.section, role: t.role, state: "ok", worktrees: [], merges: [], hostData: { kind: "no-host" } };
    const declaredHost = gitHostOf(t.remoteUrl);
    if (declaredHost) base.host = { kind: declaredHost.kind, label: declaredHost.label, web: declaredHost.web };
    base.remote = remoteIdentity(t.remoteUrl);
    const v = t.view;
    if (v && v.state !== "local") {
      const state = v.state === "unbound" || v.state === "missing" ? "not-cloned" : v.state === "not-a-repo" ? "not-a-repo" : v.state;
      return { ...base, state, detail: v.state === "unbound" ? "not cloned here" : v.detail, hostData: declaredHost ? { kind: "links", reason: "not-checked" } : { kind: "no-host" } };
    }
    if (!vscode.workspace.isTrusted) return { ...base, state: "restricted", detail: "not inspected in Restricted Mode" };
    const folder = t.folder;
    if (!folder) return { ...base, state: "not-cloned", detail: "not cloned here" };
    this.folders.set(t.key, folder);
    // V5HOLE14: a deleted clone is a missing clone at once, with no Git spawn in a folder that does not exist.
    if (!await fs.promises.stat(folder).then(s => s.isDirectory(), () => false)) return { ...base, ...statusFailureReport({}, false) };

    // Status: the project observation's, when it is recent (the Project tree shows the same), else our own.
    const obs = t.section === "project" ? this.session.projectObservation() : undefined;
    const fresh = obs && Date.now() - Date.parse(obs.observedAt) < GIT_TTL_MS ? obs.repos.get(t.key)?.git : undefined;
    let st: { branch?: string; head?: string; upstream?: string; ahead?: number; behind?: number; counts?: StatusCounts; originUrl?: string; originLookup?: "ok" | "absent" | "failed"; lastFetch?: string };
    if (fresh?.counts) st = fresh;
    else {
      const status = await this.git(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], folder);
      if (!status.ok) {
        const exists = status.timedOut || status.missing ? true : await fs.promises.stat(folder).then(st => st.isDirectory(), () => false);
        return { ...base, ...statusFailureReport(status, exists) };
      }
      const s0 = parseStatusV2(status.stdout);
      early?.({ ...base, branch: s0.branch === "(detached)" ? undefined : s0.branch, detached: s0.branch === "(detached)", head: s0.head, upstream: s0.upstream,
        ahead: s0.ahead, behind: s0.behind, counts: statusCounts(status.stdout), checkedAt: new Date().toISOString() });
      const origin = await this.git(["config", "--get", "remote.origin.url"], folder);
      // Exit 1 is also "no such key": `git remote` tells the two apart (never cached: it is asked only then).
      const remotes = origin.ok ? undefined : await this.git(["remote"], folder, 0);
      st = { ...parseStatusV2(status.stdout), counts: statusCounts(status.stdout), ...interpretOrigin(origin, remotes), lastFetch: await this.lastFetch(folder) };
    }
    const detached = st.branch === "(detached)";
    const r: GitRepoReport = {
      ...base, branch: detached ? undefined : st.branch, detached, head: st.head, upstream: st.upstream, ahead: st.ahead, behind: st.behind,
      lastFetch: st.lastFetch, counts: st.counts ?? { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }, checkedAt: new Date().toISOString()
    };
    const host = declaredHost ?? gitHostOf(st.originUrl);
    if (host) r.host = { kind: host.kind, label: host.label, web: host.web };
    r.remote ??= remoteIdentity(st.originUrl);
    const hasRemote = hasRemoteFor(st.originUrl, st.originLookup, Boolean(t.remoteUrl) || this.remoteKnown.get(t.key));
    if (st.originLookup !== "failed") this.remoteKnown.set(t.key, hasRemote);

    const def = await this.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], folder);
    r.defaultBranch = (def.ok ? parseDefaultBranch(def.stdout) : undefined) ?? (t.defaultHint && isBranchName(t.defaultHint) ? t.defaultHint : "main");

    const [worktrees, hostPrs] = await Promise.all([this.worktrees(folder, hasRemote), host && !t.localOnly ? this.hostPrs(host, folder) : Promise.resolve(undefined)]);
    r.worktrees = worktrees;
    if (hostPrs) { r.hostData = hostPrs.data; r.prs = hostPrs.prs?.open; r.closed = hostPrs.prs?.closed; }

    // Worktrees whose branch is finished: merged into the default branch (Git), or its PR merged or closed (host).
    const branches = r.worktrees.filter(w => w.branch).map(w => w.branch!);
    if (branches.length) {
      const target = await this.git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${r.defaultBranch}`], folder);
      const merged = await this.git(["for-each-ref", "--format=%(refname:short)", `--merged=${target.ok ? `refs/remotes/origin/${r.defaultBranch}` : `refs/heads/${r.defaultBranch}`}`, "refs/heads"], folder);
      const mergedSet = merged.ok ? parseRefList(merged.stdout) : new Set<string>();
      for (const w of r.worktrees) {
        if (!w.branch || w.branch === r.defaultBranch) continue;
        const pr = (r.closed ?? []).find(p => p.head === w.branch);
        const open = (r.prs ?? []).some(p => p.head === w.branch);
        if (open) continue;
        if (pr) w.finished = { how: pr.state === "merged" ? (mergedSet.has(w.branch) ? "git-merged" : "pr-merged") : "pr-closed", pr: pr.number };
        // A new branch is "merged" for Git as soon as it is created: only trust Git once the branch had commits.
        else if (mergedSet.has(w.branch) && await this.branchMoved(folder, w.branch)) w.finished = { how: "git-merged" };
      }
    }

    // Unpushed commits of the main clone.
    if (!detached && hasRemote) r.unpushed = await this.unpushed(folder, r.upstream, r.ahead);

    // Recent merges: the host's merged PRs, else merge commits on the default branch.
    const merged = recentMerged(r.closed ?? []);
    if (merged.length) r.merges = merged.map(p => ({ number: p.number, title: p.title, at: p.mergedAt, url: p.url, sha: p.mergeCommit }));
    else if (hasRemote && isBranchName(r.defaultBranch)) {
      const log = await this.git(["log", "-3", "--merges", "--first-parent", "--format=%H%x09%cI%x09%s", `refs/remotes/origin/${r.defaultBranch}`, "--"], folder);
      if (log.ok) r.merges = parseMergeLog(log.stdout).map(m => ({ title: m.subject, at: m.date, sha: m.sha }));
    }

    // The latest merged PR is not in this clone (only checked on the default branch).
    const latest = merged[0];
    if (latest?.mergeCommit && !detached && r.branch === r.defaultBranch) {
      const anc = await retryOnTimeout(t => this.limiter.run(() => this.runner("git", ["merge-base", "--is-ancestor", latest.mergeCommit!, "HEAD"], folder, t)), COMMAND_TIMEOUT_MS);
      if (!anc.ok && !anc.timedOut && !anc.missing) r.mergeNotPulled = { number: latest.number, title: latest.title, fetched: anc.code === 1 };
    }
    return r;
  }

  /**
   * Whether a local branch moved after it was created (its reflog has more than the creation entry).
   * A branch Git sees as merged but that never got a commit is a fresh worktree (an agent that just
   * started), not finished work.
   */
  private async branchMoved(folder: string, branch: string): Promise<boolean> {
    if (!isBranchName(branch)) return false;
    const r = await this.git(["reflog", "show", "-n", "2", "--format=%H", `refs/heads/${branch}`, "--"], folder);
    return r.ok && r.stdout.split(/\r?\n/).filter(l => isSha(l.trim())).length >= 2;
  }

  private async lastFetch(folder: string): Promise<string | undefined> {
    const dir = await this.git(["rev-parse", "--git-common-dir"], folder);
    if (!dir.ok) return undefined;
    try { return (await fs.promises.stat(path.resolve(folder, dir.stdout.trim(), "FETCH_HEAD"))).mtime.toISOString(); } catch { return undefined; }
  }

  private async unpushed(cwd: string, upstream: string | undefined, ahead: number | undefined): Promise<Unpushed | undefined> {
    if (upstream) {
      if (!ahead) return undefined;
      const log = await this.git(["log", "-n", "100", "--format=%cI", "@{u}..HEAD", "--"], cwd);
      return log.ok ? { ...oldestDate(log.stdout), noUpstream: false } : undefined;
    }
    const log = await this.git(["log", "-n", "100", "--format=%cI", "HEAD", "--not", "--remotes", "--"], cwd);
    if (!log.ok) return undefined;
    const d = oldestDate(log.stdout);
    return d.count ? { ...d, noUpstream: true } : undefined;
  }

  private async worktrees(folder: string, hasRemote: boolean): Promise<WorktreeReport[]> {
    const list = await this.git(["worktree", "list", "--porcelain"], folder);
    if (!list.ok) return [];
    const entries = parseWorktrees(list.stdout).slice(1).filter(w => !w.bare);
    return Promise.all(entries.map(async (w): Promise<WorktreeReport> => {
      const native = process.platform === "win32" ? w.path.replace(/\//g, "\\") : w.path;
      const rel = path.relative(folder, native);
      const name = !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.replace(/\\/g, "/") : path.basename(native);
      const out: WorktreeReport = { path: native, name, branch: w.branch, detached: w.detached, head: w.head, locked: w.locked, prunable: w.prunable };
      if (w.prunable || !fs.existsSync(native)) return out;
      const s = await this.git(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], native);
      if (!s.ok) return out;
      const p = parseStatusV2(s.stdout);
      out.status = { upstream: p.upstream, ahead: p.ahead, behind: p.behind, ...statusCounts(s.stdout) };
      if (w.branch && hasRemote) out.unpushed = await this.unpushed(native, p.upstream, p.ahead);
      return out;
    }));
  }

  private async hostPrs(h: GitHostRepo, cwd: string): Promise<{ data: HostData; prs?: HostPrs }> {
    const failed = (tool: Tool, r: RunResult): { data: HostData } => ({
      data: r.missing ? { kind: "links", reason: "not-installed", tool } : r.timedOut ? { kind: "links", reason: "timeout", tool }
        : { kind: "links", reason: "failed", tool, detail: r.stderr.split(/\r?\n/).find(l => l.trim())?.replace(/[\u0000-\u001f]/g, "").slice(0, 160) }
    });
    switch (h.kind) {
      case "github": {
        const open = ghPrListArgs(h, "open"), closed = ghPrListArgs(h, "closed");
        if (!open || !closed) return { data: { kind: "links", reason: "unsupported", tool: "gh" } };
        // Signed in? Only the exit code is used; the token is never read.
        // One check per window, not per repository (no folder: 60 other repositories share it).
        const auth = await this.run("gh", ["auth", "status", "--hostname", "github.com"], "", AUTH_TTL_MS);
        if (auth.missing) return { data: { kind: "links", reason: "not-installed", tool: "gh" } };
        if (!auth.ok) return auth.timedOut ? failed("gh", auth) : { data: { kind: "links", reason: "not-signed-in", tool: "gh" } };
        const [o, c] = await Promise.all([this.run("gh", open, cwd, HOST_TTL_MS), this.run("gh", closed, cwd, HOST_TTL_MS)]);
        if (!o.ok) return failed("gh", o);
        const openPrs = parseGhOpen(o.stdout, h);
        if (!openPrs) return { data: { kind: "links", reason: "failed", tool: "gh", detail: "unexpected output" } };
        return { data: { kind: "cli", source: "gh" }, prs: { source: "gh", open: openPrs, closed: (c.ok ? parseGhClosed(c.stdout, h) : undefined) ?? [] } };
      }
      case "azure-devops": {
        const args = azPrListArgs(h);
        if (!args) return { data: { kind: "links", reason: "unsupported", tool: "az" } };
        const r = await this.run("az", args, cwd, HOST_TTL_MS);
        if (!r.ok) return failed("az", r);
        const prs = parseAzPrs(r.stdout, h);
        return prs ? { data: { kind: "cli", source: "az" }, prs } : { data: { kind: "links", reason: "failed", tool: "az", detail: "unexpected output" } };
      }
      case "gitlab": {
        const args = glabMrListArgs(h);
        if (!args) return { data: { kind: "links", reason: "unsupported", tool: "glab" } };
        const r = await this.run("glab", args, cwd, HOST_TTL_MS);
        if (!r.ok) return failed("glab", r);
        const prs = parseGlabMrs(r.stdout, h);
        return prs ? { data: { kind: "cli", source: "glab" }, prs } : { data: { kind: "links", reason: "failed", tool: "glab", detail: "unexpected output" } };
      }
    }
  }

  /** Plain `git fetch` of the project's cloned repositories (explicit; never --prune). */
  async fetchAll(progress?: (label: string) => void): Promise<Array<{ label: string; ok: boolean; detail?: string }>> {
    const targets = this.project.filter(r => r.state === "ok" && this.folders.get(r.key));
    const results = await Promise.all(targets.map(r => this.fetchOne(r.key, progress)));
    await this.session.refresh();
    await this.refresh();
    return results;
  }

  async fetchOne(key: string, progress?: (label: string) => void): Promise<{ label: string; ok: boolean; detail?: string }> {
    const r = this.report(key);
    const folder = this.folders.get(key);
    if (!r || !folder) return { label: key, ok: false, detail: "not cloned here" };
    if (!vscode.workspace.isTrusted) return { label: r.label, ok: false, detail: "Restricted Mode" };
    const f = await this.limiter.run(() => { progress?.(r.label); return this.runner("git", ["fetch"], folder, FETCH_TIMEOUT_MS); });
    this.invalidate([folder, ...r.worktrees.map(w => w.path)]);
    return f.ok ? { label: r.label, ok: true } : { label: r.label, ok: false, detail: f.timedOut ? "timed out" : f.stderr.split(/\r?\n/).find(l => l.trim())?.slice(0, 200) ?? "fetch failed" };
  }
}
