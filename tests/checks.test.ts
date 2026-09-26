/**
 * 0.22 package D: format checks without execution. Good/bad fixtures per rule
 * (tests/fixtures/checks), a fixed file clearing its findings, the file budget on a
 * 5,000-file repository, and proof that core/checks never reaches a process API.
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  bundleOrigin, checkBundle, checkFile, DEFAULT_BUDGET, fileOrigin, FindingStore, kindOf, scanRepository,
  type CheckFs, type Finding
} from "../src/core/checks";
import { globToRegExp } from "../src/core/checks/glob";
import { instructions } from "../src/core/checks/docker";

const FIX = path.join(__dirname, "fixtures", "checks");

/** An in-memory folder: path → content. Directories are implied by the paths. */
function memFs(files: Record<string, string>): CheckFs & { files: Record<string, string>; reads: string[] } {
  const reads: string[] = [];
  const dirs = new Set<string>([""]);
  for (const f of Object.keys(files)) { const parts = f.split("/"); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/")); }
  return {
    files, reads,
    async stat(rel) {
      if (rel in files) return { type: "file", size: Buffer.byteLength(files[rel]!) };
      return dirs.has(rel) ? { type: "dir", size: 0 } : undefined;
    },
    async list(rel) {
      if (!dirs.has(rel)) return undefined;
      const prefix = rel ? rel + "/" : "";
      const out = new Map<string, "file" | "dir">();
      for (const f of Object.keys(files)) if (f.startsWith(prefix)) { const rest = f.slice(prefix.length); const i = rest.indexOf("/"); out.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? "file" : "dir"); }
      return [...out].map(([name, type]) => ({ name, type })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async readText(rel) { reads.push(rel); return files[rel]; }
  };
}

function load(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) {
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel); else out[rel] = fs.readFileSync(path.join(dir, rel), "utf8");
    }
  };
  walk("");
  return out;
}

const all = (r: { origins: Map<string, Finding[]> }) => [...r.origins.values()].flat();
const summary = (fs: Finding[]) => fs.map(f => `${f.file}#${f.rule}`).sort();

test("kinds: which files are checked (never .datapass, never JSON-with-comments files)", () => {
  assert.equal(kindOf("databricks.yml"), "dab");
  assert.equal(kindOf("bundle/databricks.yaml"), "dab");
  assert.equal(kindOf("docker-compose.yml"), "compose");
  assert.equal(kindOf("compose.prod.yaml"), "compose");
  assert.equal(kindOf("api/Dockerfile"), "dockerfile");
  assert.equal(kindOf("api/Dockerfile.dev"), "dockerfile");
  assert.equal(kindOf("api/web.Dockerfile"), "dockerfile");
  assert.equal(kindOf(".github/workflows/ci.yml"), "yaml");
  assert.equal(kindOf("config/app.json"), "json");
  assert.equal(kindOf(".datapass/project.json"), undefined);
  assert.equal(kindOf("tsconfig.json"), undefined);
  assert.equal(kindOf(".vscode/anything.json"), undefined);
  assert.equal(kindOf("src/main.py"), undefined);
});

test("good fixture: no finding from any rule", async () => {
  const r = await scanRepository(memFs(load(path.join(FIX, "good"))), DEFAULT_BUDGET);
  assert.deepEqual(all(r), []);
  assert.equal(r.incomplete, false);
  assert.equal(r.checked, 6, "databricks.yml, jobs.yml, Dockerfile, docker-compose.yml, config.json, ci.yml (tsconfig.json allows comments)");
});

test("bad fixture: every rule fires where expected", async () => {
  const r = await scanRepository(memFs(load(path.join(FIX, "bad"))), DEFAULT_BUDGET);
  assert.deepEqual(summary(all(r)), [
    "api/Dockerfile#docker.copy-source", "api/Dockerfile#docker.copy-source", "api/Dockerfile#docker.from",
    "api/Dockerfile.nofrom#docker.from",
    "compose.yaml#compose.build-context", "compose.yaml#compose.build-context", "compose.yaml#compose.env-file",
    "config.json#json.syntax",
    "databricks.yml#dab.bundle-name", "databricks.yml#dab.include", "databricks.yml#dab.targets", "databricks.yml#dab.targets",
    "dup.yml#yaml.syntax",
    "resources/broken.yml#yaml.syntax",
    "resources/jobs.yml#dab.path", "resources/jobs.yml#dab.path", "resources/jobs.yml#dab.var"
  ].sort());
  const f = all(r);
  const json = f.find(x => x.rule === "json.syntax")!;
  assert.equal(json.line, 2, "the trailing comma is on line 3");
  assert.match(json.message, /trailing comma/);
  const v = f.find(x => x.rule === "dab.var")!;
  assert.match(v.message, /var\.schema/);
  assert.equal(v.line, 3);
  assert.equal(v.bundle, "databricks.yml", "bundle findings carry their bundle for the validate route");
  assert.ok(f.filter(x => x.rule.startsWith("dab.")).every(x => x.bundle === "databricks.yml"));
  assert.ok(f.filter(x => !x.rule.startsWith("dab.")).every(x => x.bundle === undefined));
  const env = f.find(x => x.rule === "compose.env-file")!;
  assert.match(env.message, /never reads/);
});

