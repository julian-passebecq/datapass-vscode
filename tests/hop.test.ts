/**
 * V3-HOP2: the DataPass Hop view — the two-way sync mapping, the webview message check, the state and
 * the page drawn from the committed examples (examples/v3/hop), the Home tile and the work order text.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnderstandingDoc } from "../src/core/understanding/contract";
import { indexUnderstanding, loadUnderstanding, UnderstandingCatalog, type UnderstandingEntry } from "../src/core/understanding/load";
import { codeLensSteps, parseHopMessage, stepForCursor, stepForTopLine, stepRange } from "../src/views/hopSync";
import { explainedFiles, explanationOrderDraft, hopState, suggestedLanguage } from "../src/views/hopState";
import { hopHtml, joinSvg } from "../src/views/hopHtml";
import { homeState, HOME_ACTIONS } from "../src/views/homeState";
import { homeHtml } from "../src/views/homeHtml";
import { buildProjectMap } from "../src/core/project/projectMap";
import { inputA } from "./fixtures/v3/research";

const emptyProjectMap = () => buildProjectMap({ ...inputA(), manifest: undefined, graph: undefined });

const HOP = join(__dirname, "..", "examples", "v3", "hop");
const REPOS = () => new Map([["bridge", join(HOP, "bridge")], ["pipelines", join(HOP, "pipelines")]]);

/** Steps: a config line, an outer block holding a nested one, a gap (lines 9–10), a late step. */
const DOC: Pick<UnderstandingDoc, "steps"> = {
  steps: [
    { id: "outer", title: "Outer", kind: "transform", lines: [3, 8], provenance: "declared" },
    { id: "inner", title: "Inner", kind: "filter", lines: [5, 6], provenance: "declared" },
    { id: "first", title: "First", kind: "config", lines: [1, 2], provenance: "declared" },
    { id: "late", title: "Late", kind: "write", lines: [11, 14], provenance: "inferred" },
    { id: "same", title: "Same start", kind: "other", lines: [11, 11], provenance: "illustrative" }
  ]
};

test("hop sync: the cursor selects the most specific step holding the line (overlapping ranges)", () => {
  assert.equal(stepForCursor(DOC, 1), "first");
  assert.equal(stepForCursor(DOC, 4), "outer");
  assert.equal(stepForCursor(DOC, 5), "inner", "inner (5–6) is more specific than outer (3–8)");
  assert.equal(stepForCursor(DOC, 6), "inner");
  assert.equal(stepForCursor(DOC, 7), "outer");
  assert.equal(stepForCursor(DOC, 11), "same", "a one-line step wins over the longer one starting there");
});

test("hop sync: lines outside every step select nothing for the cursor, the last step passed for the top line", () => {
  for (const line of [9, 10, 20, 0, -3, 2.5]) assert.equal(stepForCursor(DOC, line), undefined, `cursor line ${line}`);
  assert.equal(stepForTopLine(DOC, 9), "outer", "between steps: the step that ended last");
  assert.equal(stepForTopLine(DOC, 10), "outer");
  assert.equal(stepForTopLine(DOC, 30), "late");
  assert.equal(stepForTopLine(DOC, 12), "late");
  assert.equal(stepForTopLine({ steps: [{ id: "b", title: "B", kind: "other", lines: [5, 6], provenance: "declared" }] }, 1), "b", "before the first step: the first step");
});

test("hop sync: a step's range is clamped to the file as it is now (stale), unknown or beyond → nothing", () => {
  assert.deepEqual(stepRange(DOC, "late", 20), [11, 14]);
  assert.deepEqual(stepRange(DOC, "late", 12), [11, 12], "the file shrank: clamped to its last line");
  assert.equal(stepRange(DOC, "late", 10), undefined, "the step starts beyond the file");
  assert.deepEqual(stepRange(DOC, "late", undefined), [11, 14], "line count unknown: as declared");
  assert.equal(stepRange(DOC, "nope", 20), undefined);
});

