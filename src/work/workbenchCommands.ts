/**
 * V3 Workbench commands: selection, opening files and folders, native tools, repositories
 * (clone, locate, check for updates, get updates), component operations, results, checklists,
 * AI preparation pack, project folder and project switching, manifest upgrade (to v4).
 *
 * Every argument can come from a webview and is re-validated against the project map. Anything
 * that writes, contacts a remote or changes a working tree asks first; nothing pushes, deploys or
 * runs project code.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import type { WorkSession } from "./session";
import { gitRunner } from "./session";
import type { WorkbenchHost } from "../views/workbench";
import { confirmModal, guarded, jsonBytes, report, requireRoot, UserFacingError } from "./io";
import { clipboard } from "../core/clipboard";
import { openExternal, openFolderWindow, openRemoteFolder } from "../core/external";
import { sshRemoteTarget } from "../core/resources/resources";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { PACK_QUESTIONS, buildPreparationPack, type PackQuestion } from "../core/project/preparation";
import { changedComponents, describeVerdict, syncVerdict } from "../core/project/gitSync";
import { mergeCatalogs, parseCatalog, CATALOG_PATH, type Catalog } from "../core/project/catalog";
import { globMatcher, sameRemote } from "../core/project/resolve";
import { CI_HOSTS } from "./gitHostCommands";
import type { ComponentView, OperationView } from "../core/project/projectMap";
import { cleanNote, MAX_NOTE, toolSnapshot, type QualificationResult } from "../core/qualification/qualification";
import { CHECKLIST_STATES, type ChecklistState } from "../core/work/workModel";
import { LATEST_MANIFEST_VERSION, migrateManifestToLatest, validateProjectManifest, DATAPASS_MANIFEST_PATH } from "../core/projectManifestModel";
import { applyWithJournal } from "../core/exchange/journal";
import { workspaceJournalFs } from "./commands";
import { LOCAL_DIR } from "../core/workspace/loader";
import { newLocalId, sha256Bytes } from "../core/model/ids";
import { PHASE_LABELS } from "../core/capabilities/registry";
import { executeGalaxyAction } from "../core/actions";

const ADF_STUDIO = "https://adf.azure.com/";
const GUIDE_URL = "https://github.com/julian-passebecq/datapass-vscode/blob/main/docs/PREPARING_A_PROJECT.md";

/** View containers of the official extensions (from their package.json; the command exists only when the extension is enabled). */
const NATIVE_VIEWS: Record<string, { command: string; extensionId: string }> = {
  "azure-functions": { command: "workbench.view.extension.azure", extensionId: "ms-azuretools.vscode-azurefunctions" },
  "azure-storage": { command: "workbench.view.extension.azure", extensionId: "ms-azuretools.vscode-azurestorage" },
  "cosmos-nosql": { command: "workbench.view.extension.azure", extensionId: "ms-azuretools.vscode-cosmosdb" },
  "mongodb-atlas": { command: "workbench.view.extension.mongoDB", extensionId: "mongodb.mongodb-vscode" },
  databricks: { command: "workbench.view.extension.databricksBar", extensionId: "databricks.databricks" },
  neon: { command: "workbench.view.extension.neon-local-connect", extensionId: "databricks.neon-local-connect" },
  postgres: { command: "workbench.view.extension.pgObjectExplorer", extensionId: "ms-ossdata.vscode-pgsql" },
  terraform: { command: "workbench.view.extension.terraform", extensionId: "hashicorp.terraform" },
  jupyter: { command: "workbench.view.extension.jupyter", extensionId: "ms-toolsai.jupyter" },
  // Container Tools 2.5 (view container "containersView", read from its package.json on 2026-09-25).
  docker: { command: "workbench.view.extension.containersView", extensionId: "ms-azuretools.vscode-containers" }
};

export function registerWorkbenchCommands(context: vscode.ExtensionContext, session: WorkSession, host: WorkbenchHost): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const version = String(context.extension.packageJSON.version ?? "unknown");

  reg("datapass.openWorkbench", async () => { host.openPanel(); });
  reg("datapass.arrangeWorkbench", async () => arrange(session));
  reg("datapass.refreshProject", async () => { await vscode.commands.executeCommand("datapass.refresh"); });
  reg("datapass.selectComponent", async (arg?: { subproject?: string; component?: string }) => session.select({ subproject: str(arg?.subproject), component: str(arg?.component) }));
  reg("datapass.openComponentFile", async (componentId?: string, repoPath?: string) => openComponentFile(session, host, componentId, repoPath));
  reg("datapass.openComponentEntry", async (componentId?: unknown) => openEntry(session, host, componentArg(componentId)));
  reg("datapass.explainMissingFile", async (componentId?: string, repoPath?: string) => explainMissing(session, componentId, repoPath));
  reg("datapass.openComponentFolder", async (componentId?: unknown) => openComponentFolder(session, componentArg(componentId)));
  reg("datapass.openRepositoryWindow", async (repoKey?: unknown) => openRepoWindow(session, repoArg(repoKey)));
  reg("datapass.cloneRepository", async (repoKey?: unknown) => cloneRepository(session, repoArg(repoKey)));
  reg("datapass.locateRepository", async (repoKey?: unknown) => locateRepository(session, repoArg(repoKey)));
  reg("datapass.checkForUpdates", async (repoKey?: unknown) => checkForUpdates(session, repoArg(repoKey)));
  reg("datapass.getUpdates", async (repoKey?: unknown) => getUpdates(session, repoArg(repoKey)));
  reg("datapass.preparationPack", async (arg?: unknown) => preparationPack(session, version, packArg(arg)));
  reg("datapass.openNativeTool", async (componentId?: unknown) => openNativeTool(session, componentArg(componentId)));
  reg("datapass.openAdfStudio", async () => { await openExternal(vscode.Uri.parse(ADF_STUDIO)); });
  reg("datapass.installTool", async (extensionId?: unknown) => showExtension(str(extensionId)));
  reg("datapass.showOperation", async (opKey?: unknown) => showOperation(session, str(opKey)));
  reg("datapass.copyComponentCommand", async (opKey?: unknown) => copyComponentCommand(session, str(opKey)));
  reg("datapass.recordComponentResult", async (opKey?: unknown) => recordComponentResult(session, version, str(opKey)));
  reg("datapass.setProjectChecklist", async (key?: unknown) => setProjectChecklist(session, str(key)));
  reg("datapass.openDoc", async (doc?: unknown) => openDoc(session, doc));
  reg("datapass.openGraph", async () => openGraph(session));
  reg("datapass.openPreparationGuide", async () => openGuide(context));
  reg("datapass.upgradeManifest", async () => upgradeManifest(session));
  reg("datapass.selectProjectFolder", async () => selectProjectFolder(session));
  reg("datapass.switchProject", async () => switchProject(session));
}

