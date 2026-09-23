import * as vscode from "vscode";
import type { GalaxyState, PlatformAdapter, PlatformState } from "./types";
import { FabricAdapter } from "../adapters/fabric";
import { DatabricksAdapter } from "../adapters/databricks";
import { PowerBiAdapter } from "../adapters/powerbi";
import { ObservabilityAdapter } from "../adapters/observability";
import { InfrastructureAdapter } from "../adapters/infrastructure";
import { detectActiveProject } from "./projectState";

export function createAdapters(extensionUri: vscode.Uri): PlatformAdapter[] {
  return [
    new FabricAdapter(extensionUri),
    new DatabricksAdapter(),
    new PowerBiAdapter(),
    new ObservabilityAdapter(),
    new InfrastructureAdapter()
  ];
}

export async function collectGalaxyState(extensionUri: vscode.Uri): Promise<GalaxyState> {
  const [project, platforms] = await Promise.all([
    detectActiveProject(),
    Promise.all(createAdapters(extensionUri).map(adapter => safeDetect(adapter)))
  ]);
  return { generatedAt: new Date().toISOString(), project, platforms };
}

async function safeDetect(adapter: PlatformAdapter): Promise<PlatformState> {
  try {
    return await adapter.detect();
  } catch (error) {
    return {
      id: adapter.id,
      title: adapter.displayName,
      status: "error",
      summary: `Detection failed: ${error instanceof Error ? error.message : String(error)}`,
      tools: [],
      actions: [{ id: "refresh", label: "Refresh", enabled: true, kind: "open" }]
    };
  }
}