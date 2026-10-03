/**
 * V4-NAV NAVCHG1 host side of the `change-summary` binding: the command `datapass.nav.changeSummary` picks a
 * change (local working changes of a repository, a commit range, or the pull request of a Git tree item),
 * computes its summary once, serves it to the `changes` pack views and shows it as a pick list: summary,
 * AI assumptions and expectations (or "ask the AI"), then one row per file that opens a read-only diff.
 * Read-only: Git lists and shows; nothing fetches, checks out or writes. The AI's file is written by the client
 * AI through the existing AI exchange (`datapass.workOrders.new`), previewed and confirmed by the user.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { gitRunner } from "./session";
import { guarded, UserFacingError } from "./io";
import { revUri } from "./fileVersionCommands";
import { changedComponents } from "../core/project/gitSync";
import type { NavHost } from "../core/navigation/navHost";
import type { NavSurface } from "../core/navigation/register";
import {
  changeDiffOpen, changeExplainOrderDraft, gitSemanticDiffer, changeLabels, collectChangeSummary, fileKindRules, isRangeRef, rangeText, setCurrentChangeSummary,
  WORKTREE, type ChangeFileRow, type ChangeSummary, type ChangeTarget
} from "../core/navigation/bindings/changeSummary.binding";

export const CHANGE_SUMMARY_COMMAND = "datapass.nav.changeSummary";
const CHANGE_VIEW_ID = "change-summary";

interface LocalRepo { key: string; label: string; folder: string }

/** Repositories of the project on this computer (the session's folders). */
function localRepos(host: NavHost): LocalRepo[] {
  return host.projectMap().repositories.filter(r => r.state === "local")
    .map(r => ({ key: r.key, label: r.label, folder: host.repoFolder(r.key)?.fsPath ?? "" }))
    .filter(r => r.folder);
}

/** A Git tree item (`{ t: "pr" | "repo" | "changes", r, pr }`) → a change, validated (the argument is untrusted). */
function targetOfArg(arg: unknown, repos: readonly LocalRepo[]): ChangeTarget | undefined {
  const a = arg as { t?: unknown; r?: { key?: unknown; defaultBranch?: unknown }; pr?: { number?: unknown; title?: unknown; head?: unknown } } | null;
  if (!a || typeof a !== "object" || !a.r || typeof a.r.key !== "string") return undefined;
  const repo = repos.find(r => r.key === a.r!.key);
  if (!repo) return undefined;
  const base = { repo: repo.folder, repoKey: repo.key, repoLabel: repo.label };
  if (a.t === "pr" && a.pr && typeof a.pr.number === "number" && typeof a.pr.head === "string") {
    return { kind: "pr", ...base, defaultBranch: typeof a.r.defaultBranch === "string" ? a.r.defaultBranch : "main", head: a.pr.head, number: a.pr.number, title: typeof a.pr.title === "string" ? a.pr.title.slice(0, 200) : "" };
  }
  return { kind: "local", ...base };
}

async function pickTarget(repos: readonly LocalRepo[]): Promise<ChangeTarget | undefined> {
  type Item = vscode.QuickPickItem & { repo: LocalRepo; range?: boolean };
  const items: Item[] = repos.flatMap(r => [
    { label: `$(git-commit) Local changes`, description: r.label, repo: r },
    { label: `$(git-compare) Commit range…`, description: r.label, repo: r, range: true }
  ]);
  const chosen = await vscode.window.showQuickPick(items, { title: "DataPass: Change summary", placeHolder: "Which change? (a pull request: from its item in the Git view)" });
  if (!chosen) return undefined;
  const base = { repo: chosen.repo.folder, repoKey: chosen.repo.key, repoLabel: chosen.repo.label };
  if (!chosen.range) return { kind: "local", ...base };
  const value = await vscode.window.showInputBox({ title: "DataPass: commit range", prompt: "base..head (hashes, branches or tags; nothing is fetched)", value: "HEAD~1..HEAD",
    validateInput: v => { const [b, h] = v.split(".."); return b && h && isRangeRef(b.trim()) && isRangeRef(h.trim()) ? undefined : "Write base..head, e.g. main..my-branch"; } });
  if (!value) return undefined;
  const [b, h] = value.split("..");
  return { kind: "range", ...base, base: b!.trim(), head: h!.trim() };
}

async function readRepoFile(repo: string, rel: string): Promise<string | null> {
  try { return await fs.readFile(path.join(repo, ...rel.split("/")), "utf8"); } catch { return null; }
}

