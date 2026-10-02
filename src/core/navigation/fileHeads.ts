/**
 * V4-STATUS a10: the decoded head (first 4 KB) of each project file, so the NAVLOC1 ladder can tell a
 * Spark notebook from a Python one. Read-only and bounded: never executes anything, never reads more
 * than HEAD_BYTES of a local file. The ladder reads the cache synchronously; `warm` fills it in the
 * background and reports when something new was read, so the host rebuilds the ladder once.
 */
import { open } from "node:fs/promises";
import * as vscode from "vscode";
import type { ProjectMap } from "../project/projectMap";

export const HEAD_BYTES = 4096;

/** Repository-relative files the ladder classifies: each component's entry and files. */
export function mapFiles(map: ProjectMap): { repoKey: string; repoPath: string }[] {
  const out = new Map<string, { repoKey: string; repoPath: string }>();
  for (const c of map.components) {
    const a = c.artifacts;
    if (!a) continue;
    for (const f of [a.entry, ...a.files]) if (f && f.kind === "file") out.set(`${a.repoKey}:${f.repoPath}`, { repoKey: a.repoKey, repoPath: f.repoPath });
  }
  return [...out.values()];
}

export class FileHeads {
  private readonly heads = new Map<string, string | null>();
  private warming: Promise<boolean> | undefined;

  /** `folder` maps a repository key to its local folder (the session's observed clone). */
  constructor(private readonly folder: (repoKey: string) => vscode.Uri | undefined) {}

  /** The cached head; undefined = not read (yet), so the ladder answers "other" instead of guessing. */
  get(repoKey: string, repoPath: string): string | undefined { return this.heads.get(`${repoKey}:${repoPath}`) ?? undefined; }

  /** Read the heads not cached yet; resolves true when at least one new head was read. */
  warm(map: ProjectMap): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      let read = false;
      for (const f of mapFiles(map)) {
        const k = `${f.repoKey}:${f.repoPath}`;
        if (this.heads.has(k)) continue;
        const root = this.folder(f.repoKey);
        if (!root) continue;
        const head = await readHead(vscode.Uri.joinPath(root, ...f.repoPath.split("/")));
        this.heads.set(k, head ?? null);
        if (head !== undefined) read = true;
      }
      return read;
    };
    const next = (this.warming ?? Promise.resolve(false)).then(run, run);
    this.warming = next;
    return next;
  }

  /** Forget everything (a file changed on disk, or the project changed). */
  clear(): void { this.heads.clear(); }
}

/** The first HEAD_BYTES of a file as text; undefined when it cannot be read. */
export async function readHead(uri: vscode.Uri): Promise<string | undefined> {
  try {
    if (uri.scheme === "file") {
      const fh = await open(uri.fsPath, "r");
      try {
        const buf = Buffer.alloc(HEAD_BYTES);
        const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
        return new TextDecoder("utf-8").decode(buf.subarray(0, bytesRead));
      } finally { await fh.close(); }
    }
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > 8 * 1024 * 1024) return undefined;
    return new TextDecoder("utf-8").decode((await vscode.workspace.fs.readFile(uri)).subarray(0, HEAD_BYTES));
  } catch { return undefined; }
}
