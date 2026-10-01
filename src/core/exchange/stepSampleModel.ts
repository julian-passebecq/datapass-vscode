/**
 * V5 PQSAMP1: the node-free part of the step data sample (types, labels, the X-Ray reader, the X-Ray-first
 * resolver, the caption) so the webview layout can import it. Request/answer of the AI exchange: stepSample.ts.
 */
export const XRAY_SAMPLE_FORMAT = "datapass.xray-sample/1";
export const STEP_SAMPLE_REQUEST_FORMAT = "datapass.step-sample-request/1";
export const STEP_SAMPLE_ANSWER_FORMAT = "datapass.step-sample/1";
export const SAMPLE_MAX_ROWS = 50;
export const SAMPLE_MAX_COLUMNS = 40;
export const SAMPLE_MAX_CELL = 200;

export type SampleCell = string | number | boolean | null;

export type StepSample =
  | { readonly state: "sample"; readonly source: "xray"; readonly origin: "observed"; readonly file: string; readonly engine: string;
      readonly columns: readonly string[]; readonly rows: readonly (readonly SampleCell[])[]; readonly truncated: boolean }
  | { readonly state: "sample"; readonly source: "exchange"; readonly origin: "ai-proposed"; readonly requestDigest: string;
      readonly columns: readonly string[]; readonly rows: readonly (readonly SampleCell[])[]; readonly truncated: boolean }
  | { readonly state: "hole"; readonly reason: string };

export interface StepSampleLabels {
  readonly hole: string;
  readonly xrayCaption: string;
  readonly aiCaption: string;
  readonly truncated: string;
}

export const DEFAULT_STEP_SAMPLE_LABELS: StepSampleLabels = {
  hole: "No sample: pick a local data file (Data X-Ray) or ask your AI through the exchange.",
  xrayCaption: "Sample of {file} ({engine})",
  aiCaption: "AI-proposed sample, not read from your data",
  truncated: "more rows not shown"
};

function cell(v: unknown): SampleCell | undefined {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v === "string") return v.length > SAMPLE_MAX_CELL ? `${v.slice(0, SAMPLE_MAX_CELL)}…` : v;
  return undefined;
}

/** Columns + rows from untrusted JSON, bounded; undefined when malformed. */
export function readTable(raw: Record<string, unknown>): { columns: string[]; rows: SampleCell[][]; truncated: boolean } | undefined {
  const { columns, rows } = raw;
  if (!Array.isArray(columns) || !columns.length || !columns.every(c => typeof c === "string") || !Array.isArray(rows)) return undefined;
  const cols = (columns as string[]).slice(0, SAMPLE_MAX_COLUMNS).map(c => c.slice(0, 100));
  const out: SampleCell[][] = [];
  for (const r of rows.slice(0, SAMPLE_MAX_ROWS)) {
    if (!Array.isArray(r)) return undefined;
    const cells = r.slice(0, cols.length).map(cell);
    if (cells.some(c => c === undefined)) return undefined;
    while (cells.length < cols.length) cells.push(null);
    out.push(cells as SampleCell[]);
  }
  return { columns: cols, rows: out, truncated: raw.truncated === true || rows.length > SAMPLE_MAX_ROWS || columns.length > SAMPLE_MAX_COLUMNS };
}

/** Source 1: the value X-Ray's `_sample` command returned; undefined when it is not a valid sample. */
export function readXraySample(raw: unknown): StepSample | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.format !== XRAY_SAMPLE_FORMAT || typeof r.file !== "string") return undefined;
  const t = readTable(r);
  if (!t) return undefined;
  return { state: "sample", source: "xray", origin: "observed", file: r.file.slice(0, 200), engine: typeof r.engine === "string" ? r.engine.slice(0, 60) : "DuckDB", ...t };
}

/** X-Ray first, then the AI exchange, else a typed hole. */
export function resolveStepSample(sources: { readonly xray?: StepSample; readonly ai?: StepSample }, labels: StepSampleLabels = DEFAULT_STEP_SAMPLE_LABELS): StepSample {
  if (sources.xray?.state === "sample") return sources.xray;
  if (sources.ai?.state === "sample") return sources.ai;
  return sources.xray?.state === "hole" ? sources.xray : sources.ai?.state === "hole" ? sources.ai : { state: "hole", reason: labels.hole };
}

/** The caption a view shows above a sample (labels are data). */
export function sampleCaption(s: StepSample, labels: StepSampleLabels = DEFAULT_STEP_SAMPLE_LABELS): string {
  if (s.state === "hole") return s.reason;
  return s.source === "xray" ? labels.xrayCaption.replace("{file}", s.file).replace("{engine}", s.engine) : labels.aiCaption;
}
