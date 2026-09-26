/**
 * 0.24 (pass AI-3): the Claude Control client against a fake server on 127.0.0.1 (on, off, slow,
 * bad JSON, too large, unknown project, hostile payloads), the quick-link URL policy, a work order's
 * conversation (exact session, /desktop, marker), the Claude & Codex panel state, and the Codex
 * hand-off arguments (paths with spaces, .cmd shims, `codex app <folder>`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  ControlClient, controlBase, getJson, matchProjectNames, orderConversation, orderConversationLink, parseQuickLinks, parseWorkOrders, quickLinkAllowed,
  safePrLink, text, tokenText, DEFAULT_QUICK_LINKS, MAX_RESPONSE_BYTES, type OrderConversation
} from "../src/work/controlClient";
import { agentPanelState, linkOfKey, OFF_MESSAGE } from "../src/views/agentPanelState";
import type { ControlSnapshot } from "../src/work/controlService";
import { agentCmdLine, codexAppArgs, codexArgs } from "../src/core/workOrders/launch";
import { markerLine, type WorkOrder } from "../src/core/workOrders/format";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
async function fakeControl(handler: Handler): Promise<{ base: string; close: () => Promise<void>; hits: string[] }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(`${req.headers.host} ${req.url}`); handler(req, res); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, hits, close: () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); }) };
}
const json = (res: http.ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

const SESSION = {
  id: "local_abc-123", link: "claude://claude.ai/epitaxy/local_abc-123", title: "Fix bug-12 timeouts (k3f9)", tool: "claude", surface: "desktop",
  cli_id: "5f1c2a9e-8d44-4c1b-9b0e-2f6f3c1d7a10", status: "needs-you", archived: false, effort: "high", model: "claude-opus-5-5", created: "2026-09-25T18:31", last: "2026-09-25T18:52",
  prs: [{ n: 41, state: "OPEN", url: "https://github.com/me/research-pipeline/pull/41", repo: "me/research-pipeline" }], tokens: 1_830_000, worktree: true,
  // Never kept:
  task: "SECRET TASK TEXT", last_user: "private words", last_claude: "private answer", agents: { x: 1 }, mode: "bypassPermissions"
};
const PROJECT = {
  project: "research-library", info: { instructions: "PRIVATE INSTRUCTIONS", memories: ["m"] },
  todo: { "À faire par toi": [{ Date: "2026-09-25", Projet: "research-library", "À faire": "Allow auto-merge on research-pipeline", Durée: "1 min", _p: ["research-library"] }], "À vérifier": [{ "À vérifier": "x" }] },
  prs: [{ number: 12, title: "wo-k3f9", url: "https://github.com/me/research-library/pull/12", project: "research-library" }, { number: 13, url: "javascript:alert(1)" }],
  sessions: [SESSION, { ...SESSION, id: "local_idle", status: "idle" }, { ...SESSION, id: "local_run", status: "running", link: "https://evil.example/x", title: "Fill the sheet\u202e volumes\n" }],
  alerts: [{ level: "urgent", text: "merge: PR #44 is green and not merged", time: "2026-09-26T12:45", link: "file:///C:/Windows/system32/calc.exe" }, { level: "info", text: "fyi" }]
};

test("control: only loopback http addresses are accepted, before any request", async () => {
  assert.equal(controlBase(undefined), "http://127.0.0.1:7430");
  assert.equal(controlBase("http://localhost:7430/"), "http://localhost:7430");
  for (const bad of ["https://127.0.0.1:7430", "http://127.0.0.2:7430", "http://[::1]:7430", "http://example.com:7430", "http://127.0.0.1.evil.com:80", "http://127.0.0.1", "http://127.0.0.1:99999", "file:///x"]) {
    assert.equal(controlBase(bad), undefined, bad);
  }
  const r = await getJson("http://example.com:80", "/api/health");
  assert.deepEqual(r.ok ? "fetched" : r.reason, "bad-url");
});

test("control: on — health, plan, a known project with allowlisted fields only, work orders", async () => {
  const srv = await fakeControl((req, res) => {
    if (req.url === "/api/health") return json(res, { ok: true, time: "2026-09-26T12:48:43" });
    if (req.url === "/api/status") return json(res, { plan: { five_hour: 42.4, week: 61, sampled: "2026-09-26T12:40" }, sessions: { open: 3 } });
    if (req.url === "/api/project/research-library") return json(res, PROJECT);
    if (req.url?.startsWith("/api/work-orders?ids=")) return json(res, { generated: {}, orders: { "wo-20260925-1830-k3f9": [{ ...SESSION, work_order: "wo-20260925-1830-k3f9" }], "wo-20260101-0000-zzzz": [{ id: "x" }] } });
    json(res, { error: "?" }, 404);
  });
  try {
    const c = new ControlClient(srv.base);
    assert.deepEqual(await c.health(), { ok: true, data: true });
    const plan = await c.plan();
    assert.ok(plan.ok);
    assert.deepEqual(plan.data, { fiveHour: 42, week: 61, sampled: "2026-09-26T12:40" });
    const p = await c.project("research-library");
    assert.ok(p.ok && p.data.project);
    const proj = p.data.project;
    const dump = JSON.stringify(proj);
    for (const never of ["SECRET TASK TEXT", "private words", "private answer", "bypassPermissions", "PRIVATE INSTRUCTIONS", "À vérifier", "javascript:", "evil.example", "calc.exe"]) assert.ok(!dump.includes(never), never);
    assert.deepEqual(Object.keys(proj.sessions[0]!).sort(), ["created", "effort", "id", "last", "link", "model", "prs", "status", "title", "tokens", "worktree"]);
    assert.equal(proj.sessions[2]!.link, undefined, "a link outside claude://claude.ai/epitaxy/ is dropped");
    assert.equal(proj.sessions[2]!.title, "Fill the sheet volumes", "bidi and control characters are flattened");
    assert.deepEqual(proj.todo, [{ date: "2026-09-25", what: "Allow auto-merge on research-pipeline", duration: "1 min" }]);
    assert.deepEqual(proj.prs.map(x => [x.n, x.url]), [[12, "https://github.com/me/research-library/pull/12"], [13, undefined]], "an unsafe PR address is dropped, the number stays");
    assert.equal(proj.alerts[0]!.link, undefined);
    const wo = await c.workOrders(["wo-20260925-1830-k3f9", "not-an-id", "wo-20260925-1830-k3f9"]);
    assert.ok(wo.ok);
    assert.deepEqual([...wo.data.keys()], ["wo-20260925-1830-k3f9"], "only asked, valid ids");
    assert.equal(wo.data.get("wo-20260925-1830-k3f9")![0]!.cliId, SESSION.cli_id);
    assert.ok(srv.hits.some(h => h.endsWith("/api/work-orders?ids=wo-20260925-1830-k3f9")));
    assert.ok(srv.hits.every(h => h.startsWith("127.0.0.1:")), "the Host header is the loopback address Control accepts");
    // No id: no request at all.
    const before = srv.hits.length;
    assert.deepEqual(await c.workOrders(["../etc"]), { ok: true, data: new Map() });
    assert.equal(srv.hits.length, before);
  } finally { await srv.close(); }
});

test("control: unknown project returns Control's names; matching is case-insensitive", async () => {
  const srv = await fakeControl((_req, res) => json(res, { error: "unknown project", projects: ["Research-Library", "datapass-vscode", 42] }));
  try {
    const r = await new ControlClient(srv.base).project("research-library");
    assert.ok(r.ok);
    assert.deepEqual(r.data, { known: ["Research-Library", "datapass-vscode"] });
    assert.deepEqual(matchProjectNames(["research-library", "research-lab"], r.data.known), ["Research-Library"]);
    assert.deepEqual(matchProjectNames(["a", "a", "b"], undefined), ["a", "b"]);
    const bad = await new ControlClient(srv.base).project("../../x");
    assert.equal(bad.ok, false);
  } finally { await srv.close(); }
});

test("control: off, slow, bad JSON, too large, HTTP error and an impostor on the port all degrade cleanly", async () => {
  // Off: a port nobody listens on.
  const tmp = await fakeControl((_q, r) => json(r, {}));
  const closed = tmp.base;
  await tmp.close();
  const off = await new ControlClient(closed).health();
  assert.equal(off.ok ? "on" : off.reason, "off");

  const slow = await fakeControl(() => { /* never answers */ });
  try {
    const t0 = Date.now();
    const r = await getJson(slow.base, "/api/health", 150);
    assert.equal(r.ok ? "on" : r.reason, "timeout");
    assert.ok(Date.now() - t0 < 2000);
  } finally { await slow.close(); }

  const garbage = await fakeControl((req, res) => {
    if (req.url === "/api/health") { res.writeHead(200); res.end("<html>not json"); return; }
    if (req.url === "/api/status") { res.writeHead(200); res.end("x".repeat(MAX_RESPONSE_BYTES + 10)); return; }
    json(res, { error: "boom" }, 500);
  });
  try {
    const c = new ControlClient(garbage.base);
    const h = await c.health();
    assert.equal(h.ok ? "on" : h.reason, "bad-json");
    const big = await c.plan();
    assert.equal(big.ok ? "on" : big.reason, "too-big");
    const e = await c.project("x");
    assert.equal(e.ok ? "on" : e.reason, "http");
  } finally { await garbage.close(); }

  const impostor = await fakeControl((_q, r) => json(r, { ok: "yes" }));
  try {
    const h = await new ControlClient(impostor.base).health();
    assert.equal(h.ok, false, "something answering on the port is not Control unless it says ok: true");
  } finally { await impostor.close(); }
});