test("hop sync: one CodeLens per first line, steps in reading order, none beyond the file", () => {
  assert.deepEqual(codeLensSteps(DOC).map(l => [l.line, l.steps.map(s => s.id)]), [[1, ["first"]], [3, ["outer"]], [5, ["inner"]], [11, ["late", "same"]]]);
  assert.deepEqual(codeLensSteps(DOC, 8).map(l => l.line), [1, 3, 5]);
});

test("hop webview messages: only known types, and only step ids of the document shown", () => {
  const ids = new Set(["read", "join"]);
  assert.deepEqual(parseHopMessage({ type: "step", step: "join" }, ids), { type: "step", step: "join" });
  assert.deepEqual(parseHopMessage({ type: "scrolled", step: "read", extra: "ignored" }, ids), { type: "scrolled", step: "read" });
  for (const t of ["ready", "back", "explain", "openCode", "openExplanation"]) assert.deepEqual(parseHopMessage({ type: t, step: "x" }, ids), { type: t });
  for (const bad of [
    null, undefined, "step", 42, [], [{ type: "step", step: "join" }],
    { type: "step" }, { type: "step", step: "write" }, { type: "step", step: 3 }, { type: "step", step: "JOIN" },
    { type: "scrolled", step: "../join" }, { type: "step", step: "join".padEnd(200, "x") },
    { type: "command", command: "workbench.action.terminal.new" }, { type: "openFile", path: "C:/x" }, { type: "__proto__" }
  ]) assert.equal(parseHopMessage(bad, ids), undefined, JSON.stringify(bad));
  assert.equal(parseHopMessage({ type: "step", step: "join" }, new Set()), undefined, "no document shown: no step");
});

async function examples(): Promise<UnderstandingEntry[]> {
  return (await loadUnderstanding(join(HOP, "bridge"), REPOS())).entries;
}
const base = { hasProject: true, workOrdersEnabled: true, canGoBack: true };

test("hop state: the SQL example — joins on their steps, connectors from declared links, provenance kept", async () => {
  const sql = (await examples()).find(e => e.nativePath === "sql/customer_orders.sql")!;
  const s = hopState({ ...base, fileName: "customer_orders.sql", located: { repositoryKey: "pipelines", nativePath: sql.nativePath, repositoryLabel: "Pipelines" }, entry: sql });
  assert.equal(s.kind, "explained");
  assert.equal(s.state, "ok");
  assert.equal(s.banner, undefined);
  assert.equal(s.where, "Pipelines / sql/customer_orders.sql");
  assert.equal(s.languageLabel, "SQL");
  assert.deepEqual(s.steps.map(x => x.id), ["select", "lines", "customers", "products", "where"], "reading order (by first line)");
  const customers = s.steps.find(x => x.id === "customers")!;
  assert.equal(customers.fromPrevious, "data", "lines → customers is drawn as the connector");
  assert.deepEqual(customers.joins.map(j => [j.type, j.left, j.right, j.keys]), [["inner", "sales.order_lines o", "sales.customers c", [["o.customer_id", "c.customer_id"]]]]);
  assert.deepEqual(s.steps.find(x => x.id === "products")!.joins.map(j => j.typeLabel), ["LEFT"]);
  const lines = s.steps.find(x => x.id === "lines")!;
  assert.equal(lines.fromPrevious, undefined, "select → lines: no declared link");
  assert.deepEqual(s.steps.find(x => x.id === "select")!.from.map(f => f.id), ["where"], "a link from a step further down is listed");

  const html = hopHtml(s, "vscode-resource:", "N0NCE", "customers");
  assert.match(html, /data-active="customers"/);
  assert.equal((html.match(/class="step[ "]/g) ?? []).length, 5);
  assert.equal((html.match(/class="join"/g) ?? []).length, 2);
  assert.match(html, /o\.customer_id = c\.customer_id/);
  assert.match(html, /script-src 'nonce-N0NCE'/);
  assert.doesNotMatch(html, /<script(?! nonce="N0NCE")/, "only the nonce'd script");
});

