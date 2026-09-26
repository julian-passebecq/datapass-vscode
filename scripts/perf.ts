/**
 * V1-PERF: activation and first-refresh timings on a FOIL-sized fixture, in a real VS Code.
 *
 *   npm run perf                  3 launches, prints the median against the budgets
 *   npm run perf -- --runs=5      more launches
 *   npm run perf -- --ci          exit 1 when a median is above twice its budget
 *
 * The fixture (tests/fixtures/perf/foilSized.ts): 8 Git repositories side by side, 5,000 files, a
 * graph of 60 components, opened as a multi-root workspace. Each repository's origin is its GitHub
 * URL while Git fetches from a local bare repository (url.<bare>.insteadOf), fully offline. Before
 * every launch one new commit lands in each bare repository, so the runner's `git fetch` downloads
 * something. Everything lives in a temporary folder deleted at the end; VS Code runs with a fresh
 * --user-data-dir and no other extensions.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { PERF_REPOS, perfFiles } from "../tests/fixtures/perf/foilSized";

const repo = path.resolve(__dirname, "..");
const ci = process.argv.includes("--ci");
const runs = Math.max(1, Number(process.argv.find(a => a.startsWith("--runs="))?.slice("--runs=".length) ?? 3));

/**
 * Budgets (ms, refreshes). CI fails above twice these. V1-REF: the first refresh is the first paint
 * (project, architecture, tree); the full refresh adds probes, readiness, inventory and Galaxy.
 */
export const BUDGET = { activationMs: 500, firstRefreshMs: 3000, fullRefreshMs: 6000, fetchRefreshes: 1 };
const GATED: Array<keyof typeof BUDGET> = ["activationMs", "firstRefreshMs", "fullRefreshMs", "fetchRefreshes"];

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=DataPass perf", "-c", "user.email=perf@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, stdio: "ignore" });

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

interface Fixture { workspaceFile: string; clones: string[]; seeds: string[] }

function setup(base: string): Fixture {
  const files = perfFiles();
  const projects = path.join(base, "projects");
  const clones: string[] = [], seeds: string[] = [];
  for (const name of ["hub", ...PERF_REPOS]) {
    const folder = name === "hub" ? "perf-hub" : `perf-${name}`;
    const seed = path.join(base, "remotes", `seed-${folder}`);
    writeTree(seed, files[name]!);
    git(seed, "init", "-q", "-b", "main");
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "seed");
    const bare = path.join(base, "remotes", `${folder}.git`);
    git(base, "clone", "-q", "--bare", seed, bare);
    git(seed, "remote", "add", "origin", bare);
    const clone = path.join(projects, folder);
    git(base, "clone", "-q", bare, clone);
    const url = `https://github.com/example-org/${folder}`;
    git(clone, "remote", "set-url", "origin", url);
    git(clone, "config", `url.${pathToFileURL(bare).href}.insteadOf`, url);
    clones.push(clone);
    seeds.push(seed);
  }
  const workspaceFile = path.join(projects, "perf.code-workspace");
  fs.writeFileSync(workspaceFile, JSON.stringify({ folders: clones.map(c => ({ path: path.basename(c) })) }, null, 2));
  return { workspaceFile, clones, seeds };
}

/** One new commit in every remote, for the runner's `git fetch` to download. */
function advanceRemotes(seeds: string[], n: number): void {
  for (const seed of seeds) {
    fs.writeFileSync(path.join(seed, "CHANGES.md"), `change ${n}\n`);
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", `change ${n}`);
    git(seed, "push", "-q", "origin", "main");
  }
}

async function vscodeExecutable(): Promise<string> {
  const fromEnv = process.env.VSCODE_EXECUTABLE;
  if (fromEnv) return fromEnv;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const installed = path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe");
    if (fs.existsSync(installed)) return installed;
  }
  return downloadAndUnzipVSCode("stable");
}

