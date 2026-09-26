/**
 * 0.16 Git host commands: open a repository's pages on GitHub, Azure DevOps or GitLab (the
 * repository, its pull requests, its pipelines, its boards or issues), and the runs of a CI
 * component. URLs are built from the repository's remote (declared in project.json, else the
 * clone's origin) by core/project/gitHosts.ts; each one is shown and confirmed once per window
 * before core/external.ts opens it. Nothing is sent to the hosts, no API is called.
 *
 * When the official extension's view container is registered (GitHub Pull Requests
 * "github-pull-requests", GitHub Actions "github-actions", both read from their package.json on
 * 2026-09-25), the person can open it instead. Azure Pipelines and GitLab Workflow have no such
 * view for runs, and Microsoft's Azure Boards extension was archived in 2023: their pages open on the web.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { confirmModal, guarded, UserFacingError } from "./io";
import { openExternal } from "../core/external";
import { GIT_HOST_LABELS, gitHostOf, repositoryWebLinks, WEB_LINK_IDS, type GitHostKind, type WebLinkId } from "../core/project/gitHosts";
import type { ComponentView } from "../core/project/projectMap";
import type { RepoView } from "../core/project/resolve";

const str = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
type TreeNodeArg = { t?: string; r?: { key?: string }; c?: { id?: string } } | undefined;
const repoArg = (v: unknown) => str(v) ?? ((v as TreeNodeArg)?.t === "repo" ? str((v as TreeNodeArg)!.r?.key) : undefined);
const componentArg = (v: unknown) => str(v) ?? ((v as TreeNodeArg)?.t === "component" ? str((v as TreeNodeArg)!.c?.id) : undefined);

/** The host each CI provider runs on. */
export const CI_HOSTS: Readonly<Record<string, GitHostKind>> = { "github-actions": "github", "azure-pipelines": "azure-devops", "gitlab-ci": "gitlab" };
const VIEW_PULL_REQUESTS = "workbench.view.extension.github-pull-requests";
const VIEW_GITHUB_ACTIONS = "workbench.view.extension.github-actions";

export function registerGitHostCommands(context: vscode.ExtensionContext, session: WorkSession): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.openRepositoryWeb", async (repo?: unknown, link?: unknown) => openRepositoryWeb(session, repoArg(repo), str(link, 40) as WebLinkId | undefined));
  reg("datapass.openCiRuns", async (component?: unknown) => openCiRuns(session, componentArg(component)));
}

/** A repository's remote: declared in project.json, else the origin of its clone. A planned repository has no pages yet. */
export function remoteOf(r: RepoView): string | undefined {
  return r.state === "planned" ? undefined : r.remoteUrl ?? r.git?.originUrl;
}

/** Show the exact address once per window, then open it in the browser. */
export async function openWebPage(session: WorkSession, url: string, what: string, from: string): Promise<void> {
  if (!/^https:\/\/\S+$/.test(url)) throw new UserFacingError("Only https pages open from DataPass.");
  if (!session.linkConfirmed(url)) {
    if (!(await confirmModal(`Open ${new URL(url).host}?`, `${what}\n${url}\n\n${from} DataPass sends nothing to this site and does not check that you can see the page.`, "Open"))) return;
    session.confirmLink(url);
  }
  if (!(await openExternal(vscode.Uri.parse(url, true)))) throw new UserFacingError("The browser did not accept the link.");
}

