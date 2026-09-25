/**
 * Every JSON example of docs/guide is checked against the parsers the extension uses and the editor
 * schemas. A ```json block must be preceded by one marker comment:
 *
 *   <!-- example: <group> <kind> -->   a complete file; also checked with the other files of its group
 *   <!-- fragment: <group> <kind> -->  top-level keys merged into the group's file of that kind, then checked
 *   <!-- refused: <kind> -->           a complete file DataPass must refuse (parser or editor schema)
 *   <!-- problem: <group> <kind> -->   replaces the group's file; the project map must report a problem
 *
 * Kinds: project, graph, options, sheet, board, work-log, catalog, extensions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { validateProjectManifest } from "../src/core/projectManifestModel";
import { parseGraph, type ProjectGraph } from "../src/core/workspace/graph";
import { parseCatalog } from "../src/core/project/catalog";
import { optionsProblems, parseOptions } from "../src/core/project/options";
import { parseSheet, sheetProblems } from "../src/core/project/sheet";
import { boardProblems, parseBoard } from "../src/core/project/board";
import { parseWorkLog } from "../src/core/workOrders/workLog";
import { parseExtensionsJson, compareExtensionsJson } from "../src/core/toolchain/extensionsJson";
import { buildProjectMap } from "../src/core/project/projectMap";

const ROOT = join(__dirname, "..");
const GUIDE = join(ROOT, "docs", "guide");
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
const schema = (f: string) => { if (!compiled.has(f)) compiled.set(f, ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", f), "utf8")))); return compiled.get(f)!; };
const SCHEMAS: Record<string, string | undefined> = {
  project: "datapass-project.schema.json", graph: "datapass-graph.schema.json", options: "datapass-options.schema.json",
  sheet: "datapass-sheet.schema.json", board: "datapass-board.schema.json", "work-log": "datapass-work-log.schema.json",
  catalog: "datapass-catalog.schema.json", extensions: undefined
};

interface Block { file: string; line: number; marker: "example" | "fragment" | "refused" | "problem"; group: string; kind: string; text: string }

function blocks(): Block[] {
  const out: Block[] = [];
  for (const file of readdirSync(GUIDE).filter(f => f.endsWith(".md"))) {
    const lines = readFileSync(join(GUIDE, file), "utf8").replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() !== "```json") continue;
      const end = lines.findIndex((l, j) => j > i && l.trim() === "```");
      assert.ok(end > i, `${file}:${i + 1}: unclosed json block`);
      let k = i - 1; while (k >= 0 && !lines[k]!.trim()) k--;
      const m = /^<!-- (example|fragment|refused|problem): (?:([a-z0-9-]+) )?([a-z-]+) -->$/.exec(lines[k]?.trim() ?? "");
      assert.ok(m, `${file}:${i + 1}: a json block needs a marker comment on the line above (see tests/guide.test.ts)`);
      const marker = m[1] as Block["marker"];
      assert.ok(marker === "refused" || m[2], `${file}:${i + 1}: ${marker} needs a group`);
      assert.ok(m[3]! in SCHEMAS, `${file}:${i + 1}: unknown kind ${m[3]}`);
      out.push({ file, line: i + 1, marker, group: m[2] ?? "", kind: m[3]!, text: lines.slice(i + 1, end).join("\n") });
      i = end;
    }
  }
  return out;
}

/** Throws when the runtime parser refuses the file; returns the editor schema's verdict. */
function check(kind: string, text: string): { runtime: string[]; editor: boolean } {
  const doc = JSON.parse(text);
  const editor = SCHEMAS[kind] ? schema(SCHEMAS[kind]!)(doc) as boolean : true;
  const runtime: string[] = [];
  const run = (f: () => unknown) => { try { f(); } catch (e) { runtime.push(String(e instanceof Error ? `${e.message} ${JSON.stringify((e as { issues?: unknown }).issues ?? "")}` : e)); } };
  if (kind === "project") runtime.push(...validateProjectManifest(doc));
  else if (kind === "graph") run(() => parseGraph(text));
  else if (kind === "options") run(() => parseOptions(text));
  else if (kind === "sheet") run(() => parseSheet(text));
  else if (kind === "board") run(() => parseBoard(text));
  else if (kind === "work-log") run(() => parseWorkLog(text));
  else if (kind === "catalog") run(() => parseCatalog(text));
  else if (kind === "extensions") { const o = parseExtensionsJson(text); if (o.state !== "found") runtime.push(o.state === "invalid" ? o.reason : o.state); }
  return { runtime, editor };
}

