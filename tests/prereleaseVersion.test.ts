/**
 * V1-RC: DataPass 1.0.0-rc.1 is a semver pre-release. It satisfies ranges written for older releases
 * (>=0.27.0) and never a range that needs the release itself (>=1.0.0): a pre-release sorts before it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseRange, productVersion, satisfies, type VersionRange } from "../src/core/toolchain/versions";
import { parseToolkitFile } from "../src/core/toolkit/toolkit";

const range = (t: string) => parseRange(t) as VersionRange;
const ok = (version: string, r: string) => { const p = productVersion(version)!; return satisfies(p.v, range(r), p.prerelease); };

test("productVersion reads releases and pre-releases, and nothing else", () => {
  assert.deepEqual(productVersion("0.27.0"), { v: [0, 27, 0], prerelease: false });
  assert.deepEqual(productVersion("1.0.0-rc.1"), { v: [1, 0, 0], prerelease: true });
  assert.deepEqual(productVersion("1.0.0+build.5"), { v: [1, 0, 0], prerelease: false });
  assert.equal(productVersion("1.0"), undefined);
  assert.equal(productVersion("1.0.0-"), undefined);
});

test("1.0.0-rc.1 satisfies >=0.27.0 and not >=1.0.0 (semver pre-release order)", () => {
  assert.equal(ok("1.0.0-rc.1", ">=0.27.0"), true);
  assert.equal(ok("1.0.0-rc.1", ">=1.0.0"), false);
  assert.equal(ok("1.0.0-rc.1", ">=1.0"), false);
  assert.equal(ok("1.0.0-rc.1", "^1.0"), false);
  assert.equal(ok("1.0.0-rc.1", "<1.0.0"), true);
  assert.equal(ok("1.0.0-rc.1", "==1.0.0"), false);
  assert.equal(ok("1.0.0-rc.1", "*"), true);
  assert.equal(ok("1.0.0", ">=1.0.0"), true, "the release itself does");
  assert.equal(ok("0.27.0", ">=1.0.0"), false);
});

const file = (req: string) => JSON.stringify({ format: "datapass.toolkit", version: "1", requires: { datapass: req }, tools: [{ id: "cli.a", label: "A", kind: "cli" }] });

test("toolkit requires.datapass: 1.0.0-rc.1 reads files for >=0.27.0 and skips files that need >=1.0.0", () => {
  assert.equal(parseToolkitFile(file(">=0.27.0"), "t.json", "1.0.0-rc.1").newer, undefined);
  const needs = parseToolkitFile(file(">=1.0.0"), "t.json", "1.0.0-rc.1");
  assert.match(needs.newer?.text ?? "", /needs DataPass >=1\.0\.0 \(this is 1\.0\.0-rc\.1\)/);
  assert.equal(needs.tools.length, 0, "its entries are skipped, never guessed");
  assert.throws(() => parseToolkitFile(file(">=1.0.0"), "t.json", "1.0.0-rc.1", true), /requires DataPass/);
  assert.equal(parseToolkitFile(file(">=1.0.0"), "t.json", "1.0.0").newer, undefined);
});
