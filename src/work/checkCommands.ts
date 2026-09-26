/**
 * 0.22 format checks (package D) in VS Code: one DataPass diagnostic collection fed by the
 * parse-only rules of core/checks, on save and on *Check This File* / *Check This Repository*.
 * Files are read through vscode.workspace.fs (works in Restricted Mode and remotely); nothing is
 * ever run. Bundle diagnostics offer the existing *Copy bundle validate* route as a quick fix.
 */
import * as vscode from "vscode";
import {
  bundleOrigin, bundleRootFor, checkBundle, checkFile, DEFAULT_BUDGET, fileOrigin, FindingStore, isBundleRoot, kindOf, scanRepository,
  type Budget, type CheckFs, type Entry, type Finding
} from "../core/checks";
import { buildDatabricksBundleCommand } from "../core/commands";
import { clipboard } from "../core/clipboard";
import { decodeUtf8Strict } from "../core/model/strictJson";
import { guarded, output, report, UserFacingError } from "./io";

const SOURCE = "DataPass";
const SEVERITY = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information } as const;
export const COPY_VALIDATE = "datapass.checks.copyBundleValidate";

export function folderFs(root: vscode.Uri): CheckFs {
  const uri = (rel: string) => (rel ? vscode.Uri.joinPath(root, ...rel.split("/")) : root);
  return {
    async stat(rel) {
      try {
        const s = await vscode.workspace.fs.stat(uri(rel));
        return { type: s.type & vscode.FileType.Directory ? "dir" : "file", size: s.size };
      } catch { return undefined; }
    },
    async list(rel) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(uri(rel));
        return entries
          .filter(([, t]) => !(t & vscode.FileType.SymbolicLink)) // never follow links out of the folder
          .map(([name, t]): Entry => ({ name, type: t & vscode.FileType.Directory ? "dir" : "file" }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch { return undefined; }
    },
    async readText(rel) {
      try { return decodeUtf8Strict(await vscode.workspace.fs.readFile(uri(rel))); } catch { return undefined; }
    }
  };
}

/** Path of a URI inside its workspace folder, "/"-separated. */
export function relIn(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  // getWorkspaceFolder already matched the folder; a saved document's URI may differ in case (drive letter on Windows).
  const base = folder.uri.path.replace(/\/+$/, "") + "/";
  const p = uri.path;
  return p.startsWith(base) || p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : "";
}

export function budget(): Budget {
  const c = vscode.workspace.getConfiguration("datapass.checks");
  const n = (key: string, def: number, min: number) => { const v = c.get<number>(key); return typeof v === "number" && Number.isFinite(v) && v >= min ? Math.floor(v) : def; };
  return { maxFiles: n("maxFiles", DEFAULT_BUDGET.maxFiles, 1), maxFileBytes: n("maxFileBytes", DEFAULT_BUDGET.maxFileBytes, 1), maxDepth: DEFAULT_BUDGET.maxDepth };
}

export class FormatChecks implements vscode.Disposable, vscode.CodeActionProvider {
  readonly collection = vscode.languages.createDiagnosticCollection("datapass-checks");
  private readonly stores = new Map<string, FindingStore>();
  /** Diagnostic → the bundle's databricks.yml, for the validate quick fix. */
  private readonly bundles = new WeakMap<vscode.Diagnostic, vscode.Uri>();

  private store(folder: vscode.WorkspaceFolder): FindingStore {
    const key = folder.uri.toString();
    let s = this.stores.get(key);
    if (!s) this.stores.set(key, s = new FindingStore());
    return s;
  }

  private publish(folder: vscode.WorkspaceFolder, files: Iterable<string>): void {
    const store = this.store(folder);
    for (const rel of files) {
      const uri = rel ? vscode.Uri.joinPath(folder.uri, ...rel.split("/")) : folder.uri;
      const diags = store.forFile(rel).map(f => this.diagnostic(folder, f));
      this.collection.set(uri, diags.length ? diags : undefined);
    }
  }

  private diagnostic(folder: vscode.WorkspaceFolder, f: Finding): vscode.Diagnostic {
    const d = new vscode.Diagnostic(new vscode.Range(f.line, f.col, f.endLine, Math.max(f.endCol, f.endLine === f.line ? f.col + 1 : 0)), f.message, SEVERITY[f.severity]);
    d.source = SOURCE;
    d.code = f.rule;
    if (f.bundle) this.bundles.set(d, vscode.Uri.joinPath(folder.uri, ...f.bundle.split("/")));
    return d;
  }

  /** Check one file (and the bundle it belongs to). False when no rule applies to it. */
  async checkUri(uri: vscode.Uri, onSave = false): Promise<boolean> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    const relInFolder = relIn(folder, uri);
    const kind = kindOf(relInFolder);
    if (!kind) return false;
    const fs = folderFs(folder.uri), b = budget(), store = this.store(folder);
    // A saved JSON file is open, so VS Code's JSON support already reports its syntax: only clear ours.
    const own = onSave && kind === "json" ? [] : (await checkFile(fs, relInFolder, b)) ?? [];
    const touched = store.set(fileOrigin(relInFolder), own);
    const root = /\.ya?ml$/i.test(relInFolder) ? await bundleRootFor(fs, relInFolder) : undefined;
    if (root) for (const f of store.set(bundleOrigin(root), await checkBundle(fs, root, b))) touched.add(f);
    this.publish(folder, touched);
    return true;
  }

  async checkFolder(folder: vscode.WorkspaceFolder): Promise<{ checked: number; incomplete: boolean; problems: number }> {
    const store = this.store(folder);
    const touched = store.clear();
    const result = await scanRepository(folderFs(folder.uri), budget());
    for (const [origin, findings] of result.origins) for (const f of store.set(origin, findings)) touched.add(f);
    this.publish(folder, touched);
    let problems = 0;
    for (const f of store.files()) problems += store.forFile(f).filter(x => x.rule !== "checks.incomplete").length;
    return { checked: result.checked, incomplete: result.incomplete, problems };
  }

  forget(uri: vscode.Uri): void {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    this.publish(folder, this.store(folder).drop(relIn(folder, uri)));
  }

  provideCodeActions(_doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const out: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      const bundle = this.bundles.get(d);
      if (!bundle) continue;
      const a = new vscode.CodeAction("DataPass: Copy `databricks bundle validate` for this bundle (not run)", vscode.CodeActionKind.QuickFix);
      a.diagnostics = [d];
      a.command = { title: a.title, command: COPY_VALIDATE, arguments: [bundle.toString()] };
      out.push(a);
      break;
    }
    return out;
  }

  dispose(): void { this.collection.dispose(); }
}

