/**
 * DETACH1: the `datapass.dbt.detach` command and the detach facts (badge + drift) for the Project tree and the Context
 * panel. Reads `.datapass/materialization/**\/*.detach.json` (DETSPI1 records written by DBTMAT1), the notebooks they
 * name, and the dbt project revision from Git (`git log -1 -- <dbt project folder>`, read-only). Never runs dbt or the
 * notebook; writes one file, the record, after an explicit modal confirmation.
 *
 * V5HOLE7: drift follows the files themselves. File watchers on the stamped notebooks and on the dbt source folders
 * refresh on create / change / delete, and an fs stat of the dbt sources counts an uncommitted dbt edit as "dbt changed".
 * `datapass.dbt.reattach` (also offered when detaching an already detached model, and on the tree row) opens a new MAT1
 * proposal for that model: preview first, files written only after a modal confirmation, never a Git write.
 */
import * as vscode from "vscode";
import { gitRunner } from "../work/session";
import { RECORD_ROOT, materializeDbtModels, readDbtArtifacts } from "../core/materialize/dbtNotebook";
import { DBT_SOURCE_FOLDERS, DETACH_COMMAND, DRIFT_LABELS, REATTACH_COMMAND, dbtEditedSince, detachBadge, detachMessage, type DetachMessageKey, type DetachMessageVars, detachContextSection, detachModel, detachView, readDetachRecord, reattachProposal, reattachProposalId, serializeDetachRecord, type DetachView } from "../core/materialize/dbtDetach";
import { dbtMaterializePreview } from "../core/materialize/dbtMaterialize";
import { materializationGitPlan } from "../core/materialize/flow";
import { dbtFiles, dbtMaterializeConfig } from "./dbtMaterialize";

interface Loaded { uri: vscode.Uri; view: DetachView }

