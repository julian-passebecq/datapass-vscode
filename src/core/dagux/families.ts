/**
 * DAGUX1: operator families of the Airflow DAG view — one shape, icon and colour per family
 * (sensor, branch, transfer, compute, SQL, trigger, dummy…). The families are data: the default
 * preset is `families.json`, and the `datapass.airflow.dagFamilies` setting overrides a family's
 * fields or adds new ones (tried before the `other` fallback). Pure (no `vscode`).
 */
import preset from "./families.json";

export const DAG_SHAPES = ["rect", "rounded", "pill", "hexagon", "parallelogram", "cylinder", "chevron", "octagon"] as const;
export type DagShape = typeof DAG_SHAPES[number];

export interface DagFamily {
  id: string;
  label: string;
  shape: DagShape;
  /** A bundled diagram icon key (`si:…`, `co:…`), else `glyph` is drawn. */
  icon?: string;
  glyph?: string;
  color: string;
  dashed?: boolean;
  /** Case-insensitive regexes tried on the operator name (or TaskFlow `@task.<flavour>`). */
  match: string[];
  /** Case-sensitive regexes (e.g. `S3ToRedshiftOperator`'s `To`). */
  matchCase?: string[];
}

/** The fallback family: always last, matches every operator. */
export const FALLBACK_FAMILY = "other";

const COLOR = /^#[0-9a-f]{3,8}$/i;

export const DEFAULT_DAG_FAMILIES: readonly DagFamily[] = (preset.families as unknown[]).map(f => sanitize(f)).filter((f): f is DagFamily => !!f);


function strings(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && validRegex(s)) : undefined;
}

function validRegex(s: string): boolean {
  try { new RegExp(s); return s.length <= 200; } catch { return false; }
}

/** One family read from the preset or a setting: unknown fields dropped, bad values replaced by the base's. */
function sanitize(raw: unknown, base?: DagFamily): DagFamily | undefined {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : base?.id;
  if (!id) return undefined;
  const shape = DAG_SHAPES.includes(r.shape as DagShape) ? r.shape as DagShape : base?.shape ?? "rect";
  const color = typeof r.color === "string" && COLOR.test(r.color) ? r.color : base?.color ?? "#8c959f";
  const f: DagFamily = {
    id,
    label: typeof r.label === "string" && r.label ? r.label : base?.label ?? id,
    shape,
    color,
    match: strings(r.match) ?? base?.match ?? []
  };
  const icon = typeof r.icon === "string" ? r.icon : base?.icon;
  const glyph = typeof r.glyph === "string" ? r.glyph.slice(0, 3) : base?.glyph;
  // A setting that gives a glyph replaces the base icon, and the other way round.
  if (typeof r.glyph === "string" && typeof r.icon !== "string") { if (glyph) f.glyph = glyph; }
  else if (typeof r.icon === "string" && typeof r.glyph !== "string") { if (icon) f.icon = icon; }
  else { if (icon) f.icon = icon; if (glyph) f.glyph = glyph; }
  const dashed = typeof r.dashed === "boolean" ? r.dashed : base?.dashed;
  if (dashed) f.dashed = true;
  const matchCase = strings(r.matchCase) ?? base?.matchCase;
  if (matchCase?.length) f.matchCase = matchCase;
  return f;
}

/**
 * The families in matching order: the preset's, each overridden field by field by the setting
 * (`{ "<id>": { "shape": "hexagon", … } }`), then new families from the setting, then `other`.
 */
export function resolveFamilies(override?: unknown, base: readonly DagFamily[] = DEFAULT_DAG_FAMILIES): DagFamily[] {
  const o = override && typeof override === "object" && !Array.isArray(override) ? override as Record<string, unknown> : {};
  const out = base.filter(f => f.id !== FALLBACK_FAMILY).map(f => sanitize(o[f.id], f)!);
  for (const [id, raw] of Object.entries(o)) {
    if (id === FALLBACK_FAMILY || base.some(f => f.id === id) || !raw || typeof raw !== "object") continue;
    const f = sanitize({ ...(raw as object), id });
    if (f) out.push(f);
  }
  const fallback = base.find(f => f.id === FALLBACK_FAMILY);
  out.push(sanitize(o[FALLBACK_FAMILY], fallback ?? { id: FALLBACK_FAMILY, label: "Other operator", shape: "rect", color: "#8c959f", match: [] })!);
  return out;
}

/** The family of an operator: the first whose patterns hit, else the fallback (always last). */
export function familyOf(operator: string, families: readonly DagFamily[]): DagFamily {
  for (const f of families) {
    if (f.id === FALLBACK_FAMILY) continue;
    if (f.match.some(p => new RegExp(p, "i").test(operator)) || f.matchCase?.some(p => new RegExp(p).test(operator))) return f;
  }
  return families.find(f => f.id === FALLBACK_FAMILY) ?? families[families.length - 1]!;
}
