/**
 * 0.15 commands: architecture options (open, preview, record a decision, export the comparison,
 * AI context to compare or apply), the project sheet, the API-free JSON exchange with an AI
 * (copy a DataPass file with instructions; import the answer after validation, a diff and a
 * backup), and restoring a backup.
 *
 * Arguments can come from webviews and are re-validated against the loaded files. DataPass writes
 * only .datapass/options.json, sheet.json, board.json, graph.json, project.json, catalog.json or
 * (0.23, when this folder is the hub) toolkit/tools.json, and
 * only after the person confirmed a diff; it keeps a backup and never commits or pushes.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { activeVariantHeader } from "./activeVariantCommands";
import { packStamp } from "./packStamps";
import type { WorkbenchHost } from "../views/workbench";
import { confirmModal, guarded, jsonBytes, readBounded, report, requireRoot, UserFacingError } from "./io";
import { workspaceJournalFs } from "./commands";
import { clipboard } from "../core/clipboard";
import { openExternal } from "../core/external";
import { applyWithJournal } from "../core/exchange/journal";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { LOCAL_DIR, readOptional, writeLocal } from "../core/workspace/loader";
import { newLocalId, sha256Bytes } from "../core/model/ids";
import { OPTIONS_PATH, type Decision, type OptionsFile } from "../core/project/options";
import { optionsMarkdown } from "../core/project/optionsReport";
import { SHEET_PATH } from "../core/project/sheet";
import { AI_TASKS, EXCHANGE_FILES, checkIncoming, exportForAi, reviewIncoming, type ExchangeKind, type IncomingReview, type ProjectContextForImport } from "../core/project/aiExchange";
import { BACKUP_SUBDIR, backupFileName, backupsToPrune, parseBackupName } from "../core/project/backups";

const GUIDE_URL = "https://github.com/julian-passebecq/datapass-vscode/blob/main/docs/PREPARING_A_PROJECT.md";
export const KINDS: readonly ExchangeKind[] = ["options", "sheet", "board", "graph", "manifest", "catalog", "toolkit"];
const str = (v: unknown, max = 300) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

/** Read-only documents shown in diffs ("the AI's proposal"), keyed by a random id. */
const proposals = new Map<string, string>();
const PROPOSAL_SCHEME = "datapass-proposal";

export function registerOptionsCommands(context: vscode.ExtensionContext, session: WorkSession, host: WorkbenchHost): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const version = String(context.extension.packageJSON.version ?? "unknown");
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, { provideTextDocumentContent: uri => proposals.get(uri.query) ?? "" }));

  reg("datapass.openOptions", async (decision?: unknown) => {
    const d = str(decision);
    host.openPanel(vscode.ViewColumn.Active, "options", d && session.project.options?.decisions.some(x => x.id === d) ? d : d === "scenarios" ? "scenarios" : undefined);
  });
  reg("datapass.openSheet", async (arg?: unknown) => {
    const a = arg as { section?: unknown; id?: unknown } | undefined;
    const section = str(a?.section, 20);
    const id = str(a?.id, 80);
    host.openPanel(vscode.ViewColumn.Active, "sheet", section && ["datasets", "formulas", "runtimes", "glossary"].includes(section) ? `${section}:${id ?? ""}` : undefined);
  });
  reg("datapass.previewArchitecture", async (arg?: unknown) => previewArchitecture(session, arg));
  reg("datapass.clearPreview", async () => session.setPreview(undefined));
  reg("datapass.recordDecision", async (arg?: unknown) => recordDecision(session, version, arg));
  reg("datapass.exportOptionsComparison", async () => exportComparison(session, version));
  reg("datapass.optionsAiContext", async (arg?: unknown) => optionsAiContext(session, version, arg));
  reg("datapass.openOptionSource", async (url?: unknown) => openDeclaredUrl(session, str(url, 2000)));
  reg("datapass.openSheetReference", async (formulaId?: unknown) => openFormulaFile(session, str(formulaId, 80)));
  reg("datapass.openOptionsFile", async () => openProjectFile(session, OPTIONS_PATH, "options"));
  reg("datapass.openSheetFile", async () => openProjectFile(session, SHEET_PATH, "sheet"));
  reg("datapass.copyForAi", async (kind?: unknown) => { await copyForAi(session, version, str(kind, 20) as ExchangeKind | undefined); });
  reg("datapass.importFromAi", async (kind?: unknown) => importFromAi(session, str(kind, 20) as ExchangeKind | undefined));
  reg("datapass.restoreBackup", async () => restoreBackup(session));
}

