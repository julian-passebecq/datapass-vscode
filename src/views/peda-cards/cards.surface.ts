/**
 * V5 PEDA1b (TL-12): "Pattern cards for this file" — pedagogy cards bound to the open file's own code
 * (src/core/peda-cards/bind.ts): concept cards jump to the best matching span, decision cards show the option the code
 * took or a class-A owner question. Facts come from the DataPass Hop bridge; nothing is run, no AI call.
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
import { factsFromUnderstanding } from "../../core/peda-cards/facts";

export interface ProjectCardsSource {
  locate(uri: vscode.Uri): { repositoryKey: string; nativePath: string } | undefined;
  load(uri: vscode.Uri): Promise<UnderstandingEntry | undefined>;
}
let source: ProjectCardsSource | undefined;
export function setProjectCardsSource(s: ProjectCardsSource): void { source = s; }

const CONFIG = "datapass.pedagogy";
const COMMAND = "datapass.pedagogy.patternCards";

export function cardSettings(): CardSettings {
  const c = vscode.workspace.getConfiguration(CONFIG);
  return { conceptCards: c.get<boolean>("conceptCards.enabled", true), decisionCards: c.get<boolean>("decisionCards.enabled", true) };
}

async function showPatternCards(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const at = editor && source?.locate(editor.document.uri);
  if (!editor || !at) { void vscode.window.showInformationMessage("Pattern cards: open a file of the project first."); return; }
  const entry = await source!.load(editor.document.uri);
  const facts = entry?.doc && entry.state === "ok" ? factsFromUnderstanding(at.repositoryKey, entry.doc) : [];
  const data = cardsForArtifact({ entries: CARD_ENTRIES, facts, repositoryKey: at.repositoryKey, settings: cardSettings() }, at.repositoryKey, at.nativePath);
  type Item = vscode.QuickPickItem & { line?: number; endLine?: number };
  const items: Item[] = (data.cards ?? []).map(c => {
    const span = c.fields.find(f => f.label === "pedagogy.excerpt" || f.label === "pedagogy.projectChoice")?.value;
    const text = span !== null && typeof span === "object" ? String(span.value ?? "") : "";
    const m = /:(\d+)-(\d+)$/.exec(text);
    const ask = c.fields.find(f => f.label === "pedagogy.ownerQuestion")?.value;
    return { label: c.title, description: m ? `lines ${m[1]}–${m[2]}` : ask ? "owner question" : "DataPass guidance",
      detail: ask !== null && typeof ask === "object" ? String(ask.value) : text,
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
