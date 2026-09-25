/**
 * 0.16 Git hosts: one identity per repository whatever the address form (Azure DevOps above all),
 * the manifest check and the editor schema accept the same addresses, web links per host, and the
 * CI profiles resolve their files.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { gitHostOf, remoteIdentity, repositoryName, repositoryWebLinks } from "../src/core/project/gitHosts";
import { COORDINATION_KEY, globMatcher, normalizeRemote, obsKey, repoNameFromRemote, sameRemote, type FileObservation, type RepoObservation } from "../src/core/project/resolve";
import { isRemoteUrl, validateProjectManifest } from "../src/core/projectManifestModel";
import { safeRemoteUrl } from "../src/core/workspace/gitBase";
import { buildProjectMap } from "../src/core/project/projectMap";
import { parseGraph } from "../src/core/workspace/graph";
import { PROFILE_INDEX, defaultProfileFor } from "../src/core/project/profiles";
import { PROVIDER_INDEX } from "../src/core/project/providers";
import { CAPABILITY_INDEX } from "../src/core/capabilities/registry";
import { TOOL_INDEX } from "../src/core/capabilities/tools";
import { DEVOPS_REMOTES, graphDevopsJson, manifestDevops } from "./fixtures/v3/devops";

const ADO = "dev.azure.com/example-org/shop%20platform/_git/orders-api";

test("Azure DevOps: every address form of one repository has the same identity", () => {
  const forms = [
    "https://dev.azure.com/example-org/Shop%20Platform/_git/orders-api",
    "https://example-org@dev.azure.com/example-org/Shop%20Platform/_git/orders-api",
    "https://dev.azure.com/example-org/Shop Platform/_git/orders-api/",
    "git@ssh.dev.azure.com:v3/example-org/Shop%20Platform/orders-api",
    "ssh://git@ssh.dev.azure.com:22/v3/example-org/Shop%20Platform/orders-api",
    "https://example-org.visualstudio.com/Shop%20Platform/_git/orders-api",
    "https://example-org.visualstudio.com/DefaultCollection/Shop%20Platform/_git/orders-api",
    "example-org@vs-ssh.visualstudio.com:v3/example-org/Shop%20Platform/orders-api"
  ];
  for (const f of forms) assert.equal(normalizeRemote(f), ADO, f);
  assert.ok(sameRemote(DEVOPS_REMOTES.api, DEVOPS_REMOTES.apiOrigin), "declared https-with-org and the clone's SSH origin");
  // A project named like its repository can be omitted.
  assert.equal(remoteIdentity("https://dev.azure.com/org/_git/Tools"), remoteIdentity("https://dev.azure.com/org/Tools/_git/Tools"));
  assert.equal(repoNameFromRemote(DEVOPS_REMOTES.apiOrigin), "orders-api");
  assert.equal(repositoryName("https://github.com/Example-Org/Shop-Web.git"), "Shop-Web", "the clone folder keeps the repository's case");
  // Different repositories stay different.
  assert.ok(!sameRemote("https://dev.azure.com/org/p/_git/a", "https://dev.azure.com/org/p/_git/b"));
  assert.ok(!sameRemote("https://dev.azure.com/org/p1/_git/a", "https://dev.azure.com/org/p2/_git/a"));
  assert.ok(!sameRemote("https://dev.azure.com/org1/p/_git/a", "git@ssh.dev.azure.com:v3/org2/p/a"));
});

test("remote identity: GitHub and GitLab forms unchanged, credentials and .git ignored", () => {
  assert.equal(normalizeRemote("https://github.com/Org/Repo.git"), "github.com/org/repo");
  assert.equal(normalizeRemote("git@github.com:org/repo.git"), "github.com/org/repo");
  assert.equal(normalizeRemote("https://token@github.com/org/repo/"), "github.com/org/repo");
  assert.equal(normalizeRemote("git@gitlab.com:group/sub/project.git"), "gitlab.com/group/sub/project");
  assert.ok(sameRemote("https://gitlab.com/group/sub/project", "git@gitlab.com:group/sub/project.git"));
  assert.equal(normalizeRemote("not a url"), undefined);
  assert.equal(normalizeRemote(""), undefined);
});

test("manifest remotes: Azure DevOps clone addresses accepted, credentials refused; runtime and editor schema agree", () => {
  const ok = [
    "https://github.com/example-org/shop-web",
    "git@github.com:example-org/shop-web.git",
    "https://example-org@dev.azure.com/example-org/Shop%20Platform/_git/orders-api",
    "https://dev.azure.com/example-org/Shop%20Platform/_git/orders-api",
    "git@ssh.dev.azure.com:v3/example-org/Shop%20Platform/orders-api",
    "example-org@vs-ssh.visualstudio.com:v3/example-org/Shop%20Platform/orders-api",
    "https://gitlab.example.com/group/project.git"
  ];
  const refused = [
    "https://someone@dev.azure.com/example-org/Shop/_git/orders-api",          // a user name that is not the organization
    "https://pat1234567890@dev.azure.com/example-org/Shop/_git/orders-api",
    "https://example-org:secret@dev.azure.com/example-org/Shop/_git/orders-api",
    "https://ghp_abcdefghij@github.com/example-org/shop-web",
    "https://user:pass@gitlab.com/g/p",
    "someone@vs-ssh.visualstudio.com:v3/example-org/Shop/orders-api",
    "http://github.com/example-org/shop-web",
    "ssh://git@github.com/example-org/shop-web"
  ];
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const schema = ajv.compile(JSON.parse(readFileSync("schemas/datapass-project.schema.json", "utf8")));
  const manifest = (url: string) => ({ schemaVersion: 4, project: { id: "p", title: "P" }, repositories: { r: { remote: { url } } } });
  for (const url of ok) {
    assert.equal(isRemoteUrl(url), true, url);
    assert.deepEqual(validateProjectManifest(manifest(url)), [], url);
    assert.ok(schema(manifest(url)), `${url}: ${JSON.stringify(schema.errors)}`);
  }
  for (const url of refused) {
    assert.equal(isRemoteUrl(url), false, url);
    assert.ok(validateProjectManifest(manifest(url)).length > 0, url);
    assert.equal(schema(manifest(url)), false, url);
  }
  assert.match(validateProjectManifest(manifest(refused[0]!)).join(" "), /Azure DevOps: https:\/\/<organization>@dev\.azure\.com/);
  assert.equal(safeRemoteUrl(DEVOPS_REMOTES.api), DEVOPS_REMOTES.api, "git ls-remote accepts the Azure clone address");
  assert.equal(safeRemoteUrl(refused[0]!), undefined);
  assert.deepEqual(validateProjectManifest(manifestDevops()), []);
});

test("web links: repository, pull requests, pipelines and boards per host", () => {
  const byId = (url: string) => Object.fromEntries(repositoryWebLinks(url).map(l => [l.id, l.url]));
  assert.deepEqual(byId("git@github.com:Example-Org/shop-web.git"), {
    repository: "https://github.com/Example-Org/shop-web", "pull-requests": "https://github.com/Example-Org/shop-web/pulls",
    pipelines: "https://github.com/Example-Org/shop-web/actions", boards: "https://github.com/Example-Org/shop-web/issues"
  });
  assert.deepEqual(byId(DEVOPS_REMOTES.apiOrigin), {
    repository: "https://dev.azure.com/example-org/Shop%20Platform/_git/orders-api",
    "pull-requests": "https://dev.azure.com/example-org/Shop%20Platform/_git/orders-api/pullrequests",
    pipelines: "https://dev.azure.com/example-org/Shop%20Platform/_build",
    boards: "https://dev.azure.com/example-org/Shop%20Platform/_workitems"
  });
  assert.equal(byId("https://example-org.visualstudio.com/DefaultCollection/Shop/_git/orders-api").repository, "https://dev.azure.com/example-org/Shop/_git/orders-api", "legacy addresses open on dev.azure.com");
  assert.deepEqual(byId(DEVOPS_REMOTES.data), {
    repository: "https://gitlab.com/example-group/data/shop-data-jobs", "pull-requests": "https://gitlab.com/example-group/data/shop-data-jobs/-/merge_requests",
    pipelines: "https://gitlab.com/example-group/data/shop-data-jobs/-/pipelines", boards: "https://gitlab.com/example-group/data/shop-data-jobs/-/issues"
  });
  assert.equal(gitHostOf("git@gitlab.example.com:team/app.git")?.web, "https://gitlab.example.com/team/app", "self-managed GitLab named gitlab.*");
  assert.equal(gitHostOf("https://token@github.com/o/r")?.web, "https://github.com/o/r", "no credential reaches a link");
  assert.deepEqual(repositoryWebLinks("https://bitbucket.org/o/r"), [], "unknown hosts get no guessed page");
  assert.deepEqual(repositoryWebLinks("git@github.com:o/r/extra.git"), []);
  for (const l of repositoryWebLinks(DEVOPS_REMOTES.api)) assert.ok(!l.url.includes("@"), l.url);
});

test("glob paths: *, ? and {a,b} in the last segment", () => {
  const yml = globMatcher("*.{yml,yaml}", false);
  assert.ok(yml.test("ci.yml") && yml.test("deploy.yaml"));
  assert.ok(!yml.test("ci.yml.bak") && !yml.test("notes.txt") && !yml.test("a/ci.yml"));
  assert.ok(globMatcher("00?_*.sql", false).test("001_init.sql"));
  assert.ok(globMatcher("*.PY", true).test("dag.py"), "case-insensitive on Windows");
  assert.ok(!globMatcher("*.PY", false).test("dag.py"));
  assert.ok(globMatcher("a.b", false).test("a.b") && !globMatcher("a.b", false).test("axb"), "dots are literal");
});

test("CI profiles: GitHub Actions, Azure Pipelines and GitLab CI resolve their files; runs open on the host", () => {
  for (const [provider, profile, cap, ext] of [
    ["github-actions", "github-actions", "ci.github-actions.runs", "github.vscode-github-actions"],
    ["azure-pipelines", "azure-pipelines", "ci.azure-pipelines.runs", "ms-azure-devops.azure-pipelines"],
    ["gitlab-ci", "gitlab-ci", "ci.gitlab.pipelines", "GitLab.gitlab-workflow"]
  ] as const) {
    assert.equal(defaultProfileFor(provider).id, profile);
    const p = PROVIDER_INDEX.get(provider)!;
    assert.equal(p.capabilityProvider, "devops");
    assert.deepEqual(p.nativeTool?.extensionIds, [ext]);
    for (const t of p.nativeTool?.toolIds ?? []) assert.ok(TOOL_INDEX.has(t), t);
    const c = CAPABILITY_INDEX.get(cap)!;
    assert.equal(c.phase, "read", "seeing the runs reads the host; it targets no environment");
    assert.equal(c.localFiles, false, "a pipeline's runs are on the host: an uncloned repository does not block them");
    assert.ok(c.requirements.every(r => r.need === "optional"), "the official extension is optional: the web page works without it");
    assert.ok(PROFILE_INDEX.get(profile)!.operations.includes(cap));
  }
  assert.ok(TOOL_INDEX.get("ext.grafana")?.extensionIds?.includes("Grafana.grafana-vscode"));
  assert.ok(TOOL_INDEX.get("ext.github-prs")?.extensionIds?.includes("GitHub.vscode-pull-request-github"));

  // The DevOps fixture: the GitHub and Azure clones are here (origins in SSH form), the GitLab one is not.
  const graph = parseGraph(JSON.stringify(graphDevopsJson()));
  const found = (count = 1) => ({ state: "found" as const, kind: "file" as const, count });
  const map = buildProjectMap({
    manifest: manifestDevops(), graph, coordinationKey: COORDINATION_KEY,
    repoObservations: new Map<string, RepoObservation>([
      [COORDINATION_KEY, { key: COORDINATION_KEY, source: "coordination", exists: true, isGitRepo: true, git: { branch: "main", head: "a".repeat(40) } }],
      ["web", { key: "web", folder: "/work/shop-web", source: "sibling-folder", exists: true, isGitRepo: true, git: { branch: "main", head: "b".repeat(40), originUrl: DEVOPS_REMOTES.webOrigin } }],
      ["api", { key: "api", folder: "/work/orders-api", source: "sibling-folder", exists: true, isGitRepo: true, git: { branch: "main", head: "c".repeat(40), originUrl: DEVOPS_REMOTES.apiOrigin } }]
    ]),
    fileObservations: new Map<string, FileObservation>([
      [obsKey("web", ""), { state: "found", kind: "dir", count: 3 }],
      [obsKey("web", ".github/workflows/*.{yml,yaml}"), found(2)],
      [obsKey("api", ""), { state: "found", kind: "dir", count: 2 }],
      [obsKey("api", "azure-pipelines.yml"), found()]
    ]),
    tools: new Map(), facts: new Map(), reviewsConfirmed: new Set(), checklist: {}, qualification: []
  });
  const repo = (k: string) => map.repositories.find(r => r.key === k)!;
  assert.equal(repo("api").state, "local", "the SSH clone is the declared https-with-org repository, not a wrong clone");
  assert.equal(repo("web").state, "local");
  assert.equal(repo("data").state, "unbound");
  const comp = (id: string) => map.components.find(c => c.id === id)!;
  assert.equal(comp("web-ci").artifacts?.availability, "complete");
  assert.equal(comp("web-ci").artifacts?.files[0]?.count, 2);
  assert.equal(comp("api-ci").artifacts?.entry?.state, "found");
  assert.equal(comp("data-ci").artifacts?.availability, "unbound");
  for (const id of ["web-ci", "api-ci", "data-ci"]) {
    const runs = comp(id).operations.find(o => o.capability.datapassActionId === "datapass.openCiRuns")!;
    assert.equal(runs.result.status, "ready", `${id}: ${runs.result.nextStep}`);
  }
  assert.deepEqual(map.problems.filter(p => p.severity !== "info"), []);
});
