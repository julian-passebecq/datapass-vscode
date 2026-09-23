import { detectCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { anyWorkspaceFile, detectExtension } from "../core/vscodeDetection";
import { getFoilBinding } from "../profiles/foil";

export class DatabricksAdapter implements PlatformAdapter {
  readonly id = "databricks";
  readonly displayName = "Databricks";

  async detect(): Promise<PlatformState> {
    const extension = detectExtension("databricks.databricks", "Official Databricks extension");
    const cli = await detectCli({ id: "databricks-cli", label: "Databricks CLI", command: "databricks", args: ["--version"] });
    const bundleInWorkspace = await anyWorkspaceFile(["**/databricks.yml", "**/databricks.yaml", "**/bundle.yml", "**/bundle.yaml"]);
    const foilRoot = await getFoilBinding("databricks");
    const projectBound = Boolean(bundleInWorkspace || foilRoot);
    const tools: ToolProbe[] = [
      extension,
      cli,
      {
        id: "bundle-project",
        label: "Asset Bundle project",
        available: projectBound,
        detail: foilRoot ? `FOIL binding: ${foilRoot}` : (bundleInWorkspace ? "Bundle manifest found in workspace" : "No bundle project bound")
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
      details: ["The historical databricks-vscode-foil fork is reference-only and is not required by this extension."]
    };
  }
}
