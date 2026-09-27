/**
 * V3-HOP1: find and load the bridge's DataPass Hop files.
 *
 * A refresh only indexes file names (`indexUnderstanding`: bounded directory walk, no file read);
 * a file is read, validated and compared with its native file on demand (`forNativeFile`, `load`).
 * Symlinks are never followed, reads are size-bounded, and the native file must stay inside its
 * repository folder (realpath containment).
 */
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { boundedRead, type ReadPort } from "../model/boundedRead";
import { isInside, resolveWithinRoot, vetRelativePath } from "../exchange/pathSafety";
import { runBounded } from "../project/observation";
import {
  checkAgainstNative, hasError, lineCount, normaliseNativeText, parseUnderstanding, UNDERSTANDING_DIR, UNDERSTANDING_LIMITS,
  type UnderstandingDiagnostic, type UnderstandingDoc
} from "./contract";

/** At most this many understanding files are indexed per refresh; the rest are reported. */
export const MAX_INDEXED_FILES = 2000;
/** Folder depth below `.datapass/understanding/<key>/`. */
export const MAX_INDEX_DEPTH = 16;
/** Folders visited per refresh. */
export const MAX_INDEX_DIRS = 2000;
/** Native files larger than this are not explained (and never hashed). */
export const MAX_NATIVE_BYTES = 4 * 1024 * 1024;

export type UnderstandingState = "ok" | "stale" | "orphan" | "invalid";

/** One file name found at refresh; nothing read yet. */
export interface IndexedUnderstanding {
  repositoryKey: string;
  /** Repository-relative native path, `/`-separated (the file name without its final `.json`). */
  nativePath: string;
  /** Absolute path of the understanding file. */
  file: string;
}

export interface UnderstandingIndex {
  bridgeRoot: string;
  files: IndexedUnderstanding[];
  /** Problems of the folder itself (symlinks, stray files, limits reached). */
  diagnostics: UnderstandingDiagnostic[];
  truncated: boolean;
}

export interface UnderstandingEntry extends IndexedUnderstanding {
  state: UnderstandingState;
  doc?: UnderstandingDoc;
  diagnostics: UnderstandingDiagnostic[];
  /** Absolute path of the native file when its repository is on this machine. */
  nativeFile?: string;
  /** SHA-256 of the native file now (normalised text), when it was read. */
  currentSha256?: string;
  /** Line count of the native file now. */
  lines?: number;
  /** The catalog generation that produced this entry (a newer refresh supersedes it). */
  generation: number;
}

const fold = (s: string) => process.platform === "win32" ? s.toLowerCase() : s;
const keyOf = (repositoryKey: string, nativePath: string) => `${fold(repositoryKey)}\u0000${fold(nativePath)}`;

/** Walk `.datapass/understanding` and list its files; reads directory entries only. */
export async function indexUnderstanding(bridgeRoot: string): Promise<UnderstandingIndex> {
  const out: UnderstandingIndex = { bridgeRoot, files: [], diagnostics: [], truncated: false };
  const base = path.join(bridgeRoot, ...UNDERSTANDING_DIR.split("/"));
  let st;
  try { st = await fsp.lstat(base); } catch { return out; }
  if (st.isSymbolicLink()) { out.diagnostics.push({ severity: "error", code: "symlink", message: `${UNDERSTANDING_DIR} is a symbolic link; DataPass does not follow it.` }); return out; }
  if (!st.isDirectory()) return out;
  let dirs = 0;
  const walk = async (dir: string, rel: string[], depth: number): Promise<void> => {
    if (out.truncated) return;
    if (++dirs > MAX_INDEX_DIRS || depth > MAX_INDEX_DEPTH) { out.truncated = true; return; }
    let names;
    try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch { out.diagnostics.push({ severity: "warning", code: "unreadable", message: `${[UNDERSTANDING_DIR, ...rel].join("/")} could not be listed.` }); return; }
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of names) {
      const relPath = [...rel, d.name];
      const shown = [UNDERSTANDING_DIR, ...relPath].join("/");
      if (d.isSymbolicLink()) { out.diagnostics.push({ severity: "warning", code: "symlink", message: `${shown} is a symbolic link; skipped.` }); continue; }
      if (d.isDirectory()) { await walk(path.join(dir, d.name), relPath, depth + 1); if (out.truncated) return; continue; }
      if (!d.isFile()) continue;
      if (relPath.length < 2) { out.diagnostics.push({ severity: "warning", code: "location", message: `${shown} is not inside a repository folder (${UNDERSTANDING_DIR}/<repository key>/<native path>.json); skipped.` }); continue; }
      if (!/\.json$/i.test(d.name) || d.name.length <= 5) { out.diagnostics.push({ severity: "warning", code: "not-json", message: `${shown} is not a .json file; skipped.` }); continue; }
      const nativePath = [...relPath.slice(1, -1), d.name.slice(0, -5)].join("/");
      const vet = vetRelativePath(nativePath);
      if (!vet.ok) { out.diagnostics.push({ severity: "warning", code: "target-path", message: `${shown}: ${vet.reason}; skipped.` }); continue; }
      if (out.files.length >= MAX_INDEXED_FILES) { out.truncated = true; return; }
      out.files.push({ repositoryKey: relPath[0]!, nativePath: vet.relative, file: path.join(dir, d.name) });
    }
  };
  await walk(base, [], 0);
  if (out.truncated) out.diagnostics.push({ severity: "warning", code: "truncated", message: `Only the first ${out.files.length} files of ${UNDERSTANDING_DIR} were indexed (limits: ${MAX_INDEXED_FILES} files, ${MAX_INDEX_DIRS} folders, depth ${MAX_INDEX_DEPTH}).` });
  return out;
}

