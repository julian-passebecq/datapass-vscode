/**
 * V5HOLE6: where an explainer export is written. A prepared project keeps its file under `.datapass/explain`
 * (no question asked); a bare folder (no `.datapass`) is never given a `.datapass` folder by the export: the person
 * is asked for the file, with a default at the root of the opened workspace folder. Pure (paths as segments).
 */
export const EXPLAIN_FOLDER = ".datapass/explain";

export interface ExplainTarget {
  /** Which folder the segments are relative to; `none` when no folder is open (the dialog starts empty). */
  readonly base: "project" | "workspace" | "none";
  readonly segments: readonly string[];
  /** True: offer a save dialog with this target as its default. */
  readonly ask: boolean;
}

export function explainTarget(prepared: boolean, hasWorkspaceFolder: boolean, date: string): ExplainTarget {
  if (prepared) return { base: "project", segments: [...EXPLAIN_FOLDER.split("/"), `export-${date}.html`], ask: false };
  return { base: hasWorkspaceFolder ? "workspace" : "none", segments: [`datapass-explain-${date}.html`], ask: true };
}
