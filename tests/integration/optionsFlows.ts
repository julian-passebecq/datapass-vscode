/**
 * 0.15 desktop flows (real VS Code, real files, offline): architecture options and the project
 * sheet are loaded and analysed, a scenario is previewed without touching the project, a decision
 * is recorded in options.json with a backup, an AI answer is imported after validation (and a leaky
 * one refused), a DataPass file is copied for the AI, and a backup is restored.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { DataPassTestApi } from "../../src/extension";
import { record, test, waitFor } from "./harness";
import { withUi } from "./ui";

const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);

export function registerOptionsFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const hub = () => vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const readJson = (rel: string) => JSON.parse(readFileSync(path.join(hub(), rel), "utf8"));
  const backups = () => { const dir = path.join(hub(), ".datapass", "local", "backups"); return existsSync(dir) ? readdirSync(dir) : []; };
  const gitStatus = () => execFileSync("git", ["status", "--porcelain"], { cwd: hub(), encoding: "utf8" }).trim();

  test("0.15: options and the project sheet are loaded, analysed and listed in the Project tree", async () => {
    await run("datapass.refreshProject");
    const a = api().optionsAnalysis();
    assert.ok(a, "the analysis exists");
    assert.deepEqual(a!.scenarios.map(s => s.id), ["current", "google", "lean"]);
    const google = a!.scenarios.find(s => s.id === "google")!.impact;
    assert.deepEqual(google.providersAdded.sort(), ["bigquery", "google-cloud-storage"]);
    assert.ok(google.tools.newlyNeeded.some(t => t.label === "Google Cloud Data Agent Kit"), "the official Google tool is named");
    assert.deepEqual(google.costs.oneTime, { USD: 30 });
    const state = api().workbenchState();
    assert.equal(state.options?.decisions.length, 3);
    assert.equal(state.sheet?.datasets.length, 3);
    assert.equal(state.preview, undefined);
    assert.ok(!JSON.stringify(state).includes(os.homedir()), "no absolute path reaches the webviews");
    const rows = await api().renderProjectTree();
    const ids = rows.map(r => r.id);
    for (const id of ["options", "opt:scenarios", "opt:archive", "opt:processing", "opt:staging", "sheet", "sheet:datasets", "sheet:formulas", "sheet:runtimes"]) assert.ok(ids.includes(id), `tree row ${id}`);
    assert.equal(rows.find(r => r.id === "opt:processing")?.command, "datapass.openOptions");
    assert.deepEqual(api().projectMap().problems.filter(p => /options\.json|sheet\.json/.test(p.where) && p.severity !== "info"), []);
    record("v32Analysis", { scenarios: a!.scenarios.map(s => `${s.title}: ${s.impact.components.total} components, ${JSON.stringify(s.impact.costs.monthly)}/month`) });
  }, ["v3-research"]);

  test("0.15: previewing a scenario changes the diagram, never the project", async () => {
    await api().select({ subproject: "papers" });
    const before = JSON.stringify(api().projectMap().components.map(c => c.id));
    await run("datapass.previewArchitecture", { scenario: "google" });
    const p = api().workbenchState().preview;
    assert.ok(p, "a preview is shown");
    assert.equal(p!.diff["bq-pages"], "added");
    assert.equal(p!.diff["pdf-archive"], "replaced");
    assert.equal(p!.diff.cosmos, "removed");
    assert.ok(p!.diagram.nodeIds.includes("bq-pages") && p!.diagram.nodeIds.includes("cosmos"), "added and removed components are drawn");
    assert.equal(JSON.stringify(api().projectMap().components.map(c => c.id)), before, "the project itself is unchanged");
    // A component that exists only in the preview can be selected while the preview lasts.
    await api().select({ component: "bq-pages" });
    assert.equal(api().selection().component, "bq-pages");
    await run("datapass.clearPreview");
    assert.equal(api().workbenchState().preview, undefined);
    assert.equal(api().selection().component, undefined, "the preview-only component is no longer selectable");
    assert.equal(gitStatus(), "", "nothing was written");
  }, ["v3-research"]);

  test("0.15: recording a decision writes options.json with a backup and nothing else", async () => {
    await withUi([{ input: "One database less for the pilot" }, { button: "Record decision" }, { dismiss: true }],
      () => run("datapass.recordDecision", { decision: "staging", option: "mongo-staging" }));
    const staging = readJson(".datapass/options.json").decisions.find((d: { id: string }) => d.id === "staging");
    assert.equal(staging.chosen, "mongo-staging");
    assert.equal(staging.current, "cosmos", "graph.json still describes Cosmos: the AI applies the decision later");
    assert.equal(staging.decidedOn, new Date().toISOString().slice(0, 10));
    assert.equal(staging.rationale, "One database less for the pilot");
    assert.deepEqual(Object.keys(staging).slice(0, 7), ["id", "title", "level", "subproject", "current", "chosen", "decidedOn"], "chosen and its date sit next to current");
    assert.equal(backups().filter(b => b.endsWith("__.datapass~options.json")).length, 1);
    assert.equal(gitStatus(), "M .datapass/options.json", "only options.json changed; backups stay in the ignored local folder");
    await waitFor("decided scenario", () => api().optionsAnalysis()?.scenarios.some(s => s.id === "decided"));
  }, ["v3-research"]);

  test("0.15: the AI context to apply a decision and the Markdown comparison", async () => {
    const ui = await withUi([{ button: "Copy" }], () => run("datapass.optionsAiContext", { purpose: "apply", decision: "staging" }));
    assert.match(ui.clipboard, /I decided: "Where are pages staged before review\?" → \*\*A staging collection in MongoDB Atlas\*\*/);
    assert.match(ui.clipboard, /set "current" of "staging" to "mongo-staging" and remove "chosen"/);
    assert.ok(!ui.clipboard.includes(hub()) && !ui.clipboard.includes(os.homedir()), "no local path");
    const refused = await withUi([], () => run("datapass.optionsAiContext", { purpose: "apply", decision: "archive" }), { allowErrors: true });
    assert.ok(refused.errors.some(e => /Record a decision first/.test(e)), refused.errors.join(" / "));
    const exp = await withUi([{ button: "Copy" }], () => run("datapass.exportOptionsComparison"));
    assert.match(exp.clipboard, /## Scenarios/);
    assert.match(exp.clipboard, /Archi 2 — Google for documents/);
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("0.15: copy a DataPass file for the AI, then import its answer after validation, a diff and a backup", async () => {
    const out = await withUi([{ pick: "Fill the project sheet" }, { dismiss: true }], () => run("datapass.copyForAi", "sheet"));
    assert.match(out.clipboard, /## What I am asking\nFill this project sheet/);
    assert.match(out.clipboard, /"format": "datapass\.sheet"/);
    // The AI answers with the complete file in a JSON block.
    const sheet = readJson(".datapass/sheet.json");
    sheet.glossary.push({ term: "page coverage", meaning: "Share of a PDF's pages whose text was extracted." });
    const answer = "Here is the updated sheet:\n```json\n" + JSON.stringify(sheet, null, 2) + "\n```\nI only added a glossary term.";
    const ui = await withUi([{ pick: "From the clipboard" }, { button: "Replace the file" }, { dismiss: true }], async u => { u.clipboard = answer; await run("datapass.importFromAi", "sheet"); });
    assert.ok(ui.prompts.some(p => p.modal && /current file \(left\) and the AI's proposal \(right\)/.test(p.text ?? "")), "the diff is explained before writing");
    assert.equal(readJson(".datapass/sheet.json").glossary.length, 2);
    assert.equal(backups().filter(b => b.endsWith("__.datapass~sheet.json")).length, 1);
    await waitFor("sheet reloaded", () => api().workbenchState().sheet?.glossary.length === 2);
    // An answer with a credential or a local path is refused; nothing is written.
    const leaky = structuredClone(sheet);
    leaky.datasets[0].notes = "connect with AccountKey=abcdefghijklmnop";
    const refused = await withUi([{ pick: "From the clipboard" }], async u => { u.clipboard = JSON.stringify(leaky); await run("datapass.importFromAi"); }, { allowErrors: true });
    assert.ok(refused.errors.some(e => /Not imported: Refused:[\s\S]*credential-shaped text/.test(e)), refused.errors.join(" / "));
    assert.equal(readJson(".datapass/sheet.json").datasets[0].notes, sheet.datasets[0].notes);
    const invalid = await withUi([{ pick: "From the clipboard" }], async u => { u.clipboard = JSON.stringify({ ...sheet, datasets: [{ id: "x" }] }); await run("datapass.importFromAi", "sheet"); }, { allowErrors: true });
    assert.ok(invalid.errors.some(e => /Not imported: Invalid project sheet/.test(e)), invalid.errors.join(" / "));
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("0.15: a backup restores the previous version (itself backed up)", async () => {
    const ui = await withUi([{ pick: ".datapass/options.json" }, { button: "Restore" }], () => run("datapass.restoreBackup"));
    void ui;
    const staging = readJson(".datapass/options.json").decisions.find((d: { id: string }) => d.id === "staging");
    assert.equal(staging.chosen, undefined, "the decision recorded earlier is undone");
    assert.equal(backups().filter(b => b.endsWith("__.datapass~options.json")).length, 2, "the version before the restore is kept too");
    assert.equal(gitStatus().split(/\r?\n/).filter(Boolean).sort().join(" | "), "M .datapass/sheet.json", "options.json is back to its committed content");
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("0.15.1: the AI exchange view copies a file, checks a pasted answer live and writes it after the diff", async () => {
    const view = api().aiExchange;
    await run("datapass.showAiExchange", "options");
    assert.ok(view.resolved(), "the view is shown in the secondary side bar");
    const s = await view.state();
    assert.deepEqual(s.files.map(f => f.kind), ["options", "sheet", "graph", "manifest", "catalog"]);
    assert.ok(s.files.find(f => f.kind === "options")!.bytes! > 1000);
    assert.equal(s.files.find(f => f.kind === "catalog")!.exists, false);
    assert.ok(!JSON.stringify(s).includes(hub()) && !JSON.stringify(s).includes(os.homedir()), "no local path reaches the webview");
    // Step 1: copy with the task chosen in the view; nothing is asked.
    let replies: Array<Record<string, unknown>> = [];
    const copy = await withUi([], async () => { replies = await view.send({ type: "copy", kind: "options", task: "review" }); });
    assert.equal(replies[0]?.path, ".datapass/options.json", JSON.stringify(replies));
    assert.match(copy.clipboard, /## What I am asking\nReview these architecture options/);
    assert.equal(copy.prompts.filter(p => p.kind === "pick").length, 0);
    await waitFor("the copy is listed", async () => (await view.state()).recent.some(r => r.label.includes("options.json for the AI (review)")));
    // Step 2: the answer is pasted (here through the clipboard button) and checked as it arrives.
    const options = readJson(".datapass/options.json");
    options.decisions[0].title = "Where are PDFs archived (reviewed by the AI)?";
    const answer = "Corrected:\n```json\n" + JSON.stringify(options, null, 2) + "\n```";
    await withUi([], async u => { u.clipboard = answer; replies = await view.send({ type: "paste" }); });
    assert.equal(replies[0]?.text, answer);
    replies = await view.send({ type: "check", seq: 7, text: answer });
    const review = replies[0]?.review as { ok: boolean; kind?: string; added?: number; unchanged?: boolean };
    assert.equal(replies[0]?.seq, 7);
    assert.ok(review.ok && review.kind === "options" && review.added! >= 1 && !review.unchanged, JSON.stringify(review));
    const leaky = structuredClone(options);
    leaky.decisions[0].notes = "connect with AccountKey=abcdefghijklmnop";
    replies = await view.send({ type: "check", seq: 8, text: JSON.stringify(leaky) });
    assert.ok(!(replies[0]?.review as { ok: boolean }).ok, "a leaky answer cannot be written");
    // Step 3: write after the diff and the confirmation; a backup is kept.
    const before = backups().filter(b => b.endsWith("__.datapass~options.json")).length;
    const ui = await withUi([{ button: "Replace the file" }, { dismiss: true }], async () => { replies = await view.send({ type: "write", text: answer }); });
    assert.equal(replies[0]?.path, ".datapass/options.json", JSON.stringify(replies));
    assert.ok(ui.prompts.some(p => p.modal && /current file \(left\) and the AI's proposal \(right\)/.test(p.text ?? "")), "the diff is explained before writing");
    assert.equal(readJson(".datapass/options.json").decisions[0].title, "Where are PDFs archived (reviewed by the AI)?");
    assert.equal(backups().filter(b => b.endsWith("__.datapass~options.json")).length, before + 1);
    // A refused write explains itself in the view instead of a pop-up.
    replies = await view.send({ type: "write", text: JSON.stringify(leaky) });
    assert.match(String(replies[0]?.error), /Not imported: Refused/);
    // Webview input is checked: an unknown kind or command does nothing.
    assert.deepEqual(await view.send({ type: "copy", kind: "../../etc" }), []);
    assert.deepEqual(await view.send({ type: "command", command: "workbench.action.terminal.new" }), []);
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);
}
