/**
 * Environment readiness commands (manifest v4 `localEnv` / `identifiers`):
 *
 *   Copy Variable Name          the NAME of a declared variable (never a value)
 *   Open Env File               the declared env file in the editor; a missing one can be created
 *                               with the declared names and empty values
 *   Copy Identifier             an explicitly non-secret id declared in the manifest
 *   Copy Project ID             project.id, to find the project in Power Ops
 *   Open Power Ops              the local vault app (datapass.powerOps.path); nothing is passed to it
 *   Show Readiness Report       deterministic checks, names and states only
 *
 * Every argument coming from a tree item or a webview is checked against the current manifest.
 * No command reads, copies, logs or shows an env value: secrets stay in the vault (Power Ops).
 */
import * as vscode from "vscode";
import * as path from "node:path";
import type { WorkSession } from "./session";
import { clipboard } from "../core/clipboard";
import { launchApp } from "../core/external";
import { confirmModal, guarded, UserFacingError } from "./io";
import { vetRelativePath } from "../core/exchange/pathSafety";
import { isEnvFileName } from "../core/readiness/envFile";
import { envFileId, normalizeEnvFile, readinessReport, type EnvKeyView } from "../core/readiness/readiness";
import { gitStatusOf } from "./envObserver";
import { gitRunner } from "./session";

const POWER_OPS_SETTING = "powerOps.path";

export function registerReadinessCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.env.copyKeyName", async (arg?: unknown) => copyKeyName(session, nameArg(arg)));
  reg("datapass.env.openFile", async (arg?: unknown) => openEnvFile(session, fileArg(arg)));
  reg("datapass.env.copyIdentifier", async (arg?: unknown) => copyIdentifier(session, idArg(arg)));
  reg("datapass.copyProjectId", async () => copyProjectId(session));
  reg("datapass.openPowerOps", async () => openPowerOps());
  reg("datapass.readinessReport", async () => showReport(session));
}

/** Tree items pass the key view; webviews and keybindings pass the name. */
const nameArg = (a: unknown) => typeof a === "string" ? a : (a as { name?: unknown } | undefined)?.name;
const fileArg = (a: unknown) => typeof a === "string" ? a : (a as { id?: unknown } | undefined)?.id;
const idArg = (a: unknown) => typeof a === "string" ? a : (a as { identifierId?: unknown; id?: unknown } | undefined)?.identifierId ?? (a as { id?: unknown } | undefined)?.id;

function requireManifest(session: WorkSession) {
  const m = session.project.manifest;
  if (!m) throw new UserFacingError("A valid .datapass/project.json is required.");
  return m;
}

// ------------------------------------------------------------------ variable names

async function copyKeyName(session: WorkSession, name: unknown): Promise<void> {
  const keys = session.readiness().keys;
  if (!keys.length) throw new UserFacingError("This project declares no variable names (localEnv.requiredKeys in .datapass/project.json, manifest v4).");
  let key: EnvKeyView | undefined;
  if (typeof name === "string") {
    key = keys.find(k => k.name === name);
    if (!key) throw new UserFacingError("That variable is not declared by this project.");
  } else {
    key = (await vscode.window.showQuickPick(keys.map(k => ({ label: k.name, description: k.state, k })), { title: "Copy a variable name (never its value)" }))?.k;
    if (!key) return;
  }
  await clipboard.writeText(key.name);
  const where = key.source === "identifier" ? `Its value is the non-secret id "${key.identifierLabel}" declared in the manifest.` : "Fetch its value from your local vault (Power Ops).";
  void vscode.window.showInformationMessage(`Copied the name ${key.name}. ${where}`);
}

// ------------------------------------------------------------------ env files

async function openEnvFile(session: WorkSession, id: unknown): Promise<void> {
  const m = requireManifest(session);
  const files = (m.localEnv?.files ?? []).map(normalizeEnvFile);
  if (!files.length) throw new UserFacingError("This project declares no env files (localEnv.files in .datapass/project.json, manifest v4).");
  let file = typeof id === "string" ? files.find(f => envFileId(f) === id) : undefined;
  if (typeof id === "string" && !file) throw new UserFacingError("That env file is not declared by this project.");
  if (!file) {
    const view = session.readiness().files;
    file = (await vscode.window.showQuickPick(files.map(f => ({ label: f.path, description: [f.repoRef, view.find(v => v.id === envFileId(f))?.state].filter(Boolean).join(" · "), f })), { title: "Open an env file" }))?.f;
    if (!file) return;
  }
  const vet = vetRelativePath(file.path);
  if (!vet.ok || !isEnvFileName(vet.relative)) throw new UserFacingError("Only env files (.env, .env.<name>, <name>.env, .dev.vars) can be opened from here.");
  const folder = session.envFolder(file.repoRef);
  if (!folder) throw new UserFacingError(`${file.path} belongs to repository "${file.repoRef}", which is not cloned here. Clone or locate it in the Project view first.`);
  const uri = vscode.Uri.joinPath(folder, ...vet.relative.split("/"));
  let exists = false;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.SymbolicLink) throw new UserFacingError(`${file.path} is a symbolic link; DataPass does not follow it. Open it yourself if you trust its target.`);
    exists = true;
  } catch (error) { if (error instanceof UserFacingError) throw error; }
  if (exists) { await vscode.window.showTextDocument(uri, { preview: false }); return; }
  await createEnvFile(session, file.path, vet.relative, folder, uri, session.readiness().keys);
}