test("hop state: stale, orphan and invalid explanations say so; invalid draws nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "dp-hop2-"));
  try {
    cpSync(HOP, root, { recursive: true });
    const job = join(root, "pipelines", "jobs", "daily_sales.py");
    writeFileSync(job, readFileSync(job, "utf8").replace("how=\"inner\"", "how=\"left\""));
    const sqlJson = join(root, "bridge", ".datapass", "understanding", "pipelines", "sql", "customer_orders.sql.json");
    writeFileSync(sqlJson, readFileSync(sqlJson, "utf8").replace("\"lines\": [18, 19]", "\"lines\": [19, 18]"));
    rmSync(join(root, "pipelines", "dags", "daily_sales_dag.py"));
    const catalog = new UnderstandingCatalog(await indexUnderstanding(join(root, "bridge")), new Map([["bridge", join(root, "bridge")], ["pipelines", join(root, "pipelines")]]));
    const [stale, invalid, orphan] = await Promise.all(["jobs/daily_sales.py", "sql/customer_orders.sql", "dags/daily_sales_dag.py"].map(p => catalog.load(catalog.lookup("pipelines", p)!)));
    const at = (p: string) => ({ repositoryKey: "pipelines", nativePath: p });

    const s1 = hopState({ ...base, fileName: "daily_sales.py", located: at("jobs/daily_sales.py"), entry: stale });
    assert.equal(s1.state, "stale");
    assert.equal(s1.banner?.level, "warning");
    assert.ok(s1.steps.length > 0, "a stale explanation is still drawn");
    assert.match(hopHtml(s1, "c", "n"), /data-state="stale"/);
    const s1short = hopState({ ...base, fileName: "daily_sales.py", located: at("jobs/daily_sales.py"), entry: stale, lineCount: 30 });
    assert.deepEqual(s1short.steps.filter(x => x.beyond).map(x => x.id), ["aggregate", "write"], "steps past the edited file are marked");

    const s2 = hopState({ ...base, fileName: "customer_orders.sql", located: at("sql/customer_orders.sql"), entry: invalid });
    assert.equal(s2.state, "invalid");
    assert.equal(s2.banner?.level, "error");
    assert.deepEqual(s2.steps, []);
    assert.ok(s2.problems.some(p => /start after they end/.test(p)), s2.problems.join("\n"));
    assert.doesNotMatch(hopHtml(s2, "c", "n"), /data-step=/);

    const s3 = hopState({ ...base, fileName: "daily_sales_dag.py", located: at("dags/daily_sales_dag.py"), entry: orphan });
    assert.equal(s3.state, "orphan");
    assert.equal(s3.banner?.level, "info");
    assert.ok(s3.steps.length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hop state: no explanation → the Explain this file button (work orders on) naming where the AI writes it", () => {
  const s = hopState({ ...base, fileName: "load.py", located: { repositoryKey: "pipelines", nativePath: "jobs/load.py" } });
  assert.equal(s.kind, "missing");
  assert.equal(s.explanationPath, ".datapass/understanding/pipelines/jobs/load.py.json");
  const html = hopHtml(s, "c", "n");
  assert.match(html, /data-msg="explain"(?! disabled)/);
  const off = hopState({ ...base, workOrdersEnabled: false, fileName: "load.py", located: { repositoryKey: "pipelines", nativePath: "jobs/load.py" } });
  assert.match(hopHtml(off, "c", "n"), /data-msg="explain" disabled/);
  assert.equal(hopState({ ...base, fileName: "notes.md" }).kind, "unavailable");
  assert.equal(hopState({ ...base, hasProject: false, fileName: "x.py", located: { repositoryKey: "p", nativePath: "x.py" } }).kind, "unavailable");
});

test("hop page: every text from the JSON is escaped", () => {
  const s = hopState({
    ...base, fileName: "<img src=x onerror=alert(1)>.sql", located: { repositoryKey: "p", nativePath: "a.sql" },
    entry: {
      repositoryKey: "p", nativePath: "a.sql", file: "x", generation: 1, state: "ok", diagnostics: [],
      doc: {
        format: "datapass.understanding", version: 1, target: { repository: "p", path: "a.sql", sha256: "0".repeat(64), language: "sql" },
        title: "<script>alert(1)</script>", summary: "\"quoted\" & <b>",
        steps: [{ id: "j", title: "</div><script>x</script>", kind: "join", lines: [1, 2], inputs: ["<i>"], provenance: "inferred", note: "' onclick='x" }],
        joins: [{ id: "k", step: "j", left: "<a>", right: "b", type: "anti", keys: [["<x>", "y"]], provenance: "estimated" }]
      }
    }
  });
  const html = hopHtml(s, "c", "n");
  assert.doesNotMatch(html, /<script>|<img|<b>|<i>|<a>|<x>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  for (const t of ["inner", "left", "right", "full", "cross", "semi", "anti"] as const) assert.match(joinSvg(t, 0), /^<svg[^>]*>.*<\/svg>$/s);
});

test("hop Home tile: lists the explained files (sorted, bounded) and opens them by position", async () => {
  const files = (await indexUnderstanding(join(HOP, "bridge"))).files;
  const list = explainedFiles(files);
  assert.deepEqual(list.items.map(i => i.detail), ["pipelines / dags/daily_sales_dag.py", "pipelines / jobs/daily_sales.py", "pipelines / sql/customer_orders.sql"]);
  for (const i of list.items) assert.equal(`${files[i.index]!.repositoryKey} / ${files[i.index]!.nativePath}`, i.detail, "the index is the position in the index");
  const many = Array.from({ length: 11 }, (_, n) => ({ repositoryKey: "r", nativePath: `f${String(n).padStart(2, "0")}.sql` }));
  assert.equal(explainedFiles(many).more, 3);

  const state = homeState({ hasProject: true, map: emptyProjectMap(), workOrdersEnabled: true, layouts: [], shows: () => true, explained: files });
  const tile = state.areas.flatMap(a => a.tiles).find(t => t.id === "understand")!;
  assert.equal(tile.coming, undefined, "no longer a 'coming' tile");
  assert.equal(tile.items?.length, 3);
  for (const a of tile.actions) assert.ok(HOME_ACTIONS[a.id], a.id);
  const html = homeHtml(state, "home", "c", "n");
  assert.equal((html.match(/data-hop="\d+"/g) ?? []).length, 3);
  const none = homeState({ hasProject: true, map: emptyProjectMap(), workOrdersEnabled: true, layouts: [], shows: () => true }).areas.flatMap(a => a.tiles).find(t => t.id === "understand")!;
  assert.deepEqual(none.actions.map(a => a.id), ["hop.explain"]);
});

test("hop work order: names the file, the explanation's place, the current hash and the contract", () => {
  const d = explanationOrderDraft({ repositoryKey: "pipelines", nativePath: "jobs/load.py" }, { sha256: "a".repeat(64), lines: 42 });
  assert.match(d.goal, /\.datapass\/understanding\/pipelines\/jobs\/load\.py\.json/);
  assert.match(d.goal, new RegExp(`sha256 "${"a".repeat(64)}"`));
  assert.match(d.goal, /42 lines/);
  assert.match(d.goal, /PREPARING_A_PROJECT\.md, section 17/);
  assert.match(d.goal, /Do not change the native file/);
  assert.ok(d.title.length <= 80);
  assert.equal(suggestedLanguage("q/x.SQL"), "sql");
  assert.equal(suggestedLanguage("Dockerfile"), "dockerfile");
  assert.equal(suggestedLanguage("infra/main.tf"), "opentofu");
});
