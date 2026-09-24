/**
 * Optional companion apps for the selected scope (see src/core/companions/companions.ts):
 *
 *   Open Companion Link…        Grafana home / Explore / declared dashboards, Mongoku project page
 *   Import Mongoku Context…     Mongoku "Developer context" JSON → private dated snapshot
 *   Set Mongoku Address…        the datapass.mongoku.url user setting
 *   vscode://julian-passebecq.datapass-vscode/open?entity=<id>
 *                               Mongoku → DataPass: select the scope mapped to that entity
 *
 * No HTTP request, database connection, polling or credential. Opening a link shows its exact
 * destination once per window, then re-resolves it from current state before opening, so a
 * manifest, setting or scope change during review is refused rather than followed.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { confirmModal, guarded, readJsonInput, requireRoot, UserFacingError } from "./io";
import { openExternal } from "../core/external";
import { safeAppUrl } from "../core/model/safeUrl";
import { newLocalId, sha256Bytes } from "../core/model/ids";
import { parseStrictJson } from "../core/model/strictJson";
import { writeLocal } from "../core/workspace/loader";
import {
  MAX_MONGOKU_CONTEXT_BYTES, PORTABLE_ID, companionLinks, mongokuBaseFrom, mongokuEntityFor, parseMongokuContext, scopesForEntity,
  type CompanionLink
} from "../core/companions/companions";

const MONGOKU_URL_SETTING = "mongoku.url";
const SERVICE_NAME: Record<CompanionLink["service"], string> = { grafana: "Grafana", mongoku: "Mongoku" };

/** Returns the URI handler so the Test-mode API can drive it without VS Code's own "open URI?" prompt. */
export function registerCompanionCommands(context: vscode.ExtensionContext, session: WorkSession): { handleUri(uri: vscode.Uri): Promise<void> } {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.openCompanionLink", async (linkId?: unknown) => openCompanionLink(session, typeof linkId === "string" ? linkId : undefined));
  reg("datapass.mongoku.importContext", async () => importMongokuContext(session));
  reg("datapass.mongoku.setUrl", async () => { await askMongokuUrl(session); });
  const handle = guarded(async (uri: vscode.Uri) => handleOpenUri(session, uri));
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: uri => handle(uri) }));
  return { handleUri: handle };
}

// ------------------------------------------------------------ links

async function openCompanionLink(session: WorkSession, linkId?: string): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new UserFacingError("Trust this workspace before opening links from its project manifest.");
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid .datapass/project.json is required.");
  const scope = session.model().scope;
  const resolved = session.companions();
  const links = companionLinks(resolved);
  let link: CompanionLink | undefined;
  if (linkId) {
    link = links.find(l => l.id === linkId);
    if (!link && linkId === "mongoku.entity" && resolved.mongoku?.needsUrl) {
      if (!(await askMongokuUrl(session))) return;
      link = companionLinks(session.companions()).find(l => l.id === linkId);
    }
    if (!link) throw new UserFacingError("That link is not configured for the selected scope.");
  } else {
    if (!links.length) throw new UserFacingError(`No companion links for "${scope.title}". Add platforms.grafana.url or companions.mongoku to .datapass/project.json.`);
    const pick = await vscode.window.showQuickPick(links.map(l => ({ label: l.label, description: SERVICE_NAME[l.service], detail: l.url, link: l })), {
      title: `Open companion · ${scope.title}`, placeHolder: "Opens in your browser. DataPass does not check access or service health."
    });
    if (!pick) return;
    link = pick.link;
  }

  if (!session.linkConfirmed(link.url)) {
    const service = SERVICE_NAME[link.service];
    const ok = await confirmModal(`Open ${service} in your browser?`, [
      `Project: ${manifest.project.title} (${manifest.project.id})`,
      `Scope: ${scope.title}`,
      "",
      link.url,
      "",
      "This address comes from the project manifest or your settings. DataPass adds no project data or credentials to it and does not check that the service is reachable, that you are signed in, or that its data is current.",
      "You will not be asked again for this exact address in this window."
    ].join("\n"), "Open");
    if (!ok) return;
    // Re-resolve from fresh state: a manifest, setting or scope change during review is refused.
    await session.refresh();
    const current = companionLinks(session.companions()).find(l => l.id === link!.id);
    if (session.model().scope.id !== scope.id || current?.url !== link.url) {
      throw new UserFacingError("The link or the selected scope changed while you were reviewing it. Open it again to review the new destination.");
    }
    session.confirmLink(link.url);
  }
  if (!(await openExternal(vscode.Uri.parse(link.url, true)))) throw new UserFacingError("The browser did not accept the link.");
}

