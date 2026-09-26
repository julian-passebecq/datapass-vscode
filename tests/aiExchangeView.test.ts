/**
 * 0.15.1 AI exchange view (secondary side bar): its HTML and script, its state, and the live check
 * of a pasted answer. Synthetic project A only (no FOIL content).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { aiExchangeHtml } from "../src/views/aiExchangeHtml";
import { aiExchangeState } from "../src/views/aiExchangeState";
import { lineChanges, reviewIncoming, type ExchangeKind } from "../src/core/project/aiExchange";
import type { ExchangeRecord } from "../src/core/work/workModel";
import { graphA, manifestA } from "./fixtures/v3/research";
import { optionsAJson, sheetAJson } from "./fixtures/v3/researchOptions";

const KINDS: ExchangeKind[] = ["options", "sheet", "graph", "manifest", "catalog"];
const scripts = (html: string) => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map(m => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));

// ------------------------------------------------------------------ HTML and script

test("AI exchange view: the script parses, carries the nonce, and the CSP allows nothing else", () => {
  const html = aiExchangeHtml("vscode-resource:", "NONCE123");
  const found = scripts(html);
  assert.equal(found.length, 1);
  assert.ok(found[0]!.attrs.includes('nonce="NONCE123"'));
  assert.doesNotThrow(() => new Function(found[0]!.body), "a syntax error would leave the view blank");
  assert.match(html, /default-src 'none'; style-src vscode-resource: 'unsafe-inline'; script-src 'nonce-NONCE123';/);
  assert.doesNotMatch(html, /\son[a-z]+="/, "no inline event handlers");
  assert.doesNotMatch(html, /https?:\/\//, "no external resource");
});

test("AI exchange view: extension data is rendered as text, and the pasted answer is never persisted", () => {
  const body = scripts(aiExchangeHtml("x", "n"))[0]!.body;
  assert.doesNotMatch(body, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  const setState = [...body.matchAll(/vscode\.setState\(([^)]*)\)/g)].map(m => m[1]);
  assert.deepEqual(setState, ["{ kind: kind, tasks: tasks, tab: tab }"], "only the chosen file, task and tab are remembered (0.20: the tab)");
  // The messages the extension handles, and nothing that could run a command freely.
  const types = new Set([...body.matchAll(/post\(\{ type: '([a-zA-Z.]+)'/g)].map(m => m[1]));
  assert.deepEqual([...types].sort(), ["check", "command", "copy", "fromFile", "open", "paste", "pilot.decline", "pilot.run", "pilot.write", "ready", "wo.cmd", "wo.preview", "wo.write", "write"]);
  assert.deepEqual([...body.matchAll(/type: 'command', command: '([^']+)'/g)].map(m => m[1]).sort(), ["datapass.openPreparationGuide", "datapass.restoreBackup"]);
  // 0.20: every command the Agent and Manual tabs name is in the extension's allowlist (AGENT_ALLOWED in src/views/aiExchange.ts).
  const agentAllowed = new Set([
    "datapass.workOrders.show", "datapass.workOrders.launch", "datapass.workOrders.resume", "datapass.workOrders.markDone", "datapass.workOrders.followUp",
    "datapass.workOrders.publishSummary", "datapass.workOrders.exportProject", "datapass.workOrders.openApp", "datapass.workOrders.enable",
    "datapass.workOrders.copyForChat", "datapass.openProjectManifest", "workbench.trust.manage",
    "datapass.project.focus", "datapass.git.focus", "datapass.readinessReport", "datapass.openWorkbench", "datapass.openNativeTool",
    "datapass.checkForUpdates", "datapass.openPreparationGuide", "workbench.actions.view.problems", "datapass.restoreBackup",
    "datapass.pilot.enable", "datapass.workOrders.openFolder"
  ]);
  const named = [...body.matchAll(/'((?:datapass|workbench)\.[A-Za-z.]+)'/g)].map(m => m[1]!);
  assert.ok(named.length > 15);
  assert.deepEqual(named.filter(n => !agentAllowed.has(n)), [], "a command the extension would refuse");
});

test("AI view (0.20, 0.26): four tabs, DataPass-guided first and shown by default; Pilot last (AI-4a)", () => {
  const html = aiExchangeHtml("x", "n");
  const tabs = [...html.matchAll(/<button id="t-([a-z]+)" class="tab[^"]*"[^>]*>([^<]+)/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(tabs, [["guided", "DataPass-guided"], ["agent", "Agent"], ["manual", "Manual"], ["pilot", "Pilot"]]);
  assert.match(html, /<section id="tab-guided" role="tabpanel" aria-labelledby="t-guided">/);
  assert.match(html, /<section id="tab-agent" role="tabpanel" aria-labelledby="t-agent" hidden>/);
  assert.match(html, /<section id="tab-manual" role="tabpanel" aria-labelledby="t-manual" hidden>/);
  assert.match(html, /<section id="tab-pilot" role="tabpanel" aria-labelledby="t-pilot" hidden>/);
  assert.match(scripts(html)[0]!.body, /let tab = saved\.tab === 'agent' \|\| saved\.tab === 'manual' \|\| saved\.tab === 'pilot' \? saved\.tab : 'guided';/);
  assert.match(html, /Pilot mode[^<]*the Pilot tab/);
});

// ------------------------------------------------------------------ state

test("AI exchange state: files with their size or absence, the graph where project.json says, recent AI exchanges only", () => {
  const record = (i: number, kind: ExchangeRecord["kind"] = "ai-context"): ExchangeRecord => ({ id: `e${i}`, kind, label: `exchange ${i}`, status: "copied", scopeRef: "__project__", at: `2026-09-25T10:0${i}:00Z` });
  const s = aiExchangeState({
    version: "0.15.1", hasRoot: true, hasManifest: true, projectTitle: "Research library", graphPath: "architecture/graph.json",
    kinds: KINDS, sizes: { manifest: 900, options: 12_000, graph: 4000 }, problems: { sheet: "x".repeat(500) },
    exchanges: [record(1), record(2, "candidate"), record(3), record(4), record(5), record(6), record(7)]
  });
  assert.equal(s.ready, true);
  assert.deepEqual(s.files.map(f => [f.kind, f.exists, f.bytes]), [["options", true, 12000], ["sheet", false, undefined], ["graph", true, 4000], ["manifest", true, 900], ["catalog", false, undefined]]);
  assert.equal(s.files.find(f => f.kind === "graph")!.path, "architecture/graph.json");
  assert.equal(s.files.find(f => f.kind === "sheet")!.problem!.length, 300);
  assert.deepEqual(s.files.find(f => f.kind === "options")!.tasks.map(t => t.id), ["propose", "review", "free"]);
  assert.deepEqual(s.recent.map(r => r.label), ["exchange 1", "exchange 3", "exchange 4", "exchange 5", "exchange 6"], "other exchanges are left out; five at most");
  const none = aiExchangeState({ version: "x", hasRoot: false, hasManifest: false, kinds: KINDS, sizes: {}, problems: {}, exchanges: [] });
  assert.equal(none.ready, false);
  assert.equal(none.files.find(f => f.kind === "graph")!.path, ".datapass/graph.json");
});

// ------------------------------------------------------------------ live check

test("AI exchange review: a valid answer says which file it is and roughly how much changes", async () => {
  const current = JSON.stringify(optionsAJson(), null, 2) + "\n";
  const edited = optionsAJson() as Record<string, any>;
  edited.decisions[0].title = "Where are PDFs archived (reviewed)?";
  const answer = "Here you go:\n```json\n" + JSON.stringify(edited, null, 2) + "\n```";
  const ctx = { manifest: manifestA(), graph: graphA() };
  const r = await reviewIncoming(answer, ctx, kind => (kind === "options" ? current : undefined));
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.kind, "options");
  assert.equal(r.path, ".datapass/options.json");
  assert.equal(r.isNew, false);
  assert.equal(r.unchanged, false);
  assert.deepEqual([r.added, r.removed], [1, 1]);
  const same = await reviewIncoming(current, ctx, () => current);
  assert.ok(same.ok && same.unchanged && same.added === 0);
  // The kind comes from the file itself, whatever the view had selected.
  const sheet = await reviewIncoming(JSON.stringify(sheetAJson()), ctx, () => undefined);
  assert.ok(sheet.ok && sheet.kind === "sheet" && sheet.isNew);
});

test("AI exchange review: empty, leaky, invalid or foreign text is explained, never thrown", async () => {
  const ctx = { manifest: manifestA(), graph: graphA() };
  const none = () => undefined;
  assert.deepEqual(await reviewIncoming("  \n", ctx, none), { ok: false, error: "Paste the AI's answer first." });
  const leaky = optionsAJson() as Record<string, any>;
  leaky.decisions[0].notes = "use D:\\PROJ\\research\\secrets.txt";
  const refused = await reviewIncoming(JSON.stringify(leaky), ctx, none);
  assert.ok(!refused.ok && /local path/.test(refused.error), JSON.stringify(refused));
  const foreign = await reviewIncoming(JSON.stringify({ hello: "world" }), ctx, none);
  assert.ok(!foreign.ok && /not a DataPass file/.test(foreign.error));
  const broken = await reviewIncoming("```json\n{ \"format\": \"datapass.options\", \n```", ctx, none);
  assert.ok(!broken.ok);
});

test("lineChanges counts added and removed lines, ignoring blank lines", () => {
  assert.deepEqual(lineChanges("a\nb\nc\n", "a\nc\nd\ne\n"), { added: 2, removed: 1 });
  assert.deepEqual(lineChanges(undefined, "a\n\nb\n"), { added: 2, removed: 0 });
  assert.deepEqual(lineChanges("x\nx\n", "x\n"), { added: 0, removed: 1 });
});
