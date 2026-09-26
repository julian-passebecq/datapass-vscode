/**
 * Desktop acceptance run: launches a real VS Code with this extension in development mode,
 * once per fixture workspace, and writes an evidence report.
 *
 *   npm run test:desktop                     isolated profile, no other extensions
 *   npm run test:desktop -- --real-extensions   also load the user's installed extensions
 *                                               (read-only use of ~/.vscode/extensions) to
 *                                               record what DataPass detects on this machine
 *
 * VS Code is taken from VSCODE_EXECUTABLE, then the default per-user Windows install, then
 * downloaded into .vscode-test/. The user's settings, state and windows are never touched:
 * every run uses a fresh temporary --user-data-dir.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { pathToFileURL } from "node:url";
import { foilProjectManifest, genericProjectManifest, migrateManifestToV2, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { graphAJson, manifestA } from "../tests/fixtures/v3/research";
import { optionsAJson, sheetAJson } from "../tests/fixtures/v3/researchOptions";
import { boardAJson } from "../tests/fixtures/v3/researchBoard";
import { DEVOPS_FILES, DEVOPS_REMOTES, graphDevopsJson, manifestDevops } from "../tests/fixtures/v3/devops";
import { filesB } from "../tests/fixtures/v3/monorepo";
import { filesSales } from "../tests/fixtures/v3/salesBi";

const repo = path.resolve(__dirname, "..");
const realExtensions = process.argv.includes("--real-extensions");
/** `--fixture=v3-research,v17-company` runs only those fixtures (one report each). */
const only = process.argv.find(a => a.startsWith("--fixture="))?.slice("--fixture=".length).split(",").map(s => s.trim()).filter(Boolean);

function v4Cloudflare(): DataPassProjectManifest {
  return {
    schemaVersion: 4,
    project: { id: "edge-shop", title: "Edge shop", description: "Cloudflare Worker with a MongoDB Atlas database (synthetic)." },
    localEnv: {
      files: [".env", { path: ".env.local", optional: true }],
      requiredKeys: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "MONGODB_URI", "R2_SECRET_ACCESS_KEY"]
    },
    identifiers: [{ id: "cf-account", label: "Cloudflare account ID", value: "0123456789abcdef0123456789abcdef", provider: "cloudflare", envKey: "CLOUDFLARE_ACCOUNT_ID" }],
    modules: { mongoku: false, diagramcloud: false },
    companions: { mongoku: { entityId: "edge_shop" } }
  };
}

function v2Retail(): DataPassProjectManifest {
  const m = migrateManifestToV2(genericProjectManifest("retail-bi"));
  // A project created before Mongoku was frozen (0.16): no modules block, so its Mongoku companion stays on.
  delete m.modules;
  m.platforms = {
    fabric: { workspaceName: "Retail" }, powerbi: { projectRoot: "bi" }, databricks: { bundleRoot: "bundle" },
    // Synthetic stack; nothing is contacted (links only reach the Test-mode browser seam).
    grafana: { url: "https://metrics.example.com/grafana/", dashboards: [{ uid: "weekly-1", title: "Weekly metrics", scopes: ["weekly-forecast"], source: "grafana/weekly.json" }] }
  };
  m.companions = { mongoku: { entityId: "retail_bi" } };
  // One synthetic VM shared by two scopes (Resources section, Remote-SSH seam; nothing is contacted).
  m.resources = [{ id: "retail-vm", kind: "vm", title: "Retail VM", provider: "oci", ssh: { host: "retail-vm" } }];
  m.bindings = [
    { id: "vm-weekly", resource: "retail-vm", scopes: ["weekly-forecast"], folder: "/srv/retail/weekly", compose: "docker-compose.weekly.yml", env: ["WAREHOUSE_URL"], processes: ["forecast-worker"] },
    { id: "vm-ops", resource: "retail-vm", scopes: ["ops"], folder: "/srv/retail/ops" }
  ];
  m.repositories = { site: { remote: { url: "https://github.com/example/site", branch: "main" }, management: "remote-only" } };
  m.apps = [{ id: "forecast-app", appType: "streamlit", repoRef: "site", entrypoint: "app.py" }];
  m.domainPacks = ["builtin:sample.retail"];
  m.scopes = [{
    id: "weekly-forecast", title: "Weekly forecast refresh", objective: "Publish the weekly forecast report",
    capabilityRefs: ["fabric.workspace.browse"],
    checklist: [
      { id: "notebook", label: "Update the forecast notebook", capabilityRef: "fabric.notebook.edit-local-sync" },
      { id: "review", label: "Review the report" }
    ]
  }, { id: "ops", title: "Operations", objective: "Keep the shared VM healthy" }];
  return m;
}

