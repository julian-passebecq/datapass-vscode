import * as path from "node:path";
import * as vscode from "vscode";
import type { ProjectProfileDefinition } from "../core/profiles";
import type { ProjectProfileState } from "../core/types";

export const FOIL_PROFILE: ProjectProfileDefinition = {
  id: "foil",
  title: "FOIL",
  repoBindings: [
    { id: "control", label: "FOIL control", setting: "foil.controlRoot", expectedFolder: "foil-control-v1" },
    { id: "databricks", label: "FOIL Databricks", setting: "foil.databricksRoot", expectedFolder: "foil_databrick_dab" }
  ],
  platformBindings: ["fabric", "databricks", "observability", "infrastructure"]
};

export async function detectFoilProfile(): Promise<ProjectProfileState> {
  const config = vscode.workspace.getConfiguration("datapass");
  const control = await resolveBinding(config.get<string>("foil.controlRoot", ""), "foil-control-v1");
  const databricks = await resolveBinding(config.get<string>("foil.databricksRoot", ""), "foil_databrick_dab");
  const oracleHost = config.get<string>("foil.oracleSshHost", "").trim();
  const active = Boolean(control || databricks || workspaceSuggestsFoil());

  return {
    id: "foil",
    title: "FOIL",
    active,
    summary: active
      ? "FOIL project profile detected. Project bindings remain local; engineering truth stays in FOIL authorities."
      : "FOIL profile available but not bound in this workspace.",
    bindings: [
      { id: "control", label: "foil-control-v1", value: control, status: control ? "bound" : "missing" },
      { id: "databricks", label: "foil_databrick_dab", value: databricks, status: databricks ? "bound" : "missing" },
      { id: "fabric", label: "Fabric workspace", status: "unknown" },
      { id: "oracle", label: "Oracle VM SSH alias", value: oracleHost || undefined, status: oracleHost ? "bound" : "unknown" }
    ],
    actions: [
      { id: "foil.selectControl", label: control ? "Change control repo" : "Bind control repo", enabled: true, kind: "configure" },
      { id: "foil.selectDatabricks", label: databricks ? "Change Databricks repo" : "Bind Databricks repo", enabled: true, kind: "configure" },
      { id: "foil.openControl", label: "Open control repo", enabled: Boolean(control), kind: "open" },
      { id: "foil.openDatabricks", label: "Open Databricks repo", enabled: Boolean(databricks), kind: "open" },
      { id: "foil.openOracle", label: "Open Oracle SSH", enabled: Boolean(oracleHost), kind: "open" }
    ]
  };
}

export async function getFoilBinding(id: "control" | "databricks"): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("datapass");
  if (id === "control") return resolveBinding(config.get<string>("foil.controlRoot", ""), "foil-control-v1");
  return resolveBinding(config.get<string>("foil.databricksRoot", ""), "foil_databrick_dab");
}

async function resolveBinding(configured: string, expectedFolder: string): Promise<string | undefined> {
  const explicit = configured.trim();
  if (explicit) return explicit;
  const folder = vscode.workspace.workspaceFolders?.find(
    item => path.basename(item.uri.fsPath).toLowerCase() === expectedFolder.toLowerCase()
  );
  return folder?.uri.fsPath;
}

function workspaceSuggestsFoil(): boolean {
  return Boolean(vscode.workspace.workspaceFolders?.some(folder => /foil/i.test(path.basename(folder.uri.fsPath))));
}
