/**
 * V4-NAV NAVCTX1: the context sections shown in the DataPass Context view (bottom panel).
 *
 * Each tab is filled by one section provider; packages add providers here (NAVCTX2: process step and
 * why & alternatives, NAVFAB1: on Fabric, NAVAIX1: AI text). A tab without a provider, or whose
 * provider has nothing, shows an explicit hole, never a guess. Every section carries its § 34 origin;
 * any AI origin is normalised to "ai-proposed" so AI text is always shown as such.
 * Tab ids and default titles are data: titles are overridden by `datapass.context.tabTitles`. Pure.
 */
import type { NavLocation } from "../navStub";

export interface ContextTab { readonly id: string; readonly title: string }
export const DEFAULT_CONTEXT_TABS: readonly ContextTab[] = [
  { id: "summary", title: "Summary" },
  { id: "process-step", title: "Process step" },
  { id: "why", title: "Why & alternatives" },
  { id: "patterns", title: "Patterns" },
  { id: "fabric", title: "On Fabric" },
  { id: "evidence", title: "Evidence" }
];

export type ContextOrigin = "static" | "theoretical" | "observed" | "ai-proposed" | "datapass-guidance" | "user" | "none";
const ORIGINS = new Set<string>(["static", "theoretical", "observed", "ai-proposed", "datapass-guidance", "user", "none"]);
/** Badge text per origin (data; "AI-proposed" is fixed so AI text is never disguised). */
export const ORIGIN_LABELS: Readonly<Record<ContextOrigin, string>> = {
  static: "From the code", theoretical: "Theoretical", observed: "Observed", "ai-proposed": "AI-proposed",
  "datapass-guidance": "DataPass guidance", user: "Written by you", none: ""
};
export interface ContextHole { readonly reason: string }
export interface ContextSection {
  readonly id: string; readonly title: string; readonly body: string;
  readonly origin: ContextOrigin; readonly holes: readonly ContextHole[];
}
/** What a provider gets: where the person is (null before any navigation). */
export interface ContextInput { readonly location: NavLocation | null }
export interface ContextSectionProvider {
  /** The tab it fills (one of the tab ids). */
  readonly tab: string;
  provide(input: ContextInput): { body: string; origin: string; holes?: readonly ContextHole[] } | null | Promise<{ body: string; origin: string; holes?: readonly ContextHole[] } | null>;
}

const providers = new Map<string, ContextSectionProvider>();

/** Register a provider for its tab (the last one wins); returns its disposer. */
export function registerContextProvider(p: ContextSectionProvider): { dispose(): void } {
  providers.set(p.tab, p);
  return { dispose: () => { if (providers.get(p.tab) === p) providers.delete(p.tab); } };
}
export function contextProvider(tab: string): ContextSectionProvider | undefined { return providers.get(tab); }

/** Unknown or AI-flavoured origins are never shown as authored facts. */
export function normaliseOrigin(origin: string): ContextOrigin {
  if (/^ai/i.test(origin)) return "ai-proposed";
  return ORIGINS.has(origin) ? origin as ContextOrigin : "ai-proposed";
}

/** The tabs with their configured titles (non-empty strings ≤ 60 chars only). */
export function contextTabs(titles: unknown): ContextTab[] {
  const t = titles && typeof titles === "object" ? titles as Record<string, unknown> : {};
  return DEFAULT_CONTEXT_TABS.map(d => {
    const v = t[d.id];
    return { id: d.id, title: typeof v === "string" && v.trim() && v.length <= 60 ? v.trim() : d.title };
  });
}

/** Build every tab's section; a failing or missing provider becomes a hole. */
export async function buildSections(input: ContextInput, tabs: readonly ContextTab[], lookup = contextProvider): Promise<ContextSection[]> {
  return Promise.all(tabs.map(async tab => {
    const p = lookup(tab.id);
    if (!p) return { id: tab.id, title: tab.title, body: "", origin: "none" as const, holes: [{ reason: "No source provides this section yet." }] };
    try {
      const r = await p.provide(input);
      if (!r) return { id: tab.id, title: tab.title, body: "", origin: "none" as const, holes: [{ reason: "Nothing known here for this location." }] };
      return { id: tab.id, title: tab.title, body: String(r.body ?? ""), origin: normaliseOrigin(String(r.origin ?? "")), holes: (r.holes ?? []).map(h => ({ reason: String(h.reason) })) };
    } catch (e) {
      return { id: tab.id, title: tab.title, body: "", origin: "none" as const, holes: [{ reason: `This section failed: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }));
}

/** Built-in Summary: where you are, from the navigation location only (static). */
export const summaryProvider: ContextSectionProvider = {
  tab: "summary",
  provide({ location }) {
    if (!location) return { body: "", origin: "none", holes: [{ reason: "No location yet: navigate the project to see its context." }] };
    return { body: `Level: ${location.level}\nItem: ${location.nodeId}\nKind: ${location.artifactKind}`, origin: "static" };
  }
};
registerContextProvider(summaryProvider);