/** Byte-exact fixture text (tests/fixtures is -text in .gitattributes). */
function fixtureText(rel: string): string {
  return fs.readFileSync(path.join(repo, "tests", "fixtures", ...rel.split("/")), "utf8");
}

const FIXTURES: Record<string, Record<string, string>> = {
  "empty": { "README.md": "# empty workspace\n" },
  "v2-retail": {
    ".datapass/project.json": JSON.stringify(v2Retail(), null, 2) + "\n",
    "bundle/databricks.yml": "bundle:\n  name: retail\n",
    "bi/.gitkeep": "",
    "grafana/weekly.json": "{}\n",
    // Static inventory samples (never executed): one of each asset kind.
    "notebooks/eda.ipynb": JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }) + "\n",
    "fabric/Sales.Notebook/.platform": JSON.stringify({ metadata: { type: "Notebook", displayName: "Sales notebook" }, config: { version: "2.0", logicalId: "00000000-0000-0000-0000-000000000000" } }, null, 2) + "\n",
    "fabric/Sales.Notebook/notebook-content.py": "# Fabric notebook source\n",
    "dags/weekly.py": "from airflow import DAG\nwith DAG(dag_id=\"weekly_refresh\", schedule=None) as dag:\n    pass\n",
    "bundle/src/job.py": "# Databricks notebook source\nprint('synthetic')\n",
    "adf/pipeline/CopySales.json": JSON.stringify({ name: "CopySales", properties: { activities: [{ name: "Copy", type: "Copy" }] } }, null, 2) + "\n",
    // DiagramCloud's own sidecar sample and its own serialization after a known plan (tests/fixtures/diagramcloud).
    ".datapass/diagramcloud.json": fixtureText("diagramcloud/total.sidecar.json"),
    "incoming/diagramcloud.after-plan.golden.json": fixtureText("diagramcloud/total.after-plan.sidecar.json"),
    // Produced by Mongoku's own exporter from synthetic input (tests/fixtures/mongoku).
    "incoming/mongoku-context.json": fixtureText("mongoku/portfolio-context.synthetic.json")
  },
  "v1-foil": { ".datapass/project.json": JSON.stringify(foilProjectManifest(), null, 2) + "\n" },
  // Parses as JSON, but schemaVersion 6 does not exist (5 is the latest): both the extension and the schema must say so.
  "broken": { ".datapass/project.json": JSON.stringify({ ...genericProjectManifest("broken"), schemaVersion: 6 }, null, 2) + "\n" },
  // Manifest v4 environment readiness: a Cloudflare-backed project whose .env holds recognizable fake secrets
  // (tests/integration/readinessFlows.ts checks that none reaches any output). Mongoku and DiagramCloud are
  // switched off although mapped / present. .env and .env.local are git-ignored; the repository is real Git.
  "v4-cloudflare": {
    ".datapass/project.json": JSON.stringify(v4Cloudflare(), null, 2) + "\n",
    ".datapass/diagramcloud.json": fixtureText("diagramcloud/total.sidecar.json"),
    ".gitignore": ".env\n.env.local\n",
    ".env": "# Local secrets (fake, for the desktop test)\nCLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef\nexport CLOUDFLARE_API_TOKEN=\"DPFAKESECRET_7f3a9c1e5b2d_do_not_leak\"\nMONGODB_URI=\nUNDECLARED_PRIVATE_NAME=DPFAKE_UNDECLARED_VALUE_4410\n",
    "wrangler.toml": "name = \"edge-shop\"\nmain = \"src/index.ts\"\n",
    "src/index.ts": "export default { fetch: () => new Response(\"ok\") };\n",
    "tools/PowerOps.exe": ""
  }
};

