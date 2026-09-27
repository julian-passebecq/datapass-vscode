/**
 * V3-GITDIAG (vision §2.3): Git on the diagram. For the current project, the open pull requests the
 * Git view found and this computer's local changes (uncommitted, or committed but not pushed) are
 * mapped onto the blocks whose files they touch; each block shows a small overlay badge (count and
 * worst CI state), hovering lists the change sets, clicking opens one (the PR command of the Git
 * module, or VS Code's diff editor for a local change).
 *
 * Read-only and local: `git status` / `git diff` on refs already in the clone. A PR whose branch was
 * never fetched is simply not placed; DataPass does not fetch for it. Setting
 * `datapass.diagram.gitBadges` (and the overlay switch `datapass.overlay.enabled`, when present) hides it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { gitRunner } from "./session";
import type { GitObserver } from "./gitObserver";
import { guarded, UserFacingError } from "./io";
import { revUri } from "./fileVersionCommands";
import {
  badgeStateText, badgeTitle, LOCAL_STATUS_ARGS, mapChangeSets, MAX_FILES, MAX_PRS_PER_REPO, nameStatusPaths, porcelainPaths, prDiffArgs,
  UNPUSHED_ARGS, type ChangeSet, type DiagramGit
} from "../core/git/diagramGit";
import type { WbGitDiagram } from "../views/workbenchState";


export function gitBadgesShown(): boolean {
  const on = vscode.workspace.getConfiguration("datapass.diagram").get("gitBadges");
  const overlay = vscode.workspace.getConfiguration("datapass.overlay").get("enabled");
  return on !== false && overlay !== false;
}

export class GitDiagram implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private sets: ChangeSet[] = [];
  private result: DiagramGit = { byComponent: {}, outside: [] };
  private checkedAt?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private again = false;

  constructor(private readonly session: WorkSession, private readonly observer: GitObserver) {
    this.subs.push(
      session.onDidChange(() => this.schedule()),
      observer.onDidChange(() => this.schedule()),
      vscode.workspace.onDidSaveTextDocument(d => { if (d.uri.scheme === "file") this.schedule(); }),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("datapass.diagram.gitBadges") || e.affectsConfiguration("datapass.overlay")) { this.schedule(); this.emitter.fire(); } })
    );
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const s of this.subs) s.dispose();
    this.emitter.dispose();
  }

  view(): WbGitDiagram {
    const byComponent: WbGitDiagram["byComponent"] = {};
    for (const [id, b] of Object.entries(this.result.byComponent)) byComponent[id] = { count: b.count, worst: b.worst, title: badgeTitle(b) };
    return { shown: gitBadgesShown(), byComponent, outside: this.result.outside.length, checkedAt: this.checkedAt };
  }

  /** The change sets placed on one block (tests and the click handler). */
  setsOf(componentId: string) { return this.result.byComponent[componentId]?.sets ?? []; }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 400);
  }

  /** Reads the change sets again (serialised: a request during a run re-runs once after it). */
  async refresh(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do {
        this.again = false;
        try { await this.compute(); } catch { /* keep the last result */ }
      } while (this.again);
    })().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async compute(): Promise<void> {
    const before = JSON.stringify(this.view());
    if (!vscode.workspace.isTrusted || !gitBadgesShown()) {
      this.sets = []; this.result = { byComponent: {}, outside: [] };
    } else {
      const map = this.session.projectMap();
      const sets: ChangeSet[] = [];
      for (const r of map.repositories.filter(x => x.state === "local")) {
        const folder = this.session.repoFolder(r.key)?.fsPath;
        if (!folder) continue;
        const status = await gitRunner(LOCAL_STATUS_ARGS, folder, 10000);
        const local = status.ok ? porcelainPaths(status.stdout) : { files: [], truncated: false };
        const unpushedRun = await gitRunner(UNPUSHED_ARGS, folder, 10000);
        const unpushed = unpushedRun.ok ? nameStatusPaths(unpushedRun.stdout) : { files: [], truncated: false };
        const files = [...new Set([...local.files, ...unpushed.files])];
        if (files.length) {
          const detail = [local.files.length ? `${local.files.length} file(s) not committed` : "", unpushed.files.length ? `${unpushed.files.length} file(s) in commits not pushed` : ""].filter(Boolean).join(" · ");
          sets.push({ repoKey: r.key, repoLabel: r.label, kind: "local", key: `local:${r.key}`, title: `Local changes in ${r.label} (${detail})`, files: files.slice(0, MAX_FILES), truncated: local.truncated || unpushed.truncated || files.length > MAX_FILES, detail });
        }
        const report = this.observer.report(r.key);
        for (const pr of (report?.prs ?? []).slice(0, MAX_PRS_PER_REPO)) {
          const args = prDiffArgs(report?.defaultBranch ?? "main", pr.head);
          if (!args) continue;
          const d = await gitRunner(args, folder, 10000);
          if (!d.ok) continue; // Branch not fetched (or a fork): not placed, and never fetched for it.
          const p = nameStatusPaths(d.stdout);
          if (!p.files.length) continue;
          sets.push({ repoKey: r.key, repoLabel: r.label, kind: "pr", key: `pr:${r.key}#${pr.number}`, number: pr.number, title: `${pr.title}${pr.draft ? " (draft)" : ""}`, ci: pr.ci.state, files: p.files, truncated: p.truncated });
        }
      }
      this.sets = sets;
      this.result = mapChangeSets(map, sets);
      this.checkedAt = new Date().toISOString();
    }
    if (JSON.stringify(this.view()) !== before) this.emitter.fire();
  }

  /** The block's badge was clicked: pick a change set (and a file of a local one), then open it. */
  async open(componentId: string): Promise<void> {
    const sets = this.setsOf(componentId);
    if (!sets.length) throw new UserFacingError("No change set touches this block now (the diagram refreshes after a save or a Git check).");
    const pickSet = sets.length === 1 ? sets[0] : (await vscode.window.showQuickPick(sets.map(s => ({
      label: s.kind === "pr" ? `$(git-pull-request) PR #${s.number}: ${s.title}` : `$(git-commit) ${s.title}`,
      description: `${badgeStateText(s.state)} · ${s.files.length} file(s) in this block`, set: s
    })), { title: "DataPass: change sets on this block", placeHolder: "Open a pull request, or a local change's diff" }))?.set;
    if (!pickSet) return;
    if (pickSet.kind === "pr") { await vscode.commands.executeCommand("datapass.git.openPullRequest", pickSet.repoKey, pickSet.number); return; }
    const folder = this.session.repoFolder(pickSet.repoKey)?.fsPath;
    if (!folder) throw new UserFacingError("That repository is not on this computer any more.");
    const rel = pickSet.files.length === 1 ? pickSet.files[0] : (await vscode.window.showQuickPick(pickSet.files.map(f => ({ label: f })), { title: "DataPass: local changes on this block", placeHolder: "Open the diff of one file" }))?.label;
    if (!rel) return;
    await openLocalDiff(folder, rel);
  }
}

