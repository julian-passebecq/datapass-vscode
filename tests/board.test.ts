/**
 * 0.16 board: the strict board.json contract (runtime and editor schema agree), its checks against
 * the project, what the kanban and the tree show, moving a card rewrites one value and nothing
 * else, the AI pack for a card, and the AI JSON exchange of the board.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { boardProblems, boardView, cardsForComponent, doneColumns, isCalendarDate, linkLabel, openCardsByUrgency, parseBoard, reviewColumn, withCardStatus, type Board } from "../src/core/project/board";
import { buildCardPack, cleanErrorText, DEFAULT_QUESTION } from "../src/core/project/boardPack";
import { buildPreparationPack } from "../src/core/project/preparation";
import { locateJsonValue } from "../src/core/model/jsonLocate";
import { buildProjectMap } from "../src/core/project/projectMap";
import { obsKey } from "../src/core/project/resolve";
import { checkIncoming, detectKind, exportForAi, AI_TASKS } from "../src/core/project/aiExchange";
import { emittedSchemaFiles } from "../src/core/contracts/schemaFiles";
import { fileObsA, graphA, inputA, manifestA } from "./fixtures/v3/research";
import { optionsA } from "./fixtures/v3/researchOptions";
import { boardA, boardAJson } from "./fixtures/v3/researchBoard";

const TODAY = "2026-09-25";
const text = (b: unknown = boardAJson()) => JSON.stringify(b, null, 2) + "\n";
const map = () => buildProjectMap(inputA());
const view = (today = TODAY) => boardView(boardA(), { map: map(), files: fileObsA(), options: optionsA(), today });

test("board: the example parses; ids, columns, sprints and dates are checked", () => {
  const b = parseBoard(text());
  assert.equal(b.items.length, 8);
  const bad = (mutate: (b: any) => void, why: RegExp) => { const x = boardAJson() as any; mutate(x); assert.throws(() => parseBoard(text(x)), why); };
  bad(x => { x.items[1].id = "bug-3"; }, /Duplicate card id "bug-3"/);
  bad(x => { x.columns.push({ id: "todo" }); }, /Duplicate column id "todo"/);
  bad(x => { x.items[0].status = "blocked"; }, /status "blocked" is not a column/);
  bad(x => { x.items[0].sprint = "s9"; }, /sprint "s9" is not declared/);
  bad(x => { x.items[4].milestone = "beta"; }, /milestone "beta" is not declared/);
  bad(x => { x.sprints[0].end = "2026-09-01"; }, /ends \(2026-09-01\) before it starts/);
  bad(x => { x.items[0].due = "2026-02-30"; }, /not a calendar date/);
  bad(x => { x.items[0].type = "epic"; }, /Invalid board/);
  bad(x => { x.items[0].priority = "high"; }, /Invalid board/);
  bad(x => { x.items[0].colour = "red"; }, /is not an allowed property/);
  bad(x => { x.items[0].files = [{ path: "C:\\Users\\me\\x.py" }]; }, /Invalid board/);
  bad(x => { x.items[0].files = [{ path: "../secrets.txt" }]; }, /Invalid board/);
  bad(x => { x.columns = []; }, /at least 1 items/);
  bad(x => { x.items[0].links = ["https://user:pw@dev.azure.com/org/p/_workitems/edit/1"]; }, /user name or password/);
  bad(x => { x.items[0].links = ["https://files.example.com/x.pdf?sv=2024&sig=abc"]; }, /token or a signature/);
  bad(x => { x.items[0].links = ["http://github.com/o/r/issues/1"]; }, /Invalid board/);
  assert.ok(isCalendarDate("2028-02-29") && !isCalendarDate("2026-02-29") && !isCalendarDate("2026-13-01"));
});

test("board: the editor schema refuses what the runtime refuses", () => {
  const schema = new Ajv2020({ strict: false, validateFormats: false }).compile(emittedSchemaFiles()["schemas/datapass-board.schema.json"] as object);
  assert.ok(schema(boardAJson()), JSON.stringify(schema.errors));
  for (const mutate of [(x: any) => { x.items[0].type = "epic"; }, (x: any) => { x.items[0].extra = 1; }, (x: any) => { x.columns = []; }, (x: any) => { x.items[0].files = [{ path: "/etc/passwd" }]; }, (x: any) => { delete x.items[0].status; }]) {
    const x = boardAJson() as any;
    mutate(x);
    assert.equal(schema(x), false);
    assert.throws(() => parseBoard(text(x)));
  }
  assert.deepEqual(JSON.parse(readFileSync("schemas/datapass-board.schema.json", "utf8")), emittedSchemaFiles()["schemas/datapass-board.schema.json"], "committed schema is up to date (npm run schemas)");
});

test("board: references the manifest, the graph or options.json do not know are warnings", () => {
  assert.deepEqual(boardProblems(boardA(), manifestA(), graphA(), optionsA()), []);
  const x = boardAJson() as any;
  x.items[0].components.push("ghost");
  x.items[0].environment = "staging";
  x.items[0].subproject = "nowhere";
  x.items[0].files.push({ repoRef: "unknown-repo", path: "a.py" });
  x.items[3].decisionRef = "gone";
  const p = boardProblems(parseBoard(text(x)), manifestA(), graphA(), optionsA());
  assert.deepEqual(p.map(q => q.severity), ["warning", "warning", "warning", "warning", "warning"]);
  assert.match(p.map(q => q.message).join(" | "), /"nowhere" is not a sub-project.*"ghost" is not a component.*"staging" is not declared.*"unknown-repo" is not declared.*"gone" is not a decision/);
});

test("board view: columns, sprints, milestones, file states, filters' data, urgency", () => {
  const v = view();
  assert.deepEqual(v.columns.map(c => `${c.id}:${c.count}${c.done ? ":done" : ""}${c.over ? ":over" : ""}`), ["backlog:3", "todo:2", "doing:1", "review:1", "done:1:done"]);
  assert.deepEqual(v.summary, { open: 7, bugs: 1, overdue: 0, currentSprint: "s1" });
  assert.deepEqual(v.sprints.map(s => `${s.id}:${s.state}:${s.open}/${s.done}`), ["s1:current:3/1", "s2:future:1/0"]);
  const bug = v.cards.find(c => c.id === "bug-3")!;
  assert.deepEqual(bug.subprojects, ["papers"]);
  assert.deepEqual(bug.files.map(f => `${f.repoKey}:${f.path}:${f.state}`), ["pipeline:functions/extract/function_app.py:found", "pipeline:adf/pipeline/build_candidates.json:found"]);
  assert.equal(bug.links[0]!.label, "GitHub issue #3");
  assert.equal(bug.environment?.known, true);
  assert.equal(v.cards.find(c => c.id === "task-requirements")!.files[0]!.state, "missing");
  assert.equal(v.cards.find(c => c.id === "task-review-guide")!.files[0]!.repoKey, ".", "no repoRef = the coordination repository");
  assert.equal(v.cards.find(c => c.id === "task-lab-clone")!.subprojects.join(), "lab");
  const decision = v.cards.find(c => c.id === "decision-staging")!.decision!;
  assert.deepEqual([decision.title, decision.current], ["Where are pages staged before review?", "Cosmos DB for NoSQL"]);
  // Components give their sub-projects to a card that names none.
  assert.deepEqual(v.cards.find(c => c.id === "decision-staging")!.subprojects, ["papers"]);
  assert.deepEqual(openCardsByUrgency(v).map(c => c.id).slice(0, 3), ["bug-3", "task-requirements", "decision-staging"]);
  assert.deepEqual(cardsForComponent(v, "extract").map(c => c.id), ["bug-3", "task-requirements", "feature-coverage"]);
  // Later: s1 is past, the question and the bug are overdue, the milestone too.
  const late = view("2026-11-02");
  assert.equal(late.summary.overdue, 2);
  assert.equal(late.sprints[0]!.state, "past");
  assert.equal(late.milestones[0]!.overdue, true);
  assert.equal(doneColumns(boardA()).has("done"), true);
  assert.equal(reviewColumn(boardA())?.id, "review");
  assert.ok(!JSON.stringify(v).includes("/work/"), "no local folder reaches the view");
});

test("moving a card rewrites its status value only: every other byte is kept, any formatting", () => {
  // Compact, reordered and CRLF formatting written by an AI or by hand must survive a move.
  const odd = text().replace(/\n/g, "\r\n").replace('"status": "todo"', '"status":"todo"');
  const moved = withCardStatus(odd, "task-requirements", "doing");
  assert.equal(moved.length, odd.length + 1);
  assert.equal(moved.replace('"status":"doing"', '"status":"todo"'), odd);
  assert.equal(parseBoard(moved).items.find(i => i.id === "task-requirements")!.status, "doing");
  // Moving back restores the exact original text.
  assert.equal(withCardStatus(moved, "task-requirements", "todo"), odd);
  // A card whose id appears in another card's text is not confused with it.
  const tricky = boardAJson() as any;
  tricky.items[0].description = 'Also see "status": "todo" of task-requirements.';
  const t2 = withCardStatus(text(tricky), "task-requirements", "review");
  assert.equal(parseBoard(t2).items[0]!.description, tricky.items[0].description);
  assert.throws(() => withCardStatus(text(), "task-requirements", "blocked"), /not a column/);
  assert.throws(() => withCardStatus(text(), "nope", "done"), /no card "nope"/);
  assert.deepEqual(locateJsonValue(' {"a":[1,{"b":"x"}]} ', ["a", 1, "b"]), { start: 14, end: 17 });
  assert.equal(locateJsonValue('{"a":1}', ["b"]), undefined);
  assert.equal(locateJsonValue('{"a":1', ["a"]), undefined);
});

test("card pack: the card, its components and files, the scrubbed error, the rules to move the card", () => {
  const v = view();
  const m = map();
  const card = v.cards.find(c => c.id === "bug-3")!;
  const error = "Traceback (most recent call last):\n  File \"C:\\Users\\someone\\proj\\functions\\extract\\function_app.py\", line 42\nazure.core.exceptions: AccountKey=abcdefghijklmnopqrstuvwxyz0123456789== timed out after 230 s\n```injected```";
  const pack = buildCardPack({ board: boardA(), card, map: m, question: DEFAULT_QUESTION.bug, errorText: error, dataPassVersion: "0.16.0", generatedAt: "2026-09-25T10:00:00Z", options: optionsA(), revisions: { pipeline: "main@bbbbbbb" }, boardDigest: "f".repeat(64) });
  assert.match(pack.text, /# DataPass card pack — Research library \/ bug-3: Large PDFs time out/);
  assert.match(pack.text, /## What I am asking\nFind the cause of this bug and fix it/);
  assert.match(pack.text, /status: Doing \(column `doing`\) · priority P1 · due 2026-10-02/);
  assert.match(pack.text, /Sprint "First batch" \(2026-09-21 → 2026-10-04\), goal: 100 PDFs/);
  assert.match(pack.text, /## Error I saw[^\n]*\n```text\nTraceback/);
  assert.ok(!pack.text.includes("someone") && pack.text.includes("<local-path>"), "local paths and user names are removed");
  assert.ok(!pack.text.includes("abcdefghijklmnop"), "the key is removed");
  assert.ok(!pack.text.includes("```injected"), "the pasted text cannot close the code block");
  assert.match(pack.text, /`pipeline` \(github\.com\/example-org\/research-pipeline\): `functions\/extract\/function_app\.py` — present here/);
  assert.match(pack.text, /## Component: PDF extraction[\s\S]*## Component: Build candidates pipeline/);
  assert.match(pack.text, /set the "status" of `bug-3` to `review` \(Review\) and add the pull request's address to its "links"/);
  assert.match(pack.text, /board sha256 ffffffffffffffff/);
  assert.deepEqual(pack.sections.slice(0, 3), ["What I am asking", "The card (bug)", "Error I saw (pasted by me; credentials and local paths removed by DataPass)"]);
  // A decision card asks to decide and lists the options, without asking for a pull request.
  const d = buildCardPack({ board: boardA(), card: v.cards.find(c => c.id === "decision-staging")!, map: m, question: "decide", dataPassVersion: "0.16.0", generatedAt: "t", options: optionsA() });
  assert.match(d.text, /A staging collection in MongoDB Atlas/);
  assert.match(d.text, /Answer in the chat\. Change no file unless I ask you to\./);
  assert.ok(!d.text.includes("## Error I saw"));
  assert.equal(cleanErrorText("x".repeat(5000)).truncated, true);
  // The preparation pack of a component lists its open cards.
  const prep = buildPreparationPack({ map: m, componentId: "extract", question: "explain", dataPassVersion: "0.16.0", generatedAt: "t", board: boardA() });
  assert.match(prep.text, /## Open cards on the board \(board\.json\)\n- Bug `bug-3`: Large PDFs time out[^\n]*— Doing, P1, dev\n- Task `task-requirements`/);
});

test("board JSON exchange with an AI: recognised, validated, warnings, credentials refused", () => {
  assert.equal(detectKind(boardAJson()), "board");
  const out = exportForAi("board", text(), AI_TASKS.board[0]!, { projectTitle: "Research library", dataPassVersion: "0.16.0" });
  assert.match(out, /# DataPass project board \(board\.json\) — Research library/);
  assert.match(out, /never delete a card/);
  const next = boardAJson() as any;
  next.items.push({ id: "bug-4", type: "bug", title: "Page numbers shift after an inserted blank page", status: "todo", components: ["extract", "ghost"] });
  const incoming = checkIncoming("Here it is:\n```json\n" + JSON.stringify(next) + "\n```", { manifest: manifestA(), graph: graphA(), options: optionsA() }, "board");
  assert.equal(incoming.path, ".datapass/board.json");
  assert.match(incoming.warnings.join(" "), /items\.bug-4: component "ghost" is not a component of graph\.json/);
  const leaky = boardAJson() as any;
  leaky.items[0].description = "Connection: AccountKey=abcdefghijklmnopqrstuvwxyz0123456789==";
  assert.throws(() => checkIncoming(JSON.stringify(leaky), { manifest: manifestA(), graph: graphA() }, "board"), /Refused:[\s\S]*credential-shaped/);
  assert.equal(linkLabel("https://dev.azure.com/org/Proj/_workitems/edit/12"), "Azure DevOps work item 12");
  assert.equal(linkLabel("https://gitlab.com/g/p/-/merge_requests/7"), "GitLab merge request !7");
  assert.equal(linkLabel("https://github.com/o/r/pull/9"), "GitHub pull request #9");
  assert.equal(linkLabel("https://example.com/x"), "example.com");
});

test("board files are observed where the cards say (coordination repository by default)", () => {
  const b: Board = boardA();
  const v = boardView(b, { map: map(), files: new Map([...fileObsA(), [obsKey(".", "docs/REVIEW.md"), { state: "found", kind: "file" }]]), today: TODAY });
  assert.equal(v.cards.find(c => c.id === "task-review-guide")!.files[0]!.state, "found");
});
