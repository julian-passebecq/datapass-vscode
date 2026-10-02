/**
 * V4-NAV NAVERD1 binding `schema-erd`: tables, columns and key edges for the `erd` layout, from existing facts only.
 * - SQL: validated `datapass.sql-syntax-facts/1` trees (CREATE TABLE columns/types, column and table PRIMARY KEY /
 *   FOREIGN KEY / REFERENCES, ALTER TABLE … ADD CONSTRAINT). Declared keys are `static`.
 * - JOIN … ON a.x = b.y equalities between two tables: an inferred edge, origin `theoretical`, never promoted to a key.
 * - Semantic-model relationships (TMDL/BIM) when the host passes them (no analyzer emits them yet: typed hole).
 * Never guesses: a missing column list, key or fact is a typed hole naming that fact. Pure (no `vscode`), no execution.
 */
import { validateSqlSyntaxFacts, child, children, scalar, identifier, type SqlNode } from "@juliandatapass-group/analyzers/sql";

export const SCHEMA_ERD_SOURCE = "schema-erd";
export const SQL_SYNTAX_FACTS = "datapass.sql-syntax-facts/1";
export const SEMANTIC_RELATIONSHIPS_FACT = "semantic-model relationships (TMDL/BIM)";
/** § 34 origins used here. */
export type ErdOrigin = "static" | "theoretical";

export interface ErdColumn { readonly name: string; readonly type: string | null; readonly pk: boolean; readonly fk: boolean; readonly origin: ErdOrigin }
export interface ErdTable {
  readonly id: string; readonly name: string; readonly kind: "table" | "view" | "unknown";
  /** null = no column list among the facts (a hole names it); [] = declared without columns. */
  readonly columns: readonly ErdColumn[] | null; readonly origin: ErdOrigin;
}
export type ErdCardinality = "many-to-one" | "one-to-one" | "one-to-many" | "many-to-many";
export interface ErdEdge {
  readonly id: string; readonly from: string; readonly fromColumns: readonly string[]; readonly to: string; readonly toColumns: readonly string[];
  /** Declared key (solid) or inferred join (dashed, 'theoretical'). */
  readonly declared: boolean; readonly origin: ErdOrigin; readonly cardinality: ErdCardinality | null; readonly name?: string;
}
export interface ErdGraph { readonly kind: "erd"; readonly tables: readonly ErdTable[]; readonly edges: readonly ErdEdge[] }
export interface ErdHole { readonly reason: string; readonly kind: string; readonly field?: string }
/** Same return shape as every NAV binding provider (go/NAV-contract.md). */
export interface SchemaErdData { readonly source: typeof SCHEMA_ERD_SOURCE; readonly origin: ErdOrigin; readonly graph: ErdGraph; readonly holes: readonly ErdHole[] }

/** A relationship as a TMDL/BIM fact would carry it (host-supplied; no analyzer emits it yet). */
export interface SemanticRelationshipFact {
  readonly fromTable: string; readonly fromColumn: string; readonly toTable: string; readonly toColumn: string;
  readonly cardinality?: ErdCardinality; readonly name?: string;
}
export interface SchemaErdInput {
  /** Raw `datapass.sql-syntax-facts/1` documents, validated here (untrusted). undefined = the host has none. */
  readonly sqlFacts?: readonly unknown[];
  readonly semanticRelationships?: readonly SemanticRelationshipFact[];
  /** Artifact kind of the location: `powerbi` expects semantic relationships, the others SQL facts. */
  readonly artifactKind?: string;
}

const norm = (s: string): string => s.toLowerCase();
const tableId = (parts: readonly string[]): string => `table:${parts.map(norm).join(".")}`;

function tableParts(t: SqlNode | undefined): string[] | null {
  if (t?.type !== "Table") return null;
  const parts = ["catalog", "db", "this"].map(k => child(t, k)).filter((n): n is SqlNode => !!n).map(n => identifier(n));
  return parts.length && parts.every(Boolean) ? parts as string[] : null;
}
const idents = (nodes: readonly SqlNode[]): string[] =>
  nodes.map(n => identifier(n.type === "Ordered" || n.type === "Column" ? (n.type === "Ordered" ? child(child(n, "this")!, "this") : child(n, "this")) : n)).filter((x): x is string => !!x);

function dataType(kind: SqlNode | undefined): string | null {
  if (kind?.type !== "DataType") return null;
  const base = child(kind, "this")?.value;
  if (typeof base !== "string") return null;
  const params = children(kind, "expressions").map(p => child(p, "this")).map(l => l ? child(l, "this")?.value ?? scalar(l, "this") : undefined)
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number");
  return params.length ? `${base}(${params.join(", ")})` : base;
}

