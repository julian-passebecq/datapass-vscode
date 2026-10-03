/**
 * V5 TOURSHARE1: a saved `datapass.tour/1` tour played inside the EXPLAIN1 page. Without a tour the page is
 * unchanged; with one it gets a panel, one box per step in the section showing its box, Previous / Next
 * fragment links and a highlight, never a script or a remote URL. An unknown (or audience-hidden) Location
 * is a typed hole that names neither the box nor its text. AI-proposed steps keep their badge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectMap } from "../src/core/project/projectMap";
import { buildExplainHtml, type ExplainInput } from "../src/core/explain/document";
import { DEFAULT_EXPLAIN_LABELS, DEFAULT_EXPLAIN_SECTIONS } from "../src/core/explain/presets";
import { filterFacts, type ExplainAudience } from "../src/core/explain/sources";
import { placeStep, playerTour, type PlayerTour } from "../src/core/explain/tourPlayer";
import type { Tour, TourStep } from "../src/core/navigation/tours/tourTypes";
import { PALETTE_TIERS } from "../src/core/experience/palette";
import { inputA } from "./fixtures/v3/research";

const map = buildProjectMap(inputA());
const LABELS: Record<string, string> = Object.fromEntries(map.components.map(c => [c.id, c.label]));
const TEXTS: Record<string, string> = { "s-extract": "The PDFs are read here.", "s-review": "People check what the AI drafted.", "s-ghost": "Secret ghost text" };

const step = (nodeId: string, key: string, origin: TourStep["origin"] = "user", substeps?: TourStep[]): TourStep => ({
  location: { level: "artifact", nodeId, artifactKind: "component" }, viewId: "architecture", explanationRef: `text:${key}`, origin,
  ...(substeps ? { substeps } : {})
});
const TOUR: Tour = { id: "walk-boss", titleRef: "text:title", steps: [
  step("extract", "s-extract", "user", [step("review", "s-review", "ai-proposed")]),
  step("ghost-node", "s-ghost"),
  step("pdf-archive", "missing-key")
] };

function player(t: Tour = TOUR): PlayerTour {
  return playerTour(t, { title: "Walk the boss through", label: (l) => LABELS[l.nodeId] ?? `ghost ${l.nodeId}`,
    explain: (ref) => TEXTS[ref.replace(/^text:/, "")] });
}
const input = (audience: ExplainAudience = "internal", over: Partial<ExplainInput> = {}): ExplainInput => ({
  facts: filterFacts(audience, map), sections: DEFAULT_EXPLAIN_SECTIONS, labels: DEFAULT_EXPLAIN_LABELS, projectTitle: "Research synthetic",
  date: "2026-10-01", generator: "DataPass test", ...over });

test("tourshare: the steps are flattened in reading order with their words resolved", () => {
  const p = player();
  assert.deepEqual(p.steps.map(s => s.number), ["1", "1.1", "2", "3"]);
  assert.equal(p.steps[0]!.text, "The PDFs are read here.");
  assert.equal(p.steps[1]!.origin, "ai-proposed");
  assert.equal(p.steps[3]!.text, undefined, "an unresolved ref stays a hole, never invented text");
});

test("tourshare: export without a tour has no player; with one it plays read-only, without script or URL", () => {
  const plain = buildExplainHtml(input()).html;
  assert.doesNotMatch(plain, /class="xp-step|id="xp-tour"|xp-hl-/);
  const { html } = buildExplainHtml(input("internal", { tourPlayer: player() }));
  assert.doesNotMatch(html, /https?:/i);
  assert.doesNotMatch(html, /<script|<link|<iframe|\bsrc=|\son[a-z]+=/i);
  assert.match(html, /<section class="xp-tours" id="xp-tour"[^>]*><h2>Guided tour: Walk the boss through<\/h2>/);
  assert.match(html, /href="#xp-ts-1">Start the tour/);
  // Step 1 sits in the architecture section, before its table, with Next and a disabled Previous.
  assert.match(html, /<section class="xp-section" id="xp-architecture">[\s\S]*?<aside class="xp-step" id="xp-ts-1"[\s\S]*?The PDFs are read here\.[\s\S]*?aria-disabled="true">← Previous<\/span>[\s\S]*?href="#xp-ts-2">Next →<\/a>[\s\S]*?<table/);
  // Its box is highlighted when the step is the target.
  assert.match(html, /<tr class="nv-row nv-selectable xp-hl-1" tabindex="0" data-node-id="extract"/);
  assert.match(html, /\.xp:has\(#xp-ts-1:target\) \.xp-hl-1/);
  assert.match(html, /\.xp-step:target \{ display: block; \}/);
  // The last step: Previous only, and its missing explanation is a typed hole.
  assert.match(html, /id="xp-ts-4"[\s\S]*?data-hole-kind="no-explanation"[\s\S]*?href="#xp-ts-3">← Previous[\s\S]*?aria-disabled="true">Next →/);
});

test("tourshare: AI-proposed steps keep their badge (panel, box, legend)", () => {
  const { html } = buildExplainHtml(input("internal", { tourPlayer: player() }));
  assert.match(html, /id="xp-ts-2"[^>]*><p class="xp-step-head">Step 1\.1 · 2 of 4 — <strong>Human review<\/strong> <span class="nv-origin nv-origin-ai-proposed">AI-proposed<\/span>/);
  assert.match(html, /<li><a href="#xp-ts-2">Step 1\.1<\/a> Human review <span class="nv-origin nv-origin-ai-proposed">/);
  assert.match(html, /class="xp-legend"[\s\S]*nv-origin-ai-proposed[\s\S]*<\/header>/);
});

test("tourshare: an unknown Location is a typed hole that names neither the box nor its text", () => {
  const { html } = buildExplainHtml(input("internal", { tourPlayer: player() }));
  assert.match(html, /id="xp-ts-3"[^>]*><p class="xp-step-head">Step 2 · 3 of 4<\/p><p class="nv-hole xp-tour-hole" role="note" data-hole-kind="unknown-location">box missing/);
  assert.doesNotMatch(html, /ghost ghost-node|Secret ghost text/);
  assert.deepEqual(placeStep(player().steps[2]!, [{ id: "architecture", body: { tag: "div" } }]), { kind: "hole", hole: "unknown-location" });
});

test("tourshare: a box left out for the audience is a hole too (no confidential name through a tour)", () => {
  const { html } = buildExplainHtml(input("public", { tourPlayer: player() }));
  assert.equal((html.match(/data-hole-kind="unknown-location"/g) ?? []).length, 8, "4 steps × (panel line + box)");
  assert.doesNotMatch(html, /PDF extraction|Human review|The PDFs are read here/);
});

test("tourshare: a project-level step lands on its view's section, else on the panel", () => {
  const at = (viewId: string) => placeStep({ location: { level: "project", nodeId: "research-library", artifactKind: "project" }, viewId },
    [{ id: "flows", body: { tag: "div" } }]);
  assert.deepEqual(at("flows"), { kind: "section", sectionId: "flows", highlighted: 0 });
  assert.deepEqual(at("other"), { kind: "page" });
});

test("tourshare: the export-with-a-tour command is classified through its own *.palette.ts", () => {
  assert.equal(PALETTE_TIERS.get("datapass.explain.exportWithTour"), "palette.full");
});
