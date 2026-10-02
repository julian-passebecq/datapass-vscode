/**
 * V4-NAV NAVREN4 in the nav renderer: the self-registered `code-steps` layout (codeSteps.layout.ts),
 * with the PQSAMP1 sample slot of each step.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { codeStepsLayoutModel, isCodeStepsInput } from "../src/webview/views/layouts/codeSteps.layout";
import { withSamples, type CodeStepsInput } from "../src/webview/views/layouts/codeSteps";
import { registeredLayouts } from "../src/webview/views/renderer";
import type { BindingData, VNode } from "../src/webview/views/model";
import type { ViewDef } from "../src/core/navigation/navTypes";

const view = { id: "steps", title: "Steps", layout: "code-steps" } as unknown as ViewDef;
const location = { level: "artifact", nodeId: "join", artifactKind: "sql" } as never;
const input: CodeStepsInput = {
  origin: "static", holes: [],
  steps: [
    { id: "read", kind: "read", label: "Read orders", origin: "static", tables: [{ id: "orders", role: "in" }], params: [] },
    { id: "join", kind: "join", label: "Join customers", origin: "ai-proposed", tables: [{ id: "customers", role: "join" }], params: [{ name: "on", value: "id", origin: "static" }] }
  ]
};
const data = (steps: unknown): BindingData[] => [{ source: "code-steps", origin: "static", holes: [], steps }];
const all = (n: VNode): VNode[] => [n, ...(n.children ?? []).flatMap(all)];
const text = (n: VNode): string => all(n).map(x => x.text ?? "").join(" ");

test("code-steps is a registered layout kind", () => {
  assert.ok(registeredLayouts().includes("code-steps"));
});

test("each step is a selectable row; the step at the location is selected; samples show with their origin", () => {
  const sampled = withSamples(input, id => id === "read"
    ? { state: "sample", source: "xray", origin: "observed", file: "orders.csv", engine: "DuckDB", columns: ["id", "total"], rows: [[1, 9.5]], truncated: false }
    : undefined);
  const tree = codeStepsLayoutModel({ view, data: data(sampled), labels: {}, location });
  const rows = all(tree).filter(n => n.tag === "li" && n.on);
  assert.deepEqual(rows.map(r => r.on), [{ action: "select", nodeId: "read" }, { action: "select", nodeId: "join" }]);
  assert.deepEqual(rows.map(r => r.attrs?.["aria-selected"]), ["false", "true"]);
  assert.ok(all(rows[0]!).some(n => n.tag === "td" && n.text === "9.5"));
  assert.ok(all(rows[1]!).some(n => n.cls?.includes("dp-sample-hole")), "a step without a sample keeps a hole");
  assert.match(text(rows[1]!), /Join customers/);
});

test("an off-shape steps payload becomes a typed hole, no payload a plain empty state", () => {
  assert.equal(isCodeStepsInput({ steps: [{ id: 1 }], holes: [], origin: "static" }), false);
  const bad = codeStepsLayoutModel({ view, data: data({ steps: "x" }), labels: {}, location });
  assert.ok(all(bad).some(n => n.attrs?.["data-hole-kind"] === "steps-invalid"));
  const none = codeStepsLayoutModel({ view, data: [], labels: {}, location });
  assert.ok(all(none).some(n => n.cls === "nv-empty"));
});
