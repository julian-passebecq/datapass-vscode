import assert from "node:assert/strict";
import test from "node:test";
import { buildAiContext, scrub } from "../src/core/exchange/aiContext";
import { preflight } from "../src/core/capabilities/preflight";
import { CAPABILITY_INDEX } from "../src/core/capabilities/registry";

const pf = preflight(CAPABILITY_INDEX.get("fabric.eventstream.deploy")!, { tools: new Map(), facts: new Map(), reviewsConfirmed: new Set() });
const input = {
  project: { id: "foil", title: "FOIL" },
  scope: { id: "r0", title: "R0 first circuit", objective: "Oracle → Event Hubs → Eventstream" },
  checklist: [{ label: "Bind workspace", state: "done", note: "see C:\\Users\\julian\\secret.txt" }],
  preflight: [{ label: "Eventstream deploy", result: pf }],
  impact: [{ outputId: "cad-model", label: "CAD model", state: "stale" as const, reasons: ["case: geometry changed"] }],
  programme: [], packs: [{ namespace: "foil.programme", version: "0.1.0-draft", mappingStatus: "draft-awaiting-owner-declaration" }]
};

test("AI context scrubs local paths and URL credentials", () => {
  assert.equal(scrub("open /home/julian/x and C:\\Users\\j\\y and https://u:p@github.com/r"), "open <local-path> and <local-path> and https://<credentials>@github.com/r");
  const ctx = buildAiContext("current-task", input);
  assert.ok(!ctx.text.includes("julian"));
  assert.ok(ctx.text.includes("user-reported, not proof"));
  assert.ok(ctx.text.includes("needs review"));
});

test("AI context respects the byte budget and reports truncation", () => {
  const big = { ...input, impact: Array.from({ length: 2000 }, (_, i) => ({ outputId: `o${i}`, label: `Output ${i}`, state: "stale" as const, reasons: ["x".repeat(40)] })) };
  const ctx = buildAiContext("impact", big, 4000);
  assert.ok(ctx.bytes <= 4000);
  assert.equal(ctx.truncated, true);
});

test("missing-prerequisites preset lists only non-ready operations", () => {
  const ctx = buildAiContext("missing-prerequisites", input);
  assert.ok(ctx.text.includes("Eventstream deploy: blocked"));
  assert.ok(!ctx.sections.includes("Checklist (user-reported, not proof)"));
});