interface Builder {
  tables: Map<string, { name: string; kind: ErdTable["kind"]; columns: Map<string, { type: string | null; pk: boolean; fk: boolean; origin: ErdOrigin }> | null; origin: ErdOrigin }>;
  edges: ErdEdge[];
}
function ensureTable(b: Builder, parts: readonly string[], declared: boolean): string {
  const id = tableId(parts);
  if (!b.tables.has(id)) b.tables.set(id, { name: parts.join("."), kind: declared ? "table" : "unknown", columns: declared ? new Map() : null, origin: declared ? "static" : "theoretical" });
  return id;
}
function addForeignKey(b: Builder, from: string, fromCols: readonly string[], fk: SqlNode, name: string | undefined): void {
  const ref = fk.type === "Reference" ? fk : child(fk, "reference");
  const schema = ref && child(ref, "this");
  const targetParts = tableParts(schema?.type === "Schema" ? child(schema, "this") : schema);
  if (!targetParts) return;
  const to = ensureTable(b, targetParts, false);
  const toCols = schema?.type === "Schema" ? idents(children(schema, "expressions")) : [];
  b.edges.push({ id: `fk:${from}(${fromCols.map(norm).join(",")})->${to}(${toCols.map(norm).join(",")})`, from, fromColumns: fromCols, to, toColumns: toCols,
    declared: true, origin: "static", cardinality: null, ...(name ? { name } : {}) });
}
function markCols(b: Builder, id: string, cols: readonly string[], flag: "pk" | "fk"): void {
  const t = b.tables.get(id)?.columns;
  if (!t) return;
  for (const c of cols) { const col = [...t.entries()].find(([n]) => norm(n) === norm(c)); if (col) col[1][flag] = true; }
}
function constraint(b: Builder, id: string, node: SqlNode): void {
  const name = node.type === "Constraint" ? identifier(child(node, "this")) : undefined;
  for (const c of node.type === "Constraint" ? children(node, "expressions") : [node]) {
    if (c.type === "PrimaryKey") markCols(b, id, idents(children(c, "expressions")), "pk");
    if (c.type === "ForeignKey") { const cols = idents(children(c, "expressions")); markCols(b, id, cols, "fk"); addForeignKey(b, id, cols, c, name); }
  }
}

function readCreate(b: Builder, tree: SqlNode): void {
  const kind = scalar(tree, "kind");
  if (kind !== "TABLE" && kind !== "VIEW") return;
  const target = child(tree, "this");
  const parts = tableParts(target?.type === "Schema" ? child(target, "this") : target);
  if (!parts) return;
  const id = ensureTable(b, parts, true);
  const t = b.tables.get(id)!;
  t.kind = kind === "VIEW" ? "view" : "table"; t.origin = "static"; t.columns ??= new Map();
  if (target?.type !== "Schema") { if (kind === "VIEW") t.columns = null; return; }
  for (const e of children(target, "expressions")) {
    if (e.type === "ColumnDef") {
      const name = identifier(child(e, "this"));
      if (!name) continue;
      t.columns!.set(name, { type: dataType(child(e, "kind")), pk: false, fk: false, origin: "static" });
      for (const cc of children(e, "constraints")) {
        const k = child(cc, "kind");
        if (k?.type === "PrimaryKeyColumnConstraint") markCols(b, id, [name], "pk");
        if (k?.type === "Reference") { markCols(b, id, [name], "fk"); addForeignKey(b, id, [name], k, undefined); }
      }
    } else constraint(b, id, e);
  }
}
function readAlter(b: Builder, tree: SqlNode): void {
  const parts = tableParts(child(tree, "this"));
  if (!parts) return;
  const id = ensureTable(b, parts, false);
  for (const a of children(tree, "actions")) for (const e of a.type === "AddConstraint" ? children(a, "expressions") : []) constraint(b, id, e);
}
/** JOIN … ON x.a = y.b: aliases resolved inside the statement only; never a catalog lookup. */
function readJoins(b: Builder, tree: SqlNode): void {
  const stack: SqlNode[] = [tree];
  while (stack.length) {
    const n = stack.pop()!;
    for (const kids of n.args.values()) stack.push(...kids);
    if (n.type !== "Select") continue;
    const sources = [...children(n, "from_"), ...children(n, "from")].flatMap(f => children(f, "this")).concat(children(n, "joins").flatMap(j => children(j, "this")));
    const alias = new Map<string, string[]>();
    for (const s of sources) {
      const parts = tableParts(s);
      if (!parts) continue;
      alias.set(norm(parts[parts.length - 1]!), parts);
      const a = identifier(child(child(s, "alias") ?? s, "this"));
      if (child(s, "alias") && a) alias.set(norm(a), parts);
    }
    for (const j of children(n, "joins")) {
      const eqs: SqlNode[] = []; const st = children(j, "on").slice();
      while (st.length) { const e = st.pop()!; if (e.type === "EQ") eqs.push(e); else if (e.type === "And" || e.type === "Paren") for (const k of e.args.values()) st.push(...k); }
      for (const eq of eqs) {
        const [l, r] = [child(eq, "this"), child(eq, "expression")];
        if (l?.type !== "Column" || r?.type !== "Column") continue;
        const side = (c: SqlNode) => { const q = identifier(child(c, "table")); const p = q ? alias.get(norm(q)) : undefined; const col = identifier(child(c, "this")); return p && col ? { id: ensureTable(b, p, false), col } : null; };
        const [a, z] = [side(l), side(r)];
        if (!a || !z || a.id === z.id) continue;
        for (const s of [a, z]) { const t = b.tables.get(s.id)!; if (t.origin === "theoretical") { t.columns ??= new Map(); if (![...t.columns.keys()].some(k => norm(k) === norm(s.col))) t.columns.set(s.col, { type: null, pk: false, fk: false, origin: "theoretical" }); } }
        b.edges.push({ id: `join:${a.id}(${norm(a.col)})~${z.id}(${norm(z.col)})`, from: a.id, fromColumns: [a.col], to: z.id, toColumns: [z.col], declared: false, origin: "theoretical", cardinality: null });
      }
    }
  }
}