// ------------------------------------------------------------------ helpers

const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 300 ? v : undefined);
/** Commands get an id from webviews and code, or the tree node itself from the Project tree's menus. */
type TreeNodeArg = { t?: string; r?: { key?: string }; c?: { id?: string }; sp?: { id?: string } } | undefined;
const repoArg = (v: unknown) => str(v) ?? ((v as TreeNodeArg)?.t === "repo" ? str((v as TreeNodeArg)!.r?.key) : undefined);
const componentArg = (v: unknown) => str(v) ?? ((v as TreeNodeArg)?.t === "component" ? str((v as TreeNodeArg)!.c?.id) : undefined);
function packArg(v: unknown): { componentId?: unknown; subprojectId?: unknown; question?: unknown } | undefined {
  const node = v as TreeNodeArg;
  if (node?.t === "component") return { componentId: node.c?.id };
  if (node?.t === "subproject") return { subprojectId: node.sp?.id };
  return v && typeof v === "object" ? v as { componentId?: unknown; subprojectId?: unknown; question?: unknown } : undefined;
}

function selectedComponent(session: WorkSession, id?: string): ComponentView {
  const map = session.projectMap();
  const cid = id ?? session.selection().component;
  const c = map.components.find(x => x.id === cid);
  if (!c) throw new UserFacingError(cid ? `Unknown component "${cid}".` : "Select a component first (Project tree, diagram or workbench).");
  return c;
}

function findOperation(session: WorkSession, key: string | undefined): { c: ComponentView; op: OperationView } {
  if (!key) throw new UserFacingError("No operation given.");
  for (const c of session.projectMap().components) {
    const op = c.operations.find(o => o.key === key);
    if (op) return { c, op };
  }
  throw new UserFacingError(`Unknown operation "${key}" (the project files may have changed; re-inspect).`);
}

/** Absolute URI of a repository-relative path, refusing anything that leaves the repository. */
function repoUri(session: WorkSession, repoKey: string, repoPath: string): vscode.Uri {
  const folder = session.repoFolder(repoKey);
  if (!folder) throw new UserFacingError("This repository is not cloned on this machine. Clone it or locate an existing clone first.");
  if (!repoPath) return folder;
  const vet = vetRelativePath(repoPath.replace(/\/\*\*$/, ""));
  if (!vet.ok) throw new UserFacingError(`Refusing ${repoPath}: ${vet.reason}`);
  return vscode.Uri.joinPath(folder, ...vet.relative.split("/"));
}

function isInsideWorkspace(uri: vscode.Uri): boolean {
  return Boolean(vscode.workspace.getWorkspaceFolder(uri));
}

// ------------------------------------------------------------------ layout

async function arrange(session: WorkSession): Promise<void> {
  // Left: the Project tree. Bottom: the architecture diagram. Right: details and checklists. Centre: files.
  await vscode.commands.executeCommand("datapass.project.focus");
  await vscode.commands.executeCommand("datapass.architecture.focus");
  await vscode.commands.executeCommand("datapass.details.focus");
  const c = session.selection().component ? session.projectMap().components.find(x => x.id === session.selection().component) : undefined;
  if (c?.artifacts?.entry?.state === "found") await vscode.commands.executeCommand("datapass.openComponentEntry", c.id);
}

// ------------------------------------------------------------------ files and folders

async function openComponentFile(session: WorkSession, host: WorkbenchHost, componentId?: string, repoPath?: string): Promise<void> {
  const c = selectedComponent(session, str(componentId));
  const a = c.artifacts;
  const f = a?.files.find(x => x.repoPath === repoPath);
  if (!a || !f) throw new UserFacingError(`${repoPath ?? "This file"} is not one of the files expected for ${c.label}.`);
  if (f.state !== "found") return explainMissing(session, c.id, f.repoPath);
  if (f.kind === "glob") {
    // "*.sql", ".github/workflows/*.{yml,yaml}": open the matching file (or pick one of them).
    const parts = f.repoPath.split("/");
    const re = globMatcher(parts.pop() ?? "*");
    const dir = repoUri(session, a.repoKey, parts.join("/"));
    let names: string[] = [];
    try { names = (await vscode.workspace.fs.readDirectory(dir)).filter(([n, t]) => t & vscode.FileType.File && re.test(n)).map(([n]) => n).sort(); } catch { /* listed below as none */ }
    if (!names.length) return explainMissing(session, c.id, f.repoPath);
    const name = names.length === 1 ? names[0] : (await vscode.window.showQuickPick(names, { title: `${c.label}: open which ${f.path}?` }));
    if (!name) return;
    return openFileBesideWorkbench(host, vscode.Uri.joinPath(dir, name));
  }
  const uri = repoUri(session, a.repoKey, f.repoPath);
  if (f.kind !== "file") {
    if (isInsideWorkspace(uri)) { await vscode.commands.executeCommand("revealInExplorer", uri); return; }
    if (await confirmModal(`${f.path} is a folder outside this window.`, `Open ${a.root === "." ? "the repository" : a.root} in a new window?`, "Open in new window")) await openFolderWindow(uri);
    return;
  }
  await openFileBesideWorkbench(host, uri);
}

