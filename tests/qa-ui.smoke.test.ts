/**
 * QA-4 smoke: qa:prepare a run root (the doc-pipeline example, the VSIX in the isolated profile), then
 * qa:ui drives that VS Code through Playwright `_electron`: open the DataPass Architecture view, expect a
 * diagram node (inside the webview), take a screenshot. Needs a built VSIX in DATAPASS_QA_VSIX (CI packages one; Linux
 * runs it under xvfb-run).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { prepare } from "../scripts/qa/prepare";
import { runUi } from "../scripts/qa/ui-run";
import { parseQaReport } from "../src/qa/formats";
import { cleanup, fixture } from "./fixtures/qa/ui/runRoot";

const vsix = process.env.DATAPASS_QA_VSIX;

test("qa:ui runs the smoke journey in the prepared VS Code and writes a valid report", { skip: vsix ? false : "set DATAPASS_QA_VSIX to a built VSIX (CI does)", timeout: 600_000 }, async () => {
  const { base, root, auto } = fixture();
  try {
    fs.copyFileSync(vsix!, path.join(root, "datapass-vscode.vsix"));
    const lines: string[] = [];
    const prepared = await prepare({ auto, root, log: l => lines.push(l) });
    assert.equal(prepared.code, 0, lines.join("\n"));
    const out = path.join(root, "qa-ui", "smoke");
    const r = await runUi({ root, journey: path.join(process.cwd(), "tests", "fixtures", "qa", "ui", "smoke-doc-pipeline.json"), out, log: l => lines.push(l) });
    // The evidence outlives the temporary folder (CI uploads it).
    const keep = path.join(process.cwd(), "out", "qa-ui");
    fs.mkdirSync(keep, { recursive: true });
    fs.cpSync(out, keep, { recursive: true });
    assert.equal(r.code, 0, lines.join("\n"));
    const report = parseQaReport(fs.readFileSync(path.join(out, "report.json"))) as any;
    assert.equal(report.journeys[0].outcome, "reached");
    assert.equal(report.agent.tool, "qa-ui");
    assert.deepEqual(report.journeys[0].screens, ["screens/UI01-architecture-view.png"]);
    assert.ok(fs.statSync(path.join(out, "screens", "UI01-architecture-view.png")).size > 1000, "a real screenshot");
  } finally { cleanup(base); }
});
