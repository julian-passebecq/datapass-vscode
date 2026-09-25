/**
 * The committed V3 examples are valid for the runtime and the editor schemas, and identical to what
 * scripts/emit-examples.ts writes from the test fixtures (run it after changing a fixture).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { exampleFiles } from "./fixtures/v3/examples";
import { validateProjectManifest } from "../src/core/projectManifestModel";
import { parseGraph } from "../src/core/workspace/graph";
import { parseCatalog } from "../src/core/project/catalog";

const ROOT = join(__dirname, "..");
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const schema = (f: string) => ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", f), "utf8")));

test("examples: committed files match the fixtures (run npx tsx scripts/emit-examples.ts)", () => {
  for (const [rel, content] of Object.entries(exampleFiles())) {
    assert.equal(readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n"), content, rel);
  }
});

test("examples: manifests, graphs and the catalog are valid for the runtime and the editor", () => {
  const project = schema("datapass-project.schema.json"), graph = schema("datapass-graph.schema.json"), catalog = schema("datapass-catalog.schema.json");
  for (const [rel, content] of Object.entries(exampleFiles())) {
    if (rel.endsWith(".datapass/project.json")) {
      const doc = JSON.parse(content);
      assert.deepEqual(validateProjectManifest(doc), [], rel);
      assert.ok(project(doc), `${rel}: ${JSON.stringify(project.errors)}`);
    } else if (rel.endsWith(".datapass/graph.json")) {
      assert.ok(parseGraph(content), rel);
      assert.ok(graph(JSON.parse(content)), `${rel}: ${JSON.stringify(graph.errors)}`);
    } else if (rel.endsWith(".datapass/catalog.json")) {
      assert.ok(parseCatalog(content), rel);
      assert.ok(catalog(JSON.parse(content)), `${rel}: ${JSON.stringify(catalog.errors)}`);
    }
  }
});
