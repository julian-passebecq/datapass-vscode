/**
 * V4-NAVCODE1: the code link's pure side — span resolution with typed holes, clamping to the file,
 * hole texts from data, the innermost location under the cursor, and the Hop step provider.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { clampSpan, holeMessage, hopStepProvider, innermostAt, isHole, ladderSpanProvider, resolveSpan, type CodeLinkLadder, type CodeSpanProvider, type SourceSpan } from "../src/core/navigation/codeLink";
import type { NavLocation } from "../src/core/navigation/navTypes";

const FILE = "C:\\proj\\jobs\\load.py";
const loc = (level: NavLocation["level"], nodeId: string): NavLocation => ({ level, nodeId, artifactKind: "spark-job" });
const span = (startLine: number, endLine: number, extra: Partial<SourceSpan> = {}): SourceSpan => ({ file: FILE, startLine, endLine, origin: "static", ...extra });

const analyzer: CodeSpanProvider = {
  id: "analyzer",
  span: l => l.nodeId === "op.join" ? span(12, 12, { startColumn: 5, endColumn: 40 }) : l.nodeId === "op.nofile" ? { reason: "no-source" } : undefined,
  locationsIn: f => f.replace(/\\/g, "/").toLowerCase() === FILE.replace(/\\/g, "/").toLowerCase()
    ? [{ location: loc("operation", "op.join"), span: span(12, 12, { startColumn: 5, endColumn: 40 }) },
       { location: loc("step", "step.same"), span: span(12, 12, { startColumn: 5, endColumn: 40 }) },
       { location: loc("step", "step.big"), span: span(10, 20) }]
    : []
};

test("resolveSpan: coarse levels are holes, first provider with a span wins, else its hole, else no-source", () => {
  assert.deepEqual(resolveSpan([analyzer], loc("project", "p")), { reason: "level-without-code" });
  assert.deepEqual(resolveSpan([analyzer], loc("subproject", "s")), { reason: "level-without-code" });
  const r = resolveSpan([analyzer], loc("operation", "op.join"));
  assert.ok(!isHole(r) && r.startLine === 12);
  assert.deepEqual(resolveSpan([analyzer], loc("operation", "op.nofile")), { reason: "no-source" });
  assert.deepEqual(resolveSpan([analyzer], loc("operation", "unknown")), { reason: "no-source" });
  assert.deepEqual(resolveSpan([], loc("step", "x")), { reason: "no-source" });
});

test("clampSpan: stale spans are clamped, a span beyond the file is a typed hole", () => {
  assert.deepEqual(clampSpan(span(3, 9), 20), span(3, 9));
  assert.equal((clampSpan(span(3, 30, { endColumn: 4 }), 20) as SourceSpan).endLine, 20);
  assert.equal((clampSpan(span(3, 30, { endColumn: 4 }), 20) as SourceSpan).endColumn, undefined);
  const h = clampSpan(span(25, 30), 20);
  assert.ok(isHole(h) && h.reason === "span-beyond-file");
  assert.deepEqual(clampSpan(span(3, 9), undefined), span(3, 9));
});

test("holeMessage: defaults, overrides from settings, {detail}", () => {
  assert.match(holeMessage({ reason: "level-without-code" }), /no code at this level/);
  assert.equal(holeMessage({ reason: "not-analyzed", detail: "a.py" }), "DataPass: this file is not analysed yet (a.py)");
  assert.equal(holeMessage({ reason: "no-source" }, { "no-source": "Pas de code" }), "Pas de code");
  assert.match(holeMessage({ reason: "no-source" }, { "no-source": 3, other: "x" }), /no source span/);
});

test("innermostAt: smallest span, operation over a step of the same size, columns, path case", () => {
  assert.equal(innermostAt([analyzer], FILE, 12, 10)?.nodeId, "op.join");
  assert.equal(innermostAt([analyzer], FILE, 12)?.nodeId, "op.join");
  assert.equal(innermostAt([analyzer], FILE, 12, 2)?.nodeId, "step.big"); // before the operation's column
  assert.equal(innermostAt([analyzer], FILE, 15)?.nodeId, "step.big");
  assert.equal(innermostAt([analyzer], "c:/PROJ/jobs/load.py", 15)?.nodeId, "step.big");
  assert.equal(innermostAt([analyzer], FILE, 30), undefined);
  assert.equal(innermostAt([analyzer], FILE, 0), undefined);
  assert.equal(innermostAt([analyzer], "C:\\other.py", 12), undefined);
});

test("hopStepProvider: Hop steps as step locations, both ways; unknown file = not-analyzed", () => {
  const doc = { steps: [
    { id: "read", title: "Read", lines: [1, 8] as [number, number] },
    { id: "clean", title: "Clean", lines: [3, 5] as [number, number] }
  ] } as never;
  const p = hopStepProvider({
    docs: () => [{ file: FILE, doc, artifactKind: "python-notebook" }],
    nodeIdFor: (f, s) => `hop:${f}#${s}`,
    parseNodeId: id => { const m = /^hop:(.+)#(.+)$/.exec(id); return m ? { file: m[1]!, stepId: m[2]! } : undefined; }
  });
  const r = p.span(loc("step", `hop:${FILE}#clean`));
  assert.ok(r && !isHole(r) && r.startLine === 3 && r.endLine === 5);
  assert.equal(p.span(loc("operation", `hop:${FILE}#clean`)), undefined);
  assert.equal(p.span(loc("step", "other")), undefined);
  assert.deepEqual(p.span(loc("step", "hop:C:\\x.py#read")), { reason: "not-analyzed", detail: "C:\\x.py" });
  assert.deepEqual(p.span(loc("step", `hop:${FILE}#nope`)), { reason: "no-source", detail: "nope" });
  assert.equal(innermostAt([p], FILE, 4)?.nodeId, `hop:${FILE}#clean`);
  assert.equal(innermostAt([p], FILE, 7)?.nodeId, `hop:${FILE}#read`);
  assert.equal(innermostAt([p], FILE, 7)?.artifactKind, "python-notebook");
});

test("ladderSpanProvider: ladder steps/operations with lines, both ways; unbound repo = no-source", () => {
  const fileLoc = loc("artifact", "core:jobs/load.py");
  const step = loc("step", "core:jobs/load.py#read"), op = loc("operation", "core:jobs/load.py#op:join");
  const entries = new Map<string, { file?: { repoKey: string; repoPath: string }; lines?: readonly [number, number] }>([
    [fileLoc.nodeId, { file: { repoKey: "core", repoPath: "jobs/load.py" } }],
    [step.nodeId, { file: { repoKey: "core", repoPath: "jobs/load.py" }, lines: [2, 9] }],
    [op.nodeId, { file: { repoKey: "core", repoPath: "jobs/load.py" }, lines: [4, 4] }]
  ]);
  const ladder: CodeLinkLadder = {
    entry: l => entries.get(l.nodeId),
    children: l => l.nodeId === fileLoc.nodeId ? [step] : l.nodeId === step.nodeId ? [op] : [],
    locate: (k, p) => k === "core" && p === "jobs/load.py" ? fileLoc : undefined
  };
  const folders: Record<string, string> = { core: "C:\\proj" };
  const p = ladderSpanProvider({ ladder: () => ladder, repoFolder: k => folders[k], repoKeys: () => ["core"] });
  assert.deepEqual(p.span(op), { file: "C:\\proj/jobs/load.py", startLine: 4, endLine: 4, origin: "static" });
  assert.equal(p.span(fileLoc), undefined);
  assert.equal(innermostAt([p], FILE, 4)?.nodeId, op.nodeId);
  assert.equal(innermostAt([p], FILE, 7)?.nodeId, step.nodeId);
  assert.equal(innermostAt([p], "C:\\elsewhere\\x.py", 4), undefined);
  delete folders.core;
  assert.deepEqual(p.span(step), { reason: "no-source", detail: "jobs/load.py" });
});

test("NAVCODE1 is registered: a self-registering surface calls registerCodeLink (collected by npm run gen)", () => {
  const surface = readFileSync(join(__dirname, "../src/core/navigation/codeLink.surface.ts"), "utf8");
  assert.match(surface, /registerCodeLink\(context, host\.nav,/);
  const gen = readFileSync(join(__dirname, "../out/gen/surfaces.ts"), "utf8");
  assert.match(gen, /src\/core\/navigation\/codeLink\.surface/);
});
