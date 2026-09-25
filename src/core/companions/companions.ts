/**
 * Optional companion web apps for the selected scope: Grafana (operational observability) and
 * Mongoku (portfolio / project-resume overview). Pure and deterministic.
 *
 * DataPass builds reviewed links from the project manifest and reads a bounded, user-imported
 * Mongoku context snapshot. It makes no HTTP request, opens no database connection, runs no timer
 * and stores no credential. A link is navigation only: it is not evidence that the service is reachable,
 * that the user is signed in, or that dashboards show fresh data.
 */
import { baseOf, hostLabel, safeAppUrl } from "../model/safeUrl";
import { vetRelativePath } from "../exchange/pathSafety";
import type { DataPassProjectManifest } from "../projectManifestModel";
import { moduleEnabled } from "../modules";

/** Mongoku entity IDs are Mongo-side identifiers (e.g. `foil_it_dev`), not DataPass ids. */
export const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const GRAFANA_UID = /^[A-Za-z0-9_-]{1,40}$/;
export const WHOLE_PROJECT = "project";
export const MAX_DASHBOARDS = 50;

export type CompanionService = "grafana" | "mongoku";

export interface CompanionLink {
  /** Stable within a scope; the command resolves it again from current state before opening. */
  id: string;
  service: CompanionService;
  label: string;
  url: string;
  /** Workspace-relative dashboard-as-code file, when declared. */
  source?: string;
}

export interface GrafanaCompanion { host: string; links: CompanionLink[] }
export interface MongokuCompanion { entityId: string; entitySource: "scope" | "project"; links: CompanionLink[]; needsUrl: boolean }

export interface ResolvedCompanions {
  grafana?: GrafanaCompanion;
  mongoku?: MongokuCompanion;
}

export interface CompanionInput {
  manifest: DataPassProjectManifest | undefined;
  scopeId: string;
  /** `datapass.mongoku.url` user setting: one portfolio app serves every project. Unvalidated here. */
  mongokuUrl?: string;
}

/** Scope applicability: an omitted scopes list means every scope, including the whole project. */
const appliesTo = (scopes: readonly string[] | undefined, scopeId: string) => !scopes?.length || scopes.includes(scopeId);

/** The Mongoku entity the selected scope maps to: scope override first, then the project entity. */
export function mongokuEntityFor(manifest: DataPassProjectManifest | undefined, scopeId: string): { entityId: string; source: "scope" | "project" } | undefined {
  const mongoku = manifest?.companions?.mongoku;
  if (!mongoku || !moduleEnabled(manifest, "mongoku")) return undefined;
  const scoped = mongoku.scopeEntities?.[scopeId];
  if (scoped) return { entityId: scoped, source: "scope" };
  return mongoku.entityId ? { entityId: mongoku.entityId, source: "project" } : undefined;
}

/**
 * Mongoku's documented stable deep link: its home cockpit filtered to one entity,
 * `<base>/?project=<entity_id>` (SvelteKit path routing, see Mongoku-datapass
 * src/routes/+page.svelte projectHref). The base is a validated, query-free address; the only
 * thing DataPass appends is the entity id, which is Mongoku's own identifier.
 */
export function mongokuEntityUrl(base: string, entityId: string): string | undefined {
  const href = safeAppUrl(base);
  if (!href || !PORTABLE_ID.test(entityId)) return undefined;
  return `${baseOf(href)}/?project=${encodeURIComponent(entityId)}`;
}

/** Origin plus path of a Mongoku page address, without its query (for prefilling the setting). */
export function mongokuBaseFrom(pageUrl: unknown): string | undefined {
  if (typeof pageUrl !== "string" || pageUrl.length > 2048) return undefined;
  try {
    const u = new URL(pageUrl);
    if (u.username || u.password) return undefined;
    return safeAppUrl(`${u.origin}${u.pathname}`);
  } catch { return undefined; }
}

