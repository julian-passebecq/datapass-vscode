/**
 * Manifest v3 and editor/runtime parity (audit F06): the runtime validator and the editor JSON
 * Schema must accept and reject the same documents. Cross-references that JSON Schema cannot
 * express (a repoRef naming a declared repository…) are runtime-only and listed as such.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { foilProjectManifest, genericProjectManifest, migrateManifestToV2, migrateManifestToV3, validateProjectManifest, type DataPassProjectManifest } from "../src/core/projectManifestModel";
import { unknownFields } from "../src/core/contracts/schemaKeys";

const schema = JSON.parse(readFileSync("schemas/datapass-project.schema.json", "utf8"));
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
const validate = ajv.compile(schema);
const editorOk = (doc: unknown) => Boolean(validate(doc));
const runtimeOk = (doc: unknown) => validateProjectManifest(doc).length === 0;

const v3 = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 3,
  project: { id: "p", title: "P" },
  repositories: {
    pipeline: { remote: { url: "https://github.com/example/pipeline" }, description: "Functions and ADF" },
    infra: { planned: true },
    local: { path: "../local-clone", management: "local" }
  },
  environments: [{ id: "dev", title: "Development" }, { id: "prod", production: true }],
  docs: [{ label: "Architecture", path: "docs/ARCHITECTURE.md" }, { label: "Runbook", url: "https://example.com/runbook" }, { label: "Pipeline README", path: "README.md", repoRef: "pipeline" }],
  scopes: [{ id: "papers", title: "Papers", repoRef: "pipeline", docs: [{ label: "Flow", path: "docs/flow.md" }] }],
  modules: { azure: true, databases: false },
  ...extra
});

/** [name, document, expected validity]: runtime and editor must both give the expected answer. */
const STRUCTURAL: Array<[string, unknown, boolean]> = [
  ["v1 generic", genericProjectManifest("x"), true],
  ["v1 FOIL", foilProjectManifest(), true],
  ["v2 migrated FOIL", migrateManifestToV2(foilProjectManifest()), true],
  ["v3 complete", v3(), true],
  ["v3 with $schema", v3({ $schema: "https://example.com/datapass-project.schema.json" }), true],
  ["unknown top-level field (flows)", v3({ flows: [] }), false],
  ["unknown platform (bigquery)", { schemaVersion: 2, project: { id: "p", title: "P" }, platforms: { bigquery: { dataset: "x" } } }, false],
  ["unknown field in a repository", v3({ repositories: { a: { remote: { url: "https://github.com/a/b" }, token: "x" } } }), false],
  ["unknown field in a scope", v3({ scopes: [{ id: "s", title: "S", flows: [] }] }), false],
  ["unknown module", v3({ modules: { kafka: true } }), false],
  ["schemaVersion 5", v3({ schemaVersion: 5 }), false],
  ["v4 localEnv + identifiers", v3({ schemaVersion: 4, localEnv: { files: [".env", { path: ".env.local", optional: true }], requiredKeys: ["CLOUDFLARE_ACCOUNT_ID", "MONGODB_URI"] }, identifiers: [{ id: "cf-account", label: "Cloudflare account ID", value: "0123456789abcdef0123456789abcdef", provider: "cloudflare", envKey: "CLOUDFLARE_ACCOUNT_ID" }] }), true],
  ["localEnv on a v3 manifest", v3({ localEnv: { files: [".env"] } }), false],
  ["identifiers on a v3 manifest", v3({ identifiers: [{ id: "a", label: "A", value: "1" }] }), false],
  ["v4 localEnv reading a non-env file", v3({ schemaVersion: 4, localEnv: { files: ["config/secrets.json"] } }), false],
  ["v4 unknown field in localEnv", v3({ schemaVersion: 4, localEnv: { files: [".env"], values: {} } }), false],
  ["v4 unknown field in an identifier", v3({ schemaVersion: 4, identifiers: [{ id: "a", label: "A", value: "1", secret: "x" }] }), false],
  ["v4 bad variable name", v3({ schemaVersion: 4, localEnv: { files: [".env"], requiredKeys: ["1BAD"] } }), false],
  ["environments in v2", { schemaVersion: 2, project: { id: "p", title: "P" }, environments: [{ id: "dev" }] }, false],
  ["docs in v1", { ...genericProjectManifest("x"), docs: [{ label: "a", path: "a.md" }] }, false],
  ["planned repository in v2", { schemaVersion: 2, project: { id: "p", title: "P" }, repositories: { a: { planned: true } } }, false],
  ["scope repoRef in v2", { schemaVersion: 2, project: { id: "p", title: "P" }, scopes: [{ id: "s", title: "S", repoRef: "x" }] }, false],
  ["planned repository with a path", v3({ repositories: { a: { planned: true, path: "../a" } } }), false],
  ["planned must be true", v3({ repositories: { a: { planned: false, remote: { url: "https://github.com/a/b" } } } }), false],
  ["repository with nothing", v3({ repositories: { a: { label: "A" } } }), false],
  ["environment id not lowercase", v3({ environments: [{ id: "Dev" }] }), false],
  ["environment with unknown field", v3({ environments: [{ id: "dev", subscriptionKey: "x" }] }), false],
  ["doc with both path and url", v3({ docs: [{ label: "a", path: "a.md", url: "https://x.y/z" }] }), false],
  ["doc with neither", v3({ docs: [{ label: "a" }] }), false],
  ["doc path traversal", v3({ docs: [{ label: "a", path: "../secrets.md" }] }), false],
  ["doc absolute path", v3({ docs: [{ label: "a", path: "C:/x.md" }] }), false],
  ["doc http url", v3({ docs: [{ label: "a", url: "http://x.y/z" }] }), false],
  ["resources in v1", { ...genericProjectManifest("x"), resources: [{ id: "vm", kind: "vm" }] }, false]
];

