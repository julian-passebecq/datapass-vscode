/**
 * 0.22 format checks (package D): which rules apply to a file, a single-file check, a bounded
 * repository scan and the store that merges findings from several origins (a file's own check
 * and the bundle check that covers it). Pure over `CheckFs`: no `vscode`, no process, no network.
 */
import { checkBundle, isBundleRoot, readBounded } from "./dab";
import { checkCompose, checkDockerfile, isCompose, isDockerfile } from "./docker";
import { listFiles } from "./glob";
import { checkJsonSyntax, checkYamlSyntax } from "./syntax";
import { baseOf, dirOf, finding, type Budget, type CheckFs, type Finding } from "./types";

export * from "./types";
export { checkBundle, isBundleRoot } from "./dab";

export type Kind = "json" | "yaml" | "dab" | "compose" | "dockerfile";

/** Files whose JSON allows comments (VS Code's own, TypeScript's…): never checked as strict JSON. */
const JSONC = /^(tsconfig.*|jsconfig.*|devcontainer|\.devcontainer|\.eslintrc|\.babelrc|argv|language-configuration|settings|launch|tasks|extensions|keybindings)\.json$/i;

export function kindOf(rel: string): Kind | undefined {
  const r = rel.replace(/\\/g, "/");
  if (r === ".datapass" || r.startsWith(".datapass/")) return undefined; // validated by DataPass's own schemas
  const base = baseOf(r);
  if (isBundleRoot(r)) return "dab";
  if (isCompose(r)) return "compose";
  if (isDockerfile(r)) return "dockerfile";
  if (/\.ya?ml$/i.test(base)) return "yaml";
  if (/\.json$/i.test(base) && !JSONC.test(base) && !/(^|\/)\.(vscode|devcontainer)\//.test(r)) return "json";
  return undefined;
}

/** The file's own findings (syntax, Dockerfile, compose). Bundle rules come from `checkBundle`. */
export async function checkFile(fs: CheckFs, rel: string, budget: Budget): Promise<Finding[] | undefined> {
  const kind = kindOf(rel);
  if (!kind) return undefined;
  const text = await readBounded(fs, rel, budget);
  if (text === undefined) return undefined;
  switch (kind) {
    case "json": return checkJsonSyntax(rel, text);
    case "yaml": case "dab": return checkYamlSyntax(rel, text);
    case "compose": { const syntax = checkYamlSyntax(rel, text); return syntax.length ? syntax : checkCompose(fs, rel, text); }
    case "dockerfile": return checkDockerfile(fs, rel, text, budget);
  }
}

/** The databricks.yml nearest above a file (the bundle it may belong to). */
export async function bundleRootFor(fs: CheckFs, rel: string): Promise<string | undefined> {
  if (isBundleRoot(rel)) return rel;
  for (let dir = dirOf(rel); ; dir = dirOf(dir)) {
    for (const name of ["databricks.yml", "databricks.yaml"]) {
      const p = dir ? `${dir}/${name}` : name;
      if ((await fs.stat(p))?.type === "file") return p;
    }
    if (!dir) return undefined;
  }
}

export const fileOrigin = (rel: string) => `file:${rel}`;
export const bundleOrigin = (rel: string) => `bundle:${rel}`;
export const SCAN_ORIGIN = "scan:";

export interface ScanResult { origins: Map<string, Finding[]>; checked: number; incomplete: boolean }

/** Every checkable file of a folder, within the budget; an "incomplete" note when it stops early. */
export async function scanRepository(fs: CheckFs, budget: Budget): Promise<ScanResult> {
  const { files, truncated } = await listFiles(fs, "", budget);
  const origins = new Map<string, Finding[]>();
  let checked = 0;
  for (const rel of files) {
    const found = await checkFile(fs, rel, budget);
    if (!found) continue;
    checked++;
    origins.set(fileOrigin(rel), found);
    if (isBundleRoot(rel)) origins.set(bundleOrigin(rel), await checkBundle(fs, rel, budget));
  }
  origins.set(SCAN_ORIGIN, truncated ? [finding("", "checks.incomplete", "warning",
    `Check incomplete: the scan stopped after ${budget.maxFiles} files (setting datapass.checks.maxFiles); files beyond it were not checked.`)] : []);
  return { origins, checked, incomplete: truncated };
}

/** Findings by origin; a file shows the union of every origin's findings for it. */
export class FindingStore {
  private readonly origins = new Map<string, Finding[]>();

  /** Replace an origin's findings; returns every file whose findings may have changed. */
  set(origin: string, findings: Finding[]): Set<string> {
    const touched = new Set<string>((this.origins.get(origin) ?? []).map(f => f.file));
    for (const f of findings) touched.add(f.file);
    if (findings.length) this.origins.set(origin, findings); else this.origins.delete(origin);
    return touched;
  }

  /** Forget a deleted file: its own origin and everything reported on it. */
  drop(rel: string): Set<string> {
    const touched = this.set(fileOrigin(rel), []);
    for (const f of this.set(bundleOrigin(rel), [])) touched.add(f);
    touched.add(rel);
    return touched;
  }

  forFile(rel: string): Finding[] {
    const out: Finding[] = [];
    for (const list of this.origins.values()) for (const f of list) if (f.file === rel) out.push(f);
    return out;
  }

  files(): Set<string> {
    const out = new Set<string>();
    for (const list of this.origins.values()) for (const f of list) out.add(f.file);
    return out;
  }

  clear(): Set<string> { const all = this.files(); this.origins.clear(); return all; }
}
