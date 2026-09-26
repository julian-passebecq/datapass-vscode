/**
 * Project catalog (V3, audit F16): a short list of projects and where their coordination
 * repository lives, so DataPass can switch between projects (and companies) without a server.
 * Pure.
 *
 * A catalog is a plain JSON file, usually `.datapass/catalog.json` in a small "hub" repository on
 * GitHub, or a local file named in the `datapass.catalogs` setting. It lists entry points only:
 * each project keeps its own `.datapass/project.json` in its coordination repository. Catalogs
 * do not include other catalogs (no recursive federation).
 */
import { arr, constOf, ID, obj, TEXT, validateSchema, type Schema } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { isRemoteUrl } from "../projectManifestModel";
import { normalizeRemote } from "./resolve";

const SHORT: Schema = { type: "string", minLength: 1, maxLength: 200 };
const REL_PATH: Schema = { type: "string", minLength: 1, maxLength: 400, pattern: "^(?![/\\\\~])(?![A-Za-z]:)(?!.*(^|[/\\\\])\\.\\.([/\\\\]|$)).+$" };

export const CATALOG_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: constOf("datapass.catalog"),
  version: constOf("1"),
  title: SHORT,
  description: TEXT,
  projects: arr(obj({
    id: ID, title: SHORT, organization: SHORT, description: TEXT,
    repository: obj({ url: { type: "string", maxLength: 500 }, branch: { type: "string", pattern: "^[A-Za-z0-9._/-]{1,200}$" } }, ["url"]),
    manifest: REL_PATH,
    tags: arr(ID, 20)
  }, ["id", "title", "repository"]), 200)
}, ["format", "version", "projects"]);

export interface CatalogProject {
  id: string;
  title: string;
  organization?: string;
  description?: string;
  repository: { url: string; branch?: string };
  /** Manifest path inside the repository; default .datapass/project.json. */
  manifest?: string;
  tags?: string[];
}

export interface Catalog { format: "datapass.catalog"; version: "1"; title?: string; description?: string; projects: CatalogProject[] }

export const CATALOG_PATH = ".datapass/catalog.json";

export function parseCatalog(raw: string | Uint8Array): Catalog {
  const doc = parseStrictJson(raw, { maxBytes: 512 * 1024 });
  const issues = validateSchema(CATALOG_SCHEMA, doc);
  if (issues.length) throw new Error(`Invalid catalog: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}`);
  const catalog = doc as Catalog;
  const ids = catalog.projects.map(p => p.id);
  if (new Set(ids).size !== ids.length) throw new Error("Invalid catalog: duplicate project id");
  for (const p of catalog.projects) {
    if (!isRemoteUrl(p.repository.url)) throw new Error(`Invalid catalog: project ${p.id} repository.url must be https:// or git@host:path, without credentials`);
  }
  return catalog;
}

export interface CatalogEntryView extends CatalogProject {
  /** Catalog title it came from. */
  source: string;
  remote?: string;
  /** Absolute folder of a local clone whose origin matches, when one was found. */
  localFolder?: string;
}

/** Merge several catalogs (first wins on duplicate ids) and attach known local clones by remote identity. */
export function mergeCatalogs(catalogs: ReadonlyArray<{ source: string; catalog: Catalog }>, clones: ReadonlyArray<{ folder: string; originUrl?: string }>): CatalogEntryView[] {
  const byRemote = new Map<string, string>();
  for (const c of clones) { const r = normalizeRemote(c.originUrl); if (r && !byRemote.has(r)) byRemote.set(r, c.folder); }
  const seen = new Set<string>();
  const out: CatalogEntryView[] = [];
  for (const { source, catalog } of catalogs) {
    for (const p of catalog.projects) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const remote = normalizeRemote(p.repository.url);
      out.push({ ...p, source, remote, localFolder: remote ? byRemote.get(remote) : undefined });
    }
  }
  return out;
}
