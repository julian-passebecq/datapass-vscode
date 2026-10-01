import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FABRIC_TOOLBOX_ASSET_IDS, validateCatalogV3, toolSeedV3 } from "@juliandatapass-group/tool-catalog";
import { SIDE_EFFECTS } from "@juliandatapass-group/capability-router";
import { parseToolCatalog } from "../src/core/catalog";

const fabricTools = () => parseToolCatalog(JSON.parse(readFileSync(join(__dirname, "..", "resources", "catalogs", "fabric-tools.json"), "utf8")) as unknown);

test("fabric-tools.json ids equal the Common tool-catalog/3 toolbox asset ids (TBX1c)", () => {
  assert.equal(validateCatalogV3(toolSeedV3()).ok, true);
  const ids = fabricTools().items.map(i => i.id).sort();
  assert.deepEqual(ids, [...FABRIC_TOOLBOX_ASSET_IDS].sort());
  assert.ok(ids.includes("fabric-workspace-monitoring"));
});

test("every standalone toolbox asset takes its routing and typed side effects from Common", () => {
  for (const item of fabricTools().items) {
    assert.ok(item.routing, item.id);
    assert.ok(item.routing.domains.length >= 1, item.id);
    const kinds = "sideEffectKinds" in item.routing ? item.routing.sideEffectKinds ?? [] : [];
    assert.ok(kinds.length >= 1, item.id);
    for (const k of kinds) assert.ok((SIDE_EFFECTS as readonly string[]).includes(k), `${item.id}: ${k}`);
  }
  assert.deepEqual([...fabricTools().items.find(i => i.id === "fabric-workspace-monitoring")!.routing!.domains], ["observe"]);
});

test("catalog parser accepts valid manifest", () => {
  const parsed = parseToolCatalog({
    schemaVersion: 1,
    items: [{ id:"a", name:"A", category:"Monitoring", kind:"tool", source:"upstream", url:"https://example.com", actions:["read"] }]
  });
  assert.equal(parsed.items[0]?.id, "a");
});

test("catalog parser rejects duplicate ids", () => {
  const item = { id:"a", name:"A", category:"Monitoring", kind:"tool", source:"upstream", url:"https://example.com", actions:["read"] };
  assert.throws(() => parseToolCatalog({ schemaVersion: 1, items: [item, item] }), /Duplicate/);
});
