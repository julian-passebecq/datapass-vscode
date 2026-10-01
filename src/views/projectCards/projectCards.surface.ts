/**
 * V5 PEDA1b (TL-12): "Pattern cards for this file" — pedagogy cards bound to the open file's own code
 * (src/core/pedagogy/projectCards/bind.ts): concept cards jump to the best matching span, decision cards show the
 * option the code took or a class-A owner question. Facts come from the DataPass Hop bridge; nothing is run, no AI call.
 * The Context "Patterns" section, NAVPRIN1 and the Navigator call `cardsForArtifact` / `cardsForConcepts` directly.
 */
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import type { UnderstandingEntry } from "../../core/understanding/load";
import { cardsForArtifact } from "../../core/pedagogy/projectCards/bind";
import { PEDAGOGY_CARDS } from "../../core/pedagogy/projectCards/catalogStub";
import { factsFromUnderstanding } from "../../core/pedagogy/projectCards/facts";

export interface ProjectCardsSource {
  locate(uri: vscode.Uri): { repositoryKey: string; nativePath: string } | undefined;
  load(uri: vscode.Uri): Promise<UnderstandingEntry | undefined>;
}
let source: ProjectCardsSource | undefined;
export function setProjectCardsSource(s: ProjectCardsSource): void { source = s; }

async function showPatternCards(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const at = editor && source?.locate(editor.document.uri);
  if (!editor || !at) { void vscode.window.showInformationMessage("Pattern cards: open a file of the project first."); return; }
  const entry = await source!.load(editor.document.uri);
  const facts = entry?.doc && entry.state === "ok" ? factsFromUnderstanding(at.repositoryKey, entry.doc) : [];
  const data = cardsForArtifact({ cards: PEDAGOGY_CARDS, facts, repositoryKey: at.repositoryKey }, at.repositoryKey, at.nativePath);
  const cards = data.cards ?? [];
  type Item = vscode.QuickPickItem & { line?: number; endLine?: number };
  const items: Item[] = cards.map(c => {
    const excerpt = c.fields.find(f => f.label === "pedagogy.excerpt" || f.label === "pedagogy.projectChoice")?.value;
    const text = excerpt !== null && typeof excerpt === "object" ? String(excerpt.value ?? "") : "";
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
  return [vscode.commands.registerCommand("datapass.pedagogy.patternCards", showPatternCards)];
}
