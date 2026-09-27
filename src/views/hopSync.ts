/**
 * V3-HOP2: the two-way sync of DataPass Hop, as pure functions (no `vscode`), so the mapping and the
 * webview message check are unit-tested without a host.
 *
 *   code → visual   the cursor line selects the step holding it (most specific first); the editor's
 *                   top visible line selects the step shown there, also between steps.
 *   visual → code   a step selects its lines, clamped to the file as it is now (a stale explanation
 *                   may point past the end: nothing is revealed for a step wholly beyond the file).
 *
 * Webview messages are untrusted: only the known types, and only step ids of the document shown.
 */
import { nearestStepForLine, stepForLine, stepsInLineOrder } from "../core/understanding/lines";
import type { UnderstandingDoc, UnderstandingStep } from "../core/understanding/contract";

type Steps = Pick<UnderstandingDoc, "steps">;

/** The step for the editor's cursor line (1-based): the one holding it, or none between steps. */
export function stepForCursor(doc: Steps, line: number): string | undefined {
  return stepForLine(doc, line)?.id;
}

/** The step for the editor's first visible line (1-based): the one holding it, else the last one passed. */
export function stepForTopLine(doc: Steps, line: number): string | undefined {
  return nearestStepForLine(doc, line)?.id;
}

/**
 * The 1-based inclusive lines to reveal and highlight for a step, clamped to the file's current
 * length; undefined for an unknown step or one that starts beyond the file.
 */
export function stepRange(doc: Steps, stepId: string, lineCount: number | undefined): [number, number] | undefined {
  const s = doc.steps.find(x => x.id === stepId);
  if (!s) return undefined;
  const max = lineCount === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, lineCount);
  if (s.lines[0] > max) return undefined;
  return [s.lines[0], Math.min(s.lines[1], max)];
}

/** Where the CodeLenses go: one per first line, naming the step(s) starting there, in reading order. */
export function codeLensSteps(doc: Steps, lineCount?: number): Array<{ line: number; steps: Array<Pick<UnderstandingStep, "id" | "title">> }> {
  const byLine = new Map<number, Array<Pick<UnderstandingStep, "id" | "title">>>();
  for (const s of stepsInLineOrder(doc)) {
    if (lineCount !== undefined && s.lines[0] > lineCount) continue;
    (byLine.get(s.lines[0]) ?? byLine.set(s.lines[0], []).get(s.lines[0])!).push({ id: s.id, title: s.title });
  }
  return [...byLine].map(([line, steps]) => ({ line, steps }));
}

/** A message the Hop webview may send. */
export type HopMessage =
  | { type: "ready" }
  | { type: "step"; step: string }
  | { type: "scrolled"; step: string }
  | { type: "back" }
  | { type: "explain" }
  | { type: "openCode" }
  | { type: "openExplanation" };

/** The contract's id pattern (schemaDsl ID). */
const ID_RE = /^[a-z][a-z0-9_.-]{0,79}$/;

/** Validate one webview message against the step ids of the document shown; undefined = ignored. */
export function parseHopMessage(raw: unknown, stepIds: ReadonlySet<string>): HopMessage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "ready": case "back": case "explain": case "openCode": case "openExplanation":
      return { type: m.type };
    case "step": case "scrolled": {
      const step = m.step;
      if (typeof step !== "string" || !ID_RE.test(step) || !stepIds.has(step)) return undefined;
      return { type: m.type, step };
    }
    default:
      return undefined;
  }
}
