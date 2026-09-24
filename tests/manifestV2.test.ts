import assert from "node:assert/strict";
import test from "node:test";
import { migrateManifestToV2, validateProjectManifest, foilProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { parseGraph } from "../src/core/workspace/graph";
import { groupMoney, sumSameKind, type MoneyFigure } from "../src/core/programme/money";

test("v1 manifests remain valid and v2-only sections are rejected on v1", () => {
  assert.deepEqual(validateProjectManifest(foilProjectManifest()), []);
  const v1 = { ...foilProjectManifest(), apps: [] } as unknown;
  assert.ok(validateProjectManifest(v1).some(i => /schemaVersion 2/.test(i)));
});

test("in-memory migration preserves the original and yields a valid v2", () => {
  const original = foilProjectManifest();
  const snapshot = JSON.stringify(original);
  const v2 = migrateManifestToV2(original);
  assert.equal(JSON.stringify(original), snapshot, "original untouched and recoverable");
  assert.equal(v2.schemaVersion, 2);
  assert.deepEqual(v2.domainPacks, ["builtin:foil.programme"]);
  assert.equal(v2.repositories?.control?.management, "local");
  assert.deepEqual(validateProjectManifest(v2), []);
});

test("v2 accepts remote-only repositories and apps, rejects credentials in URLs", () => {
  const m: DataPassProjectManifest = {
    schemaVersion: 2,
    project: { id: "retail", title: "Retail" },
    repositories: {
      site: { remote: { url: "https://github.com/example/site", branch: "main" }, management: "remote-only" },
      lab: { remote: { url: "git@github.com:example/lab.git" }, management: "remote-only" }
    },
    apps: [{ id: "site", appType: "react", repoRef: "site", hosting: { provider: "cloudflare", url: "https://example.com" } }],
    scopes: [{ id: "q4", title: "Q4 refresh", objective: "Refresh the Q4 forecast", checklist: [{ id: "validate", label: "Validate bundle", capabilityRef: "databricks.bundle.validate" }] }],
    domainPacks: ["builtin:sample.retail"]
  };
  assert.deepEqual(validateProjectManifest(m), []);
  const leaky = structuredClone(m);
  leaky.repositories!.site!.remote!.url = "https://user:token@github.com/example/site";
  assert.ok(validateProjectManifest(leaky).some(i => /without credentials/.test(i)));
  const orphan = structuredClone(m);
  orphan.apps![0]!.repoRef = "nope";
  assert.ok(validateProjectManifest(orphan).some(i => /declared repository/.test(i)));
  const traversal = structuredClone(m);
  traversal.domainPacks = ["../../etc/pack.json"];
  assert.ok(validateProjectManifest(traversal).length > 0);
});

test("graph rejects dangling relations and containment cycles but allows data-flow loops", () => {
  const items = [{ id: "a", kind: "dataset", label: "A" }, { id: "b", kind: "workflow", label: "B" }];
  const ok = { format: "datapass.graph", version: "0.1-draft", items, relations: [
    { id: "r1", source: "a", target: "b", relation: "consumes" }, { id: "r2", source: "b", target: "a", relation: "produces" }] };
  assert.doesNotThrow(() => parseGraph(JSON.stringify(ok)));
  assert.throws(() => parseGraph(JSON.stringify({ ...ok, relations: [{ id: "r", source: "a", target: "zz", relation: "uses" }] })), /dangling/);
  assert.throws(() => parseGraph(JSON.stringify({ ...ok, relations: [
    { id: "c1", source: "a", target: "b", relation: "contains" }, { id: "c2", source: "b", target: "a", relation: "contains" }] })), /cycle/);
  assert.throws(() => parseGraph(JSON.stringify({ ...ok, items: [{ id: "a", kind: "dataset", label: "A", path: "../secret" }] })));
  assert.throws(() => parseGraph(JSON.stringify({ ...ok, roles: { case: "missing" } })), /unknown item/);
});

const fig = (id: string, kind: MoneyFigure["kind"], amount: number | null, currency = "EUR", priceYear: number | undefined = 2026): MoneyFigure =>
  ({ id, kind, amount, currency, priceYear, scope: "x", basis: "assumption", sourceRef: "s", asOf: "2026-09-24T00:00:00Z" });

test("money kinds are never summed together and unknown is not zero", () => {
  assert.throws(() => sumSameKind([fig("a", "unit-capex-assumption", 1), fig("b", "programme-budget", 2)]), /different money kinds/);
  assert.throws(() => sumSameKind([fig("a", "cloud-spend", 1), fig("b", "cloud-spend", 2, "NOK")]), /currencies/);
  assert.throws(() => sumSameKind([fig("a", "cloud-spend", 1), fig("b", "cloud-spend", null)]), /unknown/);
  assert.equal(sumSameKind([fig("a", "cloud-spend", 1), fig("b", "cloud-spend", 2)]), 3);
  const { groups, warnings } = groupMoney([fig("t", "funding-target", 500000), fig("r", "funding-received", null)]);
  assert.equal(groups.length, 2);
  assert.ok(groups.find(g => g.kind === "funding-received")!.note!.includes("unknown"));
  assert.ok(warnings.some(w => /not .*secured/.test(w)));
});
