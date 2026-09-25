/**
 * 0.16 board commands: open the board (a Workbench view), open board.json at a card, move a card,
 * open a card's file or link, prepare an AI pack for a card.
 *
 * Arguments come from the Workbench webview, the Project tree or the palette; each is re-checked
 * against the loaded board. Moving a card is the only write: DataPass replaces that card's
 * "status" value in .datapass/board.json (every other byte is kept), with the usual base check,
 * backup and journal (writeProjectFile). It never commits or pushes.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import type { WorkbenchHost } from "../views/workbench";
import { confirmModal, guarded, requireRoot, UserFacingError } from "./io";
import { writeProjectFile } from "./optionsCommands";
import { clipboard } from "../core/clipboard";
import { openExternal, openFolderWindow } from "../core/external";
import { readOptional } from "../core/workspace/loader";
import { newLocalId, sha256Bytes } from "../core/model/ids";
import { decodeUtf8Strict } from "../core/model/strictJson";
import { locateJsonValue } from "../core/model/jsonLocate";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { BOARD_PATH, cardFileLocation, linkLabel, linkProblem, openCardsByUrgency, TYPE_LABELS, withCardStatus, type Board, type CardView } from "../core/project/board";
import { buildCardPack, CARD_QUESTIONS, DEFAULT_QUESTION, type CardQuestion } from "../core/project/boardPack";

const GUIDE_URL = "https://github.com/julian-passebecq/datapass-vscode/blob/main/docs/PREPARING_A_PROJECT.md";
const str = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const TREE_PREFIX = "board:card:";

/** A card id from a webview message ({ item }), a Project tree row, or a plain string. */
function cardArg(v: unknown): string | undefined {
  if (typeof v === "string") return str(v, 80);
  const o = v as { item?: unknown; id?: unknown; t?: unknown } | undefined;
  if (!o || typeof o !== "object") return undefined;
  if (typeof o.item === "string") return str(o.item, 80);
  if (o.t === "info" && typeof o.id === "string" && o.id.startsWith(TREE_PREFIX)) return str(o.id.slice(TREE_PREFIX.length), 80);
  return undefined;
}
const indexArg = (v: unknown) => { const i = (v as { index?: unknown } | undefined)?.index; return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < 100 ? i : undefined; };

export function registerBoardCommands(context: vscode.ExtensionContext, session: WorkSession, host: WorkbenchHost): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const version = String(context.extension.packageJSON.version ?? "unknown");
  reg("datapass.openBoard", async (arg?: unknown) => {
    const id = cardArg(arg);
    host.openPanel(vscode.ViewColumn.Active, "board", id && session.project.board?.items.some(i => i.id === id) ? id : undefined);
  });
  reg("datapass.openBoardFile", async (arg?: unknown) => openBoardFile(session, cardArg(arg)));
  reg("datapass.board.moveCard", async (arg?: unknown, status?: unknown) => moveCard(session, cardArg(arg), str((arg as { status?: unknown } | undefined)?.status, 80) ?? str(status, 80)));
  reg("datapass.board.aiPack", async (arg?: unknown) => cardAiPack(session, version, cardArg(arg)));
  reg("datapass.board.openFile", async (arg?: unknown) => openCardFile(session, host, version, cardArg(arg), indexArg(arg)));
  reg("datapass.board.openLink", async (arg?: unknown) => openCardLink(session, cardArg(arg), indexArg(arg)));
}

// ------------------------------------------------------------------ helpers

function requireBoard(session: WorkSession): Board {
  const b = session.project.board;
  if (!b) throw new UserFacingError(session.project.boardError ? `.datapass/board.json has errors: ${session.project.boardError}` : "This project has no .datapass/board.json yet. Ask your AI to prepare it: \"Copy a DataPass File for the AI\" → project board.");
  return b;
}