/**
 * Beside the Workbench tab when it is the active tab, so the diagram stays visible. With the
 * Workbench in its own window (0.17), files go to the main window's first group instead: VS Code's
 * "active group" may then be the floating window's (verified in desktop tests), and a file belongs
 * next to the code, not on the second screen.
 */
async function openFileBesideWorkbench(host: WorkbenchHost, uri: vscode.Uri): Promise<void> {
  const floating = await host.isFloating();
  const workbenchActive = vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview && host.hasPanel();
  await vscode.commands.executeCommand("vscode.open", uri, { viewColumn: floating ? vscode.ViewColumn.One : workbenchActive ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preview: true });
}

async function openEntry(session: WorkSession, host: WorkbenchHost, componentId?: string): Promise<void> {
  const c = selectedComponent(session, componentId);
  const a = c.artifacts;
  if (!a) throw new UserFacingError(`${c.label} declares no files (graph.json → artifacts).`);
  const target = (a.entry?.state === "found" ? a.entry : undefined) ?? a.files.find(f => f.state === "found" && f.kind === "file") ?? a.files.find(f => f.state === "found" && !f.optional);
  if (!target) return explainMissing(session, c.id, a.entry?.repoPath ?? a.files[0]?.repoPath);
  await openComponentFile(session, host, c.id, target.repoPath);
}

async function explainMissing(session: WorkSession, componentId?: string, repoPath?: string): Promise<void> {
  const c = selectedComponent(session, str(componentId));
  const a = c.artifacts;
  const f = a?.files.find(x => x.repoPath === repoPath);
  if (!a || !f) throw new UserFacingError("Unknown file.");
  const repo = session.projectMap().repositories.find(r => r.key === a.repoKey);
  const where = `${repo?.label ?? a.repoKey} / ${f.repoPath}`;
  const why = f.generated ? `It is generated by ${f.generated.producer}${f.generated.how ? ` (${f.generated.how})` : ""}; it is not written by hand or committed as source.`
    : f.optional ? "It is recommended by the convention, not required."
    : `It is ${f.role === "entry" ? "the entry point" : `a ${f.role} file`} of this ${a.profile.label}; it is needed to ${f.requiredFor.map(p => PHASE_LABELS[p].toLowerCase()).join(", ") || "work on it"}.`;
  const state = f.state === "unbound" ? `The repository is not cloned on this machine, so DataPass cannot see this file (it may exist on GitHub).`
    : f.state === "planned" ? "The repository is planned and does not exist yet."
    : f.state === "unknown" ? "DataPass could not check it."
    : "It is not there. DataPass never creates an empty placeholder: a placeholder would look like progress.";
  const buttons = f.state === "unbound" ? ["Clone repository", "Locate clone"] : f.state === "missing" ? ["Ask AI to prepare it", "Open folder"] : [];
  const choice = await vscode.window.showInformationMessage(`${f.path} (${c.label})`, { modal: true, detail: [`Expected at ${where}.`, f.about ?? "", why, state].filter(Boolean).join("\n\n") }, ...buttons);
  if (choice === "Clone repository") await vscode.commands.executeCommand("datapass.cloneRepository", a.repoKey);
  else if (choice === "Locate clone") await vscode.commands.executeCommand("datapass.locateRepository", a.repoKey);
  else if (choice === "Ask AI to prepare it") await vscode.commands.executeCommand("datapass.preparationPack", { componentId: c.id, question: "prepare-missing" });
  else if (choice === "Open folder") await openComponentFolder(session, c.id);
}

async function openComponentFolder(session: WorkSession, componentId?: string): Promise<void> {
  const c = selectedComponent(session, componentId);
  if (!c.artifacts) throw new UserFacingError(`${c.label} declares no folder.`);
  const uri = repoUri(session, c.artifacts.repoKey, c.artifacts.root === "." ? "" : c.artifacts.root);
  await openFolderWindow(uri);
}

async function openRepoWindow(session: WorkSession, repoKey?: string): Promise<void> {
  const key = repoKey ?? await pickRepo(session, r => r.state === "local", "Open which repository in a new window?");
  if (!key) return;
  await openFolderWindow(repoUri(session, key, ""));
}

async function pickRepo(session: WorkSession, filter: (r: ReturnType<WorkSession["projectMap"]>["repositories"][number]) => boolean, title: string): Promise<string | undefined> {
  const repos = session.projectMap().repositories.filter(filter);
  if (!repos.length) throw new UserFacingError("No repository applies.");
  if (repos.length === 1) return repos[0]!.key;
  return (await vscode.window.showQuickPick(repos.map(r => ({ label: r.label, description: r.remote, detail: r.detail, key: r.key })), { title }))?.key;
}

// ------------------------------------------------------------------ repositories

async function cloneRepository(session: WorkSession, repoKey?: string): Promise<void> {
  const map = session.projectMap();
  const key = repoKey ?? await pickRepo(session, r => r.state === "unbound" && !!r.remoteUrl, "Clone which repository?");
  const r = map.repositories.find(x => x.key === key);
  if (!r?.remoteUrl) throw new UserFacingError("This repository has no remote URL to clone from.");
  const root = requireRoot(session.root);
  const parent = path.dirname(root.fsPath);
  const where = await vscode.window.showQuickPick([
    { label: `Next to this project (${parent})`, id: "sibling" },
    { label: "Choose another folder…", id: "choose" }
  ], { title: `Clone ${r.remote}`, placeHolder: "DataPass finds clones placed next to the project automatically" });
  if (!where) return;
  let target = parent;
  if (where.id === "choose") {
    const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: "Parent folder for the clone", defaultUri: vscode.Uri.file(parent) });
    if (!picked?.[0]) return;
    target = picked[0].fsPath;
  }
  if (!(await confirmModal(`Clone ${r.remote}?`, `Into ${target}. VS Code's Git clone runs (it may ask you to sign in to GitHub). Nothing is pushed and no other repository changes.`, "Clone"))) return;
  // VS Code's own Git command handles authentication; the clone lands in <target>/<repository name>.
  await vscode.commands.executeCommand("git.clone", r.remoteUrl, target);
  const name = (r.remote ?? "").split("/").pop();
  if (name && where.id === "choose") {
    const folder = path.join(target, name);
    try { await vscode.workspace.fs.stat(vscode.Uri.file(folder)); await session.setLocalBinding(r.key, folder); return; } catch { /* the user may have cancelled */ }
  }
  await session.refresh();
}

