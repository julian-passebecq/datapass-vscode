/**
 * Which folder is the project (audit F02). In a multi-root workspace the coordination repository is
 * not necessarily the first folder: DataPass uses the folder that holds `.datapass/project.json`,
 * or the one the person chose when several do. Every component asks here instead of reading
 * `workspaceFolders[0]`.
 */
import * as vscode from "vscode";

let current: vscode.Uri | undefined;

/** The project (coordination) folder of this window, or the first folder when none is chosen yet. */
export function projectRoot(): vscode.Uri | undefined {
  if (current && vscode.workspace.workspaceFolders?.some(f => f.uri.toString() === current!.toString())) return current;
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function setProjectRoot(uri: vscode.Uri | undefined): void {
  current = uri;
}

async function hasManifest(folder: vscode.Uri): Promise<boolean> {
  try { return (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, ".datapass", "project.json"))).type === vscode.FileType.File; } catch { return false; }
}

/**
 * Folders that hold a project manifest, and the one to use: the stored choice when it still has a
 * manifest, else the first such folder, else the first folder.
 */
export async function detectProjectRoot(stored: string | undefined): Promise<{ root?: vscode.Uri; candidates: vscode.Uri[] }> {
  const folders = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
  const candidates: vscode.Uri[] = [];
  for (const f of folders.slice(0, 20)) if (await hasManifest(f)) candidates.push(f);
  const chosen = candidates.find(c => c.toString() === stored) ?? candidates[0] ?? folders[0];
  return { root: chosen, candidates };
}
