/**
 * Observe the env files a project declares (manifest v4 `localEnv`): exists or not, which of the
 * declared variable NAMES each defines (set / empty), and whether Git ignores it.
 *
 * Read-only. The bytes of an env file go straight into envKeyPresence, which keeps nothing but
 * the presence of declared names; the bytes are not stored, logged or returned. Symbolic links
 * are not followed (a checked-out link could point anywhere) and large files are not read. Git
 * runs only in a trusted workspace, by absolute path, with read commands (ls-files, check-ignore).
 */
import * as vscode from "vscode";
import type { DataPassProjectManifest } from "../core/projectManifestModel";
import type { GitRunner } from "../core/workspace/gitBase";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { envKeyPresence, isEnvFileName, MAX_ENV_FILE_BYTES } from "../core/readiness/envFile";
import { envFileId, normalizeEnvFile, type EnvFileGit, type EnvFileObservation } from "../core/readiness/readiness";

export interface EnvObserveOptions {
  root: vscode.Uri;
  manifest?: DataPassProjectManifest;
  coordinationKey: string;
  /** Repository key → local folder (session-private). */
  folders: ReadonlyMap<string, vscode.Uri>;
  trusted: boolean;
  git: GitRunner;
}

/** The folder an env file lives in: its repository's clone, or the project folder. */
export function envFileFolder(o: Pick<EnvObserveOptions, "root" | "coordinationKey" | "folders">, repoRef: string | undefined): vscode.Uri | undefined {
  if (!repoRef || repoRef === o.coordinationKey) return o.root;
  return o.folders.get(repoRef);
}

export async function observeLocalEnv(o: EnvObserveOptions): Promise<Map<string, EnvFileObservation>> {
  const out = new Map<string, EnvFileObservation>();
  const decl = o.manifest?.localEnv;
  if (!decl) return out;
  const wanted = new Set(decl.requiredKeys ?? []);
  for (const f of decl.files.map(normalizeEnvFile)) {
    const id = envFileId(f);
    const vet = vetRelativePath(f.path);
    if (!vet.ok || !isEnvFileName(vet.relative)) { out.set(id, { state: "not-checked", reason: "not an env file path" }); continue; }
    const folder = envFileFolder(o, f.repoRef);
    if (!folder) { out.set(id, { state: "not-cloned" }); continue; }
    const uri = vscode.Uri.joinPath(folder, ...vet.relative.split("/"));
    let stat: vscode.FileStat;
    try { stat = await vscode.workspace.fs.stat(uri); } catch (error) {
      out.set(id, error instanceof vscode.FileSystemError && error.code !== "FileNotFound" ? { state: "unreadable", reason: "cannot be read" } : { state: "missing" });
      continue;
    }
    if (stat.type & vscode.FileType.SymbolicLink) { out.set(id, { state: "unreadable", reason: "a symbolic link (not followed)" }); continue; }
    if (!(stat.type & vscode.FileType.File)) { out.set(id, { state: "unreadable", reason: "not a file" }); continue; }
    if (stat.size > MAX_ENV_FILE_BYTES) { out.set(id, { state: "too-large", reason: "larger than 256 KiB" }); continue; }
    let presence;
    try { presence = envKeyPresence(await vscode.workspace.fs.readFile(uri), wanted); } catch { out.set(id, { state: "unreadable", reason: "cannot be read" }); continue; }
    out.set(id, { state: "found", presence, git: o.trusted ? await gitStatusOf(o.git, folder.fsPath, vet.relative) : "unknown" });
  }
  return out;
}

/** tracked (committed) / ignored / not-ignored; unknown when the folder is not a Git repository. */
export async function gitStatusOf(git: GitRunner, folder: string, relative: string): Promise<EnvFileGit> {
  const listed = await git(["ls-files", "--", relative], folder, 5000);
  if (!listed.ok) return "unknown";
  if (listed.stdout.split(/\r?\n/).some(line => line.trim() === relative)) return "tracked";
  const ignored = await git(["check-ignore", "-q", "--", relative], folder, 5000);
  return ignored.ok ? "ignored" : "not-ignored";
}
