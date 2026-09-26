import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { boundedRead, classifyReadError, PROJECT_FILE_MAX_BYTES, type ReadPort } from "../src/core/model/boundedRead";
import { parseStrictJson } from "../src/core/model/strictJson";

function nodePort(file: string): ReadPort {
  return {
    stat: async () => { const s = await fs.stat(file); return { size: s.size, isFile: s.isFile() }; },
    read: async () => new Uint8Array(await fs.readFile(file))
  };
}

function fsError(code: string, name?: string): Error {
  return Object.assign(new Error(`${code}: simulated`), { code, ...(name ? { name } : {}) });
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dp-load-"));
}

test("a valid file reads as ok with its exact bytes", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "graph.json");
  await fs.writeFile(file, "{\"a\":1}");
  const got = await boundedRead(nodePort(file), PROJECT_FILE_MAX_BYTES);
  assert.equal(got.kind, "ok");
  assert.equal(new TextDecoder().decode((got as { bytes: Uint8Array }).bytes), "{\"a\":1}");
});

test("a missing file is absent, not an error", async () => {
  const dir = await tempDir();
  assert.deepEqual(await boundedRead(nodePort(path.join(dir, "nope.json")), PROJECT_FILE_MAX_BYTES), { kind: "absent" });
});

test("an oversized file is a too-large error and is never read", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "board.json");
  await fs.writeFile(file, "x".repeat(2048));
  let reads = 0;
  const port = nodePort(file);
  const got = await boundedRead({ stat: port.stat, read: async () => { reads++; return port.read(); } }, 1024);
  assert.equal(got.kind, "error");
  assert.equal((got as { reason: string }).reason, "too-large");
  assert.match((got as { message: string }).message, /2048 bytes, limit 1024/);
  assert.equal(reads, 0);
});

test("a file that grows past the bound between stat and read is too large", async () => {
  const got = await boundedRead({ stat: async () => ({ size: 10, isFile: true }), read: async () => new Uint8Array(100) }, 50);
  assert.equal(got.kind === "error" && got.reason, "too-large");
});

test("a directory where a file is expected is not-a-file", async () => {
  const dir = await tempDir();
  const sub = path.join(dir, "options.json");
  await fs.mkdir(sub);
  const got = await boundedRead(nodePort(sub), PROJECT_FILE_MAX_BYTES);
  assert.equal(got.kind === "error" && got.reason, "not-a-file");
});

test("permission denied is an error, never absent (Node and VS Code codes)", async () => {
  for (const err of [fsError("EACCES"), fsError("EPERM"), fsError("NoPermissions", "NoPermissions (FileSystemError)")]) {
    const onStat = await boundedRead({ stat: async () => { throw err; }, read: async () => new Uint8Array() }, 10);
    assert.equal(onStat.kind === "error" && onStat.reason, "permission-denied");
    const onRead = await boundedRead({ stat: async () => ({ size: 1, isFile: true }), read: async () => { throw err; } }, 10);
    assert.equal(onRead.kind === "error" && onRead.reason, "permission-denied");
  }
});

test("an unknown I/O failure is unreadable, never absent", async () => {
  const got = await boundedRead({ stat: async () => { throw fsError("EIO"); }, read: async () => new Uint8Array() }, 10);
  assert.equal(got.kind, "error");
  assert.equal((got as { reason: string }).reason, "unreadable");
  assert.match((got as { message: string }).message, /could not be read.*EIO/);
});

test("classifyReadError maps VS Code FileSystemError codes", () => {
  assert.equal(classifyReadError(fsError("FileNotFound", "EntryNotFound (FileSystemError)")), "absent");
  assert.equal(classifyReadError(fsError("ENOENT")), "absent");
  assert.equal(classifyReadError(fsError("FileIsADirectory")), "not-a-file");
  assert.equal(classifyReadError(fsError("EISDIR")), "not-a-file");
  assert.equal(classifyReadError(fsError("Unavailable")), "unreadable");
  assert.equal(classifyReadError("boom"), "unreadable");
});

test("invalid JSON reads fine and fails in the strict parser (reported, not absent)", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "sheet.json");
  await fs.writeFile(file, "{\"a\":1,\"a\":2}");
  const got = await boundedRead(nodePort(file), PROJECT_FILE_MAX_BYTES);
  assert.equal(got.kind, "ok");
  assert.throws(() => parseStrictJson((got as { bytes: Uint8Array }).bytes));
});