// ---------------------------------------------------------------- V3 fixtures (real Git, offline)

const gitIn = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=DataPass test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "ignore" });
function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}
function commitAll(dir: string, message: string, init = true): void {
  if (init) gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", message);
}

/**
 * Multi-repository project, fully offline. The coordination repository is the workspace; the
 * pipeline repository is cloned next to it with its GitHub URL as origin, while Git fetches from a
 * local bare repository (url.<bare>.insteadOf). The test plays the AI by pushing a commit from a
 * second clone, then checks for updates and gets them through DataPass.
 */
function setupV3Research(base: string): { workspace: string; env: Record<string, string> } {
  const remotes = path.join(base, "remotes");
  const seed = path.join(remotes, "seed-pipeline");
  writeTree(seed, {
    "functions/extract/function_app.py": "import azure.functions as func\n\napp = func.FunctionApp()\n",
    "functions/extract/host.json": JSON.stringify({ version: "2.0" }, null, 2) + "\n",
    "functions/extract/tests/test_extract.py": "def test_placeholder():\n    assert True\n",
    "adf/pipeline/build_candidates.json": JSON.stringify({ name: "build_candidates", properties: { activities: [{ name: "Extract", type: "AzureFunctionActivity" }] } }, null, 2) + "\n",
    "cosmos/containers/chunks.json": JSON.stringify({ id: "chunks", partitionKey: { paths: ["/sourceId"] } }, null, 2) + "\n"
  });
  commitAll(seed, "seed pipeline");
  const bare = path.join(remotes, "research-pipeline.git");
  execFileSync("git", ["clone", "-q", "--bare", seed, bare], { stdio: "ignore" });
  const parent = path.join(base, "projects");
  const clone = path.join(parent, "research-pipeline");
  execFileSync("git", ["clone", "-q", bare, clone], { stdio: "ignore" });
  gitIn(clone, "remote", "set-url", "origin", "https://github.com/example-org/research-pipeline");
  gitIn(clone, "config", `url.${pathToFileURL(bare).href}.insteadOf`, "https://github.com/example-org/research-pipeline");
  gitIn(clone, "fetch", "-q", "origin");
  gitIn(clone, "branch", "-q", "--set-upstream-to=origin/main", "main");
  const hub = path.join(parent, "research-hub");
  writeTree(hub, {
    ".datapass/project.json": JSON.stringify(manifestA(), null, 2) + "\n",
    ".datapass/graph.json": JSON.stringify(graphAJson(), null, 2) + "\n",
    ".datapass/options.json": JSON.stringify(optionsAJson(), null, 2) + "\n",
    ".datapass/sheet.json": JSON.stringify(sheetAJson(), null, 2) + "\n",
    ".datapass/board.json": JSON.stringify(boardAJson(), null, 2) + "\n",
    "README.md": "# Research library (coordination)\n\nSynthetic DataPass V3 fixture.\n"
  });
  commitAll(hub, "coordination");
  const lab = path.join(base, "elsewhere", "lab-clone");
  writeTree(lab, { "databricks.yml": "bundle:\n  name: research_lab\n" });
  commitAll(lab, "lab");
  gitIn(lab, "remote", "add", "origin", "git@github.com:example-org/research-lab.git");
  const wrong = path.join(base, "elsewhere", "not-the-lab");
  writeTree(wrong, { "README.md": "another project\n" });
  commitAll(wrong, "other");
  gitIn(wrong, "remote", "add", "origin", "https://github.com/someone-else/research-lab");
  const ai = path.join(remotes, "ai-clone");
  execFileSync("git", ["clone", "-q", bare, ai], { stdio: "ignore" });
  return { workspace: hub, env: { DATAPASS_IT_V3: JSON.stringify({ aiClone: ai, labClone: lab, wrongClone: wrong, pipelineClone: clone }) } };
}