async function locateRepository(session: WorkSession, repoKey?: string): Promise<void> {
  const map = session.projectMap();
  const key = repoKey ?? await pickRepo(session, x => x.state !== "local" && x.state !== "planned", "Locate which repository?");
  const r = map.repositories.find(x => x.key === key);
  if (!r) return;
  const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: `Where is ${r.label} cloned?` });
  if (!picked?.[0]) return;
  const folder = picked[0].fsPath;
  if (vscode.workspace.isTrusted) {
    const origin = await gitRunner(["config", "--get", "remote.origin.url"], folder, 5000);
    const url = origin.ok ? origin.stdout.trim() : "";
    if (r.remoteUrl && url && !sameRemote(url, r.remoteUrl)) throw new UserFacingError(`That folder's origin is ${url.replace(/\/\/[^@/]+@/, "//")}, not ${r.remote}. DataPass does not trust a folder name.`);
    if (r.remoteUrl && !url && !(await confirmModal("That folder has no Git origin.", `DataPass cannot confirm it is ${r.remote}. Use it anyway?`, "Use this folder"))) return;
  }
  await session.setLocalBinding(r.key, folder);
  void vscode.window.showInformationMessage(`${r.label} is located at ${path.basename(folder)} (saved in ${LOCAL_DIR}, never committed).`);
}

async function checkForUpdates(session: WorkSession, repoKey?: string): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new UserFacingError("Restricted Mode: trust this workspace before DataPass runs Git.");
  const repos = session.projectMap().repositories.filter(r => r.state === "local" && (!repoKey || r.key === repoKey) && r.git?.upstream);
  if (!repos.length) throw new UserFacingError(repoKey ? "This repository is not cloned or has no upstream branch." : "No cloned repository with an upstream branch to check.");
  const results: string[] = [];
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "DataPass: checking the remotes (git fetch, nothing is merged)" }, async progress => {
    for (const r of repos) {
      progress.report({ message: r.label });
      const f = await session.fetchRepository(r.key);
      if (!f.ok) results.push(`${r.label}: could not fetch (${f.detail})`);
    }
  });
  await session.refresh();
  const after = session.projectMap().repositories.filter(r => repos.some(x => x.key === r.key));
  const behind = after.filter(r => (r.git?.behind ?? 0) > 0);
  const lines = [...results, ...after.map(r => `${r.label}: ${describeVerdict(syncVerdict(r.git))}`)];
  report("Check for updates", [...lines, "Nothing was merged. Use Get updates to fast-forward after reviewing the commits."]);
  if (!behind.length) { void vscode.window.showInformationMessage(`Everything is up to date (${after.length} repositor${after.length === 1 ? "y" : "ies"} checked).`); return; }
  const commits = await session.incomingCommits(behind[0]!.key);
  const choice = await vscode.window.showInformationMessage(
    `${behind.map(r => `${r.label}: ${r.git!.behind} new commit(s)`).join(" · ")}${commits[0] ? ` — latest: "${commits[0].subject}"` : ""}`,
    "Get updates", "Show details");
  if (choice === "Get updates") await getUpdates(session, behind.length === 1 ? behind[0]!.key : undefined);
  else if (choice === "Show details") await vscode.commands.executeCommand("workbench.view.scm");
}

async function getUpdates(session: WorkSession, repoKey?: string): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new UserFacingError("Restricted Mode: trust this workspace before DataPass runs Git.");
  const key = repoKey ?? await pickRepo(session, r => r.state === "local" && (r.git?.behind ?? 0) > 0, "Get updates for which repository?");
  const before = session.projectMap();
  const r = before.repositories.find(x => x.key === key);
  if (!r) return;
  const verdict = syncVerdict(r.git);
  if (verdict.kind !== "can-fast-forward") {
    const go = await vscode.window.showWarningMessage(`${r.label}: ${describeVerdict(verdict)}.`, "Open Source Control");
    if (go) await vscode.commands.executeCommand("workbench.view.scm");
    return;
  }
  const commits = await session.incomingCommits(r.key);
  const detail = [
    ...commits.slice(0, 12).map(c => `• ${c.subject} — ${c.author}, ${c.date.slice(0, 10)}`),
    commits.length > 12 ? `… and ${commits.length - 12} more` : "",
    "",
    "Fast-forward only: your branch moves to these commits. Nothing is pushed, merged or rebased; your untracked files stay. Reviews and results of changed components will have to be redone."
  ].filter(l => l !== "").join("\n");
  if (!(await confirmModal(`Get ${verdict.behind} commit(s) into ${r.label}?`, detail, "Get updates"))) return;
  const result = await session.fastForward(r.key);
  if (!result.ok) throw new UserFacingError(`${r.label}: ${result.detail}. Nothing was changed; use Source Control.`);
  await session.refresh();
  const map = session.projectMap();
  const changed = changedComponents(map, r.key, result.changed);
  const newlyFound = changed.flatMap(cc => {
    const now = map.components.find(x => x.id === cc.id);
    const was = before.components.find(x => x.id === cc.id);
    return (now?.artifacts?.files ?? []).filter(f => f.state === "found" && was?.artifacts?.files.find(w => w.repoPath === f.repoPath)?.state === "missing").map(f => `${f.path} (${cc.label})`);
  });
  report(`Updates for ${r.label}`, [
    `${result.changed.length} file(s) changed.`,
    ...changed.map(cc => `Component ${cc.label}: ${cc.files.slice(0, 8).join(", ")}${cc.files.length > 8 ? "…" : ""}`),
    newlyFound.length ? `Now present: ${newlyFound.join(", ")}` : "",
    "Reviews and recorded results of changed components now show as needing a new review / stale."
  ].filter(Boolean));
  void vscode.window.showInformationMessage(`${r.label} updated: ${result.changed.length} file(s)${newlyFound.length ? `; now present: ${newlyFound.slice(0, 3).join(", ")}${newlyFound.length > 3 ? "…" : ""}` : ""}.`);
}

