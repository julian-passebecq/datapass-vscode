import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProbeRunner, detectCli, resolveWindowsCommand, windowsInvocation } from "../src/core/detection";

test("detectCli returns available and first version line", async () => {
  const probe = await detectCli(
    { id: "x", label: "Example", command: "example" },
    async () => ({ ok: true, output: "example 1.2.3\nmore" })
  );
  assert.equal(probe.available, true);
  assert.equal(probe.version, "example 1.2.3");
});

test("detectCli degrades cleanly when executable is missing", async () => {
  const probe = await detectCli(
    { id: "x", label: "Example", command: "example" },
    async () => ({ ok: false, error: "ENOENT" })
  );
  assert.equal(probe.available, false);
  assert.equal(probe.detail, "ENOENT");
});

test("Windows command resolution follows PATH × PATHEXT and classifies .cmd shims", () => {
  const files = new Set([String.raw`C:\tools\az.cmd`, String.raw`C:\bin\git.exe`, String.raw`C:\bin\az.exe.txt`]);
  const env = { PATH: String.raw`C:\bin;"C:\tools"`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  const isFile = (p: string) => files.has(p);
  assert.deepEqual(resolveWindowsCommand("git", env, isFile), { path: String.raw`C:\bin\git.exe`, kind: "exe" });
  assert.deepEqual(resolveWindowsCommand("az", env, isFile), { path: String.raw`C:\tools\az.cmd`, kind: "script" });
  assert.equal(resolveWindowsCommand("missing", env, isFile), undefined);
});

test(".cmd shims run through cmd.exe only with arguments cmd cannot reinterpret", () => {
  const shim = { path: String.raw`C:\tools\az.cmd`, kind: "script" as const };
  const cmd = String.raw`C:\Windows\system32\cmd.exe`;
  const ok = windowsInvocation(shim, ["version"], { ComSpec: cmd });
  assert.deepEqual(ok, { file: cmd, args: ["/d", "/s", "/c", String.raw`""C:\tools\az.cmd" version"`], verbatim: true });
  for (const bad of ["a&calc", "x|y", "%PATH%", "!x!", "a b", 'q"', "^"]) {
    assert.ok("error" in windowsInvocation(shim, ["ls", bad], {}), bad);
  }
  assert.ok("error" in windowsInvocation({ path: String.raw`C:\a&b\x.cmd`, kind: "script" }, ["--version"], {}));
  const fab = String.raw`C:\bin\fab.exe`;
  assert.deepEqual(windowsInvocation({ path: fab, kind: "exe" }, ["ls", "My WS.Workspace"], {}), { file: fab, args: ["ls", "My WS.Workspace"], verbatim: false });
});

test("defaultProbeRunner finds a real .cmd shim on Windows", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "datapass-shim-"));
  writeFileSync(join(dir, "datapass-fake-cli.cmd"), ["@echo off", "echo fake-cli 1.2.3 %1", ""].join("\r\n"));
  const saved = process.env.PATH;
  process.env.PATH = `${dir};${saved ?? ""}`;
  try {
    const r = await defaultProbeRunner("datapass-fake-cli", ["--version"], 5000);
    assert.deepEqual(r, { ok: true, output: "fake-cli 1.2.3 --version" });
    const refused = await defaultProbeRunner("datapass-fake-cli", ["&", "whoami"], 5000);
    assert.equal(refused.ok, false);
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
