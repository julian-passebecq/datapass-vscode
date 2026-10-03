/**
 * V4-NAV NAVCAT1: the view catalog a person sees. One entry per (artifact kind, level); precedence
 * user override > project catalog > built-in DEFAULT_VIEW_CATALOG. `mergeCatalogs` builds the catalog
 * (later layers replace the entries they name); the user's `.datapass/views.json`
 * (`datapass.view-overrides/1`: hide, add, reorder, rename) is held by the NavigationService
 * (`nav.overrides`, written through `nav.setCatalog`) and applied by `resolveViews` ('*' then the kind).
 * Reset = drop the entry (or the whole file).
 *
 * An invalid overrides file never breaks navigation: it yields warnings and the defaults. Labels,
 * titles and presets are data here, never hard-coded in a view. Pure (no `vscode`); the commands and
 * the file watcher are in catalogCommands.ts.
 */
import { arr, constOf, enumOf, obj, type Schema } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import {
  DEFAULT_VIEW_CATALOG, LAYOUT_KINDS, NAV_LEVELS, resolveViews, validateViewOverrides,
  type NavLevel, type NavLocation, type ViewCatalog, type ViewOverrideEntry, type ViewOverrides
} from "./navTypes";

export const VIEW_OVERRIDES_PATH = ".datapass/views.json";
export const VIEW_OVERRIDES_FORMAT = "datapass.view-overrides/1";
export const VIEW_OVERRIDES_MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 200;
const MAX_VIEWS = 60;

export type ViewCatalogEntry = ViewCatalog["entries"][number];

const VIEW_ID: Schema = { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,79}$" };
const KIND: Schema = { type: "string", pattern: "^(\\*|[a-z][a-z0-9_.-]{0,79})$" };
const TITLE: Schema = { type: "string", minLength: 1, maxLength: 120 };
const SOURCE: Schema = { type: "string", pattern: "^[a-z][a-z0-9-]{0,79}$" };
const BINDING: Schema = obj({ source: SOURCE }, ["source"]);
const VIEW: Schema = obj({
  id: VIEW_ID, title: TITLE, layout: enumOf(...LAYOUT_KINDS), bindings: arr(BINDING, 20),
  metrics: arr(VIEW_ID, 40), preset: VIEW_ID, surface: { type: "string", minLength: 1, maxLength: 200 },
  description: { type: "string", minLength: 1, maxLength: 1000 }
}, ["id", "title", "layout", "bindings"]);
const ENTRY: Schema = obj({
  artifactKind: KIND, level: enumOf(...NAV_LEVELS), order: arr(VIEW_ID, MAX_VIEWS), hidden: arr(VIEW_ID, MAX_VIEWS), add: arr(VIEW, MAX_VIEWS)
}, ["artifactKind", "level"]);
/** Editor-side schema (stricter than the runtime check, so what editors accept the runtime accepts). */
export const VIEW_OVERRIDES_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 }, schema: constOf(VIEW_OVERRIDES_FORMAT), entries: arr(ENTRY, MAX_ENTRIES)
}, ["schema", "entries"]);

/** The schema editors validate against (package.json `jsonValidation`): the DSL schema plus the two maps. */
export function viewOverridesEditorSchema(): unknown {
  const s = structuredClone(VIEW_OVERRIDES_SCHEMA) as any;
  const entry = s.properties.entries.items;
  entry.properties.titles = { type: "object", maxProperties: MAX_VIEWS, propertyNames: VIEW_ID, additionalProperties: TITLE };
  entry.properties.add.items.properties.bindings.items.properties.params = { type: "object", maxProperties: 30 };
  return s;
}

export interface OverridesResult { readonly overrides: ViewOverrides | null; readonly warnings: readonly string[] }

/**
 * Parse `.datapass/views.json` with the view-spi contract check (`validateViewOverrides`: schema, one
 * entry per (kind, level), unique added ids). Never throws: an absent file is `null` with no warning;
 * an invalid one is `null` plus readable warnings (the person then sees the defaults). The `$schema`
 * editor hint is accepted and dropped.
 */
