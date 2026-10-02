/**
 * DETACH1: the `datapass.dbt.detach` command and the detach facts (badge + drift) for the Project tree and the Context
 * panel. Reads `.datapass/materialization/**\/*.detach.json` (DETSPI1 records written by DBTMAT1), the notebooks they
 * name, and the dbt project revision from Git (`git log -1 -- <dbt project folder>`, read-only). Never runs dbt or the
 * notebook; writes one file, the record, after an explicit modal confirmation.
 */
import * as vscode from "vscode";
import { gitRunner } from "../work/session";
import { RECORD_ROOT } from "../core/materialize/dbtNotebook";
import { DETACH_COMMAND, DRIFT_LABELS, detachBadge, detachContextSection, detachModel, detachView, readDetachRecord, serializeDetachRecord, type DetachView } from "../core/materialize/dbtDetach";

interface Loaded { uri: vscode.Uri; view: DetachView }

export class DbtDetachService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private loaded: Loaded[] = [];
  private readonly subs: vscode.Disposable[] = [this.emitter];

  constructor(private readonly root: () => vscode.Uri | undefined) {
    const w = vscode.workspace.createFileSystemWatcher(`**/${RECORD_ROOT}/**/*.detach.json`);
    const again = () => void this.refresh();
    this.subs.push(w, w.onDidCreate(again), w.onDidChange(again), w.onDidDelete(again), vscode.workspace.onDidSaveTextDocument(d => { if (this.loaded.some(l => d.uri.path.endsWith(`/${l.view.notebookPath}`))) again(); }));
  }

  views(): readonly DetachView[] { return this.loaded.map(l => l.view); }

  /** The Context section for a file (NAVCTX1 provider result shape). */
  contextFor(filePath: string | undefined) { return detachContextSection(this.views(), filePath); }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  async refresh(): Promise<void> {
    const root = this.root();
    if (!root) { this.loaded = []; this.emitter.fire(); return; }
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, `${RECORD_ROOT}/**/*.detach.json`), undefined, 500);
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const labels = vscode.workspace.getConfiguration("datapass.dbt").get<Partial<typeof DRIFT_LABELS>>("driftLabels") ?? {};
    const out: Loaded[] = [];
    for (const uri of uris.sort((a, b) => a.path.localeCompare(b.path))) {
      const r = readDetachRecord(await readText(uri) ?? "");
      if (!r.ok) continue;
      const current = await this.current(root, r.record.stamp.modelId, r.record.stamp.notebookPath);
      out.push({ uri, view: detachView(relative(root, uri), r.record, current, at, labels) });
    }
    this.loaded = out;
    this.emitter.fire();
  }

  /** Current notebook text and dbt revision (null when unreadable: the drift is then `unknown`). */
  async current(root: vscode.Uri, modelId: string, notebookPath: string): Promise<{ notebookContent: string | null; dbtRevision: string | null }> {
    const notebookContent = await readText(vscode.Uri.joinPath(root, ...notebookPath.split("/")));
    const dir = await dbtProjectDir(root, modelId);
    if (!dir || !vscode.workspace.isTrusted) return { notebookContent, dbtRevision: null };
    const r = await gitRunner(["log", "-1", "--format=%H", "--", "."], dir.fsPath, 10_000);
    const sha = r.ok ? r.stdout.trim() : "";
    return { notebookContent, dbtRevision: sha || null };
  }

  /** The command: pick an attached model, confirm, flip the authority and write the stamp. */
  async detach(arg?: unknown): Promise<void> {
    const root = this.root();
    if (!root) { void vscode.window.showWarningMessage("Open a DataPass project first."); return; }
    await this.refresh();
    // A file Uri (editor / explorer) or a Project tree row (`dbtDetach:<record path>`).
    const rowId = arg && typeof arg === "object" && typeof (arg as { id?: unknown }).id === "string" ? (arg as { id: string }).id : "";
    const argPath = arg instanceof vscode.Uri ? vscode.workspace.asRelativePath(arg, false).replace(/\\/g, "/") : rowId.startsWith("dbtDetach:") ? rowId.slice("dbtDetach:".length) : undefined;
    let target = argPath ? this.loaded.find(l => argPath.endsWith(l.view.notebookPath) || argPath.endsWith(l.view.recordPath)) : undefined;
    if (!target) {
      if (!this.loaded.length) { void vscode.window.showInformationMessage("No materialized dbt model here: materialize one first (a MAT1 proposal writes its record under .datapass/materialization)."); return; }
      const pick = await vscode.window.showQuickPick(this.loaded.map(l => ({ label: l.view.modelId, description: detachBadge(l.view), detail: l.view.notebookPath, l })), { title: "Detach a dbt model (the notebook becomes the authority)" });
      if (!pick) return;
      target = pick.l;
    }
    if (target.view.detached) {
      void vscode.window.showInformationMessage(`${target.view.modelId} is already detached (${detachBadge(target.view)}). Re-attach is a new materialization proposal (MAT1) you review in a merge request, never automatic.`);
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      `Detach ${target.view.modelId}?`,
      { modal: true, detail: `The notebook ${target.view.notebookPath} becomes the authority. Later dbt changes are no longer materialized into it; drift is shown as a fact, never re-synced. DataPass records who and when in ${target.view.recordPath}. Commit that file through your normal Git flow.` },
      "Detach"
    );
    if (ok !== "Detach") return;
    const raw = readDetachRecord(await readText(target.uri) ?? "");
    if (!raw.ok) { void vscode.window.showErrorMessage(`The detach record is not valid: ${raw.reason}`); return; }
    const current = await this.current(root, raw.record.stamp.modelId, raw.record.stamp.notebookPath);
    const actor = await gitRunner(["config", "user.name"], root.fsPath, 5_000).then(r => (r.ok ? r.stdout.trim() : ""), () => "");
    const res = detachModel(raw.record, { ...current, actor: { kind: "human", id: actor || "unknown" }, at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), origin: "declared" });
    if (!res.ok) { void vscode.window.showWarningMessage(res.reason); return; }
    await vscode.workspace.fs.writeFile(target.uri, new TextEncoder().encode(serializeDetachRecord(res.record)));
    await this.refresh();
    void vscode.window.showInformationMessage(`${target.view.modelId} is detached: the notebook is the authority.`);
  }
}

async function readText(uri: vscode.Uri): Promise<string | null> {
  try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { return null; }
}

const relative = (root: vscode.Uri, uri: vscode.Uri): string => uri.path.slice(root.path.replace(/\/$/, "").length + 1);

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
  const service = new DbtDetachService(root);
  context.subscriptions.push(service, changed(() => void service.refresh()), vscode.commands.registerCommand(DETACH_COMMAND, (arg?: unknown) => service.detach(arg)));
  void service.refresh();
  return service;
}
