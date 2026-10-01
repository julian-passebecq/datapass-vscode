import { test } from "node:test";
import assert from "node:assert/strict";
import { barPercent, renderMetricCard, renderMetrics, DEFAULT_METRICS_LABELS } from "../src/core/navigation/layouts/metrics";
import { renderDiffHistory, vetOpenDiff, FILES_SHOWN } from "../src/core/navigation/layouts/diffHistory";

const SHA = "a".repeat(40);

test("metric card shows value, unit and basis", () => {
  const html = renderMetricCard({ id: "rows", title: "Rows", value: 12000, unit: "rows", basis: "observed", max: 24000 });
  assert.match(html, /12,000/);
  assert.match(html, /rows<\/span>/);
  assert.match(html, /basis-observed/);
  assert.match(html, />observed</);
  assert.match(html, /width:50%/);
});

test("absent value is a hole with its reason, never a guess", () => {
  const html = renderMetricCard({ id: "t", title: "Duration", hole: "no run evidence" });
  assert.match(html, /class="nav-metric hole"/);
  assert.match(html, /not known/);
  assert.match(html, /no run evidence/);
  assert.doesNotMatch(html, /nav-metric-bar/);
});

test("labels are data: basis display names and hole text come from labels", () => {
  const labels = { ...DEFAULT_METRICS_LABELS, hole: "inconnu", basis: { theoretical: "théorique" } };
  assert.match(renderMetricCard({ id: "x", title: "X", value: 1, basis: "theoretical" }, labels), /théorique/);
  assert.match(renderMetricCard({ id: "x", title: "X" }, labels), /inconnu/);
  assert.match(renderMetricCard({ id: "x", title: "X", value: 1 }, labels), /origin unknown/);
});

test("order picks metrics, missing ids become holes; empty list has a message", () => {
  const html = renderMetrics([{ id: "a", title: "A", value: 1 }, { id: "b", title: "B", value: 2 }], ["b", "zz"]);
  assert.ok(html.indexOf(">B<") >= 0 && html.indexOf(">A<") < 0);
  assert.match(html, /data-id="zz"/);
  assert.match(renderMetrics([]), /No metrics/);
});

test("bar percent clamps and needs a numeric scale", () => {
  assert.equal(barPercent({ id: "a", title: "a", value: 5, max: 2 }), 100);
  assert.equal(barPercent({ id: "a", title: "a", value: "5", max: 2 }), undefined);
  assert.equal(barPercent({ id: "a", title: "a", value: 5 }), undefined);
});

test("untrusted text is escaped", () => {
  const html = renderMetricCard({ id: "\"><x", title: "<script>", value: "<b>" });
  assert.doesNotMatch(html, /<script>|<b>|"><x/);
});

test("history rows: date, author, message, files, +N collapse", () => {
  const files = Array.from({ length: FILES_SHOWN + 2 }, (_, i) => `f${i}.sql`);
  const html = renderDiffHistory([{ rev: SHA, date: "2026-10-01T02:00:00+02:00", author: "Ana <x>", message: "fix join", files }], SHA);
  assert.match(html, /data-rev="a{40}"/);
  assert.match(html, /2026-10-01 · Ana &lt;x&gt; · 7 files/);
  assert.match(html, /fix join/);
  assert.match(html, /\+2</);
  assert.match(html, /nav-commit selected/);
});

test("history drops rows with a bad rev and shows empty text", () => {
  assert.match(renderDiffHistory([{ rev: "HEAD; rm", date: "", author: "", message: "", files: [] }]), /No history/);
});

test("open-diff message is validated", () => {
  assert.deepEqual(vetOpenDiff({ type: "open-diff", rev: SHA }), { type: "open-diff", rev: SHA });
  assert.equal(vetOpenDiff({ type: "open-diff", rev: "--output=x" }), undefined);
  assert.equal(vetOpenDiff({ type: "nav", rev: SHA }), undefined);
  assert.equal(vetOpenDiff(null), undefined);
});
