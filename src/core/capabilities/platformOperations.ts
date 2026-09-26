/**
 * Operation readiness per Galaxy platform card, from the same capability registry and
 * preflight the Work view uses. A card's tool status says what is installed; these rows say
 * which operations could actually be attempted, and why not.
 */
import { CAPABILITIES, type CapabilityRecord } from "./registry";
import { preflight, type PreflightContext } from "./preflight";
import type { PlatformOperation } from "../types";

/** Registry providers that have a Galaxy card. Others (mongo, apps, airflow, …) live in the Work view only. */
export const PROVIDER_PLATFORM: Partial<Record<CapabilityRecord["provider"], string>> = {
  fabric: "fabric",
  databricks: "databricks",
  powerbi: "powerbi",
  grafana: "observability",
  infrastructure: "infrastructure"
};

export function platformOperations(ctx: PreflightContext, capabilities: readonly CapabilityRecord[] = CAPABILITIES): Map<string, PlatformOperation[]> {
  const out = new Map<string, PlatformOperation[]>();
  for (const cap of capabilities) {
    const platform = PROVIDER_PLATFORM[cap.provider];
    if (!platform) continue;
    const r = preflight(cap, ctx);
    const list = out.get(platform) ?? [];
    list.push({ id: cap.id, label: cap.label, status: r.status, nextStep: r.nextStep, nativeTool: cap.implementation === "documented-only" });
    out.set(platform, list);
  }
  return out;
}
