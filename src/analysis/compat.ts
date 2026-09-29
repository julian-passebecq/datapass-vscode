import { projectV3Bundle, type V3Projection } from '@juliandatapass-group/compat-v3';
import type { UnderstandingDiagnostic, UnderstandingDoc } from '../core/understanding/contract';
import type { UnderstandingEntry } from '../core/understanding/load';

/** Product boundary around the pinned Common V3 reader; source acquisition remains host-owned. */
export function readLegacyUnderstanding(raw: Uint8Array, native?: { repository: string; path: string; bytes: Uint8Array }): {
  doc?: UnderstandingDoc; diagnostics: UnderstandingDiagnostic[]; projection: V3Projection;
} {
  const projection = projectV3Bundle({ understanding: [raw], ...(native ? { nativeSnapshots: [native] } : {}) });
  const document = projection.documents[0];
  const diagnostics: UnderstandingDiagnostic[] = projection.diagnostics.map(d => ({
    severity: d.severity,
    // The existing V3 consumer reported an unsupported understanding version as a schema error.
    code: (d.code === 'unsupported-version' ? 'schema' : d.code) as UnderstandingDiagnostic['code'],
    message: d.message, ...(d.path ? { path: d.path } : {})
  }));
  return { ...(document?.accepted && document.value ? { doc: document.value as unknown as UnderstandingDoc } : {}), diagnostics, projection };
}

/** Rebind the sidecar to an unsaved editor capture without altering cached disk entries. */
export function rebindLegacyEditor(entry: UnderstandingEntry, text: string): UnderstandingEntry {
  const original = entry.compatibility?.documents[0]?.originalBytes;
  if (!entry.doc || !original || entry.state === 'invalid') return entry;
  const oversized = Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024;
  const projection = readLegacyUnderstanding(original, oversized ? undefined : { repository: entry.doc.target.repository, path: entry.doc.target.path, bytes: Buffer.from(text, 'utf8') }).projection;
  const stale = oversized || projection.anchors.some(a => a.resolution.reason !== 'resolved');
  return { ...entry, compatibility: projection, state: stale ? 'stale' : 'ok' };
}
