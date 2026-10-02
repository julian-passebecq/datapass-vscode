/**
 * V4-NAV NAVTOUR1 'Jump to a box': fuzzy search over every ladder Location by label and kind.
 * Subsequence match, scored: exact > prefix > word start > contiguous > scattered; shorter labels
 * win ties. Pure (no `vscode`).
 */
import type { NavLocation } from "../navTypes";

export interface JumpEntry { readonly location: NavLocation; readonly label: string }
export interface JumpHit extends JumpEntry { readonly score: number }

/** Score `query` against `text` (lower-cased); -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase(), t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return (at === 0 || /[\s._/:-]/.test(t[at - 1] ?? "") ? 600 : 400) - at - t.length / 10;
  let score = 200, ti = 0, prev = -2;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    score -= i === prev + 1 ? 0 : Math.min(10, i - ti + 1);
    prev = i; ti = i + 1;
  }
  return Math.max(1, score - t.length / 10);
}

/** Best matches, label first, kind/level as a weaker second field. */
export function jumpSearch(entries: readonly JumpEntry[], query: string, limit = 50): JumpHit[] {
  if (!query.trim()) return entries.slice(0, limit).map((e) => ({ ...e, score: 0 }));
  const hits: JumpHit[] = [];
  for (const e of entries) {
    const byLabel = fuzzyScore(query, e.label);
    const byKind = fuzzyScore(query, `${e.location.artifactKind} ${e.location.level}`);
    const score = Math.max(byLabel, byKind >= 0 ? byKind / 2 : -1);
    if (score >= 0) hits.push({ ...e, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
}