test("env files and secrets are only stat'ed, never read", async () => {
  const m = memFs({ "compose.yml": "services:\n  a:\n    image: x\n    env_file: [app.env]\n", "app.env": "TOKEN=secret\n" });
  await scanRepository(m, DEFAULT_BUDGET);
  assert.ok(!m.reads.includes("app.env"), `read: ${m.reads.join(", ")}`);
});

test("a fixed file clears its findings (file and bundle origins)", async () => {
  const m = memFs({
    "databricks.yml": "bundle:\n  name: x\ninclude:\n  - res/*.yml\ntargets:\n  dev:\n    default: true\n",
    "res/job.yml": "resources:\n  jobs:\n    j:\n      name: ${var.env}\n      tasks:\n        - task_key: t\n          notebook_task:\n            notebook_path: ../nb\n",
    "cfg.json": "{ \"a\": 1,, }"
  });
  const store = new FindingStore();
  const run = async () => {
    for (const rel of ["cfg.json", "databricks.yml", "res/job.yml"]) store.set(fileOrigin(rel), (await checkFile(m, rel, DEFAULT_BUDGET)) ?? []);
    store.set(bundleOrigin("databricks.yml"), await checkBundle(m, "databricks.yml", DEFAULT_BUDGET));
  };
  await run();
  assert.deepEqual(summary(store.forFile("res/job.yml")), ["res/job.yml#dab.path", "res/job.yml#dab.var"]);
  assert.equal(store.forFile("cfg.json").length, 1);
  m.files["cfg.json"] = "{ \"a\": 1 }";
  m.files["res/job.yml"] = m.files["res/job.yml"]!.replace("${var.env}", "job");
  m.files["nb.py"] = "# Databricks notebook source\n";
  await run();
  assert.deepEqual(store.forFile("res/job.yml"), []);
  assert.deepEqual(store.forFile("cfg.json"), []);
  assert.deepEqual([...store.files()], []);
  // A deleted file's findings go too.
  m.files["cfg.json"] = "nope";
  await run();
  assert.equal(store.forFile("cfg.json").length, 1);
  assert.ok(store.drop("cfg.json").has("cfg.json"));
  assert.deepEqual(store.forFile("cfg.json"), []);
});

test("the budget stops a 5,000-file repository scan with an incomplete note", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 5000; i++) files[`data/d${Math.floor(i / 100)}/f${i}.json`] = "{}";
  const m = memFs(files);
  const r = await scanRepository(m, DEFAULT_BUDGET);
  assert.equal(r.incomplete, true);
  assert.ok(m.reads.length <= DEFAULT_BUDGET.maxFiles, `read ${m.reads.length}`);
  const note = all(r).filter(f => f.rule === "checks.incomplete");
  assert.equal(note.length, 1);
  assert.equal(note[0]!.file, "");
  assert.match(note[0]!.message, /incomplete/i);
  const small = await scanRepository(memFs({ "a.json": "{}" }), DEFAULT_BUDGET);
  assert.equal(small.incomplete, false);
});

test("large files and skipped folders are never read", async () => {
  const m = memFs({ "big.json": "[" + "1,".repeat(100) + "1]", "node_modules/x/package.json": "{", ".git/config.json": "{", "ok.json": "{}" });
  const r = await scanRepository(m, { ...DEFAULT_BUDGET, maxFileBytes: 50 });
  assert.deepEqual(all(r), []);
  assert.deepEqual(m.reads, ["ok.json"]);
});

