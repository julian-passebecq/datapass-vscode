/**
 * V1-FRESH (GPT T3, findings A03/A04): the guard rails around the progressive refresh and the
 * selected context. Pure: no VS Code, no I/O, so the race cases are unit-tested.
 *
 * - RefreshTracker: every refresh has a generation, a project and a phase; an older generation can
 *   never publish over a newer one; a rejected refresh leaves a visible "failed" state (with retry)
 *   instead of the previous success; enrichment steps that time out or fail are listed as incomplete.
 * - settleWithin: one enrichment step bounded in time; its failure or timeout keeps a fallback value
 *   and is recorded, it never rejects the whole refresh.
 * - contextChange: what a pack or an order was built from (project, variant,
 *   environment, manifest and options digests), re-checked just before it is copied or written.
 */

export type RefreshPhase = "idle" | "loading" | "first-paint" | "settled" | "failed";

export interface IncompleteStep {
  step: string;
  why: "timed out" | "failed";
  detail?: string;
}

export interface RefreshStatus {
  generation: number;
  phase: RefreshPhase;
  /** The project root (URI string) the refresh read; undefined before the root is known or without one. */
  project?: string;
  startedAt?: string;
  /** When the project, architecture and tree were published (first paint). */
  firstPaintAt?: string;
  /** When tools, readiness and inventory were published: the time the whole state was observed. */
  settledAt?: string;
  incomplete: IncompleteStep[];
  /** Why the last refresh failed (phase "failed"). */
  error?: string;
}

export interface RefreshToken { readonly generation: number }

/** Refresh generations and their published phases. The session owns one; tests drive it directly. */
export class RefreshTracker {
  private gen = 0;
  private st: RefreshStatus = { generation: 0, phase: "idle", incomplete: [] };

  constructor(private readonly clock: () => Date = () => new Date()) {}

  /** A new refresh: every older one is superseded from now on. */
  begin(): RefreshToken {
    const generation = ++this.gen;
    // The previous published times stay until this refresh publishes its own: the views keep showing
    // when the state they display was observed, marked as refreshing.
    this.st = { ...this.st, generation, phase: "loading", startedAt: this.clock().toISOString(), incomplete: [], error: undefined };
    return { generation };
  }

  isCurrent(t: RefreshToken): boolean { return t.generation === this.gen; }

  /** The generation of the newest refresh begun. */
  get generation(): number { return this.gen; }

  /**
   * Publish a phase for `t`. Returns false (and changes nothing) when a newer refresh began: the
   * caller must then drop what it computed rather than write it.
   */
  publish(t: RefreshToken, phase: "first-paint" | "settled", info: { project?: string; incomplete?: IncompleteStep[] } = {}): boolean {
    if (!this.isCurrent(t)) return false;
    const at = this.clock().toISOString();
    this.st = phase === "first-paint"
      ? { ...this.st, phase, project: info.project, firstPaintAt: at, settledAt: undefined, incomplete: [] }
      : { ...this.st, phase, project: info.project ?? this.st.project, settledAt: at, incomplete: (info.incomplete ?? []).slice(0, 20) };
    return true;
  }

  /** A refresh rejected. Only the newest one's failure is shown; an older one's is ignored. */
  fail(t: RefreshToken, error: unknown): boolean {
    if (!this.isCurrent(t)) return false;
    const message = error instanceof Error ? error.message : String(error);
    this.st = { ...this.st, phase: "failed", error: message.slice(0, 300) || "unknown error" };
    return true;
  }

  status(): RefreshStatus { return { ...this.st, incomplete: [...this.st.incomplete] }; }
}

/**
 * Bound one enrichment step: its value, or `fallback` when it rejects or runs past `ms`. The
 * outcome is appended to `incomplete` so the views can say what is missing instead of pretending.
 * The late result of a timed-out step is dropped (V1 does not cancel work already in flight).
 */
export function settleWithin<T>(step: string, p: Promise<T>, ms: number, fallback: T, incomplete: IncompleteStep[]): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      incomplete.push({ step, why: "timed out", detail: `no answer within ${Math.round(ms / 1000)} s` });
      resolve(fallback);
    }, ms);
    p.then(v => { if (done) return; done = true; clearTimeout(timer); resolve(v); },
      e => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        incomplete.push({ step, why: "failed", detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
        resolve(fallback);
      });
  });
}

/** One line for a tooltip or a pill: what the views show now and how fresh it is. */
export function refreshLabel(s: RefreshStatus, now: Date = new Date()): { text: string; tone: "ok" | "info" | "warn" | "bad"; detail: string } {
  const ago = (iso: string | undefined) => {
    if (!iso) return "never";
    const sec = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
    return sec < 60 ? "just now" : sec < 3600 ? `${Math.round(sec / 60)} min ago` : `${Math.round(sec / 3600)} h ago`;
  };
  const inc = s.incomplete.map(i => `${i.step} ${i.why}${i.detail ? ` (${i.detail})` : ""}`).join("; ");
  switch (s.phase) {
    case "idle": return { text: "not inspected yet", tone: "info", detail: "DataPass has not read this project yet." };
    case "loading": return { text: "refreshing…", tone: "info", detail: s.settledAt ? `Showing the state observed ${ago(s.settledAt)} while DataPass reads the project again.` : "Reading the project." };
    case "first-paint": return { text: "refreshing: tools and readiness pending", tone: "info", detail: "The project, architecture and tree are current; tool probes, readiness and the inventory are still being read (pending, not missing)." };
    case "failed": return { text: "refresh failed", tone: "bad", detail: `The last refresh failed: ${s.error ?? "unknown error"}. What is shown was observed ${ago(s.settledAt ?? s.firstPaintAt)}. Re-inspect to retry.` };
    case "settled": return inc
      ? { text: `inspected ${ago(s.settledAt)}, incomplete`, tone: "warn", detail: `Observed ${s.settledAt}. Incomplete: ${inc}. Those rows are unknown, not verified; re-inspect to retry.` }
      : { text: `inspected ${ago(s.settledAt)}`, tone: "ok", detail: `Observed ${s.settledAt}.` };
  }
}

export interface ContextIdentityInput {
  project?: string;
  variantKey: string;
  environment?: string;
  manifestDigest?: string;
  optionsDigest?: string;
}

/**
 * Why the context changed between `before` (when building started) and `after` (just before the
 * copy or the write); undefined when it is the same. Background refreshes that change nothing the
 * pack depends on do not count.
 */
export function contextChange(before: ContextIdentityInput, after: ContextIdentityInput): string | undefined {
  if ((before.project ?? "") !== (after.project ?? "")) return "another project was opened";
  if (before.variantKey !== after.variantKey) return "the selected variant changed";
  if ((before.environment ?? "") !== (after.environment ?? "")) return "the environment changed";
  if ((before.manifestDigest ?? "") !== (after.manifestDigest ?? "")) return "project.json changed";
  if ((before.optionsDigest ?? "") !== (after.optionsDigest ?? "")) return "options.json changed";
  return undefined;
}
