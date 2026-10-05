import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { DataPassTestApi } from '../../src/extension';
import { test, record, waitFor } from './harness';
import { withUi } from './ui';

export function registerProjectIntelligenceFlows(getApi: () => DataPassTestApi): void {
  test('V6: installed Home selects arbitrary environments and companion commands are optional', async () => {
    const api = getApi();
    await api.home.open();
    let home = await api.home.state();
    assert.deepEqual(home.intelligence?.environments.map(e => e.id), ['sandbox-west', 'client-live']);
    assert.equal(home.intelligence?.coverage.analyzed, false);
    assert.deepEqual(home.companions, []);
    await api.home.send({ type: 'environment', id: 'sandbox-west' });
    home = await api.home.state();
    assert.equal(home.intelligence?.environments.find(e => e.selected)?.identifiers[0]?.value, 'sandbox-fixture');
    await api.home.send({ type: 'environment', id: 'client-live' });
    home = await api.home.state();
    assert.equal(home.intelligence?.environments.find(e => e.selected)?.production, true);
    assert.equal(home.intelligence?.environments.find(e => e.selected)?.identifiers[0]?.value, 'live-fixture');
    const invalid = await withUi([], () => api.home.send({ type: 'environment', id: 'invented-env' }), { allowErrors: true });
    assert.ok(invalid.errors.some(e => /Unknown declared environment/.test(e)));
    const absent = await withUi([], () => api.home.send({ type: 'companion', id: 'deployment' }), { allowErrors: true });
    assert.ok(absent.errors.some(e => /not installed/.test(e)));
    let payload: any;
    const stub = vscode.commands.registerCommand('cloudStudio.planDeployment', p => { payload = p; });
    try {
      assert.deepEqual((await api.home.state()).companions, ['deployment']);
      await api.home.send({ type: 'companion', id: 'deployment' });
      assert.equal(payload.schema, 'datapass.project-navigation/1');
      assert.equal(payload.environment, 'client-live');
      assert.equal(payload.mode, 'inspect-or-plan');
    } finally { stub.dispose(); }
    assert.deepEqual((await api.home.state()).companions, []);
    record('v6EnvironmentAndInterop', { environments: home.intelligence?.environments, payload, companionAbsent: true });
  }, ['v6-intelligence']);

  test('V6: local analysis populates one shared graph, Navigator projections, guided paths and Sankey', async () => {
    const api = getApi();
    await vscode.commands.executeCommand('datapass.understanding.analyzeProject');
    const report = api.intelligence.report();
    assert.ok(report, 'the installed parser and SPI must produce an accepted project report');
    record('v6ParserQualification', { hostNode: process.versions.node, files: report.files, limits: report.limits });
    assert.equal(report.files.find(f => f.path === '.env')?.status, 'IGNORED');
    assert.ok(report.files.find(f => f.path === 'src/query.sql')?.status === 'UNDERSTOOD', JSON.stringify({ files: report.files, limits: report.limits }));
    for (const file of ['src/spark.py', 'src/example.ipynb']) assert.equal(report.files.find(f => f.path === file)?.status, 'UNDERSTOOD', JSON.stringify(report.files));
    const sessionSource = report.files.find(f => f.path === 'src/spark_session.py');
    assert.equal(sessionSource?.status, 'PARTIAL', 'dynamic session construction stays an explicit parser gap');
    assert.ok(sessionSource?.reasons.some(r => r.includes('python.assignment-unresolved')));
    assert.ok(report.graph.edges.some(e => e.kind === 'writes' && e.evidence.some(ev => ev.locator?.path.endsWith('/src/spark.py'))), 'known Spark flow must produce source-bound writes');
    for (const path of ['dbt/models/source_orders.sql', 'dbt/models/clean_orders.sql']) {
      const file = report.files.find(f => f.path === path);
      assert.ok(file && file.status !== 'UNKNOWN', JSON.stringify(file));
      assert.ok(!file.reasons.some(r => /tool-unavailable|extractor-failed/.test(r)), 'dbt column extraction must receive the installed SQL extractor');
    }
    assert.ok(report.graph.edges.some(e => e.kind === 'derives' && e.evidence.some(ev => ev.locator?.path.includes('/dbt/'))), 'dbt must project SQL column lineage');
    assert.ok(report.graph.nodes.some(n => n.kind === 'api-endpoint'));
    assert.ok(report.graph.edges.some(e => e.kind === 'exposes'), 'PBIP model/report pointer reaches the shared graph');
    assert.ok(report.graph.edges.some(e => e.kind === 'reads' || e.kind === 'writes'), 'installed SQL/Python extraction');
    assert.ok(report.graph.edges.every(e => e.evidence.length && e.evidence.every(ev => ev.origin !== 'runtime')));
    assert.equal(JSON.stringify(report).includes('never-read-or-export'), false);
    const scratch = await vscode.workspace.openTextDocument({ content: 'unrelated virtual document' });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(scratch.uri, new vscode.Position(0, 0), 'changed ');
    await vscode.workspace.applyEdit(edit);
    const metadata = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, '.git', 'datapass-qualification-sentinel');
    await vscode.workspace.fs.writeFile(metadata, Buffer.from('owned fixture metadata, outside source analysis\n'));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(api.intelligence.report(), report, 'virtual documents and Git metadata cannot retire valid source evidence');
    const node = report.graph.nodes[0]!;
    await vscode.commands.executeCommand('datapass.intelligence.lineage');
    api.intelligence.navigate({ type: 'go', location: { level: 'artifact', artifactKind: 'other', nodeId: node.id } });
    for (const key of ['architecture', 'data', 'columns', 'orchestration', 'deployment', 'impact', 'quality', 'environment']) {
      api.intelligence.navigate({ type: 'view', viewId: `project-${key}` });
      assert.equal(api.intelligence.navigation().state.location.nodeId, node.id);
      assert.equal(api.intelligence.navigation().state.viewId, `project-${key}`);
    }
    const tour = api.intelligence.paths().find(t => t.id === 'datapass.project.overview');
    assert.ok(tour && tour.steps.length >= 4);
    const qualification = JSON.stringify(api.qualification());
    api.intelligence.startPath(tour.id);
    for (let i = 0; i < tour.steps.length; i++) {
      assert.equal(api.intelligence.navigation().state.location.nodeId, tour.steps[i]!.location.nodeId);
      if (i + 1 < tour.steps.length) await vscode.commands.executeCommand('datapass.nav.tour.next');
    }
    assert.equal(JSON.stringify(api.qualification()), qualification, 'visiting is not verification');
    await vscode.commands.executeCommand('datapass.intelligence.sankey');
    assert.equal(api.intelligence.navigation().state.viewId, 'project-sankey');
    record('v6Intelligence', { graph: report.graph, files: report.files, limits: report.limits, tour: tour.id, steps: tour.steps.length, canonicalId: node.id });
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'src/query.sql');
    await vscode.workspace.fs.writeFile(uri, Buffer.from('SELECT id FROM dbo.changed_orders;\n'));
    await waitFor('project evidence invalidated after a disk source change', () => !api.intelligence.report() || undefined, 15000);
    assert.equal((await api.home.state()).intelligence?.coverage.analyzed, false);
  }, ['v6-intelligence']);
}
