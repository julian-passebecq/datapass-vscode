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
}

export const LOCAL_DIR = ".datapass/local";

export async function loadProjectContext(extensionUri: vscode.Uri): Promise<ProjectContext> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const read = await readProjectManifest();
  const ctx: ProjectContext = { root, manifest: read.manifest, manifestBytes: read.bytes, manifestExists: read.exists, manifestErrors: read.errors, packs: [], packErrors: [] };
  if (!root) return ctx;

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

/** Facts for capability preflight, derived from declared bindings only (never from secrets). */
export function projectFacts(ctx: ProjectContext): Map<string, string | boolean | undefined> {
  const m = ctx.manifest;
  const p = m?.platforms;
  const facts = new Map<string, string | boolean | undefined>();
  facts.set("fabric.workspace", p?.fabric?.workspaceName || p?.fabric?.workspaceId);
  facts.set("fabric.workspaceName", p?.fabric?.workspaceName);
  facts.set("fabric.deployConfig", p?.fabric?.deployment?.configPath ? true : undefined);
  facts.set("databricks.bundleRoot", p?.databricks?.bundleRoot || (m?.repositories?.databricks?.path ? true : undefined));
  facts.set("databricks.target", p?.databricks?.defaultTarget);
  facts.set("grafana.repo", p?.grafana?.watchPath || p?.grafana?.generatorCommand ? true : undefined);
  facts.set("grafana.instance", undefined);
  facts.set("infrastructure.root", p?.infrastructure?.root || (ctx.root ? true : undefined));
  facts.set("vm.sshHost", p?.oracle?.sshHost);
  facts.set("powerbi.pbip", p?.powerbi?.projectRoot ? true : undefined);
  facts.set("powerbi.semanticModel", p?.powerbi?.projectRoot ? true : undefined);
  facts.set("powerbi.reportPbir", p?.powerbi?.projectRoot ? true : undefined);
  facts.set("airflow.mode", p?.airflow?.mode);
  facts.set("airflow.identity", p?.airflow?.identity);
  facts.set("airflow.gitSync.repo", p?.airflow?.gitSyncRepo);
  facts.set("airflow.workspaceGitAlm", p?.airflow?.workspaceGitAlm);
  facts.set("app.repoUrl", Object.values(m?.repositories ?? {}).some(r => r.remote?.url) ? true : undefined);
  return facts;
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
