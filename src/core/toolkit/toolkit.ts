/**
 * The toolkit catalogue (08_TOOLKIT_AND_AGENTS.md sections 5.1, 5.2, 5.4): what each tool is, who
 * publishes it, what it is for, what it costs, and recipes (step-by-step routes that name their
 * tools). Pure.
 *
 *   hub repository   .datapass/toolkit/tools.json       tools, recipes, datapassRequests
 *                    .datapass/toolkit/recipes/*.json   more recipes (same format)
 *
 * The files are data from an AI (ChatGPT through the JSON exchange, or an agent through a pull
 * request): validated, never executed. Every file carries `"format": "datapass.toolkit"` and a format
 * `version`; `requires.datapass` says which DataPass it was written for. Entries are validated one
 * by one: an entry this DataPass does not understand is skipped and reported, never guessed. When
 * the format cannot say what a project needs, the AI adds a `datapassRequests` entry, listed as
 * "Needs a newer DataPass".
 *
 * The extension keeps a built-in baseline (the probe registry, the known non-probed tools and their
 * dated prices), so DataPass works without a hub. The hub layers over it: an entry with the same id
 * changes the shown fields (marked as changed by the hub), never what DataPass probes or runs.
 * Install commands are only copied; prices are dated claims, never authority.
 */
