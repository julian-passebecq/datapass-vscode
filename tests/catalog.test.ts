import assert from "node:assert/strict";
import test from "node:test";
import { parseToolCatalog } from "../src/core/catalog";

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
