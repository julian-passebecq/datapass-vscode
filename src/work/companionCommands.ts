/**
 * Optional companion apps for the selected scope (see src/core/companions/companions.ts):
 *
 *   Open Companion Link…        Grafana home / Explore / declared dashboards
 *
 * No HTTP request, database connection, polling or credential. Opening a link shows its exact
 * destination once per window, then re-resolves it from current state before opening, so a
 * manifest, setting or scope change during review is refused rather than followed.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { confirmModal, guarded, UserFacingError } from "./io";
import { openExternal } from "../core/external";
import { companionLinks, type CompanionLink } from "../core/companions/companions";

const SERVICE_NAME: Record<CompanionLink["service"], string> = { grafana: "Grafana" };

export function registerCompanionCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.openCompanionLink", async (linkId?: unknown) => openCompanionLink(session, typeof linkId === "string" ? linkId : undefined));
}

// ------------------------------------------------------------ links

async function openCompanionLink(session: WorkSession, linkId?: string): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new UserFacingError("Trust this workspace before opening links from its project manifest.");
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid .datapass/project.json is required.");
  const scope = session.model().scope;
  const links = companionLinks(session.companions());
  let link: CompanionLink | undefined;
  if (linkId) {
    link = links.find(l => l.id === linkId);
    if (!link) throw new UserFacingError("That link is not configured for the selected scope.");
  } else {
    if (!links.length) throw new UserFacingError(`No companion links for "${scope.title}". Add platforms.grafana.url to .datapass/project.json.`);
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
