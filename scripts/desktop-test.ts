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
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { foilProjectManifest, genericProjectManifest, migrateManifestToV2, type DataPassProjectManifest } from "../src/core/projectManifestModel";

const repo = path.resolve(__dirname, "..");
const realExtensions = process.argv.includes("--real-extensions");
const only = process.argv.find(a => a.startsWith("--fixture="))?.slice("--fixture=".length);

function v2Retail(): DataPassProjectManifest {
  const m = migrateManifestToV2(genericProjectManifest("retail-bi"));
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
    // DiagramCloud's own sidecar sample and its own serialization after a known plan (tests/fixtures/diagramcloud).
    ".datapass/diagramcloud.json": fixtureText("diagramcloud/total.sidecar.json"),
    "incoming/diagramcloud.after-plan.golden.json": fixtureText("diagramcloud/total.after-plan.sidecar.json"),
    // Produced by Mongoku's own exporter from synthetic input (tests/fixtures/mongoku).
    "incoming/mongoku-context.json": fixtureText("mongoku/portfolio-context.synthetic.json")
  },
  "v1-foil": { ".datapass/project.json": JSON.stringify(foilProjectManifest(), null, 2) + "\n" },
  // Parses as JSON, but schemaVersion 3 does not exist: both the extension and the schema must say so.
  "broken": { ".datapass/project.json": JSON.stringify({ ...genericProjectManifest("broken"), schemaVersion: 3 }, null, 2) + "\n" }
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
  for (const [name, files] of Object.entries(FIXTURES)) {
    if (only && only !== name) continue;
    const ws = path.join(scratch, "ws", name);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
      fs.writeFileSync(path.join(ws, rel), content);
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
        extensionTestsEnv: { DATAPASS_IT_FIXTURE: name, DATAPASS_IT_REPORT: reportFile }
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
