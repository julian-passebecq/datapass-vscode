/**
 * Minimal test runner for the VS Code extension host (no mocha). Tests run sequentially in a
 * real desktop VS Code; failures are collected, written to the evidence report and rethrown
 * so the launcher exits non-zero.
 */
import * as fs from "node:fs";

type TestFn = () => Promise<void> | void;
interface Case { name: string; fn: TestFn; fixtures?: string[] }

const cases: Case[] = [];
const evidence: Record<string, unknown> = {};

/** Register a test; `fixtures` limits it to those workspaces (default: all). */
export function test(name: string, fn: TestFn, fixtures?: string[]): void {
  cases.push({ name, fn, fixtures });
}

/** Attach an observation to the evidence report (desktop qualification record). */
export function record(key: string, value: unknown): void {
  evidence[key] = value;
}

export const fixture = (): string => process.env.DATAPASS_IT_FIXTURE ?? "unknown";

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Poll until `probe` returns a truthy value or the timeout elapses. */
export async function waitFor<T>(what: string, probe: () => T | Promise<T>, timeoutMs = 15000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(100);
  }
}

export async function runAll(): Promise<void> {
  const name = fixture();
  const results: Array<{ name: string; ok: boolean; ms: number; error?: string }> = [];
  for (const c of cases) {
    if (c.fixtures && !c.fixtures.includes(name)) continue;
    const start = Date.now();
    try {
      await c.fn();
      results.push({ name: c.name, ok: true, ms: Date.now() - start });
      console.log(`  ✔ [${name}] ${c.name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.stack ?? error.message : String(error);
      results.push({ name: c.name, ok: false, ms: Date.now() - start, error: msg });
      console.log(`  ✖ [${name}] ${c.name}\n${msg.split("\n").map(l => `      ${l}`).join("\n")}`);
    }
  }
  const out = process.env.DATAPASS_IT_REPORT;
  if (out) fs.writeFileSync(out, JSON.stringify({ fixture: name, results, evidence }, null, 2));
  const failed = results.filter(r => !r.ok).length;
  if (failed) throw new Error(`${failed} of ${results.length} desktop tests failed in fixture ${name}`);
}
