/**
 * DETACH1 (§ V5 W1, AC-V1): detach a materialized dbt model — an explicit authority flip (dbt → notebook) recorded by a
 * DETSPI1 stamp — then report drift as a fact, never re-sync silently. Pure and deterministic (no `vscode`, no I/O).
 *
 *   readDetachRecord(text)                 → a validated DETSPI1 record, or why it is not one
 *   detachModel(record, current)           → the record with `authority: "notebook"` and a fresh stamp (current hashes)
 *   detachView(path, record, current, at)  → badge + drift fact (in-sync / dbt changed / notebook edited / both / unknown
 *                                            / target missing: the stamped notebook no longer exists, from an fs stat)
 *   reattachProposal(result, existing, r)  → re-attach = a NEW MAT1 proposal (diff of that model's files), never automatic
 *
 * DataPass never runs dbt nor the notebook. The current dbt revision is read by the caller (Git, last commit of the dbt
 * project folder); when it cannot be read the drift is `unknown` with a hole, never a guess.
 */
import {
  type DbtMaterializeResult,
  type DetachActor,
  type DetachDriftState,
  type DetachOrigin,
  type DetachStamp,
  type MaterializationDetach,
  detachDriftState,
  detachStampDigest,
  gitObjectId,
  notebookSourceHash,
  previewDbtDiff,
  recordPath,
  validateMaterializationDetach
} from "./dbtNotebook";
import type { DiffEntry } from "./flow";

export const DETACH_COMMAND = "datapass.dbt.detach";
/** V5HOLE7: re-attach a detached model = open a new MAT1 proposal for it (never automatic, no Git write). */
export const REATTACH_COMMAND = "datapass.dbt.reattach";

/**
 * The state a view shows: a DETSPI1 drift state, or `target-missing` when the stamped notebook is gone (fs stat says it
 * does not exist). `target-missing` is a view fact only, never written to a record, and never reads as "in sync".
 */
export type DetachViewState = DetachDriftState | "target-missing";

/** Labels are data: a caller may override them (settings), the defaults keep the meaning plain. */
export const DRIFT_LABELS: Readonly<Record<DetachViewState, string>> = {
  "in-sync": "in sync since detach",
  "dbt-changed": "dbt changed since detach",
  "notebook-edited": "notebook edited since detach",
  "both-changed": "dbt changed and notebook edited",
  unknown: "drift unknown",
  "target-missing": "target missing"
};

/** Detach command wording (data; `datapass.dbt.detachMessages` overrides any key). `{model}`, `{notebook}`, `{record}` are filled in. */
export const DETACH_MESSAGES = {
  pickTitle: "Detach a dbt model (the notebook becomes the authority)",
  confirm: "Detach {model}?",
  confirmDetail: "The notebook {notebook} becomes the authority. Later dbt changes are no longer materialized into it; drift is shown as a fact, never re-synced. DataPass records who and when in {record}. Commit that file through your normal Git flow.",
  detached: "{model} is detached: the notebook becomes the authority.",
  reattachPickTitle: "Re-attach a detached dbt model (opens a new materialization proposal)",
  alreadyDetachedTitle: "{model} is already detached",
  reattachAction: "Re-attach {model}: propose a fresh materialization from dbt",
  keepDetached: "Keep {model} detached",
  reattachProposed: "{model}: re-attach proposed ({proposal}). Review the MAT1 proposal below; nothing is written until you confirm.",
  reattachConfirm: "{model}: re-attach proposed. Write {count} file(s) of the proposal?",
  reattachConfirmDetail: "The notebook {notebook} is replaced by a fresh materialization from dbt and {record} names the proposal; the diff is in the DataPass dbt output. Files are written to the working tree only; nothing is run, deployed or committed. Review them in a merge request: dbt is the authority again once it merges."
} as const;
export type DetachMessageKey = keyof typeof DETACH_MESSAGES;

/** One message, override first (blank overrides are ignored), placeholders filled. */
export type DetachMessageVars = Partial<Record<"model" | "notebook" | "record" | "proposal" | "count", string>>;
export function detachMessage(key: DetachMessageKey, vars: DetachMessageVars, overrides: Partial<Record<string, unknown>> = {}): string {
  const o = overrides[key];
  const template = typeof o === "string" && o.trim() ? o : DETACH_MESSAGES[key];
  return template.replace(/\{(model|notebook|record|proposal|count)\}/g, (m, k: keyof DetachMessageVars) => vars[k] ?? m);
}
export const DETACHED_BADGE = "detached";

