/**
 * Project links (V3-HOME, vision §2.5): the project's useful pages in one optional bridge file,
 * `.datapass/links.json` — dashboards, Databricks or Fabric workspaces, portal pages, repositories,
 * documentation. DataPass lists them on the Home and on the Project links page and opens one in the
 * browser after the usual confirmation. It never calls these addresses itself: no link checking,
 * no monitoring, no cloud call. Pure.
 *
 *   {
 *     "format": "datapass.links", "version": 1, "title"?: "…",
 *     "groups": [ { "title": "Dev workspaces", "links": [
 *       { "label": "Databricks (dev)", "url": "https://adb-123.azuredatabricks.net/?o=123",
 *         "kind": "workspace", "environment"?: "dev", "description"?: "…" } ] } ]
 *   }
 *
 * A committed file never carries a credential: https only (http only for a local server on
 * localhost / 127.0.0.1 / [::1]), no user name or password, no token or signature in the query.
 */
import { arr, constOf, enumOf, ID, obj, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";

export const LINKS_PATH = ".datapass/links.json";
export const LINKS_FORMAT = "datapass.links";
export const LINK_KINDS = ["dashboard", "workspace", "portal", "repository", "docs", "other"] as const;
export type LinkKind = typeof LINK_KINDS[number];

export const LINKS_MAX_BYTES = 256 * 1024;
export const MAX_GROUPS = 30;
export const MAX_LINKS_PER_GROUP = 60;
export const MAX_LINKS = 300;
export const MAX_URL = 2000;

export const KIND_LABELS: Readonly<Record<LinkKind, string>> = {
  dashboard: "Dashboard", workspace: "Workspace", portal: "Portal", repository: "Repository", docs: "Documentation", other: "Other"
};

const LABEL: Schema = { type: "string", minLength: 1, maxLength: 120 };
const DESC: Schema = { type: "string", minLength: 1, maxLength: 500 };
const URL_SCHEMA: Schema = { type: "string", minLength: 8, maxLength: MAX_URL, pattern: "^https?://\\S+$" };

const LINK: Schema = obj({ label: LABEL, url: URL_SCHEMA, kind: enumOf(...LINK_KINDS), environment: ID, description: DESC }, ["label", "url", "kind"]);
const GROUP: Schema = obj({ id: ID, title: LABEL, description: DESC, links: arr(LINK, MAX_LINKS_PER_GROUP, 1) }, ["title", "links"]);

export const LINKS_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: constOf(LINKS_FORMAT), version: constOf(1), title: LABEL, description: DESC,
  groups: arr(GROUP, MAX_GROUPS)
}, ["format", "version", "groups"]);

export interface ProjectLink { label: string; url: string; kind: LinkKind; environment?: string; description?: string }
export interface LinkGroup { id?: string; title: string; description?: string; links: ProjectLink[] }
export interface LinksFile { $schema?: string; format: typeof LINKS_FORMAT; version: 1; title?: string; description?: string; groups: LinkGroup[] }

export class LinksError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TOKEN_PARAM = /^(sig|signature|token|access_token|id_token|refresh_token|code|key|apikey|api_key|password|pwd|secret|client_secret|se|sv|skoid)$/i;

/** Why a project link is refused (undefined: it may be listed). */
export function linkUrlProblem(url: string): string | undefined {
  if (typeof url !== "string" || !url) return "is empty";
  if (url.length > MAX_URL) return `is longer than ${MAX_URL} characters`;
  if (/[\s\\]/.test(url) || /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(url)) return "contains spaces, backslashes or control characters";
  let u: URL;
  try { u = new URL(url); } catch { return "is not a valid web address"; }
  if (u.protocol === "http:") { if (!LOOPBACK.has(u.hostname)) return "must be https:// (http:// only for a local server on localhost)"; }
  else if (u.protocol !== "https:") return "must be https://";
  if (!u.hostname) return "has no host";
  if (u.username || u.password) return "contains a user name or password";
  for (const k of u.searchParams.keys()) if (TOKEN_PARAM.test(k)) return `carries a token or a signature in its query ("${k}=")`;
  if (/(^|[&#])(access_token|id_token|token|sig)=/i.test(u.hash.slice(1))) return "carries a token in its fragment";
  return undefined;
}

/** Parse `.datapass/links.json`; throws a LinksError with a readable message when it is not valid. */
export function parseLinks(raw: string | Uint8Array): LinksFile {
  const doc = parseStrictJson(raw, { maxBytes: LINKS_MAX_BYTES, maxDepth: 8 });
  const issues = validateSchema(LINKS_SCHEMA, doc);
  if (issues.length) throw new LinksError("Invalid links file", issues);
  const f = doc as LinksFile;
  const total = f.groups.reduce((n, g) => n + g.links.length, 0);
  if (total > MAX_LINKS) throw new LinksError(`Too many links (${total}; at most ${MAX_LINKS})`);
  const ids = f.groups.map(g => g.id).filter((id): id is string => Boolean(id));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new LinksError(`Duplicate group id "${dup}"`);
  f.groups.forEach((g, gi) => g.links.forEach((l, li) => {
    const why = linkUrlProblem(l.url);
    if (why) throw new LinksError(`Group "${g.title}", link "${l.label}" (groups[${gi}].links[${li}]): the address ${why}; keep links to pages, never a credential`);
  }));
  return f;
}

/** Warnings that do not block the page: an environment the manifest does not declare. */
export function linksProblems(f: LinksFile, environments: readonly string[] | undefined): string[] {
  if (!environments?.length) return [];
  const known = new Set(environments);
  const out: string[] = [];
  for (const g of f.groups) for (const l of g.links) {
    if (l.environment && !known.has(l.environment)) out.push(`"${l.label}": environment "${l.environment}" is not declared in project.json (${[...known].join(", ")})`);
  }
  return out;
}

/** Host of a link for labels and confirmations (never the path or the query). */
export function linkHost(url: string): string {
  try { return new URL(url).host; } catch { return "invalid address"; }
}
