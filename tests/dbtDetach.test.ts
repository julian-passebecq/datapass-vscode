/**
 * DETACH1: authority flip + stamp, drift fact (in sync / dbt changed / notebook edited / both / unknown), badge and
 * Context text, and re-attach = a new MAT1 proposal (never automatic). Pure: no dbt, no notebook run.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { type DbtFile, type DbtMaterializeInput, detachStampDigest, materializeDbtModels, notebookSourceHash, previewDbtDiff, validateMaterializationDetach } from "../src/core/materialize/dbtNotebook";
import { DETACH_COMMAND, detachBadge, detachContextSection, detachModel, detachView, readDetachRecord, reattachProposal, reattachProposalId, serializeDetachRecord } from "../src/core/materialize/dbtDetach";
import { PALETTE_TIERS } from "../src/core/experience/palette";

const ROOT = join(__dirname, "fixtures", "dbtmat");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files: DbtFile[] = walk(ROOT).map(p => ({ path: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
const REV = "0123456789abcdef0123456789abcdef01234567";
const REV2 = "89abcdef0123456789abcdef0123456789abcdef";
const AT = "2026-10-01T09:00:00Z";
const input = (over: Partial<DbtMaterializeInput> = {}): DbtMaterializeInput => ({
  files, environment: "dev", environments: { dev: { lakehouse: "lh_dev", sources: { "raw.orders": "lh_bronze_dev.orders" } } },
  dbtRevision: REV, rootDirectory: "fabric", at: "2026-10-01T08:00:00Z", ...over
});

const mat = materializeDbtModels(input());
const rec = mat.records.find(r => r.record.stamp.notebookPath.includes("customer_totals"))!;
const nbText = mat.files.find(f => f.path === rec.record.stamp.notebookPath)!.content;
const ANA = { kind: "human" as const, id: "Ana" };
const detached = () => {
  const r = detachModel(rec.record, { notebookContent: nbText, dbtRevision: REV, actor: ANA, at: AT });
  assert.ok(r.ok);
  return r.record;
};

test("detach flips the authority to notebook with a fresh, valid stamp (who, when, current hashes)", () => {
  const d = detached();
  assert.equal(d.authority, "notebook");
  assert.deepEqual({ ...d.stamp }, { modelId: rec.modelId, dbtRevision: { algorithm: "git-sha1", oid: REV }, notebookPath: rec.record.stamp.notebookPath, notebookHash: notebookSourceHash(nbText), actor: ANA, origin: "declared" });
  assert.equal(d.schema, "datapass.materialization-detach/1");
  assert.equal(d.recordedAt, AT);
  assert.deepEqual(d.stampDigest, detachStampDigest(d.stamp));
  assert.equal(d.drift?.state, "in-sync");
  assert.equal(d.reattach, null);
  const back = readDetachRecord(serializeDetachRecord(d));
  assert.ok(back.ok);
  assert.deepEqual(back.record, d);
});

test("detach refuses: already detached, missing notebook, unreadable dbt revision", () => {
  const again = detachModel(detached(), { notebookContent: nbText, dbtRevision: REV, actor: ANA, at: AT });
  assert.ok(!again.ok && /Already detached/.test(again.reason));
  const missing = detachModel(rec.record, { notebookContent: null, dbtRevision: REV, actor: ANA, at: AT });
  assert.ok(!missing.ok && /missing/.test(missing.reason));
  const norev = detachModel(rec.record, { notebookContent: nbText, dbtRevision: null, actor: ANA, at: AT });
  assert.ok(!norev.ok && /revision/.test(norev.reason));
});

test("a hand-edited stamp or a broken record is rejected", () => {
  const d = detached();
  const forged = JSON.parse(serializeDetachRecord(d));
  forged.stamp.actor = { kind: "human", id: "Mallory" };
  assert.ok(!validateMaterializationDetach(forged).ok);
  assert.ok(!readDetachRecord("{nope").ok);
  assert.ok(!readDetachRecord(JSON.stringify({ ...forged, schema: "x" })).ok);
  // Pre-review shapes are not records: a `schemaId` key, a bare-hex revision, a string actor.
  const legacy = JSON.parse(serializeDetachRecord(d));
  legacy.schemaId = legacy.schema; delete legacy.schema;
  assert.ok(!validateMaterializationDetach(legacy).ok);
  const bare = JSON.parse(serializeDetachRecord(d));
  bare.stamp.dbtRevision = REV;
  assert.ok(!validateMaterializationDetach(bare).ok);
  const stringActor = JSON.parse(serializeDetachRecord(d));
  stringActor.stamp.actor = "Ana";
  assert.ok(!validateMaterializationDetach(stringActor).ok);
});

test("drift is a fact: in sync, dbt changed, notebook edited, both, unknown (with holes)", () => {
  const d = detached();
  const edited = `${nbText}\n# hand edit\n`;
  const state = (notebookContent: string | null, dbtRevision: string | null) => detachView("r.json", d, { notebookContent, dbtRevision }, AT).drift!.state;
  assert.equal(state(nbText, REV), "in-sync");
  assert.equal(state(nbText, REV2), "dbt-changed");
  assert.equal(state(edited, REV), "notebook-edited");
  assert.equal(state(edited, REV2), "both-changed");
  assert.equal(state(nbText, null), "unknown");
  const gone = detachView("r.json", d, { notebookContent: null, dbtRevision: REV }, AT);
  assert.equal(gone.drift!.state, "unknown");
  assert.match(gone.holes[0]!.reason, /missing/);
  // A model still under dbt has no drift and a plain badge.
  const attached = detachView("r.json", rec.record, { notebookContent: edited, dbtRevision: REV2 }, AT);
  assert.equal(attached.drift, null);
  assert.equal(detachBadge(attached), "dbt");
});

test("badge and Context text, labels are data", () => {
  const d = detached();
  const v = detachView(rec.path, d, { notebookContent: `${nbText}x`, dbtRevision: REV }, AT, { "notebook-edited": "edited by hand" });
  assert.equal(detachBadge(v), "detached · edited by hand");
  const s = detachContextSection([v], `C:/work/${rec.record.stamp.notebookPath}`);
  assert.ok(s);
  assert.equal(s.origin, "static");
  assert.match(s.body, /Authority: the notebook/);
  assert.match(s.body, /Detached by Ana/);
  assert.match(s.body, /never re-synced/);
  assert.equal(detachContextSection([v], "other/file.py"), null);
});

test("MAT1 keeps a detached notebook; re-attach is a new proposal for that model only", () => {
  const d = detached();
  const edited = `${nbText}\n# hand edit\n`;
  const existing = new Map<string, string>([[rec.record.stamp.notebookPath, edited], [rec.path, serializeDetachRecord(d)]]);
  // A regular re-materialization never overwrites it, even with overwriteDetached.
  const plain = previewDbtDiff(mat, existing, true);
  assert.equal(plain.find(e => e.path === rec.record.stamp.notebookPath)!.status, "blocked-detached");
  const proposalId = reattachProposalId(rec.modelId, AT);
  assert.match(proposalId, /^reattach-[a-z0-9-]+-20261001090000$/);
  const r = reattachProposal(mat, existing, { modelId: rec.modelId, proposalId, actor: ANA, at: AT });
  assert.ok(r.ok);
  const nb = r.diff.find(e => e.path === rec.record.stamp.notebookPath)!;
  assert.equal(nb.status, "modified");
  assert.ok(r.diff.every(e => r.files.some(f => f.path === e.path)), "only this model's files");
  assert.ok(!r.files.some(f => f.path.includes("stg_orders")));
  const newRecord = readDetachRecord(r.files.find(f => f.path === rec.path)!.content);
  assert.ok(newRecord.ok);
  assert.equal(newRecord.record.authority, "dbt");
  assert.deepEqual(newRecord.record.reattach, { proposalId, actor: ANA, at: AT });
  // Not detached → nothing to re-attach.
  const none = reattachProposal(mat, new Map([[rec.path, serializeDetachRecord(rec.record)]]), { modelId: rec.modelId, proposalId, actor: ANA, at: AT });
  assert.ok(!none.ok);
});

test("the command is classified in the palette", () => {
  assert.equal(PALETTE_TIERS.get(DETACH_COMMAND), "palette.full");
});
