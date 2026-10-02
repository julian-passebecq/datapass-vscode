import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { dbtMaterializePreview, parseDbtMaterializeConfig } from "../src/core/materialize/dbtMaterialize";
import { materializeDbtModels, previewDbtDiff, type DbtFile } from "../src/core/materialize/dbtNotebook";
import { PALETTE_TIERS } from "../src/core/experience/palette";

const ROOT = join(__dirname, "fixtures", "dbtmat");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files: DbtFile[] = walk(ROOT).map(p => ({ path: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
const REV = "0123456789abcdef0123456789abcdef01234567";

test("config: environments are data; bad entries are dropped or rejected", () => {
  const r = parseDbtMaterializeConfig(JSON.stringify({ rootDirectory: "fabric/items/", environments: { dev: { lakehouse: "lh_dev", tables: { a: "x.y", bad: 3 } }, broken: {} } }));
  assert.ok(r.ok);
  assert.equal(r.config.rootDirectory, "fabric/items");
  assert.deepEqual(r.config.environments, { dev: { lakehouse: "lh_dev", tables: { a: "x.y" } } });
  assert.equal(r.warnings.length, 1);
  assert.equal(parseDbtMaterializeConfig("{").ok, false);
  assert.equal(parseDbtMaterializeConfig(JSON.stringify({ environments: {} })).ok, false);
  assert.equal(parseDbtMaterializeConfig(JSON.stringify({ rootDirectory: "../out", environments: { dev: { lakehouse: "l" } } })).ok, false);
});

test("preview: lists the diff and holes; writes only added or modified files; a re-run writes nothing", () => {
  const input = { files, environment: "dev", environments: { dev: { lakehouse: "lh_dev" } }, dbtRevision: REV, rootDirectory: "fabric", at: "2026-10-01T08:00:00Z" };
  const r = materializeDbtModels(input);
  const first = dbtMaterializePreview(r, previewDbtDiff(r, new Map()));
  assert.equal(first.blocked, false);
  assert.equal(first.writes.length, r.files.length);
  assert.ok(first.lines.some(l => l.includes("dbt.compiled-sql-missing")));
  const again = materializeDbtModels({ ...input, at: "2026-10-01T09:00:00Z" });
  const second = dbtMaterializePreview(again, previewDbtDiff(again, new Map(r.files.map(f => [f.path, f.content]))));
  assert.deepEqual(second.writes, []);
  assert.equal(second.blocked, true);
  const bad = materializeDbtModels({ ...input, dbtRevision: "main" });
  assert.equal(dbtMaterializePreview(bad, previewDbtDiff(bad, new Map())).blocked, true);
});

test("the command is gated by its own V5 surface", () => {
  assert.equal(PALETTE_TIERS.get("datapass.dbt.materialize"), "v5.dbtmat");
});
