/**
 * 0.22 format checks (package D): shared types. The checks read files through `CheckFs` and
 * never run anything: no child process, no project code, no network. They work the same in a
 * trusted and an untrusted workspace because reading is all they do.
 */

/** Rule ids: stable, shown as the diagnostic code in Problems and in the guide. */
export type RuleId =
  | "json.syntax" | "yaml.syntax"
  | "dab.bundle-name" | "dab.targets" | "dab.include" | "dab.path" | "dab.var"
  | "docker.from" | "docker.copy-source"
  | "compose.build-context" | "compose.env-file"
  | "checks.incomplete";

export type Severity = "error" | "warning" | "info";

/** One problem in one file. Positions are 0-based (VS Code's convention). */
export interface Finding {
  /** Workspace-relative path with "/" separators; "" is the folder itself (scan-level notes). */
  file: string;
  rule: RuleId;
  severity: Severity;
  message: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** For dab.* findings: the bundle's root file (databricks.yml), for the validate route. */
  bundle?: string;
}

export interface Entry { name: string; type: "file" | "dir" }

/** Read-only view of one workspace folder. Paths are relative, "/"-separated, "" is the root. */
export interface CheckFs {
  stat(rel: string): Promise<{ type: "file" | "dir"; size: number } | undefined>;
  list(rel: string): Promise<Entry[] | undefined>;
  readText(rel: string): Promise<string | undefined>;
}

export interface Budget {
  /** Files looked at by a repository scan (and by a bundle's include expansion). */
  maxFiles: number;
  /** Larger files are skipped, never read. */
  maxFileBytes: number;
  /** Directory depth below the folder. */
  maxDepth: number;
}

export const DEFAULT_BUDGET: Budget = { maxFiles: 2000, maxFileBytes: 1024 * 1024, maxDepth: 12 };

/** Directories a scan never enters: tool caches, dependencies, build output, Git internals. */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  ".git", "node_modules", ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox",
  "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".databricks", ".terraform", ".vscode-test", ".idea", ".gradle"
]);

export function finding(file: string, rule: RuleId, severity: Severity, message: string, at?: { line: number; col: number; endLine?: number; endCol?: number }): Finding {
  const line = at?.line ?? 0, col = at?.col ?? 0;
  return { file, rule, severity, message, line, col, endLine: at?.endLine ?? line, endCol: at?.endCol ?? (at ? col + 1 : 0) };
}

export const dirOf = (rel: string) => { const i = rel.lastIndexOf("/"); return i < 0 ? "" : rel.slice(0, i); };
export const baseOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

/**
 * Join a relative path onto a directory and normalise "." and "..". Returns undefined when the
 * result would leave the folder, is absolute, or names a scheme (dbfs:/, s3://, C:\…): those
 * cannot be checked from the workspace.
 */
export function joinRel(dir: string, p: string): string | undefined {
  const raw = p.replace(/\\/g, "/").trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("~") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return undefined;
  const out = dir ? dir.split("/") : [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!out.length) return undefined; out.pop(); } else out.push(seg);
  }
  return out.join("/");
}
