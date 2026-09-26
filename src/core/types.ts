import type { PreflightStatus } from "./capabilities/preflight";

export type StatusLevel = "ready" | "partial" | "missing" | "unbound" | "error";

export interface ToolProbe {
  id: string;
  label: string;
  available: boolean;
  /** Optional companions are shown but never lower a platform's status. */
  optional?: boolean;
  version?: string;
  detail?: string;
}

export interface PlatformAction {
  id: string;
  label: string;
  enabled: boolean;
  kind: "open" | "copy" | "run" | "link" | "configure";
  detail?: string;
}

export interface CatalogItemState {
  id: string;
  name: string;
  category: string;
  kind: string;
  source: string;
  description?: string;
  verifiedRef?: string;
  actions: PlatformAction[];
}

/** Readiness of one registry operation on this platform (same preflight as the Work view). */
export interface PlatformOperation {
  id: string;
  label: string;
  status: PreflightStatus;
  nextStep: string;
  /** DataPass routes to the native tool and does not perform the operation itself. */
  nativeTool: boolean;
}

export interface PlatformState {
  id: string;
  title: string;
  status: StatusLevel;
  summary: string;
  tools: ToolProbe[];
  actions: PlatformAction[];
  details?: string[];
  operations?: PlatformOperation[];
  catalog?: {
    title: string;
    items: CatalogItemState[];
  };
}

export interface ProjectBinding {
  id: string;
  label: string;
  value?: string;
  status: "bound" | "missing" | "unknown" | "remote";
}

export interface ProjectProfileState {
  id: string;
  title: string;
  active: boolean;
  summary: string;
  bindings: ProjectBinding[];
  actions: PlatformAction[];
}

export type GalaxyAttentionSeverity = "error" | "warning" | "setup";

export interface GalaxyAttentionItem {
  id: string;
  severity: GalaxyAttentionSeverity;
  label: string;
  detail: string;
  action?: PlatformAction;
}

export interface GalaxyHealthSummary {
  overall: "healthy" | "attention" | "setup";
  platformCounts: Record<StatusLevel, number>;
  tools: { available: number; total: number };
  bindings: { bound: number; missing: number; unknown: number; remote?: number; total: number };
  attention: GalaxyAttentionItem[];
}

export interface GalaxyState {
  generatedAt: string;
  project: ProjectProfileState;
  platforms: PlatformState[];
  health?: GalaxyHealthSummary;
}

export interface PlatformAdapter {
  id: string;
  displayName: string;
  detect(): Promise<PlatformState>;
}