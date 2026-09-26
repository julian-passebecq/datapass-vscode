/**
 * 0.27 (package P1, decision D-23 in handoff/v3/11): pack and work-order stamps. Every pack for an
 * AI (Copy Context for My AI, options packs, work-order attachments) and every work order records
 * what it was built for: the selected variant, the environment and the bridge revision (the commit
 * of the coordination repository). A pack built for B must not silently run as C (finding R-06).
 *
 * Pure: the options file, the preview and the manifest in, a stamp and its comparisons out.
 * The pack builders (fileContext, optionsReport) and the order builder render it with stampLine.
 */
import type { OptionsFile } from "../project/options";
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
  /** V1-FRESH: when DataPass last observed the project state the pack describes (ISO time). Never compared. */
  observedAt?: string;
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
    + ` · bridge revision ${s.bridge ? s.bridge.slice(0, 12) : "unknown"}`
    + (s.observedAt ? ` · project state observed ${s.observedAt.slice(0, 16).replace("T", " ")} UTC` : "") + "."
    + " If the selection has changed since, ask for a fresh pack.";
}

/**
 * Why a pack stamped `then` no longer matches `now`; undefined while it still does. The variant,
 * the environment and the bridge revision count (a new commit on the bridge may change the files the
 * pack described); a side whose revision is unknown is not judged on it.
 */
export function staleReason(then: PackStamp | undefined, now: PackStamp): string | undefined {
  if (!then) return undefined;
  const why: string[] = [];
  if (then.variant.key !== now.variant.key) why.push(`built for ${then.variant.title}; the selected variant is now ${now.variant.title}`);
  if ((then.environment ?? "") !== (now.environment ?? "")) why.push(`built for environment ${then.environment ?? "none"}; now ${now.environment ?? "none"}`);
  if (then.bridge && now.bridge && then.bridge !== now.bridge) why.push(`the bridge moved from ${then.bridge.slice(0, 12)} to ${now.bridge.slice(0, 12)}`);
  return why.length ? why.join("; ") : undefined;
}

/**
 * V1-FRESH (A04): the freshness of a pack or an order against the selection now. The absence of a
 * stale reason is not proof of freshness: an unstamped (pre-0.27) pack, or a bridge revision unknown
 * on either side, is "unknown". "fresh" only compares the variant, the environment and the bridge
 * commit — files in the native repositories can change while the bridge does not, and the note says so.
 */
export type Freshness =
  | { state: "fresh"; note: string }
  | { state: "stale"; reason: string }
  | { state: "unknown"; reason: string };

export const NATIVE_NOT_COMPARED = "same variant, environment and bridge revision; files in the native repositories are not compared";

export function freshness(then: PackStamp | undefined, now: PackStamp): Freshness {
  if (!then) return { state: "unknown", reason: "not stamped (built before 0.27): what it was built for is unknown" };
  const stale = staleReason(then, now);
  if (stale) return { state: "stale", reason: stale };
  if (!then.bridge || !now.bridge) return { state: "unknown", reason: `same variant and environment, but the bridge revision is unknown ${then.bridge ? "now (no Git here)" : "in the stamp"}` };
  return { state: "fresh", note: NATIVE_NOT_COMPARED };
}

/**
 * Items built for an order (Pilot request cards) with `stale` set when their order's stamp no longer
 * matches `now` (variant, environment or bridge revision), and `unknown` when it cannot be judged
 * (unstamped order, bridge revision unknown).
 */
export function withStale<T extends { orderId: string }>(items: readonly T[], stampOf: (orderId: string) => PackStamp | undefined, now: PackStamp | undefined): Array<T & { stale?: string; unknown?: string }> {
  return items.map(i => {
    if (!now) return { ...i };
    const f = freshness(stampOf(i.orderId), now);
    return f.state === "stale" ? { ...i, stale: f.reason.slice(0, 300) } : f.state === "unknown" ? { ...i, unknown: f.reason.slice(0, 300) } : { ...i };
  });
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
    ...(typeof r.bridge === "string" && /^[0-9a-f]{7,40}$/.test(r.bridge) ? { bridge: r.bridge } : {}),
    ...(typeof r.observedAt === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.observedAt) ? { observedAt: r.observedAt } : {})
  };
}
