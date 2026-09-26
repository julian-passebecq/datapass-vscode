/**
 * Shared resources (see src/core/resources/resources.ts):
 *
 *   Open Resource on its Host   Remote - SSH straight to the declared alias, in the binding's folder
 *   Copy SSH Command            `ssh <alias>` for a terminal
 *
 * Only aliases from the user's own ~/.ssh/config are used; DataPass never handles keys, users,
 * passwords or env values. Opening a folder over SSH starts a new window and nothing else.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { guarded, UserFacingError } from "./io";
import { openRemoteFolder } from "../core/external";
import { clipboard } from "../core/clipboard";
import { moduleEnabled } from "../core/modules";
import { declaredResources, remoteTarget, resourcesForScope, scopeTitles, type BindingDecl, type ResourceDecl } from "../core/resources/resources";

export function registerResourceCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.openResource", async (arg?: { resource?: unknown; binding?: unknown }) => openResource(session, arg));
  reg("datapass.copySshCommand", async (resourceId?: unknown) => copySsh(session, typeof resourceId === "string" ? resourceId : undefined));
}

function requireManifest(session: WorkSession) {
  const manifest = session.project.manifest;
  if (!manifest) throw new UserFacingError("A valid .datapass/project.json is required.");
  if (!moduleEnabled(manifest, "infrastructure")) throw new UserFacingError("The Infrastructure module is switched off for this project (DataPass: Choose Project Modules).");
  return manifest;
}

async function openResource(session: WorkSession, arg?: { resource?: unknown; binding?: unknown }): Promise<void> {
  const manifest = requireManifest(session);
  const scope = session.model().scope;
  let resource: ResourceDecl | undefined;
  let binding: BindingDecl | undefined;
  if (typeof arg?.resource === "string") {
    resource = declaredResources(manifest).find(r => r.id === arg.resource);
    binding = typeof arg.binding === "string" ? manifest.bindings?.find(b => b.id === arg.binding && b.resource === arg.resource) : undefined;
    if (!resource || (typeof arg.binding === "string" && !binding)) throw new UserFacingError("That resource or binding is not declared in this project.");
  } else {
    const choices = resourcesForScope(manifest, scope.id).filter(v => v.resource.ssh?.host).flatMap(v =>
      (v.bindings.length ? v.bindings : [undefined]).map(b => ({
        label: b ? `${v.resource.title ?? v.resource.id} · ${b.folder ?? b.id}` : v.resource.title ?? v.resource.id,
        description: v.resource.ssh!.host,
        detail: v.sharedWith.length ? `Shared with ${scopeTitles(manifest, v.sharedWith).join(", ")}` : undefined,
        resource: v.resource, binding: b
      })));
    if (!choices.length) throw new UserFacingError(`No SSH resource for "${scope.title}". Declare one in resources[] (ssh.host = an alias from your ~/.ssh/config) and bind it to this scope.`);
    const pick = choices.length === 1 ? choices[0] : await vscode.window.showQuickPick(choices, { title: `Open on its host · ${scope.title}`, placeHolder: "Opens a new VS Code window over Remote - SSH" });
    if (!pick) return;
    resource = pick.resource;
    binding = pick.binding;
  }
  const target = remoteTarget(resource, binding);
  if (!target) throw new UserFacingError(`${resource.title ?? resource.id} has no SSH alias (resources[].ssh.host).`);
  await openRemoteFolder(vscode.Uri.from({ scheme: "vscode-remote", authority: target.authority, path: target.path }));
}

async function copySsh(session: WorkSession, resourceId?: string): Promise<void> {
  const manifest = requireManifest(session);
  const withHost = declaredResources(manifest).filter(r => r.ssh?.host);
  const resource = resourceId ? withHost.find(r => r.id === resourceId)
    : withHost.length === 1 ? withHost[0]
    : (await vscode.window.showQuickPick(withHost.map(r => ({ label: r.title ?? r.id, description: r.ssh!.host, r })), { title: "Copy SSH command" }))?.r;
  if (!resource) { if (resourceId || !withHost.length) throw new UserFacingError("No SSH resource declared in this project."); return; }
  await clipboard.writeText(`ssh ${resource.ssh!.host}`);
  void vscode.window.showInformationMessage(`Copied: ssh ${resource.ssh!.host}`);
}