/** `follow`: false for bridge files (a symlink is not a file there); true for native files, already contained. */
function nodePort(file: string, follow = false): ReadPort {
  return {
    async stat() { const s = await (follow ? fsp.stat(file) : fsp.lstat(file)); return { size: s.size, isFile: s.isFile() }; },
    read: () => fsp.readFile(file)
  };
}

const realpath = (p: string) => fsp.realpath(p).catch(() => undefined);

/**
 * The understanding files of a bridge and where their native files are. `repositories` maps each
 * manifest repository key to its local folder (undefined: declared but not cloned here).
 */
export class UnderstandingCatalog {
  private readonly byKey = new Map<string, IndexedUnderstanding>();
  private readonly cache = new Map<string, { stamp: string; entry: UnderstandingEntry }>();

  constructor(readonly index: UnderstandingIndex, private readonly repositories: ReadonlyMap<string, string | undefined>, readonly generation = 0) {
    for (const f of index.files) this.byKey.set(keyOf(f.repositoryKey, f.nativePath), f);
  }

  get files(): readonly IndexedUnderstanding[] { return this.index.files; }

  lookup(repositoryKey: string, nativePath: string): IndexedUnderstanding | undefined {
    return this.byKey.get(keyOf(repositoryKey, nativePath.replace(/\\/g, "/")));
  }

  /** The repository key and repository-relative path of an absolute file (deepest repository folder wins). */
  locate(file: string): { repositoryKey: string; nativePath: string } | undefined {
    const abs = path.resolve(file);
    let best: { repositoryKey: string; nativePath: string; depth: number } | undefined;
    for (const [key, folder] of this.repositories) {
      if (!folder) continue;
      const root = path.resolve(folder);
      if (!isInside(root, abs) || fold(root) === fold(abs)) continue;
      if (best && root.length <= best.depth) continue;
      best = { repositoryKey: key, nativePath: path.relative(root, abs).split(path.sep).join("/"), depth: root.length };
    }
    return best && { repositoryKey: best.repositoryKey, nativePath: best.nativePath };
  }

  /** The explanation of a native file (absolute path), read and checked now; undefined when none is written. */
  async forNativeFile(file: string): Promise<UnderstandingEntry | undefined> {
    const at = this.locate(file);
    const indexed = at && this.lookup(at.repositoryKey, at.nativePath);
    return indexed ? this.load(indexed) : undefined;
  }

  /** Read and check one indexed file; unchanged files (same size and time, native too) come from the cache. */
  async load(f: IndexedUnderstanding): Promise<UnderstandingEntry> {
    const folder = this.repositories.get(f.repositoryKey);
    const nativeGuess = folder ? path.join(folder, ...f.nativePath.split("/")) : undefined;
    const stamp = (await Promise.all([f.file, nativeGuess].map(async p => {
      if (!p) return "-";
      try { const s = await fsp.stat(p); return `${s.size}:${s.mtimeMs}`; } catch { return "absent"; }
    }))).join("|");
    const cached = this.cache.get(f.file);
    if (cached && cached.stamp === stamp) return cached.entry;
    const entry = await this.read(f, folder);
    this.cache.set(f.file, { stamp, entry });
    return entry;
  }

  /** Every indexed file, read and checked (bounded concurrency). */
  loadAll(concurrency = 8): Promise<UnderstandingEntry[]> {
    return runBounded(this.index.files, concurrency, f => this.load(f));
  }