export class DbtDetachService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private loaded: Loaded[] = [];
  private readonly subs: vscode.Disposable[] = [this.emitter];
  /**
   * Watches the stamped notebooks and the dbt source folders of the detached models (create / change / delete), so an
   * edit on either side, or a deleted target, shows without a manual refresh.
   */
  private fileWatch?: { key: string; watcher: vscode.Disposable };
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly root: () => vscode.Uri | undefined, private readonly out?: vscode.OutputChannel) {
    const w = vscode.workspace.createFileSystemWatcher(`**/${RECORD_ROOT}/**/*.detach.json`);
    const again = () => this.soon();
    this.subs.push(w, w.onDidCreate(again), w.onDidChange(again), w.onDidDelete(again), vscode.workspace.onDidSaveTextDocument(d => { if (this.loaded.some(l => d.uri.path.endsWith(`/${l.view.notebookPath}`))) again(); }));
  }

  views(): readonly DetachView[] { return this.loaded.map(l => l.view); }

  /** The Context section for a file (NAVCTX1 provider result shape). */
  contextFor(filePath: string | undefined) { return detachContextSection(this.views(), filePath); }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.fileWatch?.watcher.dispose();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  /** One refresh for a burst of file events (a dbt compile or a save writes several files). */
  private soon(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.refresh(); }, 250);
  }

  /**
   * Watchers over the notebooks the records name and over the dbt sources of the detached models: create, change (an
   * edit written to disk by any tool, not only an editor save) and delete all refresh the drift.
   */
  private watchFiles(root: vscode.Uri, dbtDirs: readonly vscode.Uri[]): void {
    const paths = [...new Set(this.loaded.map(l => l.view.notebookPath))].sort();
    const dirs = [...new Map(dbtDirs.map(d => [d.toString(), d])).values()].sort((a, b) => a.toString().localeCompare(b.toString()));
    const key = `${root.toString()}|${paths.join("|")}|${dirs.map(d => d.toString()).join("|")}`;
    if (this.fileWatch?.key === key) return;
    this.fileWatch?.watcher.dispose();
    this.fileWatch = undefined;
    if (!paths.length && !dirs.length) return;
    const again = () => this.soon();
    const parts: vscode.Disposable[] = [];
    const watch = (pattern: vscode.RelativePattern) => {
      const w = vscode.workspace.createFileSystemWatcher(pattern);
      parts.push(w, w.onDidCreate(again), w.onDidChange(again), w.onDidDelete(again));
    };
    if (paths.length) watch(new vscode.RelativePattern(root, paths.length === 1 ? paths[0]! : `{${paths.join(",")}}`));
    for (const d of dirs) {
      watch(new vscode.RelativePattern(d, "dbt_project.yml"));
      for (const f of DBT_SOURCE_FOLDERS) watch(new vscode.RelativePattern(d, `${f}/**`));
    }
    this.fileWatch = { key, watcher: vscode.Disposable.from(...parts) };
  }

  async refresh(): Promise<void> {
    const root = this.root();
    if (!root) { this.loaded = []; this.emitter.fire(); return; }
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, `${RECORD_ROOT}/**/*.detach.json`), undefined, 500);
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const labels = vscode.workspace.getConfiguration("datapass.dbt").get<Partial<typeof DRIFT_LABELS>>("driftLabels") ?? {};
    const out: Loaded[] = [];
    const dbtDirs: vscode.Uri[] = [];
    for (const uri of uris.sort((a, b) => a.path.localeCompare(b.path))) {
      const r = readDetachRecord(await readText(uri) ?? "");
      if (!r.ok) continue;
      const since = r.record.authority === "notebook" ? r.record.recordedAt : undefined;
      const { dbtDir, ...current } = await this.current(root, r.record.stamp.modelId, r.record.stamp.notebookPath, since);
      if (dbtDir && since) dbtDirs.push(dbtDir);
      out.push({ uri, view: detachView(relative(root, uri), r.record, current, at, labels) });
    }
    this.loaded = out;
    this.watchFiles(root, dbtDirs);
    this.emitter.fire();
  }

  /**
   * Current notebook text, whether it still exists (fs stat only: a missing target is "target missing", never "in sync")
   * and the dbt revision (null when unreadable: the drift is then `unknown`). With `since` (the detach instant), an fs
   * stat of the dbt sources says whether one was modified after it (an uncommitted dbt edit is a dbt change too).
   */
  async current(root: vscode.Uri, modelId: string, notebookPath: string, since?: string): Promise<{ notebookContent: string | null; dbtRevision: string | null; notebookExists: boolean; dbtEditedSinceDetach?: boolean; dbtDir?: vscode.Uri }> {
    const nb = vscode.Uri.joinPath(root, ...notebookPath.split("/"));
    const notebookExists = await targetExists(nb);
    const notebookContent = notebookExists ? await readText(nb) : null;
    const dir = await dbtProjectDir(root, modelId);
    if (!dir) return { notebookContent, dbtRevision: null, notebookExists };
    const edited = since ? { dbtEditedSinceDetach: dbtEditedSince(await dbtSourceStats(dir), since) } : {};
    if (!vscode.workspace.isTrusted) return { notebookContent, dbtRevision: null, notebookExists, ...edited, dbtDir: dir };
    const r = await gitRunner(["log", "-1", "--format=%H", "--", "."], dir.fsPath, 10_000);
    const sha = r.ok ? r.stdout.trim() : "";
    return { notebookContent, dbtRevision: sha || null, notebookExists, ...edited, dbtDir: dir };
  }

  /** The command: pick an attached model, confirm, flip the authority and write the stamp. */
  async detach(arg?: unknown): Promise<void> {
    const root = this.root();
    if (!root) { void vscode.window.showWarningMessage("Open a DataPass project first."); return; }
    await this.refresh();
    const argPath = argPathOf(arg);
    let target = argPath ? this.loaded.find(l => argPath.endsWith(l.view.notebookPath) || argPath.endsWith(l.view.recordPath)) : undefined;
    if (!target) {
      if (!this.loaded.length) { void vscode.window.showInformationMessage("No materialized dbt model here: materialize one first (a MAT1 proposal writes its record under .datapass/materialization)."); return; }
      const pick = await vscode.window.showQuickPick(this.loaded.map(l => ({ label: l.view.modelId, description: detachBadge(l.view), detail: l.view.notebookPath, l })), { title: msg("pickTitle", {}) });
      if (!pick) return;
      target = pick.l;
    }
    if (target.view.detached) {
      // Already detached: the only next step is re-attach, a new MAT1 proposal (offered, never automatic).
      const vars = { model: target.view.modelId };
      const next = await vscode.window.showQuickPick([
        { label: msg("reattachAction", vars), description: detachBadge(target.view), reattach: true },
        { label: msg("keepDetached", vars), reattach: false }
      ], { title: msg("alreadyDetachedTitle", vars) });
      if (next?.reattach) await this.reattach(target);
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      msg("confirm", { model: target.view.modelId }),
      { modal: true, detail: msg("confirmDetail", { model: target.view.modelId, notebook: target.view.notebookPath, record: target.view.recordPath }) },
      "Detach"
    );
    if (ok !== "Detach") return;
    const raw = readDetachRecord(await readText(target.uri) ?? "");
    if (!raw.ok) { void vscode.window.showErrorMessage(`The detach record is not valid: ${raw.reason}`); return; }
    const { dbtDir: _dir, ...current } = await this.current(root, raw.record.stamp.modelId, raw.record.stamp.notebookPath);
    const actor = await gitRunner(["config", "--get", "user.name"], root.fsPath, 5_000).then(r => (r.ok ? r.stdout.trim() : ""), () => "");
    const res = detachModel(raw.record, { ...current, actor: { kind: "human", id: actor || "unknown" }, at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), origin: "declared" });
    if (!res.ok) { void vscode.window.showWarningMessage(res.reason); return; }
    await vscode.workspace.fs.writeFile(target.uri, new TextEncoder().encode(serializeDetachRecord(res.record)));
    await this.refresh();
    void vscode.window.showInformationMessage(msg("detached", { model: target.view.modelId, notebook: target.view.notebookPath, record: target.view.recordPath }));
  }

  /**
   * Re-attach: a fresh MAT1 materialization of that one model from dbt's own artefacts, shown as a proposal (diff in the
   * output). Files are written to the working tree only after a modal confirmation; the Git steps to a review branch are
   * listed for the person. Never runs dbt, the notebook or a Git write.
   */
  async reattach(arg?: unknown): Promise<void> {
    const root = this.root();
    if (!root) { void vscode.window.showWarningMessage("Open a DataPass project first."); return; }
    let target = isLoaded(arg) ? arg : undefined;
    if (!target) {
      await this.refresh();
      const detached = this.loaded.filter(l => l.view.detached);
      const argPath = argPathOf(arg);
      target = argPath ? detached.find(l => argPath.endsWith(l.view.notebookPath) || argPath.endsWith(l.view.recordPath)) : undefined;
      if (!target) {
        if (!detached.length) { void vscode.window.showInformationMessage("No detached dbt model here: nothing to re-attach."); return; }
        const pick = await vscode.window.showQuickPick(detached.map(l => ({ label: l.view.modelId, description: detachBadge(l.view), detail: l.view.notebookPath, l })), { title: msg("reattachPickTitle", {}) });
        if (!pick) return;
        target = pick.l;
      }
    }
    if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage("Re-attach reads the dbt revision from Git: trust this workspace first."); return; }
    const modelId = target.view.modelId;
    const files = await dbtFiles(root);
    const { projects, holes } = readDbtArtifacts(files);
    const pkg = modelId.split(".")[1];
    const project = projects.find(p => p.projectName === pkg) ?? projects.find(p => p.models.some(m => m.uniqueId === modelId));
    if (!project) { void vscode.window.showWarningMessage(holes[0]?.nextAction ?? `No dbt manifest lists ${modelId}: compile the dbt project first (dbt writes target/manifest.json).`); return; }
    const cfg = await dbtMaterializeConfig(root);
    if (!cfg) return;
    const envIds = Object.keys(cfg.environments);
    const environment = envIds.length === 1 ? envIds[0] : await vscode.window.showQuickPick(envIds, { title: "Environment (table names come from the config)" });
    if (!environment) return;
    const dir = vscode.Uri.joinPath(root, ...(project.projectDir === "." ? [] : project.projectDir.split("/")));
    const rev = await gitRunner(["log", "-1", "--format=%H", "--", "."], dir.fsPath, 10_000);
    const dbtRevision = rev.ok ? rev.stdout.trim() : "";
    if (!dbtRevision) { void vscode.window.showWarningMessage("The dbt project has no committed revision: commit it first, the re-attached notebook is stamped with that exact SHA."); return; }
    const user = await gitRunner(["config", "--get", "user.name"], root.fsPath, 5_000).then(r => (r.ok ? r.stdout.trim() : ""), () => "");
    const actor = { kind: "human" as const, id: user || "unknown" };
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const result = materializeDbtModels({
      files, environment, environments: cfg.environments, dbtRevision, models: [modelId],
      rootDirectory: cfg.rootDirectory, notebookPrefix: cfg.notebookPrefix, actor, at
    });
    const existing = new Map<string, string>();
    for (const f of result.files) {
      const text = await readText(vscode.Uri.joinPath(root, ...f.path.split("/")));
      if (text !== null) existing.set(f.path, text);
    }
    const proposalId = reattachProposalId(modelId, at);
    const proposal = reattachProposal(result, existing, { modelId, proposalId, actor, at });
    if (!proposal.ok) { void vscode.window.showWarningMessage(proposal.reason); return; }
    const preview = dbtMaterializePreview(result, proposal.diff);
    const vars: DetachMessageVars = { model: modelId, notebook: target.view.notebookPath, record: target.view.recordPath, proposal: proposalId, count: String(preview.writes.length) };
    const out = this.out;
    out?.clear();
    out?.appendLine(msg("reattachProposed", vars));
    out?.appendLine("");
    for (const l of preview.lines) out?.appendLine(l);
    out?.show(true);
    if (preview.blocked) { void vscode.window.showWarningMessage(`${msg("reattachProposed", vars)} Nothing to write: see the holes in the output.`); return; }
    const ok = await vscode.window.showWarningMessage(msg("reattachConfirm", vars), { modal: true, detail: msg("reattachConfirmDetail", vars) }, "Write");
    if (ok !== "Write") return;
    const byPath = new Map(proposal.files.map(f => [f.path, f.content]));
    for (const p of preview.writes) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...p.split("/")), new TextEncoder().encode(byPath.get(p)!));
    const head = await gitRunner(["rev-parse", "--abbrev-ref", "HEAD"], root.fsPath, 5_000);
    try {
      const plan = materializationGitPlan({
        userAction: "user-confirmed", branch: `datapass/${proposalId}`, baseBranch: head.ok ? head.stdout.trim() : "main",
        candidate: result.candidate, files: proposal.files, diff: proposal.diff, issues: result.issues, openMergeRequest: false
      });
      out?.appendLine("");
      out?.appendLine("Git steps (run them yourself, after review):");
      for (const c of plan.commands) out?.appendLine(`  ${c.label}: ${c.tool} ${c.args.map(a => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    } catch (e) {
      out?.appendLine(`Git steps not planned: ${(e as Error).message}`);
    }
    await this.refresh();
    void vscode.window.showInformationMessage(`${preview.writes.length} file(s) of the re-attach proposal written. The Git steps are in the output.`);
  }
}

const isLoaded = (x: unknown): x is Loaded => !!x && typeof x === "object" && (x as Loaded).uri instanceof vscode.Uri && typeof (x as Loaded).view === "object";

/** A file Uri (editor / explorer) or a Project tree row (`dbtDetach:<record path>`) as a repository-relative path. */
function argPathOf(arg: unknown): string | undefined {
  if (arg instanceof vscode.Uri) return vscode.workspace.asRelativePath(arg, false).replace(/\\/g, "/");
  const rowId = arg && typeof arg === "object" && typeof (arg as { id?: unknown }).id === "string" ? (arg as { id: string }).id : "";
  return rowId.startsWith("dbtDetach:") ? rowId.slice("dbtDetach:".length) : undefined;
}

/** Detach wording from `datapass.dbt.detachMessages` (data), defaults in DETACH_MESSAGES. */
const msg = (key: DetachMessageKey, vars: DetachMessageVars): string =>
  detachMessage(key, vars, vscode.workspace.getConfiguration("datapass.dbt").get<Record<string, unknown>>("detachMessages") ?? {});

/** fs stat only: does the stamped notebook still exist as a file? */
async function targetExists(uri: vscode.Uri): Promise<boolean> {
  try { return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File) !== 0; } catch { return false; }
}

async function readText(uri: vscode.Uri): Promise<string | null> {
  try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { return null; }
}

const relative = (root: vscode.Uri, uri: vscode.Uri): string => uri.path.slice(root.path.replace(/\/$/, "").length + 1);

/** fs stat of the dbt project's sources (`dbt_project.yml` and the source folders), paths relative to the project folder. */
async function dbtSourceStats(dir: vscode.Uri): Promise<Array<{ path: string; mtimeMs: number }>> {
  const uris = [vscode.Uri.joinPath(dir, "dbt_project.yml")];
  for (const f of DBT_SOURCE_FOLDERS) uris.push(...await vscode.workspace.findFiles(new vscode.RelativePattern(dir, `${f}/**`), "**/{target,dbt_packages,logs,node_modules}/**", 2000));
  const out: Array<{ path: string; mtimeMs: number }> = [];
  for (const u of uris) {
    try { out.push({ path: relative(dir, u), mtimeMs: (await vscode.workspace.fs.stat(u)).mtime }); } catch { /* gone: not an edit */ }
  }
  return out;
}