async function askMongokuUrl(session: WorkSession): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("datapass");
  const status = session.mongokuStatus();
  const suggested = (status?.state === "ok" ? mongokuBaseFrom(status.context.project.mongoku_url) : undefined) ?? safeAppUrl((config.get<string>(MONGOKU_URL_SETTING) ?? "").trim());
  const entered = await vscode.window.showInputBox({
    title: "Mongoku address",
    prompt: "Where your Mongoku runs, e.g. http://localhost:3100/ for a local dev server or its https deployment. Saved in your user settings (datapass.mongoku.url) for every project.",
    placeHolder: "http://localhost:3100/",
    value: suggested ?? "",
    ignoreFocusOut: true,
    validateInput: v => safeAppUrl(v.trim()) ? undefined : "Use https://, or http://localhost for a local server. No credentials, query or #fragment."
  });
  if (!entered) return undefined;
  const url = safeAppUrl(entered.trim())!;
  await config.update(MONGOKU_URL_SETTING, url, vscode.ConfigurationTarget.Global);
  return url;
}

// ------------------------------------------------------------ Mongoku context snapshot

async function importMongokuContext(session: WorkSession): Promise<void> {
  const root = requireRoot(session.root);
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid .datapass/project.json is required.");
  const scope = session.model().scope;
  const entity = mongokuEntityFor(manifest, scope.id);
  if (!entity) throw new UserFacingError(`"${scope.title}" is not mapped to a Mongoku project. Add companions.mongoku.entityId (or scopeEntities) to .datapass/project.json.`);
  const input = await readJsonInput(`Mongoku context for "${entity.entityId}" (Mongoku → Developer context → JSON → Copy)`, root);
  if (input.bytes.byteLength > MAX_MONGOKU_CONTEXT_BYTES) throw new UserFacingError("The Mongoku context is larger than 256 KiB. Nothing was saved.");
  let parsed;
  try {
    const value = parseStrictJson(input.bytes, { maxBytes: MAX_MONGOKU_CONTEXT_BYTES, maxDepth: 8, maxEntries: 5000, maxStringLength: 4000 });
    parsed = parseMongokuContext(value, entity.entityId, Date.now());
  } catch (error) {
    throw new UserFacingError(`Mongoku context rejected: ${error instanceof Error ? error.message : String(error)} Nothing was saved.`);
  }
  // The scope may have changed while the file dialog or clipboard read was open.
  if (session.model().scope.id !== scope.id) throw new UserFacingError("The selected scope changed during the import. Nothing was saved.");
  const file = `mongoku/${scope.id}.json`;
  await writeLocal(root, file, input.bytes);
  await session.reloadMongokuSnapshot();
  const id = newLocalId("mongoku");
  await session.recordExchange({ id, kind: "authority-snapshot", label: `Mongoku context: ${parsed.project.name}`, status: "imported-snapshot", file: `.datapass/local/${file}`, digest: sha256Bytes(input.bytes).value, scopeRef: scope.id, at: new Date().toISOString() });
  const ignored = parsed.ignoredFields.length ? ` ${parsed.ignoredFields.length} unrecognised field(s) were kept but not shown.` : "";
  void vscode.window.showInformationMessage(`Mongoku context for "${parsed.project.name}" imported (generated ${parsed.generatedAt}). It is a dated snapshot, not a live view.${ignored}`);
}

// ------------------------------------------------------------ vscode://julian-passebecq.datapass-vscode/open?entity=<id>

/**
 * Mongoku → DataPass. The only accepted input is a Mongoku entity id that this window's manifest
 * already maps; the only effect is selecting that scope. Other parameters (for example a
 * `mongoku=` address) are ignored: a link from a web page never configures DataPass.
 */
async function handleOpenUri(session: WorkSession, uri: vscode.Uri): Promise<void> {
  if (uri.path !== "/open") throw new UserFacingError(`Unsupported DataPass link "${uri.path.slice(0, 40)}".`);
  const entity = new URLSearchParams(uri.query).get("entity") ?? "";
  if (!PORTABLE_ID.test(entity)) throw new UserFacingError("The link does not name a valid Mongoku project.");
  await session.refresh();
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError(`Open the project's folder in this window first: Mongoku asked to show "${entity}", and this window has no valid .datapass/project.json.`);
  const scopes = scopesForEntity(manifest, entity);
  if (!scopes.length) {
    void vscode.window.showInformationMessage(`Nothing in ${manifest.project.title} is mapped to Mongoku project "${entity}". Map it with companions.mongoku in .datapass/project.json.`);
    return;
  }
  let chosen: { id: string; title: string } | undefined = scopes[0];
  if (scopes.length > 1) {
    chosen = (await vscode.window.showQuickPick(scopes.map(s => ({ label: s.title, description: s.id, scope: s })), { title: `Mongoku project "${entity}" maps to several scopes` }))?.scope;
  }
  if (!chosen) return;
  await session.selectScope(chosen.id);
  await vscode.commands.executeCommand("datapass.work.focus");
  void vscode.window.showInformationMessage(`DataPass: showing "${chosen.title}" (opened from Mongoku).`);
}
