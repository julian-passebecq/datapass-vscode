/**
 * V5HOLE1 (V5 acceptance row 05): the `hop-steps` binding fills the code-steps view from the file's Hop
 * explanation (a Power Query file here); the code-steps view is offered on every artifact (pack); without
 * an explanation or without the host lookup, a typed hole. Data is mapped, never executed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingProvider, resolveBindings, UNPROVIDED_SOURCES } from "../src/core/navigation/bindings";
import { CODE_STEPS_NO_FILE, CODE_STEPS_SOURCE, CODE_STEPS_UNWIRED } from "../src/core/navigation/bindings/codeSteps";
import { builtinCatalog } from "../src/core/navigation/viewPacks";
import { resolveViews, type NavLocation } from "../src/core/navigation/navTypes";
import { isCodeStepsInput } from "../src/webview/views/layouts/codeSteps.layout";
import { withSamples, type CodeStepsInput } from "../src/webview/views/layouts/codeSteps";
import type { HopState, HopStepView } from "../src/views/hopState";

const file: NavLocation = { level: "artifact", nodeId: "bi:queries/Sales.pq", artifactKind: "other" };
const step = (s: Partial<HopStepView> & Pick<HopStepView, "id" | "title" | "kind">): HopStepView => ({
  kindLabel: s.kind, lines: [1, 1], beyond: false, inputs: [], outputs: [], columns: [], provenance: "declared", from: [], joins: [], ...s
} as HopStepView);
const pq: HopState = {
  kind: "explained", fileName: "Sales.pq", where: "bi / queries/Sales.pq", title: "Sales query", state: "ok", problems: [], canGoBack: false,
  steps: [
    step({ id: "Source", title: "Source = Csv.Document(...)", kind: "source", outputs: ["Source"], lines: [2, 2] }),
    step({ id: "Filtered", title: "Table.SelectRows: Amount <> null", kind: "filter", inputs: ["Source"], outputs: ["Filtered"], lines: [3, 3],
      note: "=Shell(\"rm -rf\")", provenance: "inferred" })
  ]
};
const view = builtinCatalog().entries.find(e => e.artifactKind === "*" && e.level === "artifact")!.views.find(v => v.id === "steps")!;

test("hop-steps is provided, no longer a declared hole, and the code-steps view reaches every artifact", () => {
  assert.equal(CODE_STEPS_SOURCE, "hop-steps");
  assert.ok(bindingProvider("hop-steps"));
  assert.ok(!UNPROVIDED_SOURCES.includes("hop-steps"));
  assert.deepEqual(view.bindings, [{ source: "hop-steps" }]);
  for (const kind of ["other", "powerbi", "sql-script"]) {
    assert.ok(resolveViews(builtinCatalog(), null, kind, "artifact").some(v => v.layout === "code-steps"), `${kind} offers code steps`);
  }
});

test("a Power Query file's Hop steps become a code-steps payload the samples join", () => {
  const asked: NavLocation[] = [];
  const [b] = resolveBindings(view, { location: file, hop: l => { asked.push(l); return pq; } });
  assert.deepEqual(asked, [file]);
  assert.deepEqual(b!.result.holes, []);
  assert.ok(isCodeStepsInput(b!.result.steps));
  const steps = b!.result.steps as CodeStepsInput;
  assert.deepEqual(steps.steps.map(s => [s.id, s.kind, s.lines]), [["Source", "source", [2, 2]], ["Filtered", "filter", [3, 3]]]);
  // The client AI's note is shown as untrusted, ai-proposed text, never run.
  assert.deepEqual(steps.steps[1]!.note, { text: "=Shell(\"rm -rf\")", origin: "ai-proposed" });
  const sampled = withSamples(steps, id => id === "Filtered" ? { origin: "observed", columns: ["Amount"], rows: [["3"]] } as never : undefined);
  assert.equal(sampled.steps[1]!.sample !== undefined, true);
  assert.equal(sampled.steps[0]!.sample, undefined);
});

test("no explanation, an unexplained file or no host lookup → typed holes, no steps", () => {
  const none = resolveBindings(view, { location: file, hop: () => undefined })[0]!.result;
  assert.equal(none.steps, undefined);
  assert.deepEqual(none.holes, [{ reason: CODE_STEPS_NO_FILE, kind: "not-declared" }]);
  const missing = resolveBindings(view, { location: file, hop: () => ({ ...pq, kind: "missing", steps: [], banner: { level: "info", title: "No explanation yet", text: "" } }) })[0]!.result;
  assert.equal(missing.steps, undefined);
  assert.deepEqual(missing.holes, [{ reason: "No explanation yet", kind: "not-declared" }]);
  const unwired = resolveBindings(view, { location: file })[0]!.result;
  assert.deepEqual(unwired.holes, [{ reason: CODE_STEPS_UNWIRED, kind: "binding-unavailable" }]);
});

test("no duplicate: a kind with its own catalog Steps view (Spark) keeps only that one", () => {
  for (const kind of ["spark-notebook", "spark-job"]) {
    const steps = resolveViews(builtinCatalog(), null, kind, "artifact").filter(v => v.layout === "code-steps");
    assert.equal(steps.length, 1, `${kind} offers one steps view`);
    assert.equal(steps[0]!.title, "Steps");
    assert.deepEqual(steps[0]!.bindings.map(b => b.source), ["execution-unit", "hop-steps"]);
  }
  for (const kind of ["other", "powerbi", "sql-script"]) {
    assert.equal(resolveViews(builtinCatalog(), null, kind, "artifact").filter(v => v.layout === "code-steps").length, 1, `${kind} offers one steps view`);
  }
});
