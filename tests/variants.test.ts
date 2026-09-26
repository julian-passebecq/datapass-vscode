/**
 * 0.23 package G (core): coding state of architecture variants (plan D-15/D-16). Synthetic research
 * library (project A) only; no FOIL content.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions, type OptionsFile } from "../src/core/project/options";
import { buildProjectMap } from "../src/core/project/projectMap";
import { artifactPlan, obsKey, type FileObservation } from "../src/core/project/resolve";
import { combineStates, deriveVariants, type VariantsAnalysis } from "../src/core/project/variants";
import type { GraphItem } from "../src/core/workspace/graph";
import { fileObsA, inputA } from "./fixtures/v3/research";
import { optionsAJson } from "./fixtures/v3/researchOptions";

/** Options A plus a decision whose variants live in a planned repository or share a file with "script". */
function optionsG(): OptionsFile {
  const raw = optionsAJson() as Record<string, any>;
  raw.decisions.push({
    id: "api", title: "Is there a query API?", subproject: "papers", current: "none",
    options: [
      { id: "none", label: "No API" },
      { id: "service", label: "A small API service (new repository)",
        changes: {
          addRepositories: [{ key: "api-repo", label: "Query API", planned: true }],
          add: [{ id: "api", kind: "application", label: "Query API", provider: "python", status: "planned", artifacts: { repoRef: "api-repo", root: ".", entry: "main.py" } }]
        } },
      { id: "reuse", label: "Serve pages from the extraction script",
        changes: { add: [{ id: "pages-cli", kind: "script", label: "Pages CLI", provider: "python", artifacts: { profile: "python.script", root: "scripts/extract", entry: "extract.py" } }] } }
    ]
  });
  raw.scenarios.push({ id: "mixed", title: "Script and a new API", picks: ["processing=script", "api=service"] });
  return parseOptions(JSON.stringify(raw));
}

const optionItems = (o: OptionsFile, key: string): GraphItem[] => {
  const [d, id] = key.split("=");
  const opt = o.decisions.find(x => x.id === d)!.options.find(x => x.id === id)!;
  return [...(opt.changes?.replace ?? []), ...(opt.changes?.add ?? [])];
};

/** Every file and folder the option's components expect, observed as present (except `missing`). */
function observed(o: OptionsFile, keys: string[], missing: string[] = []): Map<string, FileObservation> {
  const files = fileObsA();
  const plan = artifactPlan(keys.flatMap(k => optionItems(o, k)).map(item => ({ item, repoKey: "pipeline" })));
  for (const e of plan) {
    if (e.tracked) { files.set(obsKey(e.repoKey, e.repoPath), { state: "missing", tracking: { state: "untracked" } }); continue; }
    files.set(obsKey(e.repoKey, e.repoPath), missing.includes(e.repoPath) ? { state: "missing" }
      : e.kind === "file" ? { state: "found", kind: "file", fingerprint: { kind: "sha256", value: e.repoPath } }
      : { state: "found", kind: "dir", count: 2 });
  }
  return files;
}

function analyse(o: OptionsFile, fileObservations: Map<string, FileObservation>): VariantsAnalysis {
  const input = inputA({ fileObservations });
  const map = buildProjectMap(input);
  return deriveVariants({ options: o, manifest: input.manifest, graph: input.graph, coordinationKey: input.coordinationKey, repositories: map.repositories, fileObservations });
}

test("variants: an option whose files are all here is coded", () => {
  const o = optionsG();
  const v = analyse(o, observed(o, ["processing=script"]));
  const script = v.options["processing=script"]!;
  assert.equal(script.state, "coded", script.reason);
  assert.equal(script.components[0]!.role, "replace");
  assert.equal(script.removes.join(), "adf");
});

test("variants: one missing file makes an option partly coded, with the file named", () => {
  const o = optionsG();
  const v = analyse(o, observed(o, ["processing=script"], ["scripts/extract/tests/test_extract.py"]));
  const script = v.options["processing=script"]!;
  assert.equal(script.state, "partly-coded");
  assert.match(script.reason, /missing tests\/test_extract\.py/);
});

test("variants: an option in a planned repository only is not coded; one without files neither", () => {
  const o = optionsG();
  const v = analyse(o, observed(o, []));
  const service = v.options["api=service"]!;
  assert.equal(service.state, "not-coded");
  assert.match(service.reason, /planned/);
  const gcs = v.options["archive=gcs"]!;
  assert.equal(gcs.state, "not-coded");
  assert.match(gcs.reason, /no files declared/);
  // A file that was never observed is unknown, not missing.
  assert.equal(v.options["processing=script"]!.state, "unknown");
});

test("variants: an option that only removes components is coded by definition", () => {
  const v = analyse(optionsG(), fileObsA());
  const mongo = v.options["staging=mongo-staging"]!;
  assert.equal(mongo.state, "coded");
  assert.match(mongo.reason, /only removes cosmos/);
  assert.equal(v.options["api=none"]!.state, "coded", "a current option that no alternative touches");
});

test("variants: a scenario mixing coded, not-coded and removal-only options is partly coded", () => {
  const o = optionsG();
  const v = analyse(o, observed(o, ["processing=script"]));
  const mixed = v.scenarios.find(s => s.id === "mixed")!;
  assert.equal(mixed.state, "partly-coded");
  assert.match(mixed.reason, /A small API service \(new repository\): not coded/);
  assert.deepEqual(mixed.picks.sort(), ["api=service", "processing=script"]);
  assert.equal(v.scenarios.find(s => s.id === "lean")!.state, "coded", "script (coded) + mongo staging (removal only)");
  // Google: its two new options are not coded; the decisions it leaves current are, so partly coded.
  const google = v.scenarios.find(s => s.id === "google")!;
  assert.equal(google.state, "partly-coded");
  assert.match(google.reason, /Google Cloud Storage: not coded/);
  assert.match(google.reason, /BigQuery object table \+ Document AI: not coded/);
  assert.equal(v.scenarios[0]!.kind, "current");
});

test("variants: a file needed by two options is tagged with both", () => {
  const o = optionsG();
  const v = analyse(o, observed(o, ["processing=script", "api=reuse"]));
  const shared = v.files.find(f => f.repoKey === "pipeline" && f.repoPath === "scripts/extract/extract.py")!;
  assert.deepEqual(shared.options.sort(), ["api=reuse", "processing=script"]);
  assert.equal(shared.state, "found");
});

test("variants: the current option is judged on the baseline components its alternatives change", () => {
  const v = analyse(optionsG(), fileObsA());
  const cur = v.options["processing=adf-function"]!;
  assert.equal(cur.current, true);
  assert.deepEqual(cur.components.map(c => c.id).sort(), ["adf", "cosmos", "extract"]);
  assert.ok(cur.components.every(c => c.role === "current"));
  // extract's requirements.txt is missing in the fixture: the current processing is partly coded.
  assert.equal(cur.components.find(c => c.id === "extract")!.state, "partly-coded");
});

test("variants: combining states never claims a gap nobody saw", () => {
  assert.equal(combineStates([]), "coded");
  assert.equal(combineStates(["coded", "coded"]), "coded");
  assert.equal(combineStates(["coded", "not-coded"]), "partly-coded");
  assert.equal(combineStates(["coded", "unknown"]), "unknown");
  assert.equal(combineStates(["not-coded", "unknown"]), "unknown");
  assert.equal(combineStates(["coded", "not-coded", "unknown"]), "partly-coded");
  assert.equal(combineStates(["partly-coded"]), "partly-coded");
});
