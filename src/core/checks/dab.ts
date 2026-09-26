/**
 * Databricks Asset Bundle checks on `databricks.yml` and the files it includes, read only:
 * `bundle.name`, targets, `include` globs that match files, local paths the resources point to
 * (`notebook_path`, `python_file`, `whl`, pipeline `notebook`/`file` paths) and `${var.x}`
 * references to declared variables. These are the mistakes `databricks bundle validate` would
 * report without needing a workspace; DataPass offers that command, never runs it.
 */
import { globToRegExp, hasGlob, listFiles } from "./glob";
import { parseYaml } from "./syntax";
import { at, isMap, isSeq, keyOf, pairOf, pairs, str, strings, valueOf } from "./yamlNodes";
import { baseOf, dirOf, finding, joinRel, type Budget, type CheckFs, type Finding } from "./types";

export const isBundleRoot = (rel: string) => /^databricks\.ya?ml$/i.test(baseOf(rel));

const PATH_KEYS = new Set(["notebook_path", "python_file", "whl"]);
const NOTEBOOK_EXTS = ["", ".py", ".ipynb", ".sql", ".scala", ".r", ".R"];
const MAX_INCLUDED = 200;
const TARGET_MODES = new Set(["development", "production"]);

/** Files matching a glob (relative to `base`), walking only below the pattern's literal prefix. */
export async function expandGlob(fs: CheckFs, base: string, pattern: string, budget: Budget): Promise<{ files: string[]; truncated: boolean }> {
  const full = joinRel(base, pattern);
  if (full === undefined) return { files: [], truncated: false };
  const segs = full.split("/");
  const firstGlob = segs.findIndex(hasGlob);
  if (firstGlob < 0) return { files: (await fs.stat(full))?.type === "file" ? [full] : [], truncated: false };
  const prefix = segs.slice(0, firstGlob).join("/");
  const re = globToRegExp(full);
  const { files, truncated } = await listFiles(fs, prefix, budget);
  return { files: files.filter(f => re.test(f)), truncated };
}

