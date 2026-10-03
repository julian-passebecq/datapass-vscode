/** V4-NAV NAVCAT1: view overrides — parse, validate, customize, hide, reset — over the real DEFAULT_VIEW_CATALOG. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_VIEW_CATALOG, entryKey, entryTemplate, hasEntry, hideView, mergeCatalogs, parseViewOverrides, resetViews, serializeOverrides, withEntry
} from "../src/core/navigation/catalogStore";
import { resolveViews, type NavLocation, type ViewCatalog, type ViewOverrides } from "../src/core/navigation/navTypes";

type Spot = Pick<NavLocation, "artifactKind" | "level">;
const cat: ViewCatalog = mergeCatalogs(DEFAULT_VIEW_CATALOG);
const sql: Spot = { artifactKind: "sql-script", level: "artifact" };
const star: Spot = { artifactKind: "*", level: "artifact" };
const ids = (l: Spot, o: ViewOverrides | null = null, c = cat) => resolveViews(c, o, entryKey(l).artifactKind, l.level).map(v => v.id);
/** sql-script's own built-in views, then the '*' artifact views it does not already have. */
const SQL_DEFAULT = ["query-shape", "partitions-indexes", "lineage", "data-flow", "detail"];

test("absent file: defaults, no warning; one entry per (kind, level), project replaces built-in, user override on top", () => {
  assert.deepEqual(parseViewOverrides(undefined), { overrides: null, warnings: [] });
  assert.deepEqual(ids(sql), SQL_DEFAULT);
  assert.deepEqual(cat.entries, DEFAULT_VIEW_CATALOG.entries);
  const project = mergeCatalogs(DEFAULT_VIEW_CATALOG, [
    { artifactKind: "sql-script", level: "artifact", views: [{ id: "sql-shape", title: "SQL shape", layout: "table", bindings: [{ source: "sql-shape" }] }] }
  ]);
  assert.equal(project.entries.length, DEFAULT_VIEW_CATALOG.entries.length);
  assert.equal(project.entries.filter(e => e.artifactKind === "sql-script" && e.level === "artifact").length, 1);
  assert.deepEqual(ids(sql, null, project), ["sql-shape", "lineage", "data-flow", "detail"], "the project entry replaces the built-in one");
  const user: ViewOverrides = { schema: "datapass.view-overrides/1", entries: [{ ...sql, titles: { "sql-shape": "Mine" } }] };
  assert.equal(resolveViews(project, user, "sql-script", "artifact")[0]!.title, "Mine", "user override > project > built-in");
});

test("invalid file: warnings and the defaults", () => {
  for (const raw of ["{", JSON.stringify({ schema: "datapass.view-overrides/2", entries: [] }),
    JSON.stringify({ schema: "datapass.view-overrides/1", entries: [{ artifactKind: "x", level: "nowhere" }] }),
    JSON.stringify({ schema: "datapass.view-overrides/1", entries: [{ ...sql, hidden: ["lineage"] }, { ...sql, hidden: ["detail"] }] }),
    JSON.stringify({ $schema: 5, schema: "datapass.view-overrides/1", entries: [] }),
    JSON.stringify({ schema: "datapass.view-overrides/1", entries: [{ ...sql, unknown: true }] })]) {
    const r = parseViewOverrides(raw);
    assert.equal(r.overrides, null, raw);
    assert.ok(r.warnings.length > 0, raw);
    assert.deepEqual(ids(sql, r.overrides), SQL_DEFAULT);
  }
});

test("valid file: hidden, add, order, titles and params apply", () => {
  const r = parseViewOverrides(JSON.stringify({
    $schema: "x", schema: "datapass.view-overrides/1",
    entries: [{ ...sql, hidden: ["lineage"], order: ["mine", "query-shape"], titles: { "query-shape": "Shape" },
      add: [{ id: "mine", title: "Mine", layout: "metrics", bindings: [{ source: "volumetry", params: { top: 5 } }] }] }]
  }));
  assert.ok(r.overrides);
  assert.deepEqual(r.warnings, []);
  const v = resolveViews(cat, r.overrides, "sql-script", "artifact");
  assert.deepEqual(v.map(x => x.id), ["mine", "query-shape", "partitions-indexes", "data-flow", "detail"]);
  assert.equal(v[1]!.title, "Shape");
  assert.deepEqual(v[0]!.bindings[0]!.params, { top: 5 });
});

test("a * override applies to every kind; a kind's own entry applies on top of it", () => {
  let o = hideView(null, star, "data-flow");
  assert.deepEqual(ids(sql, o), ["query-shape", "partitions-indexes", "lineage", "detail"]);
  assert.deepEqual(ids(star, o), ["lineage", "detail"]);
  assert.deepEqual(ids({ artifactKind: "", level: "artifact" }, o), ["lineage", "detail"], "no kind = the * entry");
  o = hideView(o, sql, "lineage");
  assert.deepEqual(ids(sql, o), ["query-shape", "partitions-indexes", "detail"]);
  assert.deepEqual(ids({ artifactKind: "spark-notebook", level: "artifact" }, o), ["steps", "spark-perf", "lineage", "history", "detail"]);
});

test("customize pre-fills the current views; hide, reset round-trip through the file", () => {
  const t = entryTemplate(cat, null, sql);
  assert.deepEqual(t.order, SQL_DEFAULT);
  assert.equal(t.titles!["query-shape"], "Query shape");
  let o = withEntry(cat, null, sql);
  o = hideView(o, sql, "partitions-indexes");
  o = hideView(o, sql, "partitions-indexes");
  assert.equal(o.entries.length, 1);
  const back = parseViewOverrides(serializeOverrides(o));
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(ids(sql, back.overrides), ["query-shape", "lineage", "data-flow", "detail"]);
  assert.ok(hasEntry(back.overrides, sql));
  assert.ok(!hasEntry(back.overrides, star));
  assert.deepEqual(ids(sql, resetViews(back.overrides, sql)), SQL_DEFAULT);
  assert.deepEqual(resetViews(back.overrides).entries, []);
});

test("package.json validates .datapass/views.json and lists the commands", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.contributes.jsonValidation.some((j: any) => j.fileMatch.includes("**/.datapass/views.json")));
  for (const c of ["customizeViews", "hideView", "resetViews"]) assert.ok(pkg.contributes.commands.some((x: any) => x.command === `datapass.nav.${c}`));
});
