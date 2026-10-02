/**
 * V4-NAV NAVCTX1: the Context view's section registry and its HTML. Synthetic data only.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildSections, contextTabs, DEFAULT_CONTEXT_TABS, normaliseOrigin, registerContextProvider } from "../src/core/navigation/context";
import { contextHtml } from "../src/views/contextHtml";

const loc = { level: "artifact" as const, nodeId: "nb_sales", artifactKind: "spark-notebook" };

test("tabs: six built-in sections, titles overridable by setting", () => {
  assert.deepEqual(DEFAULT_CONTEXT_TABS.map(t => t.id), ["summary", "process-step", "why", "patterns", "fabric", "evidence"]);
  const tabs = contextTabs({ fabric: "Sur Fabric", why: "", patterns: 3, evidence: "x".repeat(61) });
  assert.equal(tabs.find(t => t.id === "fabric")?.title, "Sur Fabric");
  assert.equal(tabs.find(t => t.id === "why")?.title, "Why & alternatives");
  assert.equal(tabs.find(t => t.id === "patterns")?.title, "Patterns");
  assert.equal(tabs.find(t => t.id === "evidence")?.title, "Evidence");
});

test("summary from location; missing providers are holes, never guesses", async () => {
  const s = await buildSections({ location: loc }, contextTabs(undefined));
  assert.equal(s[0]!.origin, "static");
  assert.match(s[0]!.body, /nb_sales/);
  for (const sec of s.slice(1)) { assert.equal(sec.origin, "none"); assert.equal(sec.body, ""); assert.equal(sec.holes.length, 1); }
  const none = await buildSections({ location: null }, contextTabs(undefined));
  assert.equal(none[0]!.holes.length, 1);
});

test("AI and unknown origins are shown as AI-proposed; a failing provider is a hole", async () => {
  assert.equal(normaliseOrigin("ai"), "ai-proposed");
  assert.equal(normaliseOrigin("AI-generated"), "ai-proposed");
  assert.equal(normaliseOrigin("made-up"), "ai-proposed");
  assert.equal(normaliseOrigin("observed"), "observed");
  const a = registerContextProvider({ tab: "patterns", provide: () => ({ body: "Medallion", origin: "ai" }) });
  const b = registerContextProvider({ tab: "fabric", provide: () => { throw new Error("boom"); } });
  try {
    const s = await buildSections({ location: loc }, contextTabs(undefined));
    assert.equal(s.find(x => x.id === "patterns")?.origin, "ai-proposed");
    assert.match(s.find(x => x.id === "fabric")!.holes[0]!.reason, /boom/);
  } finally { a.dispose(); b.dispose(); }
  const after = await buildSections({ location: loc }, contextTabs(undefined));
  assert.equal(after.find(x => x.id === "patterns")?.origin, "none");
});

test("html: nonce-only script, text set with textContent, arrows cycle tabs", () => {
  const html = contextHtml("vscode-resource:", "N0NCE");
  assert.match(html, /script-src 'nonce-N0NCE'/);
  assert.equal([...html.matchAll(/<script/g)].length, 1);
  assert.doesNotMatch(html, /innerHTML/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /ArrowLeft/);
});
