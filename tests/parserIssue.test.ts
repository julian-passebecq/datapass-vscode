import test from 'node:test';
import assert from 'node:assert/strict';
import { parserIssueCode } from '../src/analysis/parserIssue';

test('native parser gaps keep failure codes without exposing source, paths or stderr', () => {
  assert.equal(parserIssueCode({ code: 'controller-timeout', message: 'secret source' }), 'controller-timeout');
  assert.equal(parserIssueCode(new Error('host-runtime-unqualified')), 'host-runtime-unqualified');
  for (const error of [new Error('C:\\private\\credentials.json: token=value'), { code: 'bad\nsecret' }, null]) {
    assert.equal(parserIssueCode(error), 'qualified-parser-unavailable');
  }
});
