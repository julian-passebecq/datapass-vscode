/**
 * V5E2E1: builds the V5 acceptance fixtures in a scratch folder (go/V5-ACCEPTANCE.md "Fixtures").
 * Synthetic only: no FOIL data, client payloads or credentials, and no remote anywhere.
 *  - `shop`               a copy of tests/fixtures/v5/shop, committed once (the dbt revision a detach stamp records);
 *  - `shop-bare`          the same code without `.datapass/` and `samples/` (every hole case), committed too;
 *  - `repo-set`           three local repos (`ingest`, `transform`, `bi`) made by `git init` and scripted
 *                         commits, `.datapass/repos.json` (roles, edges, one vendored Common pin) and a
 *                         local fake Common clone one commit ahead of the pin;
 *  - `repo-set-no-bi`     the same without the `bi` clone (hole: "missing clone");
 *  - `repo-set-no-common` the same without the Common clone (hole: drift "unknown");
 *  - `shop-macro`         `shop` whose compiled fct_orders still holds a macro call (row 02 hole);
 *  - `shop-milestone`     `shop` with a readiness milestone (checklist item `gold-ready`) on fct_orders (row 13);
 *  - `dag`                two synthetic Airflow DAGs, one with an operator of an unknown kind (row 07);
 *  - `fastapi-orders`     four FastAPI endpoints plus the OTLP replay cassettes (row 04, cut to V5.1);
 *  - `studio-demo` / `studio-hole`: not folders here, see `buildStudioOverlay` (row 14, Chromium).
 * Canned AI answers (tests/fixtures/v5/exchange) are given to file dialogs by the `chooseCassette` step.
 * Commits use a fixed author and date, so SHAs are the same on every run.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { V5Fixture } from "../../src/qa/v5/acceptance";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const V5_FIXTURE_DIR = path.join(REPO_ROOT, "tests", "fixtures", "v5");
export const SHOP_BARE_EXCLUDES = [".datapass", "samples"];

const GIT_ENV = {
  GIT_AUTHOR_NAME: "DataPass QA", GIT_AUTHOR_EMAIL: "qa@example.invalid",
  GIT_COMMITTER_NAME: "DataPass QA", GIT_COMMITTER_EMAIL: "qa@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1"
};

function git(cwd: string, args: string[], date?: string): string {
  const env = { ...process.env, ...GIT_ENV, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, env, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root: string, rel: string, text: string): void {
  const p = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text.replace(/^\n/, ""));
}

function copyTree(from: string, to: string, skip: readonly string[] = []): void {
  fs.cpSync(from, to, { recursive: true, filter: src => !skip.includes(path.relative(from, src).split(path.sep)[0]!) });
}

let day = 0;
function commit(repo: string, message: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message], `2026-09-${String(10 + day++).padStart(2, "0")}T09:00:00Z`);
  return git(repo, ["rev-parse", "HEAD"]);
}

function initRepo(repo: string): void { fs.mkdirSync(repo, { recursive: true }); git(repo, ["init", "-q"]); }

/** The three-repo set; returns the pinned and the current Common SHAs. */
export function buildRepoSet(dest: string, opts: { withoutBi?: boolean; withoutCommon?: boolean } = {}): { pinned: string; commonHead?: string } {
  day = 0;
  fs.mkdirSync(dest, { recursive: true });
  // Fake Common: two commits; the transform repo vendors the first.
  const common = path.join(dest, "common");
  initRepo(common);
  write(common, "packages/semantic-core/package.json", JSON.stringify({ name: "@example/semantic-core", version: "0.1.0" }, null, 2) + "\n");
  write(common, "packages/semantic-core/index.js", "exports.version = '0.1.0';\n");
  const pinned = commit(common, "semantic-core 0.1.0");
  write(common, "packages/semantic-core/index.js", "exports.version = '0.1.1';\nexports.digest = 'sha256';\n");
  write(common, "packages/semantic-core/package.json", JSON.stringify({ name: "@example/semantic-core", version: "0.1.1" }, null, 2) + "\n");
  const commonHead = commit(common, "semantic-core 0.1.1");

  const ingest = path.join(dest, "ingest");
  initRepo(ingest);
  write(ingest, "notebooks/load_orders.py", `
# Load landing order files into bronze.orders_raw (synthetic).
raw = spark.read.option("header", True).csv("Files/landing/orders/*.csv")
raw.write.mode("append").saveAsTable("bronze.orders_raw")
`);
  commit(ingest, "ingest: load orders to bronze");
  write(ingest, "notebooks/load_customers.py", `
raw = spark.read.option("header", True).csv("Files/landing/customers/*.csv")
raw.write.mode("overwrite").saveAsTable("bronze.customers_raw")
`);
  commit(ingest, "ingest: load customers");
  // A feature branch tracking local main, one commit ahead, plus an uncommitted change (dirty lane).
  git(ingest, ["checkout", "-q", "-b", "feature/order-channel"]);
  git(ingest, ["branch", "-q", "--set-upstream-to=main"]);
  write(ingest, "notebooks/load_orders.py", `
# Load landing order files into bronze.orders_raw (synthetic).
from pyspark.sql import functions as F
raw = spark.read.option("header", True).csv("Files/landing/orders/*.csv")
raw = raw.withColumn("channel", F.lit("web"))
raw.write.mode("append").saveAsTable("bronze.orders_raw")
`);
  commit(ingest, "ingest: add order channel");
  fs.appendFileSync(path.join(ingest, "notebooks", "load_orders.py"), "# TODO: channel from the file name\n");

  const transform = path.join(dest, "transform");
  initRepo(transform);
  write(transform, "dbt_project.yml", "name: shop_transform\nversion: \"1.0.0\"\nconfig-version: 2\nmodel-paths: [\"models\"]\n");
  write(transform, "models/sources.yml", "version: 2\nsources:\n  - name: bronze\n    tables:\n      - name: orders_raw\n");
  write(transform, "models/stg_orders.sql", "select order_id, customer_id, amount from {{ source('bronze', 'orders_raw') }}\n");
  commit(transform, "transform: stg_orders");
  write(transform, "models/fct_orders.sql", "select customer_id, sum(amount) as revenue from {{ ref('stg_orders') }} group by customer_id\n");
  commit(transform, "transform: fct_orders");
  write(transform, "vendor/common/semantic-core/package.json", JSON.stringify({ name: "@example/semantic-core", version: "0.1.0" }, null, 2) + "\n");
  write(transform, "vendor/common/pin.json", JSON.stringify({ package: "@example/semantic-core", version: "0.1.0", sha: pinned }, null, 2) + "\n");
  commit(transform, "transform: vendor semantic-core 0.1.0");

  const bi = path.join(dest, "bi");
  initRepo(bi);
  write(bi, "Sales.SemanticModel/definition/tables/fct_orders.tmdl", "table fct_orders\n\tcolumn revenue\n\t\tdataType: decimal\n\tpartition fct_orders = entity\n\t\tmode: directLake\n\t\tsource\n\t\t\tentityName: fct_orders\n\t\t\tschemaName: gold\n");
  write(bi, "Sales.Report/definition.pbir", JSON.stringify({ version: "4.0", datasetReference: { byPath: { path: "../Sales.SemanticModel" } } }, null, 2) + "\n");
  commit(bi, "bi: sales report on fct_orders");

  write(dest, ".datapass/repos.json", JSON.stringify({
    repos: [
      { path: "ingest", id: "ingest", role: "data", defaultBranch: "main" },
      { path: "transform", id: "transform", role: "data", defaultBranch: "main" },
      { path: "bi", id: "bi", role: "app", defaultBranch: "main" },
      { path: "common", id: "common", role: "common", defaultBranch: "main" }
    ],
    edges: [
      { from: "ingest", to: "transform", kind: "lineage", reason: "bronze.orders_raw feeds stg_orders" },
      { from: "transform", to: "bi", kind: "lineage", reason: "gold fct_orders feeds the Sales model" },
      { from: "common", to: "transform", kind: "vendors", reason: "semantic-core vendored copy" }
    ],
    pins: [{ repo: "transform", package: "@example/semantic-core", pinnedSha: { algorithm: "git-sha1", oid: pinned }, sourceRepo: "common", version: "0.1.0", digest: null }]
  }, null, 2) + "\n");
  write(dest, "repo-set.code-workspace", JSON.stringify({ folders: [{ path: "." }, { path: "ingest" }, { path: "transform" }, { path: "bi" }].filter(f => !(opts.withoutBi && f.path === "bi")) }, null, 2) + "\n");
  if (opts.withoutBi) fs.rmSync(bi, { recursive: true, force: true });
  if (opts.withoutCommon) fs.rmSync(common, { recursive: true, force: true });
  return { pinned, ...(opts.withoutCommon ? {} : { commonHead }) };
}

