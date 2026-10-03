/**
 * ARCHCALL1 (TL-7): `datapass.ai.architectReview` prepares an `architect-review/1` request in the AI exchange
 * (copied for the person's own AI, kept in `.datapass/local/architect-reviews.json`); `datapass.ai.importArchitectReview`
 * checks the pasted answer against it and keeps it as ai-proposed, for the Context "Why & alternatives" section.
 * `offer(suggestion)` is the seam for the three triggers (MR diff, repeated check failure, readiness milestone):
 * it only shows a notification with a button; nothing runs and nothing is sent without the person. The readiness
 * trigger is wired here (a checklist item that becomes done offers the before-done review), and an imported answer
 * citing a file that is not in the project is kept flagged "unverified" (texts from settings). The imported answers
 * fill the Context "Why & alternatives" tab through `whyProvider(rationales)` (ARCHCALL1fix2).
 */
import * as path from "node:path";
import * as vscode from "vscode";
import { gitRunner, WorkSession } from "../../work/session";
import type { NavSession } from "../../core/navigation/navHost";
import { confirmModal, guarded, readBounded, report, requireRoot, UserFacingError } from "../../work/io";
import { clipboard } from "../../core/clipboard";
import { readOptional, writeLocal, LOCAL_DIR } from "../../core/workspace/loader";
import { newLocalId, sha256Bytes } from "../../core/model/ids";
import { componentPlaces, owningComponents } from "../../core/exchange/fileContext";
import { nameStatusPaths } from "../../core/git/diagramGit";
import { defaultBranchRef } from "../../core/git/fileVersions";
import { componentLocation, locationOf } from "../../core/navigation/projectLadder";
import { whyProvider, type RationaleInput } from "../../core/navigation/context/why";
import { notifyContextChanged, registerContextProvider } from "../../core/navigation/context";
import {
  DEFAULT_LABELS, DEFAULT_SETTINGS, TRIGGERS, buildRequest, checkAnswer, extractJson, fill, questionFor, renderForAi, reviewRationales,
  suggestBeforeDone, suggestForChange, suggestForCheckRuns, suggestForChecklistDone, checklistComponent, verifyCitations, unverifiedFiles,
  type ArchitectReviewSettings, type RequestLocation, type StoredReview, type Suggestion, type TriggerKind
} from "../../core/archcall/review";

export const STORE_FILE = "architect-reviews.json";
const MAX_STORED = 50;

export function readSettings(): ArchitectReviewSettings {
  const c = vscode.workspace.getConfiguration("datapass.architectReview");
  const labels = c.get<Partial<typeof DEFAULT_LABELS>>("labels") ?? {};
  return {
    suggestions: c.get<boolean>("suggestions", DEFAULT_SETTINGS.suggestions),
    largeChangeComponents: Math.max(1, c.get<number>("largeChangeComponents", DEFAULT_SETTINGS.largeChangeComponents)),
    repeatedFailures: Math.max(2, c.get<number>("repeatedFailures", DEFAULT_SETTINGS.repeatedFailures)),
    citedFileExtensions: (c.get<unknown[]>("citedFileExtensions") ?? DEFAULT_SETTINGS.citedFileExtensions).filter((x): x is string => typeof x === "string" && /^[\w-]{1,12}$/.test(x)),
    labels: {
      ...DEFAULT_LABELS, ...labels,
      triggers: { ...DEFAULT_LABELS.triggers, ...(labels.triggers ?? {}) },
      questions: { ...DEFAULT_LABELS.questions, ...(labels.questions ?? {}) },
      suggestion: { ...DEFAULT_LABELS.suggestion, ...(labels.suggestion ?? {}) }
    }
  };
}

export interface ArchitectReviewHost {
  /** Offer a review for a computed trigger (a notification with a button; never automatic). */
  offer(s: Suggestion | undefined): Promise<void>;
  /** Imported answers as ai-proposed rationales for Context › Why & alternatives. */
  rationales(): Promise<RationaleInput[]>;
  readonly onDidChange: vscode.Event<void>;
}

