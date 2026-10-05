import { lstat, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createAnalyzerDispatcher, createExtractorRegistry, type SpiFile, type SpiDispatcher } from '@juliandatapass-group/analyzers';
import { createSqlExtractor } from '@juliandatapass-group/analyzers/sql';
import { createPythonAnalyzerPlugin, createPySparkExtractor } from '@juliandatapass-group/analyzers/python';
import { createNotebookExtractor } from '@juliandatapass-group/analyzers/notebook';
import { createDbtExtractor } from '@juliandatapass-group/analyzers-dbt';
import { createAirflowExtractor } from '@juliandatapass-group/analyzers-airflow';
import { createOrchestrationExtractor } from '@juliandatapass-group/analyzers-orchestration';
import { createApiExtractor } from '@juliandatapass-group/analyzers-api';
import { validatePythonSyntaxFacts } from '@juliandatapass-group/analyzers/python';
import { selectedCapture, selectedRequest, sessionIdentity } from './capture';
import { createProjectPowerbiExtractor } from './projectPowerbi';
import { acquireSnapshots, createWindowsPathInspector } from '@juliandatapass-group/analysis-host-node';
import { buildLineageGraph, type LineageNodeInput, type LineageEdgeInput } from '@juliandatapass-group/lineage-core';
import { digestJson, digestExactBytes, unwrap } from '@juliandatapass-group/semantic-core';
import { dbtTargets } from './dbt';
import type { NativeAnalysisBackend } from './native';
import type { CoverageFile, ProjectIntelligence } from '../core/project/intelligence';

export const PROJECT_ANALYSIS_LIMITS = { files: 5000, depth: 12, fileBytes: 2 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 } as const;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.datapass', '.venv', 'venv', '__pycache__', 'dist', 'out', 'dbt_packages', '.vscode-test']);
const RELEVANT = /\.(sql|py|ipynb|json|ya?ml|tf|tofu|tfvars|bicep|tmdl|pbip|pbir|bim|m|pq|dax|graphql|gql|xml|csv|scala|r|java|kt|ts|js|toml|cfg|ini|sh|ps1|dockerfile)$/i;
const SECRET = /^(?:\.env(?:\..*)?|local\.settings\.json|credentials(?:\..*)?|secrets(?:\..*)?)$/i;
/** Metadata/dependency churn is outside the captured source set. Directory events still invalidate it. */
export const isProjectAnalysisChange = (relativePath: string): boolean => !relativePath.split(/[\\/]/).some(segment => SKIP_DIRS.has(segment.toLowerCase()));
export interface ProjectSources { files: SpiFile[]; skipped: CoverageFile[]; limits: string[] }
const analysisNamespace = (project: string, repo?: string) => `p-${unwrap(digestJson({ project, repo: repo ?? null })).value.slice(0, 40)}`;

