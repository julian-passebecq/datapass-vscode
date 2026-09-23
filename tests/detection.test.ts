import assert from "node:assert/strict";
import test from "node:test";
import { detectCli } from "../src/core/detection";

test("detectCli returns available and first version line", async () => {
  const probe = await detectCli(
    { id: "x", label: "Example", command: "example" },
    async () => ({ ok: true, output: "example 1.2.3\nmore" })
  );
  assert.equal(probe.available, true);
  assert.equal(probe.version, "example 1.2.3");
});

test("detectCli degrades cleanly when executable is missing", async () => {
  const probe = await detectCli(
    { id: "x", label: "Example", command: "example" },
    async () => ({ ok: false, error: "ENOENT" })
  );
  assert.equal(probe.available, false);
  assert.equal(probe.detail, "ENOENT");
});
