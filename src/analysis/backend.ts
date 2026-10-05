import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { acquireSnapshots, createWindowsPathInspector, StaticSyntaxHost } from '@juliandatapass-group/analysis-host-node';
import { createSqlAnalyzerPlugin, SQL_NO_RULE_EVALUATION_DIGEST } from '@juliandatapass-group/analyzers/sql';
import { digestJson, unwrap } from '@juliandatapass-group/semantic-core';
import runtimePin from '../../vendor/runtime/pin.json';
import type { NativeAnalysisBackend } from './native';
import { parserIssueCode } from './parserIssue';

/** Called only after an explicit selected-file action in a trusted local workspace. */
export async function createNativeBackend(extensionPath: string, selectedRoot: string): Promise<NativeAnalysisBackend> {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !['24.20.0', '26.9.0'].includes(process.versions.node)) throw new Error('host-runtime-unqualified');
  const systemRoot = process.env.SystemRoot ?? '';
  const inspector = createWindowsPathInspector(systemRoot);
  const manifestPath = join(extensionPath, 'dist/runtime-manifest.json');
  await inspector.assertNoReparsePoints([manifestPath]);
  if ((await lstat(manifestPath)).size > 1024 * 1024) throw new Error('runtime-manifest-limit');
  const manifestBytes = await readFile(manifestPath);
  if (createHash('sha256').update(manifestBytes).digest('hex') !== runtimePin.manifestSha256) throw new Error('runtime-manifest-integrity');
  const host = new StaticSyntaxHost({ selectedRoot, securityPolicy: 'local-static-parser-v1', systemRoot,
    runtimeDirectory: join(extensionPath, 'dist/runtime'), manifestBytes, expectedManifestSha256: runtimePin.manifestSha256,
    cachePolicy: { cacheRoot: join(extensionPath, 'dist'), nativePathInspector: inspector } });
  const issues = new Set<string>();
  const observe = (task: ReturnType<typeof host.start>) => ({ ...task, facts: task.facts.then(value => {
    if (!Array.isArray(value) && value && typeof value === 'object' && 'code' in value) issues.add(parserIssueCode(value));
    return value;
  }, error => { issues.add(parserIssueCode(error)); throw error; }) });
  const provider = { start: (request: Parameters<typeof host.start>[0], captures: Parameters<typeof host.start>[1]) => observe(host.start(request, captures)) };
  const plugin = createSqlAnalyzerPlugin({ parserLockDigest: unwrap(digestJson({ hostVersion: '0.1.0-alpha.7', runtimeManifestSha256: runtimePin.manifestSha256, parser: 'sqlglot', parserVersion: '30.19.0' })), provider });
  const python: NativeAnalysisBackend['python'] = { provider,
    parserLockDigest: unwrap(digestJson({ hostVersion: '0.1.0-alpha.7', runtimeManifestSha256: runtimePin.manifestSha256, parser: 'cpython-ast', parserVersion: '3.13.15' })) };
  const capturedProvider = { start: (request: Parameters<typeof host.startCaptured>[0], captures: Parameters<typeof host.startCaptured>[1]) => observe(host.startCaptured(request, captures)) };
  return {
    plugin, ruleCatalogDigest: SQL_NO_RULE_EVALUATION_DIGEST, python, issues: () => [...issues],
    captured: { plugin: createSqlAnalyzerPlugin({ parserLockDigest: plugin.parserLockDigest, provider: capturedProvider }),
      python: { parserLockDigest: python.parserLockDigest, provider: capturedProvider } },
    async acquire(root, path, signal) {
      if (root !== selectedRoot) throw new Error('selected-root-mismatch');
      const captures = await acquireSnapshots({ root, nativePathInspector: inspector }, [path], signal);
      if (captures.length !== 1) throw new Error('missing-capture');
      return captures[0]!.bytes;
    },
    dispose: () => host.dispose()
  };
}
