/**
 * Facet-based selective invalidation.
 *
 * A change is classified into facets via JSON-pointer prefixes declared by a domain pack.
 * Anything that changed outside every declared prefix becomes the `unknown` facet, which
 * invalidates every consumer of that input: unknown is never assumed independent.
 */
import { isPlainObject } from "../model/strictJson";

export const UNKNOWN_FACET = "unknown";

export interface FacetDeclaration {
  id: string;
  pointers: string[];
}

export function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Leaf-level JSON pointers where before and after differ (added, removed or changed). */
export function changedPointers(before: unknown, after: unknown, at = ""): string[] {
  if (before === after) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: string[] = [];
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) out.push(...changedPointers(before[i], after[i], `${at}/${i}`));
    return out;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const out: string[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of [...keys].sort()) out.push(...changedPointers(before[k], after[k], `${at}/${escapePointer(k)}`));
    return out;
  }
  // Type change, scalar change, or add/remove of a whole subtree.
  return [at || "/"];
}

export function pointerHasPrefix(pointer: string, prefix: string): boolean {
  if (prefix === "" || prefix === "/") return true;
  return pointer === prefix || pointer.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
}

export interface FacetChange {
  facets: string[];
  unmapped: string[];
  byFacet: Record<string, string[]>;
}

export function classifyChange(before: unknown, after: unknown, facets: FacetDeclaration[]): FacetChange {
  const byFacet: Record<string, string[]> = {};
  const unmapped: string[] = [];
  for (const pointer of changedPointers(before, after)) {
    const hits = facets.filter(f => f.pointers.some(p => pointerHasPrefix(pointer, p)));
    if (!hits.length) { unmapped.push(pointer); continue; }
    for (const f of hits) (byFacet[f.id] ??= []).push(pointer);
  }
  if (unmapped.length) byFacet[UNKNOWN_FACET] = unmapped;
  return { facets: Object.keys(byFacet).sort(), unmapped, byFacet };
}

// ---------------------------------------------------------------------------

export interface DependencyDeclaration {
  ref: string;
  /** Facets of `ref` this output consumes. "*" = everything (also the default when undeclared). */
  facets: string[] | "*";
}

export interface DerivedOutput {
  id: string;
  label: string;
  /** undefined = the producer never declared its inputs. */
  dependsOn?: DependencyDeclaration[];
  /** Revision of inputs the output was produced from; kept so history stays truthful. */
  producedFrom?: Record<string, string>;
}

export type ImpactState = "current" | "stale" | "stale-upstream" | "dependencies-undeclared";

export interface ImpactEntry {
  outputId: string;
  label: string;
  state: ImpactState;
  reasons: string[];
  /** The output remains a valid historical result of these inputs. */
  retainedAsHistoryOf?: Record<string, string>;
}

/**
 * @param changes  ref -> changed facets for that ref (use classifyChange). A ref mapped to
 *                 an empty list is treated as unchanged.
 */
export function analyzeImpact(outputs: DerivedOutput[], changes: ReadonlyMap<string, readonly string[]>): ImpactEntry[] {
  const byId = new Map(outputs.map(o => [o.id, o]));
  const result = new Map<string, ImpactEntry>();
  const effective = new Map<string, readonly string[]>([...changes].filter(([, f]) => f.length > 0));

  const direct = (o: DerivedOutput): string[] => {
    const reasons: string[] = [];
    for (const dep of o.dependsOn ?? []) {
      const changed = effective.get(dep.ref);
      if (!changed) continue;
      if (dep.facets === "*") reasons.push(`${dep.ref} changed (${changed.join(", ")}) and this output consumes all of it`);
      else if (changed.includes(UNKNOWN_FACET)) reasons.push(`${dep.ref} changed outside any declared facet; unknown changes invalidate conservatively`);
      else {
        const hit = dep.facets.filter(f => changed.includes(f));
        if (hit.length) reasons.push(`${dep.ref}: ${hit.join(", ")} changed`);
      }
    }
    return reasons;
  };

  // Fixed point over the output graph (outputs can consume outputs). Cycles terminate
  // because states only move from current to stale.
  let changedSomething = true;
  for (const o of outputs) {
    if (o.dependsOn === undefined) {
      result.set(o.id, { outputId: o.id, label: o.label, state: "dependencies-undeclared", reasons: ["Inputs were never declared; cannot prove this output is unaffected."] });
    } else {
      const reasons = direct(o);
      result.set(o.id, { outputId: o.id, label: o.label, state: reasons.length ? "stale" : "current", reasons });
    }
  }
  while (changedSomething) {
    changedSomething = false;
    for (const o of outputs) {
      const entry = result.get(o.id)!;
      if (entry.state !== "current") continue;
      const upstream = (o.dependsOn ?? []).filter(d => {
        const up = result.get(d.ref);
        return byId.has(d.ref) && up && up.state !== "current";
      });
      if (upstream.length) {
        entry.state = "stale-upstream";
        entry.reasons = upstream.map(d => `depends on ${d.ref}, which is ${result.get(d.ref)!.state}`);
        changedSomething = true;
      }
    }
  }
  for (const o of outputs) {
    const e = result.get(o.id)!;
    if (e.state !== "current" && o.producedFrom) e.retainedAsHistoryOf = o.producedFrom;
  }
  return outputs.map(o => result.get(o.id)!);
}
