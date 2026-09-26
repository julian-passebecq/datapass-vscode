/**
 * DataPass: Open a Client Project… (V1-ON). From the bridge repository's Git address to a company
 * window in one command: clone the bridge, read its manifest, clone the declared repositories that
 * are not on this computer yet (a checkbox list), find the ones that are (same remote identity,
 * whatever the folder name or address form), write the company workspace file (0.17) and open it.
 * Standard mode then lands on the Architecture panel (0.22).
 *
 * Idempotent: a second run finds everything present and clones nothing. Never clones a planned
 * repository nor over a folder holding something else. Credentials: Git runs with the host's own
 * credential helper (Git Credential Manager, ssh-agent); DataPass reads and stores none, and stops at
 * the first refusal with the host's own message and a Retry.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { executablePath } from "../core/exec";
import { readProjectManifest } from "../core/projectManifest";
import { buildCompanyWorkspace, parseWorkspaceFile, workspaceFileName } from "../core/windows/company";
import {
  candidateFolders, hostMessage, isAuthFailure, parseBridgeUrl, planBridge, planClones, planSummary, workspaceRoots,
  type BridgeAddress, type CloneEntry, type FolderFact
} from "../core/project/cloneplan";
import { openFolderWindow } from "../core/external";
import { cloneParents, gitRunner } from "./session";
import { Cancelled, confirmModal, errorMessage, output, report, UserFacingError } from "./io";

export const OPEN_CLIENT_PROJECT_COMMAND = "datapass.openClientProject";
const CLONE_TIMEOUT_MS = 15 * 60_000;
const MAX_SCANNED_FOLDERS = 200;

/** What one run did (returned to the caller: desktop tests, the walkthrough). */
export interface OpenClientProjectResult {
  bridge: string;
  bridgeCloned: boolean;
  cloned: string[];
  present: string[];
  planned: string[];
  blocked: string[];
  workspaceFile?: string;
  workspaceWritten: boolean;
  opened: boolean;
}

interface CloneOutcome { ok: boolean; stderr: string }

/**
 * `git clone` through the resolved Git executable (absolute path, never a git.exe in a folder). No
 * terminal prompt (it would hang unseen), but the credential helper may show its own sign-in window.
 */
function gitClone(url: string, folder: string, cwd: string): Promise<CloneOutcome> {
  return new Promise(resolve => {
    const git = executablePath("git");
    if (!git) { resolve({ ok: false, stderr: "Git was not found on PATH. Install Git (git-scm.com), then retry." }); return; }
    execFile(git, ["-c", "core.fsmonitor=false", "clone", "--origin", "origin", "--", url, folder], {
      cwd, timeout: CLONE_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    }, (error, _stdout, stderr) => resolve({ ok: !error, stderr: String(stderr ?? "") || (error ? errorMessage(error) : "") }));
  });
}

/** Whether a folder exists, is a Git clone (its own .git, not a parent's), and its origin. */
async function folderFact(folder: string): Promise<FolderFact> {
  let exists = false;
  try { exists = (await fs.promises.stat(folder)).isDirectory(); } catch { /* absent */ }
  if (!exists) return { folder, exists: false };
  let isGitRepo = false;
  try { await fs.promises.stat(path.join(folder, ".git")); isGitRepo = true; } catch { /* not a clone */ }
  if (!isGitRepo) return { folder, exists, isGitRepo };
  const r = await gitRunner(["config", "--get", "remote.origin.url"], folder, 5000);
  return { folder, exists, isGitRepo, origin: r.ok ? r.stdout.trim() || undefined : undefined };
}

/** The chosen folder's sub-folders plus the expected ones: where a clone may already be. */
async function observe(parent: string, extra: readonly string[]): Promise<FolderFact[]> {
  let children: string[] = [];
  try {
    children = (await fs.promises.readdir(parent, { withFileTypes: true }))
      .filter(d => d.isDirectory() && !d.name.startsWith(".")).slice(0, MAX_SCANNED_FOLDERS).map(d => path.join(parent, d.name));
  } catch { /* unreadable: only the expected folders */ }
  const all = [...children];
  for (const e of extra) if (!all.some(a => path.resolve(a).toLowerCase() === path.resolve(e).toLowerCase())) all.push(e);
  return Promise.all(all.map(folderFact));
}

