/**
 * V1-HONEST (F04): tools, identifiers and connections a single route needs.
 *
 * A toolchain tool, identifier or connection may say `variants`: the options ("option" or
 * "decision=option") or scenarios of options.json that need it. Without `variants` it is needed by
 * every route, as before. With it, it is needed only when one of those variants is the architecture
 * in view (the current one, or the previewed option or scenario): a missing Azure CLI for a cloud
 * route is a note while the local route is in view, never a warning that blocks the local route.
 * Pure.
 */
export const MAX_VARIANT_REFS = 20;
/** An option or scenario id, or "decision=option" (options.ts PICK_PATTERN; not imported: options.ts imports readiness). */
const VARIANT_REF = /^[a-z][a-z0-9_.-]{0,79}(=[a-z][a-z0-9_.-]{0,79})?$/;

/** Validate a `variants` list (shape only; unknown variant names are not errors: they simply never match). */
export function validateVariantRefs(v: unknown, at: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.length || v.length > MAX_VARIANT_REFS) return [`${at}.variants must list 1 to ${MAX_VARIANT_REFS} options or scenarios of options.json.`];
  return v.some(x => typeof x !== "string" || !VARIANT_REF.test(x)) ? [`${at}.variants items must be option or scenario ids ("cloud" or "decision=option").`] : [];
}

/** The names under which the architecture in view is selected: each picked option (both spellings) and the scenario. */
export function selectedVariantKeys(picks: ReadonlyMap<string, string> | undefined, scenario?: string): Set<string> {
  const keys = new Set<string>();
  for (const [decision, option] of picks ?? []) { keys.add(option); keys.add(`${decision}=${option}`); }
  if (scenario) keys.add(scenario);
  return keys;
}

/** True when the declaration belongs to other routes only: scoped, and none of its variants is in view. */
export function outOfRoute(variants: readonly string[] | undefined, selected: ReadonlySet<string> | undefined): boolean {
  return Boolean(variants?.length) && !variants!.some(v => selected?.has(v));
}

export const onlyForText = (variants: readonly string[]) => `needed only for ${variants.join(", ")}`;