// ------------------------------------------------------------------ native tools

async function showExtension(extensionId?: string): Promise<void> {
  if (!extensionId || !/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*$/i.test(extensionId)) throw new UserFacingError("Invalid extension id.");
  // Opens the Extensions view on that extension: you read its page and install it yourself.
  await vscode.commands.executeCommand("workbench.extensions.search", `@id:${extensionId}`);
}

async function openNativeTool(session: WorkSession, componentId?: string): Promise<void> {
  const c = selectedComponent(session, componentId);
  const provider = c.providerId ?? "";
  if (provider === "azure-data-factory") { await openExternal(vscode.Uri.parse(ADF_STUDIO)); return; }
  // CI runs live on the Git host (GitHub Actions can also be shown by its extension's view).
  if (CI_HOSTS[provider]) { await vscode.commands.executeCommand("datapass.openCiRuns", c.id); return; }
  if (provider === "grafana") return openGrafanaDashboard(session, c);
  if (provider === "fabric") { await executeGalaxyAction("fabric.open", session.extensionUri); return; }
  if (provider === "vm") {
    // A machine is reached over Remote - SSH with the alias the graph names; DataPass never holds an address or a key.
    const op = c.operations.find(o => o.capability.id === "infra.remote.ssh" && o.target?.sshHost);
    const t = sshRemoteTarget(op?.target?.sshHost, op?.target?.folder);
    if (!t) throw new UserFacingError(`${c.label}: name the machine's SSH alias (from your ~/.ssh/config) in graph.json: an operation { "capability": "infra.remote.ssh", "target": { "sshHost": "<alias>", "folder": "/home/<user>/<project>" } }.`);
    await openRemoteFolder(vscode.Uri.from({ scheme: "vscode-remote", authority: t.authority, path: t.path }));
    return;
  }
  const route = NATIVE_VIEWS[provider];
  if (!route) throw new UserFacingError(`${c.provider?.label ?? provider}: no official VS Code tool is known to DataPass. ${c.provider?.docs ? `Docs: ${c.provider.docs}` : ""}`);
  const registered = new Set(await vscode.commands.getCommands(true));
  if (registered.has(route.command)) { await vscode.commands.executeCommand(route.command); return; }
  const choice = await vscode.window.showInformationMessage(`${c.provider?.nativeTool?.label ?? "The official extension"} is not installed or not enabled.`, "Show extension");
  if (choice) await showExtension(route.extensionId);
}

/**
 * Grafana's official extension (Grafana.grafana-vscode) has no view container; its "Edit in
 * Grafana" command (grafana-vscode.openUrl, taking the file's URI) opens a dashboard JSON or YAML
 * file in its editor, connected with the URL and token set in that extension's own settings.
 */
const GRAFANA_OPEN = "grafana-vscode.openUrl";
async function openGrafanaDashboard(session: WorkSession, c: ComponentView): Promise<void> {
  const a = c.artifacts;
  const file = [a?.entry, ...(a?.files ?? [])].find(f => f && f.state === "found" && f.kind === "file" && /\.(json|ya?ml)$/i.test(f.repoPath));
  if (!a || !file) throw new UserFacingError(`${c.label}: declare the dashboard file (JSON or YAML) in graph.json artifacts; the Grafana extension opens a dashboard from its file.`);
  const registered = new Set(await vscode.commands.getCommands(true));
  if (!registered.has(GRAFANA_OPEN)) {
    const choice = await vscode.window.showInformationMessage("The Grafana extension (Grafana.grafana-vscode) is not installed or not enabled.", { detail: "It opens a dashboard file in an editor connected to your Grafana. Without it, open the dashboard in Grafana's web UI." }, "Show extension");
    if (choice) await showExtension("Grafana.grafana-vscode");
    return;
  }
  await vscode.commands.executeCommand(GRAFANA_OPEN, repoUri(session, a.repoKey, file.repoPath));
}

// ------------------------------------------------------------------ operations

