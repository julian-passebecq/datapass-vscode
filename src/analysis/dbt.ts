import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createExtractorRegistry, type AnalyzerExtraction, type SpiFile } from '@juliandatapass-group/analyzers';
import { createDbtExtractor, readDbtTargets, type DbtTarget } from '@juliandatapass-group/analyzers-dbt';

/** DBT3W: the standalone is the host that runs Common analyzers, so it passes the dbt targets (DBT3) to the extractor. */
export const DBT_LIMITS = Object.freeze({ files: 5000, fileBytes: 4 * 1024 * 1024, depth: 12 });
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dbt_packages', 'logs', '.venv', 'venv', '__pycache__']);
const PROFILES = /(^|\/)profiles\.ya?ml$/;
const PROJECT = /(^|\/)dbt_project\.ya?ml$/;
const WANTED = /\.(ya?ml|sql|csv|json)$/i;

/**
 * dbt targets by profile name from the workspace's `profiles.yml` files. `readDbtTargets` keeps names only
 * (adapter, database, schema, target name): hosts, tokens and every other output key never leave this function.
 */
export function dbtTargets(files: readonly SpiFile[]): Readonly<Record<string, DbtTarget>> {
  const targets: Record<string, DbtTarget> = {};
  for (const file of files.filter(f => PROFILES.test(f.path)).sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1))) {
    for (const [profile, target] of Object.entries(readDbtTargets(file.text))) targets[profile] ??= target;
  }
  return Object.freeze(targets);
}

/**
 * Runs the dbt extractor over the dbt-family files. `profiles.yml` is read for targets only and is not passed on (CFG1 owns it).
 * Returns null when no dbt project is present. No target for a project → the extractor's `dbt.no-target` hole.
 */
export async function extractDbt(files: readonly SpiFile[], options: { namespace?: string; cancelled?: () => boolean } = {}): Promise<{ extraction: AnalyzerExtraction; targets: readonly string[] } | null> {
  const targets = dbtTargets(files);
  const registry = createExtractorRegistry([createDbtExtractor({ targets })]);
  const owned = files.filter(f => !PROFILES.test(f.path) && registry.classify(f));
  if (!owned.some(f => PROJECT.test(f.path))) return null;
  const result = await registry.extract({ namespace: options.namespace ?? 'workspace', files: owned }, { cancelled: options.cancelled });
  if (!result.ok) throw new Error(`dbt-extraction-failed: ${result.issues.map(e => e.code).join(', ')}`);
  return { extraction: result.value, targets: Object.keys(targets).sort() };
}

/**
 * Bounded read of the dbt projects under `root`: every folder holding a `dbt_project.yml`, its YAML/SQL/CSV/JSON files and its
 * `profiles.yml`. Links and junctions are skipped, dbt is never run, and nothing outside `root` is read (not `~/.dbt`).
 */
export async function collectDbtWorkspace(root: string, signal?: AbortSignal): Promise<SpiFile[]> {
  const all: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > DBT_LIMITS.depth || all.length >= DBT_LIMITS.files) return;
    if (signal?.aborted) throw new Error('cancelled');
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = rel ? posix.join(rel, entry.name) : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(child, depth + 1); }
      else if (entry.isFile() && WANTED.test(entry.name) && all.length < DBT_LIMITS.files) all.push(child);
    }
  };
  await walk('', 0);
  const projects = all.filter(p => PROJECT.test(p)).map(p => posix.dirname(p));
  const inProject = (p: string) => projects.some(dir => dir === '.' || p.startsWith(`${dir}/`));
  const out: SpiFile[] = [];
  for (const path of all.filter(inProject)) {
    const full = join(root, path);
    const stat = await lstat(full);
    if (!stat.isFile() || stat.size > DBT_LIMITS.fileBytes) continue;
    out.push({ path, text: await readFile(full, 'utf8') });
  }
  return out;
}

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Panel sections: relations and their reads/writes, then the holes (`dbt.no-target` included) as coverage limits. */
export function dbtSections(result: { extraction: AnalyzerExtraction; targets: readonly string[] }): string {
  const { graph, gaps } = result.extraction;
  const name = new Map(graph.nodes.map(n => [n.id, n.name]));
  const holes = gaps.slice(0, 200).map(g => `<li>${escape(g.code)} — ${escape(g.nextAction)} (${escape(g.path)})</li>`).join('');
  const datasets = graph.nodes.filter(n => n.kind === 'dataset').slice(0, 200).map(n => `<li>${escape(n.name)}</li>`).join('');
  const edges = graph.edges.filter(e => e.kind === 'reads' || e.kind === 'writes').slice(0, 200).map(e => `<li>${escape(name.get(e.fromId) ?? e.fromId)} → ${escape(name.get(e.toId) ?? e.toId)} — ${escape(e.kind)}</li>`).join('');
  return `<h2>dbt targets</h2><p>${result.targets.length ? escape(result.targets.join(', ')) : 'No profiles.yml target in this workspace: relations stay logical.'}</p>`
    + `<h2>Coverage limits</h2><ul>${holes || '<li>No coverage gaps reported. This is not a completeness guarantee.</li>'}</ul>`
    + `<h2>Relations</h2><ul>${datasets || '<li>No relations reported.</li>'}</ul><h2>Lineage links</h2><ul>${edges || '<li>No lineage links reported.</li>'}</ul><p>Each section displays at most 200 entries.</p>`;
}
