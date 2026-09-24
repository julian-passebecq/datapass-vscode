import assert from "node:assert/strict";
import test from "node:test";
import { vetRelativePath, resolveWithinRoot } from "../src/core/exchange/pathSafety";
import { buildAppRequest, assessAppResult } from "../src/core/exchange/appExchange";
import { applyWithJournal, rollbackJournal, type JournalFs } from "../src/core/exchange/journal";
import { sha256Bytes } from "../src/core/model/ids";

const H = sha256Bytes("fixture");
const T = "2026-09-24T10:00:00Z";
const base = { scopeRevision: "r1", manifestHash: H, repositories: [{ repoRef: "app", revision: "abc123", workingTreeHash: H }] };

function request() {
  return buildAppRequest({
    id: "req-1", projectRef: "sample-retail", scopeRef: "analytics", base, classification: "internal",
    createdAt: T, sources: [], appRef: "sales-streamlit", operation: "prepare-candidate", inputRefs: ["orders-snapshot"]
  });
}

function resultFor(bytes: Uint8Array, artifactBytes: Uint8Array) {
  const req = JSON.parse(new TextDecoder().decode(bytes));
  req.id = "res-1";
  Object.assign(req.payload, {
    direction: "result", resultState: "succeeded", executionEvidenceRef: "run-log-1",
    requestHash: sha256Bytes(bytes),
    outputArtifacts: [{ id: "candidate-1", locatorRef: "candidate-1", mediaType: "application/json", schemaRef: "sample.candidate/1",
      byteHash: sha256Bytes(artifactBytes), inputRefs: ["orders-snapshot"], producerRef: "sales-streamlit" }]
  });
  return req;
}

test("path policy rejects traversal, absolute, URI, .git and non-portable names", () => {
  for (const p of ["../x", "a/../../x", "/etc/passwd", "C:\\x", "\\\\server\\share", "~/x", "file:///x", "vscode-remote://ssh/x", ".git/config", "a/b.", "a/con?", "a\0b", ""]) {
    assert.equal(vetRelativePath(p).ok, false, p);
  }
});

test("path policy flags executable setup files as high-risk without blocking them", () => {
  for (const p of [".vscode/tasks.json", ".vscode/mcp.json", ".devcontainer/devcontainer.json", ".github/workflows/ci.yml", "package.json", "scripts/run.sh", ".env", "databricks.yml", "infra/main.tf", ".datapass/project.json"]) {
    const v = vetRelativePath(p);
    assert.ok(v.ok && v.risk === "high", p);
  }
  const normal = vetRelativePath("notebooks\\analysis.ipynb");
  assert.ok(normal.ok && normal.risk === "normal" && normal.relative === "notebooks/analysis.ipynb");
});

test("resolveWithinRoot rejects a symlink that escapes the root", async () => {
  const real: Record<string, string> = { "/ws": "/ws", "/ws/link": "/elsewhere", "/ws/ok": "/ws/ok" };
  const realpath = async (p: string) => real[p];
  assert.deepEqual(await resolveWithinRoot("/ws", "link/file.json", realpath), { ok: false, reason: "symlink escapes root" });
  assert.deepEqual(await resolveWithinRoot("/ws", "ok/new.json", realpath), { ok: true, absolute: "/ws/ok/new.json" });
  assert.deepEqual(await resolveWithinRoot("/ws", "fresh/dir/new.json", realpath), { ok: true, absolute: "/ws/fresh/dir/new.json" });
});

test("a correlated result with matching artifact bytes becomes a candidate, not an accepted state", () => {
  const rq = request();
  const artifact = new TextEncoder().encode('{"candidate":true}');
  const out = assessAppResult(rq.bytes, JSON.stringify(resultFor(rq.bytes, artifact)), new Map([["candidate-1", artifact]]), T);
  assert.equal(out.status, "candidate");
  assert.equal(out.artifacts[0]?.state, "verified");
  assert.ok(out.observations.some(o => o.kind === "reported-by-external" && /not verified/.test(o.limits)));
  assert.ok(!out.observations.some(o => o.kind === "runtime-observed"), "an external 'succeeded' is never a runtime observation");
});

test("wrong base, tampered artifact, undeclared file and garbage are quarantined", () => {
  const rq = request();
  const artifact = new TextEncoder().encode("{}");
  const stale = resultFor(rq.bytes, artifact); stale.base.scopeRevision = "r2";
  assert.equal(assessAppResult(rq.bytes, JSON.stringify(stale), new Map(), T).status, "quarantined");
  const good = JSON.stringify(resultFor(rq.bytes, artifact));
  assert.equal(assessAppResult(rq.bytes, good, new Map([["candidate-1", new TextEncoder().encode("{ }")]]), T).status, "quarantined");
  assert.equal(assessAppResult(rq.bytes, good, new Map([["candidate-1", artifact], ["surprise", artifact]]), T).status, "quarantined");
  assert.equal(assessAppResult(rq.bytes, "{not json", new Map(), T).status, "quarantined");
  assert.equal(assessAppResult(rq.bytes, good.replace('"res-1"', '"res-1", "id": "dup"'), new Map(), T).status, "quarantined");
});

test("request bytes are frozen and hashed without self-reference", () => {
  const rq = request();
  assert.equal(rq.envelope.payload.requestHash, null);
  assert.equal(rq.digest.value, sha256Bytes(rq.bytes).value);
  assert.ok(new TextDecoder().decode(rq.bytes).endsWith("}\n"));
});

function memFs(initial: Record<string, string> = {}, failOn?: string): JournalFs & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(initial)) files.set(k, new TextEncoder().encode(v));
  return {
    files,
    async read(p) { return files.get(p); },
    async write(p, b) { if (p === failOn) throw new Error("disk full"); files.set(p, b); },
    async remove(p) { files.delete(p); }
  };
}

test("journal refuses when the reviewed base changed and writes nothing", async () => {
  const fs = memFs({ "a.json": "changed" });
  await assert.rejects(applyWithJournal(fs, "j.json", "j1", T, [{ target: "a.json", bytes: new TextEncoder().encode("new"), expectedBaseHash: sha256Bytes("old").value }]), /Base changed/);
  assert.equal(fs.files.has("j.json"), false);
});

test("interrupted multi-file apply is reported partial and rolls back cleanly", async () => {
  const fs = memFs({ "a.json": "old-a" }, "b.json");
  const writes = [
    { target: "a.json", bytes: new TextEncoder().encode("new-a"), expectedBaseHash: sha256Bytes("old-a").value },
    { target: "b.json", bytes: new TextEncoder().encode("new-b"), expectedBaseHash: null }
  ];
  await assert.rejects(applyWithJournal(fs, "j.json", "j1", T, writes), /Partial application/);
  assert.equal(JSON.parse(new TextDecoder().decode(fs.files.get("j.json")!)).state, "partial");
  const rolled = await rollbackJournal(fs, "j.json");
  assert.equal(rolled.state, "rolled-back");
  assert.equal(new TextDecoder().decode(fs.files.get("a.json")!), "old-a");
  assert.equal(fs.files.has("b.json"), false);
});
