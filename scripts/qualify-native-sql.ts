/** Bounded, explicitly invoked integration probe. Does not launch VS Code or execute source SQL. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createAnalyzerDispatcher } from '@juliandatapass-group/analyzers';
import { createNativeBackend } from '../src/analysis/backend';
import { selectedCapture, selectedRequest, sessionIdentity } from '../src/analysis/capture';

async function main(): Promise<void> {
  const [extensionRoot, fixtureRoot, output] = process.argv.slice(2);
  if (!extensionRoot || !fixtureRoot || !output) throw new Error('Usage: qualify-native-sql <extension-root> <qualified-fixture-root> <output-json>');
  const backend = await createNativeBackend(extensionRoot, fixtureRoot);
  const dispatcher = createAnalyzerDispatcher([backend.plugin], { schedule(ms, callback) { const timer = setTimeout(callback, ms); return { cancel() { clearTimeout(timer); } }; } });
  try {
    const identity = sessionIdentity('qualification:selected-sql');
    const bytes = await backend.acquire(fixtureRoot, 'join-filter.sql', new AbortController().signal);
    const capture = selectedCapture(identity, 'join-filter.sql', bytes);
    const input = selectedRequest(identity, capture, { pluginId: backend.plugin.id, version: backend.plugin.version, parserLockDigest: backend.plugin.parserLockDigest }, 'tsql', 1, backend.ruleCatalogDigest);
    const result = await dispatcher.dispatch(identity.id, input.request, input.captures).result;
    assert.equal(result.status, 'result'); if (result.status !== 'result') return;
    assert.equal(result.response.kind, 'result'); if (result.response.kind !== 'result') return;
    assert.ok(result.response.entities.length > 0, 'Real SQL AST must produce entities');
    assert.ok(result.response.claims.some(c => c.predicate === 'dataset.name'), 'Real SQL must expose dataset claims');
    assert.ok(result.response.edges.length > 0, 'Real SQL must expose static lineage links');
    assert.ok(!result.response.coverageGaps.some(g => g.reason === 'tool-unavailable'), 'Containment must be available for this qualified fixture');
    const report = { schema: 'datapass.p1-native-qualification/1', runtime: process.versions, inputDigest: input.request.header.sourceDigests[0]!.integrityDigest, parserLockDigest: backend.plugin.parserLockDigest,
      counts: { entities: result.response.entities.length, claims: result.response.claims.length, edges: result.response.edges.length }, gaps: result.response.coverageGaps.map(g => g.reason),
      checks: ['vendored-package-import', 'packaged-runtime-manifest-and-files', 'native-acquisition', 'LPAC-static-SQL', 'Common-dispatch-result-acceptance'],
      limits: ['Selected saved disk SQL only', 'No DQ rules evaluated', 'No VS Code UI assertion in this probe', 'Supported trusted-host context only'] };
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } finally { await dispatcher.dispose(); await backend.dispose(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'qualification failed'); process.exitCode = 1; });