/** Explicit, local, bounded discovery. Links/junctions and credential files are never read. */
export async function collectProjectSources(root: string, repo: string, signal?: AbortSignal, maxFiles: number = PROJECT_ANALYSIS_LIMITS.files): Promise<ProjectSources> {
  const result: ProjectSources = { files: [], skipped: [], limits: [] };
  let total = 0, discovered = 0, directories = 0;
  const nativePathInspector = process.platform === 'win32' ? createWindowsPathInspector(process.env.SystemRoot ?? '') : undefined;
  await acquireSnapshots({ root, nativePathInspector }, [], signal);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Analysis root must be a local directory, not a link.');
  const limit = (reason: string) => { if (!result.limits.includes(reason)) result.limits.push(reason); };
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (signal?.aborted) throw new Error('cancelled');
    if (++directories > PROJECT_ANALYSIS_LIMITS.files) { limit(`${repo}: directory limit; remaining subtrees not enumerated.`); return; }
    if (depth > PROJECT_ANALYSIS_LIMITS.depth) { limit(`${repo}/${rel}: discovery depth limit; subtree not enumerated.`); return; }
    let entries;
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); }
    catch { limit(`${repo}/${rel || '.'}: directory unreadable; subtree not enumerated.`); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (signal?.aborted) throw new Error('cancelled');
      if (discovered >= maxFiles) { limit(`${repo}: discovery file limit; remaining paths not enumerated.`); return; }
      const path = rel ? posix.join(rel, entry.name) : entry.name;
      if (entry.isSymbolicLink()) { limit(`${repo}/${path}: link or junction ignored; target not enumerated.`); continue; }
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name.toLowerCase())) await walk(path, depth + 1); else limit(`${repo}/${path}: generated, dependency or local metadata directory excluded.`); continue; }
      if (!entry.isFile() || (!RELEVANT.test(path) && !/^(Dockerfile|Containerfile)$/i.test(entry.name) && !SECRET.test(entry.name))) continue;
      discovered++;
      const skip = (status: CoverageFile['status'], reason: string) => result.skipped.push({ repo, path, family: 'unclassified', status, reasons: [reason] });
      if (SECRET.test(entry.name)) { skip('IGNORED', 'credential/config values deliberately excluded'); continue; }
      try {
        const stat = await lstat(join(root, path));
        if (!stat.isFile() || stat.isSymbolicLink()) { skip('IGNORED', 'link or non-file'); continue; }
        if (stat.size > PROJECT_ANALYSIS_LIMITS.fileBytes || total + stat.size > PROJECT_ANALYSIS_LIMITS.totalBytes) { skip('UNKNOWN', 'analysis byte limit'); continue; }
        const [capture] = await acquireSnapshots({ root, nativePathInspector, maxFileBytes: PROJECT_ANALYSIS_LIMITS.fileBytes }, [path], signal);
        const bytes = capture!.bytes;
        total += bytes.length;
        result.files.push({ path, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) });
      } catch { if (signal?.aborted) throw new Error('cancelled'); skip('UNKNOWN', 'source unreadable or acquisition checks failed'); }
    }
  };
  await walk('', 0);
  return result;
}

