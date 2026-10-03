/**
 * V5HOLE12 (PM ruling): the PEDA2 built-in tours read every Hop file, so they are built lazily — only when the
 * Navigator's Tours section is expanded or a guided mode is picked — and cached under a fingerprint of the Hop
 * files (path, size, mtime). A session change while Tours is collapsed does nothing; while expanded it rebuilds only
 * when the fingerprint changed. Builds run one at a time. Pure (no `vscode`).
 */
export interface LazyBuiltinsDeps<T> {
  /** Cheap key of the Hop files (no file is loaded). */
  fingerprint(): Promise<string>;
  /** The heavy build (loads the Hop files). */
  build(): Promise<T>;
  /** Is the Tours section expanded now? */
  expanded(): boolean;
}

export class LazyBuiltins<T> {
  private cache: { readonly key: string; readonly value: T } | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: LazyBuiltinsDeps<T>) {}

  /** The last built value (undefined until a first expand or mode pick). */
  get value(): T | undefined { return this.cache?.value; }

  /** Session changed: nothing while Tours is collapsed; else `ensure`. True when the value was rebuilt. */
  onSessionChange(): Promise<boolean> { return this.deps.expanded() ? this.ensure() : Promise.resolve(false); }

  /** Tours expanded or a mode picked: build when there is no value or the Hop files changed. True when rebuilt. */
  ensure(): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      const key = await this.deps.fingerprint();
      if (this.cache?.key === key) return false;
      this.cache = { key, value: await this.deps.build() };
      return true;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