/** The folder of the dbt project whose `dbt_project.yml` name is the model's package (`model.<package>.<name>`). */
async function dbtProjectDir(root: vscode.Uri, modelId: string): Promise<vscode.Uri | undefined> {
  const pkg = modelId.split(".")[1];
  if (!pkg) return undefined;
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/dbt_project.yml"), "**/{node_modules,dbt_packages,target}/**", 50);
  for (const f of files) {
    const m = /^name:\s*['"]?([\w-]+)['"]?\s*$/m.exec(await readText(f) ?? "");
    if (m?.[1] === pkg) return vscode.Uri.joinPath(f, "..");
  }
  return undefined;
}

export function registerDbtDetach(context: vscode.ExtensionContext, root: () => vscode.Uri | undefined, changed: vscode.Event<unknown>): DbtDetachService {
  const out = vscode.window.createOutputChannel("DataPass dbt re-attach");
  const service = new DbtDetachService(root, out);
  context.subscriptions.push(out, service, changed(() => void service.refresh()),
    vscode.commands.registerCommand(DETACH_COMMAND, (arg?: unknown) => service.detach(arg)),
    vscode.commands.registerCommand(REATTACH_COMMAND, (arg?: unknown) => service.reattach(arg)));
  void service.refresh();
  return service;
}
