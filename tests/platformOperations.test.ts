import assert from "node:assert/strict";
import test from "node:test";
import { platformOperations, PROVIDER_PLATFORM } from "../src/core/capabilities/platformOperations";
import { CAPABILITIES } from "../src/core/capabilities/registry";
import { preflight } from "../src/core/capabilities/preflight";
import type { ToolObservation } from "../src/core/capabilities/tools";

const NOW = "2026-09-24T12:00:00Z";
const empty = { tools: new Map<string, ToolObservation>(), facts: new Map(), reviewsConfirmed: new Set<string>() };

test("every registry operation with a Galaxy card is listed on exactly that card", () => {
  const ops = platformOperations(empty);
  const listed = [...ops.values()].flat().map(o => o.id).sort();
  const expected = CAPABILITIES.filter(c => PROVIDER_PLATFORM[c.provider]).map(c => c.id).sort();
  assert.deepEqual(listed, expected);
  assert.ok(ops.get("observability")?.every(o => o.id.startsWith("grafana.")), "grafana operations belong to the observability card");
  assert.equal(ops.get("mongo"), undefined, "providers without a card stay in the Work view");
});

test("card readiness is the Work view's preflight, not a second opinion", () => {
  const tools = new Map<string, ToolObservation>([["ext.fabric", { toolId: "ext.fabric", state: "present", observedAt: NOW }]]);
  const facts = new Map<string, string | boolean | undefined>([["fabric.workspace", "Retail"]]);
  const ctx = { tools, facts, reviewsConfirmed: new Set<string>() };
  for (const op of platformOperations(ctx).get("fabric")!) {
    const cap = CAPABILITIES.find(c => c.id === op.id)!;
    const r = preflight(cap, ctx);
    assert.equal(op.status, r.status, op.id);
    assert.equal(op.nextStep, r.nextStep, op.id);
    assert.equal(op.nativeTool, cap.implementation === "documented-only", op.id);
  }
});
