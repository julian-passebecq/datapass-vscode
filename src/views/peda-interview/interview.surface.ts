/**
 * V5 PEDA2 (TL-12, Julian addenda 2–3): "Interview prep" — the notions this project really uses, ranked by use and
 * blast radius, each with 2–3 interview questions, where it is in the project and why this choice here (or a hole);
 * "Explain the project" first and "Queries worth showing" (PEDA3) last, along the whole-picture spine. The same data
 * builds the in-memory built-in tours `datapass.whole-picture` / `datapass.learning` / `datapass.interview`
 * (src/core/peda-interview). "Ask the AI for model answers" goes through the manual exchange only (kind
 * `peda-model-answers`, answers stamped ai-proposed). Nothing is run; no hidden AI call.
 * Settings (go/TOUR-PEDA-contract.md § 6): `datapass.pedagogy.enabled` and `.interviewPrep.enabled` off = commands not
 * registered, nothing computed; `.interviewPrep.maxNotions` (15, 10–20); `.askYourself.enabled`; `.modelAnswers.enabled`.
 * Facts come from the DataPass Hop bridge (PEDA1b concept facts, PEDA3 query facts).
 */
import { promises as fsp } from "node:fs";
import * as vscode from "vscode";
import type { NavHost } from "../../core/navigation/navHost";
import type { NavSurface } from "../../core/navigation/register";
import type { UnderstandingEntry, UnderstandingIndex } from "../../core/understanding/load";
import type { CodeSpan, ProjectFact } from "../../core/peda-cards/bind";
import { CARD_ENTRIES } from "../../core/peda-cards/cardTypes";
import { factsFromUnderstanding as conceptFacts } from "../../core/peda-cards/facts";
import { factsFromUnderstanding as queryFacts } from "../../core/peda-showcase/facts";
import { topQueries, type QueryFact } from "../../core/peda-showcase/score";
import { interviewPrep, type InterviewPrep } from "../../core/peda-interview/prep";
import { resolveProjectRef } from "../../core/peda-interview/projectTopics";
import { locateInMap, rootOf, spineNodesFromMap, WHOLE_PICTURE_STEP_IDS } from "../../core/peda-interview/spine";
import { modelAnswersRequest, readModelAnswers } from "../../core/peda-interview/modelAnswers";

export interface InterviewSource {
  index(): UnderstandingIndex | undefined;
  load(repositoryKey: string, nativePath: string): Promise<UnderstandingEntry | undefined>;
}
let source: InterviewSource | undefined;
export function setInterviewSource(s: InterviewSource): void { source = s; }

const CONFIG = "datapass.pedagogy";
const COMMANDS = { prep: "datapass.pedagogy.interviewPrep", answers: "datapass.pedagogy.askModelAnswers" } as const;
const MAX_CODE_BYTES = 2 * 1024 * 1024;
const QUERY_TOP_N = 10;

async function readCode(file: string | undefined): Promise<string | undefined> {
  if (!file) return undefined;
  try { return (await fsp.stat(file)).size <= MAX_CODE_BYTES ? await fsp.readFile(file, "utf8") : undefined; } catch { return undefined; }
}

interface Gathered { readonly prep: InterviewPrep; readonly files: ReadonlyMap<string, string>; readonly queries: readonly QueryFact[] }

async function gather(host: NavHost): Promise<Gathered> {
  const facts: ProjectFact[] = [], qf: QueryFact[] = [], files = new Map<string, string>();
  for (const f of source?.index()?.files ?? []) {
    const entry = await source!.load(f.repositoryKey, f.nativePath);
    if (!entry?.doc || entry.state !== "ok") continue;
    facts.push(...conceptFacts(f.repositoryKey, entry.doc));
    const q = queryFacts(f.repositoryKey, entry.doc, await readCode(entry.nativeFile));
    if (q) qf.push(q.fact);
    if (entry.nativeFile) files.set(`${f.repositoryKey}/${entry.doc.target.path}`, entry.nativeFile);
  }
  const map = host.projectMap();
  const cfg = vscode.workspace.getConfiguration(CONFIG);
  const locate = locateInMap(map);
  const root = rootOf(map);
  const top = topQueries(qf, Math.max(1, Math.min(50, cfg.get<number>("queryShowcase.topN", QUERY_TOP_N))));
  const prep = interviewPrep({
    entries: CARD_ENTRIES, facts, map, root, spineNodes: spineNodesFromMap(map), locate,
    queries: top.map(q => ({ title: q.fact.title, location: locate(q.fact) ?? root })),
    viewAt: l => host.nav.viewsAt(l)[0]?.id ?? "",
    settings: { maxNotions: cfg.get<number>("interviewPrep.maxNotions", 15), askYourself: cfg.get<boolean>("askYourself.enabled", true),
      learning: vscode.workspace.getConfiguration("datapass.guided").get<boolean>("modes.learning.enabled", true),
      interview: vscode.workspace.getConfiguration("datapass.guided").get<boolean>("modes.interview.enabled", true) }
  });
  return { prep, files, queries: top.map(q => q.fact) };
}

const where = (s: CodeSpan) => `${s.path}:${s.startLine}-${s.endLine}`;

async function reveal(file: string, startLine: number, endLine: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const end = Math.min(Math.max(startLine, endLine), doc.lineCount);
  const range = new vscode.Range(Math.max(0, startLine - 1), 0, end - 1, doc.lineAt(end - 1).text.length);
  await vscode.window.showTextDocument(doc, { selection: range, preview: true });
}