/**
 * 0.17: the research project as a company window — a `.code-workspace` file next to its two
 * repositories (relative folders) naming the company and the work view to open with, and that work
 * view saved machine-locally in the coordination repository's `.datapass/local/views.json`.
 */
function setupV17Company(base: string): { workspace: string; env: Record<string, string> } {
  const { workspace: hub, env } = setupV3Research(base);
  writeTree(hub, {
    ".datapass/local/.gitignore": "*\n",
    ".datapass/local/views.json": JSON.stringify({
      format: "datapass.work-views", version: "1",
      views: [{
        id: "review", name: "Review", savedAt: "2026-09-25T15:00:00.000Z",
        selection: { subproject: "papers", component: "review" },
        editors: {
          layout: { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] },
          groups: [{ tabs: [{ repo: ".", path: "README.md" }] }, { tabs: [{ repo: "pipeline", path: "cosmos/containers/chunks.json" }] }],
          activeGroup: 1
        },
        panes: ["project", "architecture"],
        diagram: { full: { view: "architecture", dir: "TB", groupBy: "none", folded: [], zoom: "fit" } }
      }]
    }, null, 2) + "\n"
  });
  const file = path.join(path.dirname(hub), "Research Co.code-workspace");
  fs.writeFileSync(file, JSON.stringify({
    folders: [{ path: "research-hub" }, { path: "research-pipeline" }],
    settings: { "datapass.company": "Research Co", "datapass.startupView": "review" }
  }, null, "\t") + "\n");
  return { workspace: file, env };
}

function setupV3Monorepo(base: string): { workspace: string; env: Record<string, string> } {
  const ws = path.join(base, "catalog-import");
  writeTree(ws, filesB());
  commitAll(ws, "catalogue import");
  return { workspace: ws, env: {} };
}

/**
 * 0.16: one repository per Git host. The coordination repository is the workspace; the GitHub and
 * Azure DevOps repositories are cloned next to it with origins in their SSH form (the manifest
 * declares https forms, the Azure one with "{org}@"), the GitLab one is not cloned. Offline: the
 * origins are only read, never contacted.
 */
function setupV3Devops(base: string): { workspace: string; env: Record<string, string> } {
  const parent = path.join(base, "projects");
  const hub = path.join(parent, "platform-hub");
  writeTree(hub, {
    ".datapass/project.json": JSON.stringify(manifestDevops(), null, 2) + "\n",
    ".datapass/graph.json": JSON.stringify(graphDevopsJson(), null, 2) + "\n",
    "README.md": "# Shop platform (coordination)\n\nSynthetic DataPass 0.16 fixture.\n"
  });
  commitAll(hub, "coordination");
  const web = path.join(parent, "shop-web");
  writeTree(web, DEVOPS_FILES.web);
  commitAll(web, "web");
  gitIn(web, "remote", "add", "origin", DEVOPS_REMOTES.webOrigin);
  const api = path.join(parent, "orders-api");
  writeTree(api, DEVOPS_FILES.api);
  commitAll(api, "api");
  gitIn(api, "remote", "add", "origin", DEVOPS_REMOTES.apiOrigin);
  return { workspace: hub, env: {} };
}

/** 0.18: the public "Sales BI" example (manifest v5: toolchain, ID map, connections) as a real Git repository. */
function setupV18Toolchain(base: string): { workspace: string; env: Record<string, string> } {
  const ws = path.join(base, "sales-bi");
  writeTree(ws, filesSales());
  commitAll(ws, "sales bi");
  return { workspace: ws, env: {} };
}

