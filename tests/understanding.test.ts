/**
 * V3-HOP1: the DataPass Hop contract (`datapass.understanding` v1), its loader and the step ↔ line
 * helpers. The committed examples (examples/v3/hop) must load as "ok".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { parseUnderstanding, UNDERSTANDING_LIMITS, type UnderstandingDoc } from "../src/core/understanding/contract";
import { indexUnderstanding, loadUnderstanding, MAX_INDEXED_FILES, UnderstandingCatalog, understandingSha256 } from "../src/core/understanding/load";
import { linesForStep, nearestStepForLine, stepForLine, stepsForLine, stepsInLineOrder } from "../src/core/understanding/lines";
import { validateProjectManifest } from "../src/core/projectManifestModel";

const ROOT = join(__dirname, "..");
const HOP = join(ROOT, "examples", "v3", "hop");
const NATIVE = "a = 1\nb = a + 1\nc = b * 2\nprint(c)\n";

function doc(over: Partial<UnderstandingDoc> = {}): UnderstandingDoc {
  return {
    format: "datapass.understanding", version: 1,
    target: { repository: "code", path: "src/job.py", sha256: understandingSha256(Buffer.from(NATIVE)), language: "python" },
    title: "Job", summary: "A tiny job.",
    steps: [
      { id: "a", title: "Set a", kind: "config", lines: [1, 1], provenance: "declared" },
      { id: "b", title: "Compute", kind: "transform", lines: [2, 3], provenance: "inferred" },
      { id: "c", title: "Print", kind: "write", lines: [4, 4], provenance: "declared" }
    ],
    links: [{ from: "a", to: "b", kind: "data" }, { from: "b", to: "c", kind: "data" }],
    ...over
  };
}
const codes = (raw: unknown) => parseUnderstanding(typeof raw === "string" ? raw : JSON.stringify(raw)).diagnostics.map(d => d.code);

/** A bridge + one native repository in a temporary folder. */
function fixture(files: Record<string, string>): { root: string; bridge: string; code: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dp-hop-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return { root, bridge: join(root, "bridge"), code: join(root, "code"), done: () => rmSync(root, { recursive: true, force: true }) };
}
const UF = "bridge/.datapass/understanding/code/src/job.py.json";

test("understanding: a valid document parses without diagnostics", () => {
  const r = parseUnderstanding(JSON.stringify(doc()));
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.doc?.steps.length, 3);
});

test("understanding: each error class is reported with its code", () => {
  assert.deepEqual(codes("{ \"a\": 1, \"a\": 2 }"), ["json"]);
  assert.ok(codes({ ...doc(), format: "other" }).every(c => c === "schema"));
  assert.ok(codes({ ...doc(), extra: true }).includes("schema"));
  assert.ok(codes(doc({ steps: [{ id: "a", title: "x", kind: "nope" as never, lines: [1, 1], provenance: "declared" }] })).includes("schema"));
  assert.ok(codes(doc({ steps: [] })).includes("schema"), "at least one step");
  assert.ok(codes(doc({ steps: [{ id: "a", title: "x", kind: "read", lines: [0, 1], provenance: "declared" }] })).includes("schema"), "lines are 1-based");
  assert.deepEqual(codes(doc({ steps: [{ id: "a", title: "x", kind: "read", lines: [3, 2], provenance: "declared" }], links: [] })), ["line-range"]);
  const dupSteps = doc(); dupSteps.steps[1]!.id = "a"; dupSteps.links = [];
  assert.deepEqual(codes(dupSteps), ["duplicate-id"]);
  assert.deepEqual(codes(doc({ links: [{ from: "a", to: "zz", kind: "data" }] })), ["unknown-step"]);
  assert.deepEqual(codes(doc({ links: [{ from: "a", to: "a", kind: "control" }] })), ["self-link"]);
  assert.deepEqual(codes(doc({ joins: [{ id: "j", step: "nope", left: "l", right: "r", type: "inner", keys: [["k", "k"]], provenance: "declared" }] })), ["unknown-step"]);
  assert.deepEqual(codes(doc({ joins: [{ id: "j", step: "b", left: "l", right: "r", type: "inner", keys: [], provenance: "declared" }] })), ["join-step", "join-keys"]);
  assert.deepEqual(codes(doc({ joins: [{ id: "j", step: "b", left: "l", right: "r", type: "cross", keys: [["a", "b"]], provenance: "declared" }] })), ["join-step", "join-keys"]);
  assert.deepEqual(codes(doc({ milestoneLabels: [{ step: "zz", label: "1" }] })), ["unknown-step"]);
  assert.deepEqual(codes(doc({ target: { ...doc().target, path: "../outside.py" } })), ["target-path"]);
  assert.deepEqual(codes(doc({ target: { ...doc().target, path: "C:/abs.py" } })), ["target-path"]);
  assert.deepEqual(codes(doc({ target: { ...doc().target, path: ".datapass/project.json" } })), ["target-path"]);
  assert.deepEqual(codes(doc({ target: { ...doc().target, repository: "a/b" } })), ["target-path"]);
  const secret = parseUnderstanding(JSON.stringify(doc({ summary: "Uses ghp_abcdefghijklmnopqrstuvwxyz0123456789 to pull." })));
  assert.deepEqual(secret.diagnostics.map(d => d.code), ["credential"]);
  assert.ok(!secret.diagnostics[0]!.message.includes("ghp_"), "the value is never echoed");
  assert.equal(secret.doc, undefined);
});