export function parseViewOverrides(raw: string | Uint8Array | undefined): OverridesResult {
  if (raw === undefined) return { overrides: null, warnings: [] };
  let doc: unknown;
  try { doc = parseStrictJson(raw, { maxBytes: VIEW_OVERRIDES_MAX_BYTES, maxDepth: 10 }); }
  catch (e) { return { overrides: null, warnings: [`${VIEW_OVERRIDES_PATH} is not valid JSON: ${(e as Error).message}`] }; }
  if (doc && typeof doc === "object" && !Array.isArray(doc) && "$schema" in doc) {
    const { $schema, ...rest } = doc as Record<string, unknown>;
    if (typeof $schema !== "string") return { overrides: null, warnings: [`${VIEW_OVERRIDES_PATH} /$schema must be a string`] };
    doc = rest;
  }
  const r = validateViewOverrides(doc);
  if (!r.ok) return { overrides: null, warnings: r.issues.slice(0, 5).map(i => `${VIEW_OVERRIDES_PATH} ${i.pointer || "/"} ${i.code}`) };
  return { overrides: r.value, warnings: [] };
}

const keyOf = (e: Pick<ViewCatalogEntry, "artifactKind" | "level">) => `${e.artifactKind}\u0000${e.level}`;

/**
 * Built-in catalog, then each layer (view packs, the project catalog) in order: exactly one entry per
 * (kind, level), a later layer REPLACES the entry it names. User overrides are not merged here: the
 * NavigationService holds them (`nav.overrides`) and `resolveViews` applies them on top.
 */
export function mergeCatalogs(base: ViewCatalog, ...layers: readonly (readonly ViewCatalogEntry[])[]): ViewCatalog {
  const byKey = new Map<string, ViewCatalogEntry>();
  for (const e of [...base.entries, ...layers.flat()]) byKey.set(keyOf(e), e);
  return { schema: base.schema, entries: [...byKey.values()] };
}

/** The entry a location is customized by: its kind, or "*" when the location has none. */
export const entryKey = (l: Pick<NavLocation, "artifactKind" | "level">) => ({ artifactKind: l.artifactKind || "*", level: l.level });

const findEntry = (o: ViewOverrides | null, l: Pick<NavLocation, "artifactKind" | "level">) => {
  const k = entryKey(l);
  return o?.entries.find(e => e.artifactKind === k.artifactKind && e.level === k.level);
};

/** A pre-filled entry for "Customize views": the views shown now, in order, titles listed so they are easy to rename. */
export function entryTemplate(catalog: ViewCatalog, overrides: ViewOverrides | null, l: Pick<NavLocation, "artifactKind" | "level">): ViewOverrideEntry {
  const existing = findEntry(overrides, l);
  if (existing) return existing;
  const k = entryKey(l);
  const views = resolveViews(catalog, overrides, k.artifactKind, k.level);
  return { ...k, order: views.map(v => v.id), hidden: [], titles: Object.fromEntries(views.map(v => [v.id, v.title])) };
}

const upsert = (o: ViewOverrides | null, entry: ViewOverrideEntry): ViewOverrides => {
  const entries = [...(o?.entries ?? [])];
  const i = entries.findIndex(e => e.artifactKind === entry.artifactKind && e.level === entry.level);
  if (i >= 0) entries[i] = entry; else entries.push(entry);
  return { schema: VIEW_OVERRIDES_FORMAT, entries };
};

/** Overrides with the location's entry present (pre-filled when new). */
export function withEntry(catalog: ViewCatalog, o: ViewOverrides | null, l: Pick<NavLocation, "artifactKind" | "level">): ViewOverrides {
  return upsert(o, entryTemplate(catalog, o, l));
}

/** Hide one view at a location. */
export function hideView(o: ViewOverrides | null, l: Pick<NavLocation, "artifactKind" | "level">, viewId: string): ViewOverrides {
  const e: ViewOverrideEntry = findEntry(o, l) ?? entryKey(l);
  const hidden = e.hidden ?? [];
  return upsert(o, { ...e, hidden: hidden.includes(viewId) ? hidden : [...hidden, viewId] });
}

/** Reset one location (drop its entry), or every location (`l` undefined). */
export function resetViews(o: ViewOverrides | null, l?: Pick<NavLocation, "artifactKind" | "level">): ViewOverrides {
  if (!l) return { schema: VIEW_OVERRIDES_FORMAT, entries: [] };
  const drop = findEntry(o, l);
  return { schema: VIEW_OVERRIDES_FORMAT, entries: (o?.entries ?? []).filter(e => e !== drop) };
}

/** Whether a location carries its own override (the reset "this location" choice is offered only then). */
export const hasEntry = (o: ViewOverrides | null, l: Pick<NavLocation, "artifactKind" | "level">) => !!findEntry(o, l);

export function serializeOverrides(o: ViewOverrides): string {
  return JSON.stringify(o, null, 2) + "\n";
}

export { DEFAULT_VIEW_CATALOG, type NavLevel };
