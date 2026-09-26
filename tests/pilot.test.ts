/**
 * 0.26 pilot stage 1 (AI-4a): the acceptance tests of the decision in
 * handoff/briefs/2026-09-26-ai4-pilot-allowlist.md (1–6; 7 is the desktop flow), request
 * validation (§4.6) and the pilot order format. Synthetic paths only; nothing is run.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { ALLOW, DENY_PREFIXES, allowPatterns, denyPatterns, globMatch, shellRules, subCommands, verdictOf } from "../src/core/pilot/rules";
import { CLAUDE_SETTINGS, CODEX_CONFIG, CODEX_RULES, claudeAbsolute, codexRules, pilotFolderFiles, type PilotFolderInput } from "../src/core/pilot/folder";
import { FORBIDDEN_VALUES, forbiddenArgument, pilotArgs, pilotRefusals, type PilotLaunchCheck } from "../src/core/pilot/profile";
import { MAX_REQUESTS, checkRequest, pilotResponse, PILOT_RESPONSE_SCHEMA, type RequestContext } from "../src/core/pilot/requests";
import { CAPABILITY_INDEX } from "../src/core/capabilities/registry";
import { buildOrder, pilotRequestFormatMd, renderOrderMd, type OrderInput } from "../src/core/workOrders/builder";
import { parseWorkOrder, type WorkOrder } from "../src/core/workOrders/format";
import { validateSchema } from "../src/core/contracts/schemaDsl";

const ROOT = "D:\\PROJ\\foil-pdf";
const ORDERS = `${ROOT}\\.datapass\\local\\work-orders`;
const RANDOM = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const NOW = new Date(2026, 8, 26, 21, 5, 0);

function pilotInput(over: Partial<OrderInput> = {}): OrderInput {
  return {
    now: NOW, random: RANDOM, sessionId: "5f1c2a9e-8d44-4c1b-9b0e-2f6f3c1d7a10", createdBy: "DataPass 0.26.0",
    kind: "pilot-read", title: "Check the dev Function App", goal: "Which functions exist in dev, and did the last runs fail?",
    project: { id: "foil-pdf", title: "FOIL PDF", coordination: "https://github.com/example-org/foil-pdf", type: "dev" },
    scope: { components: ["extract"] },
    known: { subprojects: [], components: ["extract", "store"], cards: [], decisions: [], columns: [] },
    repositories: [
      { ref: "functions", remote: "https://github.com/example-org/pdf-functions", localPath: "D:\\PROJ\\pdf-functions", access: "read" },
      { ref: "coordination", remote: "https://github.com/example-org/foil-pdf", localPath: ROOT, access: "read" }
    ],
    branchPrefix: "dp/",
    context: { datapassFiles: ["project", "graph"], conventions: [], handoffs: [], attachments: ["attachments/result-format.md"] },
    expected: {},
    merge: "person",
    pilot: { environment: "dev", clis: ["az", "func"] },
    agent: { tool: "claude-code", surface: "terminal", effort: "medium", permissions: "ask" },
    folderFor: id => `${ORDERS}\\${id}`, pathJoin: (...p) => path.win32.join(...p),
    ...over
  };
}

const pilotOrder = (over: Partial<OrderInput> = {}): WorkOrder => buildOrder(pilotInput(over));
const folderOf = (o: WorkOrder) => `${ORDERS}\\${o.id}`;
const folderInput = (o: WorkOrder): PilotFolderInput => ({ orderId: o.id, clis: ["az", "func"], readRepositories: o.repositories.map(r => r.localPath) });

// ------------------------------------------------------------------ the order kind

test("pilot-read orders: every repository read, permissions ask, no PR, cloud read-only; parsed back; misuse refused", () => {
  const o = pilotOrder();
  assert.equal(o.kind, "pilot-read");
  assert.equal(o.policy.cloud, "read-only");
  assert.deepEqual(o.pilot, { stage: 1, environment: "dev", clis: ["az", "func"] });
  assert.equal(o.expected.pullRequests, "none");
  assert.ok(o.repositories.every(r => r.access === "read"));
  assert.deepEqual(parseWorkOrder(JSON.stringify(o), o.id), o);
  assert.throws(() => pilotOrder({ agent: { tool: "claude-code", surface: "terminal", effort: "medium", permissions: "usual" } }), /always asks/);
  assert.throws(() => pilotOrder({ pilot: undefined }), /environment and CLIs/);
  assert.throws(() => pilotOrder({ repositories: [{ ref: "functions", localPath: "D:\\PROJ\\pdf-functions", access: "change", base: { branch: "main", commit: "4e1a9c2f0b7d11" } }] }), /only reads/);
  // A pilot section on another kind, or a pilot order edited to change a repository, does not parse.
  assert.throws(() => parseWorkOrder(JSON.stringify({ ...o, kind: "investigate" }), o.id), /pilot section/);
  assert.throws(() => parseWorkOrder(JSON.stringify({ ...o, agent: { ...o.agent, permissions: "usual" } }), o.id), /permissions: ask/);
  assert.throws(() => parseWorkOrder(JSON.stringify({ ...o, policy: { ...o.policy, cloud: "none" } }), o.id), /pilot section/);
});

test("pilot order.md: the order folder is the working folder, read-only rules, requests channel; no worktree or PR rule", () => {
  const o = pilotOrder();
  const md = renderOrderMd(o, { components: [{ id: "extract" }], packs: [], conventions: [], handoffs: [], datapassFiles: [] }, folderOf(o));
  assert.match(md, /## Pilot \(stage 1, read-only\)/);
  assert.match(md, new RegExp(`Your working folder is this order's folder, ${folderOf(o).replace(/\\/g, "\\\\")}`));
  assert.match(md, /requests\\<n>\.json/);
  assert.match(md, /Never use bypass or auto modes/);
  assert.doesNotMatch(md, /worktree|open the pull request/i);
  const fmt = pilotRequestFormatMd(o, { capability: "generic.files.open", component: "extract" });
  const example = JSON.parse(/```json\n([\s\S]+?)\n```/.exec(fmt)![1]!);
  assert.equal(checkRequest(JSON.stringify(example), "1.json", ctx(o)).ok, true, "the example in the format file is itself a valid request");
});

// ------------------------------------------------------------------ 1. snapshot of the guard-rail files

const SNAP = "tests/fixtures/pilot";

test("acceptance 1: the generated .claude/settings.json, config.toml and pilot.rules match the committed snapshot", () => {
  const o = pilotOrder();
  const files = pilotFolderFiles(folderInput(o));
  assert.deepEqual(files.map(f => f.rel), [CLAUDE_SETTINGS, CODEX_CONFIG, CODEX_RULES]);
  if (process.env.UPDATE_PILOT_SNAPSHOT) { mkdirSync(SNAP, { recursive: true }); for (const f of files) writeFileSync(`${SNAP}/${path.basename(f.rel)}`, f.text); }
  for (const f of files) assert.equal(f.text, readFileSync(`${SNAP}/${path.basename(f.rel)}`, "utf8").replace(/\r\n/g, "\n"), `${f.rel} (UPDATE_PILOT_SNAPSHOT=1 after a reviewed change)`);
  const settings = JSON.parse(files[0]!.text);
  const p = settings.permissions;
  assert.equal(p.defaultMode, "default");
  assert.equal(p.disableBypassPermissionsMode, "disable");
  assert.equal(p.disableAutoMode, "disable");
  assert.deepEqual(p.additionalDirectories, ["D:\\PROJ\\pdf-functions", ROOT]);
  for (const r of [...p.allow, ...p.deny].filter((x: string) => x.startsWith("Bash("))) assert.ok([...p.allow, ...p.deny].includes(r.replace(/^Bash\(/, "PowerShell(")), `${r} has its PowerShell mirror`);
  assert.ok(p.allow.includes("Edit(requests/**)") && p.allow.includes("Edit(result.json)"));
  assert.ok(p.deny.includes("Edit(//d/PROJ/pdf-functions/**)") && p.deny.includes("Edit(//d/PROJ/foil-pdf/**)"));
  assert.equal(claudeAbsolute("C:\\Users\\alice\\repo\\"), "//c/Users/alice/repo");
  assert.match(files[1]!.text, /^sandbox_mode = "read-only"$/m);
  assert.match(files[1]!.text, /^approval_policy = "on-request"$/m);
});

// ------------------------------------------------------------------ 2. the table test

const allow = allowPatterns(["az", "func"]);
const deny = denyPatterns(["az", "func"]);

const MUST_DENY = [
  "az group create --name rg-x --location westeurope", "az group delete --name rg-dev --yes", "az group update --name rg --tags a=b",
  "az storage account keys list --account-name stdev", "az storage account show-connection-string --name stdev",
  "az account get-access-token", "az account set --subscription other", "az account clear", "az login", "az logout",
  "az rest --method get --url https://management.azure.com/x", "az storage blob download --container-name pdf --name a.pdf --file a.pdf --auth-mode login",
  "az storage blob upload --container-name pdf --file a.pdf --auth-mode login", "az storage blob delete --container-name pdf --name a.pdf",
  "az storage blob generate-sas --container-name pdf --name a.pdf", "az storage container generate-sas --name pdf", "az storage blob query --query-expression x",
  "az storage blob lease acquire --container-name pdf --blob-name a.pdf", "az storage blob copy start --destination-blob x",
  "az functionapp config appsettings list --name fn-dev --resource-group rg-dev", "az functionapp deployment list-publishing-profiles --name fn-dev",
  "az functionapp keys list --name fn-dev -g rg", "az functionapp function keys list --function-name f --name fn", "az functionapp restart --name fn-dev -g rg",
  "az functionapp stop --name fn-dev -g rg", "az functionapp start --name fn-dev -g rg", "az functionapp deploy --src-path x.zip",
  "az resource delete --ids /subscriptions/x", "az resource invoke-action --action restart --ids x", "az keyvault secret show --vault-name kv --name s",
  "az role assignment create --assignee x --role Owner", "az ad sp create-for-rbac", "az config set core.output=json", "az extension add --name x",
  "func azure functionapp publish fn-dev", "func azure functionapp fetch-app-settings fn-dev", "func azure storage fetch-connection-string stdev",
  "func start", "func new --name x", "func settings list -a", "func settings list --showValue", "func settings add KEY value", "func settings decrypt",
  "func init", "func durable delete-task-hub",
  "az group list && az group delete --name rg-dev --yes", "az account show; az account get-access-token"
];

/** A denied flag on an allowed command: both match, and the deny wins. */
const DENY_WINS = ["az group list --debug", "az monitor app-insights query --app x --analytics-query requests --debug", "func settings list --showValue", "func azure functionapp list-functions fn-dev --show-keys"];

