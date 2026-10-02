/**
 * DETACH1 (§ V5 W1, AC-V1): detach a materialized dbt model — an explicit authority flip (dbt → notebook) recorded by a
 * DETSPI1 stamp — then report drift as a fact, never re-sync silently. Pure and deterministic (no `vscode`, no I/O).
 *
 *   readDetachRecord(text)                 → a validated DETSPI1 record, or why it is not one
 *   detachModel(record, current)           → the record with `authority: "notebook"` and a fresh stamp (current hashes)
 *   detachView(path, record, current, at)  → badge + drift fact (in-sync / dbt changed / notebook edited / both / unknown)
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

/** Labels are data: a caller may override them (settings), the defaults keep the meaning plain. */
export const DRIFT_LABELS: Readonly<Record<DetachDriftState, string>> = {
  "in-sync": "in sync since detach",
  "dbt-changed": "dbt changed since detach",
  "notebook-edited": "notebook edited since detach",
  "both-changed": "dbt changed and notebook edited",
  unknown: "drift unknown"
};
export const DETACHED_BADGE = "detached";

export function readDetachRecord(text: string): { ok: true; record: MaterializationDetach } | { ok: false; reason: string } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: "not valid JSON" }; }
  return validateMaterializationDetach(value);
}

export const serializeDetachRecord = (record: MaterializationDetach): string => `${JSON.stringify(record, null, 2)}\n`;

/** What the caller read now: the notebook file (null = missing) and the dbt project revision as a Git SHA (null = unknown). */
export interface DetachCurrent {
  notebookContent: string | null;
  dbtRevision: string | null;
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
  /** Only for a detached model; null while dbt is the authority (no drift to measure). Revision = Git oid, hash = digest value. */
  drift: null | { state: DetachDriftState; label: string; dbtRevision: string | null; notebookHash: string | null; checkedAt: string };
  detachedBy?: { actor: string; at: string; origin: DetachOrigin };
  reattachPending?: { proposalId: string; actor: string; at: string };
  holes: DetachHole[];
}

export function detachView(path: string, record: MaterializationDetach, current: DetachCurrent, checkedAt: string, labels: Partial<Record<DetachDriftState, string>> = {}): DetachView {
  const base = { modelId: record.stamp.modelId, notebookPath: record.stamp.notebookPath, recordPath: path, authority: record.authority };
  const reattachPending = record.reattach ? { proposalId: record.reattach.proposalId, actor: record.reattach.actor.id, at: record.reattach.at } : undefined;
  if (record.authority === "dbt") return { ...base, detached: false, drift: null, holes: [], ...(reattachPending ? { reattachPending } : {}) };
  const notebookHash = current.notebookContent === null ? null : notebookSourceHash(current.notebookContent);
  const dbtRevision = (current.dbtRevision === null ? undefined : gitObjectId(current.dbtRevision)) ?? null;
  const state = detachDriftState(record.stamp, { dbtRevision, notebookHash });
  const holes: DetachHole[] = [];
  if (notebookHash === null) holes.push({ reason: `The detached notebook ${record.stamp.notebookPath} is missing.` });
  if (dbtRevision === null) holes.push({ reason: "The dbt project revision could not be read from Git (not a repository, or the project folder has no commit)." });
  return {
    ...base, detached: true,
    drift: { state, label: labels[state] ?? DRIFT_LABELS[state], dbtRevision: dbtRevision?.oid ?? null, notebookHash: notebookHash?.value ?? null, checkedAt },
    detachedBy: { actor: record.stamp.actor.id, at: record.recordedAt, origin: record.stamp.origin },
    ...(reattachPending ? { reattachPending } : {}),
    holes
  };
}

/** Tree row text: `detached · notebook edited since detach`. */
export function detachBadge(v: DetachView): string {
  if (!v.detached) return v.reattachPending ? "dbt · re-attach proposed" : "dbt";
  return [DETACHED_BADGE, v.drift?.label].filter(Boolean).join(" · ");
}

/** Context panel body (plain lines; the panel adds the origin badge "From the code"). */
export function detachContextBody(v: DetachView): string {
  const lines = [`Model: ${v.modelId}`, `Notebook: ${v.notebookPath}`, `Authority: ${v.authority === "notebook" ? "the notebook (detached from dbt)" : "dbt (the notebook is generated)"}`];
  if (v.detachedBy) lines.push(`Detached by ${v.detachedBy.actor} on ${v.detachedBy.at}${v.detachedBy.origin === "declared" ? "" : ` (${v.detachedBy.origin})`}`);
  if (v.drift) lines.push(`Drift: ${v.drift.label} (checked ${v.drift.checkedAt})`);
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
