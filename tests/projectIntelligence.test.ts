import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectMap } from '../src/core/project/projectMap';
import { coverageSummary, environmentContext, projectThemes } from '../src/core/project/intelligence';
import { collectProjectSources, extractProjectSources, assembleProjectIntelligence } from '../src/analysis/project';
import { inputA } from './fixtures/v3/research';
import { homeState } from '../src/views/homeState';
import { homeHtml } from '../src/views/homeHtml';
import { resolveBindings } from '../src/core/navigation/bindings';
import { projectLocation } from '../src/core/navigation/projectLadder';
import { buildLineageGraph, canonicalNodeId, type LineageEvidence } from '@juliandatapass-group/lineage-core';
import { digestJson, unwrap } from '@juliandatapass-group/semantic-core';
import { SQL_PLUGIN_ID, SQL_PLUGIN_VERSION, SQL_NO_RULE_EVALUATION_DIGEST } from '@juliandatapass-group/analyzers/sql';
import { buildLadder } from '../src/core/navigation/ladder';
import { withLineageLadder } from '../src/core/navigation/lineageLadder';
import { NavigationService } from '../src/core/navigation/navigationService';
import { builtinCatalog } from '../src/core/navigation/viewPacks';
import { generateProjectPaths } from '../src/core/navigation/tours/generate';
import { availableProjectCompanions, projectCompanionPayload } from '../src/core/companions/projectInterop';
import { isGraphView } from '../src/webview/views/layouts/graph';
import { intelligenceFiles } from './fixtures/v6/projectIntelligence';

test('Project Home uses arbitrary manifest environments, per-environment IDs and existing preflights', () => {
  const input = inputA();
  input.manifest = { ...input.manifest!, environments: [{ id: 'sandbox-west', title: '<Sandbox>' }, { id: 'client-live', production: true }],
    identifiers: [{ id: 'workspace', label: 'Workspace', provider: 'fabric', values: { 'sandbox-west': 'sandbox-id', 'client-live': 'live-id' } }] };
  const map = buildProjectMap(input);
  const environments = environmentContext(map, input.manifest, undefined, 'sandbox-west');
  assert.deepEqual(environments.map(e => e.id), ['sandbox-west', 'client-live']);
  assert.equal(environments[0]?.identifiers[0]?.value, 'sandbox-id');
  assert.equal(environments[1]?.identifiers[0]?.value, 'live-id');
  assert.equal(environments[0]?.selected, true);
  assert.equal(environments[1]?.production, true);
  const home = homeState({ hasProject: true, map, manifest: input.manifest, selectedEnvironment: 'sandbox-west', workOrdersEnabled: false, layouts: [], shows: () => true });
  const html = homeHtml(home, 'home', 'vscode:', 'nonce');
  assert.match(html, /data-project-intelligence/);
  assert.match(html, /&lt;Sandbox&gt;/);
  assert.match(html, /data-environment="sandbox-west" aria-pressed="true"/);
  assert.match(html, /Not analyzed/);
  assert.match(html, /Counts do not measure effort/);
  assert.equal(projectThemes(map).some(t => t.title === 'main'), false, 'repository branch is not a theme');
});

test('project analysis classifies every supplied file and wires the same canonical graph into Navigator', async () => {
  const sources = { files: [
    { path: 'openapi.json', text: JSON.stringify({ openapi: '3.0.3', info: { title: 'Local API', version: '1' }, paths: { '/orders': { get: { operationId: 'orders', responses: { '200': { description: 'ok' } } } } } }) },
    { path: 'query.sql', text: 'SELECT id FROM orders;' },
    { path: 'opaque.tf', text: 'resource "example" "opaque" {}' },
    { path: 'spark.py', text: 'from pyspark.sql import SparkSession\ndf = spark.table("orders")' }
  ], skipped: [], limits: [] };
  const part = await extractProjectSources(sources, 'app', 'client');
  const report = assembleProjectIntelligence('client', [part]);
  assert.equal(report.files.length, 4);
  assert.ok(report.files.every(f => ['UNDERSTOOD', 'PARTIAL', 'UNKNOWN', 'IGNORED'].includes(f.status)));
  assert.equal(report.files.find(f => f.path === 'opaque.tf')?.status, 'UNKNOWN');
  assert.notEqual(report.files.find(f => f.path === 'query.sql')?.status, 'UNDERSTOOD', 'absent parser cannot claim SQL understood');
  assert.ok(report.graph.nodes.some(n => n.kind === 'api-endpoint'));
  assert.ok(report.graph.nodes.every(n => n.evidence.every(e => e.locator?.path.startsWith('app/'))));
  assert.ok(report.graph.edges.every(e => e.evidence.length > 0));
  const map = buildProjectMap(inputA());
  const [bound] = resolveBindings({ id: 'lineage', title: 'Lineage', layout: 'graph', bindings: [{ source: 'lineage' }] }, { location: projectLocation(map), projectMap: map, lineageGraph: report.graph });
  assert.ok(bound?.result.graph);
  assert.equal(bound?.result.holes.some(h => /No lineage graph/.test(h.reason)), false);
  const summary = coverageSummary(report);
  assert.equal(Object.values(summary.counts).reduce((a, b) => a + b, 0), 4);
  assert.equal(summary.origins['runtime-observed'] ?? 0, 0);
});

