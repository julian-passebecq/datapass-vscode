/** Installed, built-in fixture only: expose bounded Windows launch diagnostics, never client source or raw stderr. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const FIXED = new Set(['appcontainer-profile-failed', 'worker-not-ready', 'worker-exit-failed', 'worker-timeout',
  'runtime-acl-cleanup', 'profile-cleanup', 'registry-canary-cleanup', 'runtime-reparse-point', 'canary-key-exists',
  'canary-control-failed', 'controller-arguments', 'controller-mode', 'controller-root', 'controller-containment',
  'controller-limits', 'unsupported-reparse-point', 'unsupported-root', 'unsupported-filesystem', 'root-enumeration-limit']);
export function controllerFailureCodes(stderr: string): string[] {
  const codes = new Set<string>();
  for (const line of stderr.split(/\r?\n/)) {
    for (const [call, phase] of [['ok(assign_job(job,pi.process))', 'assign-job'], ['ok(create_process(', 'create-worker'],
      ["set_runtime_access(sid,True)", 'runtime-acl'], ['hr=create_profile(', 'create-profile']] as const) {
      if (line.trim().startsWith(call)) codes.add(`phase-${phase}`);
    }
    const win = /\[WinError (\d{1,10})\]/.exec(line);
    if (win) codes.add(`win32-${win[1]}`);
    const exception = /^(?:RuntimeError|OSError|ValueError): ([a-z,-]+)$/.exec(line);
    for (const code of exception?.[1]?.split(',') ?? []) if (FIXED.has(code)) codes.add(code);
    const containment = /^datapass-containment:([a-z-]+)$/.exec(line);
    if (containment && ['containment-unavailable', 'time-limit', 'cpu-limit', 'memory-limit'].includes(containment[1]!)) codes.add(containment[1]!);
  }
  return [...codes];
}

export async function probeInstalledController(runtime: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('native-controller-probe-requires-windows');
  const profile = 'DataPass.Analysis.' + randomUUID().replaceAll('-', '');
  const env: Record<string, string> = {};
  for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  const run = (mode: 'fixture' | 'cleanup', input: Buffer) => new Promise<{ ok: boolean; codes: string[]; frameValid: boolean }>(resolve => {
    const child = execFile(join(runtime, 'pythonw.exe'), ['-I', '-S', '-B', join(runtime, 'datapass_controller.py'), mode, profile, '10000', '256'],
      { cwd: runtime, env, windowsHide: true, timeout: 25_000, maxBuffer: 8192, encoding: 'buffer' }, (error, stdout, stderr) => {
        let frameValid = mode === 'cleanup';
        if (!error && mode === 'fixture') try {
          const size = stdout.readUInt32LE(0), reply = JSON.parse(stdout.subarray(4).toString('utf8'));
          frameValid = size <= 4096 && size + 4 === stdout.length && reply.fixture === 'static-sql-v1' && reply.productionQualified === false;
        } catch { frameValid = false; }
        resolve({ ok: !error, codes: controllerFailureCodes(stderr.toString('utf8')), frameValid });
      });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
  const bytes = Buffer.from(JSON.stringify({ fixture: 'static-sql-v1', requestId: 'installed-controller-qualification', generation: 1 }));
  const frame = Buffer.alloc(bytes.length + 4); frame.writeUInt32LE(bytes.length); bytes.copy(frame, 4);
  let outcome: Awaited<ReturnType<typeof run>> | undefined, cleanup: Awaited<ReturnType<typeof run>> | undefined;
  try { outcome = await run('fixture', frame); }
  finally { cleanup = await run('cleanup', Buffer.alloc(0)); }
  console.log('Native controller fixture: ' + JSON.stringify({ ...outcome, cleanupOk: cleanup.ok,
    cleanupCodes: cleanup.codes, systemProfile: /[\\/]systemprofile$/i.test(process.env.USERPROFILE ?? '') }));
  if (!outcome?.ok || !outcome.frameValid || !cleanup.ok) throw new Error('installed-native-controller-preflight-failed');
}