test("DAB: includes, notebook extensions, workspace paths, interpolation and git sources", async () => {
  const bundle = (extra: string, files: Record<string, string> = {}) => memFs({ "b/databricks.yml": "bundle:\n  name: n\ntargets:\n  dev: {}\n" + extra, ...files });
  const rules = async (m: CheckFs) => summary(await checkBundle(m, "b/databricks.yml", DEFAULT_BUDGET));
  assert.deepEqual(await rules(bundle("include:\n  - conf/**/*.yml\n", { "b/conf/a/x.yml": "resources: {}\n" })), []);
  assert.deepEqual(await rules(bundle("include:\n  - conf/*.yml\n")), ["b/databricks.yml#dab.include"]);
  assert.deepEqual(await rules(bundle("include: conf.yml\n")), ["b/databricks.yml#dab.include"]);
  const job = (p: string) => `resources:\n  jobs:\n    j:\n      tasks:\n        - task_key: t\n          notebook_task:\n            notebook_path: ${p}\n`;
  assert.deepEqual(await rules(bundle(job("./nb"), { "b/nb.ipynb": "{}" })), []);
  assert.deepEqual(await rules(bundle(job("/Workspace/Users/x/nb"))), []);
  assert.deepEqual(await rules(bundle(job("${workspace.file_path}/nb"))), []);
  assert.deepEqual(await rules(bundle(job("../../outside"))), [], "paths leaving the folder cannot be checked");
  assert.deepEqual(await rules(bundle(job("nb"))), ["b/databricks.yml#dab.path"]);
  assert.deepEqual(await rules(bundle("artifacts:\n  w:\n    type: whl\n" + "resources:\n  jobs:\n    j:\n      tasks:\n        - task_key: t\n          libraries:\n            - whl: ./dist/*.whl\n")), [], "wheels built by artifacts are not required yet");
  assert.deepEqual(await rules(bundle("variables:\n  a: {}\nresources:\n  jobs:\n    j:\n      name: ${var.a}-${var.b}-${bundle.target}\n")), ["b/databricks.yml#dab.var"]);
  const noName = memFs({ "databricks.yml": "bundle: {}\n" });
  assert.deepEqual(summary(await checkBundle(noName, "databricks.yml", DEFAULT_BUDGET)), ["databricks.yml#dab.bundle-name", "databricks.yml#dab.targets"]);
  assert.equal((await checkBundle(noName, "databricks.yml", DEFAULT_BUDGET)).find(f => f.rule === "dab.targets")!.severity, "info");
  assert.deepEqual(await checkBundle(memFs({ "databricks.yml": "bundle: [" }), "databricks.yml", DEFAULT_BUDGET), [], "syntax is the file check's");
});

test("Dockerfile parsing: continuations, heredocs, JSON form, escape directive", () => {
  const ins = instructions("# escape=`\nFROM a\nCOPY x `\n  y /d/\nRUN <<EOF\nCOPY fake .\nEOF\nCOPY [\"a b\", \"/c\"]\n");
  assert.deepEqual(ins.map(i => `${i.line}:${i.name}`), ["1:FROM", "2:COPY", "4:RUN", "7:COPY"]);
  assert.match(ins[1]!.args, /x\s+y \/d\//);
});

test("glob matching", () => {
  assert.ok(globToRegExp("resources/*.yml").test("resources/a.yml"));
  assert.ok(!globToRegExp("resources/*.yml").test("resources/x/a.yml"));
  assert.ok(globToRegExp("resources/**/*.yml").test("resources/a.yml"));
  assert.ok(globToRegExp("resources/**/*.yml").test("resources/x/y/a.yml"));
  assert.ok(globToRegExp("f?.[ab]").test("f1.a"));
  assert.ok(!globToRegExp("a.yml").test("aXyml"));
});

test("core/checks imports no process API (exec, child_process) and no vscode", () => {
  const dir = path.join(__dirname, "..", "src", "core", "checks");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".ts"));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    const imports = [
      ...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm),
      ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...src.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']/g)
    ].map(m => m[1]!);
    assert.ok(imports.length > 0 || f === "types.ts", `${f}: no import found (the pattern is stale)`);
    for (const i of imports) {
      assert.ok(!/child_process|(^|\/)exec$|^vscode$|^node:(fs|net|http|https|worker_threads)$|^(fs|net|http|https)$/.test(i), `${f} imports ${i}`);
      assert.ok(i.startsWith("./") || i === "yaml", `${f} imports ${i}: only local modules and the yaml parser are allowed`);
    }
    assert.ok(!/\b(spawn|execFile|execSync|eval|new Function)\s*\(/.test(src), `${f} calls a process or eval API`);
  }
});

test("JSON errors are located without relying on the runtime's message", async () => {
  const { locateJsonError } = await import("../src/core/checks/syntax");
  const cases: Array<[string, number, RegExp]> = [
    ['{"a": 1,, }', 8, /property name/],
    ['{"a" 1}', 5, /`:`/],
    ['[1, 2', 5, /end of the file/],
    ['{"a": [1, {"b": tru}]}', 16, /value/],
    ['{"a": "x\ny"}', 8, /line break/],
    ['{} {}', 3, /after the end/],
    ['', 0, /end of the file/],
    ['[1,]', 3, /trailing comma/]
  ];
  for (const [text, offset, msg] of cases) {
    assert.throws(() => JSON.parse(text));
    const e = locateJsonError(text);
    assert.equal(e.offset, offset, `${JSON.stringify(text)} → ${e.message} at ${e.offset}`);
    assert.match(e.message, msg);
  }
});

test("the guide documents every rule id", () => {
  const guide = fs.readFileSync(path.join(__dirname, "..", "docs", "guide", "08_FORMAT_CHECKS.md"), "utf8");
  const types = fs.readFileSync(path.join(__dirname, "..", "src", "core", "checks", "types.ts"), "utf8");
  const ids = [...types.slice(types.indexOf("export type RuleId"), types.indexOf(";", types.indexOf("export type RuleId"))).matchAll(/"([a-z.-]+)"/g)].map(m => m[1]!);
  assert.equal(ids.length, 12);
  for (const id of ids) assert.ok(guide.includes(`| \`${id}\` |`), `docs/guide/08_FORMAT_CHECKS.md has no row for ${id}`);
});
