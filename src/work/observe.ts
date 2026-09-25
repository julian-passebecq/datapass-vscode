/**
 * Filesystem observations for preflight and the project map: does a declared file or folder
 * exist? Only `stat` and directory listings; file contents are never read here and nothing is
 * executed. Paths are relative to a known root (or absolute, as declared in the manifest).
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { dirHas, fileFactPlan, type FactObservation, type FileCheck } from "../core/workspace/facts";
import type { DataPassProjectManifest } from "../core/projectManifestModel";

/** Resolve a declared path against a root: absolute paths stay as they are. */
export function resolveDeclared(root: vscode.Uri, declared: string): vscode.Uri {
  if (path.isAbsolute(declared) || /^[A-Za-z]:[\\/]/.test(declared)) return vscode.Uri.file(declared);
  return vscode.Uri.joinPath(root, ...declared.replace(/\\/g, "/").split("/").filter(s => s && s !== "."));
}

export async function statKind(uri: vscode.Uri): Promise<"file" | "dir" | "symlink" | "missing" | "error"> {
  try {
    const s = await vscode.workspace.fs.stat(uri);
    if (s.type & vscode.FileType.SymbolicLink) return "symlink";
    return s.type & vscode.FileType.Directory ? "dir" : "file";
  } catch (error) {
    return error instanceof vscode.FileSystemError && error.code === "FileNotFound" ? "missing" : "error";
  }
}

async function listing(uri: vscode.Uri, withChildren: (name: string) => boolean): Promise<Array<{ name: string; dir: boolean; children?: string[] }> | undefined> {
  try {
    const entries = (await vscode.workspace.fs.readDirectory(uri)).slice(0, 2000);
    return Promise.all(entries.map(async ([name, type]) => {
      const dir = Boolean(type & vscode.FileType.Directory);
      if (!dir || !withChildren(name)) return { name, dir };
      try { return { name, dir, children: (await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(uri, name))).slice(0, 200).map(([n]) => n) }; } catch { return { name, dir }; }
    }));
  } catch { return undefined; }
}

async function check(root: vscode.Uri, c: FileCheck): Promise<FactObservation> {
  switch (c.kind) {
    case "any-file": {
      let unreadable = false;
      for (const p of c.paths) {
        const k = await statKind(resolveDeclared(root, p));
        if (k === "file") return { state: "found" };
        if (k === "error") unreadable = true;
      }
      return unreadable ? { state: "unknown", detail: "could not be read" } : { state: "missing" };
    }
    case "dir": {
      const k = await statKind(resolveDeclared(root, c.path));
      return k === "dir" ? { state: "found" } : k === "error" ? { state: "unknown", detail: "could not be read" } : { state: "missing", detail: k === "file" ? "it is a file, not a folder" : undefined };
    }
    case "dir-has": {
      const dir = resolveDeclared(root, c.path);
      const k = await statKind(dir);
      if (k === "missing") return { state: "missing", detail: "the folder does not exist" };
      if (k !== "dir") return { state: "unknown", detail: "not a readable folder" };
      const entries = await listing(dir, name => c.test === "report-pbir" && /\.Report$/i.test(name));
      if (!entries) return { state: "unknown", detail: "the folder could not be listed" };
      return dirHas(c.test, entries) ? { state: "found" } : { state: "missing" };
    }
  }
}

/** Observe every file-backed fact the manifest declares. */
export async function observeFileFacts(root: vscode.Uri | undefined, manifest: DataPassProjectManifest | undefined): Promise<Map<string, FactObservation>> {
  const out = new Map<string, FactObservation>();
  const plan = fileFactPlan(manifest);
  if (!root) {
    for (const p of plan) out.set(p.fact, { state: "unknown", detail: "no folder is open" });
    return out;
  }
  await Promise.all(plan.map(async p => out.set(p.fact, await check(root, p.check))));
  return out;
}
