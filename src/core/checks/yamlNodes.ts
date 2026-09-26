/** Small helpers over `yaml` nodes: lookups by key and node positions for findings. */
import { isMap, isPair, isScalar, isSeq, type LineCounter, type Node, type Pair, type YAMLMap } from "yaml";

export type At = { line: number; col: number; endLine: number; endCol: number };

export function at(node: unknown, lines: LineCounter): At | undefined {
  const r = (node as Node | null | undefined)?.range;
  if (!r) return undefined;
  const a = lines.linePos(r[0]), b = lines.linePos(Math.max(r[1], r[0] + 1));
  return { line: a.line - 1, col: a.col - 1, endLine: b.line - 1, endCol: b.col - 1 };
}

export const keyOf = (p: Pair) => (isScalar(p.key) ? String(p.key.value) : undefined);

export function pairOf(map: unknown, key: string): Pair | undefined {
  if (!isMap(map)) return undefined;
  return (map as YAMLMap).items.find(p => keyOf(p) === key);
}

export const valueOf = (map: unknown, key: string): unknown => pairOf(map, key)?.value;

export const str = (node: unknown): string | undefined => (isScalar(node) && typeof node.value === "string" ? node.value : undefined);

/** Every pair in the tree, with its ancestors' keys (nearest last). */
export function* pairs(node: unknown, path: string[] = []): Generator<{ pair: Pair; path: string[] }> {
  if (isMap(node)) for (const p of node.items) {
    yield { pair: p, path };
    yield* pairs(p.value, [...path, keyOf(p) ?? ""]);
  } else if (isSeq(node)) for (const item of node.items) yield* pairs(item, path);
  else if (isPair(node)) yield* pairs(node.value, path);
}

/** Every string scalar in the tree. */
export function* strings(node: unknown): Generator<{ value: string; node: Node }> {
  if (isScalar(node)) { if (typeof node.value === "string") yield { value: node.value, node }; }
  else if (isMap(node)) for (const p of node.items) { yield* strings(p.key); yield* strings(p.value); }
  else if (isSeq(node)) for (const item of node.items) yield* strings(item);
}

export { isMap, isScalar, isSeq };
