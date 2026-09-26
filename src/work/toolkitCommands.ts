/**
 * 0.23 toolkit commands: open the Toolkit view, open a tool's page, copy an install command or a
 * recipe step, open a toolkit file. Arguments come from the Workbench webview and name a tool or a
 * recipe by id and an index; the address or the command is rebuilt from the catalogue and checked
 * again here. DataPass installs nothing and runs nothing from the toolkit: commands are copied.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import type { WorkbenchHost } from "../views/workbench";
import { confirmModal, guarded, UserFacingError } from "./io";
import { clipboard } from "../core/clipboard";
import { openExternal } from "../core/external";
import { installLines, linkIssue } from "../core/toolkit/toolkit";
import { LINK_LABELS, type ToolLinkId } from "../views/toolkitState";
import { toolkitFileUri } from "./toolkitFiles";

const str = (v: unknown, max = 120) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100 ? v : undefined);
const arg = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});

export function registerToolkitCommands(context: vscode.ExtensionContext, session: WorkSession, host: WorkbenchHost): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.openToolkit", async (focus?: unknown) => { host.openPanel(vscode.ViewColumn.Active, "toolkit", str(focus)); });
  reg("datapass.toolkit.openLink", async (a?: unknown) => openToolLink(session, str(arg(a).tool), str(arg(a).link, 20) as ToolLinkId | undefined));
  reg("datapass.toolkit.copyInstall", async (a?: unknown) => copyInstall(session, str(arg(a).tool), int(arg(a).index)));
  reg("datapass.toolkit.copyStep", async (a?: unknown) => recipeStep(session, arg(a), "copy"));
  reg("datapass.toolkit.openStep", async (a?: unknown) => recipeStep(session, arg(a), "open"));
  reg("datapass.toolkit.openFile", async (a?: unknown) => {
    const uri = toolkitFileUri(session.root, str(arg(a).path, 600) ?? "");
    if (!uri) throw new UserFacingError("Unknown toolkit file.");
    await vscode.window.showTextDocument(uri, { preview: true });
  });
}

async function openUrl(session: WorkSession, url: string, what: string): Promise<void> {
  const why = linkIssue(url);
  if (why) throw new UserFacingError(`Refusing this link: it ${why}.`);
  if (!session.linkConfirmed(url)) {
    if (!(await confirmModal(`Open ${new URL(url).host}?`, `${what}\n${url}\n\nThis address comes from the toolkit catalogue (a hub file or DataPass's baseline). DataPass sends nothing to it.`, "Open"))) return;
    session.confirmLink(url);
  }
  await openExternal(vscode.Uri.parse(url, true));
}

async function openToolLink(session: WorkSession, toolId: string | undefined, link: ToolLinkId | undefined): Promise<void> {
  const t = toolId ? session.catalogue().tools.get(toolId) : undefined;
  if (!t || !link || !(link in LINK_LABELS)) throw new UserFacingError("Unknown tool or link.");
  const url = link === "pricing" ? t.pricingUrl : t.links?.[link];
  if (!url) throw new UserFacingError(`${t.label} has no ${LINK_LABELS[link].toLowerCase()} in the catalogue.`);
  await openUrl(session, url, `${t.label} — ${LINK_LABELS[link]}${link === "pricing" && t.checkedAt ? ` (prices read on ${t.checkedAt})` : ""}`);
}

async function copyInstall(session: WorkSession, toolId: string | undefined, index: number | undefined): Promise<void> {
  const t = toolId ? session.catalogue().tools.get(toolId) : undefined;
  const line = t && index !== undefined ? installLines(t, process.platform)[index] : undefined;
  if (!t || !line?.copy) throw new UserFacingError("Unknown install command.");
  await clipboard.writeText(line.copy);
  void vscode.window.showInformationMessage(`Copied: ${line.copy}. DataPass installs nothing: run it yourself${t.source === "hub" ? " (it comes from the hub's toolkit: read it first)" : ""}.`);
}

async function recipeStep(session: WorkSession, a: Record<string, unknown>, what: "copy" | "open"): Promise<void> {
  const r = session.catalogue().recipes.get(str(a.recipe) ?? "");
  const route = r?.routes.find(x => x.id === str(a.route));
  const i = int(a.step);
  const step = route && i !== undefined ? route.steps[i] : undefined;
  if (!r || !step || typeof step === "string") throw new UserFacingError("Unknown recipe step.");
  if (what === "copy") {
    if (!step.copy) throw new UserFacingError("This step has nothing to copy.");
    await clipboard.writeText(step.copy);
    void vscode.window.showInformationMessage(`Copied: ${step.copy}. Replace the <placeholders> and run it yourself; DataPass runs nothing from a recipe.`);
    return;
  }
  if (!step.open) throw new UserFacingError("This step has no page to open.");
  await openUrl(session, step.open, `${r.title} — ${step.text}`);
}
