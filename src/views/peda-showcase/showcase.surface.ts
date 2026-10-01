/**
 * V5 PEDA3 (TL-12c): "Queries worth showing" — the project's notable queries as showcase cards, ranked by interview
 * value (src/core/peda-showcase). Facts come from the DataPass Hop bridge (V3-HOP1); the query text is read (never
 * run) for the technique tagger. Picking a query jumps to its span. No AI call.
 * `datapass.pedagogy.queryShowcase.enabled` off = the command is not registered and nothing is computed
 * (go/TOUR-PEDA-contract.md § 6); `datapass.pedagogy.queryShowcase.topN` sets the list size.
 */
import { promises as fsp } from "node:fs";
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import type { UnderstandingEntry, UnderstandingIndex } from "../../core/understanding/load";
import { factsFromUnderstanding } from "../../core/peda-showcase/facts";
import { showcaseBinding, type ContextText } from "../../core/peda-showcase/assemble";
import type { QueryFact } from "../../core/peda-showcase/score";

export interface QueryShowcaseSource {
  index(): UnderstandingIndex | undefined;
  load(repositoryKey: string, nativePath: string): Promise<UnderstandingEntry | undefined>;
}

let source: QueryShowcaseSource | undefined;
export function setQueryShowcaseSource(s: QueryShowcaseSource): void { source = s; }

const CONFIG = "datapass.pedagogy.queryShowcase";
const COMMAND = "datapass.pedagogy.queriesWorthShowing";
const MAX_CODE_BYTES = 2 * 1024 * 1024;

async function readCode(file: string | undefined): Promise<string | undefined> {
  if (!file) return undefined;
  try { return (await fsp.stat(file)).size <= MAX_CODE_BYTES ? await fsp.readFile(file, "utf8") : undefined; } catch { return undefined; }
}

/** Bridge explanations of SQL / PySpark files that still match their code → facts, context and native files. */
async function collect(): Promise<{ facts: QueryFact[]; context: Map<string, ContextText>; files: Map<string, string> }> {
  const facts: QueryFact[] = [], context = new Map<string, ContextText>(), files = new Map<string, string>();
  for (const f of source?.index()?.files ?? []) {
    const entry = await source!.load(f.repositoryKey, f.nativePath);
    if (!entry?.doc || entry.state !== "ok") continue;
    const got = factsFromUnderstanding(f.repositoryKey, entry.doc, await readCode(entry.nativeFile));
    if (!got) continue;
    facts.push(got.fact);
    if (got.context) context.set(got.fact.id, got.context);
    if (entry.nativeFile) files.set(got.fact.id, entry.nativeFile);
  }
  return { facts, context, files };
}

async function showQueriesWorthShowing(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(CONFIG);
  const { facts, context, files } = await collect();
  const data = showcaseBinding({ facts, context }, Math.max(1, Math.min(50, cfg.get<number>("topN", 10))));
  type Item = vscode.QuickPickItem & { nodeId?: string };
  const items: Item[] = (data.cards ?? []).map(c => {
    const v = (key: string) => { const x = c.fields.find(f => f.label === key)?.value; const val = x !== null && typeof x === "object" ? x.value : x; return val === null || val === undefined ? "—" : String(val); };
    return { label: c.title, nodeId: c.nodeId,
      description: c.nodeId ? `${v("showcase.score")} · ${v("showcase.query")}` : "DataPass guidance (not from this project)",
      detail: c.nodeId ? `${v("showcase.techniques")} — ${v("showcase.context")}` : `${v("showcase.teaches")} — ${v("showcase.tip")}` };
  });
  const pick = await vscode.window.showQuickPick(items, { title: "Queries worth showing", matchOnDescription: true, matchOnDetail: true,
    placeHolder: facts.length ? "Ranked by interview value (technique rarity × complexity × lineage centrality)" : "No query facts for this project yet: general examples" });
  const fact = pick?.nodeId ? facts.find(f => f.id === pick.nodeId) : undefined;
  const file = fact && files.get(fact.id);
  if (!fact || !file) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const end = Math.min(fact.span.endLine, doc.lineCount);
  const range = new vscode.Range(fact.span.startLine - 1, 0, end - 1, doc.lineAt(end - 1).text.length);
  await vscode.window.showTextDocument(doc, { selection: range, preview: true });
}

export function registerQueryShowcase(_context: vscode.ExtensionContext, _host: NavHost): vscode.Disposable[] {
  let command: vscode.Disposable | undefined;
  const sync = () => {
    const on = vscode.workspace.getConfiguration(CONFIG).get<boolean>("enabled", true);
    if (on && !command) command = vscode.commands.registerCommand(COMMAND, showQueriesWorthShowing);
    if (!on && command) { command.dispose(); command = undefined; }
  };
  sync();
  return [vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(CONFIG)) sync(); }), { dispose: () => command?.dispose() }];
}