async function pickCard(session: WorkSession, title: string): Promise<string | undefined> {
  const view = session.boardView();
  if (!view?.cards.length) throw new UserFacingError("The board has no cards yet.");
  const open = openCardsByUrgency(view);
  const rest = view.cards.filter(c => c.done);
  const pick = await vscode.window.showQuickPick([...open, ...rest].map(c => ({
    label: `${c.title}`, description: `${TYPE_LABELS[c.type]} · ${view.columns.find(x => x.id === c.status)?.title ?? c.status}${c.priority ? ` · ${c.priority}` : ""}`, detail: c.id, id: c.id
  })), { title, matchOnDetail: true });
  return pick?.id;
}

function card(session: WorkSession, id: string | undefined): CardView {
  const c = session.boardView()?.cards.find(x => x.id === id);
  if (!c) throw new UserFacingError(id ? `There is no card "${id}" on the board (it may have changed: re-inspect).` : "No card given.");
  return c;
}

/** Text of board.json and whether it starts with a byte-order mark (kept when writing back). */
function boardText(bytes: Uint8Array): { text: string; bom: boolean } {
  return { text: decodeUtf8Strict(bytes), bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf };
}
function encode(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

// ------------------------------------------------------------------ board.json

async function openBoardFile(session: WorkSession, itemId?: string): Promise<void> {
  const root = requireRoot(session.root);
  const uri = vscode.Uri.joinPath(root, ...BOARD_PATH.split("/"));
  const bytes = await readOptional(uri);
  if (!bytes) {
    const choice = await vscode.window.showInformationMessage(`${BOARD_PATH} does not exist yet.`, { modal: true, detail: "Your AI assistant prepares it from the repositories and your conversation: DataPass copies the instructions and the format, you paste its answer back with \"Import the AI's answer\" (or it opens a pull request)." }, "Copy instructions for the AI", "Open the guide");
    if (choice === "Copy instructions for the AI") await vscode.commands.executeCommand("datapass.copyForAi", "board");
    else if (choice === "Open the guide") await vscode.commands.executeCommand("datapass.openPreparationGuide");
    return;
  }
  const editor = await vscode.window.showTextDocument(uri, { preview: true });
  const index = itemId ? session.project.board?.items.findIndex(i => i.id === itemId) ?? -1 : -1;
  if (index < 0) return;
  const text = editor.document.getText();
  const span = locateJsonValue(text, ["items", index]);
  if (!span) return;
  const pos = editor.document.positionAt(span.start);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, editor.document.positionAt(span.end)), vscode.TextEditorRevealType.AtTop);
}

async function moveCard(session: WorkSession, itemId: string | undefined, status: string | undefined): Promise<void> {
  const board = requireBoard(session);
  const id = itemId ?? await pickCard(session, "Move which card?");
  if (!id) return;
  const item = board.items.find(i => i.id === id);
  if (!item) throw new UserFacingError(`There is no card "${id}" on the board (it may have changed: re-inspect).`);
  let to = status && board.columns.some(c => c.id === status) ? status : undefined;
  if (!to) {
    const pick = await vscode.window.showQuickPick(board.columns.map(c => ({
      label: `${c.id === item.status ? "$(check) " : ""}${c.title ?? c.id}`, description: c.id === item.status ? "current column" : c.done ? "finished" : undefined, id: c.id
    })), { title: `Move "${item.title}" to…`, placeHolder: "Only this card's status changes in board.json" });
    if (!pick) return;
    to = pick.id;
  }
  if (to === item.status) return;
  const column = board.columns.find(c => c.id === to)!;
  const bytes = session.project.boardBytes;
  if (!bytes) throw new UserFacingError("board.json could not be read again.");
  const { text, bom } = boardText(bytes);
  let next: string;
  try { next = withCardStatus(text, item.id, to); } catch (e) { throw new UserFacingError(`${e instanceof Error ? e.message : String(e)}. Nothing was written.`); }
  if (!session.boardMovesConfirmed) {
    const choice = await vscode.window.showWarningMessage(`Move "${item.title}" to ${column.title ?? column.id}?`, {
      modal: true,
      detail: `DataPass writes only this card's "status" in ${BOARD_PATH}: every other character of the file stays as it is. A backup goes to .datapass/local/backups. DataPass never commits or pushes: commit the change when you are ready, since the board in Git is what the AI and other viewers (Mongoku) read.`
    }, "Move", "Move, and don't ask again in this window");
    if (!choice) return;
    if (choice !== "Move") session.boardMovesConfirmed = true;
  }
  await writeProjectFile(session, BOARD_PATH, encode(next, bom), bytes);
  await session.refresh();
  vscode.window.setStatusBarMessage(`$(check) DataPass: "${item.title}" → ${column.title ?? column.id} (board.json, one line; backup kept)`, 5000);
}

