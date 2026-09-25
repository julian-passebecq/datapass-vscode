/**
 * Project sheet (0.15): what is specific to one project and useful to everyone working on it, in
 * one small file an AI or a person keeps up to date. Pure.
 *
 *   .datapass/sheet.json
 *     datasets   tables, collections and file sets: where they live, order of magnitude
 *                (rows, size, files, growth) and the columns that matter
 *     formulas   the project's formulas as written by the project (text or LaTeX), their
 *                variables and units, and where the code computes them
 *     runtimes   where code runs (a VM, Docker on a PC, a Databricks cluster…) and how to reach it
 *     glossary   the project's words
 *
 * DataPass shows these declarations next to the components they belong to and gives them to the AI
 * in preparation packs. It never evaluates a formula, never counts rows and never connects to a
 * database: the numbers are what the project says, with the date it said it.
 */
import { arr, constOf, enumOf, ID, obj, TEXT, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import type { ProjectGraph } from "../workspace/graph";
import type { DataPassProjectManifest } from "../projectManifestModel";
import type { MapProblem } from "./projectMap";

export const SHEET_PATH = ".datapass/sheet.json";
export const SHEET_FORMAT = "datapass.sheet";

const SHORT: Schema = { type: "string", minLength: 1, maxLength: 200 };
const MAGNITUDE: Schema = { type: "string", minLength: 1, maxLength: 80 };
const HTTPS: Schema = { type: "string", maxLength: 2000, pattern: "^https://\\S+$" };
const DATE: Schema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const REL_PATH: Schema = { type: "string", minLength: 1, maxLength: 400, pattern: "^(?![/\\\\~])(?![A-Za-z]:)(?!.*(^|[/\\\\])\\.\\.([/\\\\]|$)).+$" };

export const COLUMN_ROLES = ["key", "foreign-key", "partition", "time", "measure", "dimension", "text", "vector", "important"] as const;
export const DATASET_KINDS = ["table", "collection", "files", "view", "stream", "index", "other"] as const;

const COLUMN: Schema = obj({ name: SHORT, type: SHORT, unit: SHORT, role: enumOf(...COLUMN_ROLES), meaning: TEXT }, ["name"]);
const DATASET: Schema = obj({
  id: ID, label: SHORT, componentId: ID, kind: enumOf(...DATASET_KINDS),
  rows: MAGNITUDE, size: MAGNITUDE, files: MAGNITUDE, growth: MAGNITUDE, refresh: MAGNITUDE, asOf: DATE,
  columns: arr(COLUMN, 100), producedBy: arr(ID, 20), consumedBy: arr(ID, 20),
  classification: enumOf("public", "internal", "confidential"), notes: TEXT
}, ["id", "label"]);
const VARIABLE: Schema = obj({ symbol: SHORT, meaning: TEXT, unit: SHORT }, ["symbol"]);
const FORMULA: Schema = obj({
  id: ID, label: SHORT, expression: { type: "string", minLength: 1, maxLength: 2000 },
  variables: arr(VARIABLE, 60), result: obj({ symbol: SHORT, meaning: TEXT, unit: SHORT }, []),
  componentId: ID, where: obj({ repoRef: ID, path: REL_PATH, symbol: SHORT }, ["path"]),
  source: SHORT, reference: HTTPS, validation: TEXT, notes: TEXT
}, ["id", "label", "expression"]);
const RUNTIME: Schema = obj({
  id: ID, label: SHORT, componentId: ID, host: SHORT, specs: SHORT, os: SHORT, region: SHORT,
  runs: arr(ID, 50), access: SHORT, cost: SHORT, decisionRef: ID, notes: TEXT
}, ["id", "label"]);
const TERM: Schema = obj({ term: SHORT, meaning: TEXT }, ["term", "meaning"]);

export const SHEET_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: constOf(SHEET_FORMAT), version: constOf("1"), summary: TEXT, asOf: DATE,
  datasets: arr(DATASET, 200), formulas: arr(FORMULA, 200), runtimes: arr(RUNTIME, 50), glossary: arr(TERM, 200)
}, ["format", "version"]);

export interface SheetColumn { name: string; type?: string; unit?: string; role?: typeof COLUMN_ROLES[number]; meaning?: string }
export interface SheetDataset {
  id: string; label: string; componentId?: string; kind?: typeof DATASET_KINDS[number];
  rows?: string; size?: string; files?: string; growth?: string; refresh?: string; asOf?: string;
  columns?: SheetColumn[]; producedBy?: string[]; consumedBy?: string[];
  classification?: "public" | "internal" | "confidential"; notes?: string;
}
export interface SheetFormula {
  id: string; label: string; expression: string;
  variables?: Array<{ symbol: string; meaning?: string; unit?: string }>;
  result?: { symbol?: string; meaning?: string; unit?: string };
  componentId?: string; where?: { repoRef?: string; path: string; symbol?: string };
  source?: string; reference?: string; validation?: string; notes?: string;
}
export interface SheetRuntime {
  id: string; label: string; componentId?: string; host?: string; specs?: string; os?: string; region?: string;
  runs?: string[]; access?: string; cost?: string; decisionRef?: string; notes?: string;
}
export interface ProjectSheet {
  $schema?: string; format: typeof SHEET_FORMAT; version: "1"; summary?: string; asOf?: string;
  datasets?: SheetDataset[]; formulas?: SheetFormula[]; runtimes?: SheetRuntime[]; glossary?: Array<{ term: string; meaning: string }>;
}