test("control: hostile work-order payloads keep only typed fields", () => {
  const rows = parseWorkOrders({ orders: { "wo-20260925-1830-k3f9": [{ tool: "rm -rf", surface: "shell", id: "a b", cli_id: "<x>", link: "claude://claude.ai/epitaxy/../../x", status: "pwned", tokens: -5, prs: [{ n: 1, url: "https://github.com/a/b/pull/1" }, "x"] }] } }, ["wo-20260925-1830-k3f9"]);
  assert.deepEqual(rows.get("wo-20260925-1830-k3f9"), [{ tool: "claude", surface: "desktop", id: undefined, cliId: undefined, link: undefined, status: "other", created: undefined, last: undefined, tokens: undefined, prs: [{ n: 1, state: undefined, url: "https://github.com/a/b/pull/1", repo: undefined, title: undefined }] }]);
  assert.equal(safePrLink("https://github.com/a/../../b"), undefined);
  assert.equal(safePrLink("https://github.com.evil.com/a/b/pull/1"), undefined);
  assert.equal(safePrLink("https://dev.azure.com/org/p/_git/r/pullrequest/7"), "https://dev.azure.com/org/p/_git/r/pullrequest/7");
  assert.equal(text("a".repeat(500), 10), "aaaaaaaaa…");
  assert.equal(text({}), undefined);
});