// ------------------------------------------------------------------ files and backups

function projectUri(root: vscode.Uri, rel: string): vscode.Uri {
  const vet = vetRelativePath(rel);
  if (!vet.ok) throw new UserFacingError(`Refusing ${rel}: ${vet.reason}`);
  return vscode.Uri.joinPath(root, ...vet.relative.split("/"));
}

/** Keep the newest backups of one file; older ones are deleted. */
async function pruneBackups(root: vscode.Uri, target: string): Promise<void> {
  const dir = vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), BACKUP_SUBDIR);
  let names: string[] = [];
  try { names = (await vscode.workspace.fs.readDirectory(dir)).filter(([, t]) => t === vscode.FileType.File).map(([n]) => n); } catch { return; }
  for (const n of backupsToPrune(names, target)) { try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, n)); } catch { /* best effort */ } }
}

/**
 * Write one project file: refuse if it changed since DataPass read it, keep a named backup of the
 * previous content under .datapass/local/backups, then write through the journal (read-back check).
 */
export async function writeProjectFile(session: Pick<WorkSession, "root">, rel: string, next: Uint8Array, base: Uint8Array | undefined): Promise<string | undefined> {
  const root = requireRoot(session.root);
  const fs = workspaceJournalFs(root);
  const current = await fs.read(rel);
  const currentHash = current ? sha256Bytes(current).value : null;
  if (currentHash !== (base ? sha256Bytes(base).value : null)) throw new UserFacingError(`${rel} changed on disk since DataPass read it. Nothing was written: re-inspect, then try again.`);
  let backup: string | undefined;
  if (current) {
    const name = backupFileName(rel, new Date());
    await writeLocal(root, `${BACKUP_SUBDIR}/${name}`, current);
    backup = `${LOCAL_DIR}/${BACKUP_SUBDIR}/${name}`;
    await pruneBackups(root, rel);
  }
  const id = newLocalId("write");
  await applyWithJournal(fs, `${LOCAL_DIR}/journal/${id}.json`, id, new Date().toISOString(), [{ target: rel, bytes: next, expectedBaseHash: currentHash }]);
  return backup;
}