async function openRepositoryWeb(session: WorkSession, repoKey: string | undefined, linkId: WebLinkId | undefined): Promise<void> {
  const map = session.projectMap();
  const onHost = map.repositories.filter(r => repositoryWebLinks(remoteOf(r)).length);
  let r = repoKey ? map.repositories.find(x => x.key === repoKey) : undefined;
  if (repoKey && !r) throw new UserFacingError(`Unknown repository "${repoKey}".`);
  if (!r) {
    if (!onHost.length) throw new UserFacingError("No repository of this project is on GitHub, Azure DevOps or GitLab: declare its remote.url in project.json.");
    r = onHost.length === 1 ? onHost[0] : (await vscode.window.showQuickPick(onHost.map(x => ({ label: x.label, description: gitHostOf(remoteOf(x))?.label, detail: x.remote, r: x })), { title: "Open which repository on the web?" }))?.r;
    if (!r) return;
  }
  const url = remoteOf(r);
  const host = gitHostOf(url);
  const links = repositoryWebLinks(url);
  if (r.state === "planned") throw new UserFacingError(`${r.label} is planned: the repository does not exist yet, so it has no pages to open.`);
  if (!host || !links.length) throw new UserFacingError(`${r.label}: ${url ? "its remote is not on GitHub, Azure DevOps or GitLab" : "no remote is declared or observed"}, so DataPass cannot build its web pages.`);
  let link = linkId && WEB_LINK_IDS.includes(linkId) ? links.find(l => l.id === linkId) : undefined;
  if (!link) {
    const registered = new Set(await vscode.commands.getCommands(true));
    const inVsCode: Array<{ label: string; description: string; command: string }> = [];
    if (host.kind === "github" && registered.has(VIEW_PULL_REQUESTS)) inVsCode.push({ label: "$(git-pull-request) Pull requests and issues in VS Code", description: "GitHub Pull Requests extension", command: VIEW_PULL_REQUESTS });
    if (host.kind === "github" && registered.has(VIEW_GITHUB_ACTIONS)) inVsCode.push({ label: "$(github-action) Workflow runs in VS Code", description: "GitHub Actions extension", command: VIEW_GITHUB_ACTIONS });
    const pick = await vscode.window.showQuickPick<vscode.QuickPickItem & { link?: typeof links[number]; command?: string }>([
      ...links.map(l => ({ label: `$(link-external) ${l.label}`, description: host.label, detail: l.url, link: l })),
      ...inVsCode
    ], { title: `${r.label} on ${host.label}`, placeHolder: "Opens in your browser after you see the address" });
    if (!pick) return;
    if (pick.command) { await vscode.commands.executeCommand(pick.command); return; }
    link = pick.link!;
  }
  await openWebPage(session, link.url, `${link.label} of ${r.label} on ${host.label}`, "Built from the repository's remote address (project.json, or the clone's origin).");
}

async function ciComponent(session: WorkSession, id: string | undefined): Promise<ComponentView | undefined> {
  const map = session.projectMap();
  if (id) {
    const c = map.components.find(x => x.id === id);
    if (!c) throw new UserFacingError(`Unknown component "${id}".`);
    return c;
  }
  const ci = map.components.filter(c => c.providerId && CI_HOSTS[c.providerId]);
  if (!ci.length) throw new UserFacingError("No CI component in graph.json (provider github-actions, azure-pipelines or gitlab-ci).");
  if (ci.length === 1) return ci[0]!;
  return (await vscode.window.showQuickPick(ci.map(c => ({ label: c.label, description: c.provider?.label, c })), { title: "Open the runs of which pipeline?" }))?.c;
}

async function openCiRuns(session: WorkSession, componentId: string | undefined): Promise<void> {
  const c = await ciComponent(session, componentId);
  if (!c) return;
  const expected = c.providerId ? CI_HOSTS[c.providerId] : undefined;
  if (!expected) throw new UserFacingError(`${c.label} is not a CI component (GitHub Actions, Azure Pipelines or GitLab CI/CD).`);
  const repo = session.projectMap().repositories.find(r => r.key === c.repoKey);
  const url = repo ? remoteOf(repo) : undefined;
  const host = gitHostOf(url);
  if (c.providerId === "github-actions") {
    const registered = new Set(await vscode.commands.getCommands(true));
    if (registered.has(VIEW_GITHUB_ACTIONS)) {
      const choice = await vscode.window.showQuickPick([
        { label: "$(github-action) In VS Code", description: "GitHub Actions extension", id: "view" },
        ...(host?.kind === "github" ? [{ label: "$(link-external) On github.com", description: "Actions page of the repository", id: "web" }] : [])
      ], { title: `Runs of ${c.label}` });
      if (!choice) return;
      if (choice.id === "view") { await vscode.commands.executeCommand(VIEW_GITHUB_ACTIONS); return; }
    }
  }
  if (!host || host.kind !== expected) {
    const docs = c.docs.filter(d => d.url);
    const choice = await vscode.window.showInformationMessage(`${c.label}: where are its runs?`, {
      modal: true,
      detail: `${repo ? `Its repository (${repo.remote ?? repo.label})` : "Its repository"} is ${host ? `on ${host.label}` : "not on a Git host DataPass knows"}, not on ${GIT_HOST_LABELS[expected]}, so DataPass cannot build the address of its runs (an Azure pipeline can build a GitHub repository, for example). Add the page to the component's docs in graph.json: { "label": "Pipeline runs", "url": "https://…" }.`
    }, ...docs.slice(0, 2).map(d => d.label));
    const doc = docs.find(d => d.label === choice);
    if (doc) await vscode.commands.executeCommand("datapass.openDoc", doc);
    return;
  }
  const link = repositoryWebLinks(url).find(l => l.id === "pipelines")!;
  await openWebPage(session, link.url, `${link.label} of ${c.label} (${host.label})`, "Built from the repository's remote address.");
}
