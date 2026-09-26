/**
 * Manifest v5 commands: tools & versions, the ID map and connections.
 *
 *   Check Connections             az account show / databricks auth profiles / fab auth status,
 *                                 read-only, without a prompt, only when asked
 *   Copy Sign-in Command          the CLI's own sign-in command, to run yourself (it opens a browser)
 *   Open a Connection's Portal Page   where a binding DataPass cannot observe is verified
 *   Copy Install Command          the command to install a missing tool; DataPass installs nothing
 *   Show Recommended Extensions   VS Code's own list from .vscode/extensions.json; never installs
 *   Look Up an Id                 which declared identifier (and environment) a pasted id is
 *
 * Plus a hover: a declared non-secret id in any file shows its label and environment.
 *
 * Every argument coming from a tree item or a webview is checked against the current manifest.
 * Commands built from declared ids (a tenant id in `az login --tenant …`) are built at click time
 * from the manifest, never kept in a view.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { clipboard } from "../core/clipboard";
import { openExternal } from "../core/external";
import { confirmModal, guarded, UserFacingError } from "./io";
import { portalFor, signInCommand, SIGN_IN_CHECKS, CONNECTION_STATE_TEXT } from "../core/toolchain/connections";
import { idMatchText, lookupId } from "../core/toolchain/idMap";

export const SHOW_RECOMMENDED_EXTENSIONS = "workbench.extensions.action.showRecommendedExtensions";

export function registerToolchainCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.checkConnections", async () => checkConnections(session));
  reg("datapass.connections.copySignIn", async (arg?: unknown) => copySignIn(session, idOf(arg)));
  reg("datapass.connections.openPortal", async (arg?: unknown) => openPortal(session, idOf(arg)));
  reg("datapass.toolchain.copyInstall", async (arg?: unknown) => copyInstall(session, toolOf(arg)));
  reg("datapass.showRecommendedExtensions", async () => { await vscode.commands.executeCommand(SHOW_RECOMMENDED_EXTENSIONS); });
  reg("datapass.lookUpId", async (arg?: unknown) => lookUp(session, typeof arg === "string" ? arg : undefined));
  context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: "file" }, new IdHover(session)));
}

const idOf = (a: unknown) => typeof a === "string" ? a : (a as { id?: unknown } | undefined)?.id;
const toolOf = (a: unknown) => typeof a === "string" ? a : (a as { tool?: unknown } | undefined)?.tool;

function requireManifest(session: WorkSession) {
  const m = session.project.manifest;
  if (!m) throw new UserFacingError("A valid .datapass/project.json is required.");
  return m;
}

// ------------------------------------------------------------------ connections

async function checkConnections(session: WorkSession): Promise<void> {
  const m = requireManifest(session);
  const signIns = (m.connections ?? []).filter(c => c.kind === "sign-in");
  if (!signIns.length) {
    void vscode.window.showInformationMessage((m.connections ?? []).length
      ? "This project declares no sign-in to check: its bindings are declared, not checked (open their portal page from the Connections section)."
      : "This project declares no connections (connections in .datapass/project.json, manifest v5).");
    return;
  }
  const tools = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "DataPass: checking sign-ins (read-only)…" }, () => session.checkConnections());
  const views = session.readiness().connections.filter(c => c.kind === "sign-in");
  const ok = views.filter(c => c.state === "ok").length;
  const ran = tools.map(t => SIGN_IN_CHECKS[t as keyof typeof SIGN_IN_CHECKS]?.text).filter(Boolean).join(", ");
  const summary = views.map(c => `${c.label}: ${CONNECTION_STATE_TEXT[c.state]}`).join(" · ");
  const text = `${ok}/${views.length} sign-in(s) ok${ran ? ` (ran ${ran})` : ""}. ${summary}`;
  if (ok === views.length) void vscode.window.showInformationMessage(text);
  else void vscode.window.showWarningMessage(`${text}. The Connections section says what to do; DataPass never signs in for you.`);
}

async function copySignIn(session: WorkSession, id: unknown): Promise<void> {
  const m = requireManifest(session);
  const decl = typeof id === "string" ? (m.connections ?? []).find(c => c.id === id) : undefined;
  if (!decl) throw new UserFacingError("That connection is not declared by this project.");
  const view = session.readiness().connections.find(c => c.id === decl.id);
  if (!view?.signIn) throw new UserFacingError(view?.state === "not-checked-yet" ? "Check the connections first: DataPass then knows which command you need." : `${view?.label ?? decl.id} needs no sign-in command right now.`);
  await clipboard.writeText(signInCommand(decl, m.identifiers ?? [], view.signIn));
  void vscode.window.showInformationMessage(`Copied the sign-in command for ${view.label}. Run it in a terminal: it opens your browser to sign in. DataPass never signs in for you. Then run Check Connections again.`);
}

async function openPortal(session: WorkSession, id: unknown): Promise<void> {
  const m = requireManifest(session);
  const decl = typeof id === "string" ? (m.connections ?? []).find(c => c.id === id) : undefined;
  if (!decl) throw new UserFacingError("That connection is not declared by this project.");
  const url = portalFor(decl, m.identifiers ?? []);
  if (!url) throw new UserFacingError(`DataPass knows no page for ${decl.label ?? decl.id}. Add "portal" (an https page) to it in .datapass/project.json.`);
  // A page named in the project files is data: confirm it once per window, as for other project links.
  if (decl.portal && !session.linkConfirmed(url)) {
    if (!(await confirmModal(`Open ${new URL(url).host}?`, `${decl.label ?? decl.id}\n${url}\n\nThis address comes from the project files.`, "Open"))) return;
    session.confirmLink(url);
  }
  await openExternal(vscode.Uri.parse(url));
}

// ------------------------------------------------------------------ tools & versions

async function copyInstall(session: WorkSession, tool: unknown): Promise<void> {
  const entry = typeof tool === "string" ? session.readiness().toolchain.entries.find(e => e.tool === tool) : undefined;
  if (!entry) throw new UserFacingError("That tool is not in this project's toolchain.");
  if (entry.state === "unknown-tool") throw new UserFacingError(`DataPass does not know "${entry.tool}". ${entry.detail}`);
  if (entry.install?.command) {
    await clipboard.writeText(entry.install.command);
    void vscode.window.showInformationMessage(`Copied: ${entry.install.command} — run it yourself${entry.install.where ? ` in ${entry.install.where}` : " in a terminal"}. DataPass installs nothing. Then refresh the Project view.`);
    return;
  }
  if (entry.install?.docs) { await openExternal(vscode.Uri.parse(entry.install.docs)); return; }
  throw new UserFacingError(`DataPass has no install command for ${entry.label}.`);
}

// ------------------------------------------------------------------ ID map

async function lookUp(session: WorkSession, text: string | undefined): Promise<void> {
  const m = requireManifest(session);
  if (!(m.identifiers ?? []).length) throw new UserFacingError("This project declares no identifiers (identifiers in .datapass/project.json).");
  const input = text ?? await vscode.window.showInputBox({ title: "Look up an id in this project's ID map", prompt: "Paste an id (a GUID from a portal address, a workspace id…). DataPass says which declared identifier and environment it is." });
  if (!input?.trim()) return;
  const matches = lookupId(m.identifiers ?? [], input);
  if (!matches.length) { void vscode.window.showInformationMessage("That id is not in this project's ID map."); return; }
  void vscode.window.showInformationMessage(`It is ${matches.map(idMatchText).join("; ")}.`);
}

/** Hover on a declared non-secret id in any file: which identifier (and environment) it is. */
class IdHover implements vscode.HoverProvider {
  constructor(private readonly session: WorkSession) {}
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const ids = this.session.project.manifest?.identifiers;
    if (!ids?.length) return undefined;
    const range = doc.getWordRangeAtPosition(pos, /[A-Za-z0-9][A-Za-z0-9._:-]{7,127}/);
    if (!range) return undefined;
    const matches = lookupId(ids, doc.getText(range), 8);
    if (!matches.length) return undefined;
    // Labels come from the project files: shown as plain text, never as Markdown.
    const md = new vscode.MarkdownString("**DataPass ID map** — ").appendText(matches.map(idMatchText).join("; "));
    md.isTrusted = false;
    return new vscode.Hover(md, range);
  }
}
