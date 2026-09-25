import assert from "node:assert/strict";
import test from "node:test";
import { cleanNote, qualificationReport, toolSnapshot, type QualificationRecord } from "../src/core/qualification/qualification";
import type { ToolObservation } from "../src/core/capabilities/tools";

const tools = new Map<string, ToolObservation>([
  ["cli.databricks", { toolId: "cli.databricks", state: "present", version: "Databricks CLI v0.270.0", observedAt: "2026-09-26T08:00:00Z" }],
  ["cli.fab", { toolId: "cli.fab", state: "absent", observedAt: "2026-09-26T08:00:00Z" }]
]);
const rec = (over: Partial<QualificationRecord>): QualificationRecord => ({
  capabilityId: "databricks.bundle.validate", label: "Validate a bundle", result: "worked", projectId: "testlab-databricks", scopeId: "bundle",
  preflight: "ready", at: "2026-09-26T08:10:00Z", dataPassVersion: "0.12.0", tools: toolSnapshot(["cli.databricks"], tools), ...over
});

test("qualification: tool snapshot records versions, states and unknowns", () => {
  assert.deepEqual(toolSnapshot(["cli.databricks", "cli.fab", "cli.az"], tools), { "cli.databricks": "Databricks CLI v0.270.0", "cli.fab": "absent", "cli.az": "unknown" });
});

test("qualification: notes are shortened and scrubbed of paths and secrets", () => {
  const note = cleanNote("  failed in C:\\Users\\julia\\repo with token=ghp_abcdefghijklmnopqrstuvwxyz123456  ");
  assert.ok(note && !note.includes("julia") && !note.includes("ghp_abcdefghij"), note);
  assert.equal(cleanNote("   "), undefined);
  assert.equal(cleanNote("x".repeat(900))!.length, 500);
});

test("qualification: the report lists results by project, the environment and every detected tool", () => {
  const text = qualificationReport({
    records: [rec({}), rec({ capabilityId: "fabric.workspace.browse", label: "Browse a Fabric workspace", result: "failed", projectId: "testlab-fabric", scopeId: "setup", preflight: "blocked", note: "fab | not found" })],
    dataPassVersion: "0.12.0", vscodeVersion: "1.138.0", platform: "win32 x64", generatedAt: "2026-09-26T09:00:00Z", tools
  });
  assert.match(text, /DataPass 0\.12\.0 · VS Code 1\.138\.0 · win32 x64/);
  assert.match(text, /## Results \(1 worked · 1 failed · 0 not-tried\)/);
  assert.ok(text.indexOf("testlab-databricks") < text.indexOf("testlab-fabric"), "sorted by project");
  assert.match(text, /❌ failed \| blocked \| fab \\\| not found/, "table cells are escaped");
  assert.match(text, /\| cli\.databricks \| present \| Databricks CLI v0\.270\.0 \|/);
  assert.match(qualificationReport({ records: [], dataPassVersion: "x", vscodeVersion: "y", platform: "z", generatedAt: "t", tools: new Map() }), /No result recorded yet/);
});

test("scrub (AI context, notes): common credential shapes never leave DataPass", async () => {
  const { scrub } = await import("../src/core/exchange/aiContext");
  // Fake credentials are assembled at run time so no token-shaped literal sits in the repository
  // (GitHub secret scanning rightly blocks those, even in tests).
  const fill = (n: number) => "0123456789abcdefghijklmnopqrstuvwxyz".repeat(3).slice(0, n);
  const samples = [
    ["mongodb+srv", "://user:pw@cluster0.example.net/db"].join(""), ["postgres", "://u:p@db:5432/x"].join(""),
    "ghp" + "_" + fill(30), "github" + "_pat_" + fill(26), "sk" + "-proj-" + fill(20), "AKIA" + fill(16).toUpperCase(),
    "xoxb" + "-" + fill(16), "dapi" + "0123456789abcdef".repeat(2), ["eyJ" + fill(12), fill(14), fill(16)].join("."),
    "client_secret=" + fill(9), "password: " + fill(7), "sig=" + fill(8)
  ];
  for (const s of samples) {
    const out = scrub(`value ${s} end`);
    assert.ok(!out.includes(s), `${s} survived: ${out}`);
    assert.match(out, /^value .* end$/);
  }
  assert.equal(scrub("Weekly forecast refresh: 3 tasks"), "Weekly forecast refresh: 3 tasks", "ordinary text is untouched");
});