test("control: quick links allow https, claude: and loopback http only", () => {
  for (const ok of ["https://chatgpt.com/", "https://claude.ai/code", "claude://code/new", "http://127.0.0.1:7430/", "http://localhost:3100/x"]) assert.ok(quickLinkAllowed(ok), ok);
  for (const bad of ["http://chatgpt.com/", "javascript:alert(1)", "file:///C:/x", "vscode://x", "command:workbench.action.terminal.new", "http://127.0.0.1.evil.com/", "https://a b", "data:text/html,x", "claude://x\"y"]) assert.ok(!quickLinkAllowed(bad), bad);
  assert.deepEqual(parseQuickLinks(undefined).links, [...DEFAULT_QUICK_LINKS]);
  assert.ok(DEFAULT_QUICK_LINKS.every(l => quickLinkAllowed(l.url)));
  const p = parseQuickLinks([{ label: "Mine", url: "https://example.org" }, { label: "Bad", url: "javascript:x" }, { url: "https://x" }, "junk"]);
  assert.deepEqual(p.links, [{ label: "Mine", url: "https://example.org" }]);
  assert.equal(p.refused.length, 3);
  assert.match(parseQuickLinks("x").refused[0]!, /list/);
  assert.equal(parseQuickLinks(Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, url: "https://x.org" }))).links.length, 12);
});

