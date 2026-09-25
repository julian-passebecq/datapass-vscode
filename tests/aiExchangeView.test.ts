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
  assert.deepEqual(setState, ["{ kind: kind, tasks: tasks }"], "only the chosen file and task are remembered");
  // The messages the extension handles, and nothing that could run a command freely.
  const types = new Set([...body.matchAll(/post\(\{ type: '([a-zA-Z]+)'/g)].map(m => m[1]));
  assert.deepEqual([...types].sort(), ["check", "command", "copy", "fromFile", "open", "paste", "ready", "write"]);
  assert.deepEqual([...body.matchAll(/command: '([^']+)'/g)].map(m => m[1]).sort(), ["datapass.openPreparationGuide", "datapass.restoreBackup"]);
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