/** Rules only the runtime can check (cross-references between parts of the file). */
const RUNTIME_ONLY: Array<[string, unknown]> = [
  ["scope repoRef not declared", v3({ scopes: [{ id: "s", title: "S", repoRef: "ghost" }] })],
  ["doc repoRef not declared", v3({ docs: [{ label: "a", path: "a.md", repoRef: "ghost" }] })],
  ["duplicate environment id", v3({ environments: [{ id: "dev" }, { id: "dev" }] })]
];

test("F06: runtime and editor schema agree on every structural case", () => {
  const disagreements: string[] = [];
  for (const [name, doc, expected] of STRUCTURAL) {
    const r = runtimeOk(doc), e = editorOk(doc);
    if (r !== expected || e !== expected) disagreements.push(`${name}: expected ${expected}, runtime ${r}${r ? "" : ` (${validateProjectManifest(doc)[0]})`}, editor ${e}`);
  }
  assert.deepEqual(disagreements, []);
});

test("F06: cross-reference rules are enforced at runtime (the editor cannot express them)", () => {
  for (const [name, doc] of RUNTIME_ONLY) {
    assert.equal(runtimeOk(doc), false, name);
    assert.equal(editorOk(doc), true, `${name}: if the editor schema learns this rule, move the case to STRUCTURAL`);
  }
});

test("F06: unknown fields are named precisely, from the schema file", () => {
  assert.deepEqual(unknownFields(schema, { schemaVersion: 2, project: { id: "p", title: "P", color: "red" }, flows: [], platforms: { bigquery: {} } }).sort(), ["flows", "platforms.bigquery", "project.color"]);
  const issues = validateProjectManifest(v3({ flows: [] }));
  assert.ok(issues.some(i => /^flows is not a known field/.test(i)), issues.join(" | "));
  // Open maps (repository keys, companion scope entities) stay open.
  assert.deepEqual(unknownFields(schema, v3()), []);
});

test("manifest v3 migration: v1/v2 → v3 keeps every field and only moves the version", () => {
  const v1 = foilProjectManifest();
  const up = migrateManifestToV3(v1);
  assert.equal(up.schemaVersion, 3);
  assert.equal(v1.schemaVersion, 1, "the input is not mutated");
  assert.deepEqual(validateProjectManifest(up), []);
  assert.deepEqual(up.repositories, migrateManifestToV2(v1).repositories);
  const v2: DataPassProjectManifest = { schemaVersion: 2, project: { id: "p", title: "P" }, scopes: [{ id: "s", title: "S" }] };
  assert.deepEqual({ ...migrateManifestToV3(v2), schemaVersion: 2 }, v2);
});
