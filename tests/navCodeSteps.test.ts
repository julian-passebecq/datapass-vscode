/**
 * V4-NAV NAVREN4: the code-steps layout model (pure parts) and the Hop → code-steps adapter.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { codeStepsFromHop, codeStepsModel, DEFAULT_CODE_STEPS_LABELS, fallbackColor, MAX_CODE_STEPS, type CodeStepsInput } from "../src/webview/views/layouts/codeSteps";
import type { HopState, HopStepView } from "../src/views/hopState";

const step = (over: Partial<HopStepView>): HopStepView => ({
  id: "s", title: "S", kind: "transform", kindLabel: "Transform", lines: [1, 1], beyond: false, inputs: [], outputs: [],
  columns: [], provenance: "declared", from: [], joins: [], ...over
});

const hop = (steps: HopStepView[], over: Partial<HopState> = {}): HopState => ({
  kind: "explained", fileName: "job.py", where: "pipelines / job.py", title: "Daily job", state: "ok", problems: [], steps, canGoBack: false, ...over
});

test("Hop steps become ordered code steps with tables, join params and AI-labelled notes", () => {
  const input = codeStepsFromHop(hop([
    step({ id: "read", title: "Read orders", kind: "read", inputs: ["orders"], outputs: ["df"], lines: [3, 4] }),
    step({ id: "j", title: "Join customers", kind: "join", inputs: ["df", "customers"], outputs: ["joined"], provenance: "inferred", note: "keeps unmatched rows",
      joins: [{ id: "j1", left: "df", right: "customers", type: "left", typeLabel: "LEFT", keys: [["cid", "id"]], provenance: "declared" }] }),
    step({ id: "nn", title: "Remove nulls", kind: "filter", columns: [{ name: "amount", from: "df.amount" }] })
  ]));
  assert.deepEqual(input.steps.map(s => s.id), ["read", "j", "nn"]);
  assert.equal(input.steps[1]!.origin, "ai-proposed");
  assert.deepEqual(input.steps[1]!.note, { text: "keeps unmatched rows", origin: "ai-proposed" });
  assert.deepEqual(input.steps[1]!.params[0], { name: "LEFT", value: "cid = id", origin: "static" });
  assert.deepEqual(input.holes, []);

  const m = codeStepsModel(input, { colorOf: id => `c-${id}`, selected: "j" });
  assert.equal(m.rows[0]!.icon, DEFAULT_CODE_STEPS_LABELS.kinds.read!.icon);
  assert.equal(m.rows[0]!.lines, "3–4");
  assert.equal(m.rows[2]!.lines, "1");
  // join row: df/customers both as input and as join side, deduplicated per role, coloured by table id
  assert.deepEqual(m.rows[1]!.chips.map(c => `${c.role}:${c.id}:${c.color}`),
    ["reads:df:c-df", "reads:customers:c-customers", "joins:df:c-df", "joins:customers:c-customers", "writes:joined:c-joined"]);
  assert.equal(m.rows[1]!.selected, true);
  assert.equal(m.rows[1]!.note!.aiProposed, true);
  assert.equal(m.showNotes, true);
});

test("no explanation → typed hole, empty list; stale and beyond-file steps are holes, never hidden", () => {
  const missing = codeStepsFromHop(hop([], { kind: "missing", banner: { level: "info", title: "No explanation yet", text: "" } }));
  assert.deepEqual(missing.holes, [{ reason: "No explanation yet" }]);
  const m = codeStepsModel(missing);
  assert.equal(m.empty, DEFAULT_CODE_STEPS_LABELS.empty);
  const stale = codeStepsFromHop(hop([step({ id: "late", title: "Late", beyond: true })], { state: "stale", banner: { level: "warning", title: "Stale", text: "" } }));
  assert.deepEqual(stale.holes.map(h => h.reason), ["Late: lines beyond the file as it is now", "Stale"]);
});

test("labels are data, notes column only with evidence, size bounded, colour stable", () => {
  const input: CodeStepsInput = { steps: [{ id: "a", kind: "custom", label: "A", origin: "static", tables: [], params: [] }], holes: [], origin: "static" };
  const labels = { ...DEFAULT_CODE_STEPS_LABELS, kinds: { ...DEFAULT_CODE_STEPS_LABELS.kinds, custom: { label: "Mine", icon: "star" } } };
  const m = codeStepsModel(input, { labels });
  assert.equal(m.rows[0]!.kindLabel, "Mine");
  assert.equal(m.showNotes, false);
  assert.equal(codeStepsModel({ ...input, steps: [{ ...input.steps[0]!, kind: "unknown" }] }).rows[0]!.kindLabel, "Step");
  const many = codeStepsModel({ ...input, steps: Array.from({ length: MAX_CODE_STEPS + 2 }, (_, i) => ({ ...input.steps[0]!, id: `s${i}` })) });
  assert.equal(many.rows.length, MAX_CODE_STEPS);
  assert.deepEqual(many.holes, ["2 more steps not shown"]);
  assert.equal(fallbackColor("orders"), fallbackColor("orders"));
  assert.match(fallbackColor("orders"), /^var\(--vscode-charts-/);
});