/**
 * Create a missing env file with the declared NAMES and empty values, after confirmation. A name
 * already set in another declared file is written as a comment, so a later file (.env.local)
 * never blanks it.
 */
async function createEnvFile(session: WorkSession, display: string, relative: string, folder: vscode.Uri, uri: vscode.Uri, keys: readonly EnvKeyView[]): Promise<void> {
  const toFill = keys.filter(k => k.state !== "set");
  const git = vscode.workspace.isTrusted ? await gitStatusOf(gitRunner, folder.fsPath, relative) : "unknown";
  const gitNote = git === "not-ignored" || git === "tracked"
    ? `\n\nWarning: Git does not ignore ${relative} here. Add it to .gitignore before you put any value in it.`
    : git === "ignored" ? "\n\nGit ignores this file, so its values stay on this machine." : "";
  const ok = await confirmModal(`${display} does not exist. Create it?`,
    `DataPass writes the ${toFill.length} variable name(s) not set yet, with empty values${keys.length > toFill.length ? ` (the ${keys.length - toFill.length} already set elsewhere are listed as comments)` : ""}. You then fill each value from your local vault (Power Ops); DataPass never reads or stores them.${gitNote}`, "Create file");
  if (!ok) return;
  // Re-check: the file may have appeared while the dialog was open. Never overwrite.
  try { await vscode.workspace.fs.stat(uri); await vscode.window.showTextDocument(uri, { preview: false }); return; } catch { /* still missing */ }
  const project = session.project.manifest?.project.id ?? "project";
  const body = [
    `# ${relative} for ${project}: variable names declared in .datapass/project.json (localEnv).`,
    "# Fill the values from your local vault (Power Ops). Never commit this file.",
    ...keys.map(k => k.state === "set" ? `# ${k.name} is already set in ${k.definedIn[k.definedIn.length - 1]}` : `${k.name}=`)
  ].join("\n") + "\n";
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
  await session.refresh();
  await vscode.window.showTextDocument(uri, { preview: false });
}

// ------------------------------------------------------------------ identifiers, project id, Power Ops

async function copyIdentifier(session: WorkSession, id: unknown): Promise<void> {
  const m = requireManifest(session);
  const list = m.identifiers ?? [];
  if (!list.length) throw new UserFacingError("This project declares no non-secret identifiers (identifiers in .datapass/project.json, manifest v4).");
  let ident = typeof id === "string" ? list.find(d => d.id === id) : undefined;
  if (typeof id === "string" && !ident) throw new UserFacingError("That identifier is not declared by this project.");
  if (!ident) {
    ident = (await vscode.window.showQuickPick(list.map(d => ({ label: d.label, description: [d.provider, d.envKey].filter(Boolean).join(" · "), d })), { title: "Copy a non-secret identifier declared in the manifest" }))?.d;
    if (!ident) return;
  }
  // The manifest was validated on load: the value is a plain id that does not look like a credential.
  await clipboard.writeText(ident.value);
  void vscode.window.showInformationMessage(`Copied ${ident.label}${ident.envKey ? ` (for ${ident.envKey})` : ""}, a non-secret id declared in the manifest.`);
}

async function copyProjectId(session: WorkSession): Promise<void> {
  const m = requireManifest(session);
  await clipboard.writeText(m.project.id);
  void vscode.window.showInformationMessage(`Copied the project id ${m.project.id}. Search for it in Power Ops to find this project's secrets.`);
}

/** Only the user-level value counts: a workspace can never choose which program DataPass starts. */
function powerOpsPath(): string | undefined {
  const value = vscode.workspace.getConfiguration("datapass").inspect<string>(POWER_OPS_SETTING)?.globalValue?.trim();
  return value && validExecutable(value) ? value : undefined;
}

export function validExecutable(p: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!path.isAbsolute(p) || p.length > 1000 || /[\u0000-\u001f"<>|*?]/.test(p)) return false;
  return platform === "win32" ? /\.exe$/i.test(p) : true;
}

async function openPowerOps(): Promise<void> {
  let exe = powerOpsPath();
  if (!exe) {
    const picked = await vscode.window.showOpenDialog({
      title: "Where is Power Ops? (JUtilityPalette.exe) DataPass remembers it in your user settings.",
      canSelectMany: false, canSelectFolders: false, openLabel: "Use this program",
      filters: process.platform === "win32" ? { Programs: ["exe"] } : undefined
    });
    const chosen = picked?.[0]?.fsPath;
    if (!chosen) return;
    if (!validExecutable(chosen)) throw new UserFacingError("Choose the Power Ops program (an .exe file).");
    await vscode.workspace.getConfiguration("datapass").update(POWER_OPS_SETTING, chosen, vscode.ConfigurationTarget.Global);
    exe = chosen;
  }
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(exe));
    if (!(stat.type & vscode.FileType.File)) throw new Error("not a file");
  } catch {
    throw new UserFacingError(`Power Ops was not found at ${exe}. Update the datapass.powerOps.path user setting.`);
  }
  try { await launchApp(exe); } catch (error) {
    throw new UserFacingError(`Power Ops could not be started: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ------------------------------------------------------------------ report

async function showReport(session: WorkSession): Promise<void> {
  await session.refresh();
  const m = session.project.manifest;
  const text = readinessReport(session.readiness(), m ? { id: m.project.id, title: m.project.title } : undefined, new Date().toISOString());
  const doc = await vscode.workspace.openTextDocument({ content: text, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: true });
}
