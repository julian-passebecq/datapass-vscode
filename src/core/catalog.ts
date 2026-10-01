import { provenanceFromFabricTool, type ToolProvenanceInfo } from "./capabilities/provenance";
import { toolSeedV3, type ToolRouting } from "@juliandatapass-group/tool-catalog";

export type CatalogAction = "read" | "clone" | "configure" | "run" | "scaffold" | "deploy";

/** Routing (lifecycle domains, prerequisites, typed side effects) is owned by Common tool-catalog/3; the standalone keeps no copy. */
const commonRouting = new Map<string, ToolRouting>();
for (const entry of toolSeedV3().entries) {
  if (entry.routing) for (const alias of entry.aliases) commonRouting.set(alias, entry.routing);
}
export function commonToolRouting(id: string): ToolRouting | undefined {
  return commonRouting.get(id);
}

export interface ToolCatalogItem {
  id: string;
  name: string;
  category: string;
  kind: string;
  source: string;
  url: string;
  relativePath?: string;
  description?: string;
  verifiedRef?: string;
  actions: CatalogAction[];
  /** TOOLPROV1: provenance in the Common tool-catalog vocabulary, derived from source + kind. */
  provenance?: ToolProvenanceInfo;
  /** From the Common seed (matched by alias = standalone id); undefined for ids Common does not route. */
  routing?: ToolRouting;
}

export interface ToolCatalog {
  schemaVersion: number;
  items: ToolCatalogItem[];
}

const allowedActions = new Set<CatalogAction>(["read", "clone", "configure", "run", "scaffold", "deploy"]);

export function parseToolCatalog(raw: unknown): ToolCatalog {
  if (!raw || typeof raw !== "object") throw new Error("Tool catalog must be an object.");
  const candidate = raw as { schemaVersion?: unknown; items?: unknown };
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported tool catalog schema version.");
  if (!Array.isArray(candidate.items)) throw new Error("Tool catalog items must be an array.");

  const ids = new Set<string>();
  const items = candidate.items.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`Tool catalog item ${index} must be an object.`);
    const item = value as Record<string, unknown>;
    for (const key of ["id", "name", "category", "kind", "source", "url"]) {
      if (typeof item[key] !== "string" || !String(item[key]).trim()) {
        throw new Error(`Tool catalog item ${index} has invalid ${key}.`);
      }
    }
    if (ids.has(String(item.id))) throw new Error(`Duplicate tool catalog id: ${item.id}`);
    ids.add(String(item.id));
    if (!Array.isArray(item.actions) || item.actions.some(action => !allowedActions.has(action as CatalogAction))) {
      throw new Error(`Tool catalog item ${item.id} has invalid actions.`);
    }
    return {
      id: String(item.id),
      name: String(item.name),
      category: String(item.category),
      kind: String(item.kind),
      source: String(item.source),
      url: String(item.url),
      relativePath: typeof item.relativePath === "string" ? item.relativePath : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      verifiedRef: typeof item.verifiedRef === "string" ? item.verifiedRef : undefined,
      actions: item.actions as CatalogAction[],
      provenance: provenanceFromFabricTool({ source: String(item.source), kind: String(item.kind) }),
      routing: commonToolRouting(String(item.id))
    } satisfies ToolCatalogItem;
  });

  return { schemaVersion: 1, items };
}