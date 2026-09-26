/**
 * Path policy for files proposed by external AI/apps. Pure functions; the caller supplies
 * realpath so symlink escapes can be checked without this module touching the filesystem.
 */
import * as path from "node:path";

export type PathVerdict =
  | { ok: true; relative: string; risk: "normal" | "high"; riskReason?: string }
  | { ok: false; reason: string };

const HIGH_RISK: Array<{ test: (p: string) => boolean; reason: string }> = [
  { test: p => /^\.vscode\/(tasks|launch|settings|extensions|mcp)\.json$/i.test(p), reason: "VS Code configuration can run tasks, debuggers or MCP servers" },
  { test: p => /(^|\/)\.devcontainer\//i.test(p) || /(^|\/)devcontainer\.json$/i.test(p), reason: "Dev container definitions run lifecycle commands" },
  { test: p => /(^|\/)\.github\/workflows\//i.test(p), reason: "CI workflows execute with repository credentials" },
  { test: p => /(^|\/)package\.json$/i.test(p), reason: "package scripts run on install" },
  { test: p => /(^|\/)(setup\.py|pyproject\.toml|setup\.cfg|requirements[^/]*\.txt|environment\.ya?ml|Makefile|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i.test(p), reason: "build or dependency definition" },
  { test: p => /\.(sh|bash|zsh|ps1|psm1|bat|cmd|exe|dll|so|dylib)$/i.test(p), reason: "executable or shell script" },
  { test: p => /(^|\/)\.env(\..*)?$/i.test(p) || /(^|\/)\.(npmrc|pypirc|netrc)$/i.test(p), reason: "credential-bearing configuration" },
  { test: p => /(^|\/)\.datapass\/project\.json$/i.test(p), reason: "DataPass manifest changes project bindings" },
  { test: p => /(^|\/)(databricks|bundle)\.ya?ml$/i.test(p) || /\.tf$/i.test(p) || /\.bicep$/i.test(p), reason: "deployment/infrastructure definition" }
];

/** Normalize and vet a relative path proposed by untrusted content. */
export function vetRelativePath(input: string): PathVerdict {
  if (typeof input !== "string" || !input.trim()) return { ok: false, reason: "empty path" };
  if (input.includes("\0")) return { ok: false, reason: "NUL byte in path" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    return /^[a-z]:[\\/]/i.test(input) ? { ok: false, reason: "absolute drive path" } : { ok: false, reason: "URI scheme not allowed; remote VFS items need their native handoff" };
  }
  if (input.startsWith("/") || input.startsWith("\\") || input.startsWith("~")) return { ok: false, reason: "absolute or home-relative path" };
  const segments = input.replace(/\\/g, "/").split("/");
  if (segments.some(s => s === "..")) return { ok: false, reason: "parent traversal" };
  const clean = segments.filter(s => s !== "" && s !== ".");
  if (!clean.length) return { ok: false, reason: "empty path" };
  if (clean.some(s => /[<>:"|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s))) return { ok: false, reason: "segment not portable across Windows/POSIX" };
  if (clean[0]!.toLowerCase() === ".git") return { ok: false, reason: "Git internals are never written" };
  const relative = clean.join("/");
  const risky = HIGH_RISK.find(r => r.test(relative));
  return risky ? { ok: true, relative, risk: "high", riskReason: risky.reason } : { ok: true, relative, risk: "normal" };
}

/**
 * Resolve under an allowed root and reject symlink escapes. `realpath` must resolve the
 * nearest existing ancestor (the target file itself may not exist yet).
 */
export async function resolveWithinRoot(
  root: string,
  relative: string,
  realpath: (p: string) => Promise<string | undefined>
): Promise<{ ok: true; absolute: string } | { ok: false; reason: string }> {
  const vetted = vetRelativePath(relative);
  if (!vetted.ok) return vetted;
  const rootReal = await realpath(root);
  if (!rootReal) return { ok: false, reason: "root does not exist" };
  const target = path.resolve(root, vetted.relative);
  if (!isInside(path.resolve(root), target)) return { ok: false, reason: "outside root" };
  let probe = target;
  for (;;) {
    const real = await realpath(probe);
    if (real !== undefined) {
      if (!isInside(rootReal, real)) return { ok: false, reason: "symlink escapes root" };
      break;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return { ok: false, reason: "no existing ancestor" };
    probe = parent;
  }
  return { ok: true, absolute: target };
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