test("understanding: warnings keep the document (duplicate link, cycle, join on a non-join step)", () => {
  const r = parseUnderstanding(JSON.stringify(doc({ links: [{ from: "a", to: "b", kind: "data" }, { from: "a", to: "b", kind: "data" }, { from: "b", to: "a", kind: "control" }] })));
  assert.deepEqual(r.diagnostics.map(d => d.code), ["duplicate-link", "link-cycle"]);
  assert.ok(r.doc);
  // A long chain is checked without recursion.
  const steps = Array.from({ length: UNDERSTANDING_LIMITS.steps }, (_, i) => ({ id: `s${i}`, title: "s", kind: "task" as const, lines: [i + 1, i + 1] as [number, number], provenance: "declared" as const }));
  const links = steps.slice(1).map((s, i) => ({ from: `s${i}`, to: s.id, kind: "control" as const }));
  assert.deepEqual(codes(doc({ steps, links })), []);
});

test("understanding: oversized files are refused before parsing", () => {
  const big = JSON.stringify(doc({ summary: "x" })).replace("\"x\"", `"x"${" ".repeat(UNDERSTANDING_LIMITS.maxBytes)}`);
  assert.deepEqual(codes(big), ["oversized"]);
});

test("understanding: load gives ok, stale, orphan and invalid states", async () => {
  const f = fixture({
    [UF]: JSON.stringify(doc()),
    "code/src/job.py": NATIVE.replace(/\n/g, "\r\n"),
    "bridge/.datapass/understanding/code/src/changed.py.json": JSON.stringify(doc({ target: { ...doc().target, path: "src/changed.py" } })),
    "code/src/changed.py": NATIVE + "print('more')\n",
    "bridge/.datapass/understanding/code/src/gone.py.json": JSON.stringify(doc({ target: { ...doc().target, path: "src/gone.py" } })),
    "bridge/.datapass/understanding/code/src/short.py.json": JSON.stringify(doc({ target: { ...doc().target, path: "src/short.py" } })),
    "code/src/short.py": "a = 1\n",
    "bridge/.datapass/understanding/code/src/moved.py.json": JSON.stringify(doc()),
    "code/src/moved.py": NATIVE,
    "bridge/.datapass/understanding/other/x.py.json": JSON.stringify(doc({ target: { ...doc().target, repository: "other", path: "x.py" } })),
    "bridge/.datapass/understanding/remote/x.py.json": JSON.stringify(doc({ target: { ...doc().target, repository: "remote", path: "x.py" } })),
    "bridge/.datapass/understanding/stray.json": "{}",
    "bridge/.datapass/understanding/code/notes.txt": "hi"
  });
  try {
    const { entries, index } = await loadUnderstanding(f.bridge, new Map([["code", f.code], ["remote", undefined]]));
    const by = new Map(entries.map(e => [`${e.repositoryKey}/${e.nativePath}`, e]));
    assert.equal(by.get("code/src/job.py")?.state, "ok", "CRLF on disk still matches (hash of LF-normalised text)");
    assert.equal(by.get("code/src/job.py")?.lines, 4);
    assert.equal(by.get("code/src/changed.py")?.state, "stale");
    assert.ok(by.get("code/src/changed.py")?.doc, "a stale explanation is still shown");
    assert.equal(by.get("code/src/gone.py")?.state, "orphan");
    assert.deepEqual(by.get("code/src/gone.py")?.diagnostics.map(d => d.code), ["native-missing"]);
    assert.equal(by.get("code/src/short.py")?.state, "invalid");
    assert.ok(by.get("code/src/short.py")?.diagnostics.some(d => d.code === "lines-beyond-file"));
    assert.ok(by.get("code/src/moved.py")?.diagnostics.some(d => d.code === "location"));
    assert.ok(by.get("other/x.py")?.diagnostics.some(d => d.code === "unknown-repository"));
    assert.equal(by.get("remote/x.py")?.state, "orphan");
    assert.deepEqual(index.diagnostics.map(d => d.code).sort(), ["location", "not-json"]);
  } finally { f.done(); }
});