import { anyOf, arr, constOf, enumOf, ID, obj, TEXT, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { isRangeError, parseRange, satisfies, extractVersion } from "../toolchain/versions";
import { TOOL_ID, knownTools, type ToolchainTool } from "../toolchain/toolchain";
import baselineData from "./baseline.json";

export const TOOLKIT_FORMAT = "datapass.toolkit";
export const TOOLKIT_VERSION = "1";
export const TOOLKIT_DIR = ".datapass/toolkit";
export const TOOLKIT_TOOLS_PATH = ".datapass/toolkit/tools.json";
export const TOOLKIT_RECIPES_DIR = ".datapass/toolkit/recipes";
/** The DataPass version that ships the catalogue (what `requires.datapass` is compared with). */
export const TOOLKIT_SINCE = "0.21.0";

export const TOOL_KINDS = ["vscode-extension", "extension-pack", "cli", "python-library", "powershell-module", "desktop-app", "notebook-collection",
  "accelerator", "report-template", "agent-plugin", "mcp-server", "learning", "workspace-file", "cloud-service"] as const;
export const TOOL_STATUS = ["active", "maintenance", "archived", "superseded", "fork"] as const;
export const PUBLISHERS = ["microsoft", "vendor", "community", "workspace"] as const;
export const MODULES = ["develop", "data", "pipelines", "cicd", "monitoring", "governance", "admin", "ai"] as const;
export const MODULE_LABELS: Readonly<Record<Module, string>> = {
  develop: "Develop", data: "Data and storage", pipelines: "Pipelines and orchestration", cicd: "CI/CD and deployment",
  monitoring: "Monitoring and cost", governance: "Governance, quality and security", admin: "Administration", ai: "AI and agents"
};
export const SIDE_EFFECTS = ["reads-remote", "writes-remote", "credential-prompt", "installs-software", "runs-code", "billable"] as const;
export const PRICE_MODELS = ["free", "freemium", "paid", "included", "unknown"] as const;
export const INSTALL_METHODS = ["marketplace", "extension-pack", "winget", "brew", "pip", "npm", "command", "download"] as const;
/** Facts a route's `if` may name that DataPass can evaluate; any other fact is shown, not checked. */
export const KNOWN_FACTS = ["fabric.gitBinding", "databricks.bundle", "git.repository"] as const;

export type ToolKind = typeof TOOL_KINDS[number];
export type ToolStatus = typeof TOOL_STATUS[number];
export type Module = typeof MODULES[number];
export type SideEffect = typeof SIDE_EFFECTS[number];
export type PriceModel = typeof PRICE_MODELS[number];

const SHORT: Schema = { type: "string", minLength: 1, maxLength: 200 };
const DATE: Schema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const LINK: Schema = { type: "string", maxLength: 2000, pattern: "^https://\\S+$" };
const TOOL_REF: Schema = { type: "string", pattern: TOOL_ID.source };
/** One line, copied to the clipboard only: no line break, no backtick. */
const COPY: Schema = { type: "string", minLength: 1, maxLength: 500, pattern: "^[^\\r\\n`]+$" };

const TIER: Schema = obj({ name: SHORT, price: { type: "string", minLength: 1, maxLength: 160 }, features: arr({ type: "string", minLength: 1, maxLength: 300 }, 8), note: TEXT }, ["name", "price"]);
const INSTALL: Schema = obj({
  method: enumOf(...INSTALL_METHODS), id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$" }, tool: TOOL_REF, command: COPY,
  platform: enumOf("windows", "macos", "linux", "all"), where: SHORT
}, ["method"]);

export const TOOL_SCHEMA: Schema = obj({
  id: TOOL_REF, label: SHORT, kind: enumOf(...TOOL_KINDS), publisher: enumOf(...PUBLISHERS), maintainer: SHORT,
  links: obj({ repo: LINK, marketplace: LINK, docs: LINK, home: LINK, pypi: LINK }, []),
  verified: obj({ on: DATE, version: { type: "string", minLength: 1, maxLength: 40 } }, ["on"]),
  status: enumOf(...TOOL_STATUS), replacedBy: TOOL_REF, upstream: TOOL_REF,
  install: arr(INSTALL, 10), modules: arr(enumOf(...MODULES), 8), complements: arr(TOOL_REF, 20), sideEffects: arr(enumOf(...SIDE_EFFECTS), 6),
  useWhen: TEXT, avoidWhen: TEXT, note: TEXT,
  priceModel: enumOf(...PRICE_MODELS), freeTier: { type: "string", minLength: 1, maxLength: 400 }, pricingUrl: LINK, tiers: arr(TIER, 8), checkedAt: DATE
}, ["id"]);

const STEP: Schema = anyOf(
  { type: "string", minLength: 1, maxLength: 500 },
  obj({ text: { type: "string", minLength: 1, maxLength: 500 }, copy: COPY, capability: ID, open: LINK, tool: TOOL_REF }, ["text"])
);
const ROUTE: Schema = obj({
  id: ID, title: SHORT, if: anyOf(obj({ fact: { type: "string", pattern: "^[a-z][a-zA-Z0-9_.-]{0,79}$" } }, ["fact"]), obj({ tool: TOOL_REF }, ["tool"])),
  tools: arr(TOOL_REF, 10), steps: arr(STEP, 30, 1), note: TEXT
}, ["id", "steps"]);
export const RECIPE_SCHEMA: Schema = obj({
  id: ID, module: enumOf(...MODULES), title: SHORT, when: TEXT, tools: arr(TOOL_REF, 20), routes: arr(ROUTE, 8, 1),
  checks: arr({ type: "string", minLength: 1, maxLength: 400 }, 20), risks: arr({ type: "string", minLength: 1, maxLength: 400 }, 20),
  practice: SHORT, verified: obj({ on: DATE }, ["on"])
}, ["id", "module", "title", "routes"]);
const REQUEST: Schema = obj({ title: SHORT, why: TEXT, example: TEXT, module: enumOf(...MODULES) }, ["title", "why"]);

/** The file as editors see it: entries are validated one by one at runtime, so the file schema names them. */
export const TOOLKIT_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 }, format: constOf(TOOLKIT_FORMAT), version: constOf(TOOLKIT_VERSION),
  title: SHORT, description: TEXT, updated: DATE, requires: obj({ datapass: { type: "string", minLength: 1, maxLength: 80 } }, []),
  tools: arr(TOOL_SCHEMA, 500), recipes: arr(RECIPE_SCHEMA, 200), datapassRequests: arr(REQUEST, 50)
}, ["format", "version"]);