test('cancelling project analysis stops an in-flight parser without waiting for its request deadline', { timeout: 6000 }, async () => {
  const abort = new AbortController();
  let cancelled = 0;
  const parserLockDigest = unwrap(digestJson({ fixture: 'project-cancel' }));
  await assert.rejects(extractProjectSources({ files: [{ path: 'query.sql', text: 'SELECT 1;' }], skipped: [], limits: [] }, 'app', 'cancel', {
    plugin: { id: SQL_PLUGIN_ID, version: SQL_PLUGIN_VERSION, parserLockDigest, dialects: ['tsql', 'spark'], start() {
      queueMicrotask(() => abort.abort());
      return { response: new Promise(() => undefined), cancel: async () => { cancelled++; } };
    } }, ruleCatalogDigest: SQL_NO_RULE_EVALUATION_DIGEST,
    acquire: async () => { throw new Error('SPI uses acquired snapshots'); }, dispose: async () => undefined
  }, abort.signal), /cancelled/);
  assert.ok(cancelled > 0, 'owned parser cleanup must happen on user cancellation');
});

test('bounded discovery records unreadable/oversized/credential gaps and never reads excluded source trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'datapass-intelligence-'));
  try {
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'hidden.sql'), 'SELECT 1;');
    await writeFile(join(root, '.env'), 'PASSWORD=do-not-export');
    await writeFile(join(root, 'a.sql'), 'SELECT 1;');
    await writeFile(join(root, 'b.json'), '{}');
    const all = await collectProjectSources(root, 'app');
    assert.deepEqual(all.files.map(f => f.path), ['a.sql', 'b.json']);
    assert.equal(all.skipped.find(f => f.path === '.env')?.status, 'IGNORED');
    assert.equal(JSON.stringify(all).includes('do-not-export'), false);
    const bounded = await collectProjectSources(root, 'app', undefined, 1);
    assert.equal(bounded.files.length + bounded.skipped.length, 1);
    assert.match(bounded.limits.join(' '), /remaining paths not enumerated/);
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'datapass-intelligence-'))); await rm(root, { recursive: true, force: true }); }
});

test('all graph projections retain selected canonical identity and keep evidence origins separate', () => {
  const evidence: LineageEvidence[] = (['static', 'artifact', 'runtime', 'ai-proposed'] as const).map(origin => ({ origin, extractor: 'v6-tests@1.0.0',
    locator: origin === 'runtime' || origin === 'ai-proposed' ? null : { kind: 'file', path: 'app/job.py', startLine: 1, endLine: 2, sha: null },
    confidence: 1, runRef: origin === 'runtime' ? 'external-run-1' : null, proposalId: origin === 'ai-proposed' ? `datapass:lineage-proposal:${'a'.repeat(64)}` : null, evidenceIds: [] }));
  const node = (name: string) => ({ id: unwrap(canonicalNodeId({ kind: 'job', scope: 'app', name })), kind: 'job' as const, name, parentId: null, path: null, aliases: [], evidence });
  const a = node('producer'), b = node('consumer');
  const graph = unwrap(buildLineageGraph({ namespace: 'client', nodes: [a, b], edges: [{ kind: 'orchestrates', fromId: a.id, toId: b.id, transform: null, transformText: null, volumetry: null, evidence }] }));
  const map = buildProjectMap(inputA());
  const summary = coverageSummary({ graph, files: [], limits: [], analyzedAt: 'test' });
  assert.deepEqual(summary.origins, { 'static-parse': 1, 'artifact-import': 1, 'runtime-observed': 1, 'ai-proposed': 1 });
  const nav = new NavigationService(withLineageLadder(buildLadder({ map }), graph), builtinCatalog());
  nav.dispatch({ type: 'go', location: { level: 'artifact', nodeId: b.id, artifactKind: 'other' } });
  for (const projection of ['architecture', 'data', 'columns', 'orchestration', 'deployment', 'impact', 'quality', 'environment']) {
    nav.dispatch({ type: 'view', viewId: `project-${projection}` });
    assert.equal(nav.state.location.nodeId, b.id);
    const view = nav.views().find(v => v.id === nav.state.viewId)!;
    const [bound] = resolveBindings(view, { location: nav.state.location, projectMap: map, lineageGraph: graph });
    assert.ok(bound?.result.graph, `${projection}: ${JSON.stringify(bound?.result.holes)}`);
    assert.ok(isGraphView(bound.result.graph), projection);
    assert.ok(bound.result.graph.nodes.some(n => n.id === b.id), `${projection} lost the selected canonical node`);
  }
});

