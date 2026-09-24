import * as vscode from "vscode";
import { detectManyCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { anyWorkspaceFile } from "../core/vscodeDetection";
import { getProjectPlatformConfig } from "../core/projectState";
import { hostLabel, safeAppUrl } from "../core/model/safeUrl";

export class ObservabilityAdapter implements PlatformAdapter {
  readonly id = "observability";
  readonly displayName = "Observability / Grafana";

  async detect(): Promise<PlatformState> {
    const detected = await detectManyCli([
      { id: "gcx", label: "Grafana gcx", command: "gcx", args: ["--version"] },
      { id: "tofu", label: "OpenTofu", command: "tofu", args: ["version"] },
      { id: "terraform", label: "Terraform", command: "terraform", args: ["version"] }
    ]);
    const gcx = detected[0]!;
    const tofu = detected[1]!;
    const terraform = detected[2]!;
    const sourceDetected = await anyWorkspaceFile(["**/grafana/**/*.{ts,go,json,yaml,yml}", "**/*dashboard*.{ts,go,json,yaml,yml}"]);
    const config = vscode.workspace.getConfiguration("datapass");
    const projectConfig = await getProjectPlatformConfig();
    const generator = config.get<string>("grafana.generatorCommand", "").trim() || projectConfig?.grafana?.generatorCommand?.trim() || "";
    const watchPath = config.get<string>("grafana.watchPath", "").trim() || projectConfig?.grafana?.watchPath?.trim() || "";
    // A configured stack is a destination, not a tool: it never raises the card's readiness.
    const stack = safeAppUrl(projectConfig?.grafana?.url);
    const tools: ToolProbe[] = [
      gcx,
      tofu,
      terraform,
      {
        id: "grafana-source",
        label: "Dashboard-as-code source",
        available: sourceDetected || Boolean(generator),
        detail: generator ? `Generator: ${generator}` : (sourceDetected ? "Candidate dashboard source detected" : "No generator configured")
      }
    ];
    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(tools, Boolean(generator)),
      summary: "Grafana is treated as observability as code: source -> Foundation SDK -> gcx preview -> Git -> deployment.",
      tools,
      actions: [
        { id: "grafana.openStack", label: "Open Grafana", enabled: Boolean(stack), kind: "link", detail: stack ? `${hostLabel(stack)} · link only, not a health check` : "Set platforms.grafana.url in .datapass/project.json" },
        { id: "grafana.copyPreview", label: "Copy gcx preview", enabled: Boolean(gcx.available && generator), kind: "copy", detail: watchPath ? `Watch: ${watchPath}` : undefined },
        { id: "grafana.openFoundation", label: "Foundation SDK", enabled: true, kind: "link" },
        { id: "grafana.openProvider", label: "Grafana provider", enabled: true, kind: "link" }
      ]
    };
  }
}