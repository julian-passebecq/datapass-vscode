/**
 * V1-FRESH (GPT T3, findings A03/A04): refresh generations and phases, bounded enrichment steps,
 * the context guard of packs and orders, and truthful freshness (fresh / stale / unknown).
 * Pure: the tracker and the stamp helpers drive a small model of the session.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { contextChange, RefreshTracker, refreshLabel, settleWithin, type ContextIdentityInput, type IncompleteStep, type RefreshToken } from "../src/core/refresh/tracker";
import { freshness, readStamp, stampLine, withStale, NATIVE_NOT_COMPARED, type PackStamp } from "../src/core/exchange/stamp";
import { stampVerdict } from "../src/core/workOrders/launch";

const later = <T>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));
const never = <T>() => new Promise<T>(() => undefined);

/** The session's refresh in miniature: phase one then phase two, each written only while current. */
class MiniSession {
  readonly tracker = new RefreshTracker();
  shown: { project?: string; tools?: string } = {};
  async refresh(project: string, phase1Ms: number, phase2: Promise<string>, timeoutMs = 1000): Promise<void> {
    const t = this.tracker.begin();
    try {
      const ctx = await later(phase1Ms, project);
      if (!this.tracker.isCurrent(t)) return;
      if (this.tracker.publish(t, "first-paint", { project: ctx })) this.shown = { project: ctx, tools: this.shown.project === ctx ? this.shown.tools : undefined };
      const incomplete: IncompleteStep[] = [];
      const tools = await settleWithin("tool probes", phase2, timeoutMs, this.shown.tools, incomplete);
      if (this.tracker.publish(t, "settled", { project: ctx, incomplete })) this.shown = { ...this.shown, tools };
    } catch (e) { this.tracker.fail(t, e); }
  }
}

test("a delayed refresh N that finishes after N+1 writes nothing", async () => {
  const s = new MiniSession();
  const n = s.refresh("A", 60, Promise.resolve("tools of A"));
  const n1 = s.refresh("B", 5, Promise.resolve("tools of B"));
  await Promise.all([n, n1]);
  assert.deepEqual(s.shown, { project: "B", tools: "tools of B" });
  const st = s.tracker.status();
  assert.equal(st.generation, 2);
  assert.equal(st.phase, "settled");
  assert.equal(st.project, "B");
});

test("rapid A/B/C: only the last refresh publishes, whatever the order they finish in", async () => {
  const s = new MiniSession();
  await Promise.all([
    s.refresh("A", 40, later(40, "A-tools")),
    s.refresh("B", 1, later(80, "B-tools")),
    s.refresh("C", 20, later(5, "C-tools"))
  ]);
  assert.deepEqual(s.shown, { project: "C", tools: "C-tools" });
});

test("an older generation cannot publish a phase or a failure over a newer one", () => {
  const t = new RefreshTracker();
  const a = t.begin();
  const b = t.begin();
  assert.equal(t.publish(a, "first-paint", { project: "file:///a" }), false);
  assert.equal(t.fail(a, new Error("late error")), false);
  assert.equal(t.status().phase, "loading");
  assert.equal(t.publish(b, "first-paint", { project: "file:///b" }), true);
  assert.equal(t.status().project, "file:///b");
});

test("two projects sharing component ids: the second project's state never carries the first one's tools", async () => {
  const s = new MiniSession();
  await s.refresh("A", 1, Promise.resolve("A has az"));
  assert.equal(s.shown.tools, "A has az");
  const pending = s.refresh("B", 1, later(40, "B has fab"));
  await later(15, undefined);
  // Between the first paint and the settled phase, B shows its tools as pending, not A's.
  assert.deepEqual(s.shown, { project: "B", tools: undefined });
  assert.equal(refreshLabel(s.tracker.status()).text, "refreshing: tools and readiness pending");
  await pending;
  assert.deepEqual(s.shown, { project: "B", tools: "B has fab" });
});

test("an enrichment step that rejects or times out keeps its fallback and is listed as incomplete", async () => {
  const incomplete: IncompleteStep[] = [];
  assert.equal(await settleWithin("probes", Promise.reject(new Error("spawn EPERM")), 1000, "previous", incomplete), "previous");
  assert.equal(await settleWithin("git", never<string>(), 20, "previous", incomplete), "previous");
  assert.equal(await settleWithin("env", later(1, "fresh"), 1000, "previous", incomplete), "fresh");
  assert.deepEqual(incomplete.map(i => [i.step, i.why]), [["probes", "failed"], ["git", "timed out"]]);
  assert.match(incomplete[0]!.detail ?? "", /EPERM/);
});

test("a timed-out tool probe leaves a settled but incomplete state; the retry recovers", async () => {
  const s = new MiniSession();
  await s.refresh("A", 1, never<string>(), 20);
  const st = s.tracker.status();
  assert.equal(st.phase, "settled");
  assert.deepEqual(st.incomplete.map(i => i.why), ["timed out"]);
  const label = refreshLabel(st);
  assert.equal(label.tone, "warn");
  assert.match(label.text, /incomplete/);
  assert.match(label.detail, /unknown, not verified/);
  await s.refresh("A", 1, Promise.resolve("A-tools"));
  assert.deepEqual(s.tracker.status().incomplete, []);
  assert.equal(refreshLabel(s.tracker.status()).tone, "ok");
  assert.equal(s.shown.tools, "A-tools");
});

