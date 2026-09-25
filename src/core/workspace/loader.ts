/**
 * Loads the DataPass project context for the current workspace: manifest, graph and packs.
 * Every file is parsed as untrusted data with the strict parser; failures are reported,
 * never silently replaced by defaults.
 */
import * as vscode from "vscode";
import { readProjectManifest, type DataPassProjectManifest } from "../projectManifest";
import { parseGraph, type ProjectGraph } from "./graph";
import { parseDomainPack, type DomainPack } from "../domainPacks/pack";
import { vetRelativePath } from "../exchange/pathSafety";
import { projectRoot } from "./root";
export { projectFacts } from "./facts";

export interface ProjectContext {
  root?: vscode.Uri;
  manifest?: DataPassProjectManifest;
  manifestBytes?: Uint8Array;
  manifestExists: boolean;
  manifestErrors: string[];
  graph?: ProjectGraph;
  graphError?: string;
  packs: DomainPack[];
  packErrors: string[];
  /** `.datapass/diagramcloud.json` exists (presence only; the bridge reads it when used). */
  diagramCloudSidecar?: boolean;
}

export const LOCAL_DIR = ".datapass/local";

export async function loadProjectContext(extensionUri: vscode.Uri): Promise<ProjectContext> {
  const root = projectRoot();
  const read = await readProjectManifest();
  const ctx: ProjectContext = { root, manifest: read.manifest, manifestBytes: read.bytes, manifestExists: read.exists, manifestErrors: read.errors, packs: [], packErrors: [] };
  if (!root) return ctx;
  try { ctx.diagramCloudSidecar = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ".datapass", "diagramcloud.json"))).type === vscode.FileType.File; } catch { ctx.diagramCloudSidecar = false; }

  const graphRel = read.manifest?.graph ?? ".datapass/graph.json";
  const graphVet = vetRelativePath(graphRel);
  if (graphVet.ok) {
    const bytes = await readOptional(vscode.Uri.joinPath(root, graphVet.relative));
    if (bytes) {
      try { ctx.graph = parseGraph(bytes); } catch (error) { ctx.graphError = message(error); }
    }
  } else {
    ctx.graphError = `graph path rejected: ${graphVet.reason}`;
  }

  for (const ref of read.manifest?.domainPacks ?? []) {
    try {
      let bytes: Uint8Array | undefined;
      if (ref.startsWith("builtin:")) {
        const name = ref.slice("builtin:".length);
        if (!/^[a-z][a-z0-9.-]+$/.test(name)) throw new Error("invalid builtin pack name");
        bytes = await readOptional(vscode.Uri.joinPath(extensionUri, "resources", "domain-packs", `${name}.json`));
      } else {
        const vet = vetRelativePath(ref);
        if (!vet.ok) throw new Error(vet.reason);
        bytes = await readOptional(vscode.Uri.joinPath(root, vet.relative));
      }
      if (!bytes) throw new Error("not found");
      ctx.packs.push(parseDomainPack(bytes));
    } catch (error) {
      ctx.packErrors.push(`${ref}: ${message(error)}`);
    }
  }
  return ctx;
}

export async function readOptional(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
}

/** Write under .datapass/local, which ignores itself so private exchange history never reaches Git by accident. */
export async function writeLocal(root: vscode.Uri, relative: string, bytes: Uint8Array): Promise<vscode.Uri> {
  const vet = vetRelativePath(relative);
  if (!vet.ok) throw new Error(`Refusing local write: ${vet.reason}`);
  const localDir = vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"));
  await vscode.workspace.fs.createDirectory(localDir);
  const ignore = vscode.Uri.joinPath(localDir, ".gitignore");
  if (!(await readOptional(ignore))) await vscode.workspace.fs.writeFile(ignore, new TextEncoder().encode("# DataPass private session data. Never committed.\n*\n"));
  const target = vscode.Uri.joinPath(localDir, ...vet.relative.split("/"));
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."));
  await vscode.workspace.fs.writeFile(target, bytes);
  return target;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