// ------------------------------------------------------------------ a card's files and links

async function openCardFile(session: WorkSession, host: WorkbenchHost, version: string, itemId: string | undefined, index: number | undefined): Promise<void> {
  const board = requireBoard(session);
  const item = board.items.find(i => i.id === itemId);
  const decl = index !== undefined ? item?.files?.[index] : undefined;
  if (!item || !decl) throw new UserFacingError("Unknown file of this card.");
  const map = session.projectMap();
  const { repoKey, repoPath } = cardFileLocation(decl, map.coordinationKey);
  if (!repoPath) throw new UserFacingError(`Refusing ${decl.path}: not a relative path inside the repository.`);
  const repo = map.repositories.find(r => r.key === repoKey);
  if (!repo) throw new UserFacingError(`The card names repository "${repoKey}", which project.json does not declare.`);
  const folder = session.repoFolder(repoKey);
  if (!folder || repo.state === "wrong-remote") {
    const planned = repo.state === "planned";
    const choice = await vscode.window.showInformationMessage(`${decl.path} (${repo.label})`, {
      modal: true, detail: planned ? `${repo.label} is planned: the repository does not exist yet.` : `${repo.label} is not cloned on this machine, so DataPass cannot open ${decl.path}. ${repo.nextStep ?? ""}`.trim()
    }, ...(planned ? [] : ["Clone repository", "Locate clone"]));
    if (choice === "Clone repository") await vscode.commands.executeCommand("datapass.cloneRepository", repoKey);
    else if (choice === "Locate clone") await vscode.commands.executeCommand("datapass.locateRepository", repoKey);
    return;
  }
  const vet = vetRelativePath(repoPath);
  if (!vet.ok) throw new UserFacingError(`Refusing ${decl.path}: ${vet.reason}`);
  const uri = vscode.Uri.joinPath(folder, ...vet.relative.split("/"));
  let stat: vscode.FileStat | undefined;
  try { stat = await vscode.workspace.fs.stat(uri); } catch { stat = undefined; }
  if (!stat) {
    const choice = await vscode.window.showInformationMessage(`${decl.path} is not in ${repo.label}.`, {
      modal: true, detail: `The card "${item.title}" names ${decl.path}, and the file is not there (yet). DataPass never creates a placeholder: ask the AI to prepare it, or create it yourself.`
    }, "Prepare an AI pack for this card");
    if (choice) await cardAiPack(session, version, item.id);
    return;
  }
  if (stat.type & vscode.FileType.Directory) {
    if (vscode.workspace.getWorkspaceFolder(uri)) await vscode.commands.executeCommand("revealInExplorer", uri);
    else if (await confirmModal(`${decl.path} is a folder outside this window.`, "Open it in a new window?", "Open in new window")) await openFolderWindow(uri);
    return;
  }
  const workbenchActive = vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview && host.hasPanel();
  const editor = await vscode.window.showTextDocument(uri, { viewColumn: workbenchActive ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preview: true });
  if (decl.line) {
    const line = Math.min(decl.line, editor.document.lineCount) - 1;
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

async function openCardLink(session: WorkSession, itemId: string | undefined, index: number | undefined): Promise<void> {
  const board = requireBoard(session);
  const item = board.items.find(i => i.id === itemId);
  const url = index !== undefined ? item?.links?.[index] : undefined;
  if (!item || !url) throw new UserFacingError("Unknown link of this card.");
  const why = linkProblem(url);
  if (why) throw new UserFacingError(`Refusing this link: it ${why}.`);
  if (!session.linkConfirmed(url)) {
    if (!(await confirmModal(`Open ${new URL(url).host}?`, `${linkLabel(url)} — card "${item.title}"\n${url}\n\nThis address comes from .datapass/board.json. DataPass sends nothing to it and does not check that you can see it.`, "Open"))) return;
    session.confirmLink(url);
  }
  await openExternal(vscode.Uri.parse(url, true));
}

// ------------------------------------------------------------------ AI pack for a card

async function cardAiPack(session: WorkSession, version: string, itemId: string | undefined): Promise<void> {
  const board = requireBoard(session);
  const id = itemId ?? await pickCard(session, "Prepare an AI pack for which card?");
  if (!id) return;
  const c = card(session, id);
  const suggested = DEFAULT_QUESTION[c.type];
  const order = [suggested, ...(Object.keys(CARD_QUESTIONS) as CardQuestion[]).filter(q => q !== suggested)];
  const pick = await vscode.window.showQuickPick(order.map(q => ({ label: CARD_QUESTIONS[q].label, description: q === suggested ? "suggested" : undefined, detail: CARD_QUESTIONS[q].ask.slice(0, 140) + "…", id: q })), { title: `What should ChatGPT / Claude do with "${c.title}"?` });
  if (!pick) return;
  let errorText: string | undefined;
  if (c.type === "bug" || pick.id === "fix") {
    const src = await vscode.window.showQuickPick([
      { label: "$(clippy) Add the error message I copied", description: "from the clipboard", id: "clip" },
      { label: "$(edit) Type a short error message", id: "type" },
      { label: "$(circle-slash) No error message", id: "none" }
    ], { title: "Error text for the AI", placeHolder: "Credentials, tokens and local paths are removed before it is added" });
    if (!src) return;
    if (src.id === "clip") {
      errorText = await clipboard.readText();
      if (!errorText.trim()) void vscode.window.showWarningMessage("The clipboard is empty: the pack is prepared without an error message.");
    } else if (src.id === "type") {
      errorText = await vscode.window.showInputBox({ title: "Error message", prompt: "What you saw (one line). No passwords or tokens.", validateInput: v => v.length > 2000 ? "Keep it under 2000 characters; copy longer logs and use the clipboard option." : undefined });
      if (errorText === undefined) return;
    }
  }
  const map = session.projectMap();
  const revisions: Record<string, string> = {};
  for (const r of map.repositories) if (r.state === "local" && r.git?.head) revisions[r.key] = `${r.git.branch ?? "?"}@${r.git.head.slice(0, 7)}${r.git.changes ? " (+local changes)" : ""}`;
  const pack = buildCardPack({
    board, card: c, map, question: pick.id, errorText, dataPassVersion: version, generatedAt: new Date().toISOString(), revisions, guideUrl: GUIDE_URL,
    manifestDigest: session.project.manifestBytes ? sha256Bytes(session.project.manifestBytes).value : undefined,
    boardDigest: session.project.boardBytes ? sha256Bytes(session.project.boardBytes).value : undefined,
    sheet: session.project.sheet, options: session.project.options, readiness: session.readiness()
  });
  const choice = await vscode.window.showInformationMessage(`AI pack for "${c.title}": ${pack.bytes} bytes, ${pack.sections.length} sections${pack.truncated ? ", TRUNCATED" : ""}.`, {
    modal: true, detail: `Sections: ${pack.sections.join(", ")}\nNever included: ${pack.omissions.join(", ")}.\nPaste it into ChatGPT or Claude yourself; nothing is sent by DataPass.`
  }, "Copy", "Preview");
  if (choice === "Preview") { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: pack.text, language: "markdown" }), { preview: true }); return; }
  if (choice !== "Copy") return;
  await clipboard.writeText(pack.text);
  await session.recordExchange({ id: newLocalId("card"), kind: "ai-context", label: `Card pack (${pick.id}): ${c.id}`, status: "copied", digest: sha256Bytes(pack.text).value, scopeRef: session.model().scope.id, at: new Date().toISOString() });
  void vscode.window.showInformationMessage(pick.id === "fix" || pick.id === "implement"
    ? "Copied. The AI delivers a pull request and moves the card in board.json; when it is merged, use Check for updates."
    : pick.id === "plan" ? "Copied. Paste the AI's complete board.json back with \"Import the AI's answer\"." : "Copied. Paste it into ChatGPT or Claude.");
}
