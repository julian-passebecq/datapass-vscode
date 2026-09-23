import type {
  GalaxyAttentionItem,
  GalaxyHealthSummary,
  PlatformAction,
  PlatformState,
  ProjectProfileState,
  StatusLevel
} from "./types";

const STATUS_KEYS: StatusLevel[] = ["ready", "partial", "missing", "unbound", "error"];

export function buildGalaxyHealth(
  project: ProjectProfileState,
  platforms: PlatformState[]
): GalaxyHealthSummary {
  const platformCounts: Record<StatusLevel, number> = {
    ready: 0,
    partial: 0,
    missing: 0,
    unbound: 0,
    error: 0
  };
  let toolsAvailable = 0;
  let toolsTotal = 0;

  for (const platform of platforms) {
    platformCounts[platform.status] += 1;
    toolsAvailable += platform.tools.filter(tool => tool.available).length;
    toolsTotal += platform.tools.length;
  }

  const bindings = {
    bound: project.bindings.filter(binding => binding.status === "bound").length,
    missing: project.bindings.filter(binding => binding.status === "missing").length,
    unknown: project.bindings.filter(binding => binding.status === "unknown").length,
    total: project.bindings.length
  };

  const attention: GalaxyAttentionItem[] = [];

  if (!project.active) {
    const invalid = project.id === "invalid-manifest";
    attention.push({
      id: invalid ? "project.invalid" : "project.unbound",
      severity: invalid ? "error" : "setup",
      label: invalid ? "Project manifest is invalid" : "Project context is not bound",
      detail: project.summary,
      action: findSafeAction(project.actions, invalid ? "project.openManifest" : undefined)
    });
  }

  for (const binding of project.bindings) {
    if (binding.status === "missing") {
      attention.push({
        id: `binding.missing.${binding.id}`,
        severity: "warning",
        label: `Missing project binding · ${binding.label}`,
        detail: "The project manifest points to a resource that is not available locally.",
        action: findSafeAction(project.actions, "project.openManifest")
      });
    }
  }

  for (const platform of platforms) {
    if (platform.status === "error") {
      attention.push({
        id: `platform.error.${platform.id}`,
        severity: "error",
        label: `${platform.title} detection failed`,
        detail: platform.summary,
        action: findSafeAction(platform.actions)
      });
      continue;
    }
    if (platform.status === "missing") {
      attention.push({
        id: `platform.missing.${platform.id}`,
        severity: "warning",
        label: `${platform.title} tooling is missing`,
        detail: platform.summary,
        action: findSafeAction(platform.actions)
      });
    }
  }

  const hasBlockingAttention = attention.some(item => item.severity === "error" || item.severity === "warning");
  const overall: GalaxyHealthSummary["overall"] =
    hasBlockingAttention
      ? "attention"
      : !project.active
        ? "setup"
        : "healthy";

  return {
    overall,
    platformCounts,
    tools: { available: toolsAvailable, total: toolsTotal },
    bindings,
    attention
  };
}

function findSafeAction(
  actions: PlatformAction[],
  preferredId?: string
): PlatformAction | undefined {
  if (preferredId) {
    const preferred = actions.find(action => action.id === preferredId && action.enabled);
    if (preferred) return preferred;
  }
  return actions.find(action =>
    action.enabled &&
    (action.kind === "open" || action.kind === "configure" || action.kind === "link")
  );
}

export function platformCountTotal(summary: GalaxyHealthSummary): number {
  return STATUS_KEYS.reduce((total, status) => total + summary.platformCounts[status], 0);
}