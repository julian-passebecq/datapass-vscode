import type { StatusLevel, ToolProbe } from "./types";

export function deriveStatus(allTools: ToolProbe[], configured = false): StatusLevel {
  // Optional companions (community extensions, AI helpers) never lower platform status.
  const tools = allTools.filter(tool => !tool.optional);
  if (tools.length === 0) return configured ? "partial" : "unbound";
  const available = tools.filter(tool => tool.available).length;
  if (available === tools.length && configured) return "ready";
  if (available > 0) return "partial";
  return configured ? "partial" : "missing";
}

/**
 * CAPROUTE1b (brief § 35, 37): a platform whose readiness is per operation (Fabric) never reports one
 * global "ready". The card says only whether any of its tools is here; each operation carries its own
 * readiness from the capability router.
 */
export function perOperationStatus(allTools: ToolProbe[]): StatusLevel {
  return allTools.some(tool => tool.available) ? "partial" : "missing";
}

export function statusLabel(status: StatusLevel): string {
  switch (status) {
    case "ready": return "Ready";
    case "partial": return "Partial";
    case "missing": return "Missing";
    case "unbound": return "Unbound";
    case "error": return "Error";
  }
}
