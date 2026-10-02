/**
 * V4-NAV binding providers registry: a view's `bindings[].source` → the provider that fills it.
 * One `*.binding.ts` file per provider (default export), collected into out/gen/bindings.ts by
 * scripts/gen-registry.mjs (NAVWIRE1): no line to add here. A provider
 * never guesses: what it cannot answer is a hole with a reason, and every value carries its § 34
 * origin. Pure (no `vscode`).
 */
import type { ProjectMap } from "../../project/projectMap";
import type { NavLocation, ViewDef } from "../navTypes";
import type { GraphView } from "@juliandatapass-group/view-spi";
import { BINDINGS } from "../../../../out/gen/bindings";

/** § 34 origins (open vocabulary: Common may add more). */
export type BindingOrigin = "static" | "theoretical" | "ai-proposed" | "observed" | "datapass-guidance" | (string & {});

export interface BindingRow { readonly id: string; readonly label: string; readonly origin: BindingOrigin; readonly [column: string]: unknown }
export interface BindingCard { readonly title: string; readonly fields: readonly { readonly label: string; readonly value: string; readonly origin: BindingOrigin }[] }
export interface BindingMetric { readonly id: string; readonly label: string; readonly value: number | string; readonly unit?: string; readonly origin: BindingOrigin }
export interface BindingGraph {
  /** `kind`: a view-spi node kind when known (dataset, task, job…). */
  readonly nodes: readonly { readonly id: string; readonly label: string; readonly origin: BindingOrigin; readonly kind?: string }[];
  readonly edges: readonly { readonly source: string; readonly target: string; readonly label?: string; readonly origin: BindingOrigin }[];
}
export interface BindingResult {
  readonly rows?: readonly BindingRow[];
  /** A raw graph (the host turns it into a view-spi graph view, bindings/graphView.ts) or an already projected one. */
  readonly graph?: BindingGraph | GraphView;
  readonly cards?: readonly BindingCard[];
  readonly metrics?: readonly BindingMetric[];
  /** `code-steps` payload (a `CodeStepsInput`); the host adds the PQSAMP1 samples before sending. */
  readonly steps?: unknown;
  /** `kind` types the hole (no-project, out-of-scope, not-declared, binding-unavailable, binding-failed…); the host labels it. */
  readonly holes: readonly { readonly reason: string; readonly kind?: string }[];
  readonly origin: BindingOrigin;
}

export interface BindingContext {
  readonly location: NavLocation;
  readonly params?: Readonly<Record<string, unknown>>;
  /** The current project map, when a project is open. */
  readonly projectMap?: ProjectMap;
}

export interface BindingProvider { readonly source: string; provide(ctx: BindingContext): BindingResult }

const PROVIDERS: readonly BindingProvider[] = BINDINGS;

/**
 * Catalog sources with no standalone provider yet (NAVDATA1): each renders as a typed `binding-unavailable` hole.
 * A provider package removes its source from this list; `tests/navData.test.ts` keeps it exact.
 */
export const UNPROVIDED_SOURCES: readonly string[] = [
  "volumetry", "spark-perf", "sql-shape", "git-history", "hop-steps", "rationale", "fabric-item", "execution-unit"
];

const BY_SOURCE = new Map(PROVIDERS.map(p => [p.source, p]));

export function bindingProvider(source: string): BindingProvider | undefined {
  return BY_SOURCE.get(source);
}

export function bindingSources(): string[] {
  return [...BY_SOURCE.keys()];
}

export interface BoundData { readonly source: string; readonly result: BindingResult }

/** Fill every binding of a view; an unknown source or a failing provider is a hole, never a guess. */
export function resolveBindings(view: ViewDef, ctx: Omit<BindingContext, "params">): BoundData[] {
  return view.bindings.map(b => {
    const provider = BY_SOURCE.get(b.source);
    if (!provider) return { source: b.source, result: { holes: [{ reason: `No provider for "${b.source}" yet.`, kind: "binding-unavailable" }], origin: "static" } };
    try {
      return { source: b.source, result: provider.provide({ ...ctx, params: b.params }) };
    } catch (e) {
      return { source: b.source, result: { holes: [{ reason: `"${b.source}" failed: ${e instanceof Error ? e.message : String(e)}`, kind: "binding-failed" }], origin: "static" } };
    }
  });
}