/** Build one fixture under `dest`; returns the path VS Code opens (a folder or a `.code-workspace`). */
export function buildFixture(kind: V5Fixture, dest: string): string {
  fs.rmSync(dest, { recursive: true, force: true });
  switch (kind) {
    case "shop": case "shop-bare":
      day = 0;
      copyTree(path.join(V5_FIXTURE_DIR, "shop"), dest, kind === "shop-bare" ? SHOP_BARE_EXCLUDES : []);
      git(dest, ["init", "-q"]);
      commit(dest, `${kind}: synthetic lakehouse`);
      return dest;
    case "shop-macro": case "shop-milestone":
      day = 0;
      copyTree(path.join(V5_FIXTURE_DIR, "shop"), dest);
      if (kind === "shop-macro") {
        // dbt compile left a macro call it could not expand: the plan must show a typed hole, never guessed code.
        write(dest, "dbt/target/compiled/shop/models/marts/fct_orders.sql", `
select customer_id, order_date, count(*) as orders, {{ cents_to_currency('sum(amount)') }} as revenue
from shop_lakehouse.silver.stg_orders
group by customer_id, order_date
`);
      } else {
        // A readiness milestone on the gold model (a component checklist item), not done yet.
        const file = path.join(dest, ".datapass", "graph.json");
        const graph = JSON.parse(fs.readFileSync(file, "utf8")) as { items: Array<Record<string, unknown>> };
        const gold = graph.items.find(i => i.id === "fct-orders")!;
        gold.checklist = [{ id: "gold-ready", label: "Gold ready for the sales report" }];
        fs.writeFileSync(file, JSON.stringify(graph, null, 2) + "\n");
      }
      git(dest, ["init", "-q"]);
      commit(dest, `${kind}: synthetic lakehouse`);
      return dest;
    case "repo-set": buildRepoSet(dest); return path.join(dest, "repo-set.code-workspace");
    case "repo-set-no-bi": buildRepoSet(dest, { withoutBi: true }); return path.join(dest, "repo-set.code-workspace");
    case "repo-set-no-common": buildRepoSet(dest, { withoutCommon: true }); return path.join(dest, "repo-set.code-workspace");
    case "fastapi-orders": case "dag":
      day = 0;
      copyTree(path.join(V5_FIXTURE_DIR, kind), dest);
      git(dest, ["init", "-q"]);
      commit(dest, `${kind}: synthetic`);
      return dest;
    case "studio-demo": case "studio-hole":
      throw new Error(`fixture ${kind} is served to Chromium (buildStudioOverlay), not opened in VS Code`);
  }
}