test("understanding: forNativeFile finds a file's explanation and follows changes", async () => {
  const f = fixture({ [UF]: JSON.stringify(doc()), "code/src/job.py": NATIVE });
  try {
    const catalog = new UnderstandingCatalog(await indexUnderstanding(f.bridge), new Map([["code", f.code]]), 7);
    const e = await catalog.forNativeFile(join(f.code, "src", "job.py"));
    assert.equal(e?.state, "ok");
    assert.equal(e?.generation, 7);
    assert.equal(await catalog.forNativeFile(join(f.code, "src", "other.py")), undefined);
    assert.equal(await catalog.forNativeFile(join(f.root, "elsewhere.py")), undefined);
    assert.equal(await catalog.forNativeFile(join(f.code, "src", "job.py")), e, "unchanged files come from the cache");
    writeFileSync(join(f.code, "src", "job.py"), NATIVE + "# edited\n");
    assert.equal((await catalog.forNativeFile(join(f.code, "src", "job.py")))?.state, "stale");
  } finally { f.done(); }
});

test("understanding: path escapes and symlinks are refused", async (t) => {
  const f = fixture({
    [UF]: JSON.stringify(doc()),
    "outside/src/job.py": NATIVE,
    "outside/real/job.py.json": JSON.stringify(doc())
  });
  try {
    mkdirSync(f.code, { recursive: true });
    try {
      symlinkSync(join(f.root, "outside", "src"), join(f.code, "src"), "junction");
      symlinkSync(join(f.root, "outside", "real"), join(f.bridge, ".datapass", "understanding", "code", "linked"), "junction");
    } catch { t.skip("symlinks unavailable"); return; }
    const { entries, index } = await loadUnderstanding(f.bridge, new Map([["code", f.code]]));
    assert.equal(entries.length, 1, "a symlinked folder of the bridge is not followed");
    assert.ok(index.diagnostics.some(d => d.code === "symlink"));
    assert.equal(entries[0]!.state, "invalid");
    assert.deepEqual(entries[0]!.diagnostics.map(d => d.code), ["native-escape"]);
  } finally { f.done(); }
});

test("understanding: the index is bounded and fast (names only, no reads)", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < MAX_INDEXED_FILES + 50; i++) files[`bridge/.datapass/understanding/code/d${i % 40}/f${i}.py.json`] = "not read at index time";
  const f = fixture(files);
  try {
    const started = performance.now();
    const index = await indexUnderstanding(f.bridge);
    const ms = performance.now() - started;
    assert.equal(index.files.length, MAX_INDEXED_FILES);
    assert.equal(index.truncated, true);
    assert.ok(index.diagnostics.some(d => d.code === "truncated"));
    // The refresh budget is 3 s for the first paint; indexing 2,000 names must stay a small share of it.
    assert.ok(ms < 1500, `indexing took ${Math.round(ms)} ms`);
    assert.deepEqual((await indexUnderstanding(join(f.root, "no-bridge"))).files, []);
  } finally { f.done(); }
});

