/**
 * 0.23 variants (package G): the Project tree's *All variants* toggle and opening a variant's file.
 * Read-only: nothing here writes a project file; the toggle lives in memory and a context key.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import type { ProjectTreeProvider } from "../views/projectTree";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { guarded, UserFacingError } from "./io";

export const ALL_VARIANTS_KEY = "datapass.allVariants";

export function registerVariantCommands(context: vscode.ExtensionContext, session: WorkSession, tree: ProjectTreeProvider): void {
  const set = async (on: boolean) => {
    tree.setAllVariants(on);
    await vscode.commands.executeCommand("setContext", ALL_VARIANTS_KEY, on);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("datapass.showAllVariants", guarded(() => set(true))),
    vscode.commands.registerCommand("datapass.showSelectedArchitecture", guarded(() => set(false))),
    vscode.commands.registerCommand("datapass.openVariantFile", guarded(async (repoKey?: unknown, repoPath?: unknown) => openVariantFile(session, repoKey, repoPath)))
  );
  void vscode.commands.executeCommand("setContext", ALL_VARIANTS_KEY, false);
}

/** Open a file a variant needs, in the clone that holds it (a folder is revealed in the Explorer). */
async function openVariantFile(session: WorkSession, repoKey: unknown, repoPath: unknown): Promise<void> {
  if (typeof repoKey !== "string" || typeof repoPath !== "string" || !vetRelativePath(repoPath).ok) throw new UserFacingError("Choose a file from the All variants list.");
  const folder = session.repoFolder(repoKey);
  if (!folder) throw new UserFacingError(`The repository "${repoKey}" is not cloned on this machine, so DataPass cannot open ${repoPath}.`);
  const uri = vscode.Uri.joinPath(folder, ...repoPath.split("/"));
  let type: vscode.FileType;
  try { type = (await vscode.workspace.fs.stat(uri)).type; } catch { throw new UserFacingError(`${repoPath} is not in ${repoKey} yet: this variant has no files there yet.`); }
  if (type & vscode.FileType.Directory) await vscode.commands.executeCommand("revealInExplorer", uri);
  else await vscode.commands.executeCommand("vscode.open", uri);
}
