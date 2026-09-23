import * as vscode from "vscode";
import { detectManyCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { anyWorkspaceFile } from "../core/vscodeDetection";

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
    const generator = vscode.workspace.getConfiguration("datapass").get<string>("grafana.generatorCommand", "").trim();
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
        { id: "grafana.copyPreview", label: "Copy gcx preview", enabled: Boolean(gcx.available && generator), kind: "copy" },
        { id: "grafana.openFoundation", label: "Foundation SDK", enabled: true, kind: "link" },
        { id: "grafana.openProvider", label: "Grafana provider", enabled: true, kind: "link" }
      ]
    };
  }
}