test("understanding: step ↔ line helpers", () => {
  const d = doc({ steps: [
    { id: "outer", title: "o", kind: "transform", lines: [2, 10], provenance: "declared" },
    { id: "inner", title: "i", kind: "filter", lines: [4, 5], provenance: "declared" },
    { id: "first", title: "f", kind: "read", lines: [1, 1], provenance: "declared" },
    { id: "late", title: "l", kind: "write", lines: [14, 15], provenance: "declared" }
  ], links: [] });
  assert.equal(stepForLine(d, 4)?.id, "inner", "the most specific step wins");
  assert.deepEqual(stepsForLine(d, 4).map(s => s.id), ["inner", "outer"]);
  assert.equal(stepForLine(d, 12), undefined);
  assert.equal(stepForLine(d, 0), undefined);
  assert.equal(nearestStepForLine(d, 12)?.id, "outer", "between steps: the last step started");
  assert.equal(nearestStepForLine(d, 99)?.id, "late");
  assert.deepEqual(linesForStep(d, "inner"), [4, 5]);
  assert.equal(linesForStep(d, "nope"), undefined);
  assert.deepEqual(stepsInLineOrder(d).map(s => s.id), ["first", "outer", "inner", "late"]);
});

test("understanding: the committed examples (examples/v3/hop) are ok and valid for the editor schema", async () => {
  const manifest = JSON.parse(readFileSync(join(HOP, "bridge", ".datapass", "project.json"), "utf8"));
  assert.deepEqual(validateProjectManifest(manifest), []);
  const { entries, index } = await loadUnderstanding(join(HOP, "bridge"), new Map([["bridge", join(HOP, "bridge")], ["pipelines", join(HOP, "pipelines")]]));
  assert.deepEqual(index.diagnostics, []);
  assert.deepEqual(entries.map(e => `${e.nativePath}:${e.state}:${e.doc?.target.language}`).sort(), [
    "dags/daily_sales_dag.py:ok:airflow", "jobs/daily_sales.py:ok:pyspark", "sql/customer_orders.sql:ok:sql"
  ]);
  for (const e of entries) assert.deepEqual(e.diagnostics, [], e.nativePath);
  const sql = entries.find(e => e.doc?.target.language === "sql")!;
  assert.equal(sql.doc?.joins?.length, 2);
  const dag = entries.find(e => e.doc?.target.language === "airflow")!;
  assert.equal(dag.doc?.steps.filter(s => s.kind === "task" || s.kind === "test").length, 4);
  const spark = entries.find(e => e.doc?.target.language === "pyspark")!;
  assert.deepEqual(spark.doc?.steps.map(s => s.kind).filter(k => k !== "config"), ["read", "filter", "join", "aggregate", "write"]);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "datapass-understanding.schema.json"), "utf8")));
  for (const f of index.files) assert.ok(validate(JSON.parse(readFileSync(f.file, "utf8"))), `${f.nativePath}: ${JSON.stringify(validate.errors)}`);
});

test("understanding: the PySpark example turns stale when its code changes (deliberately stale copy)", async () => {
  const root = mkdtempSync(join(tmpdir(), "dp-hop-stale-"));
  try {
    cpSync(HOP, root, { recursive: true });
    const job = join(root, "pipelines", "jobs", "daily_sales.py");
    writeFileSync(job, readFileSync(job, "utf8").replace("how=\"inner\"", "how=\"left\""));
    const catalog = new UnderstandingCatalog(await indexUnderstanding(join(root, "bridge")), new Map([["pipelines", join(root, "pipelines")]]));
    const e = await catalog.forNativeFile(job);
    assert.equal(e?.state, "stale");
    assert.deepEqual(e?.diagnostics.map(d => d.code), ["stale"]);
    assert.equal(stepForLine(e!.doc!, 24)?.id, "join", "a stale explanation still maps lines to steps");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