export async function checkBundle(fs: CheckFs, root: string, budget: Budget): Promise<Finding[]> {
  const text = await readBounded(fs, root, budget);
  if (text === undefined) return [];
  const parsed = parseYaml(root, text);
  if (!parsed.doc) return []; // syntax errors are the file check's (yaml.syntax)
  const out: Finding[] = [];
  const add = (f: Finding) => out.push({ ...f, bundle: root });
  const top = parsed.doc.contents;
  const bundleDir = dirOf(root);
  const lines = parsed.lines;

  // bundle.name
  const bundle = pairOf(top, "bundle");
  const name = str(valueOf(bundle?.value, "name"));
  if (!isMap(top)) { add(finding(root, "dab.bundle-name", "error", "databricks.yml is not a mapping: a bundle needs at least `bundle: { name: … }`.")); return out; }
  if (!name?.trim()) add(finding(root, "dab.bundle-name", "error", "`bundle.name` is missing: every bundle needs a name.", at(bundle?.key ?? top, lines)));

  // targets
  const targets = pairOf(top, "targets");
  if (!targets) add(finding(root, "dab.targets", "info", "No `targets`: deployments go to a single implicit target. Declare `dev`/`prod` targets to choose explicitly.", at(bundle?.key ?? top, lines)));
  else if (!isMap(targets.value) || targets.value.items.length === 0) add(finding(root, "dab.targets", "error", "`targets` must map target names to their settings.", at(targets.key, lines)));
  else {
    const defaults = targets.value.items.filter(t => valueOf(t.value, "default") !== undefined && (valueOf(t.value, "default") as { value?: unknown })?.value === true);
    if (defaults.length > 1) add(finding(root, "dab.targets", "error", `${defaults.length} targets are marked \`default: true\` (${defaults.map(keyOf).join(", ")}); at most one can be.`, at(targets.key, lines)));
    for (const t of targets.value.items) {
      const mode = pairOf(t.value, "mode");
      const m = str(mode?.value);
      if (mode && (!m || !TARGET_MODES.has(m))) add(finding(root, "dab.targets", "error", `Target \`${keyOf(t)}\`: \`mode\` must be \`development\` or \`production\`.`, at(mode.value, lines)));
    }
  }

  // include
  const files: Array<{ rel: string; doc: unknown; lines: typeof lines }> = [{ rel: root, doc: top, lines }];
  const include = pairOf(top, "include");
  if (include && !isSeq(include.value)) add(finding(root, "dab.include", "error", "`include` must be a list of paths or globs.", at(include.key, lines)));
  else if (include && isSeq(include.value)) {
    const seen = new Set<string>([root]);
    for (const item of include.value.items) {
      const pattern = str(item);
      if (!pattern) { add(finding(root, "dab.include", "error", "`include` entries must be strings.", at(item, lines))); continue; }
      if (pattern.includes("${")) continue;
      const { files: matched, truncated } = await expandGlob(fs, bundleDir, pattern, budget);
      if (!matched.length) {
        add(finding(root, "dab.include", truncated ? "warning" : "error", truncated
          ? `\`${pattern}\` matched no file before the check's file budget ran out; it may still match.`
          : `\`${pattern}\` matches no file: \`databricks bundle validate\` fails on an include that matches nothing.`, at(item, lines)));
        continue;
      }
      for (const f of matched) {
        if (seen.has(f) || !/\.ya?ml$/i.test(f) || files.length > MAX_INCLUDED) continue;
        seen.add(f);
        const t = await readBounded(fs, f, budget);
        const p = t === undefined ? undefined : parseYaml(f, t);
        if (p?.doc) files.push({ rel: f, doc: p.doc.contents, lines: p.lines });
      }
    }
  }

  // variables declared anywhere in the bundle, and the ones used
  const declared = new Set<string>();
  const builtArtifacts = files.some(f => pairOf(f.doc, "artifacts"));
  for (const f of files) {
    const vars = valueOf(f.doc, "variables");
    if (isMap(vars)) for (const p of vars.items) { const k = keyOf(p); if (k) declared.add(k); }
  }
  for (const f of files) {
    for (const s of strings(f.doc)) {
      for (const m of s.value.matchAll(/\$\{var\.([A-Za-z0-9_-]+)/g)) {
        if (!declared.has(m[1]!)) add(finding(f.rel, "dab.var", "error", `\`\${var.${m[1]}}\` is used but no variable \`${m[1]}\` is declared under \`variables\`.`, at(s.node, f.lines)));
      }
    }
    // local paths the resources point to
    const jobs = valueOf(valueOf(f.doc, "resources"), "jobs");
    const gitJobs = new Set<string>();
    if (isMap(jobs)) for (const j of jobs.items) if (pairOf(j.value, "git_source")) gitJobs.add(keyOf(j) ?? "");
    const fileDir = dirOf(f.rel);
    for (const { pair, path } of pairs(f.doc)) {
      const key = keyOf(pair);
      if (!key) continue;
      const isPath = PATH_KEYS.has(key) || (key === "path" && (path[path.length - 1] === "notebook" || path[path.length - 1] === "file") && path.includes("libraries"));
      if (!isPath) continue;
      if (path[0] === "resources" && path[1] === "jobs" && gitJobs.has(path[2] ?? "")) continue; // relative to the Git source, not the bundle
      const value = str(pair.value);
      if (!value || value.includes("${")) continue;
      if (key === "whl" && builtArtifacts) continue; // built by `artifacts` at deploy time
      const rel = joinRel(fileDir, value);
      if (rel === undefined) continue; // workspace path, volume, URL: not a local file
      if (await localPathExists(fs, fileDir, value, rel, key === "notebook_path" || path[path.length - 1] === "notebook", budget)) continue;
      add(finding(f.rel, "dab.path", "error", `\`${key}: ${value}\` points to \`${rel}\`, which does not exist in the bundle.`, at(pair.value, f.lines)));
    }
  }
  return out;
}

async function localPathExists(fs: CheckFs, dir: string, value: string, rel: string, notebook: boolean, budget: Budget): Promise<boolean> {
  if (hasGlob(value)) return (await expandGlob(fs, dir, value, budget)).files.length > 0;
  for (const ext of notebook ? NOTEBOOK_EXTS : [""]) if (await fs.stat(rel + ext)) return true;
  return false;
}

export async function readBounded(fs: CheckFs, rel: string, budget: Budget): Promise<string | undefined> {
  const s = await fs.stat(rel);
  if (!s || s.type !== "file" || s.size > budget.maxFileBytes) return undefined;
  return fs.readText(rel);
}
