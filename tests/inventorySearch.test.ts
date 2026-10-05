import assert from "node:assert/strict";
import test from "node:test";
import { INVENTORY_COMBINED, INVENTORY_PATTERNS, INVENTORY_LIMITS, searchInventory, searchMarkers } from "../src/core/workspace/inventorySearch";

test("combined inventory retains categories, overlapping matches and independent limits", async () => {
  let calls = 0;
  const groups = await searchInventory(async (glob, cap) => {
    calls++; assert.equal(glob, INVENTORY_COMBINED); assert.equal(cap, 6500);
    return ["a.ipynb", "pipeline/host.json", "one/.platform", "pipeline/main.json", ...Array.from({ length: 3002 }, (_, i) => `p${i}.py`)];
  }, p => p);
  assert.equal(calls, 1);
  assert.deepEqual(groups.map(g => g.length), [2, 3000, 1, 2]);
  assert.ok(groups[0]!.includes("pipeline/host.json") && groups[3]!.includes("pipeline/host.json"));
});

test("truncated combined inventory falls back to each original query and cap", async () => {
  const calls: Array<[string, number]> = [];
  const groups = await searchInventory(async (glob, cap) => {
    calls.push([glob, cap]);
    return glob === INVENTORY_COMBINED ? Array(6500).fill("a.py") : [glob];
  }, p => p);
  assert.deepEqual(calls.slice(1), INVENTORY_PATTERNS.map((p, i) => [p, INVENTORY_LIMITS[i]]));
  assert.deepEqual(groups, INVENTORY_PATTERNS.map(p => [p]));
});

test("markers share complete searches and prove a missing category after truncation", async () => {
  for (const [found, expected, fallback] of [
    [[], { dbt: false, parameter: false }, false],
    [["x/dbt_project.yaml", "y/parameter.yml"], { dbt: true, parameter: true }, false],
    [["x/dbt_project.yml", "y/dbt_project.yaml"], { dbt: true, parameter: true }, true]
  ] as const) {
    const calls: string[] = [];
    const markers = await searchMarkers(async (glob, cap) => {
      calls.push(glob);
      if (cap === 2) return [...found];
      assert.equal(glob, "**/parameter.{yml,yaml}"); return ["elsewhere/parameter.yaml"];
    }, p => p);
    assert.deepEqual(markers, expected);
    assert.equal(calls.length, fallback ? 2 : 1);
  }
});
