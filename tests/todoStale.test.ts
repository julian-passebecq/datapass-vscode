/**
 * TODOSTALE1: a verdict pinned (EVPIN1) to a file state the file no longer has becomes one "Stale evidence"
 * Next-steps row per Location, linking to the verdict's view; current and unpinned verdicts add nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { collectNextSteps, NEXT_STEP_KINDS, type NextStepsLocator } from "../src/core/navigation/bindings/nextSteps";
import { NEXT_STEP_SOURCES } from "../src/core/navigation/bindings/nextStepSources";
import { pinFreshness, staleEvidenceItems, STALE_EVIDENCE_SOURCE_ID, type PinnedVerdictFact, type StaleFileState, type StalePin } from "../src/core/navigation/bindings/staleEvidenceSteps";
import { nextStepCommands } from "../src/core/navigation/packs/nextSteps";
import type { NavLocation } from "../src/core/navigation/navTypes";

const digest = (c: string) => ({ algorithm: "sha256", value: c.repeat(64) });
const pin = (sha: string | null, d = "a"): StalePin => ({ gitSha: sha, artifactDigest: digest(d) });
const now = (sha: string | null, d: string | null = "a"): StaleFileState => ({ gitSha: sha, artifactDigest: d ? digest(d) : null });
const SHA1 = "1".repeat(40), SHA2 = "2".repeat(40);

const root: NavLocation = { level: "project", nodeId: "p", artifactKind: "project" };
const orders: NavLocation = { level: "artifact", nodeId: "orders", artifactKind: "sql-script" };
const nb: NavLocation = { level: "artifact", nodeId: "nb", artifactKind: "notebook" };
const locator: NextStepsLocator = { root, component: () => null, subproject: () => null };
const verdict = (over: Partial<PinnedVerdictFact>): PinnedVerdictFact =>
  ({ location: orders, subjectKey: "datapass:claim:orders.grain", pin: pin(SHA1), now: now(SHA1), viewId: "evidence", ...over });

test("pin freshness mirrors EVPIN1 pinState", () => {
  assert.equal(pinFreshness(null, now(SHA1)), "unpinned");
  assert.equal(pinFreshness(pin(SHA1), now(SHA1)), "current");
  assert.equal(pinFreshness(pin(SHA1), now(SHA2)), "stale", "new commit");
  assert.equal(pinFreshness(pin(SHA1), now(SHA1, "b")), "stale", "uncommitted edit: the digest decides");
  assert.equal(pinFreshness(pin(SHA1), null), "stale", "file gone");
  assert.equal(pinFreshness(pin(null), now(null)), "current", "not in Git, same bytes");
  assert.equal(pinFreshness(pin(SHA1), now(SHA2, null)), "stale", "digest unknown: the SHA decides");
  assert.equal(pinFreshness(pin(null), now(SHA1, null)), "stale", "nothing comparable");
});

test("stale verdicts become one row per Location, linking to the verdict view", () => {
  assert.ok(NEXT_STEP_KINDS.includes("stale"));
  assert.ok(NEXT_STEP_SOURCES.some(s => s.id === STALE_EVIDENCE_SOURCE_ID), "registered");
  const r = collectNextSteps({ staleEvidence: { verdicts: [
    verdict({ now: now(SHA2) }),
    verdict({ subjectKey: "datapass:claim:orders.keys", now: now(SHA2) }),
    verdict({ location: nb, subjectKey: "datapass:claim:nb.reads", now: null, viewId: undefined }),
    verdict({ location: root, subjectKey: "datapass:claim:fresh" }),
    verdict({ location: root, subjectKey: "datapass:claim:unpinned", pin: null }),
  ] } }, locator);
  assert.equal(r.total, 2);
  assert.ok(r.rows.every(row => row.kind === "stale" && row.severity === "warning" && row.origin === "observed"));
  const o = r.rows.find(row => row.location.nodeId === "orders")!;
  assert.equal(o.text, "Stale evidence: 2 verdicts here were computed on an older file — recompute them");
  assert.deepEqual(nextStepCommands(o), [{ type: "go", location: orders }, { type: "view", viewId: "evidence" }]);
  const n = r.rows.find(row => row.location.nodeId === "nb")!;
  assert.equal(n.text, "Stale evidence: datapass:claim:nb.reads was computed on 1111111; the file changed since — recompute it (file gone)");
  assert.equal(n.viewId, undefined);
});

test("labels are data; nothing stale = no rows", () => {
  const items = staleEvidenceItems({ verdicts: [verdict({ pin: pin(null), now: now(null, "b") })], labels: { one: "Périmé : {subject} ({sha})", notInGit: "hors Git" } });
  assert.equal(items[0]!.text, "Périmé : datapass:claim:orders.grain (hors Git)");
  assert.equal(collectNextSteps({ staleEvidence: { verdicts: [verdict({})] } }, locator).total, 0);
  assert.equal(collectNextSteps({}, locator).total, 0);
  // Unplaced verdict lands at the project root.
  assert.equal(collectNextSteps({ staleEvidence: { verdicts: [verdict({ location: null, now: now(SHA2) })] } }, locator).rows[0]!.location.nodeId, "p");
});
