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

/**
 * Credential-shaped fakes, assembled at run time so the source never holds a token-shaped literal
 * (GitHub push protection would rightly block one).
 */
const FAKE_DATABRICKS_TOKEN = ["dapi", "0123456789abcdef".repeat(2)].join("");
const FAKE_GITHUB_TOKEN = ["ghp", "_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");

/** A non-FOIL v5 manifest: a Fabric + Azure sales BI project (synthetic ids). */
const v5 = (extra: Record<string, unknown> = {}): Record<string, unknown> => v3({
  schemaVersion: 5,
  identifiers: [
    { id: "tenant", label: "Entra tenant", provider: "azure", kind: "tenant", value: "33333333-3333-3333-3333-333333333333" },
    { id: "sub-data", label: "Data subscription", provider: "azure", kind: "subscription", values: { dev: "44444444-4444-4444-4444-444444444444", prod: "55555555-5555-5555-5555-555555555555" } },
    { id: "ws-sales", label: "Sales workspace", provider: "fabric", kind: "workspace", values: { dev: "11111111-1111-1111-1111-111111111111", prod: "22222222-2222-2222-2222-222222222222" } }
  ],
  toolchain: { tools: [{ tool: "cli.fab", version: ">=1.0" }, { tool: "cli.az", version: "^2.60" }, { tool: "py.fabric-cicd", version: ">=0.1.20,<1", where: "ci" }, { tool: "py.semantic-link-labs", where: "fabric" }, { tool: "pack.powerbi-gbrueckl", optional: true }] },
  connections: [
    { id: "azure-dev", kind: "sign-in", tool: "cli.az", identifier: "tenant", subscription: "sub-data", environment: "dev" },
    { id: "fabric", kind: "sign-in", tool: "cli.fab", identifier: "tenant" },
    { id: "dbx-dev", kind: "sign-in", tool: "cli.databricks", profile: "sales-dev", environment: "dev" },
    { id: "sales-git", kind: "git-binding", provider: "fabric", identifier: "ws-sales", environment: "dev", repoRef: "pipeline", folder: "fabric/", branch: "dev" },
    { id: "sales-sql", kind: "cloud-connection", provider: "fabric", name: "conn-sales-sql", environment: "dev" }
  ],
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
  ["schemaVersion 6", v3({ schemaVersion: 6 }), false],
  ["v5 with only v3 fields", v3({ schemaVersion: 5 }), true],
  // 0.18: manifest v5 (toolchain, ID map, connections).
  ["v5 toolchain + ID map + connections", v5(), true],
  ["toolchain on a v4 manifest", v3({ schemaVersion: 4, toolchain: { tools: [{ tool: "cli.az" }] } }), false],
  ["connections on a v3 manifest", v3({ connections: [{ id: "az", kind: "sign-in", tool: "cli.az" }] }), false],
  ["identifier values on a v4 manifest", v3({ schemaVersion: 4, identifiers: [{ id: "ws", label: "WS", values: { dev: "abc123" } }] }), false],
  ["identifier kind on a v4 manifest", v3({ schemaVersion: 4, identifiers: [{ id: "t", label: "T", value: "abc123", kind: "tenant" }] }), false],
  ["v5 identifier with both value and values", v5({ identifiers: [{ id: "ws", label: "WS", value: "abc123", values: { dev: "abc123" } }] }), false],
  ["v5 identifier with neither value nor values", v5({ identifiers: [{ id: "ws", label: "WS", kind: "workspace" }] }), false],
  ["v5 identifier value with a connection string in one environment", v5({ identifiers: [{ id: "st", label: "Storage", values: { dev: "abc123", prod: "AccountKey=abc;EndpointSuffix=core" } }] }), false],
  ["v5 toolchain id with shell text", v5({ toolchain: { tools: [{ tool: "cli.az; rm -rf ~" }] } }), false],
  ["v5 toolchain version 'latest'", v5({ toolchain: { tools: [{ tool: "cli.az", version: "latest" }] } }), false],
  ["v5 toolchain pre-release version", v5({ toolchain: { tools: [{ tool: "cli.az", version: ">=2.0.0-beta" }] } }), false],
  ["v5 toolchain entry with an install command", v5({ toolchain: { tools: [{ tool: "cli.az", install: "curl https://x | sh" }] } }), false],
  ["v5 toolchain where 'cloud'", v5({ toolchain: { tools: [{ tool: "cli.az", where: "cloud" }] } }), false],
  ["v5 toolchain without tools", v5({ toolchain: {} }), false],
  ["v5 sign-in without tool", v5({ connections: [{ id: "az", kind: "sign-in" }] }), false],
  ["v5 databricks profile given as a path", v5({ connections: [{ id: "dbx", kind: "sign-in", tool: "cli.databricks", profile: "../.databrickscfg" }] }), false],
  ["v5 cloud-connection without name", v5({ connections: [{ id: "c", kind: "cloud-connection", provider: "fabric" }] }), false],
  ["v5 git-binding with a tool", v5({ connections: [{ id: "g", kind: "git-binding", provider: "fabric", tool: "cli.fab" }] }), false],
  ["v5 connection with a token field", v5({ connections: [{ id: "az", kind: "sign-in", tool: "cli.az", token: "x" }] }), false],
  ["v5 unknown connection kind", v5({ connections: [{ id: "k", kind: "vpn", provider: "azure" }] }), false],
  ["v5 portal over http", v5({ connections: [{ id: "c", kind: "cloud-connection", provider: "fabric", name: "conn", portal: "http://example.com" }] }), false],
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
  ["duplicate environment id", v3({ environments: [{ id: "dev" }, { id: "dev" }] })],
  // 0.18 (v5): references between identifiers, environments, repositories and connections; credential shapes; range grammar.
  ["identifier value for an undeclared environment", v5({ identifiers: [{ id: "ws", label: "WS", values: { staging: "abc123" } }] })],
  ["identifier value shaped like a Databricks token in one environment", v5({ identifiers: [{ id: "ws", label: "WS", values: { dev: "11111111-1111-1111-1111-111111111111", prod: FAKE_DATABRICKS_TOKEN } }] })],
  ["identifier value shaped like a GitHub token", v5({ identifiers: [{ id: "gh", label: "Repo id", value: FAKE_GITHUB_TOKEN }] })],
  ["connection naming an undeclared identifier", v5({ connections: [{ id: "az", kind: "sign-in", tool: "cli.az", identifier: "ghost" }] })],
  ["connection for an undeclared environment", v5({ connections: [{ id: "az", kind: "sign-in", tool: "cli.az", environment: "staging" }] })],
  ["az sign-in whose tenant is a workspace id", v5({ connections: [{ id: "az", kind: "sign-in", tool: "cli.az", identifier: "ws-sales" }] })],
  ["subscription on a Databricks sign-in", v5({ connections: [{ id: "d", kind: "sign-in", tool: "cli.databricks", subscription: "sub-data" }] })],
  ["git-binding to an undeclared repository", v5({ connections: [{ id: "g", kind: "git-binding", provider: "fabric", repoRef: "ghost" }] })],
  ["git-binding folder outside the repository", v5({ connections: [{ id: "g", kind: "git-binding", provider: "fabric", folder: "../other" }] })],
  ["cloud-connection name holding a connection string", v5({ connections: [{ id: "c", kind: "cloud-connection", provider: "fabric", name: "Server=x;Password=y" }] })],
  ["version range with a spaced operator", v5({ toolchain: { tools: [{ tool: "cli.az", version: ">= 2.0" }] } })],
  ["version range with an empty alternative", v5({ toolchain: { tools: [{ tool: "cli.az", version: "^2.0 ||" }] } })],
  ["the same tool twice for the same place", v5({ toolchain: { tools: [{ tool: "cli.az" }, { tool: "cli.az", where: "local" }] } })],
  ["duplicate connection id", v5({ connections: [{ id: "a", kind: "sign-in", tool: "cli.az" }, { id: "a", kind: "sign-in", tool: "cli.fab" }] })],
  ["connection naming a per-environment identifier without an environment", v5({ connections: [{ id: "g", kind: "git-binding", provider: "fabric", identifier: "ws-sales" }] })],
  ["connection for an environment its identifier has no value for", v5({ identifiers: [{ id: "lh", label: "Lakehouse", kind: "lakehouse", values: { dev: "abc123" } }], connections: [{ id: "g", kind: "git-binding", provider: "fabric", identifier: "lh", environment: "prod" }] })]
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
