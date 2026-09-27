/**
 * V3-HOP1: step ↔ line helpers for the two-way sync of DataPass Hop (V3-HOP2 uses them): the code's
 * cursor selects a step, a step selects its lines. Pure functions over a validated document.
 */
import type { UnderstandingDoc, UnderstandingStep } from "./contract";

/** Every step whose lines hold `line` (1-based), most specific (shortest range) first, then in file order. */
export function stepsForLine(doc: Pick<UnderstandingDoc, "steps">, line: number): UnderstandingStep[] {
  if (!Number.isInteger(line) || line < 1) return [];
  return doc.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.lines[0] <= line && line <= s.lines[1])
    .sort((a, b) => (a.s.lines[1] - a.s.lines[0]) - (b.s.lines[1] - b.s.lines[0]) || a.i - b.i)
    .map(({ s }) => s);
}

/** The step a line belongs to: the most specific one holding it, or undefined between steps. */
export function stepForLine(doc: Pick<UnderstandingDoc, "steps">, line: number): UnderstandingStep | undefined {
  return stepsForLine(doc, line)[0];
}

/**
 * The step to show for a line, also between steps: the one holding it, else the step that ended
 * last before it (scrolling past a step keeps it selected), else the first step.
 */
export function nearestStepForLine(doc: Pick<UnderstandingDoc, "steps">, line: number): UnderstandingStep | undefined {
  const exact = stepForLine(doc, line);
  if (exact) return exact;
  let best: UnderstandingStep | undefined;
  for (const s of doc.steps) if (s.lines[1] < line && (!best || s.lines[1] > best.lines[1])) best = s;
  return best ?? [...doc.steps].sort((a, b) => a.lines[0] - b.lines[0])[0];
}

/** The 1-based inclusive line range of a step, or undefined for an unknown id. */
export function linesForStep(doc: Pick<UnderstandingDoc, "steps">, stepId: string): [number, number] | undefined {
  const s = doc.steps.find(x => x.id === stepId);
  return s ? [s.lines[0], s.lines[1]] : undefined;
}

/** Steps in reading order (by first line, then declaration), as the vertical view lists them. */
export function stepsInLineOrder(doc: Pick<UnderstandingDoc, "steps">): UnderstandingStep[] {
  return doc.steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.lines[0] - b.s.lines[0] || a.i - b.i).map(({ s }) => s);
}
