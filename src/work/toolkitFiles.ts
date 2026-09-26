/**
 * Reads the toolkit files of the hub repositories this window knows (0.23): the project folder's own
 * `.datapass/toolkit/` (when the coordination repository is also the hub) and the `toolkit/` folder
 * beside each catalog of the `datapass.catalogs` setting (`<hub>/.datapass/catalog.json` →
 * `<hub>/.datapass/toolkit/`). tools.json first, then recipes/*.json by name. Nothing is run; a file
 * that cannot be read is reported with its reason.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { parseToolkitFile, TOOLKIT_DIR, type ToolkitFileResult } from "../core/toolkit/toolkit";

const MAX_FILES = 40;
const MAX_BYTES = 2 * 1024 * 1024;

/** Toolkit folders to read, without duplicates, with the name shown for each. */
export function toolkitFolders(root: vscode.Uri | undefined, catalogs: readonly string[]): Array<{ uri: vscode.Uri; label: string }> {
  const out: Array<{ uri: vscode.Uri; label: string }> = [];
  const seen = new Set<string>();
  const add = (uri: vscode.Uri, label: string) => { const k = path.resolve(uri.fsPath).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ uri, label }); } };
  if (root) add(vscode.Uri.joinPath(root, ...TOOLKIT_DIR.split("/")), path.basename(root.fsPath));
  for (const c of catalogs.filter(x => typeof x === "string" && path.isAbsolute(x)).slice(0, 10)) {
    const dir = path.dirname(c);
    // <hub>/.datapass/catalog.json → <hub>/.datapass/toolkit; a catalog elsewhere → a toolkit folder beside it.
    const hub = path.basename(dir) === ".datapass" ? path.dirname(dir) : dir;
    add(vscode.Uri.file(path.join(dir, "toolkit")), path.basename(hub));
  }
  return out;
}

async function readDir(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
  try { return await vscode.workspace.fs.readDirectory(uri); } catch { return []; }
}

export async function loadToolkitFiles(root: vscode.Uri | undefined, dataPassVersion: string): Promise<ToolkitFileResult[]> {
  const catalogs = vscode.workspace.getConfiguration("datapass").get<string[]>("catalogs") ?? [];
  const results: ToolkitFileResult[] = [];
  for (const folder of toolkitFolders(root, catalogs)) {
    const files: Array<{ uri: vscode.Uri; rel: string }> = [];
    if ((await readDir(folder.uri)).some(([n, t]) => n === "tools.json" && t === vscode.FileType.File)) files.push({ uri: vscode.Uri.joinPath(folder.uri, "tools.json"), rel: "tools.json" });
    const recipes = (await readDir(vscode.Uri.joinPath(folder.uri, "recipes"))).filter(([n, t]) => t === vscode.FileType.File && /^[A-Za-z0-9._-]+\.json$/.test(n)).map(([n]) => n).sort();
    for (const n of recipes) files.push({ uri: vscode.Uri.joinPath(folder.uri, "recipes", n), rel: `recipes/${n}` });
    for (const f of files) {
      if (results.length >= MAX_FILES) break;
      const shown = `${folder.label}/${TOOLKIT_DIR}/${f.rel}`;
      try {
        const stat = await vscode.workspace.fs.stat(f.uri);
        if (stat.size > MAX_BYTES) throw new Error("larger than 2 MiB");
        results.push(parseToolkitFile(await vscode.workspace.fs.readFile(f.uri), shown, dataPassVersion));
      } catch (e) {
        results.push({ path: shown, error: e instanceof Error ? e.message : String(e), tools: [], recipes: [], requests: [], skipped: [] });
      }
    }
  }
  return results;
}

/** The folder a shown toolkit path lives in (to open the file), or undefined. */
export function toolkitFileUri(root: vscode.Uri | undefined, shownPath: string): vscode.Uri | undefined {
  const catalogs = vscode.workspace.getConfiguration("datapass").get<string[]>("catalogs") ?? [];
  for (const folder of toolkitFolders(root, catalogs)) {
    const prefix = `${folder.label}/${TOOLKIT_DIR}/`;
    if (!shownPath.startsWith(prefix)) continue;
    const rel = shownPath.slice(prefix.length);
    if (rel === "tools.json" || /^recipes\/[A-Za-z0-9._-]+\.json$/.test(rel)) return vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
  }
  return undefined;
}
