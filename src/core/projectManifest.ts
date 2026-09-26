import * as vscode from "vscode";
import { validateProjectManifest, type DataPassProjectManifest } from "./projectManifestModel";
import { parseStrictJson } from "./model/strictJson";
import { projectRoot } from "./workspace/root";
import { readProjectFile } from "./workspace/readFile";
import { PROJECT_FILE_MAX_BYTES } from "./model/boundedRead";

export * from "./projectManifestModel";

export interface ManifestReadResult {
  exists: boolean;
  uri?: vscode.Uri;
  manifest?: DataPassProjectManifest;
  /** Exact bytes read, for base hashing. */
  bytes?: Uint8Array;
  errors: string[];
}

/** The manifest of this window's project, or of the project in `folder` (another project, 0.17). */
export async function readProjectManifest(folder?: vscode.Uri): Promise<ManifestReadResult> {
  const root = folder ?? projectRoot();
  if (!root) return { exists: false, errors: [] };
  const uri = vscode.Uri.joinPath(root, ".datapass", "project.json");

  // Typed, bounded read: absent is "no manifest"; unreadable, too large or not a file is an error, never "absent".
  const read = await readProjectFile(uri, PROJECT_FILE_MAX_BYTES);
  if (read.kind === "absent") return { exists: false, uri, errors: [] };
  if (read.kind === "error") return { exists: true, uri, errors: [`Cannot read .datapass/project.json: ${read.message}`] };

  const bytes = read.bytes;
  try {
    // Strict parse: duplicate keys, non-finite numbers and prototype keys are rejected.
    const raw = parseStrictJson(bytes, { maxBytes: PROJECT_FILE_MAX_BYTES });
    const errors = validateProjectManifest(raw);
    return errors.length
      ? { exists: true, uri, bytes, errors }
      : { exists: true, uri, bytes, manifest: raw as DataPassProjectManifest, errors: [] };
  } catch (error) {
    return {
      exists: true,
      uri,
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

export async function writeProjectManifest(manifest: DataPassProjectManifest): Promise<vscode.Uri> {
  const root = projectRoot();
  if (!root) throw new Error("Open a workspace folder before creating a DataPass project manifest.");
  const dir = vscode.Uri.joinPath(root, ".datapass");
  const uri = vscode.Uri.joinPath(dir, "project.json");
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n"));
  return uri;
}