async function showOperation(session: WorkSession, opKey?: string): Promise<void> {
  for (;;) {
    const { c, op } = findOperation(session, opKey);
    const r = op.result;
    const section = (title: string, items: Array<{ label: string; detail: string }>) => (items.length ? [`${title}:`, ...items.map(i => `  - ${i.label} — ${i.detail}`)] : []);
    report(`${c.label} · ${PHASE_LABELS[op.phase]}${op.environmentId ? ` (${op.environmentId})` : ""} · ${op.label}`, [
      `Status: ${r.status.toUpperCase()}`, `Next step: ${r.nextStep}`,
      `Operation ${op.capability.id} · ${op.source === "declared" ? "declared in graph.json" : `usual for ${c.artifacts?.profile.label ?? c.provider?.label ?? "this component"}`}`,
      `Action: ${op.capability.actionMode} · side effects: ${r.sideEffects.join(", ") || "none"}`,
      ...(op.target ? [`Target (declared names): ${Object.entries(op.target).map(([k, v]) => `${k}=${v}`).join(", ")}`] : []),
      ...section("Blockers", r.blockers), ...section("Unknown (could not check; not the same as missing)", r.unknowns), ...section("Configuration", r.configIssues),
      ...section("Reviews to confirm", r.pendingReviews), ...section("Optional, missing (never blocks)", r.optionalMissing), ...section("Satisfied", r.satisfied),
      ...(r.warnings.length ? ["Warnings:", ...r.warnings.map(w => `  - ${w}`)] : []),
      ...(op.command ? [`Command (you run it, from ${op.command.cwd}): ${op.command.text}`] : []),
      `Fallback: ${r.fallback}`, r.evidenceNote
    ]);
    const choices: Array<{ label: string; id: string; detail?: string }> = r.pendingReviews.map(p => ({ label: `$(eye) Confirm review: ${p.label}`, id: `review:${p.id}` }));
    if (op.command) choices.push({ label: "$(terminal) Copy the command / open a terminal there", id: "command" });
    if (op.capability.id === "generic.files.open") choices.push({ label: "$(go-to-file) Open the entry file", id: "open" });
    if (op.capability.id === "adf.studio.open") choices.push({ label: "$(link-external) Open ADF Studio", id: "adf" });
    if (op.capability.datapassActionId === "datapass.openCiRuns") choices.push({ label: "$(link-external) Open the runs", id: "ci" });
    if (!choices.length) return;
    const pick = await vscode.window.showQuickPick(choices, { title: `${op.label}: ${r.status}`, placeHolder: "Details are in the DataPass Work output" });
    if (!pick) return;
    if (pick.id.startsWith("review:")) {
      const review = op.capability.reviews.find(x => x.id === pick.id.slice("review:".length))!;
      const target = [op.environmentId ? `environment ${op.environmentId}${op.environment?.production ? " (PRODUCTION)" : ""}` : undefined, ...Object.entries(op.target ?? {}).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(", ");
      if (await confirmModal(review.prompt, `${c.label} · ${op.label}\nTarget: ${target || "as declared"}\nThis confirmation lasts for this window only and applies to this exact target and these files: if either changes, DataPass asks again.`, "I have reviewed this")) {
        session.confirmReview(r.reviewKeys[review.id]!);
      }
      continue;
    }
    if (pick.id === "command") return copyComponentCommand(session, op.key);
    if (pick.id === "open") { await vscode.commands.executeCommand("datapass.openComponentEntry", c.id); return; }
    if (pick.id === "adf") { await openExternal(vscode.Uri.parse(ADF_STUDIO)); return; }
    if (pick.id === "ci") { await vscode.commands.executeCommand("datapass.openCiRuns", c.id); return; }
    return;
  }
}

async function copyComponentCommand(session: WorkSession, opKey?: string): Promise<void> {
  const selected = opKey ? findOperation(session, opKey) : undefined;
  const pairs = selected ? [selected] : session.projectMap().components.flatMap(c => c.operations.filter(o => o.command).map(op => ({ c, op })));
  const chosen = selected ?? (await vscode.window.showQuickPick(pairs.map(p => ({ label: p.op.command!.text, description: `${p.c.label} · ${p.op.label}`, p })), { title: "Copy which command?" }))?.p;
  if (!chosen?.op.command || !chosen.c.artifacts) throw new UserFacingError("This operation has no command to copy.");
  const { c, op } = chosen;
  const folder = session.repoFolder(c.artifacts!.repoKey);
  const cwd = folder ? repoUri(session, c.artifacts!.repoKey, op.command!.cwd === "." ? "" : op.command!.cwd) : undefined;
  const choice = await vscode.window.showInformationMessage(`${op.command!.text}`, { modal: true, detail: `Run it yourself from ${c.artifacts!.root === "." ? "the repository root" : c.artifacts!.root}. It runs this project's code on your machine (${op.result.sideEffects.join(", ") || "no declared side effects"}).` }, "Copy command", ...(cwd ? ["Open a terminal there (not run)"] : []));
  if (choice === "Copy command") { await clipboard.writeText(op.command!.text); void vscode.window.showInformationMessage("Command copied."); }
  else if (choice && cwd) {
    const terminal = vscode.window.createTerminal({ name: `DataPass · ${c.label}`, cwd });
    terminal.show();
    // Typed, not executed: you read it and press Enter.
    terminal.sendText(op.command!.text, false);
  }
}

async function recordComponentResult(session: WorkSession, version: string, opKey?: string): Promise<void> {
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid .datapass/project.json is required.");
  const { c, op } = findOperation(session, opKey);
  const choice = await vscode.window.showQuickPick([
    { label: "$(pass) Worked", result: "worked" as QualificationResult, detail: "You ran it in the native tool and it did what it should." },
    { label: "$(error) Failed", result: "failed" as QualificationResult, detail: "It did not work; say what happened in the note." },
    { label: "$(debug-pause) Not tried", result: "not-tried" as QualificationResult, detail: "Skipped for now." }
  ], { title: `Result: ${c.label} · ${op.label}${op.environmentId ? ` (${op.environmentId})` : ""}`, placeHolder: "What happened when you ran it?" });
  if (!choice) return;
  const note = await vscode.window.showInputBox({ title: `Note: ${op.label}`, prompt: "Optional: error message or what you saw. No passwords or tokens.", validateInput: v => v.length > MAX_NOTE ? `Keep it under ${MAX_NOTE} characters.` : undefined });
  if (note === undefined) return;
  await session.recordQualification({
    capabilityId: op.capability.id, label: `${c.label}: ${op.label}`, result: choice.result, note: cleanNote(note),
    projectId: manifest.project.id, scopeId: "project", preflight: op.result.status, at: new Date().toISOString(), dataPassVersion: version,
    tools: toolSnapshot([...new Set(op.capability.requirements.flatMap(r => r.anyOf))], session.toolObservations()),
    operationKey: op.key, componentId: c.id, environment: op.environmentId, targetDigest: op.result.targetDigest, artifactDigest: c.artifacts?.digest
  });
  void vscode.window.showInformationMessage(`Recorded: ${c.label} · ${op.label} — ${choice.result}. It stays valid for these files and this target only.`);
}

async function setProjectChecklist(session: WorkSession, key?: string): Promise<void> {
  const map = session.projectMap();
  const all = [...map.subprojects.flatMap(s => s.checklist), ...map.components.flatMap(c => c.checklist)];
  const entry = all.find(e => e.key === key);
  if (!entry) throw new UserFacingError("Unknown checklist item.");
  const labels: Record<ChecklistState, string> = { todo: "$(circle-large-outline) To do", done: "$(pass-filled) Done", blocked: "$(error) Blocked", problem: "$(warning) Problem", skipped: "$(debug-step-over) Skipped" };
  const pick = await vscode.window.showQuickPick(CHECKLIST_STATES.map(s => ({ label: labels[s], id: s, description: s === entry.state ? "current" : undefined })), { title: entry.label, placeHolder: "Your own note, not execution evidence" });
  if (!pick) return;
  let note: string | undefined;
  if (pick.id === "blocked" || pick.id === "problem" || pick.id === "skipped") {
    note = await vscode.window.showInputBox({ title: `${entry.label}: ${pick.id}`, prompt: "Short note (why / what is missing)", value: entry.note, validateInput: v => (v.length > 500 ? "Keep it under 500 characters" : undefined) });
    if (note === undefined) return;
  }
  await session.setChecklistByKey(entry.key, pick.id, note);
}

// ------------------------------------------------------------------ AI preparation pack

async function preparationPack(session: WorkSession, version: string, arg?: { componentId?: unknown; subprojectId?: unknown; question?: unknown }): Promise<void> {
  const map = session.projectMap();
  if (!map.project) throw new UserFacingError("A valid project manifest is required.");
  const sel = session.selection();
  const componentId = str(arg?.componentId) ?? (arg?.subprojectId ? undefined : sel.component);
  const subprojectId = str(arg?.subprojectId) ?? (componentId ? undefined : sel.subproject);
  if (componentId && !map.components.some(c => c.id === componentId)) throw new UserFacingError("Unknown component.");
  let question = str(arg?.question) as PackQuestion | undefined;
  if (!question || !(question in PACK_QUESTIONS)) {
    question = (await vscode.window.showQuickPick(Object.entries(PACK_QUESTIONS).map(([id, q]) => ({ label: q.label, detail: q.ask.slice(0, 140) + "…", id: id as PackQuestion })), { title: "What should ChatGPT / Claude do with this context?" }))?.id;
    if (!question) return;
  }
  const revisions: Record<string, string> = {};
  for (const r of map.repositories) if (r.state === "local" && r.git?.head) revisions[r.key] = `${r.git.branch ?? "?"}@${r.git.head.slice(0, 7)}${r.git.changes ? " (+local changes)" : ""}`;
  const pack = buildPreparationPack({
    map, componentId, subprojectId, question, dataPassVersion: version, generatedAt: new Date().toISOString(), revisions, guideUrl: GUIDE_URL,
    manifestDigest: session.project.manifestBytes ? sha256Bytes(session.project.manifestBytes).value : undefined,
    readiness: session.readiness(),
    sheet: session.project.sheet, options: session.project.options, board: session.project.board
  });
  const choice = await vscode.window.showInformationMessage(`AI preparation pack: ${pack.bytes} bytes, ${pack.sections.length} sections${pack.truncated ? ", TRUNCATED" : ""}.`, {
    modal: true, detail: `Sections: ${pack.sections.join(", ")}\nNever included: ${pack.omissions.join(", ")}.\nPaste it into ChatGPT or Claude yourself; nothing is sent by DataPass.`
  }, "Copy", "Preview");
  if (choice === "Preview") { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: pack.text, language: "markdown" }), { preview: true }); return; }
  if (choice !== "Copy") return;
  await clipboard.writeText(pack.text);
  await session.recordExchange({ id: newLocalId("pack"), kind: "ai-context", label: `AI pack (${question}): ${componentId ?? subprojectId ?? "project"}`, status: "copied", digest: sha256Bytes(pack.text).value, scopeRef: session.model().scope.id, at: new Date().toISOString() });
  void vscode.window.showInformationMessage("Copied. Paste it into ChatGPT or Claude; when the AI's pull request is merged, use Check for updates.");
}

