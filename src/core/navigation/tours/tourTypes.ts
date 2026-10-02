// STUB until REPIN5: verbatim copy of Common view-spi `src/tour.ts` (TOURSPI1 WIP, go/TOUR-PEDA-contract.md § 1).
// The ONE standalone re-export of `datapass.tour/1`; when view-spi is re-pinned this file becomes
// `export { … } from "@juliandatapass-group/view-spi";` and nothing else changes.
import { validate, documentSchema, checked, reject, unwrap, type JsonValue, type Schema, type ValidationResult } from "@juliandatapass-group/semantic-core";
import { navLocationSchema } from "@juliandatapass-group/view-spi";
import type { NavLocation } from "../navTypes";

/**
 * TL-11 guided tours (TOURSPI1). One tour format for the standalone, Studio and the HTML export: a tour is an ordered
 * list of steps (optional nested sub-steps); a step = NavLocation + view id + explanation ref + origin. Titles and
 * explanations are `<scheme>:<key>` refs (go/TOUR-PEDA-contract.md § 3: `text:` → document `texts`, `guide:` → label
 * pack in settings, `concept:`, `decision:`, `showcase:`, `project:`); labels never live in the contract. Feature
 * contract: not minted under schemas/vN until V5FREEZE2. Shared as `.datapass/tours.json`.
 */
export const TOUR_SCHEMA_ID = "datapass.tour/1";
/** Who proposed the step; AI tours arrive only through the exchange as `ai-proposed`. */
export const TOUR_STEP_ORIGINS = Object.freeze(["datapass-guidance", "ai-proposed", "user"] as const);
export type TourStepOrigin = (typeof TOUR_STEP_ORIGINS)[number];
/** TL-12c: learning (guided), interview ("explain the project"), general. Absent = general. Mode labels live in settings. */
export const TOUR_MODES = Object.freeze(["learning", "interview", "general"] as const);
export type TourMode = (typeof TOUR_MODES)[number];
export const TOUR_LIMITS = Object.freeze({ tours: 500, steps: 200, substeps: 50, depth: 4, sections: 100, texts: 5000, textLength: 2000 });
/** Known section slugs (step `section`, `generation` include/exclude). Unknown slugs still validate (forward-compatible); consumers warn. */
export const TOUR_SECTION_IDS = Object.freeze(["explain-project", "objectives", "volumetry", "platforms", "whole-picture", "concept-cards",
  "decision-cards", "query-showcase", "ask-yourself", "model-answers", "business-context", "sample-output"] as const);
export type TourSectionId = (typeof TOUR_SECTION_IDS)[number];
/** TL-12b "The whole picture" spine step ids. */
export const WHOLE_PICTURE_STEP_IDS = Object.freeze(["arrive", "live", "change", "run", "trust"] as const);
export type WholePictureStepId = (typeof WHOLE_PICTURE_STEP_IDS)[number];
/** Text reference `<scheme>:<key>` (TOUR-PEDA § 3). */
export const TOUR_REF_PATTERN = "^[a-z][a-z0-9-]*:\\S{1,240}$";
/** Typed holes reported by `checkTours`: the step (or tour) is dropped and the hole is listed, never thrown. */
export const TOUR_HOLE_KINDS = Object.freeze(["malformed-document", "malformed-tour", "duplicate-tour", "malformed-step",
  "malformed-location", "unknown-location", "unknown-view", "too-deep"] as const);
export type TourHoleKind = (typeof TOUR_HOLE_KINDS)[number];