interface Report {
  ok: boolean; error?: string;
  loadMs: number; activateMs: number; firstRefreshMs: number; fullRefreshMs: number; warmRefreshMs: number;
  sessionFirstPaintMs: number; sessionSettledMs: number; sessionSteps?: Record<string, number>;
  components: number; repositories: number;
  fetch: { repositories: number; sessionRefreshes: number; sessionChanges: number; gitChanges: number };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const ms = (x: number) => `${Math.round(x)} ms`;

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(repo, "dist", "extension.js"))) throw new Error("Run `npm run build` first.");
  const out = path.join(repo, "out", "perf");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(repo, "tests", "perf", "suite.ts")],
    bundle: true, platform: "node", format: "cjs", target: "node20",
    external: ["vscode"], outfile: path.join(out, "suite.js"), logLevel: "warning"
  });
  const executable = await vscodeExecutable();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-perf-"));
  const fixture = setup(path.join(scratch, "ws"));
  const reports: Report[] = [];
  try {
    for (let i = 1; i <= runs; i++) {
      advanceRemotes(fixture.seeds, i);
      const reportFile = path.join(out, `run-${i}.json`);
      const profile = path.join(scratch, "profile", String(i));
      writeTree(path.join(profile, "User"), { "settings.json": JSON.stringify({ "datapass.experience.preset": "advanced", "datapass.experience.overrides": { "landing.architecture": false } }) });
      await runTests({
        vscodeExecutablePath: executable,
        extensionDevelopmentPath: repo,
        extensionTestsPath: path.join(out, "suite.js"),
        launchArgs: [fixture.workspaceFile, "--user-data-dir", profile, "--disable-extensions", "--extensions-dir", path.join(scratch, "extensions"),
          "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-telemetry", "--disable-updates", "--new-window"],
        extensionTestsEnv: { DATAPASS_PERF_REPORT: reportFile, DATAPASS_PERF: JSON.stringify({ clones: fixture.clones }) }
      });
      const r = JSON.parse(fs.readFileSync(reportFile, "utf8")) as Report;
      if (!r.ok) throw new Error(`run ${i} failed in the extension host:\n${r.error}`);
      reports.push(r);
      console.log(`run ${i}: activation ${ms(r.loadMs + r.activateMs)} (load ${ms(r.loadMs)} + activate ${ms(r.activateMs)}), first paint ${ms(r.firstRefreshMs)}, full refresh ${ms(r.fullRefreshMs)} (session ${ms(r.sessionFirstPaintMs)} / ${ms(r.sessionSettledMs)}), warm refresh ${ms(r.warmRefreshMs)}, ` +
        `${r.components} components / ${r.repositories} repositories [${Object.entries(r.sessionSteps ?? {}).map(([k, v]) => `${k} ${v}`).join(", ")}]; git fetch ×${r.fetch.repositories} → ${r.fetch.sessionRefreshes} refresh(es), ${r.fetch.gitChanges} Git view update(s)`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }

  const result = {
    activationMs: median(reports.map(r => r.loadMs + r.activateMs)),
    firstRefreshMs: median(reports.map(r => r.firstRefreshMs)),
    fullRefreshMs: median(reports.map(r => r.fullRefreshMs)),
    fetchRefreshes: median(reports.map(r => r.fetch.sessionRefreshes))
  };
  fs.writeFileSync(path.join(out, "perf-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), host: { platform: process.platform, cpus: os.cpus().length }, budget: BUDGET, median: result, runs: reports }, null, 2));
  console.log(`\nmedian of ${runs}: activation ${ms(result.activationMs)} (budget ${BUDGET.activationMs}), first paint ${ms(result.firstRefreshMs)} (budget ${BUDGET.firstRefreshMs}), full refresh ${ms(result.fullRefreshMs)} (budget ${BUDGET.fullRefreshMs}), refreshes after git fetch ${result.fetchRefreshes} (budget ${BUDGET.fetchRefreshes})`);
  const over = GATED.filter(k => result[k] > BUDGET[k] * (ci ? 2 : 1));
  if (over.length) {
    console.error(`${ci ? "Above twice the budget" : "Above budget"}: ${over.join(", ")}`);
    if (ci) process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