async function showInterviewPrep(host: NavHost): Promise<void> {
  const { prep, files, queries } = await gather(host);
  const ask = vscode.workspace.getConfiguration(CONFIG).get<boolean>("askYourself.enabled", true);
  type Item = vscode.QuickPickItem & { file?: string; span?: { startLine: number; endLine: number }; json?: boolean };
  const items: Item[] = [];
  const explain = resolveProjectRef("project:explain", prep.brief)!;
  items.push({ label: "$(book) Explain the project", detail: [...explain.lines.map(l => l.text), ...explain.holes.map(h => `hole: ${h.reason}`)].join(" · ") || undefined });
  for (const step of WHOLE_PICTURE_STEP_IDS) {
    const stop = resolveProjectRef(`project:whole-picture.${step}`, prep.brief)!;
    items.push({ label: step, kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: `$(compass) ${stop.lines[0]?.text ?? "(no project node yet)"}`, description: stop.holes[0]?.reason });
    for (const p of prep.preps.filter(x => x.step === step)) {
      const n = prep.notions.find(x => x.ref === p.ref)!;
      const span = p.where[0];
      const file = span && files.get(`${span.repositoryKey}/${span.path}`);
      items.push({ label: p.title, description: `${n.uses} use(s) × ${n.blast} · ${span ? where(span) : "no span"}`,
        detail: [...(ask ? p.questions : []), p.why ? `why: ${p.why.text} (${p.why.origin})` : "why: hole — ask the owner",
          ...(p.alternative ? [`alternative: ${p.alternative.text}`] : [])].join(" · "),
        ...(file && span ? { file, span } : {}) });
    }
  }
  items.push({ label: "queries worth showing", kind: vscode.QuickPickItemKind.Separator });
  for (const q of queries) {
    const file = files.get(`${q.repositoryKey}/${q.path}`);
    items.push({ label: `$(database) ${q.title}`, description: where({ ...q, ...q.span }), ...(file ? { file, span: q.span } : {}) });
  }
  items.push({ label: "", kind: vscode.QuickPickItemKind.Separator }, { label: "$(json) Show the built-in tours (datapass.tour/1)", json: true });
  const pick = await vscode.window.showQuickPick(items, { title: "Interview prep", matchOnDescription: true, matchOnDetail: true,
    placeHolder: prep.notions.length ? `${prep.notions.length} notions this project really uses, along the whole picture` : "No project facts yet: run the DataPass Hop bridge on the project's files" });
  if (pick?.json) { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "json", content: JSON.stringify(prep.tours, null, 2) })); return; }
  if (pick?.file && pick.span) await reveal(pick.file, pick.span.startLine, pick.span.endLine);
}

async function askModelAnswers(host: NavHost): Promise<void> {
  const { prep } = await gather(host);
  if (!prep.preps.length) { void vscode.window.showInformationMessage("Interview prep: no notion found in this project yet, nothing to ask."); return; }
  const req = modelAnswersRequest(prep.preps);
  await vscode.env.clipboard.writeText(req.text);
  const PASTE = "Paste the answer from the clipboard";
  const go = await vscode.window.showInformationMessage("The model-answers request is in your clipboard: give it to your own AI, copy its JSON answer, then come back.", PASTE);
  if (go !== PASTE) return;
  const read = readModelAnswers(await vscode.env.clipboard.readText(), req);
  if (!read.ok) { void vscode.window.showWarningMessage(`Model answers: ${read.reason}`); return; }
  const lines = ["# Model answers (ai-proposed — written by your AI, not checked by DataPass)", "", `Request ${read.requestDigest.slice(0, 12)} · ${read.answers.length} answer(s)${read.dropped ? ` · ${read.dropped} dropped (not asked)` : ""}`, ""];
  for (const p of prep.preps) {
    const mine = read.answers.filter(a => a.ref === p.ref);
    if (!mine.length) continue;
    lines.push(`## ${p.title}`, "");
    for (const a of mine) lines.push(`**${a.question}**`, "", `${a.answer} _(ai-proposed)_`, "");
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") }));
}

export function registerInterviewPrep(_context: vscode.ExtensionContext, host: NavHost): vscode.Disposable[] {
  const live = new Map<string, vscode.Disposable>();
  const sync = () => {
    const c = vscode.workspace.getConfiguration(CONFIG);
    const on = c.get<boolean>("enabled", true) && c.get<boolean>("interviewPrep.enabled", true);
    const want: Record<string, boolean> = { [COMMANDS.prep]: on, [COMMANDS.answers]: on && c.get<boolean>("modelAnswers.enabled", true) };
    for (const [id, yes] of Object.entries(want)) {
      if (yes && !live.has(id)) live.set(id, vscode.commands.registerCommand(id, () => id === COMMANDS.prep ? showInterviewPrep(host) : askModelAnswers(host)));
      if (!yes && live.has(id)) { live.get(id)!.dispose(); live.delete(id); }
    }
  };
  sync();
  return [vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(CONFIG)) sync(); }),
    { dispose: () => { for (const d of live.values()) d.dispose(); live.clear(); } }];
}

/** NAVWIRE1: collected into out/gen/surfaces.ts by scripts/gen-registry.mjs. */
export default registerInterviewPrep satisfies NavSurface;
