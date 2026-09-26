import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lf, plan, refusal, syncCommon } from "../scripts/sync-common";

const ROOT = join(__dirname, "..");

test("sync-common refuses handoff/, FOIL content and secret dot-files", () => {
  assert.match(refusal("handoff/v3/12_CODEX_TEST_MODE.md", "") ?? "", /handoff/);
  assert.match(refusal("examples/foil-lab/x.json", "{}") ?? "", /FOIL/);
  assert.match(refusal("examples/a/b.json", '{"repo":"julian-passebecq/foil-study"}') ?? "", /FOIL/);
  assert.match(refusal("examples/a/.env", "X=1") ?? "", /dot-file/);
  assert.match(refusal("examples/a/.datapass/local/token.json", "{}") ?? "", /dot-file/);
  assert.match(refusal("examples/a/cfg.json", '{"password": "hunter2secret"}') ?? "", /credential/);
  assert.match(refusal("examples/a/.github/workflows/ci.yml", "key: ghp_" + "a".repeat(36)) ?? "", /credential/);
  assert.equal(refusal("examples/a/.datapass/project.json", "{}"), null);
  assert.equal(refusal("schemas/x.schema.json", '{"description":"work projects (FOIL, clients)"}'), null);
});

test("sync-common plans only allowlisted public files from this repository", () => {
  const { entries } = plan(ROOT);
  assert.ok(entries.some((e) => e.target === "schemas/datapass-project.schema.json"));
  assert.ok(entries.some((e) => e.target.startsWith("examples/doc-pipeline/.datapass/")));
  assert.ok(entries.some((e) => e.target === "knowledge/toolkit/baseline.json"));
  assert.ok(entries.every((e) => !/handoff|foil|\.env/i.test(e.source)));
});

test("sync-common is idempotent: the second run changes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "dp-common-"));
  mkdirSync(join(target, "schemas"), { recursive: true });
  writeFileSync(join(target, "schemas", "stale.schema.json"), "{}");
  writeFileSync(join(target, "README.md"), "kept");
  const first = syncCommon(ROOT, target);
  assert.ok(first.written.length > 10);
  assert.deepEqual(first.removed, ["schemas/stale.schema.json"]);
  const second = syncCommon(ROOT, target);
  assert.deepEqual([second.written, second.removed], [[], []]);
  assert.equal(readFileSync(join(target, "README.md"), "utf8"), "kept");
  assert.match(readFileSync(join(target, "VERSION"), "utf8"), /^\d+\.\d+\.\d+/);
});

test("sync-common --check ignores CRLF/LF differences (Windows checkouts) and writes LF", () => {
  const target = mkdtempSync(join(tmpdir(), "dp-common-eol-"));
  syncCommon(ROOT, target);
  const f = join(target, "VERSION");
  assert.ok(!readFileSync(f, "utf8").includes("\r"), "written with LF");
  writeFileSync(f, readFileSync(f, "utf8").replace(/\n/g, "\r\n"));
  assert.deepEqual(syncCommon(ROOT, target, true).written, [], "a CRLF copy is not stale");
  writeFileSync(f, "0.0.0\r\n");
  assert.deepEqual(syncCommon(ROOT, target, true).written, ["VERSION"], "a real change still is");
  assert.equal(lf(Buffer.from([1, 0, 13, 10])).length, 4, "binary content untouched");
});
