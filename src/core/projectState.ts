import * as path from "node:path";
import * as vscode from "vscode";
import type { PlatformAction, ProjectBinding, ProjectProfileState } from "./types";
import { readProjectManifest, resolveManifestPath, type DataPassProjectManifest } from "./projectManifest";
import { detectFoilProfile } from "../profiles/foil";

export async function detectActiveProject(): Promise<ProjectProfileState> {
  const read = await readProjectManifest();
  if (read.exists && read.errors.length) {
    return {
      id: "invalid-manifest",
      title: "DataPass project",
      active: false,
      summary: `Invalid .datapass/project.json: ${read.errors.join(" ")}`,
      bindings: [],
      actions: [
        { id: "project.openManifest", label: "Open manifest", enabled: Boolean(read.uri), kind: "open" }
      ]
    };
  }

  if (read.manifest) return manifestToState(read.manifest);
  const foil = await detectFoilProfile();
  if (foil.active) {
    return {
      ...foil,
      actions: [
        { id: "project.initializeManifestFoil", label: "Create project manifest", enabled: true, kind: "configure" },
        ...foil.actions
      ]
    };
  }

  return {
    id: "unbound",
    title: "DataPass project",
    active: false,
    summary: "No .datapass/project.json found. Create a portable, source-controlled project manifest to bind platform context without storing secrets.",
    bindings: [],
    actions: [
      { id: "project.initializeManifest", label: "Create manifest", enabled: true, kind: "configure" },
      { id: "project.initializeManifestFoil", label: "Create FOIL manifest", enabled: true, kind: "configure" }
    ]
  };
}

export async function resolveProjectRepository(key: string): Promise<string | undefined> {
  const read = await readProjectManifest();
  const manifest = read.manifest;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configured = manifest?.repositories?.[key]?.path;
  if (!root || !configured) return undefined;
  return resolveManifestPath(root, configured);
}

export async function getProjectPlatformConfig(): Promise<DataPassProjectManifest["platforms"] | undefined> {
  return (await readProjectManifest()).manifest?.platforms;
}

async function manifestToState(manifest: DataPassProjectManifest): Promise<ProjectProfileState> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const bindings: ProjectBinding[] = [];
  const actions: PlatformAction[] = [
    { id: "project.openManifest", label: "Open manifest", enabled: true, kind: "open" }
  ];

  if (root) {
    for (const [key, repo] of Object.entries(manifest.repositories ?? {})) {
      const value = resolveManifestPath(root, repo.path);
      let exists = false;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(value));
        exists = true;
      } catch {
        exists = false;
      }
      bindings.push({
        id: key,
        label: repo.label || key,
        value,
        status: exists ? "bound" : "missing"
      });
      actions.push({
        id: `project.openRepo::${key}`,
        label: `Open ${repo.label || key}`,
        enabled: true,
        kind: "open"
      });
    }
  }

  const platformBindings = manifest.platforms ?? {};
  if (platformBindings.fabric) {
    const workspace = platformBindings.fabric.workspaceName || platformBindings.fabric.workspaceId;
    bindings.push({
      id: "fabric",
      label: "Fabric workspace",
      value: workspace,
      status: workspace ? "bound" : "unknown"
    });
  }
  if (platformBindings.oracle) {
    const host = platformBindings.oracle.sshHost;
    bindings.push({
      id: "oracle",
      label: "Oracle SSH alias",
      value: host,
      status: host ? "bound" : "unknown"
    });
  }

  (manifest.links ?? []).forEach((link, index) => {
    actions.push({
      id: `project.openLink::${index}`,
      label: link.label,
      enabled: true,
      kind: "link"
    });
  });

  return {
    id: manifest.project.id,
    title: manifest.project.title,
    active: true,
    summary: manifest.project.description || `DataPass project manifest loaded${manifest.project.profile ? ` · profile: ${manifest.project.profile}` : ""}.`,
    bindings,
    actions
  };
}

export function workspaceFolderName(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return root ? path.basename(root) : "data-project";
}