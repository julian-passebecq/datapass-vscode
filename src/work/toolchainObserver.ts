/**
 * What manifest v5 needs from the disk: the coordination repository's `.vscode/extensions.json`
 * (read as data, never written) and, for each declared git-binding, whether its folder exists in
 * the local clone. Read-only: symbolic links are not followed and large files are not read.
 */
import * as vscode from "vscode";
import type { DataPassProjectManifest } from "../core/projectManifestModel";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { EXTENSIONS_JSON, MAX_EXTENSIONS_JSON_BYTES, parseExtensionsJson, type ExtensionsJsonObservation } from "../core/toolchain/extensionsJson";
import { envFileFolder } from "./envObserver";

export async function observeExtensionsJson(root: vscode.Uri): Promise<ExtensionsJsonObservation> {
  const uri = vscode.Uri.joinPath(root, ...EXTENSIONS_JSON.split("/"));
  let stat: vscode.FileStat;
  try { stat = await vscode.workspace.fs.stat(uri); } catch { return { state: "absent" }; }
  if (stat.type & vscode.FileType.SymbolicLink) return { state: "invalid", reason: "a symbolic link (not followed)" };
  if (!(stat.type & vscode.FileType.File)) return { state: "invalid", reason: "not a file" };
  if (stat.size > MAX_EXTENSIONS_JSON_BYTES) return { state: "invalid", reason: "larger than 64 KiB" };
  try { return parseExtensionsJson(await vscode.workspace.fs.readFile(uri)); } catch { return { state: "invalid", reason: "cannot be read" }; }
}

export async function observeBindingFolders(o: { root: vscode.Uri; manifest?: DataPassProjectManifest; coordinationKey: string; folders: ReadonlyMap<string, vscode.Uri> }): Promise<Map<string, "found" | "missing" | "not-cloned">> {
  const out = new Map<string, "found" | "missing" | "not-cloned">();
  for (const c of (o.manifest?.connections ?? []).filter(x => x.kind === "git-binding" && x.folder).slice(0, 30)) {
    const vet = vetRelativePath(c.folder!.replace(/\/+$/, ""));
    if (!vet.ok) continue;
    const folder = envFileFolder(o, c.repoRef);
    if (!folder) { out.set(c.id, "not-cloned"); continue; }
    const uri = vscode.Uri.joinPath(folder, ...vet.relative.split("/"));
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      out.set(c.id, stat.type & vscode.FileType.Directory && !(stat.type & vscode.FileType.SymbolicLink) ? "found" : "missing");
    } catch { out.set(c.id, "missing"); }
  }
  return out;
}
