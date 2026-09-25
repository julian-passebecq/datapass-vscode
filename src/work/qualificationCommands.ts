/**
 * Pass 12 qualification: record what worked for each operation, then export one report.
 *
 *   Record Operation Result…      Worked / Failed / Not tried + a short note, per operation
 *   Export Qualification Report   Markdown for Claude: results + tools detected (copied and opened)
 *   Clear Qualification Results
 *
 * Results live in VS Code's per-user storage, not in any repository, and cover every project
 * opened on this machine. Notes are shortened and scrubbed of paths and credential-shaped text.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { confirmModal, guarded, UserFacingError } from "./io";
import { clipboard } from "../core/clipboard";
import type { WorkOperation } from "../core/work/workModel";
import { cleanNote, MAX_NOTE, qualificationReport, toolSnapshot, type QualificationResult } from "../core/qualification/qualification";

export function registerQualificationCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const version = String(context.extension.packageJSON.version ?? "unknown");
  reg("datapass.recordQualification", async (arg?: unknown) => record(session, version, arg));
  reg("datapass.exportQualificationReport", async () => exportReport(session, version));
  reg("datapass.clearQualificationResults", async () => {
    if (!session.qualification().length) { void vscode.window.showInformationMessage("No qualification result recorded."); return; }
    if (await confirmModal("Clear all recorded qualification results?", "This removes the Worked/Failed/Not tried results of every project on this machine. Export the report first if you need it.", "Clear")) await session.clearQualification();
  });
}

/** The inline tree button passes the tree element; the command palette passes nothing. */
function capabilityIdOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  const node = arg as { op?: WorkOperation } | undefined;
  return node?.op?.capability.id;
}

async function record(session: WorkSession, version: string, arg: unknown): Promise<void> {
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid .datapass/project.json is required.");
  const model = session.model();
  let op = model.operations.find(o => o.capability.id === capabilityIdOf(arg));
  if (!op) {
    if (!model.operations.length) throw new UserFacingError(`No operation in "${model.scope.title}".`);
    op = (await vscode.window.showQuickPick(model.operations.map(o => ({ label: o.capability.label, description: o.result.status, o })), { title: "Record the result of an operation" }))?.o;
    if (!op) return;
  }
  const choice = await vscode.window.showQuickPick([
    { label: "$(pass) Worked", result: "worked" as QualificationResult, detail: "You ran it in the native tool and it did what it should." },
    { label: "$(error) Failed", result: "failed" as QualificationResult, detail: "It did not work; say what happened in the note." },
    { label: "$(debug-pause) Not tried", result: "not-tried" as QualificationResult, detail: "Skipped for now (no account, no time, not relevant)." }
  ], { title: `Result: ${op.capability.label}`, placeHolder: "What happened when you ran it?" });
  if (!choice) return;
  const note = await vscode.window.showInputBox({
    title: `Note: ${op.capability.label}`, prompt: "Optional: error message, what you saw, what was unclear. No passwords or tokens.",
    validateInput: v => v.length > MAX_NOTE ? `Keep it under ${MAX_NOTE} characters.` : undefined
  });
  if (note === undefined) return;
  const toolIds = [...new Set(op.capability.requirements.flatMap(r => r.anyOf))];
  await session.recordQualification({
    capabilityId: op.capability.id, label: op.capability.label, result: choice.result, note: cleanNote(note),
    projectId: manifest.project.id, scopeId: model.scope.id, preflight: op.result.status,
    at: new Date().toISOString(), dataPassVersion: version, tools: toolSnapshot(toolIds, session.toolObservations())
  });
  void vscode.window.showInformationMessage(`Recorded: ${op.capability.label} — ${choice.result}. Export the report when you are done (DataPass: Export Qualification Report).`);
}

async function exportReport(session: WorkSession, version: string): Promise<void> {
  const text = qualificationReport({
    records: session.qualification(), dataPassVersion: version, vscodeVersion: vscode.version,
    platform: `${process.platform} ${process.arch}`, generatedAt: new Date().toISOString(), tools: session.toolObservations()
  });
  await clipboard.writeText(text);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: text, language: "markdown" }), { preview: true });
  void vscode.window.showInformationMessage("Qualification report copied. Paste it to Claude.");
}
