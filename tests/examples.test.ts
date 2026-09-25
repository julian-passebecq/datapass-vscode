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
import { optionsProblems, parseOptions } from "../src/core/project/options";
import { parseSheet, sheetProblems } from "../src/core/project/sheet";
import { boardProblems, parseBoard } from "../src/core/project/board";

const ROOT = join(__dirname, "..");
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
const schema = (f: string) => { if (!compiled.has(f)) compiled.set(f, ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", f), "utf8")))); return compiled.get(f)!; };

test("examples: committed files match the fixtures (run npx tsx scripts/emit-examples.ts)", () => {
  for (const [rel, content] of Object.entries(exampleFiles())) {
    assert.equal(readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n"), content, rel);
  }
});

test("examples: manifests, graphs and the catalog are valid for the runtime and the editor", () => {
  const project = schema("datapass-project.schema.json"), graph = schema("datapass-graph.schema.json"), catalog = schema("datapass-catalog.schema.json");
  const options = schema("datapass-options.schema.json"), sheet = schema("datapass-sheet.schema.json"), board = schema("datapass-board.schema.json");
  for (const [rel, content] of Object.entries(exampleFiles())) {
    if (rel.endsWith(".datapass/project.json")) {
      const doc = JSON.parse(content);
      assert.deepEqual(validateProjectManifest(doc), [], rel);
      assert.ok(project(doc), `${rel}: ${JSON.stringify(project.errors)}`);
    } else if (rel.endsWith(".datapass/graph.json")) {
      assert.ok(parseGraph(content), rel);
      assert.ok(graph(JSON.parse(content)), `${rel}: ${JSON.stringify(graph.errors)}`);
    } else if (rel.endsWith(".datapass/options.json")) {
      assert.ok(parseOptions(content), rel);
      assert.ok(options(JSON.parse(content)), `${rel}: ${JSON.stringify(options.errors)}`);
    } else if (rel.endsWith(".datapass/sheet.json")) {
      assert.ok(parseSheet(content), rel);
      assert.ok(sheet(JSON.parse(content)), `${rel}: ${JSON.stringify(sheet.errors)}`);
    } else if (rel.endsWith(".datapass/board.json")) {
      assert.ok(parseBoard(content), rel);
      assert.ok(board(JSON.parse(content)), `${rel}: ${JSON.stringify(board.errors)}`);
    } else if (rel.endsWith(".datapass/catalog.json")) {
      assert.ok(parseCatalog(content), rel);
      assert.ok(catalog(JSON.parse(content)), `${rel}: ${JSON.stringify(catalog.errors)}`);
    }
  }
});

test("examples: the research library's options and sheet match its manifest and graph", () => {
  const files = exampleFiles();
  const dir = "examples/v3/research-library/.datapass/";
  const manifest = JSON.parse(files[dir + "project.json"]!);
  const graph = parseGraph(files[dir + "graph.json"]!);
  const o = parseOptions(files[dir + "options.json"]!);
  assert.deepEqual(optionsProblems(o, manifest, graph).filter(p => p.severity !== "info"), []);
  assert.deepEqual(sheetProblems(parseSheet(files[dir + "sheet.json"]!), manifest, graph, o.decisions.map(d => d.id)), []);
  assert.deepEqual(boardProblems(parseBoard(files[dir + "board.json"]!), manifest, graph, o), []);
});

test("examples: the editor schemas refuse what the runtime refuses (options and sheet)", () => {
  const options = schema("datapass-options.schema.json"), sheet = schema("datapass-sheet.schema.json");
  const files = exampleFiles();
  const o = JSON.parse(files["examples/v3/research-library/.datapass/options.json"]!);
  const bad = structuredClone(o); bad.decisions[0].options[1].values.setup = { score: 9 };
  assert.equal(options(bad), false);
  assert.throws(() => parseOptions(JSON.stringify(bad)));
  const badTarget = structuredClone(o); badTarget.decisions[1].options[2].changes.replace[0].operations = [{ capability: "python.tests.run", target: { key: "has space" } }];
  assert.equal(options(badTarget), false);
  assert.throws(() => parseOptions(JSON.stringify(badTarget)));
  const unknown = structuredClone(o); unknown.decisions[0].colour = "blue";
  assert.equal(options(unknown), false);
  assert.throws(() => parseOptions(JSON.stringify(unknown)));
  const sh = JSON.parse(files["examples/v3/research-library/.datapass/sheet.json"]!);
  const badSheet = structuredClone(sh); badSheet.datasets[0].rows = 12;
  assert.equal(sheet(badSheet), false);
  assert.throws(() => parseSheet(JSON.stringify(badSheet)));
});