async function openRow(s: ChangeSummary, row: ChangeFileRow): Promise<void> {
  const what = changeDiffOpen(s, row, rel => path.join(s.target.repo, ...rel.split("/")));
  if (!what) throw new UserFacingError("Git could not resolve this change's revisions, so its diff cannot open.");
  const note = (sha: string) => (sha === WORKTREE ? sha : sha.slice(0, 7));
  const uri = (x: string | { repo: string; sha: string; path: string }) => typeof x === "string" ? vscode.Uri.file(x) : revUri(x, note(x.sha));
  if (what.kind === "diff") await vscode.commands.executeCommand("vscode.diff", uri(what.left), uri(what.right), what.title, { preview: true });
  else if (what.kind === "revision") await vscode.commands.executeCommand("vscode.open", uri(what.rev), { preview: true });
  else await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(what.fsPath), { preview: true });
}

/** The summary as a pick list (works before a nav view host draws the `changes` pack). */
async function showSummary(s: ChangeSummary): Promise<void> {
  const L = changeLabels(vscode.workspace.getConfiguration("datapass.nav").get("changeSummary.labels"));
  type Item = vscode.QuickPickItem & { row?: ChangeFileRow; ask?: boolean };
  const tally = (m: Readonly<Record<string, number>>) => Object.entries(m).map(([k, n]) => `${n} ${k}`).join(" · ");
  const items: Item[] = [
    { label: L.summaryTitle, kind: vscode.QuickPickItemKind.Separator },
    { label: `$(git-compare) ${s.files.length} ${L.fFiles.toLowerCase()}`, description: tally(s.byStatus), detail: `${L.fByKind}: ${tally(s.byKind) || "—"}${s.range ? ` · ${rangeText(s.range).replace(WORKTREE, L.worktree)}` : ""}` }
  ];
  if (s.explanation) {
    for (const [title, list] of [[L.assumptionsTitle, s.explanation.assumptions], [L.expectationsTitle, s.explanation.expectations]] as const) {
      if (!list.length) continue;
      items.push({ label: `${title} (AI-proposed)`, kind: vscode.QuickPickItemKind.Separator }, ...list.map(t => ({ label: `$(sparkle) ${t}` })));
    }
  }
  const holes = s.holes.filter(h => h.reason);
  if (holes.length) items.push({ label: "Not known", kind: vscode.QuickPickItemKind.Separator }, ...holes.map(h => (h.fill === "ask-ai" && s.range ? { label: `$(sparkle) ${L.askAi}`, detail: h.reason, ask: true } : { label: `$(info) ${h.reason}` })));
  if (s.files.length) items.push({ label: L.fFiles, kind: vscode.QuickPickItemKind.Separator }, ...s.files.map(f => ({ label: f.path.split("/").pop() ?? f.path, description: `${f.status} · ${f.kind}${f.component ? ` · ${f.component}` : ""}`, detail: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path, row: f })));
  const pick = await vscode.window.showQuickPick(items, { title: `DataPass: ${s.title}`, placeHolder: "Pick a file to open its diff (read-only)", matchOnDescription: true, matchOnDetail: true });
  if (pick?.row) await openRow(s, pick.row);
  else if (pick?.ask && s.range) {
    const d = changeExplainOrderDraft(s.title, s.range, s.files.map(f => ({ path: f.path, oldPath: f.oldPath, status: f.status })), L);
    await vscode.commands.executeCommand("datapass.workOrders.new", { kind: d.kind, title: d.title, goal: d.goal, doneWhen: d.doneWhen });
  }
}

/** Nav surface, self-registered (out/gen/surfaces.ts); in src/work because it runs Git (work → core, never the reverse). */
export function registerChangeSummary(_context: vscode.ExtensionContext, host: NavHost): vscode.Disposable {
  return vscode.commands.registerCommand(CHANGE_SUMMARY_COMMAND, guarded(async (arg?: unknown) => {
    const repos = localRepos(host);
    if (!repos.length) throw new UserFacingError("No repository of this project is on this computer.");
    const target = targetOfArg(arg, repos) ?? await pickTarget(repos);
    if (!target) return;
    const cfg = vscode.workspace.getConfiguration("datapass.nav");
    const map = host.projectMap();
    const summary = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "DataPass: reading the change" }, () => collectChangeSummary(target, {
      git: gitRunner, trusted: vscode.workspace.isTrusted, readFile: readRepoFile,
      components: paths => changedComponents(map, target.repoKey, paths),
      semantic: gitSemanticDiffer(gitRunner, target.repo, rel => readRepoFile(target.repo, rel)),
      lineage: null, // No lineage graph in the standalone yet: the impact shows the touched components (a hole says so).
      labels: changeLabels(cfg.get("changeSummary.labels")), fileKinds: fileKindRules(cfg.get("changeSummary.fileKinds"))
    }));
    setCurrentChangeSummary(summary);
    if (host.nav.views().some(v => v.id === CHANGE_VIEW_ID)) host.nav.dispatch({ type: "view", viewId: CHANGE_VIEW_ID });
    await showSummary(summary);
  }));
}

export default registerChangeSummary satisfies NavSurface;
