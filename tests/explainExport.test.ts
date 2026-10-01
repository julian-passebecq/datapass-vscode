/**
 * V5 EXPLAIN1 (TL-8): the explainer export of the synthetic research project is deterministic (snapshot, date
 * masked), self-contained (no remote URL, CSP forbids remote loads, no script), drawn by the standalone renderer,
 * and respects the audience classification. Update the snapshot on purpose with EXPLAIN_SNAPSHOT=update.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildProjectMap, type ProjectMap } from "../src/core/project/projectMap";
import type { OptionsFile } from "../src/core/project/options";
import { buildExplainHtml, type ExplainInput } from "../src/core/explain/document";
import { DEFAULT_EXPLAIN_LABELS, DEFAULT_EXPLAIN_SECTIONS, sectionsFromSetting } from "../src/core/explain/presets";
import { filterFacts, registerExplainSource, visibleTo } from "../src/core/explain/sources";
import { toHtml } from "../src/webview/views/headless";
import { inputA } from "./fixtures/v3/research";

const SNAPSHOT = "tests/fixtures/explain/export-snapshot.html";

const options = (): OptionsFile => ({
  format: "datapass.options", version: "1", decisions: [
    { id: "archive-store", title: "Where the PDF archive lives", question: "Blob storage or a lakehouse?", current: "blob", chosen: "lake",
      decidedOn: "2026-09-30", decidedBy: "team", rationale: "One storage for documents and tables.",
      options: [{ id: "blob", label: "Blob storage" }, { id: "lake", label: "Lakehouse files" }, { id: "nas", label: "NAS", rejected: true }] }
  ]
} as unknown as OptionsFile);

function input(over: Partial<ExplainInput> = {}, map: ProjectMap = buildProjectMap(inputA())): ExplainInput {
  return { facts: filterFacts("internal", map, options()), sections: DEFAULT_EXPLAIN_SECTIONS, labels: DEFAULT_EXPLAIN_LABELS,
    projectTitle: "Research synthetic", git: { revision: "0123456789abcdef0123456789abcdef01234567", dirty: false },
    date: "2026-10-01", generator: "DataPass test", ...over };
}

const mask = (html: string) => html.replace(/\d{4}-\d{2}-\d{2}(?=<\/dd>)/, "<date>");

test("explain: export of the synthetic project matches the snapshot (date masked) and is stable", () => {
  const a = buildExplainHtml(input()).html;
  const b = buildExplainHtml(input({ date: "2027-01-02" })).html;
  assert.equal(mask(a), mask(b), "only the date may differ between two exports");
  if (process.env.EXPLAIN_SNAPSHOT === "update") { mkdirSync("tests/fixtures/explain", { recursive: true }); writeFileSync(SNAPSHOT, mask(a)); }
  assert.equal(mask(a), readFileSync(SNAPSHOT, "utf8").replace(/\r\n/g, "\n"), "explainer changed: review it, then EXPLAIN_SNAPSHOT=update");
});

test("explain: the page is self-contained (no http URL, no script, CSP forbids remote loads)", () => {
  const { html, included, skipped } = buildExplainHtml(input());
  assert.doesNotMatch(html, /https?:/i);
  assert.doesNotMatch(html, /<script|<link|<iframe|\bsrc=/i);
  assert.match(html, /default-src 'none'/);
  assert.deepEqual(included, ["architecture", "flows", "readiness", "next-steps", "decisions"]);
  assert.deepEqual(skipped, ["lineage"], "lineage waits for its provider (NAVLIN1)");
});

test("explain: header carries project, Git SHA, date, audience marking and an origins legend", () => {
  const { html } = buildExplainHtml(input({ git: { revision: "abc123", dirty: true } }));
  assert.match(html, /<h1>Research synthetic<\/h1>/);
  assert.match(html, /abc123 \(with uncommitted changes\)/);
  assert.match(html, /2026-10-01/);
  assert.match(html, /Internal — do not forward/);
  assert.match(html, /class="xp-legend"[\s\S]*nv-origin-declared[\s\S]*nv-origin-static/);
  assert.match(buildExplainHtml(input({ git: undefined })).html, /not a Git repository/);
});

test("explain: sections are drawn by the standalone renderer (layout classes, origin badges, decisions)", () => {
  const { html } = buildExplainHtml(input());
  assert.match(html, /id="xp-architecture"[\s\S]*nv-layout-table/);
  assert.match(html, /id="xp-readiness"[\s\S]*nv-layout-detail-card/);
  assert.match(html, /Where the PDF archive lives[\s\S]*Lakehouse files/);
  assert.doesNotMatch(html, /NAS/, "rejected options are not listed");
});

test("explain: confidential components never reach the page; public audience keeps public items only", () => {
  const base = buildProjectMap(inputA());
  const [secret, open] = base.components;
  assert.ok(secret && open);
  const map: ProjectMap = { ...base, components: base.components.map(c =>
    c.id === secret.id ? { ...c, classification: "confidential" as const, label: "TOP-SECRET-STORE" } : c.id === open.id ? { ...c, classification: "public" as const } : c) };
  const internal = buildExplainHtml(input({ facts: filterFacts("internal", map, options()) })).html;
  assert.doesNotMatch(internal, /TOP-SECRET-STORE/);
  assert.match(internal, /Omitted for this audience: 1/);
  const pub = filterFacts("public", map, options());
  assert.deepEqual(pub.map.components.map(c => c.id), [open.id]);
  assert.ok(pub.map.relations.every(r => r.source === open.id && r.target === open.id));
  assert.match(buildExplainHtml(input({ facts: pub })).html, /xp-marking-public/);
  assert.equal(visibleTo("public", undefined), false, "unclassified is never assumed public");
});

test("explain: decisions touching an omitted component are left out", () => {
  const base = buildProjectMap(inputA());
  const id = base.components[0]!.id;
  const map: ProjectMap = { ...base, components: base.components.map(c => c.id === id ? { ...c, classification: "confidential" as const } : c) };
  const o = options();
  const facts = filterFacts("internal", map, { ...o, decisions: o.decisions.map(d => ({ ...d, concerns: [id] })) });
  assert.equal(facts.options?.decisions.length, 0);
});

test("explain: a registered provider fills an optional section; labels and sections are data", () => {
  registerExplainSource("lineage", () => [{ source: "lineage", origin: "observed", holes: [], columns: ["from", "to"], rows: [{ cells: { from: "a", to: "b" } }] }]);
  const { html, included } = buildExplainHtml(input({ labels: { ...DEFAULT_EXPLAIN_LABELS, "marking.internal": "Client X — internal" } }));
  assert.ok(included.includes("lineage"));
  assert.match(html, /Client X — internal/);
  assert.match(html, /nv-origin-observed/);
  assert.equal(sectionsFromSetting([]), DEFAULT_EXPLAIN_SECTIONS);
  assert.deepEqual(sectionsFromSetting([{ id: "x", title: "X", source: "explain.flows", layouts: ["table"] }, { id: 3 }]).map(s => s.id), ["x"]);
});

test("explain: headless serialiser escapes text and attributes and drops handlers", () => {
  assert.equal(toHtml({ tag: "p", text: "<b>&\"", attrs: { title: "\"x\"", onclick: "evil()" } }), `<p title="&quot;x&quot;">&lt;b&gt;&amp;&quot;</p>`);
  assert.equal(toHtml({ tag: "svg", attrs: { xmlns: "http://www.w3.org/2000/svg" }, children: [{ tag: "rect", attrs: { width: "1" } }] }), `<svg><rect width="1"/></svg>`);
  assert.equal(toHtml({ tag: "img onerror=x" }), "");
});
