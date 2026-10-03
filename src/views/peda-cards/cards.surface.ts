/**
 * V5 PEDA1b (TL-12): "Pattern cards for this file" — pedagogy cards bound to the open file's own code
 * (src/core/peda-cards/bind.ts): concept cards jump to the best matching span, decision cards show the option the code
 * took or a class-A owner question. Facts come from the DataPass Hop bridge and from the card catalog's code signals
 * matched on the open file's text (read, never run); decision records from `.datapass/decisions/*.json`. No AI call.
 * A file outside a DataPass project still gets its cards (repository key "", path relative to its workspace folder).
 * Settings (go/TOUR-PEDA-contract.md § 6): `datapass.pedagogy.enabled` (master; off = command not registered, nothing
 * computed), `datapass.pedagogy.conceptCards.enabled`, `datapass.pedagogy.decisionCards.enabled`.
 * The Context "Patterns" section, NAVPRIN1, the Navigator and tour refs call `cardsForArtifact` / `cardsForConcepts` /
 * `cardByRef` directly.
 */
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import type { NavSurface } from "../../core/navigation/register";
import type { UnderstandingEntry } from "../../core/understanding/load";
import { cardsForArtifact, type CardSettings } from "../../core/peda-cards/bind";
import { CARD_ENTRIES } from "../../core/peda-cards/cardTypes";
import { factsFromCode, factsFromUnderstanding } from "../../core/peda-cards/facts";
import { readRationaleDocument, type DecisionRationale } from "@juliandatapass-group/decision-rationale";
import type { Card } from "../../webview/views/model";

export interface ProjectCardsSource {
  locate(uri: vscode.Uri): { repositoryKey: string; nativePath: string } | undefined;
  load(uri: vscode.Uri): Promise<UnderstandingEntry | undefined>;
  /** The project's accepted decision-rationale/1 records (none without a project). */
  rationales?(): Promise<readonly DecisionRationale[]>;
}
let source: ProjectCardsSource | undefined;
export function setProjectCardsSource(s: ProjectCardsSource): void { source = s; }

/** The accepted records of `<root>/.datapass/decisions/*.json` (read as data; unreadable or invalid files are skipped). */
export async function readDecisionRecords(root: vscode.Uri | undefined): Promise<DecisionRationale[]> {
  if (!root) return [];
  const dir = vscode.Uri.joinPath(root, ".datapass", "decisions");
  let names: [string, vscode.FileType][] = [];
  try { names = await vscode.workspace.fs.readDirectory(dir); } catch { return []; }
  const out: DecisionRationale[] = [];
  for (const [name, type] of names.sort(([a], [b]) => a.localeCompare(b))) {
    if (type !== vscode.FileType.File || !name.endsWith(".json")) continue;
    try { out.push(...readRationaleDocument(JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name))).toString("utf8"))).accepted); } catch { /* not a record file */ }
  }
  return out;
}

const CONFIG = "datapass.pedagogy";
const COMMAND = "datapass.pedagogy.patternCards";

export function cardSettings(): CardSettings {
  const c = vscode.workspace.getConfiguration(CONFIG);
  return { conceptCards: c.get<boolean>("conceptCards.enabled", true), decisionCards: c.get<boolean>("decisionCards.enabled", true) };
}

/** A project file, or a file of an open folder outside any DataPass project. */
function locate(uri: vscode.Uri): { repositoryKey: string; nativePath: string } | undefined {
  const at = source?.locate(uri);
  if (at) return at;
  const folder = uri.scheme === "file" ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
  return folder ? { repositoryKey: "", nativePath: vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/") } : undefined;
}

const fieldText = (c: Card, label: string): string | undefined => {
  const v = c.fields.find(f => f.label === label)?.value;
  return v !== null && typeof v === "object" && v.value !== null && v.value !== undefined ? String(v.value) : undefined;
};

async function showPatternCards(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const at = editor && locate(editor.document.uri);
  if (!editor || !at) { void vscode.window.showInformationMessage("Pattern cards: open a file of the project first."); return; }
  const entry = await source?.load(editor.document.uri);
  const facts = [
    ...(entry?.doc && entry.state === "ok" ? factsFromUnderstanding(at.repositoryKey, entry.doc) : []),
    ...factsFromCode(at.repositoryKey, at.nativePath, editor.document.getText(), CARD_ENTRIES)
  ];
  const rationales = (await source?.rationales?.()) ?? [];
  const data = cardsForArtifact({ entries: CARD_ENTRIES, facts, rationales, repositoryKey: at.repositoryKey, settings: cardSettings() }, at.repositoryKey, at.nativePath);
  type Item = vscode.QuickPickItem & { line?: number; endLine?: number };
  const items: Item[] = (data.cards ?? []).map(c => {
    const excerpt = fieldText(c, "pedagogy.excerpt");
    const text = excerpt ?? fieldText(c, "pedagogy.projectChoice") ?? "";
    const m = /:(\d+)-(\d+)$/.exec(text);
    const ask = fieldText(c, "pedagogy.ownerQuestion");
    const line = m && excerpt && Number(m[1]) <= editor.document.lineCount ? editor.document.lineAt(Number(m[1]) - 1).text.trim() : "";
    const others = fieldText(c, "pedagogy.alternatives");
    const detail = ask ?? (c.origin === "datapass-guidance" && !m ? `datapass-guidance · ${fieldText(c, "pedagogy.question") ?? ""}`
      : [text, line, others ? `alternatives: ${others}` : ""].filter(Boolean).join(" · "));
    return { label: c.title, description: m ? `lines ${m[1]}–${m[2]}` : ask ? "owner question" : "DataPass guidance", detail,
      ...(m ? { line: Number(m[1]), endLine: Number(m[2]) } : {}) };
  });
  const pick = await vscode.window.showQuickPick(items, { title: "Pattern cards for this file", matchOnDetail: true,
    placeHolder: facts.length ? "Bound to this file's code" : "No facts for this file yet: owner questions and general examples" });
  if (!pick?.line) return;
  const end = Math.min(pick.endLine ?? pick.line, editor.document.lineCount);
  const range = new vscode.Range(pick.line - 1, 0, end - 1, editor.document.lineAt(end - 1).text.length);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function registerProjectCards(_context: vscode.ExtensionContext, _host: NavHost): vscode.Disposable[] {
  let command: vscode.Disposable | undefined;
  const sync = () => {
    const on = vscode.workspace.getConfiguration(CONFIG).get<boolean>("enabled", true);
    if (on && !command) command = vscode.commands.registerCommand(COMMAND, showPatternCards);
    if (!on && command) { command.dispose(); command = undefined; }
  };
  sync();
  return [vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(`${CONFIG}.enabled`)) sync(); }), { dispose: () => command?.dispose() }];
}

/** NAVWIRE1 self-registration (out/gen/surfaces.ts collects every `*.surface.ts` default export). */
export default registerProjectCards satisfies NavSurface;