test("control: a work order's conversation — exact session, moved with /desktop, or found by the marker", () => {
  const sid = "5f1c2a9e-8d44-4c1b-9b0e-2f6f3c1d7a10";
  const term: OrderConversation = { tool: "claude", surface: "terminal", id: sid, cliId: sid, status: "idle", tokens: 900_000, prs: [], last: "2026-09-25T18:40" };
  const app: OrderConversation = { tool: "claude", surface: "desktop", id: "local_x", cliId: sid, link: "claude://claude.ai/epitaxy/local_x", status: "running", tokens: 1_830_000, prs: [], last: "2026-09-25T18:52" };
  const other: OrderConversation = { tool: "codex", surface: "desktop", id: "codex-1", status: "needs-you", prs: [], last: "2026-09-25T19:00" };
  assert.equal(orderConversation({ tool: "claude-code", surface: "terminal", sessionId: sid }, []), undefined);
  const moved = orderConversation({ tool: "claude-code", surface: "terminal", sessionId: sid }, [other, app, term])!;
  assert.equal(moved.linked, "desktop");
  assert.equal(moved.tokens, "1.8 M");
  assert.equal(moved.openable, true);
  assert.equal(moved.others, 2);
  assert.match(moved.text, /running · Claude app · moved to the app with \/desktop/);
  assert.equal(orderConversation({ tool: "claude-code", surface: "terminal", sessionId: sid }, [term])!.linked, "session-id");
  const marker = orderConversation({ tool: "codex", surface: "desktop" }, [other])!;
  assert.equal(marker.linked, "marker");
  assert.match(marker.text, /needs you · Codex app · found by the marker line/);
  assert.equal(orderConversationLink({ sessionId: sid }, [other, app]), app.link);
  assert.deepEqual([tokenText(undefined), tokenText(640_400), tokenText(12_500_000), tokenText(12)], [undefined, "640 k", "13 M", "12"]);
});