export async function showProposalDiff(root: vscode.Uri, rel: string, proposed: string, title: string): Promise<void> {
  const key = newLocalId("proposal");
  proposals.set(key, proposed);
  if (proposals.size > 20) proposals.delete(proposals.keys().next().value!);
  const left = projectUri(root, rel);
  const exists = Boolean(await readOptional(left));
  const right = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${rel.split("/").pop()}`, query: key });
  if (exists) await vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: true });
  else await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(right), { preview: true });
}

/** Open the project's copy of a DataPass file (the graph where project.json says it is). */
export async function openExchangeFile(session: WorkSession, kind: ExchangeKind): Promise<void> {
  await openProjectFile(session, kind === "graph" ? session.project.manifest?.graph ?? EXCHANGE_FILES.graph.path : EXCHANGE_FILES[kind].path, kind);
}

async function openProjectFile(session: WorkSession, rel: string, kind: ExchangeKind): Promise<void> {
  const root = requireRoot(session.root);
  const uri = projectUri(root, rel);
  if (await readOptional(uri)) { await vscode.window.showTextDocument(uri); return; }
  const choice = await vscode.window.showInformationMessage(`${rel} does not exist yet.`, { modal: true, detail: `Your AI assistant prepares it: DataPass copies the instructions and the format, you paste its answer back with "Import the AI's answer" (or it opens a pull request).` }, "Copy instructions for the AI", "Open the guide");
  if (choice === "Copy instructions for the AI") await vscode.commands.executeCommand("datapass.copyForAi", kind);
  else if (choice === "Open the guide") await vscode.commands.executeCommand("datapass.openPreparationGuide");
}

// ------------------------------------------------------------------ options

function requireOptions(session: WorkSession): OptionsFile {
  const o = session.project.options;
  if (!o) throw new UserFacingError(session.project.optionsError ? `.datapass/options.json has errors: ${session.project.optionsError}` : "This project has no .datapass/options.json yet. Use \"Copy for the AI\" to ask your AI assistant to propose options.");
  return o;
}

async function previewArchitecture(session: WorkSession, arg?: unknown): Promise<void> {
  const o = requireOptions(session);
  const a = arg as { scenario?: unknown; picks?: unknown } | undefined;
  const scenario = str(a?.scenario, 80);
  if (scenario) {
    if (scenario !== "current" && scenario !== "decided" && !o.scenarios?.some(s => s.id === scenario)) throw new UserFacingError(`Unknown scenario "${scenario}".`);
    await session.setPreview(scenario === "current" ? undefined : { scenario });
    return;
  }
  if (Array.isArray(a?.picks)) { await session.setPreview({ picks: a!.picks.map(p => str(p, 170)).filter((p): p is string => !!p) }); return; }
  const items: Array<vscode.QuickPickItem & { id: string }> = [
    { label: "$(circle-large-outline) Current architecture", description: "graph.json as it is", id: "current" },
    ...(o.decisions.some(d => d.chosen && d.chosen !== d.current) ? [{ label: "$(star-full) Decided (to apply)", description: "each decision's chosen option", id: "decided" }] : []),
    ...(o.scenarios ?? []).map(s => ({ label: `$(type-hierarchy) ${s.title}`, description: s.recommended ? "recommended" : undefined, detail: s.description, id: s.id }))
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "Preview which architecture on the diagram?", placeHolder: "A preview: nothing is written" });
  if (!pick) return;
  await session.setPreview(pick.id === "current" ? undefined : { scenario: pick.id });
  await vscode.commands.executeCommand("datapass.architecture.focus");
}

/** A decision with its keys in the documented order (chosen, date and rationale after current). */
function withDecision(o: OptionsFile, decisionId: string, patch: Partial<Pick<Decision, "chosen" | "decidedOn" | "decidedBy" | "rationale">> | "clear"): OptionsFile {
  const next = structuredClone(o);
  const i = next.decisions.findIndex(d => d.id === decisionId);
  const d = next.decisions[i]!;
  const merged = patch === "clear" ? { ...d, chosen: undefined, decidedOn: undefined, decidedBy: undefined, rationale: undefined } : { ...d, ...patch };
  const order: Array<keyof Decision> = ["id", "title", "question", "level", "subproject", "concerns", "current", "chosen", "decidedOn", "decidedBy", "rationale", "options", "notes"];
  const out: Record<string, unknown> = {};
  for (const k of order) if (merged[k] !== undefined) out[k] = merged[k];
  next.decisions[i] = out as unknown as Decision;
  return next;
}

async function recordDecision(session: WorkSession, version: string, arg?: unknown): Promise<void> {
  const o = requireOptions(session);
  const a = arg as { decision?: unknown; option?: unknown } | undefined;
  let d = o.decisions.find(x => x.id === str(a?.decision, 80));
  if (!d) {
    const pick = await vscode.window.showQuickPick(o.decisions.map(x => ({ label: x.title, description: `current: ${x.options.find(y => y.id === x.current)?.label}`, id: x.id })), { title: "Record a decision for which choice?" });
    d = o.decisions.find(x => x.id === pick?.id);
    if (!d) return;
  }
  let optionId = str(a?.option, 80);
  if (!optionId || !d.options.some(x => x.id === optionId)) {
    const pick = await vscode.window.showQuickPick([
      ...d.options.map(x => ({ label: `${x.id === d!.chosen ? "$(star-full) " : ""}${x.label}`, description: x.id === d!.current ? "current" : undefined, detail: x.summary, id: x.id })),
      ...(d.chosen ? [{ label: "$(close) Clear the recorded decision", id: "" }] : [])
    ], { title: `${d.title}: which option did you decide?` });
    if (!pick) return;
    optionId = pick.id;
  }
  const bytes = session.project.optionsBytes;
  let next: OptionsFile;
  let summary: string;
  if (!optionId) {
    next = withDecision(o, d.id, "clear");
    summary = `Clear the recorded decision for "${d.title}".`;
  } else {
    const option = d.options.find(x => x.id === optionId)!;
    const rationale = await vscode.window.showInputBox({ title: `${d.title}: ${option.label}`, prompt: "Why? One sentence for the record and for the AI (optional). No secrets.", value: d.chosen === optionId ? d.rationale : undefined, validateInput: v => v.length > 1000 ? "Keep it under 1000 characters." : undefined });
    if (rationale === undefined) return;
    next = withDecision(o, d.id, { chosen: optionId, decidedOn: new Date().toISOString().slice(0, 10), rationale: rationale.trim() || undefined });
    summary = optionId === d.current ? `Keep "${option.label}" for "${d.title}" (it is already what graph.json describes).` : `Decide "${option.label}" for "${d.title}". graph.json still describes "${d.options.find(x => x.id === d!.current)?.label}": the AI applies the change in a pull request.`;
  }
  const root = requireRoot(session.root);
  if (!(await confirmModal("Record this decision in .datapass/options.json?", `${summary}\n\nThe file is rewritten in DataPass's standard JSON formatting; the previous version is kept in ${LOCAL_DIR}/${BACKUP_SUBDIR}. Commit it yourself when you are ready (DataPass never commits or pushes).`, "Record decision"))) return;
  const backup = await writeProjectFile(session, OPTIONS_PATH, jsonBytes(next), bytes);
  await session.refresh();
  const apply = optionId && optionId !== d.current;
  const choice = await vscode.window.showInformationMessage(`Decision recorded in options.json${backup ? " (backup kept)" : ""}.`, ...(apply ? ["Ask the AI to apply it"] : []), "Open options.json");
  if (choice === "Ask the AI to apply it") await optionsAiContext(session, version, { purpose: "apply", decision: d.id, option: optionId });
  else if (choice === "Open options.json") await vscode.window.showTextDocument(projectUri(root, OPTIONS_PATH));
}

