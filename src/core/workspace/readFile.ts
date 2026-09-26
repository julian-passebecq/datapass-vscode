/** VS Code adapter for the typed, bounded project-file read (see core/model/boundedRead). */
import * as vscode from "vscode";
import { boundedRead, type ReadOutcome } from "../model/boundedRead";

export function readProjectFile(uri: vscode.Uri, maxBytes: number): Promise<ReadOutcome> {
  return boundedRead({
    stat: async () => {
      const s = await vscode.workspace.fs.stat(uri);
      return { size: s.size, isFile: (s.type & vscode.FileType.File) !== 0 };
    },
    read: () => Promise.resolve(vscode.workspace.fs.readFile(uri))
  }, maxBytes);
}