export class SheetError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

/** A runtime's access line names an SSH alias or a tool, never an address with credentials or a key. */
function credentialShaped(value: string): boolean {
  return /:\/\/[^/\s]*@/.test(value) || /(password|passwd|secret|token|accountkey|sharedaccesskey|sig=|-----BEGIN)/i.test(value);
}

export function parseSheet(raw: string | Uint8Array): ProjectSheet {
  const doc = parseStrictJson(raw, { maxBytes: 2 * 1024 * 1024, maxEntries: 200_000 });
  const issues = validateSchema(SHEET_SCHEMA, doc);
  if (issues.length) throw new SheetError("Invalid project sheet", issues);
  const sheet = doc as ProjectSheet;
  for (const [kind, list] of [["dataset", sheet.datasets], ["formula", sheet.formulas], ["runtime", sheet.runtimes]] as const) {
    const ids = (list ?? []).map(x => x.id);
    if (new Set(ids).size !== ids.length) throw new SheetError(`Duplicate ${kind} id`);
  }
  for (const r of sheet.runtimes ?? []) if (r.access && credentialShaped(r.access)) throw new SheetError(`runtime ${r.id}: access looks like a credential; name the SSH alias or the tool, never a password, key or token`);
  for (const d of sheet.datasets ?? []) {
    const cols = (d.columns ?? []).map(c => c.name);
    if (new Set(cols).size !== cols.length) throw new SheetError(`dataset ${d.id} lists a column twice`);
  }
  return sheet;
}

/** References the graph or the manifest do not know (warnings: the graph may be updated separately). */
export function sheetProblems(sheet: ProjectSheet, manifest: DataPassProjectManifest | undefined, graph: ProjectGraph | undefined, decisionIds: readonly string[] = []): MapProblem[] {
  const out: MapProblem[] = [];
  const items = new Set((graph?.items ?? []).map(i => i.id));
  const repos = new Set(Object.keys(manifest?.repositories ?? {}));
  const unknown = (where: string, id: string, what = "component of graph.json") => out.push({ severity: "warning", where: `sheet.json ${where}`, message: `"${id}" is not a ${what}.` });
  for (const d of sheet.datasets ?? []) {
    if (d.componentId && !items.has(d.componentId)) unknown(`datasets.${d.id}`, d.componentId);
    for (const id of [...(d.producedBy ?? []), ...(d.consumedBy ?? [])]) if (!items.has(id)) unknown(`datasets.${d.id}`, id);
  }
  for (const f of sheet.formulas ?? []) {
    if (f.componentId && !items.has(f.componentId)) unknown(`formulas.${f.id}`, f.componentId);
    if (f.where?.repoRef && !repos.has(f.where.repoRef)) unknown(`formulas.${f.id}`, f.where.repoRef, "repository declared in project.json");
  }
  for (const r of sheet.runtimes ?? []) {
    if (r.componentId && !items.has(r.componentId)) unknown(`runtimes.${r.id}`, r.componentId);
    for (const id of r.runs ?? []) if (!items.has(id)) unknown(`runtimes.${r.id}`, id);
    if (r.decisionRef && !decisionIds.includes(r.decisionRef)) unknown(`runtimes.${r.id}`, r.decisionRef, "decision of options.json");
  }
  return out;
}

export interface ComponentSheet { datasets: SheetDataset[]; formulas: SheetFormula[]; runtimes: SheetRuntime[] }

/** What the sheet says about one component: data it holds, produces or reads, formulas computed there, where it runs. */
export function sheetFor(sheet: ProjectSheet | undefined, componentId: string): ComponentSheet {
  if (!sheet) return { datasets: [], formulas: [], runtimes: [] };
  return {
    datasets: (sheet.datasets ?? []).filter(d => d.componentId === componentId || d.producedBy?.includes(componentId) || d.consumedBy?.includes(componentId)),
    formulas: (sheet.formulas ?? []).filter(f => f.componentId === componentId),
    runtimes: (sheet.runtimes ?? []).filter(r => r.componentId === componentId || r.runs?.includes(componentId))
  };
}

/** One line for a dataset's volume: "≈ 2 M rows · 5 GB · +50k/month". */
export function volumeLine(d: SheetDataset): string {
  return [d.rows ? `${d.rows} rows` : undefined, d.files ? `${d.files} files` : undefined, d.size, d.growth ? `growth ${d.growth}` : undefined].filter(Boolean).join(" · ");
}
