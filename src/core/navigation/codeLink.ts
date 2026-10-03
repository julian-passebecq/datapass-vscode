/**
 * V4-NAVCODE1: the code link, as pure functions (no `vscode`; the host side is codeLinkHost.ts).
 *
 *   location → code   a Location with a source span (an analyzer span, or a Hop step's lines) opens its
 *                     file beside the view, revealed and decorated in the location's colour; a Location
 *                     without one gets a typed hole reason, never a guessed range.
 *   code → location   the editor cursor goes to the innermost step/operation holding it (smallest span;
 *                     an operation wins over a step of the same size).
 *
 * Spans come from providers (one per source: analyzer facts, Hop steps…), so new sources plug in
 * without touching this file. Hole texts are data (DEFAULT_HOLE_LABELS, overridable by a setting).
 */
import type { UnderstandingDoc } from "../understanding/contract";
import { linesForStep } from "../understanding/lines";
import { NAV_LEVELS, type NavLocation } from "./navTypes";

/** A 1-based inclusive source span; columns are optional (whole lines when absent). */
export interface SourceSpan {
  readonly file: string;
  readonly startLine: number; readonly endLine: number;
  readonly startColumn?: number; readonly endColumn?: number;
  /** § 34 origin of the span (static, theoretical, ai-proposed, observed…). */
  readonly origin: string;
}

export const CODE_HOLE_REASONS = ["level-without-code", "no-source", "span-beyond-file", "not-analyzed"] as const;
export type CodeHoleReason = (typeof CODE_HOLE_REASONS)[number];
export interface CodeHole { readonly reason: CodeHoleReason; readonly detail?: string }

/** One source of spans. `span` returns undefined when the location is not its own. */
export interface CodeSpanProvider {
  readonly id: string;
  span(location: NavLocation): SourceSpan | CodeHole | undefined;
  /** Every location with a span in that file (for code → location). */
  locationsIn(file: string): readonly { readonly location: NavLocation; readonly span: SourceSpan }[];
}

/** Default status texts per hole reason; `{detail}` is replaced. Overridable (setting datapass.nav.codeLink.holeLabels). */
export const DEFAULT_HOLE_LABELS: Readonly<Record<CodeHoleReason, string>> = {
  "level-without-code": "DataPass: no code at this level",
  "no-source": "DataPass: no source span known for this item",
  "span-beyond-file": "DataPass: the recorded lines are beyond the file as it is now (stale analysis)",
  "not-analyzed": "DataPass: this file is not analysed yet{detail}"
};

export function isHole(x: SourceSpan | CodeHole): x is CodeHole {
  return (x as CodeHole).reason !== undefined;
}

/** The levels that may carry code; coarser ones get `level-without-code` without asking providers. */
const CODE_LEVELS: ReadonlySet<string> = new Set(["artifact", "step", "operation"]);

/** The span (or hole) for a location: the first provider that knows it wins. */
export function resolveSpan(providers: readonly CodeSpanProvider[], location: NavLocation): SourceSpan | CodeHole {
  if (!CODE_LEVELS.has(location.level)) return { reason: "level-without-code" };
  let hole: CodeHole | undefined;
  for (const p of providers) {
    const r = p.span(location);
    if (!r) continue;
    if (!isHole(r)) return r;
    hole ??= r;
  }
  return hole ?? { reason: "no-source" };
}

/** Clamp a span to the file's current line count; a span wholly beyond the file is a hole. */
export function clampSpan(span: SourceSpan, lineCount: number | undefined): SourceSpan | CodeHole {
  if (lineCount === undefined) return span;
  const max = Math.max(0, lineCount);
  if (span.startLine > max) return { reason: "span-beyond-file", detail: `${span.startLine} > ${max}` };
  if (span.endLine <= max) return span;
  return { ...span, endLine: max, endColumn: undefined };
}

/** The status text for a hole, from the labels (defaults + overrides). */
export function holeMessage(hole: CodeHole, overrides?: Readonly<Record<string, unknown>>): string {
  const o = overrides?.[hole.reason];
  const text = typeof o === "string" && o.trim() ? o : DEFAULT_HOLE_LABELS[hole.reason];
  return text.replace("{detail}", hole.detail ? ` (${hole.detail})` : "");
}

const levelRank = (l: string): number => NAV_LEVELS.indexOf(l as (typeof NAV_LEVELS)[number]);

/**
 * The innermost location holding a 1-based line (and optional column) in a file: smallest span,
 * then finer level (operation before step), then provider order. Undefined between spans.
 */
