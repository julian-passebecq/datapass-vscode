/**
 * QA-1 / QA-4: a run root for qa:prepare built in %TEMP% — the public doc-pipeline example as the
 * bridge plus two native folders, each a clone whose "remote" is a local bare repository reached
 * through its https address (url.<bare>.insteadOf), and a test repository with the client config.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const version = (JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string }).version;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=QA fixture", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
}
export function copy(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

/** The run root with 3 clones and their bare "remotes", and a test repository with the client config and 2 journeys. */
export function fixture(): { base: string; root: string; auto: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-qa-"));
  const root = path.join(base, "run");
  const remotes = path.join(base, "remotes");
  const example = path.join(repo, "examples", "v3", "doc-pipeline");
  const seeds: Record<string, (dir: string) => void> = {
    "doc-pipeline": dir => { copy(path.join(example, ".datapass"), path.join(dir, ".datapass")); fs.copyFileSync(path.join(example, "README.md"), path.join(dir, "README.md")); },
    "doc-orchestration": dir => copy(path.join(example, "orchestration"), path.join(dir, "orchestration")),
    "doc-processing": dir => copy(path.join(example, "processing"), path.join(dir, "processing"))
  };
  for (const [name, seed] of Object.entries(seeds)) {
    const work = path.join(base, "seed", name);
    seed(work);
    git(work, "init", "-q", "-b", "main");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", `seed ${name}`);
    const bare = path.join(remotes, `${name}.git`);
    git(base, "clone", "-q", "--bare", work, bare);
    const https = `https://github.com/example-org/${name}`;
    const clone = path.join(root, name);
    git(base, "clone", "-q", bare, clone);
    git(clone, "remote", "set-url", "origin", https);
    git(clone, "config", `url.${pathToFileURL(bare).href}.insteadOf`, https);
  }
  const auto = path.join(base, "auto");
  copy(path.join(repo, "tests", "fixtures", "qa", "client"), auto);
  const configFile = path.join(auto, "datapass-codex-tests.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.datapass.version = version;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return { base, root, auto };
}
/**
 * V3-POLISH-1: the DataPass Hop example (examples/v3/hop) as a client for the Home, Hop and diagram
 * Git badge journey: the bridge (with a two-block graph) and its native repository `pipelines`, each
 * a clone of a local bare "remote", plus one uncommitted change in the SQL file so its block carries
 * a local Git badge. The test repository lists journey H01 (tests/fixtures/qa/hop-client).
 */
export function hopFixture(): { base: string; root: string; auto: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-qa-hop-"));
  const root = path.join(base, "run");
  const remotes = path.join(base, "remotes");
  const example = path.join(repo, "examples", "v3", "hop");
  const graph = {
    format: "datapass.graph", version: "0.2",
    items: [
      { id: "daily-sales", kind: "script", label: "Daily sales (PySpark)", provider: "python", artifacts: { repoRef: "pipelines", profile: "python.script", root: "jobs", entry: "daily_sales.py" } },
      { id: "customer-orders", kind: "script", label: "Customer orders (SQL)", provider: "python", artifacts: { repoRef: "pipelines", profile: "python.script", root: "sql", entry: "customer_orders.sql" } }
    ],
    relations: []
  };
  const seeds: Record<string, (dir: string) => void> = {
    "hop-bridge": dir => { copy(path.join(example, "bridge"), dir); fs.writeFileSync(path.join(dir, ".datapass", "graph.json"), JSON.stringify(graph, null, 2) + "\n"); },
    pipelines: dir => copy(path.join(example, "pipelines"), dir)
  };
  for (const [name, seed] of Object.entries(seeds)) {
    const work = path.join(base, "seed", name);
    seed(work);
    git(work, "init", "-q", "-b", "main");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", `seed ${name}`);
    const bare = path.join(remotes, `${name}.git`);
    git(base, "clone", "-q", "--bare", work, bare);
    const https = `https://github.com/example-org/${name}`;
    const clone = path.join(root, name);
    git(base, "clone", "-q", bare, clone);
    git(clone, "remote", "set-url", "origin", https);
    git(clone, "config", `url.${pathToFileURL(bare).href}.insteadOf`, https);
  }
  fs.appendFileSync(path.join(root, "pipelines", "sql", "customer_orders.sql"), "-- local edit, not committed (qa:ui Git badge)\n");
  const auto = path.join(base, "auto");
  copy(path.join(repo, "tests", "fixtures", "qa", "hop-client"), auto);
  const configFile = path.join(auto, "datapass-codex-tests.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.datapass.version = version;
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return { base, root, auto };
}
export const cleanup = (base: string) => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