async function exportComparison(session: WorkSession, version: string): Promise<void> {
  const o = requireOptions(session);
  const analysis = session.optionsAnalysis()!;
  const md = optionsMarkdown({ options: o, analysis, project: session.projectMap().project, purpose: "export", generatedAt: new Date().toISOString(), dataPassVersion: version, activeVariant: activeVariantHeader(session) });
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: md.text, language: "markdown" }), { preview: true });
  const choice = await vscode.window.showInformationMessage(`Comparison ready (${md.bytes} bytes${md.truncated ? ", truncated" : ""}). Save it where you like, or copy it.`, "Copy");
  if (choice === "Copy") await clipboard.writeText(md.text);
}

async function optionsAiContext(session: WorkSession, version: string, arg?: unknown): Promise<void> {
  const o = requireOptions(session);
  const a = arg as { purpose?: unknown; decision?: unknown; option?: unknown } | undefined;
  const purpose = a?.purpose === "apply" ? "apply" : "compare";
  const decisionId = str(a?.decision, 80);
  const decision = decisionId ? o.decisions.find(d => d.id === decisionId) : undefined;
  if (decisionId && !decision) throw new UserFacingError(`Unknown decision "${decisionId}".`);
  const optionId = str(a?.option, 80);
  if (purpose === "apply" && (!decision || !(optionId ?? decision.chosen))) throw new UserFacingError("Record a decision first: the AI applies the chosen option.");
  if (optionId && !decision?.options.some(x => x.id === optionId)) throw new UserFacingError(`Unknown option "${optionId}".`);
  const md = optionsMarkdown({
    options: o, analysis: session.optionsAnalysis()!, project: session.projectMap().project, purpose, decisionId, optionId,
    generatedAt: new Date().toISOString(), dataPassVersion: version, guideUrl: GUIDE_URL, activeVariant: activeVariantHeader(session), stamp: await packStamp(session)
  });
  const choice = await vscode.window.showInformationMessage(`AI context (${purpose === "apply" ? "apply a decision" : "compare options"}): ${md.bytes} bytes${md.truncated ? ", truncated" : ""}.`, {
    modal: true, detail: "It contains the options (with their declared prices and sources) and DataPass's analysis of the consequences. Never included: local paths, file contents, credentials. Paste it into ChatGPT or Claude yourself."
  }, "Copy", "Preview");
  if (choice === "Preview") { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: md.text, language: "markdown" }), { preview: true }); return; }
  if (choice !== "Copy") return;
  await clipboard.writeText(md.text);
  await session.recordExchange({ id: newLocalId("options"), kind: "ai-context", label: `Options (${purpose}): ${decision?.title ?? "all decisions"}`, status: "copied", digest: sha256Bytes(md.text).value, scopeRef: session.model().scope.id, at: new Date().toISOString() });
  void vscode.window.showInformationMessage(purpose === "apply" ? "Copied. When the AI's pull request is merged, use Check for updates." : "Copied. If the AI returns a corrected options.json, use \"Import the AI's answer\".");
}

