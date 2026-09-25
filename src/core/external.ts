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

/**
 * Opening a folder on a remote host (Remote - SSH) goes through its own seam for the same reason:
 * desktop tests must never start a real SSH connection or a new window.
 */
export type FolderOpener = (uri: vscode.Uri) => Thenable<unknown>;
const REMOTE_SSH = "ms-vscode-remote.remote-ssh";
const systemFolder: FolderOpener = async uri => {
  if (!vscode.extensions.getExtension(REMOTE_SSH)) throw new Error(`Install the "Remote - SSH" extension (${REMOTE_SSH}) to open ${uri.authority.replace(/^ssh-remote\+/, "")}.`);
  return vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
};
let currentFolder: FolderOpener = systemFolder;
export const openRemoteFolder: FolderOpener = uri => currentFolder(uri);
export function setFolderOpenerForTests(impl?: FolderOpener): void {
  currentFolder = impl ?? systemFolder;
}

/** Test-mode only: replace (or with no argument, restore) the external opener. */
export function setExternalOpenerForTests(impl?: ExternalOpener): void {
  current = impl ?? system;
}
