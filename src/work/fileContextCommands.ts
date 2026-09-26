/**
 * *DataPass: Copy Context for My AI* (0.22, package C): one click on any file — Explorer, editor
 * title, editor context menu or a selection — builds a bounded pack for the person's own AI and
 * copies it after a preview. Read-only: the project map is used as observed, Git is only read (and
 * not run at all in Restricted Mode), nothing is written anywhere.
 */
import * as path from "node:path";
import * as os from "node:os";
import { promises as fsp } from "node:fs";
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { gitRunner } from "./session";
import { activeVariantHeader } from "./activeVariantCommands";
import { packStamp } from "./packStamps";
import { clipboard } from "../core/clipboard";
import { newLocalId, sha256Bytes } from "../core/model/ids";
import { guarded, UserFacingError } from "./io";
import {
  buildFileContext, capSiblings, componentPlaces, locateFile, owningComponents, parentChain,
  type ComponentPlace, type FileContextInput, type FileGitProbe, type FileGitState, type RepoRevision
} from "../core/exchange/fileContext";
import { normalizeRemote } from "../core/project/resolve";

/** Files larger than this are read only up to it (the pack keeps far less). */
const READ_CAP = 1024 * 1024;

export function registerFileContextCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  context.subscriptions.push(vscode.commands.registerCommand("datapass.copyFileContext", guarded(async (arg?: unknown, all?: unknown) => {
    // The Explorer passes (uri, selected uris); the editor menus pass the document's uri only.
    await copyFileContext(session, arg instanceof vscode.Uri ? arg : undefined, Array.isArray(all));
  })));
}

/**
 * The canonical form of a path: Windows 8.3 short names (C:\Users\RUNNER~1) expanded, symlinks
 * resolved, so the file, Git's toplevel and the observed folders compare equal.
 */
async function real(p: string): Promise<string> {
  try { return await fsp.realpath(p); } catch { return p; }
}

const trimOut = (s: string) => s.trim().split(/\r?\n/)[0] ?? "";

async function probeGit(dir: string): Promise<FileGitProbe | undefined> {
  if (!vscode.workspace.isTrusted) return undefined;
  const top = await gitRunner(["rev-parse", "--show-toplevel"], dir, 10_000);
  if (!top.ok) return undefined;
  const origin = await gitRunner(["config", "--get", "remote.origin.url"], dir, 10_000);
  return { top: await real(path.normalize(trimOut(top.stdout))), origin: origin.ok ? trimOut(origin.stdout) : undefined };
}

async function readGitState(root: string, relPath: string, isGitRepo: boolean): Promise<FileGitState> {
  if (!vscode.workspace.isTrusted) return { unread: "Restricted Mode: DataPass does not run Git in an untrusted workspace" };
  if (!isGitRepo) return { unread: "not a Git repository" };
  const [branch, head, file, all] = await Promise.all([
    gitRunner(["rev-parse", "--abbrev-ref", "HEAD"], root, 10_000),
    gitRunner(["rev-parse", "HEAD"], root, 10_000),
    relPath ? gitRunner(["status", "--porcelain=v1", "--ignored=matching", "--", relPath], root, 10_000) : Promise.resolve({ ok: false, stdout: "", stderr: "" }),
    gitRunner(["status", "--porcelain=v1", "--untracked-files=normal"], root, 15_000)
  ]);
  const code = file.ok ? file.stdout.split(/\r?\n/).find(Boolean)?.slice(0, 2) : undefined;
  const fileState: FileGitState["fileState"] = !file.ok ? "unknown" : code === undefined ? "clean" : code === "??" ? "untracked" : code === "!!" ? "ignored" : "modified";
  return {
    branch: branch.ok ? trimOut(branch.stdout) : undefined,
    head: head.ok ? trimOut(head.stdout) : undefined,
    fileState,
    changes: all.ok ? all.stdout.split(/\r?\n/).filter(Boolean).length : undefined
  };
}

async function siblingsOf(dir: vscode.Uri, fileName: string) {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return capSiblings(entries.slice(0, 2000).map(([name, type]) => ({ name, dir: (type & vscode.FileType.Directory) !== 0 })), fileName);
  } catch { return { siblings: [], moreSiblings: 0 }; }
}