const same = (x: readonly string[], y: readonly string[]): boolean => x.length === y.length && x.every((c, i) => norm(c) === norm(y[i]!));
function pkOf(t: ErdTable | undefined): string[] { return t?.columns?.filter(c => c.pk).map(c => c.name) ?? []; }

/** The `schema-erd` provider: pure function of the facts the host already holds. */
export function schemaErd(input: SchemaErdInput): SchemaErdData {
  const b: Builder = { tables: new Map(), edges: [] };
  const holes: ErdHole[] = [];
  const isPowerBi = input.artifactKind === "powerbi";
  if (input.sqlFacts === undefined) {
    if (!isPowerBi) holes.push({ kind: "missing-fact", field: SQL_SYNTAX_FACTS, reason: "No SQL syntax facts for this location: run the SQL analysis to list tables, columns and keys." });
  } else {
    for (const [i, raw] of input.sqlFacts.entries()) {
      const r = validateSqlSyntaxFacts(raw);
      if (!r.ok) { holes.push({ kind: "invalid-fact", field: SQL_SYNTAX_FACTS, reason: `SQL facts #${i + 1} rejected by the validator.` }); continue; }
      if (r.value.facts.kind === "parse-error") { holes.push({ kind: "parse-error", field: r.value.facts.artifactId, reason: "SQL did not parse; its tables are not shown." }); continue; }
      for (const tree of r.value.trees) { if (tree.type === "Create") readCreate(b, tree); if (tree.type === "Alter") readAlter(b, tree); readJoins(b, tree); }
    }
  }
  for (const rel of input.semanticRelationships ?? []) {
    const ensure = (name: string, col: string) => { const id = ensureTable(b, name.split("."), false); const t = b.tables.get(id)!; t.columns ??= new Map(); if (![...t.columns.keys()].some(k => norm(k) === norm(col))) t.columns.set(col, { type: null, pk: false, fk: false, origin: "static" }); return id; };
    const from = ensure(rel.fromTable, rel.fromColumn); const to = ensure(rel.toTable, rel.toColumn);
    b.edges.push({ id: `rel:${from}(${norm(rel.fromColumn)})->${to}(${norm(rel.toColumn)})`, from, fromColumns: [rel.fromColumn], to, toColumns: [rel.toColumn],
      declared: true, origin: "static", cardinality: rel.cardinality ?? null, ...(rel.name ? { name: rel.name } : {}) });
  }
  if (isPowerBi && input.semanticRelationships === undefined)
    holes.push({ kind: "missing-fact", field: SEMANTIC_RELATIONSHIPS_FACT, reason: "No analyzer emits semantic-model tables and relationships yet." });

  const tables: ErdTable[] = [...b.tables.entries()].map(([id, t]) => ({ id, name: t.name, kind: t.kind, origin: t.origin,
    columns: t.columns ? [...t.columns.entries()].map(([name, c]) => ({ name, ...c })) : null }));
  const byId = new Map(tables.map(t => [t.id, t]));
  // Dedupe (inline REFERENCES + table FOREIGN KEY on the same columns) and drop joins a declared key already covers.
  const seen = new Set<string>(); const edges: ErdEdge[] = [];
  const declared = b.edges.filter(e => e.declared);
  for (const e of b.edges) {
    if (seen.has(e.id)) continue; seen.add(e.id);
    if (!e.declared && declared.some(d => (d.from === e.from && d.to === e.to && same(d.fromColumns, e.fromColumns) && same(d.toColumns, e.toColumns))
      || (d.from === e.to && d.to === e.from && same(d.fromColumns, e.toColumns) && same(d.toColumns, e.fromColumns)))) continue;
    let cardinality = e.cardinality;
    if (e.declared && !cardinality && byId.get(e.to)?.columns) {
      const toPk = pkOf(byId.get(e.to));
      if (toPk.length && same(toPk, e.toColumns)) cardinality = same(pkOf(byId.get(e.from)), e.fromColumns) ? "one-to-one" : "many-to-one";
    }
    edges.push({ ...e, cardinality });
  }
  for (const t of tables) if (t.columns === null)
    holes.push({ kind: "missing-columns", field: t.name, reason: `No CREATE ${t.kind === "view" ? "VIEW column list" : "TABLE"} among the facts: columns unknown.` });
  if (tables.length && !tables.some(t => t.columns?.some(c => c.pk)))
    holes.push({ kind: "missing-keys", reason: "No declared primary key among the facts; edges are joins only." });
  return { source: SCHEMA_ERD_SOURCE, origin: "static", graph: { kind: "erd", tables, edges }, holes };
}
