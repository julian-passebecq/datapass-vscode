/**
 * 0.27 (package P1, decision D-23 in handoff/v3/11): pack and work-order stamps. Every pack for an
 * AI (Copy Context for My AI, options packs, work-order attachments) and every work order records
 * what it was built for: the selected variant, the environment and the bridge revision (the commit
 * of the coordination repository). A pack built for B must not silently run as C (finding R-06).
 *
 * Pure: the options file, the preview and the manifest in, a stamp and its comparisons out.
 */
import type { OptionsFile } from "./options";
import type { EnvironmentDecl } from "../projectManifestModel";

export interface VariantStamp {
  /** What is compared: "current", or the changed picks "decision=option" sorted and joined by ",". */
  key: string;
  /** What a person reads ("B — Blob event + Function"). */
  title: string;
  /** The changed picks, when the variant is not the current architecture. */
  picks?: string[];
}

export interface PackStamp {
  variant: VariantStamp;
  /** The environment the work targets, when the project says which one (see environmentOf). */
  environment?: string;
  /** The coordination repository's commit when the pack or order was built. */
  bridge?: string;
}

export const CURRENT_VARIANT: VariantStamp = { key: "current", title: "Current architecture" };

const PICK = /^[A-Za-z0-9._-]{1,64}=[A-Za-z0-9._-]{1,64}$/;

/**
 * The selected variant as a stamp: its title and the picks that differ from the current
 * architecture. Two selections that give the same architecture (scenario B, or the same picks
 * chosen by hand) have the same key.
 */
export function variantStamp(options: OptionsFile | undefined, preview: { title: string; picks: ReadonlyMap<string, string> } | undefined): VariantStamp {
  if (!options || !preview) return CURRENT_VARIANT;
  const picks = options.decisions
    .filter(d => { const p = preview.picks.get(d.id); return p !== undefined && p !== d.current; })
    .map(d => `${d.id}=${preview.picks.get(d.id)}`)
    .filter(p => PICK.test(p))
    .sort();
  if (!picks.length) return CURRENT_VARIANT;
  return { key: picks.join(","), title: preview.title.slice(0, 200) || picks.join(", "), picks };
}

/**
 * The environment a pack targets: the only environment project.json declares, else its only
 * non-production one; undefined when the project declares none or several (a choice DataPass does
 * not make for the person).
 */
export function environmentOf(environments: readonly EnvironmentDecl[] | undefined): string | undefined {
  const all = environments ?? [];
  if (all.length === 1) return all[0]!.id;
  const nonProd = all.filter(e => !e.production);
  return nonProd.length === 1 ? nonProd[0]!.id : undefined;
}

/** The one-line stamp at the top of a pack (and in order.md). */
export function stampLine(s: PackStamp): string {
  return `Stamp: built for the selected variant **${s.variant.title}**${s.variant.picks?.length ? ` (${s.variant.picks.join(", ")})` : ""}`
    + ` · environment ${s.environment ?? "not declared"}`
    + ` · bridge revision ${s.bridge ? s.bridge.slice(0, 12) : "unknown"}.`
    + " If the selection has changed since, ask for a fresh pack.";
}

/**
 * Why a pack stamped `then` no longer matches the selection `now`; undefined while it still does.
 * The variant and the environment count; a newer bridge revision alone does not make a pack stale
 * (the architecture the AI was told about has not changed).
 */
export function staleReason(then: PackStamp | undefined, now: PackStamp): string | undefined {
  if (!then) return undefined;
  const why: string[] = [];
  if (then.variant.key !== now.variant.key) why.push(`built for ${then.variant.title}; the selected variant is now ${now.variant.title}`);
  if ((then.environment ?? "") !== (now.environment ?? "")) why.push(`built for environment ${then.environment ?? "none"}; now ${now.environment ?? "none"}`);
  return why.length ? why.join("; ") : undefined;
}

/** A stamp read back from storage (global state, order.json): anything malformed is dropped. */
export function readStamp(raw: unknown): PackStamp | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const v = r.variant as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object" || typeof v.key !== "string" || typeof v.title !== "string" || !v.key) return undefined;
  const picks = Array.isArray(v.picks) ? v.picks.filter((p): p is string => typeof p === "string" && PICK.test(p)).slice(0, 50) : undefined;
  return {
    variant: { key: v.key.slice(0, 2000), title: v.title.slice(0, 200), ...(picks?.length ? { picks } : {}) },
    ...(typeof r.environment === "string" && r.environment ? { environment: r.environment.slice(0, 100) } : {}),
    ...(typeof r.bridge === "string" && /^[0-9a-f]{7,40}$/.test(r.bridge) ? { bridge: r.bridge } : {})
  };
}
