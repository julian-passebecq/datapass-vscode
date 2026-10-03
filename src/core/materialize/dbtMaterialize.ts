/**
 * DBTMAT1 (TL-5 complement): the pure half of the `datapass.dbt.materialize` command. Pure (no `vscode`).
 *
 *   parseDbtMaterializeConfig(text)       → environments + Fabric folder + notebook prefix from `.datapass/dbt-materialize.json`
 *   dbtMaterializePreview(result, diff)   → the preview the person reads before confirming (diff, holes, issues)
 *
 * The command reads dbt's artefacts and this file, shows the preview, and writes only after an explicit confirmation;
 * the Git steps (branch → commit → push → MR) are shown as arguments for the person to run, never run here.
 */
import type { DiffEntry } from "./flow";
import type { DbtEnvironmentTables, DbtMaterializeResult } from "./dbtNotebook";

export const DBT_MATERIALIZE_COMMAND = "datapass.dbt.materialize";
export const DBT_MATERIALIZE_CONFIG = ".datapass/dbt-materialize.json";

export interface DbtMaterializeConfig {
  environments: Record<string, DbtEnvironmentTables>;
  rootDirectory: string;
  notebookPrefix?: string;
  pipelineName?: string;
  /** Raw `targetCard` block (policy, signals, wording of the EXEC1c target card); parsed by targetCard.ts. */
  targetCard?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strMap = (v: unknown): Record<string, string> | undefined =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0)) : undefined;

/** Reads the config file (untrusted JSON). An environment without a lakehouse is dropped and reported. */
export function parseDbtMaterializeConfig(text: string): { ok: true; config: DbtMaterializeConfig; warnings: string[] } | { ok: false; reason: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: `${DBT_MATERIALIZE_CONFIG} is not valid JSON.` }; }
  if (!isObj(raw) || !isObj(raw.environments)) return { ok: false, reason: `${DBT_MATERIALIZE_CONFIG} needs an "environments" object (environment id → { lakehouse, schema?, tables?, sources? }).` };
  const warnings: string[] = [];
  const environments: Record<string, DbtEnvironmentTables> = {};
  for (const [id, v] of Object.entries(raw.environments)) {
    if (!isObj(v) || typeof v.lakehouse !== "string" || !v.lakehouse) { warnings.push(`Environment "${id}" has no lakehouse: skipped.`); continue; }
    environments[id] = {
      lakehouse: v.lakehouse,
      ...(typeof v.schema === "string" && v.schema ? { schema: v.schema } : {}),
      ...(strMap(v.tables) ? { tables: strMap(v.tables) } : {}),
      ...(strMap(v.sources) ? { sources: strMap(v.sources) } : {})
    };
  }
  if (!Object.keys(environments).length) return { ok: false, reason: `${DBT_MATERIALIZE_CONFIG} has no usable environment.` };
  const rootDirectory = typeof raw.rootDirectory === "string" && raw.rootDirectory.trim() ? raw.rootDirectory.trim().replace(/\\/g, "/").replace(/\/+$/, "") : "fabric";
  if (rootDirectory.split("/").some(p => p === "..") || rootDirectory.startsWith("/") || /^[A-Za-z]:/.test(rootDirectory)) {
    return { ok: false, reason: `rootDirectory must be a repository-relative folder (got "${rootDirectory}").` };
  }
  return {
    ok: true,
    warnings,
    config: {
      environments,
      rootDirectory,
      ...(typeof raw.notebookPrefix === "string" ? { notebookPrefix: raw.notebookPrefix } : {}),
      ...(typeof raw.pipelineName === "string" && raw.pipelineName ? { pipelineName: raw.pipelineName } : {}),
      ...(isObj(raw.targetCard) ? { targetCard: raw.targetCard } : {})
    }
  };
}

export interface DbtMaterializePreview {
  /** Paths that a confirmation writes (added or modified). */
  writes: string[];
  /** Lines shown before the confirmation. */
  lines: string[];
  /** True when nothing may be written: a validation error, or no file to add or change (holes are per model and only shown). */
  blocked: boolean;
}

const MARK: Record<DiffEntry["status"], string> = { added: "+", modified: "~", unchanged: "=", "blocked-detached": "!" };

/** Works for either MAT1 target: only the candidate, holes and issues are read. */
export function dbtMaterializePreview(result: Pick<DbtMaterializeResult, "candidate" | "holes" | "issues">, diff: readonly DiffEntry[]): DbtMaterializePreview {
  const writes = diff.filter(e => e.status === "added" || e.status === "modified").map(e => e.path);
  const lines = [
    `dbt materialization proposal: ${result.candidate.logicalId} @ ${result.candidate.revision.slice(0, 12)} (${result.candidate.environment})`,
    "Nothing is run or deployed: these files go to a review branch through your Git flow.",
    "",
    ...diff.map(e => `${MARK[e.status]} ${e.path}  [${e.status}${e.status === "modified" ? ` +${e.addedLines} -${e.removedLines}` : ""}]${e.reason ? `  ${e.reason}` : ""}`)
  ];
  if (result.holes.length) lines.push("", "Holes:", ...result.holes.map(h => `${h.severity === "error" ? "✖" : "⚠"} ${h.code} ${h.modelId ?? h.path}: ${h.nextAction}`));
  if (result.issues.length) lines.push("", "Validation:", ...result.issues.map(i => `${i.severity === "error" ? "✖" : "⚠"} ${i.message}`));
  lines.push("", `${writes.length} file(s) to write, ${diff.filter(e => e.status === "unchanged").length} unchanged, ${diff.filter(e => e.status === "blocked-detached").length} kept.`);
  return { writes, lines, blocked: result.issues.some(i => i.severity === "error") || !writes.length };
}