export function registerCheckCommands(context: vscode.ExtensionContext): FormatChecks {
  const checks = new FormatChecks();
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  context.subscriptions.push(
    checks,
    vscode.languages.registerCodeActionsProvider([{ scheme: "file" }, { scheme: "vscode-remote" }], checks, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (vscode.workspace.getConfiguration("datapass.checks").get<boolean>("onSave", true))
        checks.checkUri(doc.uri, true).catch(e => output().appendLine(`[checks] ${doc.uri.fsPath}: ${e instanceof Error ? e.message : String(e)}`));
    }),
    vscode.workspace.onDidDeleteFiles(e => { for (const f of e.files) checks.forget(f); })
  );
  reg("datapass.checkThisFile", async (arg?: unknown) => {
    const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
    if (!uri) throw new UserFacingError("Open or select a file to check.");
    if (!(await checks.checkUri(uri))) {
      void vscode.window.showInformationMessage("DataPass checks JSON, YAML, databricks.yml, Dockerfiles and compose files; this file is none of those.");
      return;
    }
    const n = vscode.languages.getDiagnostics(uri).filter(d => d.source === SOURCE).length;
    void vscode.window.showInformationMessage(n ? `DataPass: ${n} problem(s) in this file; see Problems.` : "DataPass: no problem found in this file (nothing was run).");
  });
  reg("datapass.checkThisRepository", async (arg?: unknown) => {
    const folders = arg instanceof vscode.Uri ? [vscode.workspace.getWorkspaceFolder(arg)].filter((f): f is vscode.WorkspaceFolder => !!f) : [...(vscode.workspace.workspaceFolders ?? [])];
    if (!folders.length) throw new UserFacingError("Open a workspace folder first.");
    const lines: string[] = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "DataPass: checking formats" }, async () => {
      for (const f of folders) {
        const r = await checks.checkFolder(f);
        lines.push(`${f.name}: ${r.checked} file(s) checked, ${r.problems} problem(s)${r.incomplete ? " — INCOMPLETE (file budget reached)" : ""}.`);
      }
    });
    lines.push("Parse-only: nothing was run. Rules: docs/guide/08_FORMAT_CHECKS.md.");
    report("Format checks", lines);
  });
  reg(COPY_VALIDATE, async (arg?: unknown) => {
    if (typeof arg !== "string") throw new UserFacingError("No bundle given.");
    const uri = vscode.Uri.parse(arg, true);
    if (!vscode.workspace.getWorkspaceFolder(uri) || !isBundleRoot(uri.path)) throw new UserFacingError("That is not a databricks.yml in this workspace.");
    await clipboard.writeText(buildDatabricksBundleCommand("validate", vscode.Uri.joinPath(uri, "..").fsPath));
    void vscode.window.showInformationMessage("DataPass: copied `databricks bundle validate` for this bundle. DataPass does not run it; run it in a terminal where you are signed in.");
  });
  return checks;
}
