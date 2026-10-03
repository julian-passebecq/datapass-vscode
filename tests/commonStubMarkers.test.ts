/**
 * STUB2 (V5.1): no local copy of a Common contract may come back once the contract is vendored. REPIN8 removed them, a
 * later merge brought 9 back (V5REL1). Any "STUB until REPIN…" / "until REPIN…" / "stand-in copy" marker in src fails
 * here: import the vendored `@juliandatapass-group/*` package instead.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const SRC = join(__dirname, "..", "src");
/** Same scope as the REPIN8 gate (`git grep -i "until REPIN\|stub.*REPIN\|stand-in" -- src`), minus the QA harness word. */
export const STUB_MARKER = /until\s+REPIN|\bSTUB\b.*(?:REPIN|re-?pin|until\b)|stand-in\s+(?:copy|stub)|local\s+copy\s+of\s+.*\bCommon\b/i;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx|js|mjs)$/.test(e.name) ? [p] : [];
  });
}

test("the marker catches the shapes REPIN8 removed", () => {
  for (const line of [
    "// STUB until REPIN5: verbatim copy of Common view-spi",
    "export const X = [] as const; // STUB until REPIN5",
    " * STUB until REPIN8 (PM 30 ruling B4): port of the PURE PINDRIFT1 logic",
    " * They stay structural here until REPIN5 vendors that exchange-protocol version",
    " * `SQL_TECHNIQUE_IDS` is a STUB copy of arch-catalog's (PEDA1a2) until the re-pin",
    "// STUB until REPIN5: local copy of the reviewed Common `project-contracts` wire shape"
  ]) assert.match(line, STUB_MARKER, line);
  assert.doesNotMatch("/** QA stand-ins loaded beside DataPass (qa/v5/harness/<name>), e.g. the Data X-Ray sample stub. */", STUB_MARKER);
});

test("src has no local stand-in of a vendored Common contract", () => {
  const hits = files(SRC).flatMap(f => readFileSync(f, "utf8").split(/\r?\n/)
    .map((line, i) => (STUB_MARKER.test(line) ? `${relative(SRC, f).replace(/\\/g, "/")}:${i + 1}: ${line.trim().slice(0, 120)}` : ""))
    .filter(Boolean));
  assert.deepEqual(hits, [], `Common stub markers are back; import the vendored package instead:\n${hits.join("\n")}`);
});
