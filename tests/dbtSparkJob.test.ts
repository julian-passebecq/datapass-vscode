import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { type DbtFile } from "../src/core/materialize/dbtNotebook";
import { type DbtSparkJobInput, type MaterializationTarget, materializeDbt, materializeDbtSparkJob, previewDbtSparkJobDiff, pythonModuleName } from "../src/core/materialize/dbtSparkJob";
import { materializationGitPlan } from "../src/core/materialize/flow";
import { readInlineStamp, sidecarPath, verifyStamp } from "../src/core/materialize/stamp";
import { DEFAULT_TARGET_CARD_POLICY, DEFAULT_TARGET_CARD_TEXT, chooseTarget, materializationTargetCard, parseTargetCardSettings, targetCardLines, targetCardPicks } from "../src/core/materialize/targetCard";
import { parseDbtMaterializeConfig } from "../src/core/materialize/dbtMaterialize";

const ROOT = join(__dirname, "fixtures", "dbtmat");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files: DbtFile[] = walk(ROOT).map(p => ({ path: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));

const REV = "0123456789abcdef0123456789abcdef01234567";
const input = (over: Partial<DbtSparkJobInput & { target: MaterializationTarget }> = {}): DbtSparkJobInput & { target?: MaterializationTarget } => ({
  files,
  environment: "dev",
  environments: { dev: { lakehouse: "lh_dev", sources: { "raw.orders": "lh_bronze_dev.orders" } } },
  dbtRevision: REV,
  rootDirectory: "fabric",
  at: "2026-10-01T08:00:00Z",
  models: ["stg_orders", "customer_totals"],
  ...over
});

const NOTEBOOK_GOLDEN = [
  ".datapass/materialization/fabric/dbt_customer_totals.Notebook/notebook-content.py.detach.json",
  ".datapass/materialization/fabric/dbt_stg_orders.Notebook/notebook-content.py.detach.json",
  ".datapass/provenance/fabric/dbt_customer_totals.Notebook/.platform.provenance.json",
  ".datapass/provenance/fabric/dbt_stg_orders.Notebook/.platform.provenance.json",
  "fabric/dbt_customer_totals.Notebook/.platform",
  "fabric/dbt_customer_totals.Notebook/notebook-content.py",
  "fabric/dbt_stg_orders.Notebook/.platform",
  "fabric/dbt_stg_orders.Notebook/notebook-content.py"
];

const SJD_GOLDEN = [
  ".datapass/provenance/fabric/dbt_shop_job.SparkJobDefinition/.platform.provenance.json",
  ".datapass/provenance/fabric/dbt_shop_job.SparkJobDefinition/SparkJobDefinitionV1.json.provenance.json",
  ".datapass/provenance/jobs/dbt_shop_jobs/pyproject.toml.provenance.json",
  "fabric/dbt_shop_job.SparkJobDefinition/.platform",
  "fabric/dbt_shop_job.SparkJobDefinition/Main/main.py",
  "fabric/dbt_shop_job.SparkJobDefinition/SparkJobDefinitionV1.json",
  "jobs/dbt_shop_jobs/pyproject.toml",
  "jobs/dbt_shop_jobs/src/dbt_shop_jobs/__init__.py",
  "jobs/dbt_shop_jobs/src/dbt_shop_jobs/models/__init__.py",
  "jobs/dbt_shop_jobs/src/dbt_shop_jobs/models/customer_totals.py",
  "jobs/dbt_shop_jobs/src/dbt_shop_jobs/models/stg_orders.py",
  "jobs/dbt_shop_jobs/src/dbt_shop_jobs/runner.py",
  "jobs/dbt_shop_jobs/tests/test_models.py"
];

/** Every item file carries an intact MAT1 stamp for this source revision and environment. */
function assertStamped(out: { files: Array<{ path: string; content: string; role: string }> }, nativeKinds: string[]) {
  for (const f of out.files.filter(x => x.role === "item")) {
    const sidecar = out.files.find(s => s.path === sidecarPath(f.path))?.content;
    const { verdict, stamp } = verifyStamp(f.path, f.content, sidecar);
    assert.equal(verdict, "intact", f.path);
    assert.equal(stamp!.sourceRevision, REV, f.path);
    assert.equal(stamp!.environment, "dev", f.path);
    assert.equal(stamp!.evidenceOrigin, "generated", f.path);
    assert.ok(nativeKinds.includes(stamp!.nativeKind), f.path);
  }
}

test("one dbt fixture → both targets: golden file lists, every file stamped", () => {
  const nb = materializeDbt(input());
  assert.equal(nb.target, "fabric-notebook");
  assert.deepEqual(nb.issues, []);
  assert.deepEqual(nb.files.map(f => f.path), NOTEBOOK_GOLDEN);
  assertStamped(nb, ["notebook"]);

  const sjd = materializeDbt(input({ target: "spark-job-definition" }));
  assert.equal(sjd.target, "spark-job-definition");
  assert.deepEqual(sjd.issues, []);
  assert.deepEqual(sjd.files.map(f => f.path), SJD_GOLDEN);
  assertStamped(sjd, ["spark-job-definition"]);
  // Same source → same SQL statement in both targets.
  const stmt = "CREATE OR REPLACE TABLE lh_dev.customer_totals USING DELTA AS";
  assert.ok(nb.files.find(f => f.path.endsWith("dbt_customer_totals.Notebook/notebook-content.py"))!.content.includes(stmt));
  assert.ok(sjd.files.find(f => f.path.endsWith("models/customer_totals.py"))!.content.includes(JSON.stringify(stmt)));
});

test("SJD: thin entry, SJD definition from MAT1, runner in dbt dependency order", () => {
  const r = materializeDbtSparkJob(input({ models: ["customer_totals", "stg_orders"] }));
  const text = (suffix: string) => readInlineStamp(r.files.find(f => f.path.endsWith(suffix))!.content).body;
  const main = text("Main/main.py");
  assert.match(main, /from dbt_shop_jobs\.runner import main/);
  assert.ok(main.split("\n").length <= 8, "entry script stays thin");
  const def = JSON.parse(r.files.find(f => f.path.endsWith("SparkJobDefinitionV1.json"))!.content);
  assert.equal(def.executableFile, "Main/main.py");
  assert.equal(def.language, "Python");
  assert.deepEqual(r.modules.map(m => m.module), ["stg_orders", "customer_totals"]);
  assert.match(text("runner.py"), /ORDER = \("stg_orders", "customer_totals"\)/);
  const totals = text("models/customer_totals.py");
  assert.match(totals, /DEPENDS_ON = \("stg_orders",\)/);
  assert.match(totals, /from lh_dev\.stg_orders/);
  assert.match(text("models/stg_orders.py"), /lh_bronze_dev\.orders/);
  assert.match(r.files.find(f => f.path.endsWith("pyproject.toml"))!.content, /name = "dbt-shop-jobs"/);
  assert.equal(r.nextActions.length, 2);
});

test("holes stay holes; names and folders are data", () => {
  const r = materializeDbtSparkJob(input({ models: ["top_customers", "stg_orders"], jobName: "nightly", packageName: "shop_pkg", wheelDirectory: "py/shop" }));
  assert.deepEqual(r.holes.map(h => h.code), ["dbt.compiled-sql-missing"]);
  assert.ok(r.files.some(f => f.path === "fabric/nightly.SparkJobDefinition/Main/main.py"));
  assert.ok(r.files.some(f => f.path === "py/shop/src/shop_pkg/models/stg_orders.py"));
  assert.ok(!r.files.some(f => f.path.includes("top_customers")));
  assert.deepEqual(materializeDbtSparkJob(input({ models: ["top_customers"] })).files, []);
  assert.ok(materializeDbtSparkJob(input({ packageName: "Bad-Name" })).issues.some(i => /lowercase Python identifier/.test(i.message)));
  assert.ok(materializeDbtSparkJob(input({ wheelDirectory: "../out" })).issues.some(i => /wheelDirectory/.test(i.message)));
  assert.equal(pythonModuleName("2nd-model"), "m_2nd_model");
  assert.equal(pythonModuleName("class"), "class_");
});

test("diff → Git plan through MAT1 (arguments only, no build, no deploy); hand-edited files are blocked", () => {
  const r = materializeDbtSparkJob(input());
  const runner = r.files.find(f => f.path.endsWith("runner.py"))!;
  const existing = new Map([[runner.path, `${runner.content}# hand edit\n`]]);
  const diff = previewDbtSparkJobDiff(r, existing);
  assert.equal(diff.find(d => d.path === runner.path)!.status, "blocked-detached");
  assert.equal(diff.filter(d => d.status === "added").length, r.files.length - 1);
  const plan = materializationGitPlan({ userAction: "user-confirmed", branch: "datapass/sjd", baseBranch: "main", candidate: r.candidate, files: r.files, diff, issues: r.issues, openMergeRequest: false });
  assert.ok(!plan.writes.some(w => w.path === runner.path));
  for (const c of plan.commands) {
    assert.equal(c.tool, "git");
    assert.ok(["checkout", "switch", "add", "commit", "push"].includes(c.args[0]!), c.args.join(" "));
    assert.ok(!c.args.some(a => /^(python|pip|spark-submit|fabric-cicd)\b/.test(a)), c.args.join(" "));
  }
});

test("EXEC1c card: both targets offered, DataPass recommends, the user picks", () => {
  const dev = materializationTargetCard({ modelCount: 2, environment: "dev" });
  assert.deepEqual(dev.options.map(o => o.target), ["fabric-notebook", "spark-job-definition"]);
  assert.equal(dev.recommendation.target, "fabric-notebook");
  assert.deepEqual(dev.recommendation.reasonIds, ["exploration"]);
  assert.equal(dev.choice, null);
  const prod = materializationTargetCard({ modelCount: 6, environment: "prod" });
  assert.equal(prod.recommendation.target, "spark-job-definition");
  assert.deepEqual(prod.recommendation.reasonIds, ["production-environment", "many-models"]);
  assert.equal(prod.options.find(o => o.recommended)!.label, DEFAULT_TARGET_CARD_TEXT.options["spark-job-definition"].label);
  // The user may pick against the recommendation; the pick drives the materializer.
  const picked = chooseTarget(prod, "fabric-notebook");
  assert.deepEqual(picked.choice, { target: "fabric-notebook", origin: "user" });
  assert.equal(materializeDbt({ ...input(), target: picked.choice!.target }).target, "fabric-notebook");
  assert.throws(() => chooseTarget(prod, "nope" as never));
  // Policy and wording are data.
  const custom = materializationTargetCard({ modelCount: 1, environment: "acc" }, { productionEnvironments: ["acc"], sparkJobFromModels: 99 });
  assert.equal(custom.recommendation.target, "spark-job-definition");
});

test("job order goes through ephemeral models: A → ephemeral E → B runs B before A", () => {
  const manifest: DbtFile = {
    path: "target/manifest.json",
    text: JSON.stringify({
      metadata: { project_name: "p" },
      nodes: Object.fromEntries(([["a", "table", ["e"]], ["e", "ephemeral", ["b"]], ["b", "table", []]] as const).map(([name, materialized, deps]) => [`model.p.${name}`, {
        resource_type: "model", name, package_name: "p", alias: name, original_file_path: `models/${name}.sql`,
        config: { materialized }, relation_name: `"w"."s"."${name}"`,
        compiled_code: `select 1 as x${deps.map(d => ` union all select x from "w"."s"."${d}"`).join("")}\n`,
        depends_on: { nodes: deps.map(d => `model.p.${d}`) }
      }]))
    })
  };
  const r = materializeDbtSparkJob(input({ files: [manifest], models: undefined }));
  assert.deepEqual(r.modules.map(m => m.module), ["b", "a"]);
  assert.match(r.files.find(f => f.path.endsWith("/models/a.py"))!.content, /DEPENDS_ON = \("b",\)/);
});

test("EXEC1c card is reachable from the command: config block, pick items and card lines are data", () => {
  const parsed = parseDbtMaterializeConfig(JSON.stringify({
    environments: { acc: { lakehouse: "lh" } },
    targetCard: { productionEnvironments: ["acc"], unitTestsWanted: true, text: { recommendedTag: "conseille", options: { "fabric-notebook": { label: "Notebook" } } } }
  }));
  assert.ok(parsed.ok);
  const settings = parseTargetCardSettings(parsed.config.targetCard);
  assert.deepEqual(settings.policy.productionEnvironments, ["acc"]);
  assert.equal(settings.policy.sparkJobFromModels, DEFAULT_TARGET_CARD_POLICY.sparkJobFromModels);
  assert.equal(settings.text.options["fabric-notebook"].label, "Notebook");
  assert.equal(settings.text.options["spark-job-definition"].label, DEFAULT_TARGET_CARD_TEXT.options["spark-job-definition"].label);
  const card = materializationTargetCard({ modelCount: 1, environment: "acc", unitTestsWanted: settings.unitTestsWanted }, settings.policy, settings.text);
  assert.deepEqual(card.recommendation.reasonIds, ["production-environment", "unit-tests-wanted"]);
  const picks = targetCardPicks(card, settings.text);
  assert.deepEqual(picks.map(p => [p.target, p.label, p.description, p.picked]), [
    ["fabric-notebook", "Notebook", "", false],
    ["spark-job-definition", DEFAULT_TARGET_CARD_TEXT.options["spark-job-definition"].label, "conseille", true]
  ]);
  const lines = targetCardLines(chooseTarget(card, "spark-job-definition"), settings.text);
  assert.equal(lines[0], `[${card.cardId}] ${card.question}`);
  assert.ok(lines.some(l => l.includes("(conseille)")));
  assert.ok(lines.at(-1)!.endsWith(DEFAULT_TARGET_CARD_TEXT.options["spark-job-definition"].label));
  // Malformed blocks keep the defaults; no block at all is the default card.
  assert.deepEqual(parseTargetCardSettings({ sparkJobFromModels: -1, productionEnvironments: [1] }).policy, DEFAULT_TARGET_CARD_POLICY);
  assert.deepEqual(parseTargetCardSettings(undefined).text, DEFAULT_TARGET_CARD_TEXT);
});