export function readDetachRecord(text: string): { ok: true; record: MaterializationDetach } | { ok: false; reason: string } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: "not valid JSON" }; }
  return validateMaterializationDetach(value);
}

export const serializeDetachRecord = (record: MaterializationDetach): string => `${JSON.stringify(record, null, 2)}\n`;

/**
 * What the caller read now: the notebook file (null = unreadable) and the dbt project revision as a Git SHA (null =
 * unknown). `notebookExists` is an fs stat of the stamped notebook path: `false` = the target is gone ("target missing");
 * omitted = not checked (an unreadable notebook is then only "drift unknown").
 */
export interface DetachCurrent {
  notebookContent: string | null;
  dbtRevision: string | null;
  notebookExists?: boolean;
  /**
   * V5HOLE7: a dbt source file of the model's project was modified after the detach (fs stat, see `dbtEditedSince`), so
   * an uncommitted dbt edit counts as "dbt changed" even while the last commit is still the stamped one.
   */
  dbtEditedSinceDetach?: boolean;
}

/** The dbt project's own source folders (paths relative to the folder of `dbt_project.yml`). Build output is never a source. */
export const DBT_SOURCE_FOLDERS: readonly string[] = ["models", "macros", "seeds", "snapshots", "analyses", "tests"];
const DBT_NOT_SOURCE = /(^|\/)(target|dbt_packages|logs|node_modules|\.git)\//;

/** Is this path (relative to the dbt project folder) a dbt source: `dbt_project.yml` or a file under a source folder? */
export function isDbtSourcePath(path: string, folders: readonly string[] = DBT_SOURCE_FOLDERS): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (p === "dbt_project.yml") return true;
  return !DBT_NOT_SOURCE.test(p) && folders.some(f => p.startsWith(`${f}/`));
}

/**
 * Was any dbt source modified after the detach? `recordedAt` is truncated to the second, so a file counts only from the
 * next whole second (an edit made in the same second as the detach is not distinguishable and is not counted). A file
 * list from fs stat; no Git, no dbt.
 */
export function dbtEditedSince(files: ReadonlyArray<{ path: string; mtimeMs: number }>, recordedAt: string, folders?: readonly string[]): boolean {
  const t = Date.parse(recordedAt);
  if (Number.isNaN(t)) return false;
  return files.some(f => isDbtSourcePath(f.path, folders) && f.mtimeMs >= t + 1000);
}

export interface DetachRequest extends DetachCurrent {
  /** EVACTOR1 actor `{kind, id}`. */
  actor: DetachActor;
  /** When (ISO instant, UTC): the record's `recordedAt` and the drift `checkedAt`, never in the stamp. */
  at: string;
  origin?: DetachOrigin;
}

/**
 * The authority flip. The new stamp records what the notebook and dbt are *at detach time* (so later drift is measured
 * from here), who did it and when. Refuses (with a reason) when already detached or when a current value is missing.
 */
export function detachModel(record: MaterializationDetach, req: DetachRequest): { ok: true; record: MaterializationDetach } | { ok: false; reason: string } {
  if (record.authority === "notebook") return { ok: false, reason: `Already detached on ${record.recordedAt} by ${record.stamp.actor.id}.` };
  if (req.notebookContent === null) return { ok: false, reason: `The notebook ${record.stamp.notebookPath} is missing: materialize it (MAT1) before detaching.` };
  const dbtRevision = req.dbtRevision === null ? undefined : gitObjectId(req.dbtRevision);
  if (!dbtRevision) return { ok: false, reason: "The dbt project revision could not be read from Git: commit the dbt project first, so the detach stamp records it." };
  const stamp: DetachStamp = {
    modelId: record.stamp.modelId,
    dbtRevision,
    notebookPath: record.stamp.notebookPath,
    notebookHash: notebookSourceHash(req.notebookContent),
    actor: { kind: req.actor.kind, id: req.actor.id.trim() || "unknown" },
    origin: req.origin ?? "declared"
  };
  return {
    ok: true,
    record: {
      schema: record.schema,
      authority: "notebook",
      stamp,
      stampDigest: detachStampDigest(stamp),
      recordedAt: req.at,
      drift: { state: "in-sync", dbtRevision: stamp.dbtRevision, notebookHash: stamp.notebookHash, checkedAt: req.at },
      reattach: null
    }
  };
}

