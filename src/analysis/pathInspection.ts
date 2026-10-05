import type { NativePathInspector } from '@juliandatapass-group/analysis-host-node';

/** Coalesce simultaneous checks only. Each acquisition phase performs a fresh native check. */
export function coalescePathInspection(native: NativePathInspector): NativePathInspector {
  type Pending = { paths: readonly string[]; signal?: AbortSignal; resolve(): void; reject(error: unknown): void };
  let pending: Pending[] = [];
  let scheduled = false;
  return { assertNoReparsePoints(paths, signal) {
    return new Promise<void>((resolve, reject) => {
      pending.push({ paths: [...paths], signal, resolve, reject });
      if (scheduled) return;
      scheduled = true;
      setImmediate(() => {
        const requests = pending; pending = []; scheduled = false;
        const groups = new Map<AbortSignal | undefined, Pending[]>();
        for (const request of requests) {
          const group = groups.get(request.signal) ?? [];
          group.push(request); groups.set(request.signal, group);
        }
        for (const [signal, group] of groups) {
          const paths = [...new Set(group.flatMap(request => [...request.paths]))];
          native.assertNoReparsePoints(paths, signal).then(
            () => group.forEach(request => request.resolve()),
            error => group.forEach(request => request.reject(error)));
        }
      });
    });
  } };
}
