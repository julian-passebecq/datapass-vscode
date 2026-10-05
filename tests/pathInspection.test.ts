import assert from 'node:assert/strict';
import test from 'node:test';
import { coalescePathInspection } from '../src/analysis/pathInspection';

test('simultaneous source path checks share one native call; subsequent phases recheck every path', async () => {
  const calls: readonly string[][] = [];
  const observed = calls as string[][];
  const inspector = coalescePathInspection({ async assertNoReparsePoints(paths) { observed.push([...paths]); } });
  await Promise.all([inspector.assertNoReparsePoints(['root', 'a']), inspector.assertNoReparsePoints(['root', 'b'])]);
  assert.deepEqual(calls, [['root', 'a', 'b']]);
  await inspector.assertNoReparsePoints(['root', 'a']);
  assert.deepEqual(calls, [['root', 'a', 'b'], ['root', 'a']], 'no inspection result is cached across phases');
});

test('native refusal fails every coalesced acquisition; independently cancellable requests stay separate', async () => {
  const signal = new AbortController().signal;
  const calls: (AbortSignal | undefined)[] = [];
  const error = new Error('path-reparse-or-inspection-failed');
  const inspector = coalescePathInspection({ async assertNoReparsePoints(_paths, abort) { calls.push(abort); throw error; } });
  const results = await Promise.allSettled([inspector.assertNoReparsePoints(['a'], signal), inspector.assertNoReparsePoints(['b'], signal), inspector.assertNoReparsePoints(['c'])]);
  assert.equal(results.every(r => r.status === 'rejected' && r.reason === error), true);
  assert.deepEqual(calls, [signal, undefined]);
});
