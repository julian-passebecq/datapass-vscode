/**
 * The toolkit catalogue as the Workbench shows it (0.21): tools with their dated prices, recipes
 * with their routes resolved against this project and this computer, the files read and the
 * "Needs a newer DataPass" list. Plain data; links and install commands stay on the extension side
 * (the webview names them by tool id and index, the extension rebuilds and checks them).
 */
import { installLines, MODULE_LABELS, priceText, recipeView, recipesUsing, toolsFor, type Catalogue, type RecipeFacts, type RecipeView, type Tier, type ToolkitFileResult } from "../core/toolkit/toolkit";
import type { ProjectMap } from "../core/project/projectMap";

export type ToolLinkId = "repo" | "marketplace" | "docs" | "home" | "pypi" | "pricing";
export const LINK_LABELS: Readonly<Record<ToolLinkId, string>> = { repo: "Repository", marketplace: "Marketplace", docs: "Docs", home: "Home page", pypi: "PyPI", pricing: "Pricing page" };

export interface WbTool {
  id: string; label: string; kind: string; publisher?: string; maintainer?: string; status?: string; replacedBy?: string; upstream?: string;
  source: string; changed: string[]; file?: string; probe: boolean; state?: "present" | "absent";
  modules: string[]; extensionIds: string[]; complements: string[]; sideEffects: string[];
  useWhen?: string; avoidWhen?: string; note?: string; verified?: string;
  price: { text: string; tone: string; dated?: string }; priceModel?: string; freeTier?: string; tiers: Tier[]; checkedAt?: string;
  links: Array<{ id: ToolLinkId; label: string }>;
  install: Array<{ index: number; text: string; copy: boolean }>;
  recipes: string[];
}
export interface WbToolkitFile { path: string; title?: string; updated?: string; requires?: string; newer?: string; error?: string; tools: number; recipes: number; requests: number; skipped: string[] }
export interface WbToolkit {
  hub: boolean;
  files: WbToolkitFile[];
  tools: WbTool[];
  recipes: RecipeView[];
  requests: Array<{ title: string; why: string; example?: string; module?: string; file: string }>;
  problems: string[];
  modules: Array<{ id: string; label: string }>;
  /** Per component: the catalogue tools of its official tool, and the recipes that use them. */
  components: Record<string, { tools: string[]; recipes: string[] }>;
  /** Files written for a newer DataPass or a newer format. */
  newerFiles: number;
}

export function toolkitState(c: Catalogue, files: readonly ToolkitFileResult[], facts: RecipeFacts, map: ProjectMap | undefined, platform: string): WbToolkit {
  const tools: WbTool[] = [...c.tools.values()].map(t => {
    const links: WbTool["links"] = (Object.keys(t.links ?? {}) as ToolLinkId[]).filter(k => t.links?.[k as keyof NonNullable<typeof t.links>]).map(id => ({ id, label: LINK_LABELS[id] }));
    if (t.pricingUrl) links.push({ id: "pricing", label: LINK_LABELS.pricing });
    return {
      id: t.id, label: t.label, kind: t.kind, publisher: t.publisher, maintainer: t.maintainer, status: t.status, replacedBy: t.replacedBy, upstream: t.upstream,
      source: t.source, changed: t.changed, file: t.file, probe: t.probe, state: facts.tools.get(t.id),
      modules: t.modules ?? [], extensionIds: t.extensionIds, complements: t.complements ?? [], sideEffects: t.sideEffects ?? [],
      useWhen: t.useWhen, avoidWhen: t.avoidWhen, note: t.note, verified: t.verified ? `${t.verified.on}${t.verified.version ? ` · version ${t.verified.version}` : ""}` : undefined,
      price: priceText(t), priceModel: t.priceModel, freeTier: t.freeTier, tiers: t.tiers ?? [], checkedAt: t.checkedAt,
      links, install: installLines(t, platform).map((l, index) => ({ index, text: l.text, copy: Boolean(l.copy) })),
      recipes: recipesUsing(c, [t.id])
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
  const components: WbToolkit["components"] = {};
  for (const comp of map?.components ?? []) {
    const n = comp.provider?.nativeTool;
    const ids = toolsFor(c, { toolIds: n?.toolIds, extensionIds: n?.extensionIds }).map(t => t.id);
    if (ids.length) components[comp.id] = { tools: ids, recipes: recipesUsing(c, ids) };
  }
  return {
    hub: c.hub,
    files: files.map(f => ({ path: f.path, title: f.title, updated: f.updated, requires: f.requires, newer: f.newer?.text, error: f.error, tools: f.tools.length, recipes: f.recipes.length, requests: f.requests.length, skipped: f.skipped.slice(0, 30) })),
    tools,
    recipes: [...c.recipes.values()].map(r => recipeView(r, c, facts)).sort((a, b) => a.module.localeCompare(b.module) || a.title.localeCompare(b.title)),
    requests: c.requests.slice(0, 100),
    problems: c.problems,
    modules: Object.entries(MODULE_LABELS).map(([id, label]) => ({ id, label })),
    components,
    newerFiles: files.filter(f => f.newer).length
  };
}
