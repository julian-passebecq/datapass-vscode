import * as vscode from "vscode";
import { detectManyCli } from "../core/detection";
import { deriveStatus } from "../core/status";
import type { PlatformAdapter, PlatformState, ToolProbe } from "../core/types";
import { detectAnyExtension, detectExtension } from "../core/vscodeDetection";
import { getProjectPlatformConfig } from "../core/projectState";
import { resolveManifestPath } from "../core/projectManifest";
import { projectRoot } from "../core/workspace/root";

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
    // OpenTofu is the declared IaC route; Terraform and Kubernetes tooling are alternatives or
    // later capabilities and never lower the card status on their own.
    const optionalCli = new Set(["terraform", "kubectl"]);
    const tools: ToolProbe[] = [
      detectExtension("OpenTofu.vscode-opentofu", "OpenTofu VS Code"),
      { ...detectExtension("hashicorp.terraform", "Terraform VS Code"), optional: true },
      { ...detectExtension("ms-kubernetes-tools.vscode-kubernetes-tools", "Kubernetes VS Code"), optional: true },
      detectAnyExtension(["ms-azuretools.vscode-containers", "ms-azuretools.vscode-docker"], "Container Tools", { optional: true }),
      detectExtension("ms-vscode-remote.remote-ssh", "Remote SSH"),
      ...cli.map(tool => (optionalCli.has(tool.id) ? { ...tool, optional: true } : tool))
    ];
    const workspaceRoot = projectRoot()?.fsPath;
    const projectConfig = await getProjectPlatformConfig();
    const manifestRoot = projectConfig?.infrastructure?.root?.trim();
    const root = workspaceRoot && manifestRoot ? resolveManifestPath(workspaceRoot, manifestRoot) : workspaceRoot;
    return {
      id: this.id,
      title: this.displayName,
      status: deriveStatus(tools, Boolean(root)),
      summary: "Infrastructure remains in best-of-breed peer extensions and CLIs; DataPass adds project-aware status and safe commands.",
      details: [root ? `Infrastructure root: ${root}` : "No infrastructure root is bound."],
      tools,
      actions: [
        { id: "infra.copyTofuValidate", label: "Copy tofu validate", enabled: Boolean(root && cli.find(tool => tool.id === "tofu")?.available), kind: "copy" },
        { id: "infra.copyTofuPlan", label: "Copy tofu plan", enabled: Boolean(root && cli.find(tool => tool.id === "tofu")?.available), kind: "copy" },
        { id: "infra.openRemoteSsh", label: "Remote SSH", enabled: true, kind: "open" }
      ]
    };
  }
}