test("a refresh that rejects shows a failed state with a retry, not the previous success", async () => {
  const t = new RefreshTracker(() => new Date("2026-09-26T10:00:00.000Z"));
  const a = t.begin();
  t.publish(a, "first-paint", { project: "file:///p" });
  t.publish(a, "settled", { project: "file:///p" });
  const b: RefreshToken = t.begin();
  assert.equal(t.fail(b, new Error("project.json unreadable")), true);
  const label = refreshLabel(t.status(), new Date("2026-09-26T10:05:00.000Z"));
  assert.equal(label.text, "refresh failed");
  assert.equal(label.tone, "bad");
  assert.match(label.detail, /project\.json unreadable.*observed 5 min ago.*Re-inspect to retry/);
  const c = t.begin();
  assert.equal(t.publish(c, "first-paint", { project: "file:///p" }), true);
  assert.equal(t.status().error, undefined);
});

test("labels: loading keeps the previous observation time, settled shows it", () => {
  const t = new RefreshTracker(() => new Date("2026-09-26T10:00:00.000Z"));
  assert.equal(refreshLabel(t.status()).text, "not inspected yet");
  const a = t.begin();
  t.publish(a, "settled", { project: "p" });
  assert.equal(refreshLabel(t.status(), new Date("2026-09-26T10:00:10.000Z")).text, "inspected just now");
  t.begin();
  assert.equal(t.status().settledAt, "2026-09-26T10:00:00.000Z");
  assert.match(refreshLabel(t.status(), new Date("2026-09-26T12:00:00.000Z")).detail, /observed 2 h ago/);
});

test("the context guard: a variant switch, another project or an edited manifest while building is refused", () => {
  const base: ContextIdentityInput = { project: "file:///p", variantKey: "current", environment: "dev", manifestDigest: "m1", optionsDigest: "o1" };
  assert.equal(contextChange(base, { ...base }), undefined, "a background refresh that changes nothing the pack uses");
  assert.equal(contextChange(base, { ...base, variantKey: "orchestration=adf" }), "the selected variant changed");
  assert.equal(contextChange(base, { ...base, project: "file:///q" }), "another project was opened");
  assert.equal(contextChange(base, { ...base, environment: "prod" }), "the environment changed");
  assert.equal(contextChange(base, { ...base, manifestDigest: "m2" }), "project.json changed");
  assert.equal(contextChange(base, { ...base, optionsDigest: undefined }), "options.json changed");
});

test("rapid A/B/C while a pack is built: what is copied matches the selection shown, or nothing is copied", async () => {
  let selection = "A";
  const identity = (): ContextIdentityInput => ({ project: "file:///p", variantKey: selection });
  const build = async () => {
    const before = identity();
    const text = `pack for ${selection}`;
    await later(10, undefined);
    const why = contextChange(before, identity());
    return why ? { refused: why } : { copied: text };
  };
  const first = build();
  selection = "B";
  selection = "C";
  assert.deepEqual(await first, { refused: "the selected variant changed" }, "built for A, switched to C before the copy");
  assert.deepEqual(await build(), { copied: "pack for C" }, "built again: matches what is shown");
});

const B: PackStamp = { variant: { key: "orchestration=blob", title: "B — Blob event + Function", picks: ["orchestration=blob"] }, environment: "dev", bridge: "4e1a9c2f0b7d4e1a9c2f0b7d4e1a9c2f0b7d4e1a" };

test("freshness: absence of a stale reason is not proof of freshness", () => {
  assert.deepEqual(freshness(undefined, B), { state: "unknown", reason: "not stamped (built before 0.27): what it was built for is unknown" });
  assert.equal(freshness({ ...B, bridge: undefined }, B).state, "unknown");
  assert.match(freshness(B, { ...B, bridge: undefined }).state === "unknown" ? (freshness(B, { ...B, bridge: undefined }) as { reason: string }).reason : "", /unknown now/);
  assert.equal(freshness(B, { ...B, variant: { key: "current", title: "Current architecture" } }).state, "stale");
  assert.deepEqual(freshness(B, { ...B, observedAt: "2026-09-26T11:00:00.000Z" }), { state: "fresh", note: NATIVE_NOT_COMPARED });
  assert.match(NATIVE_NOT_COMPARED, /native repositories are not compared/);
});

test("pilot cards: stale, unknown (unstamped order) or nothing", () => {
  const cards = [{ orderId: "o1" }, { orderId: "o2" }];
  const stampOf = (id: string) => id === "o1" ? B : undefined;
  const now = withStale(cards, stampOf, B);
  assert.equal(now[0]!.stale, undefined);
  assert.equal(now[0]!.unknown, undefined);
  assert.match(now[1]!.unknown ?? "", /not stamped/);
  assert.deepEqual(withStale(cards, stampOf, undefined), cards);
});

test("launch check: another environment and an unstamped order ask first", () => {
  assert.deepEqual(stampVerdict({ id: "wo-1234", stamp: B }, B), { kind: "same" });
  const env = stampVerdict({ id: "wo-1234", stamp: B }, { ...B, environment: "test" });
  assert.equal(env.kind, "other-variant");
  assert.match(env.kind === "other-variant" ? env.message : "", /another environment/);
  const legacy = stampVerdict({ id: "wo-1234" }, B);
  assert.equal(legacy.kind, "not-stamped");
  assert.match(legacy.kind === "not-stamped" ? legacy.message : "", /what it was built for is unknown/);
});

test("stamps carry the observation time: shown in the pack line, read back, never compared", () => {
  const s: PackStamp = { ...B, observedAt: "2026-09-26T10:42:13.120Z" };
  assert.match(stampLine(s), /project state observed 2026-09-26 10:42 UTC\./);
  assert.match(stampLine(B), /bridge revision 4e1a9c2f0b7d\. If the selection/);
  assert.equal(readStamp(JSON.parse(JSON.stringify(s)))?.observedAt, s.observedAt);
  assert.equal(readStamp({ ...s, observedAt: "yesterday" })?.observedAt, undefined);
  assert.equal(freshness(s, { ...B, observedAt: "2026-09-27T00:00:00.000Z" }).state, "fresh");
});
