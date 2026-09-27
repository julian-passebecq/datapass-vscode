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
import { readProjectFile } from "./readFile";
import { DOMAIN_PACK_MAX_BYTES, PROJECT_FILE_MAX_BYTES } from "../model/boundedRead";
import { OPTIONS_PATH, parseOptions, type OptionsFile } from "../project/options";
import { SHEET_PATH, parseSheet, type ProjectSheet } from "../project/sheet";
import { BOARD_PATH, parseBoard, type Board } from "../project/board";
import { LINKS_PATH, parseLinks, type LinksFile } from "../project/links";
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
  /** 0.15: architecture options (.datapass/options.json) and project sheet (.datapass/sheet.json). */
  options?: OptionsFile;
  optionsBytes?: Uint8Array;
  optionsError?: string;
  sheet?: ProjectSheet;
  sheetBytes?: Uint8Array;
  sheetError?: string;
  /** 0.16: the project board (.datapass/board.json). */
  board?: Board;
  boardBytes?: Uint8Array;
  boardError?: string;
  /** V3-HOME: the project links page (.datapass/links.json, optional). */
  links?: LinksFile;
  linksError?: string;
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
    const got = await readProjectFile(vscode.Uri.joinPath(root, graphVet.relative), PROJECT_FILE_MAX_BYTES);
    if (got.kind === "error") ctx.graphError = `cannot read ${graphVet.relative}: ${got.message}`;
    else if (got.kind === "ok") {
      try { ctx.graph = parseGraph(got.bytes); } catch (error) { ctx.graphError = message(error); }
    }
  } else {
    ctx.graphError = `graph path rejected: ${graphVet.reason}`;
  }

  // Optional files: absent is normal; present but unreadable or invalid is reported, never replaced by a default.
  const options = await readProjectFile(vscode.Uri.joinPath(root, ...OPTIONS_PATH.split("/")), PROJECT_FILE_MAX_BYTES);
  if (options.kind === "error") ctx.optionsError = `cannot read ${OPTIONS_PATH}: ${options.message}`;
  else if (options.kind === "ok") {
    ctx.optionsBytes = options.bytes;
    try { ctx.options = parseOptions(options.bytes); } catch (error) { ctx.optionsError = message(error); }
  }
  const sheet = await readProjectFile(vscode.Uri.joinPath(root, ...SHEET_PATH.split("/")), PROJECT_FILE_MAX_BYTES);
  if (sheet.kind === "error") ctx.sheetError = `cannot read ${SHEET_PATH}: ${sheet.message}`;
  else if (sheet.kind === "ok") {
    ctx.sheetBytes = sheet.bytes;
    try { ctx.sheet = parseSheet(sheet.bytes); } catch (error) { ctx.sheetError = message(error); }
  }
  const board = await readProjectFile(vscode.Uri.joinPath(root, ...BOARD_PATH.split("/")), PROJECT_FILE_MAX_BYTES);
  if (board.kind === "error") ctx.boardError = `cannot read ${BOARD_PATH}: ${board.message}`;
  else if (board.kind === "ok") {
    ctx.boardBytes = board.bytes;
    try { ctx.board = parseBoard(board.bytes); } catch (error) { ctx.boardError = message(error); }
  }
  const links = await readProjectFile(vscode.Uri.joinPath(root, ...LINKS_PATH.split("/")), PROJECT_FILE_MAX_BYTES);
  if (links.kind === "error") ctx.linksError = `cannot read ${LINKS_PATH}: ${links.message}`;
  else if (links.kind === "ok") {
    try { ctx.links = parseLinks(links.bytes); } catch (error) { ctx.linksError = message(error); }
  }

  for (const ref of read.manifest?.domainPacks ?? []) {
    try {
      let uri: vscode.Uri;
      if (ref.startsWith("builtin:")) {
        const name = ref.slice("builtin:".length);
        if (!/^[a-z][a-z0-9.-]+$/.test(name)) throw new Error("invalid builtin pack name");
        uri = vscode.Uri.joinPath(extensionUri, "resources", "domain-packs", `${name}.json`);
      } else {
        const vet = vetRelativePath(ref);
        if (!vet.ok) throw new Error(vet.reason);
        uri = vscode.Uri.joinPath(root, vet.relative);
      }
      const got = await readProjectFile(uri, DOMAIN_PACK_MAX_BYTES);
      if (got.kind === "absent") throw new Error("not found");
      if (got.kind === "error") throw new Error(got.message);
      ctx.packs.push(parseDomainPack(got.bytes));
    } catch (error) {
      ctx.packErrors.push(`${ref}: ${message(error)}`);
    }
  }
  return ctx;
}

/**
 * Best-effort read that treats every failure as absent. Project files loaded above use the
 * typed, bounded `readProjectFile` instead, so a broken file is never shown as missing.
 */
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
