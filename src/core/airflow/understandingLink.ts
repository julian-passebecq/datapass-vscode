/**
 * V3-AIRFLOW: is there a DataPass Hop explanation (`datapass.understanding`, V3-HOP1) for this file?
 *
 * Name lookups only (no file is read or parsed here): the bridge keeps one JSON per native file at
 * `.datapass/understanding/<repository key>/<native path>.json`. The native path is the file's path
 * inside its repository, which DataPass does not know here, so every suffix of the file's path
 * relative to a workspace folder is tried (bounded). Symlinked understanding folders are skipped.
 */
import { promises as fsp } from "node:fs";
import * as path from "node:path";

const MAX_KEYS = 64;
const MAX_SUFFIXES = 8;

export async function findUnderstanding(file: string, bridgeRoots: readonly string[], workspaceRoots: readonly string[]): Promise<string | undefined> {
  const rels = new Set<string>();
  for (const root of workspaceRoots) {
    const rel = path.relative(root, file);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const parts = rel.split(/[\\/]/);
    for (let i = 0; i < parts.length - 1 && i < MAX_SUFFIXES; i++) rels.add(parts.slice(i).join("/"));
    rels.add(parts[parts.length - 1]!);
  }
  if (!rels.size) rels.add(path.basename(file));
  for (const bridge of [...new Set(bridgeRoots)]) {
    const dir = path.join(bridge, ".datapass", "understanding");
    let keys: string[];
    try {
      if ((await fsp.lstat(dir)).isSymbolicLink()) continue;
      keys = (await fsp.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().slice(0, MAX_KEYS);
    } catch { continue; }
    for (const key of keys) for (const rel of rels) {
      const candidate = path.join(dir, key, ...rel.split("/")) + ".json";
      try { const st = await fsp.lstat(candidate); if (st.isFile()) return candidate; } catch { /* absent */ }
    }
  }
  return undefined;
}