test('project paths use declared components; visits never create verification; optional commands degrade without companions', () => {
  const map = buildProjectMap(inputA());
  const nav = new NavigationService(buildLadder({ map }), builtinCatalog());
  const paths = generateProjectPaths(map, { viewsAt: l => nav.viewsAt(l) });
  assert.ok(paths.some(p => p.id === 'datapass.project.overview'));
  assert.ok(paths.some(p => p.id === 'datapass.project.interview'));
  assert.ok(paths.every(p => p.steps.every(s => s.origin === 'datapass-guidance')));
  const before = JSON.stringify(map);
  for (const step of paths[0]!.steps) nav.dispatch({ type: 'go', location: step.location });
  assert.equal(JSON.stringify(map), before, 'tour navigation does not create qualification evidence');
  assert.deepEqual(availableProjectCompanions([]), []);
  assert.deepEqual(availableProjectCompanions(['cloudStudio.planDeployment', 'tern.revealRevision']), ['deployment', 'revision']);
  const payload = projectCompanionPayload(map, undefined, 'dev');
  assert.equal(payload.mode, 'inspect-or-plan');
  assert.equal(payload.provenance, 'declared');
  assert.equal(payload.environment, 'dev');
});

test('project Sankey uses the existing renderer and labels the weight as declared components', () => {
  const map = buildProjectMap(inputA());
  const [result] = resolveBindings({ id: 'sankey', title: 'Sankey', layout: 'graph', bindings: [{ source: 'project-sankey' }] }, { location: projectLocation(map), projectMap: map });
  assert.ok(isGraphView(result?.result.graph));
  assert.ok(result.result.graph.edges.every(e => e.volumetry?.label === '1 declared component'));
  assert.ok(result.result.rows?.every(row => row.unit === 'declared components'));
});

test('Power BI structure reuses PBIP references and preserves explicit expression-lineage gaps', async () => {
  const sources = { files: Object.entries(intelligenceFiles).filter(([path]) => path.startsWith('bi/')).map(([path, text]) => ({ path, text })), skipped: [], limits: [] };
  const report = assembleProjectIntelligence('client', [await extractProjectSources(sources, 'app', 'client')]);
  assert.equal(report.files.length, 4);
  assert.ok(report.files.every(f => f.status === 'PARTIAL'), JSON.stringify(report));
  assert.ok(report.graph.edges.some(e => e.kind === 'exposes'));
  assert.ok(report.graph.edges.every(e => e.evidence.every(ev => ev.origin === 'static' && ev.locator?.path.endsWith('definition.pbir'))));
  assert.ok(report.files.every(f => f.reasons.some(r => /no-expression-lineage/.test(r))));
});

test('environment projection refuses inferred applicability; impact follows downstream links only', () => {
  const ev: LineageEvidence[] = [{ origin: 'static', extractor: 'v6-tests@1.0.0', locator: { kind: 'file', path: 'app/job.py', startLine: 1, endLine: 1, sha: null }, confidence: 1, runRef: null, proposalId: null, evidenceIds: [] }];
  const nodes = ['a', 'b', 'c'].map(name => ({ id: unwrap(canonicalNodeId({ kind: 'job', scope: 'app', name })), kind: 'job' as const, name, parentId: null, path: null, aliases: [], evidence: ev }));
  const edge = (from: number, to: number) => ({ kind: 'orchestrates' as const, fromId: nodes[from]!.id, toId: nodes[to]!.id, transform: null, transformText: null, volumetry: null, evidence: ev });
  const graph = unwrap(buildLineageGraph({ namespace: 'client', nodes, edges: [edge(0, 1), edge(1, 2)] }));
  const location = { level: 'artifact' as const, nodeId: nodes[1]!.id, artifactKind: 'other' };
  const view = (projection: string) => ({ id: projection, title: projection, layout: 'graph' as const, bindings: [{ source: 'project-lineage', params: { projection } }] });
  const impact = resolveBindings(view('impact'), { location, lineageGraph: graph })[0]!.result;
  assert.ok(isGraphView(impact.graph));
  assert.deepEqual(new Set(impact.graph.nodes.map(n => n.id)), new Set([nodes[1]!.id, nodes[2]!.id]));
  const environment = resolveBindings(view('environment'), { location, lineageGraph: graph })[0]!.result;
  assert.ok(isGraphView(environment.graph));
  assert.deepEqual(environment.graph.nodes.map(n => n.id), [nodes[1]!.id]);
  assert.equal(environment.graph.edges.length, 0);
  assert.ok(environment.holes.some(h => /not inferred/.test(h.reason)));
});