  private async read(f: IndexedUnderstanding, folder: string | undefined): Promise<UnderstandingEntry> {
    const base = { ...f, generation: this.generation };
    const done = (e: Omit<UnderstandingEntry, "state" | keyof typeof base>, orphan = false, stale = false): UnderstandingEntry =>
      ({ ...base, ...e, state: hasError(e.diagnostics) ? "invalid" : orphan ? "orphan" : stale ? "stale" : "ok" });

    const got = await boundedRead(nodePort(f.file), UNDERSTANDING_LIMITS.maxBytes);
    if (got.kind === "absent") return done({ diagnostics: [{ severity: "error", code: "unreadable", message: "The file disappeared since the last refresh." }] });
    if (got.kind === "error") {
      const code = got.reason === "too-large" ? "oversized" : "unreadable";
      return done({ diagnostics: [{ severity: "error", code, message: `Cannot read the file: ${got.message}.` }] });
    }
    const parsed = parseUnderstanding(got.bytes);
    const diagnostics = [...parsed.diagnostics];
    const doc = parsed.doc;
    if (!doc) return done({ diagnostics });
    if (fold(doc.target.repository) !== fold(f.repositoryKey) || fold(doc.target.path) !== fold(f.nativePath)) {
      diagnostics.push({ severity: "error", code: "location", message: `The file sits at ${f.repositoryKey}/${f.nativePath} but its target says ${doc.target.repository}/${doc.target.path}; move it or fix target.` , path: "$.target" });
    }
    if (!this.repositories.has(f.repositoryKey)) {
      diagnostics.push({ severity: "error", code: "unknown-repository", message: `"${f.repositoryKey}" is not a repository of the project manifest.`, path: "$.target.repository" });
      return done({ doc, diagnostics });
    }
    if (!folder) {
      diagnostics.push({ severity: "warning", code: "not-cloned", message: `Repository "${f.repositoryKey}" is not on this machine; the native file cannot be checked.` });
      return done({ doc, diagnostics }, true);
    }
    const resolved = await resolveWithinRoot(folder, f.nativePath, realpath);
    if (!resolved.ok) {
      if (resolved.reason === "root does not exist") {
        diagnostics.push({ severity: "warning", code: "not-cloned", message: `Repository "${f.repositoryKey}" folder is missing on this machine.` });
        return done({ doc, diagnostics }, true);
      }
      diagnostics.push({ severity: "error", code: "native-escape", message: `The native file is refused: ${resolved.reason}.` });
      return done({ doc, diagnostics });
    }
    const nativeFile = resolved.absolute;
    const native = await boundedRead(nodePort(nativeFile, true), MAX_NATIVE_BYTES);
    if (native.kind === "absent") {
      diagnostics.push({ severity: "warning", code: "native-missing", message: `${f.repositoryKey}/${f.nativePath} does not exist (renamed or deleted?); the explanation is an orphan.` });
      return done({ doc, diagnostics, nativeFile }, true);
    }
    if (native.kind === "error") {
      diagnostics.push({ severity: "error", code: "native-unreadable", message: `Cannot read ${f.repositoryKey}/${f.nativePath}: ${native.message}.` });
      return done({ doc, diagnostics, nativeFile });
    }
    const text = normaliseNativeText(native.bytes);
    const currentSha256 = createHash("sha256").update(text, "utf8").digest("hex");
    const lines = lineCount(text);
    diagnostics.push(...checkAgainstNative(doc, lines));
    const stale = currentSha256 !== doc.target.sha256;
    if (stale) diagnostics.push({ severity: "warning", code: "stale", message: `${f.nativePath} changed since this explanation was written; steps may point at the wrong lines until the AI updates it.` });
    return done({ doc, diagnostics, nativeFile, currentSha256, lines }, false, stale);
  }
}

/** Index then read every understanding file of a bridge (tests, checks; the session reads on demand). */
export async function loadUnderstanding(bridgeRoot: string, repositories: ReadonlyMap<string, string | undefined>): Promise<{ entries: UnderstandingEntry[]; index: UnderstandingIndex }> {
  const index = await indexUnderstanding(bridgeRoot);
  const entries = await new UnderstandingCatalog(index, repositories).loadAll();
  return { entries, index };
}

/** SHA-256 as `target.sha256` expects it, for a native file's bytes (what the client AI writes). */
export function understandingSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(normaliseNativeText(bytes), "utf8").digest("hex");
}