export interface DetachHole { reason: string }

/** One materialized model as the tree and the Context panel show it. */
export interface DetachView {
  modelId: string;
  notebookPath: string;
  recordPath: string;
  authority: "dbt" | "notebook";
  detached: boolean;
  /** The label shown when the stamped notebook no longer exists (fs stat), else null. Set for attached models too. */
  targetMissing: string | null;
  /** Only for a detached model; null while dbt is the authority (no drift to measure). Revision = Git oid, hash = digest value. */
  drift: null | { state: DetachViewState; label: string; dbtRevision: string | null; notebookHash: string | null; checkedAt: string };
  detachedBy?: { actor: string; at: string; origin: DetachOrigin };
  reattachPending?: { proposalId: string; actor: string; at: string };
  holes: DetachHole[];
}

/** The hole for a stamped notebook that no longer exists (detached or not). */
export const targetMissingHole = (notebookPath: string, detached: boolean): DetachHole => ({
  reason: detached
    ? `Target missing: the detached notebook ${notebookPath} no longer exists. DataPass never recreates it: restore it from Git, or re-attach to propose a fresh materialization.`
    : `Target missing: the materialized notebook ${notebookPath} no longer exists. Re-run the materialization (MAT1) to propose it again.`
});

export function detachView(path: string, record: MaterializationDetach, current: DetachCurrent, checkedAt: string, labels: Partial<Record<DetachViewState, string>> = {}): DetachView {
  const base = { modelId: record.stamp.modelId, notebookPath: record.stamp.notebookPath, recordPath: path, authority: record.authority };
  const reattachPending = record.reattach ? { proposalId: record.reattach.proposalId, actor: record.reattach.actor.id, at: record.reattach.at } : undefined;
  const missing = current.notebookExists === false;
  const targetMissing = missing ? labels["target-missing"] ?? DRIFT_LABELS["target-missing"] : null;
  if (record.authority === "dbt") return { ...base, detached: false, targetMissing, drift: null, holes: missing ? [targetMissingHole(record.stamp.notebookPath, false)] : [], ...(reattachPending ? { reattachPending } : {}) };
  // A deleted target is never measured (no content → no hash): its state is `target-missing`, never in sync.
  const notebookHash = missing || current.notebookContent === null ? null : notebookSourceHash(current.notebookContent);
  const dbtRevision = (current.dbtRevision === null ? undefined : gitObjectId(current.dbtRevision)) ?? null;
  const measured = missing ? "target-missing" : detachDriftState(record.stamp, { dbtRevision, notebookHash });
  // An uncommitted dbt edit (fs stat) is a dbt change too; an unknown or missing state stays as it is.
  const state: DetachViewState = !current.dbtEditedSinceDetach ? measured : measured === "in-sync" ? "dbt-changed" : measured === "notebook-edited" ? "both-changed" : measured;
  const holes: DetachHole[] = [];
  if (missing) holes.push(targetMissingHole(record.stamp.notebookPath, true));
  else if (notebookHash === null) holes.push({ reason: `The detached notebook ${record.stamp.notebookPath} is missing or unreadable.` });
  if (dbtRevision === null) holes.push({ reason: "The dbt project revision could not be read from Git (not a repository, or the project folder has no commit)." });
  return {
    ...base, detached: true, targetMissing,
    drift: { state, label: labels[state] ?? DRIFT_LABELS[state], dbtRevision: dbtRevision?.oid ?? null, notebookHash: notebookHash?.value ?? null, checkedAt },
    detachedBy: { actor: record.stamp.actor.id, at: record.recordedAt, origin: record.stamp.origin },
    ...(reattachPending ? { reattachPending } : {}),
    holes
  };
}