/** A local change: the file at the upstream (else HEAD) against the working file, in VS Code's diff editor. */
export async function openLocalDiff(folder: string, rel: string): Promise<void> {
  const upstream = await gitRunner(["rev-parse", "--verify", "--quiet", "@{u}"], folder, 5000);
  const head = upstream.ok ? upstream : await gitRunner(["rev-parse", "--verify", "--quiet", "HEAD"], folder, 5000);
  const sha = head.ok ? head.stdout.trim() : "";
  const file = vscode.Uri.file(path.join(folder, ...rel.split("/")));
  const inBase = /^[0-9a-f]{40}$/.test(sha) && (await gitRunner(["cat-file", "-e", `${sha}:${rel}`], folder, 5000)).ok;
  const onDisk = fs.existsSync(file.fsPath);
  const where = upstream.ok ? "pushed" : "last commit";
  if (inBase && onDisk) {
    await vscode.commands.executeCommand("vscode.diff", revUri({ repo: folder, sha, path: rel }, `${where} ${sha.slice(0, 7)}`), file, `${path.basename(rel)} (${where} ${sha.slice(0, 7)} ↔ working file)`);
  } else if (onDisk) {
    await vscode.commands.executeCommand("vscode.open", file);
  } else if (inBase) {
    await vscode.commands.executeCommand("vscode.open", revUri({ repo: folder, sha, path: rel }, `deleted, ${where} ${sha.slice(0, 7)}`));
  } else {
    throw new UserFacingError(`${rel} is neither on disk nor in the ${where}.`);
  }
}

export function registerGitDiagramCommands(context: vscode.ExtensionContext, diagram: GitDiagram): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.diagram.openGitChanges", async (componentId?: unknown) => {
    if (typeof componentId !== "string" || !componentId || componentId.length > 300) throw new UserFacingError("Click a block's Git badge on the diagram.");
    await diagram.open(componentId);
  });
  reg("datapass.diagram.toggleGitBadges", async () => {
    const cfg = vscode.workspace.getConfiguration("datapass.diagram");
    await cfg.update("gitBadges", cfg.get("gitBadges") === false, vscode.ConfigurationTarget.Global);
  });
}