const MUST_ALLOW = [
  "az version", "az account show", "az account list --output table", "az group list", "az group show --name rg-dev",
  "az resource list --resource-group rg-dev", "az functionapp list -g rg-dev", "az functionapp show --name fn-dev -g rg-dev",
  "az functionapp function list --name fn-dev -g rg-dev", "az functionapp config show --name fn-dev -g rg-dev", "az functionapp plan show --name plan -g rg",
  "az storage account list -g rg-dev", "az storage account show --name stdev", "az storage container list --auth-mode login --account-name stdev",
  "az storage blob list --auth-mode login --account-name stdev --container-name pdf", "az monitor app-insights query --app ai-dev --analytics-query requests",
  "az monitor metrics list --resource x", "az monitor activity-log list -g rg-dev", "func --version", "func azure functionapp list-functions fn-dev", "func settings list",
  "az group list && az account show"
];

const MUST_ASK = ["func azure functionapp logstream fn-dev", "az storage blob list --account-name stdev --container-name pdf", "az webapp list", "func settings list --json", "az version --verbose", "python script.py"];

test("acceptance 2: every write/secret command hits a deny and no allow; every allow sample hits no deny; no allow rule has * before its sub-command", () => {
  assert.ok(MUST_DENY.length >= 40, `${MUST_DENY.length} deny samples`);
  for (const c of MUST_DENY) {
    assert.equal(verdictOf(c, allow, deny), "deny", c);
    if (subCommands(c).length === 1) assert.ok(!allow.some(a => globMatch(a, c)), `${c} also matches an allow rule`);
  }
  for (const c of DENY_WINS) assert.equal(verdictOf(c, allow, deny), "deny", c);
  for (const c of MUST_ALLOW) assert.equal(verdictOf(c, allow, deny), "allow", c);
  for (const c of MUST_ASK) assert.equal(verdictOf(c, allow, deny), "ask", c);
  for (const a of allow) assert.ok(!a.slice(0, -2).includes("*"), `${a}: a wildcard only as the trailing " *"`);
  // The rules are written once per shell.
  assert.equal(shellRules(allow).length, allow.length * 2);
});

