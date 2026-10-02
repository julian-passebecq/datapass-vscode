/**
 * EVPIN1: a verdict pinned to the file state it was computed on ({gitSha, artifactDigest}, Common
 * project-contracts evidence-pin/1) and marked stale when the file changes. Real `git hash-object`
 * output from a scratch repository checks the Git-native side.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validatePinnedVerdict } from "@juliandatapass-group/project-contracts";
import { artifactDigest, currentFileState, pinProvenanceText, pinVerdict, refreshVerdict, stampPin } from "../src/core/evidence/pin";
import { fileBlobArgs, parseBlobSha } from "../src/core/git/fileVersions";

const enc = (s: string) => new TextEncoder().encode(s);
const input = { subjectKey: "dp:claim:orders", verdict: "confirmed" as const, evidenceIds: [`datapass:evidence:${"e".repeat(64)}`], computedAt: "2026-10-01T05:00:00Z" };

const SHA = "c".repeat(40);

test("the host's git hash-object output is read by parseBlobSha and pinned as is", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "evpin-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const body = "select 1 as id\n";
    writeFileSync(path.join(dir, "orders.sql"), body);
    const out = execFileSync("git", fileBlobArgs("orders.sql"), { cwd: dir, encoding: "utf8" });
    const sha = parseBlobSha(out);
    assert.match(sha ?? "", /^[0-9a-f]{40}$/);
    assert.deepEqual(currentFileState(readFileSync(path.join(dir, "orders.sql")), sha)?.gitSha, { algorithm: "git-sha1", oid: sha });
    assert.deepEqual(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim(), "?? orders.sql", "nothing written to the index");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(parseBlobSha("not a sha\n"), null);
  assert.equal(parseBlobSha(`${"a".repeat(64)}\n`), "a".repeat(64));
});

test("without a host hash-object the Git id is null, never guessed from the working bytes", () => {
  assert.equal(currentFileState(enc("a\r\n"))?.gitSha, null);
});

test("a verdict is stamped with the file state and validates against the pinned-verdict/1 contract", () => {
  const bytes = enc("select 1\n");
  const v = pinVerdict(input, currentFileState(bytes, SHA));
  assert.equal(v.freshness, "current");
  assert.deepEqual({ ...v.pin?.gitSha }, { algorithm: "git-sha1", oid: SHA });
  assert.equal(v.pin?.artifactDigest.value, artifactDigest(bytes).value);
  assert.equal(validatePinnedVerdict(v).ok, true);
  assert.equal(pinProvenanceText(v).text, "pinned · ccccccc");
});

test("an edited file makes the verdict stale; the unchanged file keeps it current", () => {
  const v = pinVerdict(input, currentFileState(enc("select 1\n"), SHA));
  assert.equal(refreshVerdict(v, currentFileState(enc("select 1\n"), SHA)).freshness, "current");
  const stale = refreshVerdict(v, currentFileState(enc("select 2\n"), SHA));
  assert.equal(stale.freshness, "stale");
  assert.equal(v.freshness, "current", "refresh does not mutate the record");
  const line = pinProvenanceText(stale);
  assert.equal(line.state, "stale");
  assert.match(line.text, /^stale · computed on [0-9a-f]{7}$/);
});

test("an uncommitted edit with the same Git SHA is stale (the exact-bytes digest decides)", () => {
  const v = pinVerdict(input, currentFileState(enc("a\n"), "b".repeat(40)));
  assert.equal(refreshVerdict(v, currentFileState(enc("a, edited\n"), "b".repeat(40))).freshness, "stale");
});

test("a deleted file is stale; an unreadable file at compute time leaves the verdict unpinned", () => {
  const v = pinVerdict(input, currentFileState(enc("x\n")));
  assert.equal(refreshVerdict(v, currentFileState(null)).freshness, "stale");
  const u = pinVerdict(input, currentFileState(null));
  assert.equal(u.pin, null);
  assert.equal(u.freshness, "unpinned");
  assert.equal(refreshVerdict(u, currentFileState(enc("x\n"))).freshness, "unpinned");
  assert.equal(pinProvenanceText(u).text, "unpinned");
  assert.equal(stampPin(null), null);
});

test("a file not in Git yet is pinned by digest only", () => {
  const v = pinVerdict(input, currentFileState(enc("new\n"), null));
  assert.equal(v.pin?.gitSha, null);
  assert.equal(pinProvenanceText(v).text, "pinned · digest only");
  assert.equal(refreshVerdict(v, currentFileState(enc("new\n"), null)).freshness, "current");
});

test("an invalid verdict is refused", () => {
  assert.throws(() => pinVerdict({ ...input, subjectKey: "not a key" }, currentFileState(enc("x"))), /Invalid pinned verdict/);
});

test("the local pinned-verdict/1 stub refuses incoherent or extra fields", () => {
  const v = pinVerdict(input, currentFileState(enc("x"), SHA));
  assert.equal(validatePinnedVerdict({ ...v, freshness: "unpinned" }).ok, false);
  assert.equal(validatePinnedVerdict({ ...v, extra: 1 }).ok, false);
  assert.equal(validatePinnedVerdict({ ...v, pin: { ...v.pin, gitSha: "ABC" } }).ok, false);
  // Reviewed wire shape: a bare-hex gitSha and a free-text computedAt are refused.
  assert.equal(validatePinnedVerdict({ ...v, pin: { ...v.pin, gitSha: SHA } }).ok, false);
  assert.equal(validatePinnedVerdict({ ...v, pin: { ...v.pin, gitSha: { algorithm: "git-sha256", oid: SHA } } }).ok, false);
  assert.equal(validatePinnedVerdict({ ...v, computedAt: "yesterday" }).ok, false);
  assert.equal(validatePinnedVerdict({ ...v, evidenceIds: ["datapass:evidence:x"] }).ok, false);
});
