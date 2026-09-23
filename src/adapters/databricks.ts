import { detectCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { anyWorkspaceFile, detectExtension } from "../core/vscodeDetection";
import * as vscode from "vscode";
import { getFoilBinding } from "../profiles/foil";
import { getProjectPlatformConfig, resolveProjectRepository } from "../core/projectState";
import { resolveManifestPath } from "../core/projectManifest";

export class DatabricksAdapter implements PlatformAdapter {
  readonly id = "databricks";
  readonly displayName = "Databricks";

  async detect(): Promise<PlatformState> {
    const extension = detectExtension("databricks.databricks", "Official Databricks extension");
    const cli = await detectCli({ id: "databricks-cli", label: "Databricks CLI", command: "databricks", args: ["--version"] });
    const bundleInWorkspace = await anyWorkspaceFile(["**/databricks.yml", "**/databricks.yaml", "**/bundle.yml", "**/bundle.yaml"]);
    const projectConfig = await getProjectPlatformConfig();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const manifestBundleRoot = projectConfig?.databricks?.bundleRoot?.trim();
    const manifestRepoRoot = await resolveProjectRepository("databricks");
    const manifestRoot = manifestRepoRoot || (workspaceRoot && manifestBundleRoot ? resolveManifestPath(workspaceRoot, manifestBundleRoot) : undefined);
    const foilRoot = await getFoilBinding("databricks");
    const boundRoot = manifestRoot || foilRoot;
    const projectBound = Boolean(bundleInWorkspace || boundRoot);
    const tools: ToolProbe[] = [
      extension,
      cli,
      {
        id: "bundle-project",
        label: "Asset Bundle project",
        available: projectBound,
        detail: boundRoot ? `Project binding: ${boundRoot}` : (bundleInWorkspace ? "Bundle manifest found in workspace" : "No bundle project bound")
      }
    ];
    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(tools, projectBound),
      summary: extension.available
        ? "Official Databricks VS Code remains the primary client; DataPass adds project context and Bundle actions."
        : "Official Databricks extension is not installed; CLI/project actions remain independently detectable.",
      tools,
      actions: [
        { id: "databricks.open", label: "Open Databricks", enabled: true, kind: "open" },
        { id: "databricks.copyValidate", label: "Copy bundle validate", enabled: Boolean(cli.available && projectBound), kind: "copy" },
        { id: "databricks.copyDeploy", label: "Copy bundle deploy", enabled: Boolean(cli.available && projectBound), kind: "copy" }
      ],
      details: [
        projectConfig?.databricks?.defaultTarget ? `Manifest default target: ${projectConfig.databricks.defaultTarget}` : "No default Databricks target declared.",
        "The historical databricks-vscode-foil fork is reference-only and is not required by this extension."
      ]
    };
  }
}