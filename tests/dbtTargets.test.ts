import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDbtWorkspace, dbtSections, dbtTargets, extractDbt } from '../src/analysis/dbt';

// FIXDBT copy (Common analyzers-dbt fixture foil-synthetic-dbt, without target/): static mode, as a workspace sees a dbt project.
const FIXDBT = join(__dirname, 'fixtures/fixdbt');

const view = async (root: string) => {
  const result = await extractDbt(await collectDbtWorkspace(root));
  assert.ok(result, 'dbt project found');
  const { graph, gaps } = result.extraction;
  const name = new Map(graph.nodes.map(n => [n.id, n.name]));
  const writes = graph.edges.filter(e => e.kind === 'writes').map(e => `${name.get(e.fromId)} -> ${name.get(e.toId)}`);
  return { result, writes, codes: gaps.map(g => g.code), gaps };
};

test('DBT3W FIXDBT with its profiles.yml target: physical relation names, no dbt.no-target hole', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dbt3w-'));
  try {
    // A nested project, as in a real workspace: paths stay relative to the workspace folder.
    cpSync(FIXDBT, join(workspace, 'dbt/wind'), { recursive: true });
    const files = await collectDbtWorkspace(workspace);
    assert.ok(files.every(f => f.path.startsWith('dbt/wind/')));
    // Names only: the profile's host and token never reach the extractor options.
    assert.deepEqual(dbtTargets(files), { foil_syn_wind: { adapter: 'databricks', database: 'wind_syn', schema: 'dbt_syn_dev', name: 'dev' } });
    const { result, writes, codes } = await view(workspace);
    assert.deepEqual(result.targets, ['foil_syn_wind']);
    for (const w of ['int_scada_hourly -> wind_syn.dbt_syn_intermediate.int_scada_hourly', 'snap_turbine -> wind_syn.dbt_syn_snapshots.snap_turbine',
      'seed_alarm_codes -> wind_syn.dbt_syn_seeds.seed_alarm_codes', 'mart_site_energy -> wind_syn.dbt_syn_marts.mart_site_energy_v1']) assert.ok(writes.includes(w), w);
    assert.ok(!codes.includes('dbt.no-target'));
    assert.ok(!result.extraction.files.some(f => f.path.endsWith('profiles.yml')), 'profiles.yml is read for targets only');
    const html = dbtSections(result);
    assert.ok(html.includes('foil_syn_wind') && !html.includes('azuredatabricks') && !html.includes('SYNTHETIC_ONLY'));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('DBT3W FIXDBT without profiles.yml: logical relations and the dbt.no-target hole, shown in coverage limits', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dbt3w-'));
  try {
    cpSync(FIXDBT, workspace, { recursive: true, filter: src => !src.endsWith('profiles.yml') });
    const { result, writes, codes, gaps } = await view(workspace);
    assert.deepEqual(result.targets, []);
    assert.equal(codes.filter(c => c === 'dbt.no-target').length, 1);
    assert.equal(gaps.find(g => g.code === 'dbt.no-target')!.path, 'dbt_project.yml');
    assert.ok(writes.includes('int_scada_hourly -> foil_syn_wind.model.int_scada_hourly'));
    assert.ok(!writes.some(w => w.includes('dbt_syn_intermediate')));
    assert.ok(dbtSections(result).includes('dbt.no-target'));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('DBT3W no dbt_project.yml: nothing is extracted', async () => {
  assert.equal(await extractDbt([{ path: 'queries/a.sql', text: 'select 1' }, { path: 'profiles.yml', text: 'p:\n  target: dev' }]), null);
});
