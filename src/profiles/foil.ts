import * as path from "node:path";
import * as vscode from "vscode";
import type { ProjectProfileState } from "../core/types";

/**
 * V1 FOIL profile, kept only as a fallback for workspaces with no `.datapass/project.json`: the
 * repositories are found by their folder names among the open workspace folders. The V1 settings
 * `datapass.foil.controlRoot`, `datapass.foil.databricksRoot` and `datapass.foil.oracleSshHost` and
 * the three FOIL commands were removed in V1-FOILSURF; a configuration that still sets those keys
 * loads with no error and the values are ignored (projects link their repositories and the Oracle
 * SSH alias through `.datapass/project.json`).
 */
const EXPECTED_FOLDERS = { control: "foil-control-v1", databricks: "foil_databrick_dab" } as const;

export async function detectFoilProfile(): Promise<ProjectProfileState> {
  const folders = workspaceFolderPaths();
  const control = findFoilFolder(folders, "control");
  const databricks = findFoilFolder(folders, "databricks");
  const active = Boolean(control || databricks || folders.some(folder => /foil/i.test(path.basename(folder))));

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
      { id: "oracle", label: "Oracle VM SSH alias", status: "unknown" }
    ],
    actions: [
      { id: "foil.openControl", label: "Open control repo", enabled: Boolean(control), kind: "open" },
      { id: "foil.openDatabricks", label: "Open Databricks repo", enabled: Boolean(databricks), kind: "open" }
    ]
  };
}

export async function getFoilBinding(id: "control" | "databricks"): Promise<string | undefined> {
  return findFoilFolder(workspaceFolderPaths(), id);
}

/** Pure: the open workspace folder named like the V1 FOIL repository, if any. */
export function findFoilFolder(folders: readonly string[], id: "control" | "databricks"): string | undefined {
  const expected = EXPECTED_FOLDERS[id].toLowerCase();
  return folders.find(folder => path.basename(folder).toLowerCase() === expected);
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
}