export function registerOpenClientProject(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(OPEN_CLIENT_PROJECT_COMMAND, async (): Promise<OpenClientProjectResult | undefined> => {
    try {
      return await openClientProject(context);
    } catch (error) {
      if (error instanceof Cancelled) return undefined;
      const msg = errorMessage(error);
      output().appendLine(`[open client project] ${msg}`);
      void vscode.window.showErrorMessage(`DataPass: ${msg}`);
      return undefined;
    }
  }));
}

/** Clone with a Retry: stops at the first failure and shows the host's own message. */
async function cloneWithRetry(label: string, url: string, folder: string, cwd: string): Promise<void> {
  for (;;) {
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DataPass: cloning ${label}…`, cancellable: false }, () => gitClone(url, folder, cwd));
    if (r.ok) { output().appendLine(`[open client project] cloned ${url} into ${folder}`); return; }
    const message = hostMessage(r.stderr);
    output().appendLine(`[open client project] clone of ${url} failed:\n${r.stderr.trim()}`);
    // A failed clone may leave an empty folder behind; remove it only when empty, so a retry can clone again.
    try { if (!(await fs.promises.readdir(folder)).length) await fs.promises.rmdir(folder); } catch { /* nothing there */ }
    const auth = isAuthFailure(r.stderr);
    const detail = auth
      ? `${message}\n\nSign in to the host the way Git expects (Git Credential Manager, your SSH key, or the host's own sign-in), check that your account can read this repository, then Retry. DataPass never asks for nor stores your credentials.`
      : message;
    const choice = await vscode.window.showErrorMessage(`Could not clone ${label}${auth ? ": the host refused access" : ""}.`, { modal: true, detail }, "Retry");
    if (choice !== "Retry") throw new Cancelled();
  }
}

async function openClientProject(context: vscode.ExtensionContext): Promise<OpenClientProjectResult> {
  // 1. The bridge's address.
  const typed = await vscode.window.showInputBox({
    title: "Open a Client Project (1/3): the bridge repository",
    prompt: "Paste the Git address of the client's bridge repository (the one with .datapass/project.json): GitHub, Azure DevOps or GitLab, https or SSH, as the host's Clone button shows it.",
    placeHolder: "https://github.com/org/bridge.git · git@ssh.dev.azure.com:v3/org/project/bridge",
    ignoreFocusOut: true,
    validateInput: v => { const r = parseBridgeUrl(v); return "error" in r ? r.error : undefined; }
  });
  if (typed === undefined) throw new Cancelled();
  const parsed = parseBridgeUrl(typed);
  if ("error" in parsed) throw new UserFacingError(parsed.error);
  const bridge: BridgeAddress = parsed;

  // 2. Where the client's repositories go.
  const defaultParent = cloneParents()[0] ?? os.homedir();
  const picked = await vscode.window.showOpenDialog({
    title: "Open a Client Project (2/3): the folder that holds this client's repositories",
    canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
    defaultUri: vscode.Uri.file(defaultParent), openLabel: "Clone here"
  });
  if (!picked?.[0]) throw new Cancelled();
  const parent = picked[0].fsPath;

  // 3. The bridge: an existing clone, or clone it.
  const b = planBridge(bridge, parent, await observe(parent, [path.join(parent, bridge.name)]));
  if (b.state === "conflict") throw new UserFacingError(`Cannot clone the bridge: ${b.detail}. Choose another folder, or move that one away.`);
  if (b.state === "clone") await cloneWithRetry(`the bridge (${bridge.name})`, bridge.url, b.folder, parent);

  // 4. Its manifest.
  const read = await readProjectManifest(vscode.Uri.file(b.folder));
  if (!read.exists) throw new UserFacingError(`${bridge.name} has no .datapass/project.json: it is not a DataPass bridge repository. Its clone is in ${b.folder}.`);
  if (!read.manifest) throw new UserFacingError(`${bridge.name}'s .datapass/project.json is not valid: ${read.errors.slice(0, 3).join("; ")}`);
  const manifest = read.manifest;

  // 5. The plan: present, to clone, planned, blocked.
  const planNow = async () => planClones(manifest, { bridgeFolder: b.folder, bridgeUrl: bridge.url, parent, facts: await observe(parent, candidateFolders(manifest, b.folder, parent)) });
  let plan = await planNow();
  const toClone = plan.filter(e => e.state === "clone");
  const others = plan.filter(e => e.state !== "clone");
  const describe = (e: CloneEntry) => `${e.label}${e.role ? ` — ${e.role}` : ""}`;
  let chosen: CloneEntry[] = [];
  if (toClone.length) {
    type Item = vscode.QuickPickItem & { entry: CloneEntry };
    const items: Item[] = toClone.map(e => ({ label: e.label, description: e.role, detail: `${e.remoteUrl} → ${e.folder}`, picked: e.picked, entry: e }));
    const s = planSummary(plan);
    const picks = await vscode.window.showQuickPick(items, {
      canPickMany: true, ignoreFocusOut: true,
      title: `Open a Client Project (3/3): repositories to clone into ${parent}`,
      placeHolder: [`${s.present} already here`, s.planned ? `${s.planned} planned (never cloned)` : "", s.blocked ? `${s.blocked} blocked (see the report)` : ""].filter(Boolean).join(" · ")
    });
    if (!picks) throw new Cancelled();
    chosen = picks.map(p => p.entry);
  } else {
    void vscode.window.showInformationMessage(`${manifest.project.title}: all ${plan.filter(e => e.state === "present").length} repositories are present, nothing to clone.`);
  }

  // 6. Clone, one at a time; the first failure stops with the host's message and a Retry.
  const cloned: string[] = [];
  for (const e of chosen) {
    await cloneWithRetry(e.label, e.remoteUrl!, e.folder!, parent);
    cloned.push(e.key);
  }
  if (cloned.length) plan = await planNow();

  // 7. The company workspace file (0.17): the bridge and every repository on this computer.
  const roots = workspaceRoots(b.folder, plan);
  const file = path.join(parent, workspaceFileName(manifest.project.title));
  let parsedFile: ReturnType<typeof parseWorkspaceFile> | undefined;
  let written = false;
  const uri = vscode.Uri.file(file);
  let current: string | undefined;
  try { current = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { /* new file */ }
  if (current !== undefined) {
    try { parsedFile = parseWorkspaceFile(current); } catch (e) {
      if (!(await confirmModal(`${path.basename(file)} is not a readable workspace file.`, `${errorMessage(e)}

Replace it with the company workspace of ${manifest.project.title}?`, "Replace"))) throw new Cancelled();
    }
  }
  // A re-run keeps what the person set on the file: company name, colour, startup view, other settings.
  const { doc } = buildCompanyWorkspace({
    file, company: parsedFile?.company ?? manifest.project.title, folders: roots,
    color: parsedFile?.color, startupView: parsedFile?.startupView, existing: parsedFile?.raw
  });
  const next = JSON.stringify(doc, null, "\t") + "\n";
  if (next !== current) {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(next));
    written = true;
  }

  const result: OpenClientProjectResult = {
    bridge: b.folder, bridgeCloned: b.state === "clone", cloned,
    present: plan.filter(e => e.state === "present" && !cloned.includes(e.key)).map(e => e.key),
    planned: plan.filter(e => e.state === "planned").map(e => e.key),
    blocked: plan.filter(e => e.state === "conflict" || e.state === "no-remote").map(e => e.key),
    workspaceFile: file, workspaceWritten: written, opened: false
  };
  report(`Open a Client Project: ${manifest.project.title}`, [
    `Bridge: ${bridge.url} → ${b.folder}${b.state === "clone" ? " (cloned)" : " (already here)"}`,
    ...plan.map(e => `${e.state === "present" ? (cloned.includes(e.key) ? "cloned " : "present") : e.state.padEnd(7)}  ${describe(e)} — ${e.detail}`),
    ...others.filter(e => e.state === "conflict" || e.state === "no-remote").length ? ["", "Blocked repositories are left out of the workspace; fix the folder or the declaration, then run the command again."] : [],
    "", `Workspace file: ${file}${written ? "" : " (unchanged)"}`
  ]);

  // 8. Open it (unless this window already is that workspace).
  const here = vscode.workspace.workspaceFile?.scheme === "file" ? vscode.workspace.workspaceFile.fsPath : undefined;
  if (here && path.resolve(here).toLowerCase() === path.resolve(file).toLowerCase()) {
    void vscode.window.showInformationMessage(`${manifest.project.title}: this window is already the company workspace.`);
    return result;
  }
  const hasFolders = Boolean(vscode.workspace.workspaceFolders?.length) || context.extensionMode === vscode.ExtensionMode.Test;
  // An empty window (the welcome page) becomes the company window; otherwise a new window opens.
  if (hasFolders) await openFolderWindow(uri);
  else await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: false });
  result.opened = true;
  return result;
}
