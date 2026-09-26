/**
 * The one clipboard DataPass uses. `vscode.env.clipboard` is frozen, so the desktop test
 * suite swaps this implementation (through the Test-mode API only) to drive copy/paste
 * flows without ever touching the user's system clipboard.
 */
import * as vscode from "vscode";

export interface Clipboard {
  readText(): Thenable<string>;
  writeText(value: string): Thenable<void>;
}

const system: Clipboard = {
  readText: () => vscode.env.clipboard.readText(),
  writeText: value => vscode.env.clipboard.writeText(value)
};

let current: Clipboard = system;

export const clipboard: Clipboard = {
  readText: () => current.readText(),
  writeText: value => current.writeText(value)
};

/** Test-mode only: replace (or with no argument, restore) the clipboard implementation. */
export function setClipboardForTests(impl?: Clipboard): void {
  current = impl ?? system;
}
