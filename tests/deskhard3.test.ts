/**
 * DESKHARD3: the v20-work-orders desktop suite under CI load. Every short single-shot check on its
 * paths is asked once more with 20 s when (and only when) it timed out, and a second timeout is
 * "not checked", never a false "no": git/gh in the observer, a clone's origin before a launch, the
 * base branch, the private log's origin, Claude Control's reads, and each desktop run's own %TEMP%.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { retryOnTimeout, RETRY_TIMEOUT_MS } from "../src/core/git/run";
import { ORIGIN_TIMEOUT_MS, originUrlOf, originVerdict, readOrigin, type GitAnswer } from "../src/core/project/observation";
import { remoteIdentity } from "../src/core/project/gitHosts";
import { ControlClient, HEALTH_TIMEOUT_MS, READ_TIMEOUT_MS, RETRY_TIMEOUT_MS as CONTROL_RETRY_MS, type Fetched } from "../src/work/controlClient";
import { fixtureTempEnv } from "../scripts/desktop/tempEnv";

type R = { ok: boolean; timedOut?: boolean; n: number };

test("retryOnTimeout: a timeout is asked once more with at least 20 s; answers and refusals are not", async () => {
  assert.equal(RETRY_TIMEOUT_MS, 20_000);
  const seen: number[] = [];
  const answers: R[] = [{ ok: false, timedOut: true, n: 1 }, { ok: true, n: 2 }];
  const r = await retryOnTimeout(async t => { seen.push(t); return answers.shift()!; }, 5000);
  assert.deepEqual([r.ok, r.n, seen], [true, 2, [5000, 20_000]]);

  // A real failure (exit code 1, "not an ancestor", "no such key") is final at once.
  const once: number[] = [];
  const no = await retryOnTimeout(async t => { once.push(t); return { ok: false, timedOut: false, n: 1 }; }, 5000);
  assert.deepEqual([no.ok, once], [false, [5000]]);
  const yes: number[] = [];
  await retryOnTimeout(async t => { yes.push(t); return { ok: true, n: 1 }; }, 5000);
  assert.deepEqual(yes, [5000]);

  // Two timeouts: the second is returned as a timeout (the caller says "not checked").
  const twice: number[] = [];
  const slow = await retryOnTimeout(async t => { twice.push(t); return { ok: false, timedOut: true, n: twice.length }; }, 5000);
  assert.deepEqual([slow.timedOut, twice], [true, [5000, 20_000]]);
  // A longer first timeout is kept on the retry.
  const long: number[] = [];
  await retryOnTimeout(async t => { long.push(t); return { ok: false, timedOut: true, n: 1 }; }, 60_000);
  assert.deepEqual(long, [60_000, 60_000]);
});

test("originVerdict: the same repository, another one, or not checked when Git did not answer", async () => {
  const url = "https://github.com/example-org/research-pipeline";
  const ok = (stdout: string): GitAnswer => ({ ok: true, stdout });
  const failed: GitAnswer = { ok: false, stdout: "", timedOut: true };
  assert.equal(originVerdict({ config: ok(`${url}.git\n`), answered: true }, url, remoteIdentity), "same");
  assert.equal(originVerdict({ config: ok("https://github.com/example-org/other\n"), answered: true }, url, remoteIdentity), "other");
  // Git answered "no origin" (config failed, `git remote` answered): another, never the declared one.
  assert.equal(originVerdict({ config: { ok: false, stdout: "" }, answered: true }, url, remoteIdentity), "other");
  // The false negative this package removes: a timeout was read as "the clone's origin is not …".
  assert.equal(originVerdict({ config: failed, answered: false }, url, remoteIdentity), "unknown");
  assert.equal(originUrlOf({ config: failed, answered: false }), undefined);
  assert.equal(originUrlOf({ config: ok(` ${url}\n`), answered: true }), url);

  // End to end with readOrigin: two timeouts, then Git answers on the retry (20 s each).
  const timeouts: number[] = [];
  const answers: GitAnswer[] = [failed, failed, ok(url)];
  const r = await readOrigin(async (_a, _c, t) => { timeouts.push(t); return answers.shift()!; }, "/repo", undefined, 1);
  assert.equal(originVerdict(r, url, remoteIdentity), "same");
  assert.deepEqual(timeouts, [ORIGIN_TIMEOUT_MS, ORIGIN_TIMEOUT_MS, ORIGIN_TIMEOUT_MS]);
  assert.ok(ORIGIN_TIMEOUT_MS >= 20_000);
});

test("Control: a timed-out read is asked once more with 20 s; 'not running' is final at once", async () => {
  assert.equal(CONTROL_RETRY_MS, 20_000);
  const calls: Array<[string, number]> = [];
  const plan: Array<Fetched<unknown>> = [
    { ok: false, reason: "timeout", detail: "slow" }, { ok: true, data: { ok: true } },
    { ok: false, reason: "timeout", detail: "slow" }, { ok: true, data: { project: "research-library", sessions: [] } }
  ];
  const fake = (async (_b: string, p: string, t?: number) => { calls.push([p, t ?? READ_TIMEOUT_MS]); return plan.shift()!; }) as never;
  const c = new ControlClient("http://127.0.0.1:7430", fake);
  const h = await c.health();
  assert.equal(h.ok, true, JSON.stringify(h));
  await c.project("research-library");
  assert.deepEqual(calls, [["/api/health", HEALTH_TIMEOUT_MS], ["/api/health", 20_000], ["/api/project/research-library", READ_TIMEOUT_MS], ["/api/project/research-library", 20_000]]);

  // Off (connection refused): one call, still "off".
  let n = 0;
  const off = await new ControlClient("http://127.0.0.1:7430", (async () => { n++; return { ok: false, reason: "off", detail: "not running" }; }) as never).health();
  assert.deepEqual([off.ok ? "on" : off.reason, n], ["off", 1]);
  // Two timeouts: "timeout" (the service shows "not checked", not "off").
  let m = 0;
  const slow = await new ControlClient("http://127.0.0.1:7430", (async () => { m++; return { ok: false, reason: "timeout", detail: "slow" }; }) as never).health();
  assert.deepEqual([slow.ok ? "on" : slow.reason, m], ["timeout", 2]);
});

test("Control: a real server slower than the health timeout answers on the retry", async () => {
  const server = http.createServer((req, res) => {
    setTimeout(() => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); }, HEALTH_TIMEOUT_MS + 300);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const h = await new ControlClient(base, undefined, 5000).health();
    assert.equal(h.ok, true, JSON.stringify(h));
  } finally { await new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }); }
});

test("desktop runs: each fixture gets its own temp folder (TEMP, TMP and TMPDIR)", () => {
  assert.deepEqual(fixtureTempEnv("C:\\scratch\\tmp\\v20-work-orders"), { TEMP: "C:\\scratch\\tmp\\v20-work-orders", TMP: "C:\\scratch\\tmp\\v20-work-orders", TMPDIR: "C:\\scratch\\tmp\\v20-work-orders" });
});