const all = blocks();

test("guide: there are examples, and every group has a manifest", () => {
  assert.ok(all.filter(b => b.marker === "example").length >= 10);
  const groups = new Set(all.filter(b => b.marker !== "refused").map(b => b.group));
  for (const g of groups) assert.ok(all.some(b => b.group === g && b.kind === "project" && b.marker === "example"), `group ${g} has no project example`);
});

test("guide: every example and fragment is accepted by the runtime parser and the editor schema", () => {
  for (const b of all.filter(x => x.marker === "example" || x.marker === "fragment")) {
    const where = `${b.file}:${b.line} (${b.marker} ${b.group} ${b.kind})`;
    let text = b.text;
    if (b.marker === "fragment") {
      const base = all.find(x => x.marker === "example" && x.group === b.group && x.kind === b.kind);
      assert.ok(base, `${where}: no ${b.kind} example in group ${b.group}`);
      text = JSON.stringify({ ...JSON.parse(base.text), ...JSON.parse(b.text) });
    }
    const r = check(b.kind, text);
    assert.deepEqual(r.runtime, [], where);
    assert.ok(r.editor, `${where}: editor schema ${SCHEMAS[b.kind] ? JSON.stringify(schema(SCHEMAS[b.kind]!).errors) : ""}`);
  }
});

test("guide: every refused example is refused (runtime or editor)", () => {
  const refused = all.filter(b => b.marker === "refused");
  assert.ok(refused.length >= 5);
  for (const b of refused) {
    const r = check(b.kind, b.text);
    assert.ok(r.runtime.length > 0 || !r.editor, `${b.file}:${b.line}: this "refused" ${b.kind} example is accepted`);
    // The runtime is the authority: what the editor refuses, the runtime refuses too (F06 parity).
    if (!r.editor && b.kind !== "extensions") assert.ok(r.runtime.length > 0, `${b.file}:${b.line}: the editor refuses it but the runtime accepts it`);
  }
});

type Files = Partial<Record<string, string>>;
function groupFiles(group: string, replace?: Block): Files {
  const files: Files = {};
  for (const b of all.filter(x => x.group === group && x.marker === "example")) files[b.kind] = b.text;
  for (const b of all.filter(x => x.group === group && x.marker === "fragment")) files[b.kind] = JSON.stringify({ ...JSON.parse(files[b.kind]!), ...JSON.parse(b.text) });
  if (replace) files[replace.kind] = replace.text;
  return files;
}

function crossProblems(files: Files) {
  const manifest = JSON.parse(files.project!);
  const graph: ProjectGraph | undefined = files.graph ? parseGraph(files.graph) : undefined;
  const map = buildProjectMap({ manifest, graph, coordinationKey: "coordination", repoObservations: new Map(), fileObservations: new Map(),
    tools: new Map(), facts: new Map(), reviewsConfirmed: new Set(), checklist: {}, qualification: [] });
  const problems = [...map.problems];
  const options = files.options ? parseOptions(files.options) : undefined;
  if (options) problems.push(...optionsProblems(options, manifest, graph));
  if (files.sheet) problems.push(...sheetProblems(parseSheet(files.sheet), manifest, graph, options?.decisions.map(d => d.id) ?? []));
  if (files.board) problems.push(...boardProblems(parseBoard(files.board), manifest, graph, options));
  if (files.extensions) {
    const view = compareExtensionsJson(manifest.toolchain, parseExtensionsJson(files.extensions));
    for (const row of view.expected) if (row.unwanted || (!row.recommended && !row.optional)) problems.push({ severity: "warning", where: "extensions.json", message: `${row.extensionId} is ${row.unwanted ? "unwanted" : "not recommended"}` });
  }
  return problems.filter(p => p.severity !== "info");
}

test("guide: the files of each group agree with each other (no problem in project files)", () => {
  const groups = [...new Set(all.filter(b => b.marker === "example").map(b => b.group))];
  for (const g of groups) assert.deepEqual(crossProblems(groupFiles(g)), [], `group ${g}`);
});

test("guide: every 'problem' example is reported in Problems in project files", () => {
  for (const b of all.filter(x => x.marker === "problem")) {
    const r = check(b.kind, b.text);
    assert.deepEqual(r.runtime, [], `${b.file}:${b.line}: a problem example must parse (the problem is cross-file)`);
    assert.ok(crossProblems(groupFiles(b.group, b)).length > 0, `${b.file}:${b.line}: no problem reported`);
  }
});