export interface TourStep {
  /** Slug, unique across all levels of its tour (built-ins always set it). */
  readonly id?: string;
  /** A TOUR_SECTION_IDS slug; drives generation include/exclude. */
  readonly section?: string;
  readonly location: NavLocation; readonly viewId: string; readonly explanationRef: string;
  readonly origin: TourStepOrigin; readonly substeps?: readonly TourStep[];
  /** The viewer may skip this step (TL-12c "everything optional"). */
  readonly optional?: boolean;
}
/** Section ids the AI bridge may fill (`include`) or must not fill (`exclude`); excluded sections stay empty on import. */
export interface TourGeneration { readonly include?: readonly string[]; readonly exclude?: readonly string[] }
export interface Tour {
  readonly id: string; readonly titleRef: string; readonly audience?: string; readonly mode?: TourMode;
  /** Groups tours under NAVTOUR1 journey buttons ("lineage", "execution"). */
  readonly journey?: string;
  readonly generation?: TourGeneration; readonly steps: readonly TourStep[];
}
export interface TourDocument {
  readonly schema: "datapass.tour/1"; readonly tours: readonly Tour[];
  /** Key slug → plain text (≤ 2000 chars): target of `text:<key>` refs (user and ai-proposed text). */
  readonly texts?: Readonly<Record<string, string>>;
}
export interface TourHole {
  readonly kind: TourHoleKind;
  /** JSON pointer into the input document. */
  readonly pointer: string;
  readonly tourId?: string;
  /** Step index path inside the tour, e.g. [2, 0] = first sub-step of the third step. */
  readonly stepPath?: readonly number[];
  readonly viewId?: string;
  readonly location?: NavLocation;
}
export interface TourCheck { readonly document: TourDocument; readonly holes: readonly TourHole[] }
/** Host knowledge used by `checkTours`. Missing members skip that check (structure is always checked). */
export interface TourContext {
  /** View ids offered at a location (built-in catalog + saved views). */
  readonly viewsAt?: (l: NavLocation) => readonly { readonly id: string }[];
  /** Whether the location exists in the current project. */
  readonly locationExists?: (l: NavLocation) => boolean;
}

const slug = str(128, "^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$");
const ref = str(300, TOUR_REF_PATTERN);
const text = str(TOUR_LIMITS.textLength, "^[\\s\\S]+$");
function str(maxLength: number, pattern: string): Schema<string> {
  return { jsonSchema: { type: "string", maxLength, pattern }, read: (v, p) => {
    if (typeof v !== "string" || Array.from(v).length > maxLength || !new RegExp(pattern).test(v)) reject("schema-value", p); return v;
  } };
}
const isObject = (v: unknown): v is Record<string, JsonValue> => v !== null && typeof v === "object" && !Array.isArray(v);
const child = (p: string, k: string | number): string => `${p}/${String(k).replace(/~/g, "~0").replace(/\//g, "~1")}`;

