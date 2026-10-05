/** Installed, built-in fixture only: expose bounded Windows launch diagnostics, never client source or raw stderr. */
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const FIXED = new Set(['appcontainer-profile-failed', 'worker-not-ready', 'worker-exit-failed', 'worker-timeout',
  'runtime-acl-cleanup', 'profile-cleanup', 'registry-canary-cleanup', 'runtime-reparse-point', 'canary-key-exists',
  'canary-control-failed', 'controller-arguments', 'controller-mode', 'controller-root', 'controller-containment',
  'controller-limits', 'unsupported-reparse-point', 'unsupported-root', 'unsupported-filesystem', 'root-enumeration-limit']);
const REFUSALS = new Set(['unknown-policy', 'runtime-writable', 'write-denial-unknown', 'selected-root-readable',
  'selected-root-access-unknown', 'hkcu-canary-readable', 'hkcu-access-unknown', 'network-socket-allowed',
  'network-denial-unknown', 'child-process-allowed', 'child-denial-unknown']);
// Qualification-only diagnostic: execute the installed controller with one failure-path observation.
// No runtime file is changed; all launch, access, Job Object and parser policies remain identical.
const SOURCE_DIAGNOSTIC = `import sys,pathlib
p=pathlib.Path(sys.argv[1]); source=p.read_text(encoding='utf-8')
old="if signal not in (b'R',b'X'): raise RuntimeError('worker-not-ready')"
assert source.count(old)==1
new="if signal not in (b'R',b'X'):\\n                    worker_status=w.DWORD(); ok(exit_code(pi.process,c.byref(worker_status)))\\n                    sys.stderr.write('datapass-worker-exit:'+str(worker_status.value)+'\\\\n'); sys.stderr.flush()\\n                    raise RuntimeError('worker-not-ready')"
source=source.replace(old,new); sys.argv=sys.argv[1:]
exec(compile(source,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})`;
export function controllerFailureCodes(stderr: string): string[] {
  const codes = new Set<string>();
  for (const line of stderr.split(/\r?\n/)) {
    const exceptionKind = /^(ImportError|ModuleNotFoundError|AttributeError|PermissionError|FileNotFoundError|BrokenPipeError|MemoryError|SystemError|TypeError|KeyError|AssertionError):/.exec(line);
    if (exceptionKind) codes.add(`python-${exceptionKind[1]!.toLowerCase()}`);
    const workerPhase = /datapass_analyzer\.py", line \d+, in (warm_up|main|preflight|read_frame|scrub_environment)\s*$/.exec(line);
    if (workerPhase) codes.add(`worker-phase-${workerPhase[1]}`);
    for (const [call, phase] of [['ok(assign_job(job,pi.process))', 'assign-job'], ['ok(create_process(', 'create-worker'],
      ["set_runtime_access(sid,True)", 'runtime-acl'], ['hr=create_profile(', 'create-profile']] as const) {
      if (line.trim().startsWith(call)) codes.add(`phase-${phase}`);
    }
    const win = /\[WinError (\d{1,10})\]/.exec(line);
    if (win) codes.add(`win32-${win[1]}`);
    const workerExit = /^datapass-worker-exit:(\d{1,10})$/.exec(line);
    if (workerExit) codes.add(`worker-exit-${workerExit[1]}`);
    const exception = /^(?:RuntimeError|OSError|ValueError): ([a-z,-]+)$/.exec(line);
    for (const code of exception?.[1]?.split(',') ?? []) if (FIXED.has(code)) codes.add(code);
    const containment = /^datapass-containment:([a-z-]+)$/.exec(line);
    if (containment && ['containment-unavailable', 'time-limit', 'cpu-limit', 'memory-limit'].includes(containment[1]!)) codes.add(containment[1]!);
  }
  return [...codes];
}

export async function probeInstalledController(runtime: string, source = false): Promise<void> {
  if (process.platform !== 'win32') throw new Error('native-controller-probe-requires-windows');
  const profile = 'DataPass.Analysis.' + randomUUID().replaceAll('-', '');
  const env: Record<string, string> = {};
  for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  let root: string | undefined;
  if (source) {
    root = await mkdtemp(join(tmpdir(), 'datapass-native-launch-'));
    await writeFile(join(root, 'query.sql'), 'SELECT id FROM dbo.orders;');
  }
  const run = (mode: 'fixture' | 'analysis' | 'cleanup', input: Buffer) => new Promise<{ ok: boolean; codes: string[]; frameValid: boolean; stderrBytes: number }>(resolve => {
    const child = execFile(join(runtime, 'pythonw.exe'), ['-I', '-S', '-B', ...(source && mode === 'analysis' ? ['-c', SOURCE_DIAGNOSTIC] : []), join(runtime, 'datapass_controller.py'), mode, profile, '10000', '256',
      ...(mode === 'analysis' ? [root!, 'lpac-required'] : [])],
      { cwd: runtime, env, windowsHide: true, timeout: 25_000, maxBuffer: 8192, encoding: 'buffer' }, (error, stdout, stderr) => {
        let frameValid = mode === 'cleanup';
        const codes = controllerFailureCodes(stderr.toString('utf8'));
        if (!error && mode !== 'cleanup') try {
          const size = stdout.readUInt32LE(0), reply = JSON.parse(stdout.subarray(4).toString('utf8'));
          frameValid = size <= 8192 && size + 4 === stdout.length && (mode === 'fixture'
            ? reply.fixture === 'static-sql-v1' && reply.productionQualified === false
            : reply.containment === 'lpac' && reply.status === 'syntax-facts' && reply.facts?.length === 1);
          if (mode === 'analysis' && reply.status === 'unavailable') codes.push(REFUSALS.has(reply.code) ? reply.code : 'native-analysis-refused');
        } catch { frameValid = false; }
        resolve({ ok: !error, codes, frameValid, stderrBytes: stderr.length });
      });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
  const text = 'SELECT id FROM dbo.orders;';
  const bytes = Buffer.from(JSON.stringify(source ? { requestId: 'owned-source-diagnostic', generation: 1,
    requestDigest: { algorithm: 'sha256', mode: 'jcs-json', value: '0'.repeat(64) },
    captures: [{ artifactId: 'owned-query', text, integrityDigest: createHash('sha256').update(text).digest('hex'), language: 'sql', dialect: 'tsql' }] }
    : { fixture: 'static-sql-v1', requestId: 'installed-controller-qualification', generation: 1 }));
  const frame = Buffer.alloc(bytes.length + 4); frame.writeUInt32LE(bytes.length); bytes.copy(frame, 4);
  let outcome: Awaited<ReturnType<typeof run>> | undefined, cleanup: Awaited<ReturnType<typeof run>> | undefined;
  try { outcome = await run(source ? 'analysis' : 'fixture', frame); }
  finally {
    cleanup = await run('cleanup', Buffer.alloc(0));
    if (root) {
      if (!resolve(root).startsWith(join(resolve(tmpdir()), 'datapass-native-launch-'))) throw new Error('probe-cleanup-root-mismatch');
      await rm(root, { recursive: true, force: true });
    }
  }
  console.log('Native controller ' + (source ? 'owned-source' : 'fixture') + ': ' + JSON.stringify({ ...outcome, cleanupOk: cleanup.ok,
    cleanupCodes: cleanup.codes, systemProfile: /[\\/]systemprofile$/i.test(process.env.USERPROFILE ?? '') }));
  if (!outcome?.ok || !outcome.frameValid || !cleanup.ok) throw new Error('installed-native-controller-preflight-failed');
}
