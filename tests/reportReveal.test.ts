/**
 * V5HOLE20 (V5 acceptance row 13): `report()` reveals the DataPass output channel by default, and
 * `{ reveal: false }` only logs, so an imported Architect review stays visible in Context.
 * `vscode` is replaced by a small in-memory stub (no VS Code needed).
 */
import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

const lines: string[] = [];
let shows = 0;
const vscodeStub = {
  window: { createOutputChannel: () => ({ appendLine: (l: string) => lines.push(l), show: () => { shows++; } }) },
  workspace: {}, commands: {}, env: {}
};
const mod = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const resolve = mod._resolveFilename;
mod._resolveFilename = (r: string, ...a: unknown[]) => (r === "vscode" ? "vscode" : resolve.call(Module, r, ...a));
mod._cache["vscode"] = { id: "vscode", filename: "vscode", loaded: true, exports: vscodeStub };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { report } = require("../src/work/io") as typeof import("../src/work/io");

test("report reveals Output by default, and only logs with reveal: false", () => {
  report("Something failed", ["detail"]);
  assert.equal(shows, 1);
  report("Architect review imported (ai-proposed)", ["Recommendation: keep"], { reveal: false });
  assert.equal(shows, 1);
  assert.ok(lines.some(l => l.startsWith("== Architect review imported (ai-proposed)")));
  assert.ok(lines.includes("Recommendation: keep"));
});
