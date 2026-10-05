// Adapted from datapass-vscode-hub git-service @ 7dcd191841304454050ed9c3d9b831a30aa688f5.
/**
 * File-level semantic diff (HG1b seam, filled by G1). The diff itself is Common
 * `@juliandatapass-group/semantic-diff`: tables read and written, joins, columns, partitioning,
 * checks, models, IaC resources, pipeline steps and parameters for SQL, PySpark, notebooks,
 * Terraform/Bicep and pipeline YAML/JSON. Pure, no I/O; the Hub only reads the two sides.
 */
import { semanticDiffer } from '@juliandatapass-group/semantic-diff';
import type { CompanionFileDiff, FileSide, SemanticChange, TableAccess, TableRef } from '@juliandatapass-group/semantic-diff';
import type { ArtifactKind } from './types';

export type { SemanticChange, TableAccess, TableRef };
export type SideContent = FileSide;
/** A Terraform `moved { from = … to = … }` block: the resource keeps its identity under a new address. */
export interface IacMove {
  from: string;
  to: string;
}
/** Common G1 diff; `iacMoves` lists the `moved` blocks of the after side (Terraform only, MULTI1b). */
export type FileSemanticDiff = CompanionFileDiff<ArtifactKind> & { iacMoves?: IacMove[] };
export type SemanticStatus = FileSemanticDiff['status'];

/**
 * Any semantic diff that turns two sides of one file into a {@link FileSemanticDiff}. Impact
 * resolution only reads `tables` and `notes`, so a test or a later differ can be plugged in.
 */
export type SemanticDiffer = (path: string, artifactKind: ArtifactKind, before: SideContent, after: SideContent) => FileSemanticDiff;

const ADDRESS = String.raw`((?:module\.[A-Za-z_][\w-]*(?:\[[^\]]*\])?\.)*[A-Za-z_][\w-]*\.[A-Za-z_][\w-]*(?:\[[^\]]*\])?)`;
const MOVED = new RegExp(String.raw`moved\s*\{\s*(?:from\s*=\s*${ADDRESS}\s*to\s*=\s*${ADDRESS}|to\s*=\s*${ADDRESS}\s*from\s*=\s*${ADDRESS})\s*\}`, 'g');

/** `moved` blocks of a Terraform text, comments stripped. Lexical, nothing evaluated. */
export function terraformMoves(text: string): IacMove[] {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"])(#|\/\/)[^\n]*/g, '$1');
  return [...clean.matchAll(MOVED)].map((m) => (m[1] ? { from: m[1], to: m[2]! } : { from: m[4]!, to: m[3]! }));
}

/** The default differ: Common G1, plus Terraform `moved` blocks of the after side. */
export const fileSemanticDiff: SemanticDiffer = (path, artifactKind, before, after) => {
  const diff: FileSemanticDiff = semanticDiffer(path, artifactKind, before, after);
  if (typeof after === 'string' && /\.tf$/i.test(path)) {
    const moves = terraformMoves(after);
    if (moves.length) diff.iacMoves = moves;
  }
  return diff;
};