/** Only web addresses the project's own files declare (cost sources, option docs, formula references). */
async function openDeclaredUrl(session: WorkSession, url: string | undefined): Promise<void> {
  if (!url || !/^https:\/\/\S+$/.test(url)) throw new UserFacingError("Only https addresses declared by the project open here.");
  const o = session.project.options;
  const sh = session.project.sheet;
  const declared = new Set<string>([
    ...(o?.decisions ?? []).flatMap(d => d.options.flatMap(x => [...(x.costs ?? []).map(c => c.source), ...(x.docs ?? []).map(doc => doc.url)])),
    ...(sh?.formulas ?? []).map(f => f.reference)
  ].filter((u): u is string => !!u));
  if (!declared.has(url)) throw new UserFacingError("This address is not declared in options.json or sheet.json.");
  if (!session.linkConfirmed(url)) {
    if (!(await confirmModal(`Open ${new URL(url).host}?`, `${url}\n\nThis address comes from the project files.`, "Open"))) return;
    session.confirmLink(url);
  }
  await openExternal(vscode.Uri.parse(url));
}

async function openFormulaFile(session: WorkSession, formulaId: string | undefined): Promise<void> {
  const f = session.project.sheet?.formulas?.find(x => x.id === formulaId);
  if (!f?.where) throw new UserFacingError("This formula does not say which file computes it.");
  const map = session.projectMap();
  const repoKey = f.where.repoRef ?? map.components.find(c => c.id === f.componentId)?.repoKey ?? map.coordinationKey;
  const folder = session.repoFolder(repoKey);
  if (!folder) throw new UserFacingError(`The repository "${repoKey}" is not cloned on this machine. Clone it or locate it first.`);
  const vet = vetRelativePath(f.where.path);
  if (!vet.ok) throw new UserFacingError(`Refusing ${f.where.path}: ${vet.reason}`);
  const uri = vscode.Uri.joinPath(folder, ...vet.relative.split("/"));
  try { await vscode.workspace.fs.stat(uri); } catch { throw new UserFacingError(`${f.where.path} is not there in ${repoKey}.`); }
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  // Put the cursor on the function or symbol that computes it, when the file names it.
  const symbol = f.where.symbol;
  if (symbol) {
    const at = doc.getText().search(new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    if (at >= 0) { const pos = doc.positionAt(at); editor.selection = new vscode.Selection(pos, pos); editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter); }
  }
}

// ------------------------------------------------------------------ JSON exchange with an AI

async function pickKind(title: string, preset?: ExchangeKind): Promise<ExchangeKind | undefined> {
  if (preset && KINDS.includes(preset)) return preset;
  const pick = await vscode.window.showQuickPick(KINDS.map(k => ({ label: EXCHANGE_FILES[k].label, description: EXCHANGE_FILES[k].path, id: k })), { title });
  return pick?.id;
}

function currentBytes(session: WorkSession, kind: ExchangeKind): Promise<Uint8Array | undefined> | Uint8Array | undefined {
  const c = session.project;
  switch (kind) {
    case "manifest": return c.manifestBytes;
    case "options": return c.optionsBytes;
    case "sheet": return c.sheetBytes;
    case "board": return c.boardBytes;
    default: {
      const root = session.root;
      if (!root) return undefined;
      const rel = kind === "graph" ? c.manifest?.graph ?? EXCHANGE_FILES.graph.path : EXCHANGE_FILES[kind].path;
      return readOptional(projectUri(root, rel));
    }
  }
}

