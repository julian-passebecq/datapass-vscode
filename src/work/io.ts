/**
 * Small VS Code helpers shared by the work commands. Every import is size-bounded and every
 * workspace path is vetted before use.
 */
import * as vscode from "vscode";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { decodeUtf8Strict } from "../core/model/strictJson";

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

let channel: vscode.OutputChannel | undefined;
export function output(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("DataPass Work");
  return channel;
}

/** Print a report block to the DataPass output channel and reveal it. */
export function report(title: string, lines: string[]): void {
  const ch = output();
  ch.appendLine("");
  ch.appendLine(`== ${title} — ${new Date().toISOString()}`);
  for (const l of lines) ch.appendLine(l);
  ch.show(true);
}

export function requireRoot(root: vscode.Uri | undefined): vscode.Uri {
  if (!root) throw new UserFacingError("Open a workspace folder first.");
  return root;
}

export class UserFacingError extends Error {}
export class Cancelled extends Error {}

export function relativeTo(root: vscode.Uri, uri: vscode.Uri): string | undefined {
  const rel = vscode.workspace.asRelativePath(uri, false);
  if (rel === uri.fsPath || rel === uri.path) return undefined; // outside the workspace
  const vet = vetRelativePath(rel);
  return vet.ok ? vet.relative : undefined;
}

export async function readBounded(uri: vscode.Uri, max = MAX_IMPORT_BYTES): Promise<Uint8Array> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > max) throw new UserFacingError(`${uri.path.split("/").pop()} is ${stat.size} bytes; the limit is ${max}.`);
  return vscode.workspace.fs.readFile(uri);
}

export async function pickFile(title: string, root: vscode.Uri | undefined, filters?: Record<string, string[]>): Promise<vscode.Uri> {
  const picked = await vscode.window.showOpenDialog({ title, canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri: root, filters });
  if (!picked?.[0]) throw new Cancelled();
  return picked[0];
}

export async function pickFiles(title: string, root: vscode.Uri | undefined): Promise<vscode.Uri[]> {
  const picked = await vscode.window.showOpenDialog({ title, canSelectFiles: true, canSelectFolders: false, canSelectMany: true, defaultUri: root });
  return picked ?? [];
}

/** Clipboard or file; returns exact bytes (clipboard text is UTF-8 encoded once). */
export async function readJsonInput(what: string, root: vscode.Uri | undefined): Promise<{ bytes: Uint8Array; origin: string }> {
  const choice = await vscode.window.showQuickPick([
    { label: "$(clippy) From clipboard", id: "clip" },
    { label: "$(file) From file…", id: "file" }
  ], { title: `Import ${what}`, placeHolder: "Imported content is treated as untrusted data" });
  if (!choice) throw new Cancelled();
  if (choice.id === "clip") {
    const text = await vscode.env.clipboard.readText();
    if (!text.trim()) throw new UserFacingError("The clipboard is empty.");
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > MAX_IMPORT_BYTES) throw new UserFacingError("Clipboard content is too large.");
    return { bytes, origin: "clipboard" };
  }
  const uri = await pickFile(`Select ${what}`, root, { JSON: ["json"] });
  return { bytes: await readBounded(uri), origin: uri.path.split("/").pop() ?? "file" };
}

export function text(bytes: Uint8Array): string {
  return decodeUtf8Strict(bytes);
}

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
}

export async function confirmModal(message: string, detail: string, action: string): Promise<boolean> {
  const r = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
  return r === action;
}

export async function openLocal(root: vscode.Uri, relative: string): Promise<void> {
  const vet = vetRelativePath(relative);
  if (!vet.ok) throw new UserFacingError(`Refusing to open ${relative}: ${vet.reason}`);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, ...vet.relative.split("/")));
  await vscode.window.showTextDocument(doc, { preview: true });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wrap a command: user errors become messages, cancellations are silent. */
export function guarded<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof Cancelled) return;
      const msg = errorMessage(error);
      output().appendLine(`[error] ${msg}`);
      void vscode.window.showErrorMessage(`DataPass: ${msg}`);
    }
  };
}
