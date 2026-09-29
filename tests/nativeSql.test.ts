import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLegacyUnderstanding, rebindLegacyEditor } from '../src/analysis/compat';
import { validateSourceAnchor } from '@juliandatapass-group/semantic-core';
import { hopState } from '../src/views/hopState';
import { hopHtml } from '../src/views/hopHtml';
import type { UnderstandingEntry } from '../src/core/understanding/load';
import { editorOffsets, selectedCapture, selectedRequest, sessionIdentity } from '../src/analysis/capture';
import { digestExactBytes, digestJson, unwrap } from '@juliandatapass-group/semantic-core';
import { createAnalysisSession } from '@juliandatapass-group/analysis-protocol';

const file = join(__dirname, '../examples/v3/hop/bridge/.datapass/understanding/pipelines/sql/customer_orders.sql.json');
const raw = readFileSync(file);
const native = readFileSync(join(__dirname, '../examples/v3/hop/pipelines/sql/customer_orders.sql'));
test('P1 workspace-local capture binds exact BOM/CRLF/Unicode bytes into the shared analysis session', () => {
  const identity = sessionIdentity('file:///workspace/no-bridge');
  assert.equal(identity.kind, 'workspace-local');
  const text = '\uFEFFSELECT \'😀\' AS value;\r\n';
  const capture = selectedCapture(identity, 'query.sql', Buffer.from(text));
  assert.equal(capture.text, text);
  const digest = unwrap(digestJson({ test: 'capture-binding' }));
  const input = selectedRequest(identity, capture, { pluginId: 'test-only', version: '1', parserLockDigest: digest }, 'tsql', 1, digest);
  assert.equal(createAnalysisSession(input.request, input.captures).ok, true);
  assert.equal(createAnalysisSession(input.request, [{ ...input.captures[0]!, text: text.replace('\r\n', '\n') }]).ok, false);
  const start = Buffer.byteLength(text.slice(0, text.indexOf('😀')));
  const anchor = { artifactId: capture.artifactId, integrityDigest: unwrap(digestExactBytes(capture.bytes)), encoding: 'utf-8' as const, span: { start, end: start + 4 } };
  assert.deepEqual(editorOffsets(anchor, capture), { start: text.indexOf('😀'), end: text.indexOf('😀') + 2 });
  assert.throws(() => editorOffsets({ ...anchor, span: { start: start + 1, end: start + 4 } }, capture));
  assert.throws(() => selectedCapture(identity, '../query.sql', 'SELECT 1'));
  assert.throws(() => selectedCapture(identity, 'query.sql', new Uint8Array([0xff])));
  assert.throws(() => selectedCapture(identity, 'query.sql', '\ud800'));
  assert.notEqual(sessionIdentity('file:///other').id, identity.id);
});
function entry(): UnderstandingEntry {
  const parsed = readLegacyUnderstanding(raw, { repository: 'pipelines', path: 'sql/customer_orders.sql', bytes: native });
  return { file, generation: 1, repositoryKey: 'pipelines', nativePath: 'sql/customer_orders.sql', state: 'ok', doc: parsed.doc, diagnostics: parsed.diagnostics, compatibility: parsed.projection };
}
test('P1 consumes packed Common V3 API with exact captured anchors and loss-aware Hop sidecar', () => {
  const e = entry(); assert.ok(e.doc); assert.ok(e.compatibility?.anchors.length);
  for (const { resolution } of e.compatibility!.anchors) { assert.equal(resolution.reason, 'resolved'); assert.equal(validateSourceAnchor(resolution.anchor, native).ok, true); }
  assert.deepEqual(e.compatibility!.datasetLineage, []);
  assert.deepEqual(Buffer.from(e.compatibility!.documents[0]!.originalBytes), raw);
  const state = hopState({ fileName: 'customer_orders.sql', located: { repositoryKey: 'pipelines', nativePath: 'sql/customer_orders.sql' }, entry: e, hasProject: true, workOrdersEnabled: false, canGoBack: true });
  assert.equal(state.compatibility?.resolved, state.steps.length);
  assert.match(hopHtml(state, '', 'nonce'), /Source binding and evidence limits/);
  assert.ok(state.steps.every(s => ['declared','inferred','estimated','illustrative'].includes(s.provenance)));
});
test('P1 dirty editor rebinding replaces exact source digest but never mutates the cached disk entry', () => {
  const disk = entry();
  const crlf = '\uFEFF' + native.toString('utf8').replace(/\r?\n/g, '\r\n');
  const bound = rebindLegacyEditor(disk, crlf);
  assert.equal(bound.state, 'ok');
  for (const { resolution } of bound.compatibility!.anchors) assert.equal(validateSourceAnchor(resolution.anchor, Buffer.from(crlf)).ok, true);
  assert.notDeepEqual(bound.compatibility!.anchors[0]!.resolution.anchor!.integrityDigest, disk.compatibility!.anchors[0]!.resolution.anchor!.integrityDigest);
  const changed = rebindLegacyEditor(disk, 'SELECT changed;');
  assert.equal(changed.state, 'stale'); assert.ok(changed.compatibility!.anchors.every(a => a.resolution.anchor === null));
  assert.equal(disk.state, 'ok'); assert.ok(disk.compatibility!.anchors.every(a => a.resolution.reason === 'resolved'));
  assert.equal(rebindLegacyEditor(disk, 'a'.repeat(2 * 1024 * 1024 + 1)).state, 'stale');
});
