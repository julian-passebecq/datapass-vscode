/**
 * Copy the public DataPass contracts into a checkout of datapass-vscode-common (HUB-1,
 * handoff/v3/12 §8). Explicit allowlist; everything else is refused. Idempotent: a file is
 * written only when its content differs, and managed folders lose files no longer in the source.
 * Text is written with LF line endings and compared without regard to CRLF/LF, so a Windows
 * checkout (core.autocrlf) of either repository does not make every file look stale.
 *
 *   npx tsx scripts/sync-common.ts --target <path to datapass-vscode-common> [--check]
 *
 * --check writes nothing and exits 1 when the target is out of date.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

export interface SyncEntry { source: string; target: string }
export interface SyncResult { written: string[]; removed: string[]; refused: { path: string; reason: string }[] }

/** Folders of the common repository that this script owns entirely. */
export const MANAGED_DIRS = ["schemas", "examples", "knowledge/toolkit"];

const ALLOW: { from: string; to: string; match: RegExp }[] = [
  { from: "schemas", to: "schemas", match: /^[a-z0-9-]+\.schema\.json$/ },
  { from: "schemas/contracts", to: "schemas/contracts", match: /^[a-z0-9-]+\.schema\.json$/ },
  { from: "examples/v3", to: "examples", match: /./ },
  { from: "resources/toolkit", to: "knowledge/toolkit", match: /\.json$/ },
];

/** Dot-files and dot-folders allowed inside examples (DataPass or native provider files). */
const ALLOWED_DOT = /^(\.datapass|\.platform|\.vscode\/extensions\.json|\.github\/workflows)(\/|$)/;
const SECRET = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(AccountKey|SharedAccessSignature|client_secret|password)["']?\s*[=:]\s*["']?[^\s"'<>{}]{6,}/i,
  /\bsig=[A-Za-z0-9%]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
/** FOIL-specific identifiers (repository names, packages, paths). A generic mention of the word is not refused. */
const FOIL = /\bfoil[-_/]|julian-passebecq\/foil/i;

export function refusal(relPath: string, content: string): string | null {
  const p = relPath.split(sep).join("/");
  if (p.startsWith("handoff/") || p.includes("/handoff/")) return "handoff/ is never public";
  if (/foil/i.test(p)) return "FOIL path";
  const segments = p.split("/");
  const dotIndex = segments.findIndex((s) => s.startsWith("."));
  if (dotIndex >= 0 && !ALLOWED_DOT.test(segments.slice(dotIndex).join("/"))) return "dot-file outside the allowlist";
  if (/(^|\/)\.datapass\/local(\/|$)/.test(p)) return "dot-file: .datapass/local/ is machine-only";
  if (/(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i.test(p)) return "secret-bearing file type";
  if (SECRET.some((r) => r.test(content))) return "credential-shaped content";
  if (FOIL.test(content)) return "FOIL-specific content";
  return null;
}

function walk(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split(sep).join("/"));
  }
}

export function plan(sourceRoot: string): { entries: SyncEntry[]; refused: SyncResult["refused"] } {
  const entries: SyncEntry[] = [];
  const refused: SyncResult["refused"] = [];
  for (const rule of ALLOW) {
    const base = join(sourceRoot, rule.from);
    if (!existsSync(base)) continue;
    const files: string[] = [];
    if (rule.from === "schemas") files.push(...readdirSync(base).filter((f) => statSync(join(base, f)).isFile()));
    else walk(base, base, files);
    for (const f of files) {
      const source = posix.join(rule.from, f);
      if (!rule.match.test(posix.basename(f))) continue;
      const why = refusal(source, readFileSync(join(sourceRoot, source), "utf8"));
      if (why) refused.push({ path: source, reason: why });
      else entries.push({ source, target: posix.join(rule.to, f) });
    }
  }
  return { entries, refused };
}

/** Text with LF line endings; binary content (a NUL byte) unchanged. */
export const lf = (b: Buffer): Buffer => (b.includes(0) ? b : Buffer.from(b.toString("utf8").replace(/\r\n/g, "\n"), "utf8"));

export function syncCommon(sourceRoot: string, targetRoot: string, check = false): SyncResult {
  const { entries, refused } = plan(sourceRoot);
  const written: string[] = [];
  const removed: string[] = [];
  const version = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")).version as string;
  const outputs = new Map<string, Buffer>(entries.map((e) => [e.target, lf(readFileSync(join(sourceRoot, e.source)))]));
  outputs.set("VERSION", Buffer.from(`${version}\n`));
  for (const [target, data] of outputs) {
    const full = join(targetRoot, target);
    if (existsSync(full) && lf(readFileSync(full)).equals(data)) continue;
    written.push(target);
    if (!check) { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, data); }
  }
  for (const dir of MANAGED_DIRS) {
    const base = join(targetRoot, dir);
    if (!existsSync(base)) continue;
    const present: string[] = [];
    walk(targetRoot, base, present);
    for (const p of present) {
      if (outputs.has(p)) continue;
      removed.push(p);
      if (!check) rmSync(join(targetRoot, p));
    }
  }
  return { written, removed, refused };
}

if (process.argv[1] && /sync-common\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const target = args[args.indexOf("--target") + 1];
  if (!args.includes("--target") || !target) { console.error("usage: sync-common.ts --target <common checkout> [--check]"); process.exit(64); }
  const check = args.includes("--check");
  const r = syncCommon(process.cwd(), target, check);
  for (const w of r.written) console.log(`${check ? "stale" : "wrote"} ${w}`);
  for (const d of r.removed) console.log(`${check ? "extra" : "removed"} ${d}`);
  for (const x of r.refused) console.log(`refused ${x.path}: ${x.reason}`);
  console.log(`${r.written.length} written, ${r.removed.length} removed, ${r.refused.length} refused`);
  if (check && (r.written.length || r.removed.length)) process.exit(1);
}