test("control: the panel says Control is off, lists only live conversations, and keeps links out of the webview", () => {
  const empty: ControlSnapshot = { state: "off", detail: "Claude Control is not running.", projects: [], tried: ["research-library"], orders: new Map(), checkedAt: "2026-09-26T10:40:00.000Z" };
  const off = agentPanelState(empty, DEFAULT_QUICK_LINKS, [], false, true);
  assert.equal(off.control.message, OFF_MESSAGE);
  assert.deepEqual(off.projects, []);
  assert.equal(off.links.length, 5);
  assert.ok(!JSON.stringify(off.links).includes("\"url\""), "the webview gets labels and indexes, not URLs to follow");

  const project = { name: "research-library", sessions: [
    { id: "a", link: "claude://claude.ai/epitaxy/a", title: "Needs", status: "needs-you" as const, prs: [], tokens: 5000 },
    { id: "b", title: "Idle", status: "idle" as const, prs: [] },
    { id: "c", link: "claude://claude.ai/epitaxy/c", title: "Run", status: "running" as const, prs: [] }
  ], prs: [{ n: 41, url: "https://github.com/me/p/pull/41", repo: "me/p", title: "Fix" }], todo: [{ what: "Do it", duration: "1 min" }], alerts: [{ level: "urgent" as const, text: "red", link: "https://github.com/me/p/pull/41" }, { level: "info" as const, text: "fyi" }] };
  const snap: ControlSnapshot = { state: "on", plan: { fiveHour: 42, week: 61 }, projects: [project], tried: ["research-library"], orders: new Map(), checkedAt: "2026-09-26T10:40:00.000Z" };
  const on = agentPanelState(snap, DEFAULT_QUICK_LINKS, [], true, true);
  assert.deepEqual(on.plan, { fiveHour: 42, week: 61 });
  assert.deepEqual(on.projects[0]!.conversations.map(c => c.title), ["Needs", "Run"], "needs you first; idle hidden");
  assert.equal(on.projects[0]!.alerts.length, 1, "urgent alerts only");
  assert.equal(on.codex.cli, true);
  assert.equal(linkOfKey(snap, on.projects[0]!.conversations[0]!.key), "claude://claude.ai/epitaxy/a");
  assert.equal(linkOfKey(snap, on.projects[0]!.prs[0]!.key), "https://github.com/me/p/pull/41");
  assert.equal(linkOfKey(snap, "c:other:a"), undefined);
  assert.equal(linkOfKey(snap, "x:research-library:0"), undefined);
  assert.equal(linkOfKey(snap, { key: 1 }), undefined);
  const disabled = agentPanelState({ ...empty, state: "disabled" }, [], [], false, false);
  assert.match(disabled.control.message!, /switched off/);
});

// ------------------------------------------------------------------ Codex hand-off

function codexOrder(model?: string): WorkOrder {
  return { id: "wo-20260925-1830-k3f9", agent: { tool: "codex", surface: "terminal", effort: "high", ...(model ? { model } : {}) } } as unknown as WorkOrder;
}

test("codex: terminal arguments keep paths with spaces as single tokens; .cmd shims use strict tokens only", () => {
  const md = "D:\\PROJ\\My Library\\.datapass\\local\\work-orders\\wo-20260925-1830-k3f9\\order.md";
  const ws = { cwd: "D:\\PROJ\\My Pipeline", addDirs: ["D:\\PROJ\\My Library", "D:\\PROJ\\research lab"] };
  const a = codexArgs(codexOrder("gpt-5-codex"), md, ws);
  assert.deepEqual(a, ["-C", "D:\\PROJ\\My Pipeline", "--add-dir", "D:\\PROJ\\My Library", "--add-dir", "D:\\PROJ\\research lab", "--sandbox", "workspace-write", "--ask-for-approval", "on-request", "-m", "gpt-5-codex", markerLine(codexOrder(), md)]);
  const line = agentCmdLine("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd", a);
  assert.ok(line);
  assert.ok(line.startsWith('""C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd" "-C" "D:\\PROJ\\My Pipeline" "--add-dir" "D:\\PROJ\\My Library"'), line);
  assert.ok(line.endsWith('"'));
  assert.equal(agentCmdLine("C:\\Program Files\\nodejs\\codex.cmd", a)?.startsWith('""C:\\Program Files\\nodejs\\codex.cmd"'), true, "a shim under Program Files is quoted");
  assert.equal(agentCmdLine("C:\\npm\\codex.cmd", codexArgs(codexOrder(), md, { cwd: "D:\\PROJ\\R&D", addDirs: [] })), undefined, "an & in a folder falls back to Copy the command");
  assert.equal(agentCmdLine("C:\\npm\\codex.cmd", codexArgs(codexOrder(), md, { cwd: "D:\\PROJ\\100%", addDirs: [] })), undefined);
  assert.deepEqual(codexAppArgs("D:\\PROJ\\My Pipeline"), ["app", "D:\\PROJ\\My Pipeline"]);
  assert.ok(agentCmdLine("C:\\npm\\codex.cmd", codexAppArgs("D:\\PROJ\\My Pipeline")));
});