export function registerArchitectReview(context: vscode.ExtensionContext, navSession: NavSession): ArchitectReviewHost {
  // The NavHost session is the WorkSession at activation; a reduced session (tests) gets the commands and a clear message.
  const ws = (): WorkSession => { if (navSession instanceof WorkSession) return navSession; throw new UserFacingError("Open a DataPass project first."); };
  const changed = new vscode.EventEmitter<void>();
  const storeUri = (root: vscode.Uri) => vscode.Uri.joinPath(root, ...LOCAL_DIR.split("/"), STORE_FILE);
  const load = async (): Promise<StoredReview[]> => {
    const root = navSession instanceof WorkSession ? navSession.root : undefined;
    if (!root) return [];
    const bytes = await readOptional(storeUri(root));
    if (!bytes) return [];
    try { const doc = JSON.parse(new TextDecoder().decode(bytes)) as { reviews?: StoredReview[] }; return Array.isArray(doc.reviews) ? doc.reviews : []; } catch { return []; }
  };
  const save = async (reviews: StoredReview[]) => {
    await writeLocal(requireRoot(ws().root), STORE_FILE, new TextEncoder().encode(`${JSON.stringify({ reviews: reviews.slice(-MAX_STORED) }, null, 2)}\n`));
    changed.fire();
  };
  const nameOf = (nodeId: string) => ws().projectMap().components.find(c => c.id === nodeId)?.label ?? nodeId;
  const here = (): RequestLocation => locationOf(ws().selection(), ws().projectMap());

  const prepare = async (s: Suggestion): Promise<void> => {
    const settings = readSettings();
    const proposed = questionFor(s.trigger, s.subjects, settings.labels, nameOf);
    const question = await vscode.window.showInputBox({ title: `${settings.labels.triggers[s.trigger.kind]}: question for the architect`, value: proposed, ignoreFocusOut: true });
    if (!question?.trim()) return;
    let request;
    try { request = buildRequest(s, question); } catch (e) { throw new UserFacingError(`Architect review not prepared: ${e instanceof Error ? e.message : String(e)}`); }
    const reviews = (await load()).filter(r => r.request.requestId !== request.requestId);
    await save([...reviews, { request, answer: null, at: new Date().toISOString() }]);
    const text = renderForAi(request, settings.labels);
    await clipboard.writeText(text);
    await ws().recordExchange({ id: newLocalId("ai-file"), kind: "ai-context", label: `Architect review (${s.trigger.kind})`, status: "copied", digest: sha256Bytes(text).value, file: `${LOCAL_DIR}/${STORE_FILE}`, scopeRef: ws().model().scope.id, at: new Date().toISOString() });
    const next = await vscode.window.showInformationMessage("Architect review request copied. Paste it into your AI, then import its answer.", "Import the answer");
    if (next) await vscode.commands.executeCommand("datapass.ai.importArchitectReview");
  };

  const largeChange = async (): Promise<Suggestion | undefined> => {
    const root = requireRoot(ws().root).fsPath;
    const git = async (args: string[]) => { const r = await gitRunner(args, root, 10000); return r.ok ? r.stdout.trim() : undefined; };
    const head = await git(["rev-parse", "HEAD"]);
    const branch = defaultBranchRef((await git(["symbolic-ref", "refs/remotes/origin/HEAD"])) ?? "") ?? "main";
    const base = await git(["merge-base", "HEAD", `refs/remotes/origin/${branch}`]);
    if (!head || !base) throw new UserFacingError(`Cannot compare HEAD with origin/${branch} here (not a Git clone, or the branch is not fetched).`);
    const diff = await gitRunner(["diff", "--name-status", "-z", "-M", `${base}...HEAD`], root, 10000);
    const files = diff.ok ? nameStatusPaths(diff.stdout).files : [];
    const map = ws().projectMap();
    const obs = ws().projectObservation();
    const keys = map.repositories.filter(r => obs?.folders.get(r.key)?.fsPath && path.resolve(obs.folders.get(r.key)!.fsPath) === path.resolve(root)).map(r => r.key);
    const places = componentPlaces(map);
    const ids = files.flatMap(f => (keys.length ? keys : map.repositories.map(r => r.key)).flatMap(k => owningComponents(k, f, places).map(c => c.id)));
    const settings = readSettings();
    const s = suggestForChange({ ref: `${branch}...${head.slice(0, 12)}`, baseSha: base, headSha: head, componentIds: ids }, componentLocation, { ...settings, suggestions: true });
    if (!s) void vscode.window.showInformationMessage(`This change touches ${new Set(ids).size} component(s); the large-change review starts above ${settings.largeChangeComponents} (setting datapass.architectReview.largeChangeComponents).`);
    return s;
  };

  const fromPalette = async (): Promise<Suggestion | undefined> => {
    const settings = readSettings();
    const pick = await vscode.window.showQuickPick(TRIGGERS.map(t => ({ label: settings.labels.triggers[t], t })), { title: "Architect review: which moment?" });
    if (!pick) return undefined;
    const kind: TriggerKind = pick.t;
    const forced = { ...settings, suggestions: true };
    if (kind === "large-change") return largeChange();
    if (kind === "repeated-failure") {
      const checkId = await vscode.window.showInputBox({ title: "Which check keeps failing?", placeHolder: "e.g. npm test, the CI job name", ignoreFocusOut: true });
      if (!checkId?.trim()) return undefined;
      const refs = await vscode.window.showInputBox({ title: `References of the last failing runs (at least ${forced.repeatedFailures}, comma-separated)`, placeHolder: "e.g. pipeline 812 job 3, pipeline 815 job 4", ignoreFocusOut: true });
      const runs = (refs ?? "").split(",").map(x => x.trim().replace(/\s+/g, "-")).filter(Boolean).map(ref => ({ ref, failed: true }));
      const s = suggestForCheckRuns(checkId.trim(), runs, here(), forced);
      if (!s) void vscode.window.showInformationMessage(`Name at least ${forced.repeatedFailures} failing runs of ${checkId.trim()}.`);
      return s;
    }
    const milestone = await vscode.window.showInputBox({ title: "Which readiness milestone is about to be marked done?", ignoreFocusOut: true });
    return milestone?.trim() ? suggestBeforeDone(milestone.trim(), [here()], forced) : undefined;
  };

  /** A cited file exists under the project root or one of its repository folders (a bare name: anywhere in the workspace). Read-only. */
  const existsInProject = async (rel: string): Promise<boolean> => {
    const session = ws();
    const roots = [requireRoot(session.root), ...[...(session.projectObservation()?.folders.values() ?? [])].filter((u): u is vscode.Uri => !!u)];
    for (const r of roots) {
      try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(r, ...rel.split("/"))); return true; } catch { /* not under this root */ }
    }
    if (rel.includes("/")) return false;
    const glob = `**/${rel.replace(/[[\]{}*?!]/g, c => `[${c}]`)}`;
    return (await vscode.workspace.findFiles(glob, "**/node_modules/**", 1)).length > 0;
  };

  const importAnswer = async (): Promise<void> => {
    requireRoot(ws().root);
    const source = await vscode.window.showQuickPick([{ label: "$(clippy) From the clipboard", id: "clip" }, { label: "$(file) From a file…", id: "file" }], { title: "Import the architect review answer", placeHolder: "Untrusted data: checked against the request before it is kept (ai-proposed)" });
    if (!source) return;
    let raw: string;
    if (source.id === "clip") raw = await clipboard.readText();
    else {
      const picked = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, filters: { "JSON or Markdown": ["json", "md", "txt"] } });
      if (!picked?.[0]) return;
      raw = new TextDecoder().decode(await readBounded(picked[0], 2 * 1024 * 1024));
    }
    if (!raw.trim()) throw new UserFacingError("Nothing to import.");
    const reviews = await load();
    let json: unknown;
    try { json = extractJson(raw); } catch (e) { throw new UserFacingError(`Not imported: ${e instanceof Error ? e.message : String(e)}`); }
    const id = (json as { requestId?: unknown } | null)?.requestId;
    const stored = reviews.find(r => r.request.requestId === id);
    if (!stored) throw new UserFacingError("Not imported: no architect review request with this requestId was prepared in this project.");
    let answer;
    try { answer = checkAnswer(stored.request, json); } catch (e) { throw new UserFacingError(`Not imported: ${e instanceof Error ? e.message : String(e)}`); }
    const settings = readSettings();
    const unverified = await verifyCitations(answer, existsInProject, settings.citedFileExtensions);
    const missing = unverifiedFiles({ unverified });
    const flag = missing.length ? fill(settings.labels.unverifiedFiles, { files: missing.join(", ") }) : "";
    if (!(await confirmModal("Keep this architect review?", `${answer.findings.length} finding(s); recommendation: ${answer.recommendation.summary.slice(0, 300)}${flag ? `\n\n${flag}` : ""}\n\nIt is shown in Context › Why & alternatives as ai-proposed. Nothing in the project changes.`, "Keep it"))) return;
    await save(reviews.map(r => r === stored ? { ...r, answer, importedAt: new Date().toISOString(), unverified } : r));
    await ws().recordExchange({ id: newLocalId("ai-import"), kind: "ai-context", label: `Architect review answer (${stored.request.trigger.kind})`, status: "imported", digest: sha256Bytes(JSON.stringify(answer)).value, file: `${LOCAL_DIR}/${STORE_FILE}`, scopeRef: ws().model().scope.id, at: new Date().toISOString() });
    report(`Architect review imported (ai-proposed${flag ? `, ${settings.labels.unverified}` : ""})`, [...(flag ? [flag] : []),...answer.findings.map(f => `${f.severity}: ${f.summary}`), `Recommendation: ${answer.recommendation.summary}`]);
  };

  const offer = async (s: Suggestion | undefined): Promise<void> => {
    if (!s || !readSettings().suggestions) return;
    const go = await vscode.window.showInformationMessage(s.message, "Prepare the request", "Not now");
    if (go === "Prepare the request") await vscode.commands.executeCommand("datapass.ai.architectReview", s);
  };

  // Trigger "before done": a readiness checklist item (Work view, or a component's project checklist) becomes done.
  // The state is already written and stays reversible; this only offers the review.
  if (navSession instanceof WorkSession) {
    const session = navSession;
    context.subscriptions.push(session.onDidSetChecklist(change => {
      const component = checklistComponent(change.key);
      const title = session.model().checklist.find(e => e.key === change.key)?.label ?? change.key;
      const subjects = [component ? componentLocation(component) : here()];
      void offer(suggestForChecklistDone({ ...change, title }, subjects, readSettings()));
    }));
  }

  context.subscriptions.push(changed,
    vscode.commands.registerCommand("datapass.ai.architectReview", guarded(async (arg?: unknown) => {
      const s = arg && typeof arg === "object" && "trigger" in arg ? arg as Suggestion : await fromPalette();
      if (s) await prepare(s);
    })),
    vscode.commands.registerCommand("datapass.ai.importArchitectReview", guarded(importAnswer)));

  const rationales = async (): Promise<RationaleInput[]> => reviewRationales(await load(), readSettings().labels);
  // Context › Why & alternatives reads the imported answers (ai-proposed, "unverified" when flagged) and refreshes on import.
  context.subscriptions.push(registerContextProvider(whyProvider(rationales)), changed.event(() => notifyContextChanged()));

  return { onDidChange: changed.event, rationales, offer };
}
