import { canonicalRepoPath, createPathArtifactId, digestExactBytes, digestJson, encodeUtf8, unwrap, validateSourceAnchor, type SourceAnchor } from '@juliandatapass-group/semantic-core';
import { ANALYSIS_LIMITS, validateAnalysisRequest, type AnalysisRequest, type CapturedSource } from '@juliandatapass-group/analysis-protocol';

/** Window-local identity; a workspace does not need a bridge to analyze selected native files. */
export type SessionIdentity = { readonly kind: 'bridge' | 'workspace-local'; readonly id: string };
export function sessionIdentity(rootUri: string, bridgeId?: string): SessionIdentity {
  return { kind: bridgeId ? 'bridge' : 'workspace-local', id: `datapass:session:${unwrap(digestJson({ rootUri, bridgeId: bridgeId ?? null })).value}` };
}
export interface SelectedCapture {
  readonly path: string;
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly source: 'editor' | 'disk';
}
/** The host has already checked filesystem containment. Never normalizes captured content. */
export function selectedCapture(identity: SessionIdentity, path: string, input: Uint8Array | string): SelectedCapture {
  if (unwrap(canonicalRepoPath(path)) !== path) throw new Error('noncanonical-path');
  if (typeof input !== 'string' && input.length > ANALYSIS_LIMITS.fileBytes) throw new Error('file-limit');
  const bytes = typeof input === 'string' ? unwrap(encodeUtf8(input, ANALYSIS_LIMITS.fileBytes)) : input.slice();
  // ignoreBOM=true means preserve the BOM as a character, rather than silently strip its bytes.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const artifactId = unwrap(createPathArtifactId({ repoKey: identity.id, path, producerId: 'datapass.native/1' })).id;
  return { path, artifactId, bytes, text, source: typeof input === 'string' ? 'editor' : 'disk' };
}
export function selectedRequest(identity: SessionIdentity, capture: SelectedCapture, producer: AnalysisRequest['header']['producer'], dialect: string, generation: number, ruleCatalogDigest: AnalysisRequest['header']['ruleCatalogDigest']): { request: AnalysisRequest; captures: readonly CapturedSource[] } {
  const options = { dialect, resolutionPolicy: 'syntax-only' as const };
  const integrityDigest = unwrap(digestExactBytes(capture.bytes));
  const snapshotId = `datapass:snapshot:${unwrap(digestJson({ session: identity.id, generation, integrityDigest })).value}`;
  const request = unwrap(validateAnalysisRequest({
    schema: 'datapass.analysis-wire/1', kind: 'request', requestId: snapshotId, generation,
    header: { schemaVersion: 'datapass.analysis-wire/1', engineVersion: 'datapass-native/1', producer,
      configDigest: unwrap(digestJson(options)), ruleCatalogDigest, supportedManifestVersion: 'datapass.snapshot-manifest/1', snapshotId,
      sourceDigests: [{ artifactId: capture.artifactId, integrityDigest, semanticDigest: null }], dependencyDigests: [] },
    snapshotManifest: [{ artifactId: capture.artifactId, path: capture.path, kind: 'file', byteLength: capture.bytes.length, integrityDigest, semanticDigest: null }],
    options, limits: ANALYSIS_LIMITS
  }));
  return { request, captures: [{ artifactId: capture.artifactId, text: capture.text, notebookProjection: null }] };
}
/** Convert a validated exact byte anchor to VS Code's UTF-16 document offsets. */
export function editorOffsets(anchor: SourceAnchor, capture: SelectedCapture, editorText = capture.text): { start: number; end: number } {
  if (anchor.artifactId !== capture.artifactId) throw new Error('wrong-artifact');
  unwrap(validateSourceAnchor(anchor, capture.bytes));
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const bomOffset = capture.text.startsWith('\uFEFF') && editorText === capture.text.slice(1) ? 1 : 0;
  if (editorText !== capture.text && !bomOffset) throw new Error('stale-editor');
  return { start: Math.max(0, decoder.decode(capture.bytes.subarray(0, anchor.span.start)).length - bomOffset), end: Math.max(0, decoder.decode(capture.bytes.subarray(0, anchor.span.end)).length - bomOffset) };
}
