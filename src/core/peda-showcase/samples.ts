/**
 * V5HOLE13: the project's declared samples for the query showcase. A sample is a small CSV / TSV file under the
 * project's `samples/` folder (the same X-Ray sample CSV PQSAMP1 reads, e.g. `samples/orders_sample.csv`). Only its
 * header and a bounded row count are read: never executed, never sent anywhere.
 *
 * A sample matches a query when its key (file stem without a `_sample` / `-sample` / `.sample` suffix) names a table
 * the query reads or writes: the table's last dotted segment equals the key, or starts with `<key>_` or ends with
 * `_<key>` (`orders` → `stg_orders`, `bronze.orders_raw`). A query with no matching sample keeps its hole.
 * Pure (no `vscode`, no fs): the host reads the files and passes their text in.
 */
import type { SampleOutput } from "./assemble";
import type { QueryFact } from "./score";

/** Files the host looks at, bounds of what it reads. */
export const SAMPLE_DIR = "samples";
export const SAMPLE_FILE = /\.(csv|tsv)$/i;
export const SAMPLE_MAX_FILES = 20;
export const SAMPLE_MAX_BYTES = 256 * 1024;
const MAX_COLUMNS = 40;

export interface DeclaredSample { readonly key: string; readonly sample: SampleOutput }

/** `orders_sample.csv` → `orders`; undefined for a file that is not a sample table. */
export function sampleKey(fileName: string): string | undefined {
  if (!SAMPLE_FILE.test(fileName)) return undefined;
  const key = fileName.replace(SAMPLE_FILE, "").replace(/[._-]sample$/i, "").toLowerCase();
  return key || undefined;
}

function splitHeader(line: string, delimiter: string): string[] {
  return line.split(delimiter).map(c => c.trim().replace(/^"(.*)"$/, "$1").slice(0, 100)).filter(c => c.length > 0);
}

/**
 * One sample from the first bytes of a file. `complete` is false when the host stopped at SAMPLE_MAX_BYTES: the
 * partial last line is dropped and the count is a lower bound. Undefined when the file has no header.
 */
export function readDeclaredSample(fileName: string, text: string, complete = true): DeclaredSample | undefined {
  const key = sampleKey(fileName);
  if (!key) return undefined;
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (!complete) lines.pop();
  const header = lines.shift();
  if (header === undefined) return undefined;
  const columns = splitHeader(header, /\.tsv$/i.test(fileName) ? "\t" : ",");
  if (!columns.length) return undefined;
  const rowCount = lines.filter(l => l.trim().length > 0).length;
  return { key, sample: { columns: columns.slice(0, MAX_COLUMNS), rowCount, origin: "xray-sample", file: `${SAMPLE_DIR}/${fileName}`, ...(complete ? {} : { partial: true }) } };
}

function tableMatches(table: string, key: string): boolean {
  const last = (table.split(".").pop() ?? table).toLowerCase().replace(/[`"[\]]/g, "");
  return last === key || last.startsWith(`${key}_`) || last.endsWith(`_${key}`);
}

/** Fact id → sample: the first declared sample (in the order given) naming a table the query writes, then reads. */
export function matchSamples(facts: readonly QueryFact[], declared: readonly DeclaredSample[]): Map<string, SampleOutput> {
  const out = new Map<string, SampleOutput>();
  for (const f of facts) {
    const hit = declared.find(d => f.tablesWritten.some(t => tableMatches(t, d.key))) ?? declared.find(d => f.tablesRead.some(t => tableMatches(t, d.key)));
    if (hit) out.set(f.id, hit.sample);
  }
  return out;
}
