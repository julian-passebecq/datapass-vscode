/** VS Code adapter for the typed, bounded project-file read (see core/model/boundedRead). */
import * as vscode from "vscode";
import { promises as fsp } from "node:fs";
import { boundedRead, type ReadOutcome } from "../model/boundedRead";

export function readProjectFile(uri: vscode.Uri, maxBytes: number): Promise<ReadOutcome> {
  // Local project files need no round trip through the window's filesystem provider. Keep
  // the same bounded read/error classification; virtual/remote URIs retain the VS Code port.
  if (uri.scheme === "file") return boundedRead({
    stat: async () => {
      const s = await fsp.stat(uri.fsPath);
      return { size: s.size, isFile: s.isFile() };
    },
    read: () => fsp.readFile(uri.fsPath)
  }, maxBytes);
  return boundedRead({
    stat: async () => {
      const s = await vscode.workspace.fs.stat(uri);
      return { size: s.size, isFile: (s.type & vscode.FileType.File) !== 0 };
    },
    read: () => Promise.resolve(vscode.workspace.fs.readFile(uri))
  }, maxBytes);
}
