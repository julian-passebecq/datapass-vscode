/**
 * QA-1: `npm run qa:prepare` on a local fixture built in %TEMP% — the public doc-pipeline example as
 * the bridge plus two native folders, each a clone whose "remote" is a local bare repository reached
 * through its https address (url.<bare>.insteadOf). The refusals (wrong remote, missing folder, bad
 * journey) always run. The full preparation installs a real VSIX into the isolated profile and runs
 * when DATAPASS_QA_VSIX names one (CI packages the VSIX, then runs this file with it).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { prepare, EXTENSION_ID } from "../scripts/qa/prepare";
import { parseQaRun } from "../src/qa/formats";

const repo = process.cwd();
const version = (JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as { version: string }).version;
const vsix = process.env.DATAPASS_QA_VSIX;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=QA fixture", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
}
function copy(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

/** The run root with 3 clones and their bare "remotes", and a test repository with the client config and 2 journeys. */
function fixture(): { base: string; root: string; auto: string } {
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
const cleanup = (base: string) => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });

test("qa:prepare refuses a wrong remote with exit 2 and a readable reason (CLI)", () => {
  const { base, root, auto } = fixture();
  try {
    git(path.join(root, "doc-processing"), "remote", "set-url", "origin", "https://github.com/someone-else/doc-processing");
    const r = spawnSync(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repo, "scripts", "qa", "prepare.ts"), "--auto", auto, "--root", root], { encoding: "utf8" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /Cannot prepare this run/);
    assert.match(r.stdout, /doc-processing is a clone of https:\/\/github\.com\/someone-else\/doc-processing, not https:\/\/github\.com\/example-org\/doc-processing/);
    assert.ok(!fs.existsSync(path.join(root, "run.json")), "nothing written");
  } finally { cleanup(base); }
});

test("qa:prepare refuses a missing folder, an invalid journey and a missing VSIX, naming each", async () => {
  const { base, root, auto } = fixture();
  const lines: string[] = [];
  try {
    fs.renameSync(path.join(root, "doc-orchestration"), path.join(root, "elsewhere"));
    let r = await prepare({ auto, root, log: l => lines.push(l) });
    assert.equal(r.code, 2);
    assert.ok(r.reasons.some(x => /folder doc-orchestration is missing under the run root \(clone https:\/\/github\.com\/example-org\/doc-orchestration there\)/.test(x)), r.reasons.join("\n"));
    fs.renameSync(path.join(root, "elsewhere"), path.join(root, "doc-orchestration"));

    const j = path.join(auto, "journeys", "J02-choose-a-variant.json");
    const good = fs.readFileSync(j, "utf8");
    fs.writeFileSync(j, good.replace('"costs"', '"teleport"'));
    r = await prepare({ auto, root, log: l => lines.push(l) });
    assert.equal(r.code, 2);
    assert.ok(r.reasons.some(x => /J02-choose-a-variant\.json: unknown feature tag\(s\) "teleport"/.test(x)), r.reasons.join("\n"));
    fs.writeFileSync(j, good);

    r = await prepare({ auto, root, log: l => lines.push(l) });
    assert.equal(r.code, 2);
    assert.ok(r.reasons.some(x => /VSIX not found: .*datapass-vscode\.vsix/.test(x)), r.reasons.join("\n"));
    assert.ok(!fs.existsSync(path.join(root, ".vscode-ext")), "no profile created before the VSIX is found");
  } finally { cleanup(base); }
});

test("qa:prepare installs the VSIX into the isolated profile, writes the workspace and run.json (exit 0)", { skip: vsix ? false : "set DATAPASS_QA_VSIX to a built VSIX (CI does)", timeout: 600_000 }, async () => {
  const { base, root, auto } = fixture();
  try {
    fs.copyFileSync(vsix!, path.join(root, "datapass-vscode.vsix"));
    const lines: string[] = [];
    const r = await prepare({ auto, root, log: l => lines.push(l), now: new Date("2026-09-27T09:30:00Z") });
    assert.equal(r.code, 0, lines.join("\n"));
    // The VSIX is in the isolated extensions dir, not in the person's profile.
    const installed = fs.readdirSync(path.join(root, ".vscode-ext")).filter(n => n.toLowerCase().startsWith(`${EXTENSION_ID}-`));
    assert.deepEqual(installed, [`${EXTENSION_ID}-${version}`]);
    // One workspace file, bridge first.
    const ws = JSON.parse(fs.readFileSync(path.join(root, "doc-pipeline-lab.code-workspace"), "utf8")) as { folders: Array<{ path: string }>; settings: Record<string, unknown> };
    assert.deepEqual(ws.folders.map(f => f.path), ["doc-pipeline", "doc-orchestration", "doc-processing"]);
    // run.json reads back, with the VSIX hash and each clone's commit.
    const run = parseQaRun(fs.readFileSync(path.join(root, "run.json"))) as any;
    assert.equal(run.runId, "20260927-0930-doc-pipeline-lab");
    assert.equal(run.datapass.version, version);
    assert.equal(run.datapass.sha256, createHash("sha256").update(fs.readFileSync(vsix!)).digest("hex"));
    assert.equal(run.clients[0].bridge.commit, git(path.join(root, "doc-pipeline"), "rev-parse", "HEAD"));
    assert.deepEqual(run.journeys.map((x: { id: string }) => x.id), ["J01", "J02"]);
    assert.match(run.clients[0].launch, /--user-data-dir .*\.vscode-user --extensions-dir .*\.vscode-ext .*doc-pipeline-lab\.code-workspace/);
    assert.ok(lines.some(l => /Launch the isolated VS Code/.test(l)));
    // It wrote only under the root: the clones are untouched.
    for (const name of ["doc-pipeline", "doc-orchestration", "doc-processing"]) assert.equal(git(path.join(root, name), "status", "--porcelain"), "", `${name} unchanged`);
  } finally { cleanup(base); }
});

test("qa:prepare --check validates a test repository (config, journeys, a report) without a run root", async () => {
  const lines: string[] = [];
  const { check } = await import("../scripts/qa/prepare");
  const fx = path.join(repo, "tests", "fixtures", "qa");
  assert.equal(check({ auto: path.join(fx, "client"), log: l => lines.push(l) }).code, 0, lines.join("\n"));
  assert.equal(check({ auto: path.join(fx, "app"), report: "../report.json", log: l => lines.push(l) }).code, 0, lines.join("\n"));
  const r = check({ auto: path.join(fx, "client"), report: "journeys/J01-open-my-project.json", log: l => lines.push(l) });
  assert.equal(r.code, 2);
  assert.ok(r.reasons.some(x => /J01-open-my-project\.json: format must be "datapass\.qa-report"/.test(x)), r.reasons.join("\n"));
});