/**
 * 0.19 Git module: two repositories with local bare remotes (their origins are GitHub addresses,
 * fetched from the bare repositories through url.<bare>.insteadOf), two worktrees, a repository in
 * detached HEAD beside them, and a stub gh. Offline; the stub answers from a JSON file.
 *
 *   research-hub       coordination, one uncommitted file on main (rule 4)
 *   research-pipeline  PR #38 CI failed (1), PR #41 green (2); PR #36 squash-merged on the remote
 *                      after this clone's last fetch (3); worktree fix-a: PR #36's branch, clean (5);
 *                      worktree wip: a commit never pushed (6)
 *   side-project       not in the project, detached HEAD (Other repositories, rule 7)
 */
function setupV19Git(base: string): { workspace: string; env: Record<string, string> } {
  const remotes = path.join(base, "remotes");
  const parent = path.join(base, "projects");
  const bareOf = (name: string, files: Record<string, string>) => {
    const seed = path.join(remotes, `seed-${name}`);
    writeTree(seed, files);
    commitAll(seed, `seed ${name}`);
    const bare = path.join(remotes, `${name}.git`);
    execFileSync("git", ["clone", "-q", "--bare", seed, bare], { stdio: "ignore" });
    return bare;
  };
  const cloneAs = (bare: string, name: string) => {
    const dir = path.join(parent, name);
    const url = `https://github.com/example-org/${name}`;
    execFileSync("git", ["clone", "-q", bare, dir], { stdio: "ignore" });
    gitIn(dir, "remote", "set-url", "origin", url);
    gitIn(dir, "config", `url.${pathToFileURL(bare).href}.insteadOf`, url);
    gitIn(dir, "fetch", "-q", "origin");
    gitIn(dir, "branch", "-q", "--set-upstream-to=origin/main", "main");
    gitIn(dir, "remote", "set-head", "origin", "main");
    return dir;
  };
  const manifest = {
    schemaVersion: 4,
    project: { id: "git-orientation", title: "Git orientation", description: "Synthetic 0.19 fixture: two repositories, worktrees, pull requests." },
    modules: { mongoku: false, diagramcloud: false },
    repositories: {
      pipeline: { label: "research-pipeline", remote: { url: "https://github.com/example-org/research-pipeline", branch: "main" } },
      infra: { label: "research-infra", planned: true, remote: { url: "https://github.com/example-org/research-infra" } }
    }
  };
  const hubBare = bareOf("research-hub", { ".datapass/project.json": JSON.stringify(manifest, null, 2) + "\n", "README.md": "# Git orientation (coordination)\n" });
  const hub = cloneAs(hubBare, "research-hub");
  writeTree(hub, { "notes.md": "uncommitted notes on main\n" });

  const pipeBare = bareOf("research-pipeline", { "functions/extract/function_app.py": "import azure.functions as func\n", "README.md": "# pipeline\n" });
  const pipe = cloneAs(pipeBare, "research-pipeline");
  // As Claude Code does: its worktrees folder is excluded locally, so the main clone stays clean.
  fs.appendFileSync(path.join(pipe, ".git", "info", "exclude"), "\n.claude/worktrees/\n");
  // Worktree fix-a: its branch is pushed, then "squash-merged" on the remote (a new commit on main).
  const fixA = path.join(pipe, ".claude", "worktrees", "fix-a");
  gitIn(pipe, "worktree", "add", "-q", "-b", "claude/fix-a", fixA);
  writeTree(fixA, { "functions/extract/retry.py": "RETRIES = 3\n" });
  gitIn(fixA, "add", "-A");
  gitIn(fixA, "commit", "-q", "-m", "retry the extraction");
  gitIn(fixA, "push", "-q", "-u", "origin", "claude/fix-a");
  const ai = path.join(remotes, "ai-clone");
  execFileSync("git", ["clone", "-q", pipeBare, ai], { stdio: "ignore" });
  writeTree(ai, { "functions/extract/retry.py": "RETRIES = 3\n" });
  gitIn(ai, "add", "-A");
  gitIn(ai, "commit", "-q", "-m", "Retry the extraction (#36)");
  gitIn(ai, "push", "-q", "origin", "main");
  const squash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ai, encoding: "utf8" }).trim();
  // Worktree wip: a commit on a branch that was never pushed, and an untracked file.
  const wip = path.join(pipe, ".claude", "worktrees", "wip");
  gitIn(pipe, "worktree", "add", "-q", "-b", "claude/wip", wip);
  writeTree(wip, { "functions/extract/draft.py": "# draft\n" });
  gitIn(wip, "add", "-A");
  gitIn(wip, "commit", "-q", "-m", "draft");
  writeTree(wip, { "scratch.txt": "untracked\n" });

  const side = path.join(parent, "side-project");
  writeTree(side, { "README.md": "# side project\n" });
  commitAll(side, "one");
  writeTree(side, { "README.md": "# side project\n\nmore\n" });
  commitAll(side, "two", false);
  gitIn(side, "checkout", "-q", "--detach", "HEAD~1");

  // The stub gh and its answers.
  const stub = path.join(base, "tools", "gh-stub.cjs");
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.copyFileSync(path.join(repo, "tests", "fixtures", "git", "gh-stub.cjs"), stub);
  const web = "https://github.com/example-org/research-pipeline";
  fs.writeFileSync(stub + ".json", JSON.stringify({
    signedIn: true,
    repos: {
      "example-org/research-pipeline": {
        open: [
          { number: 41, title: "Green change", headRefName: "claude/green", isDraft: false, reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", updatedAt: "2026-09-25T16:00:00Z", statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: `${web}/actions/runs/7/job/8` }] },
          { number: 38, title: "Fix lint", headRefName: "claude/fix-lint", isDraft: false, reviewDecision: "", mergeStateStatus: "UNSTABLE", updatedAt: "2026-09-25T15:00:00Z", url: "https://evil.example/not-this", statusCheckRollup: [{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: `${web}/actions/runs/1/job/2` }, { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" }] }
        ],
        closed: [
          { number: 36, title: "Retry the extraction", headRefName: "claude/fix-a", state: "MERGED", mergedAt: "2026-09-25T17:00:00Z", mergeCommit: { oid: squash } },
          { number: 30, title: "Abandoned idea", headRefName: "claude/old", state: "CLOSED", mergedAt: null }
        ]
      },
      "example-org/research-hub": { open: [], closed: [] }
    }
  }, null, 2));
  return { workspace: hub, env: { DATAPASS_IT_V19: JSON.stringify({ ghStub: stub, projects: parent, pipeline: pipe, fixA, wip, side, squash }) } };
}

/**
 * 0.20 work orders: the research project (manifest v5, project.type dev) with its coordination
 * repository and the pipeline cloned beside it, both with GitHub origins fetched from local bare
 * repositories, a stub gh (one failing PR on the pipeline, the private log repository marked
 * private) and a stub `claude` that does what an order asks (worktree, commit, push, PR in the stub
 * gh's answers, proposed files, result.json). Offline.
 */
function setupV20WorkOrders(base: string): { workspace: string; env: Record<string, string> } {
  const remotes = path.join(base, "remotes");
  const parent = path.join(base, "projects");
  const bareOf = (name: string, files: Record<string, string>) => {
    const seed = path.join(remotes, `seed-${name}`);
    writeTree(seed, files);
    commitAll(seed, `seed ${name}`);
    const bare = path.join(remotes, `${name}.git`);
    execFileSync("git", ["clone", "-q", "--bare", seed, bare], { stdio: "ignore" });
    return bare;
  };
  const cloneAs = (bare: string, name: string) => {
    const dir = path.join(parent, name);
    const url = `https://github.com/example-org/${name}`;
    execFileSync("git", ["clone", "-q", bare, dir], { stdio: "ignore" });
    gitIn(dir, "remote", "set-url", "origin", url);
    gitIn(dir, "config", `url.${pathToFileURL(bare).href}.insteadOf`, url);
    gitIn(dir, "config", "user.name", "Fixture");
    gitIn(dir, "config", "user.email", "fixture@example.invalid");
    gitIn(dir, "fetch", "-q", "origin");
    gitIn(dir, "branch", "-q", "--set-upstream-to=origin/main", "main");
    gitIn(dir, "remote", "set-head", "origin", "main");
    // As Claude Code does: its worktrees folder is excluded locally, so the main clone stays clean.
    fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), "\n.claude/worktrees/\n");
    return dir;
  };
  const manifest = { ...manifestA(), schemaVersion: 5, project: { ...manifestA().project, type: "dev" } };
  const hubBare = bareOf("research-library", {
    ".datapass/project.json": JSON.stringify(manifest, null, 2) + "\n",
    ".datapass/graph.json": JSON.stringify(graphAJson(), null, 2) + "\n",
    ".datapass/board.json": JSON.stringify(boardAJson(), null, 2) + "\n",
    "AGENTS.md": "# Conventions\n\nKeep .datapass files valid.\n",
    "README.md": "# Research library (coordination)\n"
  });
  const hub = cloneAs(hubBare, "research-library");
  const pipeBare = bareOf("research-pipeline", {
    "functions/extract/function_app.py": "import azure.functions as func\n\napp = func.FunctionApp()\n",
    "functions/extract/host.json": JSON.stringify({ version: "2.0" }, null, 2) + "\n",
    "README.md": "# pipeline\n"
  });
  const pipe = cloneAs(pipeBare, "research-pipeline");
  // A private log repository beside them (never pushed in the test).
  const logRepo = path.join(parent, "work-log-private");
  writeTree(logRepo, { "README.md": "# Work logs (private)\n" });
  commitAll(logRepo, "log");
  gitIn(logRepo, "remote", "add", "origin", "https://github.com/example-org/work-log-private");
  // A clone the test uses to move origin/main (the "base moved" check).
  const other = path.join(remotes, "hub-other");
  execFileSync("git", ["clone", "-q", hubBare, other], { stdio: "ignore" });

  const tools = path.join(base, "tools");
  fs.mkdirSync(tools, { recursive: true });
  const gh = path.join(tools, "gh-stub.cjs");
  fs.copyFileSync(path.join(repo, "tests", "fixtures", "git", "gh-stub.cjs"), gh);
  fs.writeFileSync(gh + ".json", JSON.stringify({
    signedIn: true,
    visibility: { "example-org/work-log-private": "PRIVATE" },
    repos: {
      "example-org/research-pipeline": {
        open: [{ number: 38, title: "Fix lint", headRefName: "claude/fix-lint", isDraft: false, reviewDecision: "", mergeStateStatus: "UNSTABLE", updatedAt: "2026-09-25T15:00:00Z", statusCheckRollup: [{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" }] }],
        closed: []
      },
      "example-org/research-library": { open: [], closed: [] }
    }
  }, null, 2));
  const claude = path.join(tools, "claude-stub.cjs");
  fs.copyFileSync(path.join(repo, "tests", "fixtures", "agents", "claude-stub.cjs"), claude);
  fs.writeFileSync(claude + ".json", JSON.stringify({ mode: "good", ghStub: gh }, null, 2));
  return { workspace: hub, env: { DATAPASS_IT_V20: JSON.stringify({ ghStub: gh, claudeStub: claude, hub, pipeline: pipe, logRepo, other, projects: parent }) } };
}

/** Fixtures that need more than a file map (Git history, sibling clones, a local remote). */
const SETUPS: Record<string, (base: string) => { workspace: string; env: Record<string, string> }> = {
  "v3-research": setupV3Research,
  "v3-monorepo": setupV3Monorepo,
  "v3-devops": setupV3Devops,
  "v17-company": setupV17Company,
  "v18-toolchain": setupV18Toolchain,
  "v19-git": setupV19Git,
  "v20-work-orders": setupV20WorkOrders,
  // 0.22 modes: the research project opened as a new install (no DataPass settings: Standard).
  "v22-modes": setupV3Research
};

async function vscodeExecutable(): Promise<string> {
  const fromEnv = process.env.VSCODE_EXECUTABLE;
  if (fromEnv) return fromEnv;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const installed = path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe");
    if (fs.existsSync(installed)) return installed;
  }
  return downloadAndUnzipVSCode("stable");
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(repo, "dist", "extension.js"))) throw new Error("Run `npm run build` first.");
  const out = path.join(repo, "out", "integration");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(repo, "tests", "integration", "suite.ts")],
    bundle: true, platform: "node", format: "cjs", target: "node20",
    external: ["vscode"], outfile: path.join(out, "suite.js"), logLevel: "warning"
  });

  const executable = await vscodeExecutable();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "datapass-desktop-"));
  const reports: unknown[] = [];
  let failed = 0;
  for (const name of [...Object.keys(FIXTURES), ...Object.keys(SETUPS)]) {
    if (only && !only.includes(name)) continue;
    const files = FIXTURES[name];
    let ws = path.join(scratch, "ws", name);
    let env: Record<string, string> = {};
    if (files) {
      for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
        fs.writeFileSync(path.join(ws, rel), content);
      }
    } else {
      ({ workspace: ws, env } = SETUPS[name]!(path.join(scratch, "ws", name)));
    }
    // v2-retail and v4-cloudflare are real Git repositories (branch and commit; .env is git-ignored).
    if (name === "v2-retail" || name === "v4-cloudflare") {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=DataPass test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: ws, stdio: "ignore" });
      git("init", "-q", "-b", "main");
      git("add", "-A");
      git("commit", "-q", "-m", "fixture");
    }
    // 0.22 modes: the earlier suites check 0.20's surfaces (Advanced, no landing); v22-modes starts as a new install.
    if (name !== "v22-modes") writeTree(path.join(scratch, "profile", name, "User"), { "settings.json": JSON.stringify({ "datapass.experience.preset": "advanced", "datapass.experience.overrides": { "landing.architecture": false } }, null, 2) });
    const reportFile = path.join(out, `report-${name}.json`);
    const launchArgs = [
      ws,
      "--user-data-dir", path.join(scratch, "profile", name),
      "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-telemetry", "--disable-updates", "--new-window"
    ];
    if (realExtensions) launchArgs.push("--extensions-dir", path.join(os.homedir(), ".vscode", "extensions"));
    else launchArgs.push("--disable-extensions", "--extensions-dir", path.join(scratch, "extensions"));
    console.log(`\n▶ fixture ${name}${realExtensions ? " (with installed extensions)" : ""}`);
    try {
      await runTests({
        vscodeExecutablePath: executable,
        extensionDevelopmentPath: repo,
        extensionTestsPath: path.join(out, "suite.js"),
        launchArgs,
        extensionTestsEnv: { DATAPASS_IT_FIXTURE: name, DATAPASS_IT_REPORT: reportFile, ...env }
      });
    } catch {
      failed++;
    }
    if (fs.existsSync(reportFile)) reports.push(JSON.parse(fs.readFileSync(reportFile, "utf8")));
    else reports.push({ fixture: name, results: [], error: "the extension host produced no report (crash or timeout)" });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    executable,
    realExtensions,
    host: { platform: process.platform, release: os.release(), arch: process.arch },
    reports
  };
  const summaryFile = path.join(out, realExtensions ? "desktop-report.real-extensions.json" : "desktop-report.json");
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  console.log(`\nEvidence report: ${path.relative(repo, summaryFile)}`);
  if (failed) {
    console.error(`${failed} fixture run(s) failed.`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