/**
 * Copy a DataPass file with the AI's instructions. With `taskId` (the AI exchange view) nothing is
 * asked; from the Workbench or the palette the file and the task are picked. Returns the copied path.
 */
export async function copyForAi(session: WorkSession, version: string, preset?: ExchangeKind, taskId?: string, quiet = false): Promise<string | undefined> {
  requireRoot(session.root);
  const kind = await pickKind("Copy which DataPass file for the AI?", preset);
  if (!kind) return undefined;
  const tasks = AI_TASKS[kind];
  const task = tasks.find(t => t.id === taskId) ?? (tasks.length === 1 ? tasks[0]! : (await vscode.window.showQuickPick(tasks.map(t => ({ label: t.label, detail: t.ask.slice(0, 150) + (t.ask.length > 150 ? "…" : ""), t })), { title: `What should the AI do with ${EXCHANGE_FILES[kind].path}?` }))?.t);
  if (!task) return undefined;
  const bytes = await currentBytes(session, kind);
  const recipes = kind === "board" ? [...session.catalogue().recipes.values()].map(r => ({ id: r.id, title: r.title, routes: r.routes.map(x => x.id) })) : undefined;
  const text = exportForAi(kind, bytes ? new TextDecoder().decode(bytes) : undefined, task, { projectTitle: session.project.manifest?.project.title, guideUrl: GUIDE_URL, dataPassVersion: version, recipes });
  await clipboard.writeText(text);
  await session.recordExchange({ id: newLocalId("ai-file"), kind: "ai-context", label: `${EXCHANGE_FILES[kind].path} for the AI (${task.id})`, status: "copied", digest: sha256Bytes(text).value, scopeRef: session.model().scope.id, at: new Date().toISOString() });
  if (!quiet) void vscode.window.showInformationMessage(`Copied ${EXCHANGE_FILES[kind].path} with instructions. Paste it into ChatGPT or Claude, then paste its complete answer in the AI exchange view (right side bar).`, "Open the AI exchange").then(c => { if (c) void vscode.commands.executeCommand("datapass.showAiExchange", kind); });
  return EXCHANGE_FILES[kind].path;
}

export function importContext(session: WorkSession): ProjectContextForImport {
  const c = session.project;
  return { manifest: c.manifest, graph: c.graph, graphPath: c.manifest?.graph, decisionIds: c.options?.decisions.map(d => d.id), options: c.options, dataPassVersion: session.version };
}

/** The live check of the AI exchange view: which file the answer is, whether it is valid, how much changes. */
export async function reviewAnswer(session: WorkSession, raw: string): Promise<IncomingReview> {
  if (!session.root) return { ok: false, error: "Open the project folder first." };
  return reviewIncoming(raw, importContext(session), async kind => { const b = await currentBytes(session, kind); return b ? new TextDecoder().decode(b) : undefined; });
}

async function importFromAi(session: WorkSession, preset?: ExchangeKind): Promise<void> {
  requireRoot(session.root);
  const source = await vscode.window.showQuickPick([
    { label: "$(clippy) From the clipboard", description: "the AI's answer, or only its JSON block", id: "clip" },
    { label: "$(file) From a file…", id: "file" }
  ], { title: "Import the AI's answer", placeHolder: "The answer is untrusted data: it is validated and shown as a diff before anything is written" });
  if (!source) return;
  let raw: string;
  if (source.id === "clip") {
    raw = await clipboard.readText();
    if (!raw.trim()) throw new UserFacingError("The clipboard is empty.");
  } else {
    const picked = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, filters: { "JSON or Markdown": ["json", "md", "txt"] }, title: "The AI's answer" });
    if (!picked?.[0]) return;
    raw = new TextDecoder().decode(await readBounded(picked[0], 2 * 1024 * 1024));
  }
  await importAnswer(session, raw, preset);
}

/**
 * Write an AI answer as its DataPass file: validated, shown as a diff, confirmed in a modal, backed
 * up. `raw` is untrusted (clipboard, a file, or the AI exchange view). Returns what was written.
 */
