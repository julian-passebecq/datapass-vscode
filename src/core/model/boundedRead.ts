/**
 * Typed, bounded file reads for project files (V1-LOAD).
 *
 * A file that is absent is normal for optional project files. A file that exists but
 * cannot be read (permission denied, a directory in its place, larger than the bound,
 * an I/O failure) is an error the user must see, never "absent". This module has no
 * VS Code dependency: the caller passes a small file-system port, so it is unit-tested.
 */

/** Size bound for project JSON files (.datapass/project.json, graph, options, sheet, board). Same as the strict JSON parser's default. */
export const PROJECT_FILE_MAX_BYTES = 1_048_576;
/** Size bound for domain packs, matching the pack parser's limit. */
export const DOMAIN_PACK_MAX_BYTES = 512 * 1024;

export type ReadFailure = "too-large" | "permission-denied" | "not-a-file" | "unreadable";

export type ReadOutcome =
  | { kind: "ok"; bytes: Uint8Array }
  | { kind: "absent" }
  | { kind: "error"; reason: ReadFailure; message: string };

export interface ReadPort {
  /** Size in bytes and whether the entry is a regular file. Throws when absent or unreadable. */
  stat(): Promise<{ size: number; isFile: boolean }>;
  read(): Promise<Uint8Array>;
}

/** Classify an error thrown by `vscode.workspace.fs` or Node `fs`. */
export function classifyReadError(error: unknown): "absent" | ReadFailure {
  const e = error as { code?: unknown; name?: unknown; message?: unknown } | undefined;
  const tags = [e?.code, e?.name, e?.message].filter((v): v is string => typeof v === "string").join(" ");
  if (/\b(FileNotFound|EntryNotFound|ENOENT|ENOTDIR|FileNotADirectory)\b/.test(tags)) return "absent";
  if (/\b(NoPermissions|EACCES|EPERM)\b/.test(tags)) return "permission-denied";
  if (/\b(FileIsADirectory|EISDIR)\b/.test(tags)) return "not-a-file";
  return "unreadable";
}

const LABELS: Record<ReadFailure, string> = {
  "too-large": "file is too large",
  "permission-denied": "permission denied",
  "not-a-file": "not a regular file",
  "unreadable": "file could not be read"
};

function failure(reason: ReadFailure, detail?: string): ReadOutcome {
  return { kind: "error", reason, message: detail ? `${LABELS[reason]} (${detail})` : LABELS[reason] };
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read one file with a size bound; never turns a read failure into "absent". */
export async function boundedRead(port: ReadPort, maxBytes: number): Promise<ReadOutcome> {
  let info: { size: number; isFile: boolean };
  try {
    info = await port.stat();
  } catch (error) {
    const kind = classifyReadError(error);
    return kind === "absent" ? { kind: "absent" } : failure(kind, detailOf(error));
  }
  if (!info.isFile) return failure("not-a-file");
  if (info.size > maxBytes) return failure("too-large", `${info.size} bytes, limit ${maxBytes}`);
  let bytes: Uint8Array;
  try {
    bytes = await port.read();
  } catch (error) {
    const kind = classifyReadError(error);
    // Stat said it exists: a vanished file between stat and read is still absent, anything else is an error.
    return kind === "absent" ? { kind: "absent" } : failure(kind, detailOf(error));
  }
  // The file may have grown between stat and read.
  if (bytes.byteLength > maxBytes) return failure("too-large", `${bytes.byteLength} bytes, limit ${maxBytes}`);
  return { kind: "ok", bytes };
}