/** Reuses the published analyzer SPI and LG0 builder; no second identity or graph engine. */
export async function extractProjectSources(sources: ProjectSources, repo: string, namespace: string, backend?: NativeAnalysisBackend, signal?: AbortSignal) {
  // SPI may mask dialect-specific syntax and split notebook cells. Bind those exact
  // acquired snapshots through the host's captured-input path, never re-read transformed text from disk.
  if (backend?.captured) backend = { ...backend, plugin: backend.captured.plugin, python: backend.captured.python };
  const lock = backend?.plugin.parserLockDigest ?? unwrap(digestJson({ unavailable: 'qualified-local-parser' }));
  const pythonLock = backend?.python?.parserLockDigest ?? lock;
  const dispatcher = backend ? createAnalyzerDispatcher([backend.plugin, createPythonAnalyzerPlugin({ parserLockDigest: pythonLock, provider: backend.python?.provider })], {
    schedule(ms, fn) { const timer = setTimeout(fn, ms); return { cancel: () => clearTimeout(timer) }; }
  }) : undefined;
  const unavailable: SpiDispatcher = { dispatch() { return { result: Promise.resolve({ status: 'failed', code: 'tool-unavailable' }), cancel: async () => undefined }; } };
  const wire: SpiDispatcher = { dispatch(projectId, request, captures) {
    const handle = (dispatcher ?? unavailable).dispatch(projectId, request, captures);
    const cancel = () => { void handle.cancel(); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    return { cancel: handle.cancel, result: handle.result.finally(() => signal?.removeEventListener('abort', cancel)) };
  } };
  const python = backend?.python ? { python: backend.python.provider, parserLockDigest: pythonLock } : {};
  const api = createApiExtractor({ pythonFacts: backend?.python ? async file => {
    if (signal?.aborted) throw new Error('cancelled');
    const identity = sessionIdentity(`project:${namespace}/${repo}`);
    const capture = selectedCapture(identity, file.path, file.text);
    const input = selectedRequest(identity, capture, { pluginId: 'datapass.api-static', version: '0.1.0-alpha.1', parserLockDigest: pythonLock }, 'python', 1, backend.ruleCatalogDigest);
    const handle = backend.python!.provider.start(input.request, input.captures);
    const cancel = () => { void handle.cancel(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const raw = await handle.facts;
      const facts = Array.isArray(raw) ? raw.find(f => f?.artifactId === capture.artifactId) : undefined;
      return facts && validatePythonSyntaxFacts(facts).ok ? facts : null;
    } finally { signal?.removeEventListener('abort', cancel); }
  } : undefined });
  // The pinned extractor's line-anchored sniff misses compact JSON. Its actual reader supports it.
  const apiJsonAware = { ...api, families: api.families.map(f => f.familyId === 'api.openapi'
    ? { ...f, sniff: { pattern: '(?:^\\s*"?(?:openapi|swagger)"?\\s*:|[,{]\\s*"(?:openapi|swagger)"\\s*:)', maxChars: 1024 } } : f) };
  const sql = createSqlExtractor({ dispatcher: wire, parserLockDigest: lock });
  const registry = createExtractorRegistry([
    sql,
    createPySparkExtractor({ dispatcher: wire, parserLockDigest: pythonLock, sqlParserLockDigest: backend ? lock : undefined }),
    createNotebookExtractor({ dispatcher: wire, pythonParserLockDigest: pythonLock, sqlParserLockDigest: backend ? lock : null }),
    createDbtExtractor({ targets: dbtTargets(sources.files), sql: backend ? sql : undefined }),
    createAirflowExtractor(python), createOrchestrationExtractor(python), apiJsonAware, createProjectPowerbiExtractor()
  ]);
  try {
    const extracted = await registry.extract({ namespace: analysisNamespace(namespace, repo), files: sources.files.filter(f => !/(^|\/)profiles\.ya?ml$/i.test(f.path)) }, { cancelled: () => !!signal?.aborted });
    if (!extracted.ok) throw new Error(`Project graph validation failed: ${extracted.issues.map(i => i.code).join(', ')}`);
    const value = extracted.value;
    const coverage: CoverageFile[] = [...sources.skipped, ...value.files.map(f => ({ repo, path: f.path, family: f.family ?? 'unclassified', status: f.status.toUpperCase() as CoverageFile['status'], reasons: value.gaps.filter(g => g.path === f.path).map(g => `${g.reason}: ${g.code}`) }))];
    // profiles.yml participates only through the existing non-secret target projection.
    coverage.push(...sources.files.filter(f => /(^|\/)profiles\.ya?ml$/i.test(f.path)).map(f => ({ repo, path: f.path, family: 'dbt.profiles', status: 'PARTIAL' as const, reasons: ['non-secret target context only; credentials excluded'] })));
    const sourceHashes = new Map(sources.files.map(f => [f.path, unwrap(digestExactBytes(new TextEncoder().encode(f.text))).value]));
    const evidence = (items: typeof value.graph.nodes[number]['evidence']) => items.map(e => ({ ...e, locator: e.locator ? { ...e.locator, path: `${repo}/${e.locator.path}`, sha: e.locator.sha ?? sourceHashes.get(e.locator.path) ?? null } : null }));
    return { nodes: value.graph.nodes.map(n => ({ ...n, evidence: evidence(n.evidence) })), edges: value.graph.edges.map(e => ({ ...e, evidence: evidence(e.evidence) })), files: coverage, limits: sources.limits };
  } finally { await dispatcher?.dispose(); }
}

export function assembleProjectIntelligence(namespace: string, parts: readonly { nodes: readonly LineageNodeInput[]; edges: readonly LineageEdgeInput[]; files: readonly CoverageFile[]; limits: readonly string[] }[]): ProjectIntelligence {
  const graph = buildLineageGraph({ namespace: analysisNamespace(namespace), nodes: parts.flatMap(p => p.nodes), edges: parts.flatMap(p => p.edges) });
  if (!graph.ok) throw new Error(`Project graph rejected: ${graph.issues.map(i => i.code).join(', ')}`);
  return { graph: graph.value, files: parts.flatMap(p => p.files), limits: parts.flatMap(p => p.limits), analyzedAt: new Date().toISOString() };
}