export function resolveCompanions(input: CompanionInput): ResolvedCompanions {
  const out: ResolvedCompanions = {};
  const grafana = input.manifest?.platforms?.grafana;
  const grafanaUrl = moduleEnabled(input.manifest, "grafana") ? safeAppUrl(grafana?.url) : undefined;
  if (grafanaUrl) {
    const base = baseOf(grafanaUrl);
    const links: CompanionLink[] = [
      { id: "grafana.home", service: "grafana", label: "Open Grafana", url: `${base}/` },
      { id: "grafana.explore", service: "grafana", label: "Explore (logs, metrics, traces)", url: `${base}/explore` }
    ];
    for (const d of grafana?.dashboards ?? []) {
      if (!GRAFANA_UID.test(d.uid) || !appliesTo(d.scopes, input.scopeId)) continue;
      const source = d.source !== undefined ? vetRelativePath(d.source) : undefined;
      links.push({ id: `grafana.dashboard:${d.uid}`, service: "grafana", label: d.title, url: `${base}/d/${d.uid}`, source: source?.ok ? source.relative : undefined });
    }
    out.grafana = { host: hostLabel(grafanaUrl), links };
  }

  const entity = mongokuEntityFor(input.manifest, input.scopeId);
  if (entity && PORTABLE_ID.test(entity.entityId)) {
    const base = safeAppUrl(input.mongokuUrl?.trim());
    const url = base ? mongokuEntityUrl(base, entity.entityId) : undefined;
    out.mongoku = {
      entityId: entity.entityId, entitySource: entity.source, needsUrl: !url,
      links: url ? [{ id: "mongoku.entity", service: "mongoku", label: "Open in Mongoku", url }] : []
    };
  }
  return out;
}

export function companionLinks(resolved: ResolvedCompanions): CompanionLink[] {
  return [...(resolved.grafana?.links ?? []), ...(resolved.mongoku?.links ?? [])];
}

/**
 * Scopes that map to a Mongoku entity, for the `vscode://…/open?entity=<id>` handler. Only ids
 * declared in this window's manifest can match; the link can select a scope, nothing else.
 */
export function scopesForEntity(manifest: DataPassProjectManifest | undefined, entityId: string): Array<{ id: string; title: string }> {
  const mongoku = manifest?.companions?.mongoku;
  if (!manifest || !mongoku || !moduleEnabled(manifest, "mongoku") || !PORTABLE_ID.test(entityId)) return [];
  const title = (id: string) => id === WHOLE_PROJECT ? `${manifest.project.title} (whole project)` : manifest.scopes?.find(s => s.id === id)?.title;
  const ids = new Set<string>();
  if (mongoku.entityId === entityId) ids.add(WHOLE_PROJECT);
  for (const [scopeId, mapped] of Object.entries(mongoku.scopeEntities ?? {})) if (mapped === entityId) ids.add(scopeId);
  // Only explicit mappings are candidates, and each must still resolve to this entity
  // (scopeEntities.project overrides the project-level entityId).
  return [...ids].flatMap(id => {
    const t = title(id);
    return t && mongokuEntityFor(manifest, id)?.entityId === entityId ? [{ id, title: t }] : [];
  });
}

export type MongokuStatus =
  | { entityId: string; state: "missing" }
  | { entityId: string; state: "invalid"; reason: string }
  | { entityId: string; state: "ok"; context: MongokuContext };

// ---------------------------------------------------------------- manifest validation

/**
 * Validate `platforms.grafana.{url,dashboards}` and `companions`. Scope references must name a
 * declared scope or the whole project, so renaming a scope reports a problem instead of links
 * silently disappearing.
 */