/** Tree row text: `detached · notebook edited since detach`. */
export function detachBadge(v: DetachView): string {
  if (!v.detached) return [v.reattachPending ? "dbt · re-attach proposed" : "dbt", v.targetMissing].filter(Boolean).join(" · ");
  return [DETACHED_BADGE, v.drift?.label].filter(Boolean).join(" · ");
}

/** Context panel body (plain lines; the panel adds the origin badge "From the code"). */
export function detachContextBody(v: DetachView): string {
  const lines = [`Model: ${v.modelId}`, `Notebook: ${v.notebookPath}`, `Authority: ${v.authority === "notebook" ? "the notebook (detached from dbt)" : "dbt (the notebook is generated)"}`];
  if (v.detachedBy) lines.push(`Detached by ${v.detachedBy.actor} on ${v.detachedBy.at}${v.detachedBy.origin === "declared" ? "" : ` (${v.detachedBy.origin})`}`);
  if (v.drift) lines.push(`Drift: ${v.drift.label} (checked ${v.drift.checkedAt})`);
  else if (v.targetMissing) lines.push(`Notebook: ${v.targetMissing}`);
  if (v.reattachPending) lines.push(`Re-attach proposed: ${v.reattachPending.proposalId} by ${v.reattachPending.actor} on ${v.reattachPending.at}`);
  if (v.detached) lines.push("Changes are never re-synced: re-attach is a new materialization proposal you review.");
  return lines.join("\n");
}

/** The Context section for a location, from the views (NAVCTX1 provider result shape). Null = nothing for this file. */
export function detachContextSection(views: readonly DetachView[], filePath: string | undefined): { body: string; origin: "static"; holes: DetachHole[] } | null {
  if (!filePath) return null;
  const p = filePath.replace(/\\/g, "/");
  const v = views.find(x => p === x.notebookPath || p.endsWith(`/${x.notebookPath}`) || p === x.recordPath || p.endsWith(`/${x.recordPath}`));
  return v ? { body: detachContextBody(v), origin: "static", holes: v.holes } : null;
}

export interface ReattachRequest {
  modelId: string;
  proposalId: string;
  actor: DetachActor;
  at: string;
}

/** A proposal id that is a safe wire id (lowercase letters, digits, dashes). */
export function reattachProposalId(modelId: string, at: string): string {
  const slug = modelId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "model";
  return `reattach-${slug}-${at.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

/**
 * Re-attach = a new MAT1 proposal for ONE model: the freshly materialized notebook (from dbt) and a record whose
 * authority is dbt again and whose `reattach` names the proposal. It goes through MAT1's diff → branch → MR flow and
 * takes effect only when that MR merges; nothing is written to the working tree here.
 */
export function reattachProposal(result: DbtMaterializeResult, existing: ReadonlyMap<string, string>, req: ReattachRequest): { ok: true; files: DbtMaterializeResult["files"]; diff: DiffEntry[] } | { ok: false; reason: string } {
  const rec = result.records.find(r => r.modelId === req.modelId);
  if (!rec) return { ok: false, reason: `The model ${req.modelId} was not materialized (see the materialization holes).` };
  const unit = result.files.find(f => f.path === rec.record.stamp.notebookPath)?.unit;
  const record: MaterializationDetach = { ...rec.record, reattach: { proposalId: req.proposalId, actor: req.actor, at: req.at } };
  const files = result.files
    .filter(f => f.unit === unit)
    .map(f => (f.path === rec.path ? { ...f, content: serializeDetachRecord(record) } : f));
  // The existing record says `notebook`; the re-attach proposal is the explicit act that may replace it, so the guard is
  // lifted for this model only, and the notebook's hand edits are shown in the MR diff (never applied silently).
  const patched = new Map(existing);
  const old = existing.get(rec.path);
  if (old !== undefined) {
    const r = readDetachRecord(old);
    if (!r.ok || r.record.authority !== "notebook") return { ok: false, reason: `${req.modelId} is not detached: nothing to re-attach.` };
    patched.set(rec.path, serializeDetachRecord({ ...r.record, authority: "dbt" }));
  } else return { ok: false, reason: `${req.modelId} has no detach record: nothing to re-attach.` };
  const single: DbtMaterializeResult = { ...result, files, records: [{ ...rec, record }] };
  const diff = previewDbtDiff(single, patched, true);
  return { ok: true, files, diff };
}

export { recordPath };