// ------------------------------------------------------------------ Studio (row 14, Chromium)

/** The built SQLRooms shell inside a datapass-studio checkout. */
export const STUDIO_SHELL = "apps/studio-shell/dist";
/** The synthetic DataPass export Studio ships (examples/studio2), opened by the demo journey. */
export const STUDIO_DEMO_WORKSPACE = "examples/studio2/datapass-project.workspace.json";

/** `explicit`, else the nearest `datapass-studio` folder beside this checkout or one of its parents. */
export function findStudio(repo: string, explicit?: string): string | undefined {
  if (explicit) return path.resolve(explicit);
  for (let d = repo; ; d = path.dirname(d)) {
    const c = path.join(d, "datapass-studio");
    if (fs.existsSync(path.join(c, "apps", "studio-shell"))) return c;
    if (path.dirname(d) === d) return undefined;
  }
}

/**
 * Files served before the Studio checkout's own (the journey's synthetic workspace); returns the workspace path the
 * shell opens. `studio-demo` opens the shipped demo as is; `studio-hole` is the same demo whose catalog exports no
 * data for the project's "health" view (a view with no data: a hole panel, never sample rows).
 */
export function buildStudioOverlay(kind: V5Fixture, studio: string, overlay: string): string {
  fs.rmSync(overlay, { recursive: true, force: true });
  fs.mkdirSync(overlay, { recursive: true });
  if (kind === "studio-demo") return STUDIO_DEMO_WORKSPACE;
  if (kind !== "studio-hole") throw new Error(`${kind} is not a Studio fixture`);
  const dir = path.posix.dirname(STUDIO_DEMO_WORKSPACE);
  const ws = JSON.parse(fs.readFileSync(path.join(studio, ...STUDIO_DEMO_WORKSPACE.split("/")), "utf8")) as { id: string; title: string; datapassInputs: Array<{ id: string; schema: string; location: string }> };
  const input = ws.datapassInputs.find(i => i.schema === "datapass.view-catalog/1");
  if (!input) throw new Error("the Studio demo workspace has no view catalog input");
  const catalogRel = path.posix.join(dir, input.location);
  const catalog = JSON.parse(fs.readFileSync(path.join(studio, ...catalogRel.split("/")), "utf8")) as { locations: Array<{ location: { level: string }; data?: Record<string, unknown> }> };
  const project = catalog.locations.find(l => l.location.level === "project");
  if (!project?.data?.health) throw new Error("the Studio demo catalog has no project health data to remove");
  delete project.data.health;
  const holeCatalog = input.location.replace(/catalog\.json$/, "v5-hole-catalog.json");
  input.location = holeCatalog;
  ws.id = `${ws.id}-v5-hole`;
  ws.title = `${ws.title} (no health data)`;
  write(overlay, path.posix.join(dir, holeCatalog), JSON.stringify(catalog, null, 2) + "\n");
  const wsRel = path.posix.join(dir, "v5-hole.workspace.json");
  write(overlay, wsRel, JSON.stringify(ws, null, 2) + "\n");
  return wsRel;
}

/** Every file under `root` (posix, relative) with its size and mtime, `.git/` excluded. */
export function fileStamps(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = fs.statSync(p); out.set(path.relative(root, p).split(path.sep).join("/"), `${s.size}:${s.mtimeMs}`); }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}