async function copyFileContext(session: WorkSession, target: vscode.Uri | undefined, fromExplorer = false): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const uri = target ?? editor?.document.uri;
  if (!uri) throw new UserFacingError("Open a file or right-click one in the Explorer to copy its context.");
  if (uri.scheme !== "file" && uri.scheme !== "untitled") throw new UserFacingError("Copy Context for My AI works on files on this machine.");
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (uri.scheme === "file") {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) throw new UserFacingError("Pick a file, not a folder.");
    } catch (e) { if (e instanceof UserFacingError) throw e; if (!doc) throw new UserFacingError("This file no longer exists on disk."); }
  }

  const question = await vscode.window.showInputBox({
    title: "Copy Context for My AI",
    prompt: "Your question for your AI (optional; leave empty to add it in the chat)",
    placeHolder: "e.g. why does this job fail on the dev workspace?",
    ignoreFocusOut: true
  });
  if (question === undefined) return;

  // ---- where the file is
  const fsPath = uri.scheme === "file" ? uri.fsPath : "";
  // The selected variant's map, like the tree: the owning component is the one the person previews.
  const map = session.root ? session.preview()?.map ?? session.projectMap() : undefined;
  const obs = session.projectObservation();
  const repos = map?.repositories ?? [];
  const observed = repos.map(r => ({ key: r.key, folder: obs?.folders.get(r.key)?.fsPath, remoteUrl: r.remoteUrl }));
  const candidates = await Promise.all(observed.map(async c => ({ ...c, folder: c.folder ? await real(c.folder) : undefined })));
  const dir = fsPath ? path.dirname(fsPath) : undefined;
  const git = dir ? await probeGit(dir) : undefined;
  const wsFolder = uri.scheme === "file" ? vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath : undefined;
  const loc = fsPath ? locateFile(await real(fsPath), candidates, git, wsFolder ? await real(wsFolder) : undefined) : undefined;
  const relPath = loc?.relPath || (doc ? `(untitled) ${path.basename(uri.path)}` : path.basename(uri.path));

  // ---- the owning components and the repositories they use
  const places: ComponentPlace[] = map ? componentPlaces(map) : [];
  const components = loc?.kind === "declared" ? owningComponents(loc.key, loc.relPath, places) : [];
  const bridgeRepo = repos.find(r => r.coordination);
  const ids = new Set(components.map(c => c.id));
  const used = repos.filter(r => r.usedBy.some(u => ids.has(u)) || (loc?.kind === "declared" && components.length && r.key === loc.key));
  if (components.length && bridgeRepo && !used.includes(bridgeRepo)) used.push(bridgeRepo);
  const revisions: RepoRevision[] = used.map(r => ({ key: r.key, label: r.label, state: r.state, branch: r.git?.branch, head: r.git?.head, bridge: r.coordination }));

  // ---- the file's repository and its Git state (this worktree's, not the observed clone's)
  let repository: FileContextInput["repository"];
  if (loc?.kind === "declared") {
    const r = repos.find(x => x.key === loc.key)!;
    repository = { kind: "declared", key: r.key, label: r.label, bridge: r.coordination, remote: r.remote, otherClone: loc.otherClone, git: await readGitState(loc.root, loc.relPath, Boolean(git?.top)) };
  } else {
    const name = loc ? path.basename(loc.root) : "(no folder)";
    repository = { kind: "undeclared", name, remote: normalizeRemote(git?.origin), git: loc ? await readGitState(loc.root, loc.relPath, loc.isGitRepo) : { unread: "not saved to disk" } };
  }

  // ---- the text: the editor's buffer when open (saved or not), else the disk, bounded
  let text: string | undefined, binary = false;
  const unsaved = Boolean(doc?.isDirty);
  if (doc) text = doc.getText();
  else {
    const bytes = (await vscode.workspace.fs.readFile(uri)).subarray(0, READ_CAP);
    binary = bytes.subarray(0, 8000).includes(0);
    if (!binary) text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  // The selection counts from the editor menus and the palette, not from an Explorer click.
  const sel = !fromExplorer && editor && editor.document.uri.toString() === uri.toString() && !editor.selection.isEmpty ? editor.selection : undefined;
  const selection = sel ? { startLine: sel.start.line + 1, endLine: sel.end.line + 1, text: editor!.document.getText(sel) } : undefined;

  const tree = dir ? await siblingsOf(vscode.Uri.file(dir), path.basename(fsPath)) : { siblings: [], moreSiblings: 0 };
  const diagnostics = vscode.languages.getDiagnostics(uri).map(d => ({
    severity: (["error", "warning", "info", "hint"] as const)[d.severity] ?? "info",
    line: d.range.start.line + 1, message: d.message, source: d.source
  }));

  const manifest = session.project.manifest;
  const localPaths = [...new Set([...(loc ? [loc.root] : []), ...[...candidates, ...observed].map(c => c.folder).filter((f): f is string => !!f), ...(wsFolder ? [wsFolder, await real(wsFolder)] : []), os.homedir(), await real(os.homedir())])];
  const pack = buildFileContext({
    question, project: manifest ? { id: manifest.project.id, title: manifest.project.title } : undefined,
    activeVariant: manifest ? activeVariantHeader(session) : undefined,
    stamp: manifest ? await packStamp(session) : undefined,
    bridge: bridgeRepo ? { key: bridgeRepo.key, label: bridgeRepo.label } : undefined,
    repository,
    file: { relPath, languageId: doc?.languageId, unsaved, notOnDisk: uri.scheme === "untitled", binary, text, selection },
    components, revisions,
    tree: { parents: loc ? parentChain(loc.relPath) : [], ...tree },
    diagnostics, localPaths
  });

  const choice = await vscode.window.showInformationMessage(
    `Context for my AI: ${relPath} — ${pack.bytes} bytes${pack.contentTruncated ? ", file text truncated" : ""}.`,
    { modal: true, detail: `Sections: ${pack.sections.join(", ")}.\nNever included: ${pack.omissions.join(", ")}.\n${repository.kind === "undeclared" ? "This file is not in the bridge." : components.length ? `Component: ${components.map(c => c.label).join(", ")}.` : "No component holds this file."}` },
    "Copy", "Preview"
  );
  if (choice === "Preview") {
    const preview = await vscode.workspace.openTextDocument({ content: pack.text, language: "markdown" });
    await vscode.window.showTextDocument(preview, { preview: true });
    return;
  }
  if (choice !== "Copy") return;
  await clipboard.writeText(pack.text);
  // 0.27 (P1, D-23): remembered with its stamp, so the AI view can say when it goes stale.
  if (manifest) await session.recordExchange({ id: newLocalId("file-ctx"), kind: "ai-context", label: `Context for my AI: ${relPath}`, status: "copied", digest: sha256Bytes(pack.text).value, scopeRef: session.model().scope.id, at: new Date().toISOString() });
  void vscode.window.showInformationMessage(`Copied the context of ${relPath} (${pack.bytes} bytes). Paste it into your AI.`);
}
