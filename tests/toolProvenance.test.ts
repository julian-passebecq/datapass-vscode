/**
 * TOOLPROV1: the standalone's tool labels map onto Common's ONE provenance enum
 * (datapass.tool-catalog/2, Common MR !135).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TOOL_PROVENANCE, isToolProvenance, provenanceFromFabricTool, provenanceFromPublisher, type ToolProvenanceInfo } from "../src/core/capabilities/provenance";
import { TOOLS } from "../src/core/capabilities/tools";
import { knownTools } from "../src/core/toolchain/toolchain";
import { parseToolCatalog } from "../src/core/catalog";

function assertValid(info: ToolProvenanceInfo, what: string): void {
  assert.ok(isToolProvenance(info.provenance), `${what}: ${info.provenance} is not a Common provenance value`);
  if (info.provenance === "fork") assert.ok(info.canonicalUpstream, `${what}: a fork needs a canonical upstream`);
  else assert.equal(info.canonicalUpstream, null, `${what}: only a fork has a canonical upstream`);
}

test("the provenance enum equals Common's datapass.tool-catalog/2 list, in order", () => {
  assert.deepEqual([...TOOL_PROVENANCE], ["official", "community", "fork", "accelerator", "sample-reference"]);
});

test("every tools.ts entry and every known toolchain tool maps to a valid provenance", () => {
  for (const t of TOOLS) assertValid(provenanceFromPublisher(t.publisher), t.id);
  for (const t of knownTools().values()) {
    assert.ok(t.provenance, `${t.id} has a provenance`);
    assertValid(t.provenance, t.id);
  }
  assert.equal(provenanceFromPublisher("microsoft").provenance, "official");
  assert.equal(provenanceFromPublisher("community").provenance, "community");
  assert.equal(knownTools().get("ext.fabric-studio")?.provenance?.provenance, "community");
});

test("every fabric-tools.json entry maps to a valid provenance", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "resources", "catalogs", "fabric-tools.json"), "utf8")) as unknown;
  const catalog = parseToolCatalog(raw);
  assert.ok(catalog.items.length > 0);
  for (const item of catalog.items) {
    assert.ok(item.provenance, `${item.id} has a provenance`);
    assertValid(item.provenance, item.id);
    if (item.source === "microsoft/fabric-toolbox") assert.equal(item.provenance.provenance, "accelerator", item.id);
  }
});

test("reference donors, forks and unknown labels", () => {
  assert.deepEqual(provenanceFromFabricTool({ source: "gbrueckl/Fabric.Toolbox", kind: "notebook" }), { provenance: "sample-reference", canonicalUpstream: null });
  const fork = provenanceFromFabricTool({ source: "gbrueckl/fabric-cicd", kind: "python_cli" });
  assert.equal(fork.provenance, "fork");
  assert.equal(fork.canonicalUpstream, "tool.fabric-cicd");
  // The upstream is the Common tool-catalog/2 id (toolSeedV2), not the local toolchain id py.fabric-cicd.
  assert.ok(!knownTools().has(fork.canonicalUpstream!) && knownTools().has("py.fabric-cicd"));
  // Unknown labels are never promoted to official.
  assert.equal(provenanceFromPublisher("acme-official").provenance, "community");
  assert.equal(provenanceFromPublisher(undefined).provenance, "community");
  assert.equal(provenanceFromFabricTool({ source: "someone/microsoft-fabric-tools", kind: "accelerator" }).provenance, "community");
});