export interface Tier { name: string; price: string; features?: string[]; note?: string }
export interface InstallStep { method: typeof INSTALL_METHODS[number]; id?: string; tool?: string; command?: string; platform?: "windows" | "macos" | "linux" | "all"; where?: string }
export interface ToolkitTool {
  id: string; label?: string; kind?: ToolKind; publisher?: typeof PUBLISHERS[number]; maintainer?: string;
  links?: { repo?: string; marketplace?: string; docs?: string; home?: string; pypi?: string };
  verified?: { on: string; version?: string }; status?: ToolStatus; replacedBy?: string; upstream?: string;
  install?: InstallStep[]; modules?: Module[]; complements?: string[]; sideEffects?: SideEffect[];
  useWhen?: string; avoidWhen?: string; note?: string;
  priceModel?: PriceModel; freeTier?: string; pricingUrl?: string; tiers?: Tier[]; checkedAt?: string;
}
export type RecipeStep = string | { text: string; copy?: string; capability?: string; open?: string; tool?: string };
export interface RecipeRoute { id: string; title?: string; if?: { fact: string } | { tool: string }; tools?: string[]; steps: RecipeStep[]; note?: string }
export interface Recipe { id: string; module: Module; title: string; when?: string; tools?: string[]; routes: RecipeRoute[]; checks?: string[]; risks?: string[]; practice?: string; verified?: { on: string } }
export interface DataPassRequest { title: string; why: string; example?: string; module?: Module }

/** One file as DataPass read it: what it could use, and what it skipped (and why). */
export interface ToolkitFileResult {
  path: string;
  title?: string;
  updated?: string;
  requires?: string;
  /** The file asks for a newer DataPass, or is a newer format version. */
  newer?: { what: "datapass" | "format"; text: string };
  /** The file could not be read at all (invalid JSON, not a toolkit file). */
  error?: string;
  tools: ToolkitTool[];
  recipes: Recipe[];
  requests: DataPassRequest[];
  /** Entries left out, with the reason. */
  skipped: string[];
}

export class ToolkitError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

const isCalendar = (s: string) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

/** Rules the schema cannot say; empty when the tool is usable. */
export function toolProblems(t: ToolkitTool): string[] {
  const out: string[] = [];
  const priced = t.priceModel !== undefined || t.freeTier !== undefined || t.tiers !== undefined || t.pricingUrl !== undefined;
  if (priced && !t.checkedAt) out.push("gives prices without checkedAt (the date they were read)");
  for (const d of [t.checkedAt, t.verified?.on]) if (d && !isCalendar(d)) out.push(`"${d}" is not a calendar date`);
  if (t.status === "superseded" && !t.replacedBy) out.push("is superseded without replacedBy");
  if (t.status === "fork" && !t.upstream) out.push("is a fork without upstream");
  for (const i of t.install ?? []) {
    if ((i.method === "marketplace" || i.method === "winget" || i.method === "pip" || i.method === "npm" || i.method === "brew") && !i.id && !i.command) out.push(`install ${i.method} needs an id or a command`);
    if (i.method === "extension-pack" && !i.tool) out.push("install extension-pack needs the pack's tool id");
    if (i.method === "marketplace" && i.id && !/^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(i.id)) out.push(`install marketplace id "${i.id}" is not publisher.name`);
  }
  for (const l of [...Object.values(t.links ?? {}), t.pricingUrl]) if (l && linkIssue(l)) out.push(`link ${linkIssue(l)}`);
  return out;
}

export function recipeProblems(r: Recipe): string[] {
  const out: string[] = [];
  const ids = r.routes.map(x => x.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) out.push(`has route "${dup}" twice`);
  for (const route of r.routes) for (const s of route.steps) if (typeof s !== "string" && s.open && linkIssue(s.open)) out.push(`route ${route.id}: link ${linkIssue(s.open)}`);
  if (r.verified && !isCalendar(r.verified.on)) out.push(`"${r.verified.on}" is not a calendar date`);
  return out;
}

/** Why a link is refused: a committed file never carries a credential or a signature. */
export function linkIssue(url: string): string | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return "is not a valid web address"; }
  if (u.protocol !== "https:") return "must be https://";
  if (u.username || u.password) return "contains a user name or password";
  if (/[?&](sig|token|access_token|code|key|password|secret|se)=/i.test(u.search)) return "carries a token or a signature in its query";
  return undefined;
}

/**
 * Read one toolkit file. Throws only when the file cannot be a toolkit file (invalid JSON, wrong
 * format, top-level fields this DataPass does not know): every entry is validated on its own and a
 * bad one is skipped with its reason. `strict` (the AI import) refuses the file instead.
 */
