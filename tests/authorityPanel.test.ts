import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  asGrantedApproval, authorityProvider, authorityText, authorityView, AUTHORITY_STATE_KEYS, stateAuthoritySource
} from "../src/core/authority/approvalsPanel";
import { buildSections, contextTabs } from "../src/core/navigation/context";
import type { NavLocation } from "../src/core/navigation/navTypes";

const D1 = "a".repeat(64);
const D2 = "b".repeat(64);
const loc = (nodeId: string) => ({ level: "component", nodeId, artifactKind: "sql" }) as unknown as NavLocation;
const approval = (extra: Record<string, unknown> = {}) =>
  ({ subjectDigest: D1, audience: "internal", scope: "generation", approvedBy: "local-user", approvedAt: "2026-10-01T10:00:00Z", ...extra });

test("only well-formed local approvals are granted; malformed ones become a hole", () => {
  assert.ok(asGrantedApproval(approval()));
  for (const bad of [approval({ approvedBy: "Julian" }), approval({ subjectDigest: "xyz" }), approval({ scope: "deploy" }),
    approval({ audience: "everyone" }), approval({ approvedAt: "yesterday" }), null, "approved"]) {
    assert.equal(asGrantedApproval(bad), undefined);
  }
  const v = authorityView({ location: loc("c1"), approvals: [approval(), approval({ approvedBy: "Julian" })], imported: [] });
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0]!.state, "granted");
  assert.equal(v.rows[0]!.approver, "You (local)");
  assert.match(v.holes[0]!.reason, /1 stored approval\(s\) are malformed/);
});

test("imported labels never self-authorize, even naming a reviewer or matching a digest", () => {
  const imported = [
    { source: "bridge.json", label: "approved", claimedBy: "Julian", digest: D2, audience: "public" },
    { source: "brief.json", label: "reviewed-for-generation", digest: D1, audience: "internal" }
  ];
  const v = authorityView({ location: loc("c1"), approvals: [approval()], imported });
  const claimed = v.rows.filter(r => r.state === "claimed");
  assert.equal(claimed.length, 2);
  assert.equal(v.rows.filter(r => r.state === "granted").length, 1, "imports add no grant");
  assert.equal(claimed[0]!.approver, "Julian (claimed)");
  assert.match(claimed[0]!.note!, /never an approval/);
  assert.match(claimed[1]!.note!, /that approval grants, not this label/);
  const text = authorityText(v);
  assert.match(text, /Granted\n• You \(local\) — generation · internal · sha256 aaaaaaaaaaaa…/);
  assert.match(text, /Claimed, not granted\n• Julian \(claimed\)/);
  assert.match(text, /Who may approve\n• generation: You, locally/);
});

test("rows are filtered per Location; unlocated rows are project-wide", () => {
  const approvals = [approval({ locationId: "c1" }), approval({ subjectDigest: D2, locationId: "c2" }), approval({ scope: "publication" })];
  const v1 = authorityView({ location: loc("c1"), approvals, imported: [{ source: "x", label: "approved", locationId: "c2" }] });
  assert.deepEqual(v1.rows.map(r => [r.digest, r.scope, r.projectWide]), [[D1, "generation", false], [D1, "publication", true]]);
  const v3 = authorityView({ location: loc("c3"), approvals: [approval({ locationId: "c1" })], imported: [] });
  assert.equal(v3.rows.length, 0);
  assert.match(v3.holes[0]!.reason, /nothing is granted here/);
});

test("provider fills the Authority tab; no location is a hole, not a guess", async () => {
  const p = authorityProvider({ approvals: () => [approval()], imported: () => [] });
  const tabs = contextTabs({}).filter(t => t.id === "authority");
  assert.equal(tabs[0]!.title, "Authority");
  const [none] = await buildSections({ location: null }, tabs, () => p);
  assert.equal(none!.body, "");
  assert.match(none!.holes[0]!.reason, /No location yet/);
  const [s] = await buildSections({ location: loc("c1") }, tabs, () => p);
  assert.equal(s!.origin, "user");
  assert.match(s!.body, /^Granted\n• You \(local\)/);
});

test("state source reads approvals and claimed briefs only, read-only", () => {
  const store = new Map<string, unknown>([
    [AUTHORITY_STATE_KEYS.approvals, [approval()]],
    [AUTHORITY_STATE_KEYS.exchanges, [
      { kind: "brief", status: "claimed-not-granted", file: ".datapass/local/b.json", digest: D2 },
      { kind: "brief", status: "approved-for-generation", file: ".datapass/local/c.json", digest: D1 },
      { kind: "ai-context", status: "claimed-not-granted" }
    ]]
  ]);
  const src = stateAuthoritySource({ get: <T>(k: string) => store.get(k) as T | undefined });
  assert.equal(src.approvals().length, 1);
  assert.deepEqual(src.imported(), [{ source: ".datapass/local/b.json", label: "reviewed-for-generation", digest: D2 }]);
  const empty = stateAuthoritySource({ get: () => "corrupt" as never });
  assert.deepEqual([empty.approvals(), empty.imported()], [[], []]);
});

test("state keys match the WorkSession keys", () => {
  const session = readFileSync("src/work/session.ts", "utf8");
  assert.match(session, new RegExp(`approvals: "${AUTHORITY_STATE_KEYS.approvals}"`));
  assert.match(session, new RegExp(`exchanges: "${AUTHORITY_STATE_KEYS.exchanges}"`));
});
