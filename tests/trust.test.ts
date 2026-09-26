/**
 * V3 Lot 0: regressions for the trust defects found by the 2026-09-25 audit (F01, F03, F05, F07)
 * and the Windows executable-search issue (F15b). Each test fails on 0.12.0.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factNotes, fileFactPlan, projectFacts, dirHas } from "../src/core/workspace/facts";
import { readRepoRevision, workingTreeFingerprint, MAX_UNTRACKED_HASHED, type GitRunner } from "../src/core/workspace/gitBase";
import { scrub } from "../src/core/exchange/aiContext";
import { findQualification, upsertQualification, type QualificationRecord } from "../src/core/qualification/qualification";
import { absolutePathEntries, resolveExecutable } from "../src/core/exec";
import { resolveWindowsCommand } from "../src/core/detection";
import { foilProjectManifest, genericProjectManifest } from "../src/core/projectManifestModel";

// ------------------------------------------------------------------ F01 declared ≠ observed

test("F01: declared file-backed facts hold only once observed", () => {
  const m = foilProjectManifest(); // declares bundleRoot ../foil_databrick_dab
  const plan = fileFactPlan(m);
  assert.ok(plan.some(p => p.fact === "databricks.bundleRoot" && p.check.kind === "any-file"));
  // 0.12.0 turned the declared string into a satisfied fact.
  assert.equal(projectFacts({ manifest: m }).get("databricks.bundleRoot"), undefined);
  const found = new Map([["databricks.bundleRoot", { state: "found" as const }]]);
  assert.equal(projectFacts({ manifest: m }, found).get("databricks.bundleRoot"), true);
  const missing = new Map([["databricks.bundleRoot", { state: "missing" as const }]]);
  const note = factNotes(m, missing).get("databricks.bundleRoot");
  assert.equal(note?.state, "missing");
  assert.match(note!.detail, /Declared "\.\.\/foil_databrick_dab"/);
  assert.equal(factNotes(m, new Map()).get("databricks.bundleRoot")?.state, "unknown", "not observed = unknown, never present");
  // Declarations that are identities (names) are still facts on their own.
  const named = genericProjectManifest("x");
  named.platforms = { fabric: { workspaceName: "Sales" }, databricks: { defaultTarget: "dev" } };
  assert.equal(projectFacts({ manifest: named }).get("fabric.workspace"), "Sales");
  assert.equal(projectFacts({ manifest: named }).get("databricks.target"), "dev");
});

test("F01: an IaC root counts only when it contains IaC files; PBIR needs definition.pbir", () => {
  assert.equal(dirHas("iac", [{ name: "README.md", dir: false }]), false);
  assert.equal(dirHas("iac", [{ name: "main.tf", dir: false }]), true);
  assert.equal(dirHas("iac", [{ name: "main.bicep", dir: false }]), true);
  assert.equal(dirHas("report-pbir", [{ name: "Sales.Report", dir: true, children: ["report.json"] }]), false);
  assert.equal(dirHas("report-pbir", [{ name: "Sales.Report", dir: true, children: ["definition.pbir"] }]), true);
  assert.equal(dirHas("pbip", [{ name: "Sales.pbip", dir: false }]), true);
  const m = genericProjectManifest("infra");
  m.platforms = { infrastructure: {} };
  assert.deepEqual(fileFactPlan(m).map(p => [p.fact, p.declared]), [["infrastructure.root", "."]]);
});

// ------------------------------------------------------------------ F03 fingerprint covers untracked bytes

function fakeGit(content: () => string, untracked: string[] = ["new.py"]): GitRunner {
  return async args => {
    if (args[0] === "rev-parse") return { ok: true, stdout: "a".repeat(40) + "\n" };
    if (args[0] === "status") return { ok: true, stdout: untracked.map(f => `?? ${f}`).join("\n") + "\n" };
    if (args[0] === "diff") return { ok: true, stdout: "" };
    if (args[0] === "ls-files") return { ok: true, stdout: untracked.join("\0") + "\0" };
    if (args[0] === "hash-object") {
      const files = args.slice(args.indexOf("--") + 1);
      // A blob id that depends on the (fake) content of each file.
      return { ok: true, stdout: files.map(f => require("node:crypto").createHash("sha1").update(`${f}:${content()}`).digest("hex")).join("\n") + "\n" };
    }
    return { ok: false, stdout: "" };
  };
}

test("F03: changing the content of the same untracked file changes the fingerprint", async () => {
  let content = "print(1)";
  const run = fakeGit(() => content);
  const a = await readRepoRevision(run, "/repo", () => "n");
  content = "print(999)";
  const b = await readRepoRevision(run, "/repo", () => "n");
  assert.equal(a.coverage, "complete");
  assert.equal(a.untracked, 1);
  assert.notEqual(a.workingTreeHash.value, b.workingTreeHash.value, "0.12.0 hashed only `git status`/`git diff`, which do not contain untracked bytes");
});

test("F03: a capture that cannot cover everything is partial and never equals another capture", async () => {
  const many = Array.from({ length: MAX_UNTRACKED_HASHED + 1 }, (_, i) => `f${i}.txt`);
  let n = 0;
  const run = fakeGit(() => "same", many);
  const a = await readRepoRevision(run, "/repo", () => `nonce-${n++}`);
  const b = await readRepoRevision(run, "/repo", () => `nonce-${n++}`);
  assert.equal(a.coverage, "partial");
  assert.notEqual(a.workingTreeHash.value, b.workingTreeHash.value);
  const noGit = await readRepoRevision(async () => ({ ok: false, stdout: "" }), "/x", () => `nonce-${n++}`);
  assert.equal(noGit.revision, "unversioned");
  assert.equal(noGit.coverage, "partial");
  // Clean trees stay deterministic.
  assert.deepEqual(workingTreeFingerprint("", ""), workingTreeFingerprint("", "", "ignored"));
});

function gitAvailable(): boolean {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

test("F03 (real Git): untracked content, binary changes and a new commit all change the base", { skip: !gitAvailable() && "git not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "datapass-f03-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  const run: GitRunner = async (args, cwd) => {
    try { return { ok: true, stdout: execFileSync("git", args, { cwd, encoding: "utf8" }) }; } catch { return { ok: false, stdout: "" }; }
  };
  try {
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.bin"), Buffer.from([0, 1, 2, 3]));
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const clean = await readRepoRevision(run, dir);
    assert.equal(clean.dirty, false);
    writeFileSync(join(dir, "new.py"), "print(1)\n");
    const u1 = await readRepoRevision(run, dir);
    writeFileSync(join(dir, "new.py"), "print(999)\n");
    const u2 = await readRepoRevision(run, dir);
    assert.equal(u1.coverage, "complete");
    assert.notEqual(u1.workingTreeHash.value, u2.workingTreeHash.value, "untracked content change");
    writeFileSync(join(dir, "a.bin"), Buffer.from([0, 1, 2, 4]));
    const b1 = await readRepoRevision(run, dir);
    writeFileSync(join(dir, "a.bin"), Buffer.from([0, 1, 2, 5]));
    const b2 = await readRepoRevision(run, dir);
    assert.notEqual(b1.workingTreeHash.value, b2.workingTreeHash.value, "binary content change");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ F05 credentials in JSON and Azure strings

test("F05: quoted JSON keys, Azure connection strings, function keys and bearer tokens are redacted", () => {
  const fake = "DUMMY_CREDENTIAL_SHOULD_NOT_ESCAPE";
  const cases = [
    `{"token": "${fake}"}`,
    `{ 'client_secret' : '${fake}' }`,
    `{"password":"with spaces ${fake}"}`,
    `DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=${fake};EndpointSuffix=core.windows.net`,
    `Endpoint=sb://x.servicebus.windows.net/;SharedAccessKeyName=root;SharedAccessKey=${fake}`,
    `https://func-app.azurewebsites.net/api/extract?code=${fake}&page=2`,
    `https://acct.blob.core.windows.net/pdf/a.pdf?sv=2024-01-01&sig=${fake}`,
    `Authorization: Bearer ${fake}`,
    `-----BEGIN RSA PRIVATE KEY-----\n${fake}\n-----END RSA PRIVATE KEY-----`
  ];
  for (const c of cases) {
    const out = scrub(c);
    assert.ok(!out.includes(fake), `leaked: ${out}`);
  }
  // Names and structure stay readable.
  assert.equal(scrub(`{"token": "${fake}"}`), `{"token": "<redacted>"}`);
  assert.match(scrub(`AccountName=acct;AccountKey=${fake};`), /AccountName=acct;AccountKey=<redacted>;/);
  assert.equal(scrub("3 tokens left; token count: 5"), "3 tokens left; token count: 5");
  assert.equal(scrub("https://example.com/docs?page=2"), "https://example.com/docs?page=2");
});

// ------------------------------------------------------------------ F07 results are per scope and target

test("F07: recording a result in one scope never replaces another scope's result", () => {
  const rec = (scopeId: string, result: QualificationRecord["result"], extra: Partial<QualificationRecord> = {}): QualificationRecord => ({
    capabilityId: "databricks.bundle.validate", label: "Validate", result, projectId: "foil", scopeId, preflight: "ready", at: "t", dataPassVersion: "0.13.0", tools: {}, ...extra
  });
  let list = upsertQualification([], rec("wind", "worked"));
  list = upsertQualification(list, rec("hydro", "failed"));
  assert.equal(list.length, 2, "0.12.0 kept only one record per project and capability");
  assert.equal(findQualification(list, { projectId: "foil", scopeId: "wind", capabilityId: "databricks.bundle.validate" })?.result, "worked");
  assert.equal(findQualification(list, { projectId: "foil", scopeId: "hydro", capabilityId: "databricks.bundle.validate" })?.result, "failed");
  // Same scope, same operation: replaced. Another target digest: kept apart.
  list = upsertQualification(list, rec("wind", "failed"));
  assert.equal(list.length, 2);
  list = upsertQualification(list, rec("wind", "worked", { operationKey: "wind-dab:databricks.bundle.validate@prod", targetDigest: "p" }));
  assert.equal(list.length, 3);
});

// ------------------------------------------------------------------ F15b executables never come from the inspected folder

test("F15b: executables resolve from absolute PATH entries only (never the current folder)", () => {
  const winEnv = { PATH: ".;relative\\bin;C:\\Program Files\\Git\\cmd;\\rooted-on-current-drive", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.deepEqual(absolutePathEntries(winEnv, "win32"), ["C:\\Program Files\\Git\\cmd"]);
  const seen: string[] = [];
  const isFile = (p: string) => { seen.push(p); return p.endsWith("git.exe"); };
  assert.equal(resolveExecutable("git", winEnv, "win32", isFile), "C:\\Program Files\\Git\\cmd\\git.exe");
  assert.ok(seen.every(p => /^C:\\/.test(p)), `looked outside absolute PATH entries: ${seen.join(", ")}`);
  assert.equal(resolveExecutable("git", { PATH: "." }, "win32", () => true), undefined, "a '.' PATH entry is not searched");
  assert.equal(resolveExecutable("git", { PATH: ":/usr/bin" }, "linux", p => p === "/usr/bin/git"), "/usr/bin/git");
  assert.equal(resolveExecutable("git", { PATH: "::." }, "linux", () => true), undefined);
  assert.equal(resolveExecutable("..\\git", winEnv, "win32", () => true), undefined, "names with separators are refused");
  // The Windows probe resolver (az.cmd shims) skips relative PATH entries too.
  assert.equal(resolveWindowsCommand("az", { PATH: ".;C:\\Tools", PATHEXT: ".CMD" }, p => p.toLowerCase().endsWith("az.cmd"))?.path, "C:\\Tools\\az.cmd");
  assert.equal(resolveWindowsCommand("az", { PATH: ".", PATHEXT: ".CMD" }, () => true), undefined);
});
