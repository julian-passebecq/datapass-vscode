import type { GalaxyState } from "./types";
import { readinessSnapshot, type Readiness, type ReadinessSnapshot } from "./readiness/readiness";

export interface SanitizedEnvironmentSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  redaction: string;
  health?: {
    overall: "healthy" | "attention" | "setup";
    platformCounts: Record<string, number>;
    tools: { available: number; total: number };
    bindings: { bound: number; missing: number; unknown: number; remote?: number; total: number };
    attention: Array<{ severity: string; label: string }>;
  };
  project: {
    id: string;
    title: string;
    active: boolean;
    bindings: Array<{
      id: string;
      label: string;
      status: "bound" | "missing" | "unknown" | "remote";
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
  /** Env files, variable names and checks: names and states only, never a value. */
  environment?: ReadinessSnapshot;
}

export function buildSanitizedEnvironmentSnapshot(state: GalaxyState, readiness?: Readiness): SanitizedEnvironmentSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: state.generatedAt,
    redaction: "Local binding values, filesystem paths, action payloads, tool/platform detail strings, env values and credentials are omitted. Env files and variables appear as names and states only.",
    ...(state.health ? {
      health: {
        overall: state.health.overall,
        platformCounts: { ...state.health.platformCounts },
        tools: { ...state.health.tools },
        bindings: { ...state.health.bindings },
        attention: state.health.attention.map(item => ({
          severity: item.severity,
          label: item.label
        }))
      }
    } : {}),
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
        ...(tool.optional ? { optional: true } : {}),
        ...(tool.version ? { version: tool.version } : {})
      })),
      ...(platform.catalog ? {
        catalog: {
          itemCount: platform.catalog.items.length,
          categories: [...new Set(platform.catalog.items.map(item => item.category))].sort()
        }
      } : {})
    })),
    ...(readiness ? { environment: readinessSnapshot(readiness) } : {})
  };
}