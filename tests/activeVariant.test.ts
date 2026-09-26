/**
 * 0.25 package V-A: the active variant (machine-local, per project) and the public example
 * examples/v3/doc-pipeline (three orchestration variants). Synthetic and generic: no FOIL content.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import {
  activeVariantLine, activeVariantView, changedPicks, MAX_REMEMBERED_PROJECTS, readStore, resolveActiveVariant,
  sameRequest, statusBarText, variantChoices, withEntry
} from "../src/core/project/activeVariant";
import { optionsProblems, parseOptions, picksFrom, scenarioPicks, type OptionsFile } from "../src/core/project/options";
import { validateProjectManifest } from "../src/core/projectManifestModel";
import { parseGraph } from "../src/core/workspace/graph";
import type { VariantsAnalysis } from "../src/core/project/variants";
import { buildFileContext } from "../src/core/exchange/fileContext";
import { optionsMarkdown } from "../src/core/project/optionsReport";

const ROOT = join(__dirname, "..");
const EXAMPLE = join(ROOT, "examples", "v3", "doc-pipeline");
const read = (rel: string) => readFileSync(join(EXAMPLE, rel), "utf8");
const options = (): OptionsFile => parseOptions(read(".datapass/options.json"));

/** A hand-made analysis: A coded, B partly coded, C not coded (what DataPass derives from the example's files). */
function analysis(): VariantsAnalysis {
  const opt = (key: string, state: "coded" | "partly-coded" | "not-coded", reason: string, current = false) => {
    const [decision, option] = key.split("=") as [string, string];
    return { key, decision, option, label: key, current, state, reason, components: [], removes: [] };
  };
  return {
    options: {
      "orchestration=direct": opt("orchestration=direct", "coded", "1 file here", true),
      "orchestration=blob-function": opt("orchestration=blob-function", "partly-coded", "1 of 2 files here; missing host.json"),
      "orchestration=adf": opt("orchestration=adf", "not-coded", "repository factory is planned")
    },
    scenarios: [
      { id: "current", title: "Current architecture (graph.json)", kind: "current", picks: [], state: "coded", reason: "every picked option is coded" },
      { id: "a-direct", title: "A — direct script", kind: "declared", picks: [], state: "coded", reason: "every picked option is coded" },
      { id: "b-event", title: "B — Blob event + Function", kind: "declared", picks: ["orchestration=blob-function"], state: "partly-coded", reason: "B: partly coded" },
      { id: "c-adf", title: "C — Data Factory", kind: "declared", picks: ["orchestration=adf"], state: "not-coded", reason: "C: not coded" }
    ],
    files: []
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const digest = () => walk(EXAMPLE).sort().map(f => `${f}:${createHash("sha256").update(readFileSync(f)).digest("hex")}`).join("\n");

test("doc-pipeline example: manifest, graph and options are valid for the runtime and the editor schemas", () => {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const schema = (f: string) => ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", f), "utf8")));
  const manifest = JSON.parse(read(".datapass/project.json"));
  assert.deepEqual(validateProjectManifest(manifest), []);
  const p = schema("datapass-project.schema.json");
  assert.ok(p(manifest), JSON.stringify(p.errors));
  const graph = parseGraph(read(".datapass/graph.json"));
  assert.ok(graph);
  const g = schema("datapass-graph.schema.json");
  assert.ok(g(JSON.parse(read(".datapass/graph.json"))), JSON.stringify(g.errors));
  const o = options();
  const os = schema("datapass-options.schema.json");
  assert.ok(os(JSON.parse(read(".datapass/options.json"))), JSON.stringify(os.errors));
  assert.deepEqual(optionsProblems(o, manifest as Parameters<typeof optionsProblems>[1], graph).filter(x => x.severity === "error"), []);
  // Three variants of one decision, three scenarios, each price dated with its source; one line in EUR.
  assert.deepEqual(o.scenarios?.map(s => s.id), ["a-direct", "b-event", "c-adf"]);
  const costs = o.decisions[0]!.options.flatMap(x => x.costs ?? []);
  assert.ok(costs.length >= 3 && costs.every(c => c.asOf && c.source), "every price has a date and a source");
  assert.ok(costs.some(c => c.currency === "EUR"), "prices keep their own currency");
  // Public and generic.
  assert.doesNotMatch(walk(EXAMPLE).map(f => readFileSync(f, "utf8")).join("\n"), /foil/i);
});

test("active variant: switching A → B → C changes what the orchestration component is and which files it needs", () => {
  const o = options();
  const roots: string[] = [];
  for (const id of ["a-direct", "b-event", "c-adf"]) {
    const r = resolveActiveVariant(o, { scenario: id });
    assert.deepEqual(r.request, { scenario: id });
    const picks = scenarioPicks(o, id)!;
    const option = o.decisions[0]!.options.find(x => x.id === picks.get("orchestration"))!;
    const replaced = option.changes?.replace?.find(x => x.id === "orchestrate");
    roots.push(replaced ? `${replaced.artifacts?.repoRef ?? "hub"}:${replaced.artifacts?.root}` : "hub:orchestration/direct");
  }
  assert.deepEqual(roots, ["hub:orchestration/direct", "hub:orchestration/blob-function", "factory:."]);
  assert.deepEqual(changedPicks(o, { scenario: "a-direct" }), []);
  assert.deepEqual(changedPicks(o, { scenario: "b-event" }), ["orchestration=blob-function"]);
  assert.deepEqual(changedPicks(o, { picks: ["orchestration=adf"] }), ["orchestration=adf"]);
});

test("active variant: the pack header names the variant and its coding state", () => {
  const o = options();
  const a = analysis();
  const b = activeVariantView(o, a, { title: "B — Blob event + Function", picks: picksFrom(o, ["orchestration=blob-function"]) });
  assert.equal(b.state, "partly-coded");
  const line = activeVariantLine(b);
  assert.match(line, /^Selected variant \(preview on this machine — not a decision, not a deployment\): \*\*B — Blob event \+ Function\*\* · files: some files present/);
  assert.match(line, /Live route: not observed by DataPass\./);
  assert.doesNotMatch(line, /active|running|deployed variant/i, "never reads as the running architecture");
  const current = activeVariantView(o, a, undefined);
  assert.equal(current.title, "Current architecture");
  assert.equal(current.state, "coded");
  assert.match(statusBarText(b), /^\$\(versions\) Variant: B — Blob event \+ Function · preview$/);

  // Copy Context for My AI and the options pack carry it, right under the project line.
  const pack = buildFileContext({
    project: { id: "doc-pipeline", title: "Document pipeline" }, activeVariant: line,
    repository: { kind: "declared", key: "hub", label: "Hub", bridge: true, otherClone: false },
    file: { relPath: "processing/process.py", text: "x = 1\n" }, components: [], revisions: [],
    tree: { parents: [], siblings: [], moreSiblings: 0 }, diagnostics: [], localPaths: []
  } as Parameters<typeof buildFileContext>[0]);
  assert.match(pack.text.split("\n")[2] ?? "", /^Selected variant .*B — Blob event/);
  const md = optionsMarkdown({ options: { ...o, decisions: [] }, analysis: { scenarios: [], problems: [], decisions: {} } as never, purpose: "export", generatedAt: "2026-09-26", dataPassVersion: "0.25.0", activeVariant: line });
  assert.match(md.text, /Selected variant .*B — Blob event/);
  const without = optionsMarkdown({ options: { ...o, decisions: [] }, analysis: { scenarios: [], problems: [], decisions: {} } as never, purpose: "export", generatedAt: "2026-09-26", dataPassVersion: "0.25.0" });
  assert.doesNotMatch(without.text, /Selected variant/);
});

test("active variant: the switcher lists current and every scenario with its coding state, and marks the active one", () => {
  const o = options();
  const choices = variantChoices(o, analysis(), { scenario: "b-event" });
  assert.deepEqual(choices.map(c => c.id), ["current", "a-direct", "b-event", "c-adf"]);
  assert.equal(choices.find(c => c.active)?.id, "b-event");
  assert.match(choices.find(c => c.id === "b-event")!.description, /some files present · recommended/);
  assert.match(choices.find(c => c.id === "c-adf")!.description, /no files/);
  assert.equal(variantChoices(o, analysis(), undefined).find(c => c.active)?.id, "current");
});

test("active variant: remembered per project in a machine store; survives a reload; nothing in the repository changes", () => {
  const before = digest();
  const empty = readStore(undefined);
  const s1 = withEntry(empty, "doc-pipeline", { scenario: "b-event" }, "2026-09-26T10:00:00Z");
  assert.deepEqual(empty, {}, "withEntry never mutates");
  const s2 = withEntry(s1, "other-project", { picks: ["x=y"] }, "2026-09-26T10:01:00Z");
  // A reload reads the same JSON back from global state.
  const reloaded = readStore(JSON.parse(JSON.stringify(s2)));
  assert.deepEqual(resolveActiveVariant(options(), reloaded["doc-pipeline"]).request, { scenario: "b-event" });
  assert.deepEqual(reloaded["other-project"]?.picks, ["x=y"]);
  // Back to current removes the entry.
  assert.equal(withEntry(reloaded, "doc-pipeline", { scenario: "current" }, "t")["doc-pipeline"], undefined);
  assert.equal(withEntry(reloaded, "doc-pipeline", undefined, "t")["doc-pipeline"], undefined);
  // Malformed state is dropped, not trusted.
  assert.deepEqual(readStore({ a: { scenario: "../x" }, b: "nope", c: { picks: ["bad pick", 3] } }), {});
  assert.deepEqual(readStore([1, 2]), {});
  // Bounded: the oldest projects go first.
  let big = {};
  for (let i = 0; i <= MAX_REMEMBERED_PROJECTS; i++) big = withEntry(big, `p${i}`, { scenario: "s" }, `2026-01-01T00:00:${String(i).padStart(3, "0")}`);
  assert.equal(Object.keys(big).length, MAX_REMEMBERED_PROJECTS);
  assert.ok(!("p0" in big));
  assert.ok(sameRequest({ scenario: "b" }, { scenario: "b" }) && !sameRequest(undefined, { scenario: "b" }));
  assert.equal(digest(), before, "the example's files are unchanged");
});

test("active variant: a scenario or option that disappears falls back to the current architecture", () => {
  const o = options();
  assert.deepEqual(resolveActiveVariant(o, undefined), {});
  assert.deepEqual(resolveActiveVariant(o, { scenario: "current" }), {});
  const gone = resolveActiveVariant(o, { scenario: "d-gone" });
  assert.equal(gone.request, undefined);
  assert.match(gone.fellBack ?? "", /"d-gone" is no longer in options.json/);
  assert.match(resolveActiveVariant(o, { picks: ["orchestration=vanished"] }).fellBack ?? "", /no longer/);
  assert.deepEqual(resolveActiveVariant(o, { picks: ["orchestration=vanished", "orchestration=adf"] }).request, { picks: ["orchestration=adf"] });
  assert.match(resolveActiveVariant(o, { scenario: "decided" }).fellBack ?? "", /no decision/);
  const decided = parseOptions(JSON.stringify({ ...JSON.parse(read(".datapass/options.json")), decisions: [{ ...JSON.parse(read(".datapass/options.json")).decisions[0], chosen: "adf" }] }));
  assert.deepEqual(resolveActiveVariant(decided, { scenario: "decided" }).request, { scenario: "decided" });
  assert.match(resolveActiveVariant(undefined, { scenario: "b-event" }).fellBack ?? "", /no options.json/);
});

test("selected variant: no contributed id says \"active variant\" (preview, not activation)", () => {
  const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
  const presets = readFileSync(join(ROOT, "resources", "experience", "presets.json"), "utf8");
  const surfaces = readFileSync(join(ROOT, "src", "core", "experience", "surfaces.ts"), "utf8");
  for (const [name, text] of [["package.json", pkg], ["presets.json", presets], ["surfaces.ts", surfaces]] as const) {
    assert.doesNotMatch(text, /activeVariant|active variant/i, name);
  }
  assert.match(presets, /"status\.selectedVariant"/);
  assert.match(pkg, /"datapass\.setSelectedVariant"/);
});