export function innermostAt(providers: readonly CodeSpanProvider[], file: string, line: number, column?: number): NavLocation | undefined {
  if (!Number.isInteger(line) || line < 1) return undefined;
  let best: { location: NavLocation; size: number; rank: number } | undefined;
  for (const p of providers) {
    for (const { location, span } of p.locationsIn(file)) {
      if (fileKey(span.file) !== fileKey(file) || line < span.startLine || line > span.endLine) continue;
      if (column !== undefined) {
        if (line === span.startLine && span.startColumn !== undefined && column < span.startColumn) continue;
        if (line === span.endLine && span.endColumn !== undefined && column > span.endColumn) continue;
      }
      const size = (span.endLine - span.startLine) * 100_000 + ((span.endColumn ?? 99_999) - (span.startColumn ?? 0));
      const rank = levelRank(location.level);
      if (!best || size < best.size || (size === best.size && rank > best.rank)) best = { location, size, rank };
    }
  }
  return best?.location;
}

/** Normalise a file path for comparisons (Windows: case-insensitive, `\` → `/`). */
export function fileKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/**
 * A provider over Hop explanations (examples/v3/hop): each step of each explained file is a
 * `step` location. `nodeIdFor` is the host's id scheme (NAVLOC1), passed in, never guessed here.
 */
export function hopStepProvider(opts: {
  /** Explained files with their document (files as absolute paths). */
  docs: () => readonly { readonly file: string; readonly doc: Pick<UnderstandingDoc, "steps">; readonly artifactKind: string }[];
  nodeIdFor: (file: string, stepId: string) => string;
  /** The reverse of nodeIdFor; undefined = not a Hop step id. */
  parseNodeId: (nodeId: string) => { file: string; stepId: string } | undefined;
}): CodeSpanProvider {
  const find = (file: string) => opts.docs().find(d => fileKey(d.file) === fileKey(file));
  return {
    id: "hop-steps",
    span(location) {
      if (location.level !== "step") return undefined;
      const ref = opts.parseNodeId(location.nodeId);
      if (!ref) return undefined;
      const entry = find(ref.file);
      if (!entry) return { reason: "not-analyzed", detail: ref.file };
      const r = linesForStep(entry.doc, ref.stepId);
      if (!r) return { reason: "no-source", detail: ref.stepId };
      return { file: entry.file, startLine: r[0], endLine: r[1], origin: "ai-proposed" };
    },
    locationsIn(file) {
      const entry = find(file);
      if (!entry) return [];
      return entry.doc.steps.map(s => ({
        location: { level: "step" as const, nodeId: opts.nodeIdFor(entry.file, s.id), artifactKind: entry.artifactKind },
        span: { file, startLine: s.lines[0], endLine: s.lines[1], origin: "ai-proposed" }
      }));
    }
  };
}

/** The part of NAVLOC1's ProjectLadder the ladder provider reads (structural, so tests pass a stub). */
export interface CodeLinkLadder {
  entry(l: NavLocation): { readonly file?: { readonly repoKey: string; readonly repoPath: string }; readonly lines?: readonly [number, number] } | undefined;
  children(l: NavLocation): readonly NavLocation[];
  locate(repoKey: string, repoPath: string, line?: number): NavLocation | undefined;
}

/**
 * A provider over the NavHost's ladder: every step/operation the ladder knows with lines in a file
 * of a bound repository. `repoFolder` gives a repository's local folder (absolute); `repoKeys` lists them.
 */
export function ladderSpanProvider(opts: {
  ladder: () => CodeLinkLadder | undefined;
  repoFolder: (repoKey: string) => string | undefined;
  repoKeys: () => readonly string[];
}): CodeSpanProvider {
  const join = (folder: string, repoPath: string) => `${folder.replace(/[\\/]+$/, "")}/${repoPath.replace(/^[\\/]+/, "")}`;
  return {
    id: "ladder",
    span(location) {
      if (location.level !== "step" && location.level !== "operation") return undefined;
      const e = opts.ladder()?.entry(location);
      if (!e?.file) return undefined;
      const folder = opts.repoFolder(e.file.repoKey);
      if (!folder) return { reason: "no-source", detail: e.file.repoPath };
      if (!e.lines) return { reason: "not-analyzed", detail: e.file.repoPath };
      return { file: join(folder, e.file.repoPath), startLine: e.lines[0], endLine: e.lines[1], origin: "static" };
    },
    locationsIn(file) {
      const ladder = opts.ladder();
      if (!ladder) return [];
      const k = fileKey(file);
      for (const repoKey of opts.repoKeys()) {
        const folder = opts.repoFolder(repoKey);
        const base = folder && `${fileKey(folder).replace(/\/+$/, "")}/`;
        if (!base || !k.startsWith(base)) continue;
        const repoPath = file.replace(/\\/g, "/").slice(base.length);
        const fileLoc = ladder.locate(repoKey, repoPath);
        if (!fileLoc) continue;
        const out: { location: NavLocation; span: SourceSpan }[] = [];
        const visit = (l: NavLocation, depth: number) => {
          if (depth > 8) return;
          for (const c of ladder.children(l)) {
            const lines = ladder.entry(c)?.lines;
            if (lines && (c.level === "step" || c.level === "operation")) out.push({ location: c, span: { file, startLine: lines[0], endLine: lines[1], origin: "static" } });
            visit(c, depth + 1);
          }
        };
        visit(fileLoc, 0);
        return out;
      }
      return [];
    }
  };
}
