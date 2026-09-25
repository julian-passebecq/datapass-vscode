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
  // Parses as JSON, but schemaVersion 5 does not exist (4 is the latest): both the extension and the schema must say so.
  "broken": { ".datapass/project.json": JSON.stringify({ ...genericProjectManifest("broken"), schemaVersion: 5 }, null, 2) + "\n" },
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

/** Fixtures that need more than a file map (Git history, sibling clones, a local remote). */
const SETUPS: Record<string, (base: string) => { workspace: string; env: Record<string, string> }> = {
  "v3-research": setupV3Research,
  "v3-monorepo": setupV3Monorepo,
  "v3-devops": setupV3Devops,
  "v17-company": setupV17Company
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
