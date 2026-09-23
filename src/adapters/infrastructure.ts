import * as vscode from "vscode";
import { detectManyCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { detectExtension } from "../core/vscodeDetection";

export class InfrastructureAdapter implements PlatformAdapter {
  readonly id = "infrastructure";
  readonly displayName = "Infrastructure";

  async detect(): Promise<PlatformState> {
    const cli = await detectManyCli([
      { id: "tofu", label: "OpenTofu CLI", command: "tofu", args: ["version"] },
      { id: "terraform", label: "Terraform CLI", command: "terraform", args: ["version"] },
      { id: "docker", label: "Docker CLI", command: "docker", args: ["--version"] },
      { id: "kubectl", label: "kubectl", command: "kubectl", args: ["version", "--client"] },
      { id: "ssh", label: "SSH client", command: "ssh", args: ["-V"] }
    ]);
    const tools: ToolProbe[] = [
      detectExtension("OpenTofu.vscode-opentofu", "OpenTofu VS Code"),
      detectExtension("hashicorp.terraform", "Terraform VS Code"),
      detectExtension("ms-kubernetes-tools.vscode-kubernetes-tools", "Kubernetes VS Code"),
      detectExtension("ms-azuretools.vscode-docker", "Docker VS Code"),
      detectExtension("ms-vscode-remote.remote-ssh", "Remote SSH"),
      ...cli
    ];
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(tools, Boolean(root)),
      summary: "Infrastructure remains in best-of-breed peer extensions and CLIs; DataPass adds project-aware status and safe commands.",
      tools,
      actions: [
        { id: "infra.copyTofuValidate", label: "Copy tofu validate", enabled: Boolean(root && cli.find(tool => tool.id === "tofu")?.available), kind: "copy" },
        { id: "infra.copyTofuPlan", label: "Copy tofu plan", enabled: Boolean(root && cli.find(tool => tool.id === "tofu")?.available), kind: "copy" },
        { id: "infra.openRemoteSsh", label: "Remote SSH", enabled: true, kind: "open" }
      ]
    };
  }
}
