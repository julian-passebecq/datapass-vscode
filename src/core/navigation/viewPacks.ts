/**
 * V4-NAV view packs (NAVWIRE1): the resolved catalog is DEFAULT_VIEW_CATALOG + every built-in pack, then the
 * user overrides (NavigationService). A pack is one `*.pack.ts` file whose default export is catalog entries
 * (view-spi `ViewCatalog["entries"]`), collected into out/gen/packs.ts: no shared list to edit. Pure (no `vscode`).
 */
import { PACKS } from "../../../out/gen/packs";
import { DEFAULT_VIEW_CATALOG, type ViewCatalog } from "./navTypes";

export type PackEntry = ViewCatalog["entries"][number];

/** Base + packs: an entry for the same (artifactKind, level) gets the pack's views appended (a view id already there wins). */
export function composeCatalog(base: ViewCatalog, packs: readonly PackEntry[]): ViewCatalog {
  const entries = base.entries.map(e => ({ ...e, views: [...e.views] }));
  for (const p of packs) {
    const into = entries.find(e => e.artifactKind === p.artifactKind && e.level === p.level);
    if (!into) { entries.push({ ...p, views: [...p.views] }); continue; }
    for (const v of p.views) if (!into.views.some(x => x.id === v.id)) into.views.push(v);
  }
  return { ...base, entries };
}

/** The catalog the NavHost starts from. */
export const builtinCatalog = (): ViewCatalog => composeCatalog(DEFAULT_VIEW_CATALOG, PACKS);
