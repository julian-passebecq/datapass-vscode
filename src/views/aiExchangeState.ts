/**
 * State of the AI exchange view (secondary side bar). Pure: which DataPass files the project has,
 * what the AI can be asked for each, and the last exchanges. Names, sizes and labels only: never a
 * local path or a file's content.
 */
import { AI_TASKS, EXCHANGE_FILES, type ExchangeKind } from "../core/project/aiExchange";
import type { ExchangeRecord } from "../core/work/workModel";
import { staleReason, type PackStamp } from "../core/exchange/stamp";

export interface AiExchangeFile {
  kind: ExchangeKind;
  /** Repository-relative path (the graph where project.json says it is). */
  path: string;
  label: string;
  exists: boolean;
  bytes?: number;
  /** The current file does not parse or validate: the AI can be asked to correct it. */
  problem?: string;
  tasks: Array<{ id: string; label: string }>;
}

export interface AiExchangeState {
  version: string;
  /** A project folder is open (otherwise the view explains what to do). */
  ready: boolean;
  hasManifest: boolean;
  projectTitle?: string;
  files: AiExchangeFile[];
  /** `stale`: 0.27 (P1, D-23) why a copied pack no longer matches the selected variant or environment. */
  recent: Array<{ label: string; status: string; at: string; stale?: string }>;
}

export interface AiExchangeInput {
  version: string;
  hasRoot: boolean;
  hasManifest: boolean;
  projectTitle?: string;
  graphPath?: string;
  kinds: readonly ExchangeKind[];
  sizes: Partial<Record<ExchangeKind, number>>;
  problems: Partial<Record<ExchangeKind, string>>;
  exchanges: readonly ExchangeRecord[];
  /** The selection now (variant and environment), to mark packs copied for another one. */
  selection?: PackStamp;
}

const RECENT = 5;

export function aiExchangeState(input: AiExchangeInput): AiExchangeState {
  return {
    version: input.version,
    ready: input.hasRoot,
    hasManifest: input.hasManifest,
    projectTitle: input.projectTitle,
    files: input.kinds.map(kind => {
      const bytes = input.sizes[kind];
      const problem = input.problems[kind];
      return {
        kind,
        path: kind === "graph" && input.graphPath ? input.graphPath : EXCHANGE_FILES[kind].path,
        label: EXCHANGE_FILES[kind].label,
        exists: bytes !== undefined,
        ...(bytes !== undefined ? { bytes } : {}),
        ...(problem ? { problem: problem.slice(0, 300) } : {}),
        tasks: AI_TASKS[kind].map(t => ({ id: t.id, label: t.label }))
      };
    }),
    recent: input.exchanges.filter(e => e.kind === "ai-context").slice(0, RECENT).map(e => {
      const stale = input.selection ? staleReason(e.stamp, input.selection) : undefined;
      return { label: e.label.slice(0, 160), status: e.status, at: e.at, ...(stale ? { stale: stale.slice(0, 300) } : {}) };
    })
  };
}
