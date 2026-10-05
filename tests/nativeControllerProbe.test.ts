import test from 'node:test';
import assert from 'node:assert/strict';
import { controllerFailureCodes } from '../scripts/native-controller-probe';

test('controller qualification retains Windows/fixed refusal codes and discards stderr source and paths', () => {
  const stderr = 'Traceback:\n  File "C:\\private\\source.py"\nOSError: [WinError 5] Access is denied: token=value\nRuntimeError: worker-not-ready\nValueError: secret-project-value\n';
  assert.deepEqual(controllerFailureCodes(stderr), ['win32-5', 'worker-not-ready']);
  assert.deepEqual(controllerFailureCodes('OSError: appcontainer-profile-failed\n'), ['appcontainer-profile-failed']);
  assert.deepEqual(controllerFailureCodes('    ok(assign_job(job,pi.process))\nOSError: [WinError 5] Access denied'), ['phase-assign-job', 'win32-5']);
  assert.deepEqual(controllerFailureCodes('  File "C:\\private\\datapass_analyzer.py", line 1, in warm_up\nModuleNotFoundError: secret-module-name\n'), ['worker-phase-warm_up', 'python-modulenotfounderror']);
  assert.deepEqual(controllerFailureCodes('datapass-worker-exit:3221225794\ndatapass-worker-exit:source-value\n'), ['worker-exit-3221225794']);
  assert.deepEqual(controllerFailureCodes('ImportError: DLL load failed while importing _socket: Access is denied.\n'), ['python-importerror', 'python-dll-import-_socket', 'python-dll-access-denied']);
  assert.deepEqual(controllerFailureCodes('ImportError: DLL load failed while importing secret: private-path\n'), ['python-importerror']);
});
