/**
 * V5HOLE19: the project's own objectives and volumetry, read from `.datapass/objectives.json`
 * (`datapass.objectives` v1: `objectives[].title`) and `.datapass/volumetry.json` (`datapass.volumetry` v1:
 * `tables[].table`, `rowsPerDay`, `retentionDays`). They feed the interview brief ("Explain the project").
 * A missing or malformed file gives nothing (the brief then shows its typed hole). Pure (no `vscode`).
 */
import type { Said } from "./rank";

export const OBJECTIVES_FILE = [".datapass", "objectives.json"] as const;
export const VOLUMETRY_FILE = [".datapass", "volumetry.json"] as const;

const MAX_ITEMS = 50;
const MAX_TEXT = 300;

function parse(text: string | undefined, format: string, list: string): readonly unknown[] {
  if (!text) return [];
  try {
    const o = JSON.parse(text) as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || o.format !== format) return [];
    const items = o[list];
    return Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
  } catch { return []; }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_TEXT) : undefined);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** `objectives[].title` as declared facts. */
export function objectivesFromFile(text: string | undefined): Said[] {
  return parse(text, "datapass.objectives", "objectives")
    .map((o) => str((o as { title?: unknown } | null)?.title))
    .filter((t): t is string => !!t)
    .map((text) => ({ text, origin: "declared" }));
}

/** One line per table: `bronze.orders_raw: 120000 rows/day, kept 730 days`. */
export function volumetryFromFile(text: string | undefined): Said[] {
  const out: Said[] = [];
  for (const raw of parse(text, "datapass.volumetry", "tables")) {
    const t = raw as { table?: unknown; rowsPerDay?: unknown; retentionDays?: unknown } | null;
    const table = str(t?.table), rows = count(t?.rowsPerDay), keep = count(t?.retentionDays);
    if (!table || (rows === undefined && keep === undefined)) continue;
    const parts = [...(rows !== undefined ? [`${rows} rows/day`] : []), ...(keep !== undefined ? [`kept ${keep} days`] : [])];
    out.push({ text: `${table}: ${parts.join(", ")}`, origin: "declared" });
  }
  return out;
}