// ------------------------------------------------------------------ docs, graph, guide

async function openDoc(session: WorkSession, doc: unknown): Promise<void> {
  const d = doc as { label?: unknown; path?: unknown; url?: unknown; repoKey?: unknown } | null;
  const url = str(d?.url), p = str(d?.path), repoKey = str(d?.repoKey);
  const known = [...session.projectMap().docs, ...session.projectMap().subprojects.flatMap(s => s.docs), ...session.projectMap().components.flatMap(c => c.docs)];
  // Only documents the project declares can be opened this way.
  const match = known.find(k => (url && k.url === url) || (p && k.path === p && (k.repoKey ?? "") === (repoKey ?? "")));
  if (!match) throw new UserFacingError("This document is not declared by the project.");
  if (match.url) {
    if (!/^https:\/\//.test(match.url)) throw new UserFacingError("Only https documents open in the browser.");
    if (!session.linkConfirmed(match.url)) {
      if (!(await confirmModal(`Open ${new URL(match.url).host}?`, `${match.label}\n${match.url}\n\nThis address comes from the project files.`, "Open"))) return;
      session.confirmLink(match.url);
    }
    await openExternal(vscode.Uri.parse(match.url));
    return;
  }
  const uri = repoUri(session, match.repoKey ?? session.projectMap().coordinationKey, match.path!);
  if (/\.md$/i.test(match.path!)) await vscode.commands.executeCommand("markdown.showPreview", uri);
  else await vscode.commands.executeCommand("vscode.open", uri);
}

async function openGraph(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const rel = session.project.manifest?.graph ?? ".datapass/graph.json";
  const vet = vetRelativePath(rel);
  if (!vet.ok) throw new UserFacingError(`Graph path rejected: ${vet.reason}`);
  const uri = vscode.Uri.joinPath(root, ...vet.relative.split("/"));
  try { await vscode.workspace.fs.stat(uri); await vscode.window.showTextDocument(uri); } catch { await vscode.commands.executeCommand("datapass.initGraph"); }
}

async function openGuide(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.joinPath(context.extensionUri, "docs", "PREPARING_A_PROJECT.md"));
}

// ------------------------------------------------------------------ manifest upgrade, project folder, switching