export function validateCompanionSections(doc: Record<string, unknown>, declaredScopes: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const scopeRef = (value: unknown, where: string) => {
    if (typeof value !== "string" || (value !== WHOLE_PROJECT && !declaredScopes.has(value))) issues.push(`${where} must name a declared scope or "${WHOLE_PROJECT}".`);
  };
  const platforms = doc.platforms as Record<string, unknown> | undefined;
  const grafana = platforms && typeof platforms === "object" ? platforms.grafana : undefined;
  if (grafana !== undefined) {
    if (!grafana || typeof grafana !== "object" || Array.isArray(grafana)) issues.push("platforms.grafana must be an object.");
    else {
      const g = grafana as Record<string, unknown>;
      for (const key of ["generatorCommand", "watchPath"]) if (g[key] !== undefined && typeof g[key] !== "string") issues.push(`platforms.grafana.${key} must be a string.`);
      if (g.url !== undefined && !safeAppUrl(g.url)) issues.push("platforms.grafana.url must be https:// (or http://localhost) without credentials, query or fragment.");
      if (g.dashboards !== undefined) {
        if (!Array.isArray(g.dashboards) || g.dashboards.length > MAX_DASHBOARDS) issues.push(`platforms.grafana.dashboards must be an array of at most ${MAX_DASHBOARDS}.`);
        else {
          if (g.url === undefined && g.dashboards.length) issues.push("platforms.grafana.dashboards needs platforms.grafana.url.");
          const seen = new Set<string>();
          g.dashboards.forEach((raw, i) => {
            const d = raw as Record<string, unknown>;
            const where = `platforms.grafana.dashboards[${i}]`;
            if (!d || typeof d !== "object" || Array.isArray(d)) { issues.push(`${where} must be an object.`); return; }
            for (const key of Object.keys(d)) if (!["uid", "title", "scopes", "source"].includes(key)) issues.push(`${where}.${key} is not allowed.`);
            if (typeof d.uid !== "string" || !GRAFANA_UID.test(d.uid)) issues.push(`${where}.uid must be a Grafana dashboard UID (letters, digits, - and _, at most 40).`);
            else if (seen.has(d.uid)) issues.push(`${where}.uid is duplicated.`);
            else seen.add(d.uid);
            if (typeof d.title !== "string" || !d.title.trim() || d.title.length > 100) issues.push(`${where}.title is required (at most 100 characters).`);
            if (d.scopes !== undefined) {
              if (!Array.isArray(d.scopes)) issues.push(`${where}.scopes must be an array.`);
              else d.scopes.forEach((s, j) => scopeRef(s, `${where}.scopes[${j}]`));
            }
            if (d.source !== undefined && (typeof d.source !== "string" || !vetRelativePath(d.source).ok)) issues.push(`${where}.source must be a workspace-relative path.`);
          });
        }
      }
    }
  }

  if (doc.companions !== undefined) {
    const c = doc.companions as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || Array.isArray(c)) return [...issues, "companions must be an object."];
    for (const key of Object.keys(c)) if (key !== "mongoku") issues.push(`companions.${key} is not a known companion.`);
    if (c.mongoku !== undefined) {
      const m = c.mongoku as Record<string, unknown> | null;
      if (!m || typeof m !== "object" || Array.isArray(m)) issues.push("companions.mongoku must be an object.");
      else {
        for (const key of Object.keys(m)) if (!["entityId", "scopeEntities"].includes(key)) issues.push(`companions.mongoku.${key} is not allowed (the Mongoku address is the datapass.mongoku.url user setting).`);
        if (m.entityId !== undefined && (typeof m.entityId !== "string" || !PORTABLE_ID.test(m.entityId))) issues.push("companions.mongoku.entityId must be a Mongoku entity id.");
        if (m.scopeEntities !== undefined) {
          if (!m.scopeEntities || typeof m.scopeEntities !== "object" || Array.isArray(m.scopeEntities)) issues.push("companions.mongoku.scopeEntities must map scope ids to Mongoku entity ids.");
          else for (const [scope, entity] of Object.entries(m.scopeEntities as Record<string, unknown>)) {
            scopeRef(scope, `companions.mongoku.scopeEntities key "${scope}"`);
            if (typeof entity !== "string" || !PORTABLE_ID.test(entity)) issues.push(`companions.mongoku.scopeEntities.${scope} must be a Mongoku entity id.`);
          }
        }
        if (m.entityId === undefined && m.scopeEntities === undefined) issues.push("companions.mongoku needs entityId or scopeEntities.");
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------- Mongoku context snapshot

/**
 * Mongoku's own bounded export, `mongoku.portfolio-context` 0.1-proposal (Mongoku-datapass
 * src/lib/datapass/aiContext.ts, "Developer context" → JSON → Copy). DataPass consumes the format
 * Mongoku actually produces instead of inventing a second one. One project, at most 50 items and
 * 20 sources, credentials scrubbed by the producer.
 *
 * It is imported by the user and stored privately under .datapass/local/mongoku/<scope>.json.
 * Everything in it is untrusted data: shown as a dated report, never as live state, and nothing
 * in it configures DataPass, authorizes a write or changes Mongo.
 */
export const MONGOKU_CONTEXT_FORMAT = "mongoku.portfolio-context";
export const MONGOKU_CONTEXT_VERSION = "0.1-proposal";
export const MAX_MONGOKU_CONTEXT_BYTES = 256 * 1024;
/** After this age a snapshot is shown as old: its next action may no longer be the next action. */
export const MONGOKU_FRESH_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const ITEM_KINDS = ["WORK", "TEST_GATE", "CHANGE", "CONFIG_REFERENCE", "QUESTION"] as const;
const ASSERTIONS = ["OBSERVED", "USER_DECLARED", "AI_PROPOSED", "UNKNOWN"] as const;
const SOURCE_KINDS = ["GITHUB", "MONGO_METADATA", "APP_EXPORT", "USER_REPORT"] as const;
const FRESHNESS = ["CURRENT_FOR_DECLARED_SCOPE", "STALE", "UNKNOWN"] as const;
const PROJECT_FIELDS = ["name", "category", "status", "test_gate", "repo", "branch", "head", "ci", "runtime", "stop_point", "next_action", "mongoku_url"] as const;
const TOP_LEVEL = ["format", "schema_version", "classification", "generated_at", "scope", "purpose", "project", "sources", "items", "exclusions"];

export interface MongokuContextItem { id: string; kind: typeof ITEM_KINDS[number]; summary: string; assertion: typeof ASSERTIONS[number] }
export interface MongokuContextSource { id: string; kind: typeof SOURCE_KINDS[number]; freshness: typeof FRESHNESS[number]; observedAt: string | null }
export interface MongokuContext {
  entityId: string;
  organizationId: string;
  generatedAt: string;
  classification: string;
  purpose: string;
  project: Partial<Record<typeof PROJECT_FIELDS[number], string>> & { name: string };
  items: MongokuContextItem[];
  sources: MongokuContextSource[];
  exclusions: string[];
  /** Fields this version of DataPass does not display; ignored, never interpreted. */
  ignoredFields: string[];
}

export class MongokuContextRejected extends Error {
  constructor(message: string) { super(message); this.name = "MongokuContextRejected"; }
}

const CONTROL_OR_BIDI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
const reject = (message: string): never => { throw new MongokuContextRejected(message); };
const obj = (value: unknown, where: string): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : reject(`${where} must be an object.`);
function str(value: unknown, where: string, max: number, optional = false): string | undefined {
  if (value === undefined || (optional && value === null)) return optional ? undefined : reject(`${where} is required.`);
  if (typeof value !== "string" || value.length > max) return reject(`${where} must be text of at most ${max} characters.`);
  if (CONTROL_OR_BIDI.test(value)) return reject(`${where} contains control or bidirectional-override characters.`);
  return value;
}
function arr(value: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(value)) return reject(`${where} must be an array.`);
  if (value.length > max) return reject(`${where} has more than ${max} entries.`);
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : reject(`${where} must be one of ${allowed.join(", ")}.`);
}
function isoTime(value: unknown, where: string): string {
  const text = str(value, where, 40)!;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) return reject(`${where} must be a UTC timestamp.`);
  return text;
}

/**
 * Validate an already strictly-parsed Mongoku context against the entity the selected scope maps
 * to. Throws MongokuContextRejected with a readable reason; never returns a partly trusted object.
 */
export function parseMongokuContext(value: unknown, expectedEntityId: string, now: number): MongokuContext {
  const doc = obj(value, "The Mongoku context");
  if (doc.format !== MONGOKU_CONTEXT_FORMAT) reject(`Expected format "${MONGOKU_CONTEXT_FORMAT}" (Mongoku → Developer context → JSON → Copy).`);
  if (doc.schema_version !== MONGOKU_CONTEXT_VERSION) reject(`Unsupported Mongoku context version ${JSON.stringify(doc.schema_version)}; this DataPass reads ${MONGOKU_CONTEXT_VERSION}.`);
  const ignoredFields = Object.keys(doc).filter(k => !TOP_LEVEL.includes(k));
  const scope = obj(doc.scope, "scope");
  const entityId = str(scope.project_id, "scope.project_id", 128)!;
  if (!PORTABLE_ID.test(entityId)) reject("scope.project_id is not a Mongoku entity id.");
  if (entityId !== expectedEntityId) reject(`This context is for Mongoku project "${entityId}", but the selected scope maps to "${expectedEntityId}".`);
  const organizationId = str(scope.organization_id, "scope.organization_id", 128)!;
  const generatedAt = isoTime(doc.generated_at, "generated_at");
  if (Date.parse(generatedAt) > now + MAX_CLOCK_SKEW_MS) reject("generated_at is in the future.");

  const p = obj(doc.project, "project");
  const project = { name: str(p.name, "project.name", 200)! } as MongokuContext["project"];
  for (const key of PROJECT_FIELDS) {
    if (key === "name") continue;
    const v = str(p[key], `project.${key}`, 2000, true);
    if (v !== undefined && v.trim()) project[key] = v;
  }
  ignoredFields.push(...Object.keys(p).filter(k => !(PROJECT_FIELDS as readonly string[]).includes(k)).map(k => `project.${k}`));

  const items = arr(doc.items, "items", 50).map((raw, i): MongokuContextItem => {
    const it = obj(raw, `items[${i}]`);
    return { id: str(it.id, `items[${i}].id`, 200)!, kind: oneOf(it.kind, ITEM_KINDS, `items[${i}].kind`), summary: str(it.summary, `items[${i}].summary`, 2000)!, assertion: oneOf(it.assertion, ASSERTIONS, `items[${i}].assertion`) };
  });
  const sources = arr(doc.sources, "sources", 20).map((raw, i): MongokuContextSource => {
    const src = obj(raw, `sources[${i}]`);
    const observed = src.observed_at === null || src.observed_at === undefined ? null : isoTime(src.observed_at, `sources[${i}].observed_at`);
    return { id: str(src.id, `sources[${i}].id`, 500)!, kind: oneOf(src.kind, SOURCE_KINDS, `sources[${i}].kind`), freshness: oneOf(src.freshness, FRESHNESS, `sources[${i}].freshness`), observedAt: observed };
  });
  const exclusions = arr(doc.exclusions, "exclusions", 20).map((e, i) => str(e, `exclusions[${i}]`, 500)!);
  return {
    entityId, organizationId, generatedAt,
    classification: str(doc.classification, "classification", 40)!,
    purpose: str(doc.purpose, "purpose", 2000)!,
    project, items, sources, exclusions, ignoredFields
  };
}

export interface MongokuContextView {
  age: "fresh" | "old";
  /** Freshness Mongoku itself declared for its Mongo entity source. */
  sourceFreshness: typeof FRESHNESS[number];
  work: number;
  testGates: number;
}

/** Evaluated at display time, never cached: an old snapshot stays visibly old. */
export function viewMongokuContext(ctx: MongokuContext, now: number): MongokuContextView {
  const entitySource = ctx.sources.find(s => s.kind === "MONGO_METADATA");
  return {
    age: now - Date.parse(ctx.generatedAt) > MONGOKU_FRESH_MS ? "old" : "fresh",
    sourceFreshness: entitySource?.freshness ?? "UNKNOWN",
    work: ctx.items.filter(i => i.kind === "WORK").length,
    testGates: ctx.items.filter(i => i.kind === "TEST_GATE").length
  };
}

/** "3 h ago", "2 days ago": short and locale-neutral. */
export function ageLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