const STEP_KEYS = ["id", "section", "location", "viewId", "explanationRef", "origin", "substeps", "optional"];
const TOUR_KEYS = ["id", "titleRef", "audience", "mode", "journey", "generation", "steps"];
const DOC_KEYS = ["schema", "tours", "texts"];
function readTexts(v: JsonValue, p: string): Readonly<Record<string, string>> {
  if (!isObject(v)) reject("schema-value", p);
  const entries = Object.entries(v as Record<string, JsonValue>);
  if (entries.length > TOUR_LIMITS.texts) reject("schema-value", p);
  return Object.fromEntries(entries.map(([k, x]) => [slug.read(k, child(p, k)), text.read(x, child(p, k))]));
}
function readSections(v: JsonValue, p: string): readonly string[] {
  if (!Array.isArray(v) || v.length > TOUR_LIMITS.sections) reject("schema-value", p);
  const ids = (v as JsonValue[]).map((x, i) => slug.read(x, child(p, i)));
  if (new Set(ids).size !== ids.length) reject("schema-value", p);
  return ids;
}
function readGeneration(v: JsonValue, p: string): TourGeneration {
  if (!isObject(v)) reject("schema-value", p);
  const o = v as Record<string, JsonValue>;
  if (Object.keys(o).some((k) => k !== "include" && k !== "exclude")) reject("unknown-field", p);
  const g: { include?: readonly string[]; exclude?: readonly string[] } = {};
  if (Object.hasOwn(o, "include")) g.include = readSections(o.include!, child(p, "include"));
  if (Object.hasOwn(o, "exclude")) g.exclude = readSections(o.exclude!, child(p, "exclude"));
  if (g.include?.some((id) => g.exclude?.includes(id))) reject("view-spi.tour-generation-conflict", p);
  return g;
}
function readStep(v: JsonValue, p: string, depth: number): TourStep {
  if (!isObject(v)) reject("schema-value", p);
  const o = v as Record<string, JsonValue>;
  if (Object.keys(o).some((k) => !STEP_KEYS.includes(k))) reject("unknown-field", p);
  for (const k of ["location", "viewId", "explanationRef", "origin"]) if (!Object.hasOwn(o, k)) reject("missing-field", child(p, k));
  if (!(TOUR_STEP_ORIGINS as readonly unknown[]).includes(o.origin)) reject("schema-value", child(p, "origin"));
  const step: { -readonly [K in keyof TourStep]: TourStep[K] } = {
    location: navLocationSchema.read(o.location!, child(p, "location")) as NavLocation,
    viewId: slug.read(o.viewId!, child(p, "viewId")), explanationRef: ref.read(o.explanationRef!, child(p, "explanationRef")),
    origin: o.origin as TourStepOrigin
  };
  if (Object.hasOwn(o, "id")) step.id = slug.read(o.id!, child(p, "id"));
  if (Object.hasOwn(o, "section")) step.section = slug.read(o.section!, child(p, "section"));
  if (Object.hasOwn(o, "optional")) {
    if (typeof o.optional !== "boolean") reject("schema-value", child(p, "optional"));
    step.optional = o.optional as boolean;
  }
  if (Object.hasOwn(o, "substeps")) {
    const s = o.substeps;
    if (!Array.isArray(s) || s.length > TOUR_LIMITS.substeps) reject("schema-value", child(p, "substeps"));
    if (depth + 1 >= TOUR_LIMITS.depth && (s as JsonValue[]).length) reject("view-spi.tour-too-deep", child(p, "substeps"));
    step.substeps = (s as JsonValue[]).map((x, i) => readStep(x, child(child(p, "substeps"), i), depth + 1));
  }
  return step;
}
function readTour(v: JsonValue, p: string): Tour {
  if (!isObject(v)) reject("schema-value", p);
  const o = v as Record<string, JsonValue>;
  if (Object.keys(o).some((k) => !TOUR_KEYS.includes(k))) reject("unknown-field", p);
  for (const k of ["id", "titleRef", "steps"]) if (!Object.hasOwn(o, k)) reject("missing-field", child(p, k));
  if (!Array.isArray(o.steps) || o.steps.length > TOUR_LIMITS.steps) reject("schema-value", child(p, "steps"));
  if (Object.hasOwn(o, "mode") && !(TOUR_MODES as readonly unknown[]).includes(o.mode)) reject("schema-value", child(p, "mode"));
  return {
    id: slug.read(o.id!, child(p, "id")), titleRef: ref.read(o.titleRef!, child(p, "titleRef")),
    ...(Object.hasOwn(o, "audience") ? { audience: slug.read(o.audience!, child(p, "audience")) } : {}),
    ...(Object.hasOwn(o, "mode") ? { mode: o.mode as TourMode } : {}),
    ...(Object.hasOwn(o, "journey") ? { journey: slug.read(o.journey!, child(p, "journey")) } : {}),
    ...(Object.hasOwn(o, "generation") ? { generation: readGeneration(o.generation!, child(p, "generation")) } : {}),
    steps: (o.steps as JsonValue[]).map((x, i) => readStep(x, child(child(p, "steps"), i), 0))
  };
}
const stepJsonSchema = {
  type: "object", required: ["location", "viewId", "explanationRef", "origin"], additionalProperties: false,
  properties: {
    id: slug.jsonSchema, section: slug.jsonSchema, location: navLocationSchema.jsonSchema, viewId: slug.jsonSchema, explanationRef: ref.jsonSchema,
    origin: { enum: TOUR_STEP_ORIGINS }, optional: { type: "boolean" }, substeps: { type: "array", maxItems: TOUR_LIMITS.substeps, items: { $ref: "#/$defs/step" } }
  }
};
const sectionsJsonSchema = { type: "array", maxItems: TOUR_LIMITS.sections, uniqueItems: true, items: slug.jsonSchema };
const generationJsonSchema = { type: "object", additionalProperties: false, properties: { include: sectionsJsonSchema, exclude: sectionsJsonSchema } };
/** Strict decoder for a whole `datapass.tour/1` document (nested sub-steps up to TOUR_LIMITS.depth levels). */
export const tourDocumentSchema: Schema<TourDocument> = {
  jsonSchema: {
    type: "object", required: ["schema", "tours"], additionalProperties: false,
    properties: {
      schema: { enum: [TOUR_SCHEMA_ID] },
      tours: { type: "array", maxItems: TOUR_LIMITS.tours, items: {
        type: "object", required: ["id", "titleRef", "steps"], additionalProperties: false,
        properties: { id: slug.jsonSchema, titleRef: ref.jsonSchema, audience: slug.jsonSchema, mode: { enum: TOUR_MODES }, journey: slug.jsonSchema, generation: generationJsonSchema, steps: { type: "array", maxItems: TOUR_LIMITS.steps, items: { $ref: "#/$defs/step" } } }
      } },
      texts: { type: "object", maxProperties: TOUR_LIMITS.texts, propertyNames: slug.jsonSchema, additionalProperties: text.jsonSchema }
    },
    $defs: { step: stepJsonSchema }
  },
  read: (v, p) => {
    if (!isObject(v)) reject("schema-value", p);
    const o = v as Record<string, JsonValue>;
    if (Object.keys(o).some((k) => !DOC_KEYS.includes(k))) reject("unknown-field", p);
    if (o.schema !== TOUR_SCHEMA_ID) reject("schema-value", child(p, "schema"));
    if (!Array.isArray(o.tours) || o.tours.length > TOUR_LIMITS.tours) reject("schema-value", child(p, "tours"));
    return { schema: TOUR_SCHEMA_ID, tours: (o.tours as JsonValue[]).map((t, i) => readTour(t, child(child(p, "tours"), i))),
      ...(Object.hasOwn(o, "texts") ? { texts: readTexts(o.texts!, child(p, "texts")) } : {}) };
  }
};
export const TOUR_JSON_SCHEMA = documentSchema(TOUR_SCHEMA_ID, tourDocumentSchema);