// ------------------------------------------------------------------ 3. Codex rules carry their own examples

/** Codex prefix semantics: each pattern token equals the command token (or is one of its alternatives). */
function codexMatches(pattern: ReadonlyArray<string | readonly string[]>, command: string): boolean {
  const tokens = command.split(/\s+/);
  return pattern.length <= tokens.length && pattern.every((p, i) => (typeof p === "string" ? p === tokens[i] : p.includes(tokens[i]!)));
}

test("acceptance 3: every Codex rule carries match / not_match examples that hold, and the rules file writes them", () => {
  const o = pilotOrder();
  const rules = codexRules(folderInput(o));
  assert.ok(rules.length > 30);
  for (const r of rules) {
    assert.ok(r.match.length && r.notMatch.length, JSON.stringify(r.pattern));
    for (const m of r.match) assert.ok(codexMatches(r.pattern, m), `${m} should match ${JSON.stringify(r.pattern)}`);
    for (const m of r.notMatch) assert.ok(!codexMatches(r.pattern, m), `${m} should not match ${JSON.stringify(r.pattern)}`);
  }
  const forbidden = rules.filter(r => r.decision === "forbidden");
  for (const c of ["az rest --method get", "az group delete --name x", "az storage account keys list", "func azure functionapp publish fn", "func settings list -a", "az account get-access-token"]) {
    assert.ok(forbidden.some(r => codexMatches(r.pattern, c)), `${c} is forbidden for Codex`);
    assert.ok(!rules.filter(r => r.decision === "allow").some(r => codexMatches(r.pattern, c)) || forbidden.some(r => codexMatches(r.pattern, c)), c);
  }
  const text = pilotFolderFiles(folderInput(o))[2]!.text;
  assert.equal((text.match(/^prefix_rule\(/gm) ?? []).length, rules.length);
  assert.equal((text.match(/^ {4}not_match = \[/gm) ?? []).length, rules.length);
});

// ------------------------------------------------------------------ 4. launch arguments

test("acceptance 4: pilot Claude args carry --permission-mode default and --settings, cwd is the order folder; Codex read-only + on-request; forbidden values never appear", () => {
  const surfaces: Array<[WorkOrder["agent"]["tool"], WorkOrder["agent"]["surface"]]> = [["claude-code", "terminal"], ["claude-code", "desktop"], ["codex", "terminal"], ["codex", "desktop"]];
  for (const [tool, surface] of surfaces) {
    for (const effort of ["low", "max"] as const) {
      for (const model of [undefined, "opus"]) {
        const o = pilotOrder({ agent: { tool, surface, effort, permissions: "ask", ...(model ? { model } : {}) } });
        const folder = folderOf(o);
        const args = pilotArgs(o, `${folder}\\order.md`, folder, (...p) => path.win32.join(...p));
        if (surface === "desktop") { assert.equal(args, undefined); continue; }
        assert.ok(args);
        assert.equal(forbiddenArgument(args), undefined, `${tool}/${surface}`);
        for (const f of FORBIDDEN_VALUES) assert.ok(!args.includes(f));
        if (tool === "claude-code") {
          const i = args.indexOf("--permission-mode");
          assert.equal(args[i + 1], "default");
          assert.equal(args[args.indexOf("--settings") + 1], `${folder}\\.claude\\settings.json`);
          assert.deepEqual(args.filter((_, k) => args[k - 1] === "--add-dir"), ["D:\\PROJ\\pdf-functions", ROOT]);
          assert.match(args.at(-1)!, /^DataPass work order wo-/);
        } else {
          assert.deepEqual(args.slice(0, 6), ["-C", folder, "--sandbox", "read-only", "--ask-for-approval", "on-request"]);
          assert.ok(!args.includes("--add-dir"), "the read-only sandbox reads everything; nothing is made writable");
        }
      }
    }
  }
  assert.equal(forbiddenArgument(["--permission-mode", "bypassPermissions"]), "bypassPermissions");
  assert.equal(forbiddenArgument(["--ask-for-approval=never"]), "never");
  assert.equal(forbiddenArgument(["--dangerously-skip-permissions"]), "--dangerously-skip-permissions");
});

// ------------------------------------------------------------------ 5. one refusal per rule

test("acceptance 5: each refusal rule refuses with its message", () => {
  const o = pilotOrder();
  const ok: PilotLaunchCheck = { order: o, enabled: true, trusted: true, codexAppQualified: false, guardRailsMatch: true, args: ["--permission-mode", "default"], environments: [{ id: "dev" }, { id: "prod", production: true }] };
  assert.deepEqual(pilotRefusals(ok), []);
  const cases: Array<[string, Partial<PilotLaunchCheck>, RegExp]> = [
    ["environment", { order: { ...o, pilot: { ...o.pilot!, environment: "prod" } } }, /dev only, not on "prod"/],
    ["repositories", { order: { ...o, repositories: [{ ...o.repositories[0]!, access: "change" }] } }, /only reads repositories/],
    ["pull-requests", { order: { ...o, expected: { ...o.expected, pullRequests: "one-per-changed-repository" } } }, /no pull request/],
    ["permissions", { order: { ...o, agent: { ...o.agent, permissions: "usual" } } }, /always asks/],
    ["codex-app", { order: { ...o, agent: { tool: "codex", surface: "desktop", effort: "medium", permissions: "ask" } } }, /Codex app is not qualified/],
    ["clis", { order: { ...o, pilot: { ...o.pilot!, clis: ["az", "fab"] } } }, /az and func only, not fab/],
    ["setting", { enabled: false }, /datapass\.pilot\.enabled/],
    ["trust", { trusted: false }, /Restricted Mode/],
    ["guard-rails", { guardRailsMatch: false }, /differ from what DataPass wrote/],
    ["arguments", { args: ["--permission-mode", "auto"] }, /"auto": never/],
    ["kind", { order: { ...o, kind: "investigate", pilot: undefined } }, /not a pilot order/]
  ];
  for (const [rule, over, message] of cases) {
    const r = pilotRefusals({ ...ok, ...over });
    assert.deepEqual(r.map(x => x.rule), [rule], rule);
    assert.match(r[0]!.message, message, rule);
  }
  // The Codex app is accepted once this machine passed its qualification.
  assert.deepEqual(pilotRefusals({ ...ok, codexAppQualified: true, order: { ...o, agent: { tool: "codex", surface: "desktop", effort: "medium", permissions: "ask" } } }), []);
  // A production environment named dev is still refused.
  assert.deepEqual(pilotRefusals({ ...ok, environments: [{ id: "dev", production: true }] }).map(x => x.rule), ["environment"]);
});

// ------------------------------------------------------------------ 6. the lists stay code

test("acceptance 6: the pilot module imports nothing from the toolkit or hub reader", () => {
  for (const f of readdirSync("src/core/pilot")) {
    const text = readFileSync(`src/core/pilot/${f}`, "utf8");
    const imports = [...text.matchAll(/from "([^"]+)"/g)].map(m => m[1]!);
    for (const i of imports) assert.doesNotMatch(i, /toolkit|hub|companion|catalog|galaxy/i, `${f} imports ${i}`);
  }
  assert.ok(existsSync("src/core/pilot/rules.ts"));
  // Allow rules stay az/func only in stage 1.
  assert.deepEqual([...new Set(ALLOW.map(a => a.cli))].sort(), ["az", "func"]);
  assert.ok(DENY_PREFIXES.az.includes("rest"));
});

// ------------------------------------------------------------------ requests (§4.6)

function ctx(o: WorkOrder, over: Partial<RequestContext> = {}): RequestContext {
  return { order: o, capabilities: CAPABILITY_INDEX, components: ["extract", "store"], environments: [{ id: "dev" }, { id: "prod", production: true }], numbers: [1], earlier: [], answered: [], ...over };
}
const req = (o: WorkOrder, n: number, action: Record<string, string> = {}, extra: Record<string, unknown> = {}) => JSON.stringify({
  format: "datapass.pilot-request", version: "1", orderId: o.id, receipt: o.receipt, n,
  action: { capability: "generic.files.open", component: "store", environment: "dev", ...action }, why: "See which containers exist.", ...extra
});

test("pilot requests: a good one is accepted; wrong phase, prod, duplicate, 51st, oversize, unknown capability and others are refused", () => {
  const o = pilotOrder();
  const good = checkRequest(req(o, 1), "1.json", ctx(o));
  assert.ok(good.ok);
  assert.equal(good.ok && good.capability.id, "generic.files.open");
  assert.ok(checkRequest(req(o, 1, { capability: "fabric.workspace.capture-summary" }), "1.json", ctx(o)).ok);
  const why = (raw: string, name: string, c: RequestContext = ctx(o)) => { const v = checkRequest(raw, name, c); return v.ok ? "ok" : v.why; };
  assert.equal(why(req(o, 1, { capability: "azure-functions.deploy" }), "1.json"), "not-read");
  assert.equal(why(req(o, 1, { capability: "infra.tofu.plan" }), "1.json"), "not-read");
  assert.equal(why(req(o, 1, { capability: "azure-storage.browse" }), "1.json"), "action-mode");
  assert.equal(why(req(o, 1, { capability: "diagram.diagramcloud.export" }), "1.json"), "side-effects");
  assert.equal(why(req(o, 1, { capability: "powerbi.project.open-desktop" }), "1.json"), "not-implemented");
  assert.equal(why(req(o, 1, { environment: "prod" }), "1.json"), "environment");
  assert.equal(why(req(o, 1, { environment: "staging" }), "1.json"), "environment");
  assert.equal(why(req(o, 2), "2.json", ctx(o, { numbers: [1, 2], earlier: [JSON.parse(req(o, 1))] })), "duplicate");
  assert.equal(why(req(o, 1), "1.json", ctx(o, { answered: [1] })), "duplicate");
  assert.equal(why(req(o, MAX_REQUESTS + 1), "51.json"), "too-many");
  assert.equal(why(req(o, 1, {}, { why: "x".repeat(1000), pad: "y".repeat(4000) }), "1.json"), "oversize");
  assert.equal(why(req(o, 1, { capability: "azure.nothing" }), "1.json"), "unknown-capability");
  assert.equal(why(req(o, 1, { component: "nope" }), "1.json"), "component");
  assert.equal(why(req(o, 3), "3.json", ctx(o, { numbers: [1, 3] })), "gap");
  assert.equal(why(req(o, 2), "1.json"), "number");
  assert.equal(why(req(o, 1), "first.json"), "number");
  assert.equal(why(req(o, 1, {}, { extra: 1 }), "1.json"), "invalid");
  assert.equal(why(req(o, 1).replace(o.receipt, "ZZZZ-ZZZZ"), "1.json"), "other-order");
  assert.equal(why("{", "1.json"), "invalid");
  // Remote shells are phase read but not a read-only action DataPass runs.
  const ssh = CAPABILITY_INDEX.get("infra.remote.ssh")!;
  assert.equal(ssh.phase, "read");
  assert.equal(why(req(o, 1, { capability: "infra.remote.ssh" }), "1.json"), "excluded");
});

test("pilot responses: names and states only, schema-valid, bounded", () => {
  const o = pilotOrder();
  const r = pilotResponse(o, 2, "done", `Azure Storage opened\nfor store${"x".repeat(900)}`, "2026-09-26T21:10:00+02:00");
  assert.deepEqual(validateSchema(PILOT_RESPONSE_SCHEMA, r), []);
  assert.equal(r.what.length, 500);
  assert.doesNotMatch(r.what, /\n/);
});
