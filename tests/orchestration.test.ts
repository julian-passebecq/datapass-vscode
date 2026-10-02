import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestJson, unwrap } from '@juliandatapass-group/semantic-core';
import type { PythonFactsProvider } from '@juliandatapass-group/analyzers/python';
import { collectOrchestrationWorkspace, extractOrchestration, orchestrationSections, type PythonFactsHost } from '../src/analysis/orchestration';

// FIXORC copy (Common analyzers-airflow wind_classic_daily.py, analyzers-orchestration databricks/ and adf/, synthetic), as a workspace sees it.
const FIXORC = join(__dirname, 'fixtures/fixorc');

/** Trusted fake host (Common's replay provider): real CPython AST facts recorded by Common; no Python runs in tests. */
const recorded = JSON.parse(readFileSync(join(FIXORC, 'airflow-facts.json'), 'utf8')) as { files: { facts: { integrityDigest: { value: string } } }[] };
const replay: PythonFactsProvider = {
  start(request) {
    return { facts: Promise.resolve(request.snapshotManifest.map(entry => {
      const hit = recorded.files.find(f => f.facts.integrityDigest.value === entry.integrityDigest.value);
      return hit ? { ...structuredClone(hit.facts), artifactId: entry.artifactId } : null;
    })), cancel: async () => {} };
  }
};
const python: PythonFactsHost = { provider: replay, parserLockDigest: unwrap(digestJson({ fixtureFacts: 'fixorc/airflow-facts.json' })) };

const workspace = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'stda1a-'));
  for (const dir of ['airflow', 'databricks', 'adf']) cpSync(join(FIXORC, dir), join(root, 'orchestration', dir), { recursive: true });
  // Files no orchestration family claims stay out of the extraction.
  writeFileSync(join(root, 'package.json'), '{"name":"not-orchestration"}');
  return root;
};

test('STDA1a FIXORC with the Python facts host: Airflow DAG, bundle and ADF jobs, the @daily schedule, coverage rows', async () => {
  const root = workspace();
  try {
    const files = await collectOrchestrationWorkspace(root);
    const result = await extractOrchestration(files, { python });
    assert.ok(result, 'orchestration files found');
    const { graph, files: covered } = result.extraction;
    const family = Object.fromEntries(covered.map(f => [f.path, `${f.family}:${f.status}`]));
    assert.equal(family['package.json'], undefined);
    assert.match(family['orchestration/airflow/dags/wind_classic_daily.py']!, /^airflow\.dag:(understood|partial)$/);
    assert.match(family['orchestration/databricks/databricks.yml']!, /^databricks\.bundle:(understood|partial)$/);
    assert.match(family['orchestration/databricks/resources/jobs.yml']!, /^databricks\.bundle-resource:(understood|partial)$/);
    assert.match(family['orchestration/adf/pipeline/pl_adf_scada_to_bronze.json']!, /^adf\.pipeline:(understood|partial)$/);
    const jobs = graph.nodes.filter(n => n.kind === 'job').map(n => n.name);
    for (const name of ['wind_classic_daily', 'databricks-job:wind-bronze-ingest', 'databricks-job:wind-silver-transform', 'adf-pipeline:pl_adf_scada_to_bronze']) assert.ok(jobs.includes(name), `job ${name} in ${jobs.join(', ')}`);
    const tasks = new Set(graph.nodes.filter(n => n.kind === 'task').map(n => n.name));
    for (const name of ['wind_classic_daily.start', 'wind_classic_daily.bronze_ingest', 'wind_classic_daily.gold_turbine_kpi_daily', 'wind-silver-transform.gold_kpi', 'pl_adf_scada_to_bronze.copy_scada_landing_to_bronze']) assert.ok(tasks.has(name), `task ${name}`);
    const name = new Map(graph.nodes.map(n => [n.id, n.name]));
    const flows = graph.edges.filter(e => e.kind === 'orchestrates').map(e => `${name.get(e.fromId)} -> ${name.get(e.toId)}`);
    assert.ok(flows.includes('wind_classic_daily.silver_scada_clean -> wind_classic_daily.gold_turbine_kpi_daily'), flows.join('\n'));
    assert.ok(flows.includes('pl_adf_scada_to_bronze.copy_scada_landing_to_bronze -> pl_adf_scada_to_bronze.run_silver_transform'), flows.join('\n'));
    assert.deepEqual(result.schedules.map(s => ({ engine: s.engine, name: s.name, kind: s.kind, expression: s.expression, dialect: s.dialect })),
      [{ engine: 'airflow', name: 'wind_classic_daily', kind: 'cron', expression: '@daily', dialect: 'preset' }]);
    assert.ok(flows.includes('pl_adf_scada_to_bronze.run_silver_transform -> databricks-job:id:91002'), 'the ADF activity runs Databricks job 91002');
    assert.equal(name.get(result.schedules[0]!.nodeId), 'wind_classic_daily');
    const html = orchestrationSections(result);
    assert.match(html, /<h2>Schedules<\/h2><ul><li>airflow wind_classic_daily: @daily \(preset\)<\/li>/);
    assert.doesNotMatch(html, /Python parser is not available/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('STDA1a without the Python facts host: the DAG is unknown/tool-unavailable, never guessed; JSON/YAML families still read', async () => {
  const root = workspace();
  try {
    const result = await extractOrchestration(await collectOrchestrationWorkspace(root));
    assert.ok(result);
    const dag = result.extraction.files.find(f => f.path === 'orchestration/airflow/dags/wind_classic_daily.py');
    assert.equal(dag?.status, 'unknown');
    assert.ok(result.extraction.gaps.some(g => g.code === 'airflow.python-host-unavailable' && g.path === dag!.path));
    const jobs = result.extraction.graph.nodes.filter(n => n.kind === 'job').map(n => n.name);
    assert.ok(!jobs.includes('wind_classic_daily'));
    assert.ok(jobs.includes('databricks-job:wind-bronze-ingest') && jobs.includes('adf-pipeline:pl_adf_scada_to_bronze'));
    assert.deepEqual(result.schedules, []);
    assert.match(orchestrationSections(result), /Python parser is not available/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('STDA1a collection: links, oversize files and skipped folders are not read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stda1a-none-'));
  try {
    writeFileSync(join(root, 'settings.json'), '{"a":1}');
    cpSync(join(FIXORC, 'databricks'), join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'huge.asl.json'), `{"StartAt":"A","States":{"A":{"Type":"Pass","End":true}},"pad":"${'x'.repeat(2 * 1024 * 1024)}"}`);
    const files = await collectOrchestrationWorkspace(root);
    assert.deepEqual(files.map(f => f.path), ['settings.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('STDA1a no orchestration file: null', async () => {
  assert.equal(await extractOrchestration([{ path: 'settings.json', text: '{"a":1}' }]), null);
});


test('STDA1a panel sections escape workspace text', async () => {
  const result = await extractOrchestration([{ path: 'sfn/<b>.asl.json', text: '{"StartAt":"<i>x</i>","States":{"<i>x</i>":{"Type":"Pass","End":true}}}' }]);
  assert.ok(result);
  const html = orchestrationSections(result);
  assert.doesNotMatch(html, /<i>|<b>/);
  assert.match(html, /&lt;b&gt;/);
});