const stepIds = (steps: readonly TourStep[]): string[] => steps.flatMap((s) => [...(s.id === undefined ? [] : [s.id]), ...stepIds(s.substeps ?? [])]);
/** Strict: schema + unique tour ids + step ids unique across all levels of a tour. Use `checkTours` to load a shared/AI file with holes instead of a failure. */
export function validateTourDocument(input: unknown): ValidationResult<TourDocument> {
  return checked(() => {
    const d = unwrap(validate(tourDocumentSchema, input));
    if (new Set(d.tours.map((t) => t.id)).size !== d.tours.length) reject("view-spi.duplicate-tour");
    for (const t of d.tours) { const ids = stepIds(t.steps); if (new Set(ids).size !== ids.length) reject("view-spi.duplicate-step"); }
    return d;
  });
}

/**
 * Lenient load, never throws: keeps every valid tour and step and turns each bad one into a typed hole (malformed
 * tour/step/location, unknown location or view at that location, nesting too deep, duplicate tour or step id; bad
 * `texts` → a `malformed-document` hole at /texts and the texts are dropped). A step with a
 * hole is dropped with its sub-steps; a sub-step hole drops only that sub-step. TL-11: an unknown Location is a hole,
 * never an invented screen.
 */
export function checkTours(input: unknown, ctx: TourContext = {}): TourCheck {
  const holes: TourHole[] = [];
  const empty: TourDocument = { schema: TOUR_SCHEMA_ID, tours: [] };
  const envelope = checked(() => unwrap(validate({ jsonSchema: {}, read: (v: JsonValue) => v }, input)));
  if (!envelope.ok || !isObject(envelope.value) || envelope.value.schema !== TOUR_SCHEMA_ID || !Array.isArray(envelope.value.tours)
    || Object.keys(envelope.value).some((k) => !DOC_KEYS.includes(k))) {
    return { document: empty, holes: [{ kind: "malformed-document", pointer: "" }] };
  }
  let texts: Readonly<Record<string, string>> | undefined;
  const root = envelope.value;
  if (Object.hasOwn(root, "texts")) {
    const r = checked(() => readTexts(root.texts!, "/texts"));
    if (r.ok) texts = r.value; else holes.push({ kind: "malformed-document", pointer: "/texts" });
  }
  const seen = new Set<string>();
  const tours: Tour[] = [];
  const raw = envelope.value.tours.slice(0, TOUR_LIMITS.tours);
  if (envelope.value.tours.length > TOUR_LIMITS.tours) holes.push({ kind: "malformed-document", pointer: "/tours" });
  raw.forEach((t, ti) => {
    const tp = child("/tours", ti);
    const head = isObject(t) && Array.isArray(t.steps)
      ? checked(() => readTour({ ...t, steps: [] }, tp)) : { ok: false as const };
    if (!head.ok) { holes.push({ kind: "malformed-tour", pointer: tp }); return; }
    const tour = head.value;
    if (seen.has(tour.id)) { holes.push({ kind: "duplicate-tour", pointer: tp, tourId: tour.id }); return; }
    seen.add(tour.id);
    const steps = (t as Record<string, JsonValue>).steps as JsonValue[];
    if (steps.length > TOUR_LIMITS.steps) holes.push({ kind: "malformed-tour", pointer: child(tp, "steps"), tourId: tour.id });
    tours.push({ ...tour, steps: loadSteps(steps.slice(0, TOUR_LIMITS.steps), child(tp, "steps"), [], tour.id, ctx, holes, new Set()) });
  });
  return { document: { schema: TOUR_SCHEMA_ID, tours, ...(texts ? { texts } : {}) }, holes };
}

