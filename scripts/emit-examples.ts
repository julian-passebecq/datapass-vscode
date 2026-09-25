/**
 * Write the public V3 examples from the synthetic test fixtures, so the examples an AI copies and
 * the projects the tests exercise are the same files. tests/examples.test.ts fails on drift.
 *
 *   npx tsx scripts/emit-examples.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exampleFiles } from "../tests/fixtures/v3/examples";

const root = join(__dirname, "..");
for (const [rel, content] of Object.entries(exampleFiles())) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${rel}`);
}
