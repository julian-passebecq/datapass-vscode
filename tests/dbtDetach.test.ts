/**
 * DETACH1: authority flip + stamp, drift fact (in sync / dbt changed / notebook edited / both / unknown), badge and
 * Context text, and re-attach = a new MAT1 proposal (never automatic). Pure: no dbt, no notebook run.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { type DbtFile, type DbtMaterializeInput, detachStampDigest, materializeDbtModels, notebookSourceHash, previewDbtDiff, validateMaterializationDetach } from "../src/core/materialize/dbtNotebook";
import { detachSectionHead, DBT_SOURCE_FOLDERS, DETACH_COMMAND, DETACH_MESSAGES, REATTACH_COMMAND, dbtEditedSince, isDbtSourcePath, detachBadge, detachMessage, detachContextSection, detachModel, detachView, readDetachRecord, reattachProposal, reattachProposalId, serializeDetachRecord } from "../src/core/materialize/dbtDetach";
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

test("V5-01-HOLE: a deleted target is \"target missing\" with a hole, never in sync or a guessed drift", () => {
  const d = detached();
  const gone = detachView(rec.path, d, { notebookContent: null, dbtRevision: REV, notebookExists: false }, AT);
  assert.equal(gone.drift!.state, "target-missing");
  assert.equal(gone.drift!.label, "target missing");
  assert.equal(gone.drift!.notebookHash, null);
  assert.equal(gone.targetMissing, "target missing");
  assert.equal(detachBadge(gone), "detached · target missing");
  assert.doesNotMatch(detachBadge(gone), /in sync/);
  assert.match(gone.holes[0]!.reason, /^Target missing: .*no longer exists/);
  assert.match(detachContextSection([gone], rec.record.stamp.notebookPath)!.body, /Drift: target missing/);
  // Even stale content handed in by a caller is not measured once the stat says the file is gone.
  const stale = detachView(rec.path, d, { notebookContent: nbText, dbtRevision: REV, notebookExists: false }, AT);
  assert.equal(stale.drift!.state, "target-missing");
  // The label is data.
  const relabelled = detachView(rec.path, d, { notebookContent: null, dbtRevision: REV, notebookExists: false }, AT, { "target-missing": "notebook deleted" });
  assert.equal(detachBadge(relabelled), "detached · notebook deleted");
  // A present target keeps the usual drift facts; existence unchecked keeps the old "unknown".
  assert.equal(detachView(rec.path, d, { notebookContent: nbText, dbtRevision: REV, notebookExists: true }, AT).targetMissing, null);
  assert.equal(detachView(rec.path, d, { notebookContent: null, dbtRevision: REV }, AT).drift!.state, "unknown");
  // An attached model whose notebook is gone: no drift, but the target-missing fact and hole.
  const attached = detachView(rec.path, rec.record, { notebookContent: null, dbtRevision: REV, notebookExists: false }, AT);
  assert.equal(attached.drift, null);
  assert.equal(detachBadge(attached), "dbt · target missing");
  assert.match(attached.holes[0]!.reason, /^Target missing/);
});

test("detach wording is data: the toast says the notebook becomes the authority (spec V5-01), overrides apply", () => {
  assert.equal(detachMessage("detached", { model: "fct_orders" }), "fct_orders is detached: the notebook becomes the authority.");
  assert.match(DETACH_MESSAGES.pickTitle, /the notebook becomes the authority/);
  assert.match(detachMessage("confirmDetail", { notebook: "fabric/x.Notebook/notebook-content.py", record: "r.json" }), /^The notebook fabric\/x\.Notebook\/notebook-content\.py becomes the authority\..* in r\.json\./);
  assert.equal(detachMessage("detached", { model: "m" }, { detached: "{model} now follows its notebook" }), "m now follows its notebook");
  assert.equal(detachMessage("detached", { model: "m" }, { detached: "  " }), "m is detached: the notebook becomes the authority.");
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { contributes: { configuration: Array<{ properties: Record<string, unknown> }> | { properties: Record<string, unknown> } } };
  const conf = ([] as Array<{ properties: Record<string, unknown> }>).concat(pkg.contributes.configuration);
  assert.ok(conf.some(c => "datapass.dbt.detachMessages" in c.properties));
});

test("V5HOLE7: an uncommitted dbt edit (fs stat) is a dbt change; with a notebook edit it is both, never in sync", () => {
  const d = detached();
  const view = (notebookContent: string, dbtEditedSinceDetach?: boolean) => detachView(rec.path, d, { notebookContent, dbtRevision: REV, notebookExists: true, ...(dbtEditedSinceDetach === undefined ? {} : { dbtEditedSinceDetach }) }, AT);
  assert.equal(view(nbText).drift!.state, "in-sync");
  assert.equal(view(nbText, false).drift!.state, "in-sync");
  assert.equal(view(`${nbText}\n# edited in the notebook\n`).drift!.state, "notebook-edited");
  assert.equal(view(`${nbText}\n# edited in the notebook\n`).drift!.label, "notebook edited since detach");
  assert.equal(view(nbText, true).drift!.state, "dbt-changed");
  const both = view(`${nbText}\n# edited in the notebook\n`, true);
  assert.equal(both.drift!.state, "both-changed");
  assert.equal(detachBadge(both), "detached · dbt changed and notebook edited");
  // A committed dbt change plus an uncommitted one is still one dbt change; unknown and target-missing stay as they are.
  assert.equal(detachView(rec.path, d, { notebookContent: nbText, dbtRevision: REV2, dbtEditedSinceDetach: true }, AT).drift!.state, "dbt-changed");
  assert.equal(detachView(rec.path, d, { notebookContent: nbText, dbtRevision: null, dbtEditedSinceDetach: true }, AT).drift!.state, "unknown");
  assert.equal(detachView(rec.path, d, { notebookContent: null, dbtRevision: REV, notebookExists: false, dbtEditedSinceDetach: true }, AT).drift!.state, "target-missing");
  // An attached model has no drift to measure, whatever the fs says.
  assert.equal(detachView(rec.path, rec.record, { notebookContent: nbText, dbtRevision: REV, dbtEditedSinceDetach: true }, AT).drift, null);
});

test("V5HOLE7: dbt sources edited after the detach, from fs stat (build output and other folders never count)", () => {
  const t = Date.parse(AT);
  assert.ok(isDbtSourcePath("models/marts/fct_orders.sql"));
  assert.ok(isDbtSourcePath("dbt_project.yml"));
  assert.ok(isDbtSourcePath("macros\\cents.sql"));
  assert.ok(!isDbtSourcePath("target/compiled/shop/models/marts/fct_orders.sql"));
  assert.ok(!isDbtSourcePath("models/dbt_packages/x.sql"));
  assert.ok(!isDbtSourcePath("fabric/dbt_fct_orders.Notebook/notebook-content.py"));
  assert.ok(!isDbtSourcePath(".gitlab-ci.yml"));
  for (const f of DBT_SOURCE_FOLDERS) assert.ok(isDbtSourcePath(`${f}/a.sql`), f);
  const before = [{ path: "models/marts/fct_orders.sql", mtimeMs: t - 60_000 }, { path: "dbt_project.yml", mtimeMs: t - 1 }];
  assert.equal(dbtEditedSince(before, AT), false);
  // The stamp instant is truncated to the second: an mtime inside that second is not distinguishable, the next one counts.
  assert.equal(dbtEditedSince([{ path: "models/marts/fct_orders.sql", mtimeMs: t + 999 }], AT), false);
  assert.equal(dbtEditedSince([...before, { path: "models/marts/fct_orders.sql", mtimeMs: t + 1000 }], AT), true);
  assert.equal(dbtEditedSince([{ path: "target/manifest.json", mtimeMs: t + 60_000 }, { path: "logs/dbt.log", mtimeMs: t + 60_000 }], AT), false);
  assert.equal(dbtEditedSince([{ path: "models/a.sql", mtimeMs: t + 60_000 }], "not an instant"), false);
  // The source folders are data: a caller may pass its own.
  assert.equal(dbtEditedSince([{ path: "src/a.sql", mtimeMs: t + 60_000 }], AT, ["src"]), true);
});

test("V5HOLE7: re-attach has an entry point: command classified, on the detached tree row, in the palette snapshot", () => {
  assert.equal(REATTACH_COMMAND, "datapass.dbt.reattach");
  assert.equal(PALETTE_TIERS.get(REATTACH_COMMAND), "palette.full");
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { contributes: { commands: Array<{ command: string; title: string }>; menus: Record<string, Array<{ command: string; when?: string }>> } };
  assert.match(pkg.contributes.commands.find(c => c.command === REATTACH_COMMAND)!.title, /^DataPass: Re-attach dbt Model/);
  assert.ok(pkg.contributes.menus["view/item/context"]!.some(m => m.command === REATTACH_COMMAND && m.when === "view == datapass.project && viewItem == dbtModel.detached"));
  assert.ok(pkg.contributes.menus["view/item/context"]!.some(m => m.command === DETACH_COMMAND && m.when === "view == datapass.project && viewItem == dbtModel.attached"));
  assert.equal(pkg.contributes.menus.commandPalette!.find(m => m.command === REATTACH_COMMAND)?.when, "!datapass.hidden.palette.full");
  const snap = JSON.parse(readFileSync(join(__dirname, "fixtures", "palette-snapshot.json"), "utf8")) as Record<string, string[]>;
  assert.ok(snap.advanced!.includes("DataPass: Re-attach dbt Model (propose a fresh materialization)"));
});

test("V5HOLE7: re-attach wording is data and says the proposal is only proposed", () => {
  const vars = { model: "model.shop.fct_orders", proposal: "reattach-model-shop-fct-orders-20261001090000", count: "2", notebook: "fabric/n.py", record: "r.json" };
  assert.match(detachMessage("reattachProposed", vars), /^model\.shop\.fct_orders: re-attach proposed \(reattach-model-shop-fct-orders-20261001090000\)\./);
  assert.match(detachMessage("reattachConfirm", vars), /re-attach proposed\. Write 2 file\(s\)/);
  assert.match(detachMessage("reattachConfirmDetail", vars), /nothing is run, deployed or committed/);
  assert.match(detachMessage("reattachAction", vars), /^Re-attach model\.shop\.fct_orders/);
  assert.equal(detachMessage("keepDetached", vars, { keepDetached: "Leave {model} alone" }), "Leave model.shop.fct_orders alone");
});

test("V5HOLE10: the dbt materializations section id carries a drift marker so it comes up expanded", () => {
  const view = (detached: boolean, state?: string) => ({ detached, drift: state ? { state } : null }) as unknown as Parameters<typeof detachSectionHead>[0][number];
  assert.deepEqual(detachSectionHead([view(true, "in-sync"), view(false)]), { id: "dbtDetach", collapsed: true });
  assert.deepEqual(detachSectionHead([view(false)]), { id: "dbtDetach", collapsed: true });
  for (const state of ["notebook-edited", "target-missing", "unknown"]) {
    const head = detachSectionHead([view(true, "in-sync"), view(true, state)]);
    assert.deepEqual(head, { id: "dbtDetach#drift", collapsed: false }, state);
    assert.ok(!head.id.startsWith("dbtDetach:"), "never parsed as a model row id");
  }
});
