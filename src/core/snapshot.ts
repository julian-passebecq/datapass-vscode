import type { GalaxyState } from "./types";

export interface SanitizedEnvironmentSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  redaction: string;
  project: {
    id: string;
    title: string;
    active: boolean;
    bindings: Array<{
      id: string;
      label: string;
      status: "bound" | "missing" | "unknown";
    }>;
  };
  platforms: Array<{
    id: string;
    title: string;
    status: string;
    tools: Array<{
      id: string;
      label: string;
      available: boolean;
      version?: string;
    }>;
    catalog?: {
      itemCount: number;
      categories: string[];
    };
  }>;
}

export function buildSanitizedEnvironmentSnapshot(state: GalaxyState): SanitizedEnvironmentSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: state.generatedAt,
    redaction: "Local binding values, filesystem paths, action payloads, tool detail strings and credentials are omitted.",
    project: {
      id: state.project.id,
      title: state.project.title,
      active: state.project.active,
      bindings: state.project.bindings.map(binding => ({
        id: binding.id,
        label: binding.label,
        status: binding.status
      }))
    },
    platforms: state.platforms.map(platform => ({
      id: platform.id,
      title: platform.title,
      status: platform.status,
      tools: platform.tools.map(tool => ({
        id: tool.id,
        label: tool.label,
        available: tool.available,
        ...(tool.version ? { version: tool.version } : {})
      })),
      ...(platform.catalog ? {
        catalog: {
          itemCount: platform.catalog.items.length,
          categories: [...new Set(platform.catalog.items.map(item => item.category))].sort()
        }
      } : {})
    }))
  };
}