function loadSteps(list: readonly JsonValue[], p: string, path: readonly number[], tourId: string, ctx: TourContext, holes: TourHole[], ids: Set<string>): TourStep[] {
  const out: TourStep[] = [];
  list.forEach((v, i) => {
    const sp = child(p, i);
    const stepPath = [...path, i];
    const hole = (kind: TourHoleKind, extra: Partial<TourHole> = {}): void => { holes.push({ kind, pointer: sp, tourId, stepPath, ...extra }); };
    if (path.length >= TOUR_LIMITS.depth) { hole("too-deep"); return; }
    if (!isObject(v)) { hole("malformed-step"); return; }
    const loc = isObject(v.location) ? checked(() => navLocationSchema.read(v.location!, child(sp, "location")) as NavLocation) : { ok: false as const };
    if (!loc.ok) { hole("malformed-location"); return; }
    const head = checked(() => readStep({ ...v, substeps: [] }, sp, 0));
    if (!head.ok) { hole("malformed-step", { location: loc.value }); return; }
    const { substeps: _drop, ...base } = head.value;
    if (base.id !== undefined && ids.has(base.id)) { hole("malformed-step", { location: base.location }); return; }
    if (ctx.locationExists && !ctx.locationExists(base.location)) { hole("unknown-location", { location: base.location }); return; }
    if (ctx.viewsAt && !ctx.viewsAt(base.location).some((x) => x.id === base.viewId)) {
      hole("unknown-view", { location: base.location, viewId: base.viewId }); return;
    }
    if (base.id !== undefined) ids.add(base.id);
    if (Object.hasOwn(v, "substeps")) {
      const s = v.substeps;
      if (!Array.isArray(s)) { hole("malformed-step", { location: base.location }); return; }
      if (s.length > TOUR_LIMITS.substeps) holes.push({ kind: "malformed-step", pointer: child(sp, "substeps"), tourId, stepPath });
      const subs = loadSteps(s.slice(0, TOUR_LIMITS.substeps), child(sp, "substeps"), stepPath, tourId, ctx, holes, ids);
      out.push(subs.length ? { ...base, substeps: subs } : base);
    } else out.push(base);
  });
  return out;
}