export function parseToolkitFile(raw: string | Uint8Array, path: string, dataPassVersion: string, strict = false): ToolkitFileResult {
  const doc = parseStrictJson(raw, { maxBytes: 2 * 1024 * 1024, maxEntries: 200_000 }) as Record<string, unknown>;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new ToolkitError("A toolkit file is a JSON object");
  if (doc.format !== TOOLKIT_FORMAT) throw new ToolkitError(`Not a toolkit file: "format" must be "${TOOLKIT_FORMAT}"`);
  const result: ToolkitFileResult = { path, tools: [], recipes: [], requests: [], skipped: [] };
  if (typeof doc.title === "string") result.title = doc.title.slice(0, 200);
  if (doc.version !== TOOLKIT_VERSION) {
    if (typeof doc.version === "string" && /^\d{1,3}$/.test(doc.version) && Number(doc.version) > Number(TOOLKIT_VERSION)) {
      if (strict) throw new ToolkitError(`Format version ${doc.version} is newer than this DataPass reads (${TOOLKIT_VERSION})`);
      result.newer = { what: "format", text: `format version ${doc.version} (this DataPass reads version ${TOOLKIT_VERSION}): nothing in it is used` };
      return result;
    }
    throw new ToolkitError(`"version" must be "${TOOLKIT_VERSION}"`);
  }
  // The frame (everything but the entries) must be exactly this format.
  const frame = { ...doc, tools: [], recipes: [], datapassRequests: [] };
  const frameIssues = validateSchema(TOOLKIT_SCHEMA, frame);
  for (const k of ["tools", "recipes", "datapassRequests"]) if (doc[k] !== undefined && !Array.isArray(doc[k])) frameIssues.push({ path: `$.${k}`, message: "must be an array" } as SchemaIssue);
  if (frameIssues.length) throw new ToolkitError("Invalid toolkit file", frameIssues);
  result.updated = doc.updated as string | undefined;
  const req = (doc.requires as { datapass?: string } | undefined)?.datapass;
  if (req) {
    result.requires = req;
    const range = parseRange(req);
    const v = extractVersion(dataPassVersion);
    if (isRangeError(range)) {
      if (strict) throw new ToolkitError(`requires.datapass ${range.error}`);
      result.newer = { what: "datapass", text: `requires.datapass "${req}" is not a version range this DataPass reads` };
    } else if (v && !satisfies(v, range)) {
      if (strict) throw new ToolkitError(`This file requires DataPass ${req}; this is ${dataPassVersion}`);
      result.newer = { what: "datapass", text: `written for DataPass ${req} (this is ${dataPassVersion}): the entries this DataPass understands are used, the others are skipped` };
    }
  }
  const take = <T>(list: unknown, schema: Schema, what: string, idOf: (x: T) => string, extra: (x: T) => string[], push: (x: T) => void) => {
    const seen = new Set<string>();
    ((list as unknown[] | undefined) ?? []).forEach((x, i) => {
      const issues = validateSchema(schema, x, `${what}[${i}]`);
      const label = (x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") ? `${what} ${(x as { id: string }).id}` : `${what}[${i}]`;
      if (issues.length) { result.skipped.push(`${label}: ${issues.slice(0, 3).map(s => `${s.path} ${s.message}`).join("; ")}`); return; }
      const t = x as T;
      const more = extra(t);
      if (more.length) { result.skipped.push(`${label}: ${more.join("; ")}`); return; }
      const id = idOf(t);
      if (id && seen.has(id)) { result.skipped.push(`${label}: listed twice in this file`); return; }
      if (id) seen.add(id);
      push(t);
    });
  };
  take<ToolkitTool>(doc.tools, TOOL_SCHEMA, "tool", t => t.id, toolProblems, t => result.tools.push(t));
  take<Recipe>(doc.recipes, RECIPE_SCHEMA, "recipe", r => r.id, recipeProblems, r => result.recipes.push(r));
  take<DataPassRequest>(doc.datapassRequests, REQUEST, "datapassRequest", () => "", () => [], r => result.requests.push(r));
  if (strict && result.skipped.length) throw new ToolkitError(`Invalid toolkit file: ${result.skipped.slice(0, 5).join(" · ")}`);
  return result;
}

// ------------------------------------------------------------------ the catalogue: baseline + hub

export type ToolSource = "built-in" | "hub" | "built-in, changed by the hub";
export interface CatalogueTool extends ToolkitTool {
  label: string;
  kind: ToolKind;
  source: ToolSource;
  /** Fields the hub changed on a built-in tool. */
  changed: string[];
  /** DataPass has a probe for it on this computer (only the extension's own registry). */
  probe: boolean;
  /** Marketplace ids (the probe registry's, else the hub's marketplace install ids). */
  extensionIds: string[];
  /** The toolkit file it came from (hub tools). */
  file?: string;
}
export interface Catalogue {
  tools: Map<string, CatalogueTool>;
  recipes: Map<string, Recipe & { file: string }>;
  requests: Array<DataPassRequest & { file: string }>;
  files: ToolkitFileResult[];
  /** Duplicates across files, unknown tool references (warnings; nothing is dropped silently). */
  problems: string[];
  hub: boolean;
}

const KIND_OF: Readonly<Record<ToolchainTool["kind"], ToolKind>> = {
  extension: "vscode-extension", cli: "cli", "desktop-app": "desktop-app", "workspace-file": "workspace-file", "python-library": "python-library", "agent-plugin": "agent-plugin"
};

/** The built-in baseline file, validated like a hub file (a test keeps it valid). */
export function baselineFile(dataPassVersion: string): ToolkitFileResult {
  return parseToolkitFile(JSON.stringify(baselineData), "built-in baseline", dataPassVersion);
}

/** The baseline: the probe registry and known tools, with their dated descriptions and prices. */
export function baselineTools(dataPassVersion: string): Map<string, CatalogueTool> {
  const data = new Map(baselineFile(dataPassVersion).tools.map(t => [t.id, t]));
  const out = new Map<string, CatalogueTool>();
  for (const t of knownTools().values()) {
    const d = data.get(t.id) ?? { id: t.id };
    const pack = t.id.startsWith("pack.") && t.kind === "extension";
    out.set(t.id, {
      ...d, id: t.id, label: t.label, kind: pack ? "extension-pack" : KIND_OF[t.kind], publisher: d.publisher ?? t.publisher,
      note: d.note ?? t.note, source: "built-in", changed: [], probe: t.probe, extensionIds: t.extensionIds ?? []
    });
  }
  return out;
}

/**
 * Layer the hub's files over the baseline. First file wins on a duplicate id (tools.json is read
 * first); a hub entry for a built-in id changes the fields it gives, except what DataPass probes.
 */
export function buildCatalogue(files: readonly ToolkitFileResult[], dataPassVersion: string): Catalogue {
  const tools = baselineTools(dataPassVersion);
  const recipes = new Map<string, Recipe & { file: string }>();
  const requests: Catalogue["requests"] = [];
  const problems: string[] = [];
  const fromHub = new Set<string>();
  for (const f of files) {
    for (const t of f.tools) {
      if (fromHub.has(t.id)) { problems.push(`${f.path}: tool ${t.id} is already described by an earlier toolkit file; this one is ignored.`); continue; }
      fromHub.add(t.id);
      const base = tools.get(t.id);
      if (base) {
        const changed = Object.keys(t).filter(k => k !== "id" && JSON.stringify((t as unknown as Record<string, unknown>)[k]) !== JSON.stringify((base as unknown as Record<string, unknown>)[k]));
        // The kind and the probe of a built-in tool stay the extension's: they decide what DataPass runs.
        const { kind: _kind, ...rest } = t;
        tools.set(t.id, { ...base, ...rest, label: t.label ?? base.label, source: changed.length ? "built-in, changed by the hub" : "built-in", changed: changed.filter(k => k !== "kind"), probe: base.probe, extensionIds: base.extensionIds, file: f.path });
      } else {
        if (!t.label || !t.kind) { problems.push(`${f.path}: tool ${t.id} is new, so it needs a label and a kind; it is ignored.`); continue; }
        const extensionIds = (t.install ?? []).filter(i => i.method === "marketplace" && i.id).map(i => i.id!);
        tools.set(t.id, { ...t, label: t.label, kind: t.kind, source: "hub", changed: [], probe: false, extensionIds, file: f.path });
      }
    }
    for (const r of f.recipes) {
      if (recipes.has(r.id)) { problems.push(`${f.path}: recipe ${r.id} is already defined by ${recipes.get(r.id)!.file}; this one is ignored.`); continue; }
      recipes.set(r.id, { ...r, file: f.path });
    }
    for (const q of f.requests) requests.push({ ...q, file: f.path });
  }
  for (const r of recipes.values()) {
    const refs = new Set([...(r.tools ?? []), ...r.routes.flatMap(x => [...(x.tools ?? []), ...(x.if && "tool" in x.if ? [x.if.tool] : []), ...x.steps.flatMap(s => typeof s !== "string" && s.tool ? [s.tool] : [])])]);
    for (const id of refs) if (!tools.has(id)) problems.push(`${r.file}: recipe ${r.id} names tool ${id}, which the catalogue does not describe.`);
  }
  for (const t of tools.values()) {
    for (const id of [...(t.complements ?? []), t.replacedBy, t.upstream].filter((x): x is string => !!x)) if (!tools.has(id)) problems.push(`${t.file ?? "built-in baseline"}: tool ${t.id} names ${id}, which the catalogue does not describe.`);
  }
  return { tools, recipes, requests, files: [...files], problems: problems.slice(0, 100), hub: files.length > 0 };
}

/** Tools the hub adds, as the toolchain sees them (known, never probed). */
export function hubToolchainTools(c: Catalogue): Map<string, ToolchainTool> {
  const out = new Map<string, ToolchainTool>();
  for (const t of c.tools.values()) {
    if (t.source !== "hub") continue;
    const cmd = t.install?.find(i => i.command)?.command;
    out.set(t.id, { id: t.id, label: t.label, kind: t.kind === "python-library" ? "python-library" : t.kind === "agent-plugin" ? "agent-plugin" : "desktop-app", publisher: t.publisher ?? "community", probe: false, note: t.note,
      extensionIds: t.extensionIds.length ? t.extensionIds : undefined, install: cmd || t.links?.docs ? { all: cmd, docs: t.links?.docs ?? t.links?.home } : undefined });
  }
  return out;
}

// ------------------------------------------------------------------ what the views show

/** A one-line price summary: "Free", "Free tier · paid from …", "Price unknown"… with its date. */
export function priceText(t: Pick<ToolkitTool, "priceModel" | "freeTier" | "tiers" | "checkedAt">): { text: string; tone: "ok" | "info" | "warn" | "muted"; dated?: string } {
  const dated = t.checkedAt;
  // A zero price ("USD 0", "$0", "free") is not a paid tier; "USD 0.106 / CU-hour" is.
  const paid = (t.tiers ?? []).find(x => !/^(free\b|\$?0(?![.,\d])|(usd|eur|gbp) 0(?![.,\d]))/i.test(x.price) && !/unknown/i.test(x.price));
  const from = (price: string) => price.replace(/^from\s+/i, "");
  switch (t.priceModel) {
    case "free": return { text: "Free", tone: "ok", dated };
    case "freemium": return { text: paid ? `Free tier · paid from ${from(paid.price)}` : "Free tier · paid plans", tone: "info", dated };
    case "paid": return { text: paid ? `Paid · from ${from(paid.price)}` : "Paid", tone: "warn", dated };
    case "included": return { text: "Free tool · needs a paid service", tone: "info", dated };
    case "unknown": return { text: "Price unknown", tone: "muted", dated };
    default: return { text: "Price not recorded", tone: "muted" };
  }
}

export type FactState = "yes" | "no" | "unknown";
export interface RecipeFacts {
  /** Facts DataPass evaluated (fabric.gitBinding…); a fact not in the map is shown as not checked. */
  facts: ReadonlyMap<string, boolean>;
  /** Probe state per tool id ("present" / "absent"); absent from the map = not probed. */
  tools: ReadonlyMap<string, "present" | "absent">;
}

export interface RecipeStepView { text: string; copy?: string; capability?: string; open?: string; tool?: string }
export interface RecipeRouteView {
  id: string; title: string; applies: FactState; condition?: string;
  tools: Array<{ id: string; label: string; known: boolean; state: "present" | "absent" | "not-checked"; price: string }>;
  steps: RecipeStepView[]; note?: string;
}
export interface RecipeView {
  id: string; title: string; module: Module; moduleLabel: string; when?: string; file: string;
  routes: RecipeRouteView[];
  /** The first route whose condition holds (or has none), when DataPass can tell. */
  suggested?: string;
  checks: string[]; risks: string[]; practice?: string; verified?: string;
}

const FACT_TEXT: Readonly<Record<string, string>> = {
  "fabric.gitBinding": "the Fabric workspace is connected to Git (a git-binding in project.json)",
  "databricks.bundle": "the project has a Databricks bundle (databricks.yml)",
  "git.repository": "the files are in a Git repository"
};

export function recipeView(r: Recipe & { file: string }, c: Catalogue, facts: RecipeFacts): RecipeView {
  const toolView = (id: string) => {
    const t = c.tools.get(id);
    const probed = facts.tools.get(id);
    return { id, label: t?.label ?? id, known: Boolean(t), state: probed ?? "not-checked" as const, price: t ? priceText(t).text : "not in the catalogue" };
  };
  const routes = r.routes.map((x): RecipeRouteView => {
    let applies: FactState = "yes";
    let condition: string | undefined;
    if (x.if && "fact" in x.if) {
      const v = facts.facts.get(x.if.fact);
      applies = v === undefined ? "unknown" : v ? "yes" : "no";
      condition = `when ${FACT_TEXT[x.if.fact] ?? x.if.fact}${v === undefined ? " (not checked by DataPass)" : ""}`;
    } else if (x.if && "tool" in x.if) {
      const s = facts.tools.get(x.if.tool);
      applies = s === undefined ? "unknown" : s === "present" ? "yes" : "no";
      condition = `when ${c.tools.get(x.if.tool)?.label ?? x.if.tool} is installed`;
    }
    const ids = [...new Set([...(x.tools ?? []), ...x.steps.flatMap(s => typeof s !== "string" && s.tool ? [s.tool] : [])])];
    if (applies === "yes" && ids.some(id => facts.tools.get(id) === "absent")) applies = "no";
    return {
      id: x.id, title: x.title ?? x.id, applies, condition, tools: ids.map(toolView),
      steps: x.steps.map(s => typeof s === "string" ? { text: s } : { text: s.text, copy: s.copy, capability: s.capability, open: s.open, tool: s.tool }), note: x.note
    };
  });
  return {
    id: r.id, title: r.title, module: r.module, moduleLabel: MODULE_LABELS[r.module], when: r.when, file: r.file, routes,
    suggested: routes.find(x => x.applies === "yes")?.id,
    checks: r.checks ?? [], risks: r.risks ?? [], practice: r.practice, verified: r.verified?.on
  };
}

/** Tools of the catalogue that serve a set of Marketplace ids or tool ids (a component's official tools). */
export function toolsFor(c: Catalogue, ids: { toolIds?: readonly string[]; extensionIds?: readonly string[] }): CatalogueTool[] {
  const ext = new Set((ids.extensionIds ?? []).map(x => x.toLowerCase()));
  const out: CatalogueTool[] = [];
  for (const t of c.tools.values()) if ((ids.toolIds ?? []).includes(t.id) || t.extensionIds.some(e => ext.has(e.toLowerCase()))) out.push(t);
  return out;
}

/** Recipes that use any of these tools. */
export function recipesUsing(c: Catalogue, toolIds: readonly string[]): string[] {
  const want = new Set(toolIds);
  return [...c.recipes.values()].filter(r => [...(r.tools ?? []), ...r.routes.flatMap(x => x.tools ?? [])].some(t => want.has(t))).map(r => r.id);
}

/** The install lines to copy for a tool on a platform (DataPass never runs them). */
export function installLines(t: CatalogueTool, platform: string): Array<{ text: string; copy?: string }> {
  const plat = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  const out: Array<{ text: string; copy?: string }> = [];
  for (const i of t.install ?? []) {
    if (i.platform && i.platform !== "all" && i.platform !== plat) continue;
    const cmd = i.command ?? (i.method === "marketplace" && i.id ? `code --install-extension ${i.id}` : i.method === "winget" && i.id ? `winget install -e --id ${i.id}` : i.method === "pip" && i.id ? `pip install ${i.id}` : i.method === "npm" && i.id ? `npm install -g ${i.id}` : i.method === "brew" && i.id ? `brew install ${i.id}` : undefined);
    if (i.method === "extension-pack") out.push({ text: `Part of the extension pack ${i.tool}` });
    else if (cmd) out.push({ text: i.where ? `${cmd}   (in ${i.where})` : cmd, copy: cmd });
  }
  if (!out.length && t.kind === "vscode-extension" && t.extensionIds[0]) out.push({ text: `code --install-extension ${t.extensionIds[0]}`, copy: `code --install-extension ${t.extensionIds[0]}` });
  return out;
}
