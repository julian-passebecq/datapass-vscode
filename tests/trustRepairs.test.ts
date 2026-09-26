/**
 * 0.22 package A — trust repairs for the FOIL review findings F01–F08. Each case failed (or could
 * not be expressed) on a3c08bf. Synthetic projects only (no FOIL content).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formatCostLine, formatCostTotal, partialLabel, sumCostLines, sumPickedOptions } from "../src/core/project/costs";
import { analyzeOptions, parseOptions } from "../src/core/project/options";
import { optionsMarkdown } from "../src/core/project/optionsReport";
import { buildProjectMap } from "../src/core/project/projectMap";
import { buildPreparationPack, COORDINATED_CHANGE_RULE } from "../src/core/project/preparation";
import { AI_TASKS, exportForAi } from "../src/core/project/aiExchange";
import { COORDINATION_KEY, resolveRepositories, type FileObservation, type RepoObservation } from "../src/core/project/resolve";
import { ByteBudget, HASH_BYTE_BUDGET, hashMode, incompleteness, incompleteText, interpretLsFiles, interpretOrigin, MAX_INLINE_HASH_BYTES, MAX_PLANNED_ENTRIES, MAX_STREAM_HASH_BYTES, OBSERVE_CONCURRENCY, runBounded } from "../src/core/project/observation";
import { upsertQualification } from "../src/core/qualification/qualification";
import type { DataPassProjectManifest } from "../src/core/projectManifestModel";
import { fileObsA, inputA } from "./fixtures/v3/research";
import { optionsAJson } from "./fixtures/v3/researchOptions";

const T = "2026-09-26T02:00:00Z";

// ------------------------------------------------------------------ F01 + F08: costs

test("F01: mixed currencies are kept apart, never added into one number", () => {
  const t = sumCostLines([{ monthly: 10, currency: "EUR" }, { monthly: 5 }], "USD");
  assert.deepEqual(t.monthly, { EUR: 10, USD: 5 });
  const text = formatCostTotal(t);
  assert.match(text, /10 EUR\/month/);
  assert.match(text, /5 USD\/month/);
  assert.doesNotMatch(text, /15/);
});

test("F01: the default currency applies to lines without one; monthly and one-time stay separate", () => {
  const t = sumCostLines([{ monthly: 2, oneTime: 30 }, { oneTime: 20, currency: "CHF" }], "GBP");
  assert.deepEqual(t.monthly, { GBP: 2 });
  assert.deepEqual(t.oneTime, { CHF: 20, GBP: 30 });
  assert.equal(formatCostTotal(t), "≈ 2 GBP/month · ≈ 20 CHF one-time + ≈ 30 GBP one-time");
});

test("F08: a zero line is priced; an unpriced line or option is unknown, never zero, and the total says partial", () => {
  const zero = sumCostLines([{ monthly: 0 }], "USD");
  assert.equal(formatCostTotal(zero), "≈ 0 USD/month");
  assert.equal(partialLabel(zero), "");
  const partial = sumCostLines([{ monthly: 4 }, {}], "USD");
  assert.equal(formatCostTotal(partial), "≈ 4 USD/month · partial: 1 of 2 lines priced");
  const unknown = sumCostLines([{}, {}], "USD");
  assert.equal(formatCostTotal(unknown), "not priced (0 of 2 lines)");
  assert.equal(formatCostTotal(sumCostLines([], "USD")), "no cost declared");
  assert.equal(formatCostLine({}, "USD"), "not priced");
  // Scenario: one decision per part; an option without cost lines makes the total partial.
  const s = sumPickedOptions([{ costs: [{ monthly: 3 }] }, { costs: [] }, { costs: [{ monthly: 1, currency: "EUR" }, {}] }], "USD");
  assert.deepEqual([s.priced, s.total], [1, 3]);
  assert.equal(formatCostTotal(s), "≈ 1 EUR/month + ≈ 3 USD/month · partial: 1 of 3 decisions priced");
});

test("F01 + F08: the options report and the analysis use the same typed aggregation", () => {
  const raw = optionsAJson() as Record<string, any>;
  const d0 = raw.decisions[0];
  const current0 = d0.options.find((x: any) => x.id === d0.current);
  current0.costs = [{ label: "Compute", monthly: 10, currency: "EUR" }, { label: "Storage", monthly: 5 }];
  const d1 = raw.decisions[1];
  delete d1.options.find((x: any) => x.id === d1.current).costs;
  raw.currency = "USD";
  const options = parseOptions(JSON.stringify(raw));
  const analysis = analyzeOptions({ base: inputA(), options });
  const current = analysis.current;
  assert.equal(current.costs.monthly.EUR, 10);
  assert.ok(current.costs.total.priced < current.costs.total.total, "an unpriced decision makes the total partial");
  assert.ok(current.costs.missing.includes(d1.id));
  const md = optionsMarkdown({ options, analysis, purpose: "export", generatedAt: T, dataPassVersion: "0.22.0" }).text;
  assert.match(md, /≈ 10 EUR\/month \+ ≈ 5 USD\/month/, "the option subtotal keeps currencies apart");
  assert.doesNotMatch(md, /≈ 15\/month/);
  assert.match(md, /partial: \d+ of \d+ decisions priced/);
});

// ------------------------------------------------------------------ F02: fingerprints

const withRequirements = (o: FileObservation) => fileObsA({ "functions/extract/requirements.txt": o });

test("F02: size + time is a weak fingerprint; equal size and time with different bytes never match a result", () => {
  const stat: FileObservation = { state: "found", kind: "file", fingerprint: { kind: "stat", size: 3_000_000, mtimeMs: 1_700_000_000_000 } };
  const base = inputA({ fileObservations: withRequirements(stat) });
  const extract = buildProjectMap(base).components.find(c => c.id === "extract")!;
  assert.equal(extract.artifacts!.digestStrength, "weak");
  const op = extract.operations.find(o => o.capability.id === "azure-functions.deploy")!;
  const records = upsertQualification([], { capabilityId: op.capability.id, label: op.label, result: "worked", projectId: "research-library", scopeId: "project", operationKey: op.key, targetDigest: op.result.targetDigest, preflight: "ready", at: T, dataPassVersion: "0.22.0", tools: {} });
  // Same size and time, possibly other bytes: the result is shown, but as stale.
  const again = buildProjectMap({ ...base, qualification: records }).components.find(c => c.id === "extract")!.operations.find(o => o.key === op.key)!;
  assert.equal(again.lastResult?.stale, true);
  // Control: with real digests the same files match their result.
  const exactBase = inputA({ fileObservations: withRequirements({ state: "found", kind: "file", fingerprint: { kind: "sha256", value: "r1" } }) });
  const exactOp = buildProjectMap(exactBase).components.find(c => c.id === "extract")!.operations.find(o => o.key === op.key)!;
  const exactRecords = upsertQualification([], { capabilityId: op.capability.id, label: op.label, result: "worked", projectId: "research-library", scopeId: "project", operationKey: op.key, targetDigest: exactOp.result.targetDigest, preflight: "ready", at: T, dataPassVersion: "0.22.0", tools: {} });
  assert.equal(buildProjectMap({ ...exactBase, qualification: exactRecords }).components.find(c => c.id === "extract")!.artifacts!.digestStrength, "exact");
  assert.equal(buildProjectMap({ ...exactBase, qualification: exactRecords }).components.find(c => c.id === "extract")!.operations.find(o => o.key === op.key)!.lastResult?.stale, false);
});

test("F02: a file whose hash failed makes the digest weak instead of silently dropping it", () => {
  const hashed = buildProjectMap(inputA({ fileObservations: withRequirements({ state: "found", kind: "file", fingerprint: { kind: "sha256", value: "r1" } }) })).components.find(c => c.id === "extract")!.artifacts!;
  const failed = buildProjectMap(inputA({ fileObservations: withRequirements({ state: "found", kind: "file", hashError: "could not be read (EACCES)" }) })).components.find(c => c.id === "extract")!.artifacts!;
  assert.equal(failed.digestStrength, "weak");
  assert.ok(failed.digest && failed.digest !== hashed.digest);
});

test("F02: hashing is bounded; beyond the budget a file is identified by size and time only", () => {
  const b = new ByteBudget(HASH_BYTE_BUDGET);
  assert.equal(hashMode(1000, b), "inline");
  assert.equal(hashMode(MAX_INLINE_HASH_BYTES + 1, b), "stream");
  assert.equal(hashMode(MAX_STREAM_HASH_BYTES + 1, b), "stat");
  const small = new ByteBudget(10);
  assert.equal(hashMode(8, small), "inline");
  assert.equal(hashMode(8, small), "stat", "the second file does not fit");
  assert.equal(small.denied, 1);
});

// ------------------------------------------------------------------ F03: Git tracking

test("F03: git missing, an error or cut-short output leave tracking unknown, never untracked", () => {
  const paths = ["local.settings.json", "sub/.env"];
  for (const answer of [undefined, { ok: false, stdout: "", stderr: "spawn git ENOENT" }, { ok: false, stdout: "", stderr: "fatal: not a git repository" }, { ok: true, stdout: "local.settings.json\0sub/.e" }]) {
    for (const [, t] of interpretLsFiles(paths, answer)) assert.equal(t.state, "unknown", JSON.stringify(answer));
  }
  const ok = interpretLsFiles(paths, { ok: true, stdout: "local.settings.json\0" }, false);
  assert.equal(ok.get("local.settings.json")!.state, "tracked");
  assert.equal(ok.get("sub/.env")!.state, "untracked");
  assert.equal(interpretLsFiles(paths, { ok: true, stdout: "" }).get("sub/.env")!.state, "untracked");
});

test("F03: an unknown tracking state is reported, not counted as clean", () => {
  const files = fileObsA({ "functions/extract/local.settings.json": { state: "found", kind: "file", tracking: { state: "unknown", reason: "git ls-files failed" } } });
  const map = buildProjectMap(inputA({ fileObservations: files }));
  const m = map.components.find(c => c.id === "extract")!.artifacts!.mustNotCommit[0]!;
  assert.equal(m.tracking, "unknown");
  assert.equal(m.tracked, false);
  assert.equal(m.trackingReason, "git ls-files failed");
  const p = map.problems.find(x => /could not check Git tracking of local.settings.json/.test(x.message));
  assert.equal(p?.severity, "warning");
  const pack = buildPreparationPack({ map, question: "explain", dataPassVersion: "0.22.0", generatedAt: T });
  assert.match(pack.text, /Git tracking could not be checked/);
});

// ------------------------------------------------------------------ F04: repository identity

const manifest = (remote?: string): DataPassProjectManifest => ({
  schemaVersion: 3, project: { id: "p", title: "P" },
  repositories: { code: { label: "Code", path: "../code", ...(remote ? { remote: { url: remote } } : {}) } }
} as unknown as DataPassProjectManifest);
const obs = (git: RepoObservation["git"]): Map<string, RepoObservation> => new Map([["code", { key: "code", folder: "/w/code", source: "declared-path", exists: true, isGitRepo: true, git }]]);
const stateOf = (remote: string | undefined, git: RepoObservation["git"]) => resolveRepositories(manifest(remote), obs(git), COORDINATION_KEY).find(r => r.key === "code")!;

test("F04: a declared remote with no origin, or a failed lookup, is unverified — never local", () => {
  const url = "https://github.com/example-org/code.git";
  const absent = stateOf(url, { branch: "main", head: "a".repeat(40), originLookup: "absent" });
  assert.equal(absent.state, "unverified");
  assert.match(absent.detail, /no origin/);
  const failed = stateOf(url, { branch: "main", originLookup: "failed" });
  assert.equal(failed.state, "unverified");
  assert.match(failed.nextStep ?? "", /Retry/);
  assert.equal(stateOf(url, { originUrl: "https://github.com/other/code.git", originLookup: "ok" }).state, "wrong-remote");
  assert.equal(stateOf(url, { originUrl: "git@github.com:example-org/code.git", originLookup: "ok" }).state, "local", "SSH and HTTPS forms are the same repository");
  assert.equal(stateOf(undefined, { originLookup: "absent" }).state, "local", "a repository declared without a remote stays local");
});

test("F04: an unverified repository blocks what relies on its identity", () => {
  const input = inputA();
  const repos = new Map(input.repoObservations);
  const p = repos.get("pipeline")!;
  repos.set("pipeline", { ...p, git: { ...p.git!, originUrl: undefined, originLookup: "failed" } });
  const map = buildProjectMap({ ...input, repoObservations: repos });
  assert.equal(map.repositories.find(r => r.key === "pipeline")!.state, "unverified");
  const extract = map.components.find(c => c.id === "extract")!;
  assert.equal(extract.health, "attention");
  assert.notEqual(extract.artifacts!.availability, "unbound", "its files can still be browsed");
  const deploy = extract.operations.find(o => o.capability.id === "azure-functions.deploy")!;
  assert.notEqual(deploy.result.status, "ready");
});

test("F04: interpreting the origin lookup", () => {
  assert.deepEqual(interpretOrigin({ ok: true, stdout: "https://x/y.git\n" }), { originUrl: "https://x/y.git", originLookup: "ok" });
  assert.deepEqual(interpretOrigin({ ok: false, stdout: "" }, { ok: true, stdout: "upstream\n" }), { originLookup: "absent" });
  assert.deepEqual(interpretOrigin({ ok: false, stdout: "" }, { ok: true, stdout: "" }), { originLookup: "absent" });
  assert.deepEqual(interpretOrigin({ ok: false, stdout: "" }, { ok: true, stdout: "origin\n" }), { originLookup: "failed" });
  assert.deepEqual(interpretOrigin({ ok: false, stdout: "" }, { ok: false, stdout: "" }), { originLookup: "failed" });
  assert.deepEqual(interpretOrigin({ ok: false, stdout: "" }), { originLookup: "failed" });
});

// ------------------------------------------------------------------ F05: bounded observation

test("F05: 2,000+ planned entries run through a bounded queue and the rest is reported", async () => {
  let inFlight = 0, peak = 0;
  const items = Array.from({ length: 2500 }, (_, i) => i);
  const out = await runBounded(items, OBSERVE_CONCURRENCY, async i => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise(r => setImmediate(r));
    inFlight--;
    return i * 2;
  });
  assert.ok(peak <= OBSERVE_CONCURRENCY, `peak ${peak}`);
  assert.equal(out[2499], 4998);
  const inc = incompleteness({ planned: 2500, max: MAX_PLANNED_ENTRIES, statOnly: 3 })!;
  assert.equal(inc.skipped, 500);
  assert.match(incompleteText(inc), /^inspection incomplete \(500 skipped\)/);
  assert.equal(incompleteness({ planned: 10, max: MAX_PLANNED_ENTRIES, statOnly: 0 }), undefined);
  const map = buildProjectMap(inputA({ observationIncomplete: incompleteText(inc) }));
  assert.ok(map.problems.some(p => p.severity === "warning" && /inspection incomplete \(500 skipped\)/.test(p.message)));
});

// ------------------------------------------------------------------ F06: prompts

test("F06: a merged PR moves a card to review, not done; no beginner or fixed sprint assumption", () => {
  const update = AI_TASKS.board.find(t => t.id === "update")!.ask;
  assert.match(update, /\\"review\\"|"review"/);
  assert.match(update, /not that the card is done/);
  assert.doesNotMatch(update, /to the done column/);
  const sprint = AI_TASKS.board.find(t => t.id === "sprint")!.ask;
  assert.doesNotMatch(sprint, /two weeks|one person/);
  const all = Object.values(AI_TASKS).flat().map(t => t.ask).join("\n");
  assert.doesNotMatch(all, /beginner/i);
  for (const f of ["aiExchange", "optionsReport", "boardPack", "preparation"]) {
    assert.doesNotMatch(readFileSync(`src/core/project/${f}.ts`, "utf8"), /beginner in cloud engineering|I am a beginner/i, f);
  }
  const options = parseOptions(JSON.stringify(optionsAJson()));
  const compare = optionsMarkdown({ options, analysis: analyzeOptions({ base: inputA(), options }), purpose: "compare", generatedAt: T, dataPassVersion: "0.22.0" }).text;
  assert.doesNotMatch(compare, /beginner/i);
  assert.match(exportForAi("board", undefined, AI_TASKS.board[0]!, { dataPassVersion: "0.22.0" }), /review/);
});

// ------------------------------------------------------------------ F07: coordinated change sets

test("F07: one PR per repository plus a separate bridge PR; never the same PR across repositories", () => {
  const pack = buildPreparationPack({ map: buildProjectMap(inputA()), question: "explain", dataPassVersion: "0.22.0", generatedAt: T });
  assert.ok(pack.text.includes(COORDINATED_CHANGE_RULE));
  assert.match(COORDINATED_CHANGE_RULE, /bridge pull request/);
  for (const f of ["docs/guide/02_WHAT_THE_AI_PREPARES.md", "docs/guide/05_THE_LOOPS.md", "docs/PREPARING_A_PROJECT.md"]) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /in the same (pull request|PR)\b(?! when)/i, f);
    assert.match(text, /coordinated change set/, f);
  }
  assert.match(readFileSync("docs/guide/02_WHAT_THE_AI_PREPARES.md", "utf8"), /bridge repository \(coordination repository\)/);
});
