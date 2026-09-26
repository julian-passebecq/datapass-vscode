/**
 * 0.16 desktop flows for the board (real VS Code, real files and Git, offline): board.json is
 * loaded and listed in the Project tree, the Workbench opens on a card, moving a card changes one
 * line (and moving it back restores the file byte for byte), a card's file and link open, an AI
 * pack for a bug carries the scrubbed error, and the AI's board comes back through the validated
 * JSON exchange.
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

export function registerBoardFlows(getApi: () => DataPassTestApi): void {
  const api = () => getApi();
  const hub = () => vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const boardText = () => readFileSync(path.join(hub(), ".datapass", "board.json"), "utf8");
  const backups = () => { const dir = path.join(hub(), ".datapass", "local", "backups"); return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith("__.datapass~board.json")) : []; };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: hub(), encoding: "utf8" }).trim();
  const status = (id: string) => api().boardView()?.cards.find(c => c.id === id)?.status;

  test("0.16: the board is loaded, listed in the Project tree and sent to the Workbench", async () => {
    await run("datapass.refreshProject");
    const v = api().boardView();
    assert.ok(v, "the board view exists");
    assert.equal(v!.cards.length, 8);
    assert.deepEqual(v!.columns.map(c => c.id), ["backlog", "todo", "doing", "review", "done"]);
    assert.deepEqual(v!.cards.find(c => c.id === "bug-3")!.files.map(f => f.state), ["found", "found"], "the card's files are checked in the pipeline clone");
    assert.equal(v!.cards.find(c => c.id === "task-review-guide")!.files[0]!.state, "missing", "no repoRef: the coordination repository");
    const rows = await api().renderProjectTree();
    const ids = rows.map(r => r.id).filter((id): id is string => !!id);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "duplicate tree ids");
    for (const id of ["board", "board:open", "board:card:bug-3", "board:card:decision-staging"]) assert.ok(ids.includes(id), `tree row ${id}`);
    assert.ok(!ids.includes("board:card:task-inventory"), "finished cards are not listed");
    const card = rows.find(r => r.id === "board:card:bug-3")!;
    assert.equal(card.command, "datapass.openBoard");
    assert.deepEqual(card.commandArgs, ["bug-3"]);
    assert.equal(card.contextValue, "boardCard");
    const state = api().workbenchState();
    assert.equal(state.board?.cards.length, 8);
    assert.ok(!JSON.stringify(state.board).includes(os.homedir()) && !JSON.stringify(state.board).includes(hub()), "no absolute path reaches the webviews");
    assert.deepEqual(api().projectMap().problems.filter(p => p.where.startsWith("board.json")), []);
    const exchange = await api().aiExchange.state();
    assert.ok(exchange.files.some(f => f.kind === "board" && f.exists && f.tasks.some(t => t.id === "update")), "the AI exchange view offers board.json");
    await run("datapass.openBoard", "bug-3");
    await waitFor("the Workbench tab", () => vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.input instanceof vscode.TabInputWebview)));
    record("boardTree", rows.filter(r => r.id?.startsWith("board")).map(r => `${r.label}${r.description ? ` — ${r.description}` : ""}`));
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("0.16: moving a card changes one line of board.json with a backup; moving it back restores the file byte for byte", async () => {
    const before = boardText();
    const first = await withUi([{ button: "Move, and don't ask again in this window" }], () => run("datapass.board.moveCard", { item: "question-rights", status: "doing" }));
    assert.ok(first.prompts.some(p => p.modal && /writes only this card's "status"/.test(p.text ?? "")), "the first move explains what is written");
    await waitFor("the card moved", () => status("question-rights") === "doing");
    const a = before.split("\n"), b = boardText().split("\n");
    const changed = a.map((line, i) => (line !== b[i] ? i : -1)).filter(i => i >= 0);
    assert.equal(a.length, b.length);
    assert.equal(changed.length, 1, "exactly one line changed");
    assert.match(b[changed[0]!]!, /^\s+"status": "doing",$/);
    assert.equal(git("diff", "--numstat", "--", ".datapass/board.json"), "1\t1\t.datapass/board.json");
    assert.equal(backups().length, 1);
    // "Don't ask again" holds for this window.
    const again = await withUi([], () => run("datapass.board.moveCard", { item: "question-rights", status: "todo" }));
    assert.equal(again.prompts.filter(p => p.modal).length, 0);
    await waitFor("the card moved back", () => status("question-rights") === "todo");
    assert.equal(boardText(), before, "moving it back restores the exact file");
    assert.equal(git("status", "--porcelain", "--", ".datapass/board.json"), "", "nothing to commit");
    assert.equal(backups().length, 2);
    // A column the board does not have is not written: the column picker opens instead.
    const unknown = await withUi([{ dismiss: true }], () => run("datapass.board.moveCard", { item: "bug-3", status: "blocked" }));
    assert.ok(unknown.prompts.some(p => p.kind === "pick" && /Move "Large PDFs/.test(p.title ?? "")));
    assert.equal(boardText(), before);
  }, ["v3-research"]);

  test("0.16: a card's file opens in the editor; a missing one is explained, never created", async () => {
    await run("workbench.action.closeAllEditors");
    await withUi([], () => run("datapass.board.openFile", { item: "bug-3", index: 0 }));
    await waitFor("function_app.py in the editor", () => vscode.window.activeTextEditor?.document.uri.fsPath.endsWith(path.join("functions", "extract", "function_app.py")));
    const missing = await withUi([{ dismiss: true }], () => run("datapass.board.openFile", { item: "task-review-guide", index: 0 }));
    assert.ok(missing.prompts.some(p => p.modal && /docs\/REVIEW\.md is not in/.test(p.text ?? "")), JSON.stringify(missing.prompts));
    assert.equal(existsSync(path.join(hub(), "docs", "REVIEW.md")), false);
    const refused = await withUi([], () => run("datapass.board.openFile", { item: "bug-3", index: 9 }), { allowErrors: true });
    assert.ok(refused.errors.some(e => /Unknown file of this card/.test(e)), refused.errors.join(" / "));
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);

  test("0.16: a card's link opens after its address was shown once in this window", async () => {
    const ui = await withUi([{ button: "Open" }], () => run("datapass.board.openLink", { item: "bug-3", index: 0 }));
    assert.deepEqual(ui.opened, ["https://github.com/example-org/research-pipeline/issues/3"]);
    assert.ok(ui.prompts.some(p => p.modal && /GitHub issue #3/.test(p.text ?? "")));
    const again = await withUi([], () => run("datapass.board.openLink", { item: "bug-3", index: 0 }));
    assert.equal(again.opened.length, 1);
  }, ["v3-research"]);

  test("0.16: an AI pack for a bug carries the card, its files and the pasted error without paths or keys", async () => {
    const error = `Traceback (most recent call last):\n  File "${path.join(hub(), "functions", "x.py")}", line 3\nHttpResponseError: timeout after 230 s; AccountKey=abcdefghijklmnopqrstuvwxyz0123456789==`;
    const ui = await withUi([{ pick: "Find the cause and fix it" }, { pick: "Add the error message I copied" }, { button: "Copy" }], async u => { u.clipboard = error; await run("datapass.board.aiPack", { item: "bug-3" }); });
    assert.match(ui.clipboard, /# DataPass card pack — Research library \/ bug-3/);
    assert.match(ui.clipboard, /HttpResponseError: timeout after 230 s/);
    assert.match(ui.clipboard, /`functions\/extract\/function_app\.py` — present here/);
    assert.match(ui.clipboard, /set the "status" of `bug-3` to `review`/);
    assert.ok(!ui.clipboard.includes(hub()) && !ui.clipboard.includes(os.homedir()), "no local path");
    assert.ok(!ui.clipboard.includes("abcdefghijklmnop"), "no key");
    // From the Project tree's context menu: the row itself is the argument.
    const fromTree = await withUi([{ pick: "Answer the question" }, { button: "Copy" }], () => run("datapass.board.aiPack", { t: "info", id: "board:card:question-rights" }));
    assert.match(fromTree.clipboard, /question-rights: Which publishers allow text extraction\?/);
  }, ["v3-research"]);

  test("0.16: the AI's board comes back through the JSON exchange: validated, diff, backup; a credential is refused", async () => {
    const out = await withUi([{ pick: "Update the board" }, { dismiss: true }], () => run("datapass.copyForAi", "board"));
    assert.match(out.clipboard, /"format": "datapass\.board"/);
    const next = JSON.parse(boardText());
    next.items.push({ id: "bug-4", type: "bug", title: "Page numbers shift after a blank page", status: "todo", priority: "P2", components: ["extract"] });
    await withUi([{ pick: "From the clipboard" }, { button: "Replace the file" }, { dismiss: true }], async u => { u.clipboard = "```json\n" + JSON.stringify(next, null, 2) + "\n```"; await run("datapass.importFromAi", "board"); });
    await waitFor("nine cards", () => api().boardView()?.cards.length === 9);
    assert.equal(backups().length, 3);
    const leaky = structuredClone(next);
    leaky.items[0].links = ["https://someone:hunter2@dev.azure.com/org/p/_workitems/edit/1"];
    const refused = await withUi([{ pick: "From the clipboard" }], async u => { u.clipboard = JSON.stringify(leaky); await run("datapass.importFromAi", "board"); }, { allowErrors: true });
    assert.ok(refused.errors.some(e => /Not imported/.test(e)), refused.errors.join(" / "));
    assert.equal(api().boardView()?.cards.length, 9);
    await run("workbench.action.closeAllEditors");
  }, ["v3-research"]);
}
