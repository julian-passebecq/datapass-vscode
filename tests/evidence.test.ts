/**
 * D-22 integration evidence chain and receipts: every link unknown by default, nothing inferred
 * from another link, a registration file is not a connection, no credential file read, and a
 * result's checks stay "asserted, not verified" until they name tool, scope and input.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { buildChain, chainSummary, LINKS, observed, unknown } from "../src/core/evidence/chain";
import { buildIntegrationEvidence, KNOWN_MCP_SERVERS } from "../src/core/evidence/integrations";
import { mcpServerNames } from "../src/core/evidence/registration";
import { isReceipt, resultFields } from "../src/core/evidence/receipts";
import { fabricToolboxMcpDefinition } from "../src/core/mcp";
import type { ToolObservation } from "../src/core/capabilities/tools";
import type { ConnectionProbe } from "../src/core/toolchain/connections";
import { buildOrder, type OrderInput } from "../src/core/workOrders/builder";
import { checkResult, initialState, type WorkOrder } from "../src/core/workOrders/format";
import { summarize } from "../src/core/workOrders/status";

const AT = "2026-09-26T10:00:00.000Z";
const probe = (toolId: string, state: ToolObservation["state"], extra: Partial<ToolObservation> = {}): [string, ToolObservation] => [toolId, { toolId, state, observedAt: AT, ...extra }];
const link = (e: { chain: ReturnType<typeof buildChain> }, id: string) => e.chain.find(l => l.link === id)!;

// ------------------------------------------------------------------ chain

test("chain: every link defaults to unknown, with a reason", () => {
  const chain = buildChain();
  assert.deepEqual(chain.map(l => l.link), [...LINKS]);
  for (const l of chain) {
    assert.equal(l.state, "unknown");
    assert.ok(l.state === "unknown" && l.reason.length > 0);
  }
  assert.equal(chainSummary(chain), "installed unknown");
});

test("chain: an installed tool with no host registration is \"installed / not registered\", never connected", () => {
  const chain = buildChain({
    known: observed("known", true, "registry"),
    installed: observed("installed", true, "probe", AT),
    registered: observed("registered", false, ".vscode/mcp.json", AT)
  });
  assert.equal(chainSummary(chain), "installed / not registered");
  assert.equal(chain.find(l => l.link === "connected")!.state, "unknown");
});

test("chain: nothing is inferred from a later link either", () => {
  // Signed in observed, but installed never observed: the summary stops at installed.
  const chain = buildChain({ authenticated: observed("authenticated", true, "az account show", AT) });
  assert.equal(chainSummary(chain), "installed unknown");
  assert.equal(chain.find(l => l.link === "installed")!.state, "unknown");
  // A link passed under the wrong key is ignored.
  assert.equal(buildChain({ connected: unknown("registered", "x") as never }).find(l => l.link === "connected")!.state, "unknown");
});

// ------------------------------------------------------------------ integrations

test("integrations: with no observation, az and the Fabric MCP server are unknown past \"known\"", () => {
  const list = buildIntegrationEvidence({});
  const az = list.find(e => e.id === "cli.az")!;
  assert.equal(link(az, "known").state, "observed");
  for (const id of ["installed", "authenticated", "authorized", "verified"]) assert.equal(link(az, id).state, "unknown", id);
  assert.equal(link(az, "registered").state, "not-applicable");
  const fabric = list.find(e => e.id === "mcp.fabric-management")!;
  for (const id of ["installed", "registered", "connected", "authenticated", "authorized", "verified"]) assert.equal(link(fabric, id).state, "unknown", id);
});

test("integrations: a registration file present is not a connection", () => {
  const tools = new Map([probe("ws.mcp", "present", { entries: ["fabric-mgmt", "my-own"] })]);
  const list = buildIntegrationEvidence({ tools });
  const fabric = list.find(e => e.id === "mcp.fabric-management")!;
  const reg = link(fabric, "registered");
  assert.ok(reg.state === "observed" && reg.holds && reg.source === ".vscode/mcp.json" && reg.at === AT);
  assert.equal(link(fabric, "connected").state, "unknown");
  assert.equal(link(fabric, "authenticated").state, "unknown");
  assert.doesNotMatch(fabric.summary, /connected(?! unknown)/);
  const other = list.find(e => e.id === "mcp:my-own")!;
  assert.ok(other, "a server only the workspace names is listed");
  assert.match(other.summary, /not in DataPass's registry/);
  // The semantic model server is not in the file: observed not registered.
  const sm = list.find(e => e.id === "mcp.semantic-model")!;
  assert.ok(link(sm, "registered").state === "observed" && !(link(sm, "registered") as { holds: boolean }).holds);
  // A file DataPass could not read leaves the link unknown, never "not registered".
  const unreadable = buildIntegrationEvidence({ tools: new Map([probe("ws.mcp", "present")]) });
  assert.equal(link(unreadable.find(e => e.id === "mcp.fabric-management")!, "registered").state, "unknown");
});

test("integrations: the Power BI Modeling extension installed shows installed / registration unknown", () => {
  const list = buildIntegrationEvidence({ tools: new Map([probe("ext.powerbi-modeling-mcp", "present", { via: "analysis-services.powerbi-modeling-mcp", version: "1.2.0" })]) });
  const pbi = list.find(e => e.id === "mcp.powerbi-modeling")!;
  assert.equal(pbi.summary, "installed / registered in a host unknown");
});

test("integrations: az signed in is observed from the read-only check; authorized stays unknown", () => {
  const probes = new Map<string, ConnectionProbe>([["cli.az", { tool: "cli.az", ranAt: AT, outcome: "ok", signedIn: true, tenantId: "00000000-0000-0000-0000-000000000001" }]]);
  const az = buildIntegrationEvidence({ tools: new Map([probe("cli.az", "present", { via: "az", version: "2.70.0" })]), connectionProbes: probes }).find(e => e.id === "cli.az")!;
  const auth = link(az, "authenticated");
  assert.ok(auth.state === "observed" && auth.holds && auth.source === "az account show" && auth.at === AT);
  assert.equal(link(az, "authorized").state, "unknown");
  assert.equal(az.summary, "signed in / authorized on the target unknown");
  assert.ok(!JSON.stringify(az).includes("00000000-0000-0000-0000-000000000001"), "no tenant id in the evidence");
  const out = buildIntegrationEvidence({ tools: new Map([probe("cli.az", "present")]), connectionProbes: new Map([["cli.az", { tool: "cli.az", ranAt: AT, outcome: "ok", signedIn: false }]]) }).find(e => e.id === "cli.az")!;
  assert.equal(out.summary, "installed / not signed in");
});

test("integrations: known MCP server names match what \"Add to MCP\" writes", () => {
  for (const s of KNOWN_MCP_SERVERS.filter(x => x.serverName)) {
    const itemId = { "mcp.fabric-management": "fabric-management-mcp", "mcp.semantic-model": "semantic-model-mcp", "mcp.dax-performance": "dax-performance-mcp" }[s.id]!;
    assert.equal(fabricToolboxMcpDefinition(itemId, "/toolbox", "win32").serverName, s.serverName);
  }
});

test("registration: only server names are read; a non-JSON file gives undefined", () => {
  const text = JSON.stringify({ servers: { "fabric-mgmt": { command: "python", env: { TOKEN: "dpfake-token-1" } }, remote: { url: "https://example.test/mcp", headers: { Authorization: "Bearer dpfake" } } }, inputs: [] });
  assert.deepEqual(mcpServerNames(text), ["fabric-mgmt", "remote"]);
  assert.equal(mcpServerNames("{ // comment\n \"servers\": {} }"), undefined);
  assert.deepEqual(mcpServerNames("{}"), []);
});

test("no credential file is read: src/core/evidence imports no fs and names no credential path", () => {
  const dir = path.join(__dirname, "..", "src", "core", "evidence");
  const files = readdirSync(dir).filter(f => f.endsWith(".ts"));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /from\s+["'](?:node:)?(?:fs|fs\/promises|os|child_process)["']/, `${f} imports fs/os/child_process`);
    assert.doesNotMatch(src, /from\s+["']vscode["']/, `${f} imports vscode`);
    assert.doesNotMatch(src, /homedir|USERPROFILE|process\.env/, `${f} reaches the home folder`);
    // Code only: the header comments name these paths to say they are never read.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\.azure|\.databrickscfg|msal_token_cache|accessTokens\.json|\.config\/fabric|\.fab\b/i, `${f} names a credential path`);
  }
});

// ------------------------------------------------------------------ receipts

const NOW = new Date(2026, 8, 26, 10, 0, 0);
const SHA = "4e1a9c2f0b7d11223344556677889900aabbccdd";
function order(): WorkOrder {
  const input: OrderInput = {
    now: NOW, random: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), sessionId: "5f1c2a9e-8d44-4c1b-9b0e-2f6f3c1d7a10", createdBy: "DataPass test",
    kind: "change", title: "Batch long PDFs", goal: "Split long PDFs into page batches.",
    project: { id: "doc-pipeline", title: "Doc pipeline", coordination: "https://github.com/example-org/doc-pipeline", type: "dev" },
    scope: {}, known: { subprojects: [], components: [], cards: [], decisions: [], columns: [] },
    repositories: [{ ref: "pipeline", remote: "https://github.com/example-org/doc-pipeline", localPath: "D:\\PROJ\\doc-pipeline", access: "change", base: { branch: "main", commit: SHA } }],
    branchPrefix: "dp/", context: { datapassFiles: ["project"], conventions: [], handoffs: [], attachments: [] },
    expected: { datapassFiles: [], boardMoves: [], checks: [], doneWhen: ["tests pass"] }, merge: "person",
    agent: { tool: "claude-code", surface: "terminal", effort: "medium", permissions: "usual" },
    folderFor: id => `D:\\wo\\${id}`, pathJoin: (...p) => path.win32.join(...p)
  };
  return buildOrder(input);
}
const resultJson = (o: WorkOrder, checks: unknown[]) => JSON.stringify({ format: "datapass.work-order-result", version: "1", orderId: o.id, receipt: o.receipt, status: "done", summary: "Done.", checks });

test("receipts: an agent's \"I tested it\" alone is asserted, not verified", () => {
  const o = order();
  const v = checkResult(resultJson(o, [{ what: "I tested it", outcome: "passed", field: "runtime" }]), o);
  assert.ok(v.ok, JSON.stringify(v));
  const s = summarize({ order: o, state: initialState(o, `sha256:${"c".repeat(64)}`), result: { state: "valid", checked: v.checked }, outputs: [], now: NOW.getTime() });
  const runtime = s.resultFields.find(f => f.field === "runtime")!;
  assert.equal(runtime.state, "asserted");
  assert.match(runtime.text, /asserted, not verified/);
  assert.ok(s.timeline.some(t => t.detail?.some(d => d.includes("I tested it") && d.includes("asserted, not verified"))));
  for (const f of ["cli-exit", "ci", "deployed", "scientific-validity"]) assert.equal(s.resultFields.find(x => x.field === f)!.state, "unknown", f);
});

test("receipts: a check naming tool, scope, input and outcome is the agent's receipt; fields stay separate", () => {
  const o = order();
  const checks = [
    { what: "pytest", outcome: "passed", field: "cli-exit", tool: "pytest", scope: "pipeline/functions", input: `commit ${SHA.slice(0, 12)}` },
    { what: "deployed", outcome: "passed", field: "deployed", tool: "func", scope: "dev function app" }
  ];
  const v = checkResult(resultJson(o, checks), o);
  assert.ok(v.ok, JSON.stringify(v));
  const fields = resultFields(v.checked.result.checks);
  assert.equal(fields.find(f => f.field === "cli-exit")!.state, "receipted");
  assert.equal(fields.find(f => f.field === "deployed")!.state, "asserted", "no input identity: not a receipt");
  assert.equal(fields.find(f => f.field === "ci")!.state, "unknown", "CLI exit is not CI");
  assert.equal(fields.find(f => f.field === "scientific-validity")!.state, "unknown");
  assert.ok(isReceipt(checks[0] as never) && !isReceipt(checks[1] as never));
  // CI read from the host is observed, and wins over the agent's word.
  assert.equal(resultFields([{ what: "ci", outcome: "passed", field: "ci" }], { passing: 0, failing: 1, running: 0, unknown: 0 }).find(f => f.field === "ci")!.state, "observed");
});

test("receipts: old results (checks without the new fields) still load; unknown fields are still refused", () => {
  const o = order();
  const old = checkResult(resultJson(o, [{ what: "pytest -q", outcome: "passed", note: "12 tests" }]), o);
  assert.ok(old.ok, JSON.stringify(old));
  assert.equal(resultFields(old.ok ? old.checked.result.checks : undefined).every(f => f.state === "unknown"), true);
  assert.equal(checkResult(resultJson(o, [{ what: "x", outcome: "passed", verifiedBy: "me" }]), o).ok, false);
  assert.equal(checkResult(resultJson(o, [{ what: "x", outcome: "passed", field: "vibes" }]), o).ok, false);
});
