import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createExtractorRegistry, type AnalyzerExtraction, type SpiFile } from '@juliandatapass-group/analyzers';
import { createAirflowExtractor } from '@juliandatapass-group/analyzers-airflow';
import { createOrchestrationExtractor } from '@juliandatapass-group/analyzers-orchestration';
import type { PythonFactsProvider } from '@juliandatapass-group/analyzers/python';
import { scheduleFactsOf, type ScheduleFact } from '@juliandatapass-group/analyzers/schedule';
import type { Digest } from '@juliandatapass-group/semantic-core';

/**
 * STDA1a: the standalone hosts the Common orchestration extractors (A5 Airflow, ORC1/ORC2 bundles, ADF/Synapse, Fabric,
 * Step Functions, Argo, GCP Workflows, Dagster, Prefect) through the SPI registry, as DBT3W does for dbt.
 */
export const ORCHESTRATION_LIMITS = Object.freeze({ files: 5000, fileBytes: 2 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, depth: 12 });
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dbt_packages', 'target', 'logs', '.venv', 'venv', '__pycache__', 'dist', 'out', '.datapass']);
const WANTED = /\.(py|json|ya?ml)$/i;

/** The installed CPython-AST facts host. Without it Airflow, Dagster and Prefect files stay `unknown` / `tool-unavailable`. */
export interface PythonFactsHost { readonly provider: PythonFactsProvider; readonly parserLockDigest: Digest }
export interface OrchestrationResult { readonly extraction: AnalyzerExtraction; readonly schedules: readonly ScheduleFact[]; readonly pythonHost: boolean }

const registryFor = (python?: PythonFactsHost) => {
  const options = python ? { python: python.provider, parserLockDigest: python.parserLockDigest } : {};
  return createExtractorRegistry([createAirflowExtractor(options), createOrchestrationExtractor(options)]);
};

/**
 * Runs the orchestration extractors over the files their families claim; every other file is left out. Returns null when no
 * orchestration file is present. Client code is parsed as data only: nothing is imported, run, deployed or sent to a provider.
 */
export async function extractOrchestration(files: readonly SpiFile[], options: { python?: PythonFactsHost; namespace?: string; cancelled?: () => boolean } = {}): Promise<OrchestrationResult | null> {
  const registry = registryFor(options.python);
  const owned = files.filter(f => registry.classify(f));
  if (!owned.length) return null;
  const result = await registry.extract({ namespace: options.namespace ?? 'workspace', files: owned }, { cancelled: options.cancelled });
  if (!result.ok) throw new Error(`orchestration-extraction-failed: ${result.issues.map(e => e.code).join(', ')}`);
  return { extraction: result.value, schedules: scheduleFactsOf(result.value), pythonHost: !!options.python };
}

/**
 * Bounded read of the workspace's Python, JSON and YAML files (the orchestration families' extensions). Links and junctions are
 * skipped, nothing outside `root` is read, and file, size and depth limits apply; the registry then keeps only claimed files.
 */
export async function collectOrchestrationWorkspace(root: string, signal?: AbortSignal): Promise<SpiFile[]> {
  const all: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > ORCHESTRATION_LIMITS.depth || all.length >= ORCHESTRATION_LIMITS.files) return;
    if (signal?.aborted) throw new Error('cancelled');
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = rel ? posix.join(rel, entry.name) : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(child, depth + 1); }
      else if (entry.isFile() && WANTED.test(entry.name) && all.length < ORCHESTRATION_LIMITS.files) all.push(child);
    }
  };
  await walk('', 0);
  const out: SpiFile[] = [];
  let total = 0;
  for (const path of all) {
    if (signal?.aborted) throw new Error('cancelled');
    const full = join(root, path);
    const stat = await lstat(full);
    if (!stat.isFile() || stat.size > ORCHESTRATION_LIMITS.fileBytes || total + stat.size > ORCHESTRATION_LIMITS.totalBytes) continue;
    total += stat.size;
    out.push({ path, text: await readFile(full, 'utf8') });
  }
  return out;
}

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const scheduleText = (s: ScheduleFact): string => {
  const detail = s.kind === 'cron' ? `${s.expression ?? ''} (${s.dialect ?? 'cron'})`
    : s.kind === 'rate' ? (s.intervalMinutes == null ? 'rate' : `every ${s.intervalMinutes} min`)
    : s.kind === 'event' ? `on ${(s.triggeredBy ?? []).length} dataset(s)`
    : s.kind === 'unknown' ? `unknown: ${s.reason ?? ''}` : s.kind;
  return `${s.engine} ${s.name}: ${detail}${s.timezone ? ` ${s.timezone}` : ''}${s.paused ? ' (paused)' : ''}`;
};

/** Panel sections: per-file coverage, jobs, flow links, schedules, then the holes as coverage limits. */
export function orchestrationSections(result: OrchestrationResult): string {
  const { graph, gaps, files } = result.extraction;
  const name = new Map(graph.nodes.map(n => [n.id, n.name]));
  const coverage = files.slice(0, 200).map(f => `<li>${escape(f.path)} — ${escape(f.family ?? 'unclaimed')}: ${escape(f.status)}</li>`).join('');
  const jobs = graph.nodes.filter(n => n.kind === 'job').slice(0, 200).map(n => `<li>${escape(n.name)} (${escape(n.kind)})</li>`).join('');
  const flows = graph.edges.filter(e => e.kind === 'orchestrates').slice(0, 200).map(e => `<li>${escape(name.get(e.fromId) ?? e.fromId)} → ${escape(name.get(e.toId) ?? e.toId)}</li>`).join('');
  const schedules = result.schedules.slice(0, 200).map(s => `<li>${escape(scheduleText(s))}</li>`).join('');
  const holes = gaps.slice(0, 200).map(g => `<li>${escape(g.code)} — ${escape(g.nextAction)} (${escape(g.path)})</li>`).join('');
  return (result.pythonHost ? '' : '<p>The local Python parser is not available: Airflow, Dagster and Prefect files are listed as unknown, never guessed.</p>')
    + `<h2>Coverage</h2><ul>${coverage}</ul><h2>Jobs, pipelines and workflows</h2><ul>${jobs || '<li>No jobs reported.</li>'}</ul>`
    + `<h2>Flow links</h2><ul>${flows || '<li>No flow links reported.</li>'}</ul><h2>Schedules</h2><ul>${schedules || '<li>No schedule declared in these files.</li>'}</ul>`
    + `<h2>Coverage limits</h2><ul>${holes || '<li>No coverage gaps reported. This is not a completeness guarantee.</li>'}</ul><p>Each section displays at most 200 entries.</p>`;
}
