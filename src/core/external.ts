/**
 * The one way DataPass opens a URL outside VS Code. Like the clipboard seam, the desktop test
 * suite swaps this implementation (through the Test-mode API only), so flows that end in
 * "open in browser" are exercised without ever launching the user's browser.
 */
import * as vscode from "vscode";

export type ExternalOpener = (uri: vscode.Uri) => Thenable<boolean>;

const system: ExternalOpener = uri => vscode.env.openExternal(uri);

let current: ExternalOpener = system;

export const openExternal: ExternalOpener = uri => current(uri);

/** Test-mode only: replace (or with no argument, restore) the external opener. */
export function setExternalOpenerForTests(impl?: ExternalOpener): void {
  current = impl ?? system;
}