export async function importAnswer(session: WorkSession, raw: string, preset?: ExchangeKind): Promise<{ path: string; backup?: string } | undefined> {
  const root = requireRoot(session.root);
  let incoming;
  try {
    incoming = checkIncoming(raw, importContext(session), preset && KINDS.includes(preset) ? preset : undefined);
  } catch (e) {
    throw new UserFacingError(`Not imported: ${e instanceof Error ? e.message : String(e)}`);
  }
  const vet = vetRelativePath(incoming.path);
  if (!vet.ok) throw new UserFacingError(`Refusing ${incoming.path}: ${vet.reason}`);
  const base = await currentBytes(session, incoming.kind);
  if (base && new TextDecoder().decode(base) === incoming.text) { void vscode.window.showInformationMessage(`${incoming.path} already has exactly this content.`); return undefined; }
  await showProposalDiff(root, incoming.path, incoming.text, `${incoming.path}: current ↔ AI proposal`);
  const detail = [
    `The diff shows the current file (left) and the AI's proposal (right).`,
    incoming.warnings.length ? `Warnings (the file is still valid):\n${incoming.warnings.slice(0, 8).map(w => `• ${w}`).join("\n")}` : "",
    `The previous version is kept in ${LOCAL_DIR}/${BACKUP_SUBDIR}. Review, then commit it yourself: DataPass never commits or pushes.`
  ].filter(Boolean).join("\n\n");
  if (!(await confirmModal(`Write the AI's ${EXCHANGE_FILES[incoming.kind].label}?`, detail, base ? "Replace the file" : "Create the file"))) return undefined;
  const backup = await writeProjectFile(session, incoming.path, new TextEncoder().encode(incoming.text), base);
  await session.recordExchange({ id: newLocalId("ai-import"), kind: "ai-context", label: `${incoming.path} from the AI`, status: "imported", digest: sha256Bytes(incoming.text).value, scopeRef: session.model().scope.id, at: new Date().toISOString() });
  await session.refresh();
  report(`Imported ${incoming.path}`, [`Kind: ${incoming.kind}`, backup ? `Backup: ${backup}` : "New file (no previous version).", ...incoming.warnings.map(w => `Warning: ${w}`), "Next: review the change in Source Control and commit it."]);
  void vscode.window.showInformationMessage(`${incoming.path} written${backup ? " (backup kept)" : ""}. Review and commit it in Source Control.`, "Open Source Control").then(x => { if (x) void vscode.commands.executeCommand("workbench.view.scm"); });
  return { path: incoming.path, backup };
}

async function restoreBackup(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const dir = vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), BACKUP_SUBDIR);
  let names: string[] = [];
  try { names = (await vscode.workspace.fs.readDirectory(dir)).filter(([, t]) => t === vscode.FileType.File).map(([n]) => n); } catch { /* none */ }
  const backups = names.map(n => ({ n, b: parseBackupName(n) })).filter((x): x is { n: string; b: { at: string; target: string } } => !!x.b).sort((a, b) => b.n.localeCompare(a.n));
  if (!backups.length) { void vscode.window.showInformationMessage("No DataPass backup yet: they are made when DataPass writes a project file (a decision, an AI import)."); return; }
  const pick = await vscode.window.showQuickPick(backups.slice(0, 100).map(x => ({ label: x.b.target, description: new Date(x.b.at).toLocaleString(), x })), { title: "Restore which backup?", placeHolder: "Shown as a diff first; the current version is backed up too" });
  if (!pick) return;
  const target = pick.x.b.target;
  if (!vetRelativePath(target).ok || !/^\.datapass\/[a-z.-]+\.json$/.test(target)) throw new UserFacingError(`Refusing to restore ${target}.`);
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, pick.x.n));
  const current = await readOptional(projectUri(root, target));
  await showProposalDiff(root, target, new TextDecoder().decode(bytes), `${target}: current ↔ backup of ${pick.description}`);
  if (!(await confirmModal(`Restore ${target} from ${pick.description}?`, "The current version is backed up first. Commit the result yourself.", "Restore"))) return;
  await writeProjectFile(session, target, bytes, current);
  await session.refresh();
  void vscode.window.showInformationMessage(`${target} restored.`);
}
