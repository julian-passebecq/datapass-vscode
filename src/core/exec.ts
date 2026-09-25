/**
 * Resolve command-line tools to absolute paths from absolute PATH entries only. Pure apart from
 * the injected `isFile`.
 *
 * Why: on Windows, Node's execFile (libuv) looks for a bare command such as `git` in the child's
 * working directory before PATH. `execFile("git", args, { cwd: repo })` would therefore run a
 * `git.exe` shipped inside an opened folder or a declared repository. On POSIX an empty or `.`
 * PATH entry has the same effect. DataPass resolves each tool once, from absolute PATH
 * directories, and always runs it by absolute path.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type IsFile = (p: string) => boolean;

const defaultIsFile: IsFile = p => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

const posixIsExecutable: IsFile = p => {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
};

/** PATH entries that are absolute directories; relative, empty and `.` entries are dropped. */
export function absolutePathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const win = platform === "win32";
  const raw = (win ? env.PATH ?? env.Path ?? "" : env.PATH ?? "").split(win ? ";" : ":");
  const out: string[] = [];
  for (const entry of raw) {
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    if (win ? !path.win32.isAbsolute(dir) || /^[\\/](?![\\/])/.test(dir) : !path.posix.isAbsolute(dir)) continue;
    out.push(dir);
  }
  return out;
}

/**
 * Absolute path of an executable (`.exe`/`.com` on Windows: these run without cmd.exe), or
 * undefined. Names containing a path separator are refused: callers pass bare tool names.
 */
export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, isFile?: IsFile): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(command)) return undefined;
  const win = platform === "win32";
  const check = isFile ?? (win ? defaultIsFile : posixIsExecutable);
  const exts = win ? (path.win32.extname(command) ? [""] : [".exe", ".com"]) : [""];
  for (const dir of absolutePathEntries(env, platform)) {
    for (const ext of exts) {
      const candidate = win ? path.win32.join(dir, command + ext) : path.posix.join(dir, command + ext);
      if (win && !/\.(exe|com)$/i.test(candidate)) continue;
      if (check(candidate)) return candidate;
    }
  }
  return undefined;
}

const cache = new Map<string, string | null>();

/** Cached resolution for the running process (PATH does not change under a running extension host). */
export function executablePath(command: string): string | undefined {
  if (!cache.has(command)) cache.set(command, resolveExecutable(command) ?? null);
  return cache.get(command) ?? undefined;
}