async function upgradeManifest(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const ctx = session.project;
  if (!ctx.manifest || !ctx.manifestBytes) throw new UserFacingError("No valid manifest to upgrade.");
  if (ctx.manifest.schemaVersion >= LATEST_MANIFEST_VERSION) { void vscode.window.showInformationMessage(`The manifest is already schemaVersion ${LATEST_MANIFEST_VERSION}.`); return; }
  const next = migrateManifestToLatest(ctx.manifest);
  const errors = validateProjectManifest(next);
  if (errors.length) throw new UserFacingError(`The upgrade would produce an invalid manifest: ${errors.join("; ")}`);
  const fs = workspaceJournalFs(root);
  let backup = `.datapass/project.v${ctx.manifest.schemaVersion}.json`;
  if (await fs.read(backup)) backup = `.datapass/project.v${ctx.manifest.schemaVersion}.${Date.now().toString(36)}.json`;
  if (!(await confirmModal(`Upgrade .datapass/project.json to schemaVersion ${LATEST_MANIFEST_VERSION}?`, `A copy of the current file goes to ${backup}. Every field is kept.${ctx.manifest.schemaVersion < 3 ? " v3 adds environments, project docs, planned repositories and a default repository per sub-project." : ""} v4 adds localEnv (the env files and variable names the project needs, never values) and identifiers (explicitly non-secret ids). Older DataPass versions will refuse a v${LATEST_MANIFEST_VERSION} file.`, "Upgrade"))) return;
  const id = newLocalId(`migrate-v${LATEST_MANIFEST_VERSION}`);
  await applyWithJournal(fs, `${LOCAL_DIR}/journal/${id}.json`, id, new Date().toISOString(), [
    { target: backup, bytes: ctx.manifestBytes, expectedBaseHash: null },
    { target: DATAPASS_MANIFEST_PATH, bytes: jsonBytes(next), expectedBaseHash: sha256Bytes(ctx.manifestBytes).value }
  ]);
  await session.refresh();
  await vscode.window.showTextDocument(vscode.Uri.joinPath(root, ".datapass", "project.json"));
}

async function selectProjectFolder(session: WorkSession): Promise<void> {
  const candidates = session.projectRootCandidates();
  if (candidates.length < 2) { void vscode.window.showInformationMessage(candidates.length ? "Only one folder of this window holds a DataPass project." : "No folder of this window holds .datapass/project.json."); return; }
  const pick = await vscode.window.showQuickPick(candidates.map(u => ({ label: path.basename(u.fsPath), description: u.fsPath, u, picked: u.toString() === session.root?.toString() })), { title: "Which folder is the DataPass project of this window?" });
  if (pick) await session.chooseProjectRoot(pick.u);
}

/**
 * DataPass projects this machine knows: entries of the catalogs (this project's, and the
 * `datapass.catalogs` setting's) with their local clone found by Git origin, and recently opened
 * projects. Used by Switch Project and by the company workspace file (0.17).
 */
export async function knownProjects(session: WorkSession): Promise<{ entries: ReturnType<typeof mergeCatalogs>; recent: ReturnType<WorkSession["recentProjects"]>; errors: string[] }> {
  const catalogs: Array<{ source: string; catalog: Catalog }> = [];
  const errors: string[] = [];
  const read = async (uri: vscode.Uri, source: string) => {
    try { const c = parseCatalog(await vscode.workspace.fs.readFile(uri)); catalogs.push({ source: c.title ?? source, catalog: c }); }
    catch (e) { if (!(e instanceof vscode.FileSystemError)) errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  if (session.root) await read(vscode.Uri.joinPath(session.root, ...CATALOG_PATH.split("/")), "this project's catalog");
  for (const p of (vscode.workspace.getConfiguration("datapass").get<string[]>("catalogs") ?? []).filter(x => typeof x === "string" && path.isAbsolute(x)).slice(0, 10)) await read(vscode.Uri.file(p), path.basename(p));
  const recent = session.recentProjects();
  const clones: Array<{ folder: string; originUrl?: string }> = [];
  if (vscode.workspace.isTrusted) {
    for (const r of recent.slice(0, 30)) {
      const o = await gitRunner(["config", "--get", "remote.origin.url"], r.folder, 5000);
      clones.push({ folder: r.folder, originUrl: o.ok ? o.stdout.trim() : undefined });
    }
  }
  return { entries: mergeCatalogs(catalogs, clones), recent, errors };
}

async function switchProject(session: WorkSession): Promise<void> {
  const { entries, recent, errors } = await knownProjects(session);
  type Item = vscode.QuickPickItem & { folder?: string; url?: string };
  const items: Item[] = [];
  if (entries.length) items.push({ label: "From your catalogs", kind: vscode.QuickPickItemKind.Separator });
  for (const e of entries) items.push({ label: e.title, description: [e.organization, e.localFolder ? "cloned here" : "not cloned"].filter(Boolean).join(" · "), detail: e.description ?? e.remote, folder: e.localFolder, url: e.localFolder ? undefined : e.repository.url });
  const catalogFolders = new Set(entries.map(e => e.localFolder).filter(Boolean));
  const others = recent.filter(r => !catalogFolders.has(r.folder) && path.resolve(r.folder) !== path.resolve(session.root?.fsPath ?? ""));
  if (others.length) items.push({ label: "Recently opened", kind: vscode.QuickPickItemKind.Separator });
  for (const r of others) items.push({ label: r.title, description: path.basename(r.folder), detail: `last opened ${r.at.slice(0, 10)}`, folder: r.folder });
  if (errors.length) report("Project catalogs", errors);
  if (!items.length) {
    void vscode.window.showInformationMessage("No other project yet. Add a catalog (.datapass/catalog.json in a hub repository, or the datapass.catalogs setting) or open another project folder once.");
    return;
  }
  const pick = await vscode.window.showQuickPick(items, { title: "Switch DataPass project", placeHolder: "Opens the project in a new window" });
  if (!pick) return;
  if (pick.folder) { await openFolderWindow(vscode.Uri.file(pick.folder)); return; }
  if (pick.url && (await confirmModal(`${pick.label} is not cloned here.`, `Clone ${pick.url} with VS Code's Git clone? You choose the folder.`, "Clone"))) await vscode.commands.executeCommand("git.clone", pick.url);
}

