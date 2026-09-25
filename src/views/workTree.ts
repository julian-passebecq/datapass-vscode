/**
 * DataPass "Work" tree: the selected scope, its next step, checklist, operation readiness,
 * affected outputs, apps, exchanges and the Programme view. Native tree (not a webview) so it
 * is keyboard/screen-reader accessible and themable.
 */
import * as vscode from "vscode";
import type { WorkSession } from "../work/session";
import type { WorkChecklistEntry, WorkOperation, WorkApp, ExchangeRecord } from "../core/work/workModel";
import type { ImpactEntry } from "../core/impact/facets";
import type { PreflightStatus } from "../core/capabilities/preflight";
import type { ProgrammeView } from "../core/programme/programme";
import { moduleEnabled, MODULES } from "../core/modules";
import { resourcesForScope, scopeTitles, type ResourceView } from "../core/resources/resources";
import { ASSET_GROUPS, describeRepo, type Asset } from "../core/inventory/inventory";
import { findQualification } from "../core/qualification/qualification";
import type { DataPassProjectManifest } from "../core/projectManifestModel";
import { ageLabel, viewMongokuContext, type CompanionLink, type MongokuStatus, type ResolvedCompanions } from "../core/companions/companions";
import { projectRoot } from "../core/workspace/root";

type Node =
  | { t: "section"; id: string; label: string; description?: string; icon: string; tooltip?: string | vscode.MarkdownString; command?: vscode.Command; collapsed?: boolean; children: () => Node[] }
  | { t: "info"; id: string; label: string; description?: string; icon?: string | [string, string]; tooltip?: string | vscode.MarkdownString; command?: vscode.Command; contextValue?: string }
  | { t: "check"; entry: WorkChecklistEntry }
  | { t: "op"; op: WorkOperation }
  | { t: "output"; entry: ImpactEntry; parent: string }
  | { t: "app"; app: WorkApp }
  | { t: "exchange"; rec: ExchangeRecord }
  | { t: "programme"; view: ProgrammeView };

const STATUS_ICON: Record<PreflightStatus, [string, string]> = {
  ready: ["pass", "testing.iconPassed"],
  blocked: ["error", "problemsErrorIcon.foreground"],
  "needs-config": ["gear", "problemsWarningIcon.foreground"],
  "needs-review": ["eye", "problemsInfoIcon.foreground"],
  unknown: ["question", "disabledForeground"],
  unsupported: ["circle-slash", "problemsErrorIcon.foreground"]
};
const CHECK_ICON: Record<WorkChecklistEntry["state"], [string, string | undefined]> = {
  todo: ["circle-large-outline", undefined],
  done: ["pass-filled", "testing.iconPassed"],
  blocked: ["error", "problemsErrorIcon.foreground"],
  problem: ["warning", "problemsWarningIcon.foreground"],
  skipped: ["debug-step-over", "disabledForeground"]
};
const IMPACT_ICON: Record<ImpactEntry["state"], [string, string | undefined]> = {
  current: ["check", "testing.iconPassed"],
  stale: ["history", "problemsWarningIcon.foreground"],
  "stale-upstream": ["arrow-up", "problemsWarningIcon.foreground"],
  "dependencies-undeclared": ["question", "disabledForeground"]
};

const icon = (id: string, color?: string) => new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);

export class WorkTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  static readonly viewType = "datapass.work";
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: vscode.Disposable;

  constructor(private readonly session: WorkSession) {
    this.sub = session.onDidChange(() => this.emitter.fire(undefined));
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.roots();
    return node.t === "section" ? node.children() : node.t === "programme" ? this.programmeChildren(node.view) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.t) {
      case "section": {
        const item = new vscode.TreeItem(node.label, node.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        item.id = node.id;
        item.description = node.description;
        item.iconPath = icon(node.icon);
        item.tooltip = node.tooltip;
        item.command = node.command;
        item.contextValue = `section.${node.id}`;
        return item;
      }
      case "info": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.id = node.id;
        item.description = node.description;
        item.tooltip = node.tooltip ?? node.label;
        if (node.icon) item.iconPath = typeof node.icon === "string" ? icon(node.icon) : icon(...node.icon);
        item.command = node.command;
        item.contextValue = node.contextValue;
        return item;
      }
      case "check": {
        const e = node.entry;
        const item = new vscode.TreeItem(e.label, vscode.TreeItemCollapsibleState.None);
        item.id = `check:${e.key}`;
        const [ic, color] = CHECK_ICON[e.state];
        item.iconPath = icon(ic, color);
        item.description = [e.state !== "todo" ? e.state : undefined, e.preflight && e.state === "todo" ? `op ${e.preflight.status}` : undefined].filter(Boolean).join(" · ");
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${esc(e.label)}** — ${e.state} *(user-reported, not execution evidence)*`);
        if (e.note) md.appendMarkdown(`\n\nNote: ${esc(e.note)}`);
        if (e.at) md.appendMarkdown(`\n\nUpdated ${e.at}`);
        if (e.preflight) md.appendMarkdown(`\n\nOperation \`${e.capabilityRef}\`: **${e.preflight.status}** — ${esc(e.preflight.nextStep)}`);
        item.tooltip = md;
        item.contextValue = e.capabilityRef ? "checklistItem.withOp" : "checklistItem";
        item.command = { command: "datapass.setChecklistState", title: "Set state", arguments: [e] };
        return item;
      }
      case "op": {
        const { capability: c, result: r } = node.op;
        const item = new vscode.TreeItem(c.label, vscode.TreeItemCollapsibleState.None);
        item.id = `op:${c.id}`;
        const [ic, color] = STATUS_ICON[r.status];
        item.iconPath = icon(ic, color);
        const projectId = this.session.project.manifest?.project.id;
        const q = projectId ? findQualification(this.session.qualification(), { projectId, scopeId: this.session.model().scope.id, capabilityId: c.id }) : undefined;
        const tested = q ? (q.result === "worked" ? " · ✓ worked" : q.result === "failed" ? " · ✗ failed" : " · not tried") : "";
        item.description = `${r.status}${c.implementation === "documented-only" ? " · native tool" : ""}${tested}`;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${esc(c.label)}** \`${c.id}\`\n\n**${r.status}** — ${esc(r.nextStep)}\n\n`);
        if (r.sideEffects.length) md.appendMarkdown(`Side effects: ${r.sideEffects.join(", ")}\n\n`);
        md.appendMarkdown(`*${esc(r.evidenceNote)}*`);
        if (q) md.appendMarkdown(`\n\nYour test: **${q.result}** on ${esc(q.at)} (DataPass ${esc(q.dataPassVersion)})${q.note ? ` — ${esc(q.note)}` : ""}`);
        item.tooltip = md;
        item.contextValue = c.datapassActionId ? "operation.actionable" : "operation";
        item.command = { command: "datapass.showPreflight", title: "Show preflight", arguments: [c.id] };
        return item;
      }
      case "output": {
        const e = node.entry;
        const item = new vscode.TreeItem(e.label, vscode.TreeItemCollapsibleState.None);
        item.id = `${node.parent}:out:${e.outputId}`;
        const [ic, color] = IMPACT_ICON[e.state];
        item.iconPath = icon(ic, color);
        item.description = e.state;
        item.tooltip = new vscode.MarkdownString(`**${esc(e.label)}** — ${e.state}\n\n${e.reasons.map(r => `- ${esc(r)}`).join("\n")}${e.state !== "current" ? "\n\nHistorical results stay valid for their original inputs; they are not current for the new revision." : ""}`);
        return item;
      }
      case "app": {
        const { app, repo, observation: o, issue } = node.app;
        const item = new vscode.TreeItem(app.label ?? app.id, vscode.TreeItemCollapsibleState.None);
        item.id = `app:${app.id}`;
        item.iconPath = icon(issue ? "warning" : app.appType === "streamlit" ? "graph" : app.appType === "react" ? "browser" : "package");
        const where = repo?.path ? "local clone" : repo?.remote?.url ? "remote-only" : "unbound";
        item.description = issue ? issue : o?.state === "observed" ? `${where} · ${o.ref}@${o.revision!.slice(0, 8)}` : `${where}${o ? ` · ${o.state}` : ""}`;
        const md = new vscode.MarkdownString(`**${esc(app.label ?? app.id)}** (${app.appType})\n\nRepository: \`${esc(app.repoRef)}\` — ${where}`);
        if (app.entrypoint) md.appendMarkdown(`\n\nEntrypoint: \`${esc(app.entrypoint)}\``);
        if (app.inputContracts?.length) md.appendMarkdown(`\n\nInputs: ${app.inputContracts.map(esc).join(", ")}`);
        if (app.outputContracts?.length) md.appendMarkdown(`\n\nOutputs: ${app.outputContracts.map(esc).join(", ")}`);
        if (o) md.appendMarkdown(`\n\nLast observation (${o.observedAt}): ${o.state}${o.revision ? ` \`${o.revision}\`` : ""}. A remote revision is not a deployment receipt.`);
        item.tooltip = md;
        item.contextValue = repo?.remote?.url ? "app.remote" : "app";
        return item;
      }
      case "exchange": {
        const r = node.rec;
        const item = new vscode.TreeItem(r.label, vscode.TreeItemCollapsibleState.None);
        item.id = `ex:${r.id}`;
        item.iconPath = icon(r.status === "quarantined" ? "shield" : r.kind === "app-request" ? "arrow-up" : r.kind === "brief" ? "book" : "arrow-down",
          r.status === "quarantined" ? "problemsErrorIcon.foreground" : undefined);
        item.description = `${r.kind} · ${r.status}`;
        item.tooltip = `${r.label}\n${r.kind} — ${r.status}\n${r.at}${r.digest ? `\nsha256 ${r.digest}` : ""}`;
        if (r.file) item.command = { command: "datapass.openExchange", title: "Open", arguments: [r.file] };
        item.contextValue = r.kind === "brief" ? "exchange.brief" : "exchange";
        return item;
      }
      case "programme": {
        const v = node.view;
        const stale = v.outputs.filter(o => o.state === "stale" || o.state === "stale-upstream").length;
        const item = new vscode.TreeItem(v.title, v.items.length || v.outputs.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.id = `prog:${v.id}`;
        item.iconPath = icon("layers");
        item.description = `${v.items.length} items · ${v.outputs.length} outputs${stale ? ` · ${stale} stale` : ""}`;
        item.tooltip = v.description ?? v.title;
        return item;
      }
    }
  }

  private roots(): Node[] {
    const s = this.session;
    const ctx = s.project;
    const m = s.model();
    const nodes: Node[] = [];

    if (!ctx.root) return [{ t: "info", id: "noroot", label: "Open a folder to use DataPass Work.", icon: "folder" }];
    if (!ctx.manifestExists) {
      return [
        { t: "info", id: "init", label: "Initialize project manifest…", icon: "add", command: { command: "datapass.initializeProjectManifest", title: "Initialize" } },
        { t: "info", id: "initfoil", label: "Initialize FOIL project manifest…", icon: "add", command: { command: "datapass.initializeFoilProjectManifest", title: "Initialize FOIL" } }
      ];
    }

    const problems = [...ctx.manifestErrors.map(e => `Manifest: ${e}`), ...(ctx.graphError ? [`Graph: ${ctx.graphError}`] : []), ...ctx.packErrors.map(e => `Pack ${e}`), ...m.problems];

    nodes.push({
      t: "section", id: "scope", label: m.scope.title, icon: "target",
      description: m.progress.total ? `${m.progress.done}/${m.progress.total}` : m.scopeSource === "implicit" ? "no scope declared" : undefined,
      tooltip: m.scope.objective ? `Objective: ${m.scope.objective}` : "Select a work scope",
      command: { command: "datapass.selectScope", title: "Select scope" },
      children: () => [
        ...(m.scope.objective ? [{ t: "info" as const, id: "objective", label: m.scope.objective, icon: "milestone", description: "objective" }] : []),
        { t: "info", id: "next", label: m.nextStep, icon: "arrow-right", description: "next", tooltip: m.nextStep },
        ...(ctx.manifest ? [{
          t: "info" as const, id: "modules", icon: "extensions", description: "modules · change…",
          label: MODULES.filter(mod => moduleEnabled(ctx.manifest, mod.id)).map(mod => mod.label.split(" (")[0]).join(" · ") || "No module enabled",
          tooltip: "Modules this project uses. Click to switch modules on or off (writes the modules block of .datapass/project.json).",
          command: { command: "datapass.chooseModules", title: "Choose modules" }
        }] : []),
        ...(ctx.manifest?.schemaVersion === 1 ? [{ t: "info" as const, id: "migrate", label: "Upgrade manifest to v2 (scopes, apps, packs)…", icon: "arrow-circle-up", command: { command: "datapass.migrateManifestToV2", title: "Migrate" } }] : [])
      ]
    });

    if (problems.length) {
      nodes.push({ t: "section", id: "problems", label: "Problems", icon: "warning", description: String(problems.length), children: () => problems.map((p, i) => ({ t: "info", id: `problem:${i}`, label: p, icon: "circle-small-filled", tooltip: p })) });
    }
    if (m.checklist.length) {
      nodes.push({ t: "section", id: "checklist", label: "Checklist", icon: "checklist", description: `${m.progress.done}/${m.progress.total} · user-reported`, children: () => m.checklist.map(entry => ({ t: "check", entry })) });
    }
    if (m.operations.length) {
      const ready = m.operations.filter(o => o.result.status === "ready").length;
      nodes.push({ t: "section", id: "operations", label: "Operations", icon: "tools", description: `${ready}/${m.operations.length} ready`, children: () => m.operations.map(op => ({ t: "op", op })) });
    }
    if (m.outputs.length) {
      const stale = m.outputs.filter(o => o.state === "stale" || o.state === "stale-upstream").length;
      nodes.push({ t: "section", id: "outputs", label: "Outputs", icon: "output", description: stale ? `${stale} stale` : `${m.outputs.length}`, children: () => m.outputs.map(entry => ({ t: "output", entry, parent: "outputs" })) });
    }
    if (m.apps.length) {
      nodes.push({ t: "section", id: "apps", label: "Apps", icon: "rocket", description: String(m.apps.length), children: () => m.apps.map(app => ({ t: "app", app })) });
    }
    const resources = ctx.manifest && moduleEnabled(ctx.manifest, "infrastructure") ? resourcesForScope(ctx.manifest, m.scope.id) : [];
    if (resources.length) {
      nodes.push({
        t: "section", id: "resources", label: "Resources", icon: "server", description: String(resources.length),
        tooltip: "Shared machines and hosts this scope uses, and how (folder, repository, Compose file, env variable names).",
        children: () => resources.map(view => resourceNode(view, ctx.manifest!))
      });
    }
    const repos = s.repositories();
    if (repos.length) {
      const attention = repos.filter(r => r.state === "missing" || r.state === "not-a-repo" || (r.changes ?? 0) > 0).length;
      nodes.push({
        t: "section", id: "repos", label: "Repositories", icon: "repo", collapsed: true,
        description: attention ? `${repos.length} · ${attention} to look at` : String(repos.length),
        tooltip: "Local Git state only (branch, commit, uncommitted changes, ahead/behind as of the last fetch). Nothing is fetched, pulled or cloned.",
        children: () => repos.map((r): Node => ({
          t: "info", id: `repo:${r.key}`, label: r.label, description: describeRepo(r),
          icon: r.state === "ok" ? (r.changes ? ["git-commit", "problemsWarningIcon.foreground"] : "git-commit") : r.state === "remote-only" ? "cloud" : ["warning", "problemsWarningIcon.foreground"],
          tooltip: `${r.label} (${r.key}) — ${describeRepo(r)}${r.remote ? `\n${r.remote}` : ""}`,
          command: r.state === "ok" ? { command: "workbench.view.scm", title: "Source Control" } : undefined
        }))
      });
    }
    const inv = s.inventory();
    const assets = inv.assets.filter(a => !a.module || moduleEnabled(ctx.manifest, a.module));
    if (assets.length) {
      nodes.push({
        t: "section", id: "assets", label: "Assets", icon: "files", collapsed: true,
        description: `${assets.length}${inv.truncated ? "+" : ""} · static, never run`,
        tooltip: "Notebooks, Fabric items, Databricks bundles and notebooks, Airflow DAGs, Data Factory pipelines and Power BI projects found in this folder. Recognised from file names and headers only; nothing is executed or imported.",
        children: () => ASSET_GROUPS.flatMap(g => {
          const list = assets.filter(a => a.kind === g.kind);
          if (!list.length) return [];
          return [{ t: "section" as const, id: `assets:${g.kind}`, label: g.label, icon: g.icon, description: String(list.length), collapsed: true, children: () => list.slice(0, 200).map(assetNode) }];
        })
      });
    }
    const companions = s.companions();
    const sidecar = Boolean(ctx.diagramCloudSidecar) && moduleEnabled(ctx.manifest, "diagramcloud");
    if (companions.grafana || companions.mongoku || sidecar) {
      const names = [companions.grafana && "Grafana", companions.mongoku && "Mongoku", sidecar && "DiagramCloud"].filter(Boolean).join(" · ");
      nodes.push({
        t: "section", id: "links", label: "Links", icon: "link-external", description: names,
        tooltip: "Companion apps for this scope. Links open your browser; they are navigation, not health or sign-in checks.",
        children: () => linkNodes(companions, s.mongokuStatus(), sidecar)
      });
    }
    nodes.push({
      t: "section", id: "exchanges", label: "Exchanges", icon: "arrow-swap", description: m.exchanges.length ? String(m.exchanges.length) : "none yet",
      children: () => m.exchanges.length ? m.exchanges.slice(0, 25).map(rec => ({ t: "exchange", rec })) : [
        { t: "info", id: "ex:req", label: "Create app request…", icon: "arrow-up", command: { command: "datapass.createAppRequest", title: "Create" } },
        { t: "info", id: "ex:ctx", label: "Copy AI context…", icon: "copy", command: { command: "datapass.copyAiContext", title: "Copy" } }
      ]
    });
    if (m.programme.some(v => v.items.length || v.outputs.length)) {
      nodes.push({ t: "section", id: "programme", label: ctx.packs[0] ? `Programme · ${ctx.packs[0].title}` : "Programme", icon: "organization", children: () => m.programme.map(view => ({ t: "programme", view })) });
    }
    return nodes;
  }

  private programmeChildren(v: ProgrammeView): Node[] {
    return [
      ...v.items.map((i): Node => ({ t: "info", id: `prog:${v.id}:item:${i.id}`, label: i.label, description: `${i.kind}${i.authority ? ` · authority: ${i.authority}` : ""}`, icon: "symbol-field" })),
      ...v.outputs.map((entry): Node => ({ t: "output", entry, parent: `prog:${v.id}` }))
    ];
  }
}

function assetNode(a: Asset): Node {
  const uri = (p: string) => vscode.Uri.joinPath(projectRoot()!, ...p.split("/"));
  return {
    t: "info", id: `asset:${a.kind}:${a.path}`, label: a.name, description: [a.detail, a.path].filter(Boolean).join(" · "),
    tooltip: `${a.path}\nRecognised statically; opening it hands it to its native editor.`,
    command: a.open.type === "folder"
      ? { command: "revealInExplorer", title: "Reveal", arguments: [uri(a.open.path)] }
      : { command: "vscode.open", title: "Open", arguments: [uri(a.open.path)] }
  };
}

function resourceNode(view: ResourceView, manifest: DataPassProjectManifest): Node {
  const r = view.resource;
  const host = r.ssh?.host;
  const open = (bindingId?: string): vscode.Command => ({ command: "datapass.openResource", title: "Open", arguments: [{ resource: r.id, binding: bindingId }] });
  const children = (): Node[] => {
    const rows: Node[] = [];
    for (const b of view.bindings) {
      rows.push({ t: "info", id: `bind:${b.id}`, label: b.folder ? `Folder: ${b.folder}` : `Binding ${b.id}`, description: host ? "open on the host" : b.id, icon: "folder-opened", tooltip: `Binding ${b.id}${b.scopes?.length ? ` · scopes: ${b.scopes.join(", ")}` : " · every scope"}`, command: host ? open(b.id) : undefined });
      if (b.repository) rows.push({ t: "info", id: `bind:${b.id}:repo`, label: `Repository: ${b.repository}`, icon: "repo" });
      if (b.compose) rows.push({ t: "info", id: `bind:${b.id}:compose`, label: `Compose: ${b.compose}`, icon: "package" });
      if (b.env?.length) rows.push({ t: "info", id: `bind:${b.id}:env`, label: `Env: ${b.env.join(", ")}`, description: "names only; values stay on the host", icon: "symbol-variable" });
      if (b.processes?.length) rows.push({ t: "info", id: `bind:${b.id}:proc`, label: `Processes: ${b.processes.join(", ")}`, icon: "pulse" });
    }
    if (host && !view.bindings.some(b => b.folder)) rows.push({ t: "info", id: `res:${r.id}:open`, label: `Open ${host} (Remote - SSH)`, icon: "remote", command: open() });
    if (host) rows.push({ t: "info", id: `res:${r.id}:ssh`, label: `Copy: ssh ${host}`, description: "terminal", icon: "terminal", command: { command: "datapass.copySshCommand", title: "Copy", arguments: [r.id] } });
    if (view.sharedWith.length) {
      const others = scopeTitles(manifest, view.sharedWith);
      rows.push({
        t: "info", id: `res:${r.id}:shared`, label: `Shared with: ${others.join(", ")}`, description: "host-level changes affect all",
        icon: ["warning", "problemsWarningIcon.foreground"],
        tooltip: `Rebooting, upgrading or reconfiguring ${r.title ?? r.id} also affects: ${view.sharedWith.map(b => `${b.id}${b.folder ? ` (${b.folder})` : ""}`).join(", ")}.`
      });
    }
    return rows;
  };
  return { t: "section", id: `res:${r.id}`, label: r.title ?? r.id, description: [r.kind, host].filter(Boolean).join(" · "), icon: r.kind === "vm" ? "vm" : "server", children };
}

const openLink = (link: CompanionLink): vscode.Command => ({ command: "datapass.openCompanionLink", title: "Open", arguments: [link.id] });
const clipText = (text: string, max = 110) => { const one = text.replace(/\s+/g, " ").trim(); return one.length > max ? `${one.slice(0, max - 1)}…` : one; };

/** Grafana, Mongoku and DiagramCloud rows for the selected scope. Every string from Mongoku is untrusted text. */
function linkNodes(c: ResolvedCompanions, mongoku: MongokuStatus | undefined, sidecar: boolean): Node[] {
  const out: Node[] = [];
  if (c.grafana) {
    const g = c.grafana;
    out.push({
      t: "section", id: "links:grafana", label: "Grafana", description: g.host, icon: "pulse",
      tooltip: "Links only. DataPass does not check sign-in, datasources or data freshness; dashboards as code, gcx preview and deployment stay in Galaxy → Observability.",
      children: () => g.links.flatMap((link): Node[] => {
        const dashboard = link.id.startsWith("grafana.dashboard:");
        const row: Node = { t: "info", id: `link:${link.id}`, label: link.label, description: dashboard ? "dashboard" : "browser", icon: dashboard ? "dashboard" : "link-external", tooltip: link.url, command: openLink(link) };
        if (!link.source) return [row];
        return [row, { t: "info", id: `linksrc:${link.id}`, label: `Source: ${link.source}`, description: "dashboard as code", icon: "file-code", tooltip: `Open ${link.source}`, command: { command: "datapass.openExchange", title: "Open source", arguments: [link.source] } }];
      })
    });
  }
  if (c.mongoku) {
    const mk = c.mongoku;
    out.push({
      t: "section", id: "links:mongoku", label: "Mongoku", description: mk.entityId, icon: "project",
      tooltip: `Mongoku project "${mk.entityId}" (${mk.entitySource === "scope" ? "mapped for this scope" : "project-level mapping"}). Imported contexts are dated snapshots, never live data.`,
      children: () => mongokuNodes(mk.links, mk.needsUrl, mongoku)
    });
  }
  if (sidecar) {
    out.push({ t: "info", id: "links:diagramcloud", label: "DiagramCloud architecture", description: ".datapass/diagramcloud.json", icon: "type-hierarchy", tooltip: "Open in DiagramCloud, copy its AI context or import a reviewed AI plan (Work view … menu).", command: { command: "datapass.diagramCloud.openArchitecture", title: "Open" } });
  }
  return out;
}

function mongokuNodes(links: CompanionLink[], needsUrl: boolean, status: MongokuStatus | undefined): Node[] {
  const out: Node[] = needsUrl
    ? [{ t: "info", id: "mongoku:setUrl", label: "Set Mongoku address…", description: "user setting", icon: "gear", command: { command: "datapass.mongoku.setUrl", title: "Set" } }]
    : links.map((link): Node => ({ t: "info", id: `link:${link.id}`, label: link.label, description: "browser", icon: "link-external", tooltip: link.url, command: openLink(link) }));
  const importRow: Node = { t: "info", id: "mongoku:import", label: "Import Mongoku context…", description: "Developer context → JSON → Copy", icon: "cloud-download", command: { command: "datapass.mongoku.importContext", title: "Import" } };
  if (!status || status.state === "missing") return [...out, { t: "info", id: "mongoku:none", label: "No context imported", description: "optional", icon: "circle-large-outline" }, importRow];
  if (status.state === "invalid") return [...out, { t: "info", id: "mongoku:invalid", label: "Stored context rejected", description: clipText(status.reason, 80), icon: ["warning", "problemsWarningIcon.foreground"], tooltip: status.reason }, importRow];
  const ctx = status.context;
  const now = Date.now();
  const view = viewMongokuContext(ctx, now);
  const old = view.age === "old";
  const reported = old ? "reported · old snapshot" : "reported";
  const p = ctx.project;
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${esc(p.name)}** — Mongoku context generated ${esc(ctx.generatedAt)} (${esc(ctx.classification)})\n\n`);
  md.appendMarkdown(`Imported snapshot, not live. Mongoku marks its entity source *${esc(view.sourceFreshness)}*.\n\n`);
  if (ctx.exclusions.length) md.appendMarkdown(ctx.exclusions.map(e => `- ${esc(e)}`).join("\n"));
  out.push({
    t: "info", id: "mongoku:snapshot", label: `Snapshot · ${ageLabel(ctx.generatedAt, now)}`,
    description: ["not live", old ? "old: re-import" : undefined, view.sourceFreshness !== "CURRENT_FOR_DECLARED_SCOPE" ? `source ${view.sourceFreshness.toLowerCase().replace(/_/g, " ")}` : undefined].filter(Boolean).join(" · "),
    icon: old ? ["history", "problemsWarningIcon.foreground"] : "history", tooltip: md
  });
  const field = (id: string, label: string, value: string | undefined): Node[] => value
    ? [{ t: "info", id: `mongoku:${id}`, label: `${label}: ${clipText(value)}`, description: reported, tooltip: `${label} (reported by Mongoku at ${ctx.generatedAt})\n\n${value}` }]
    : [];
  out.push(...field("status", "Status", p.status), ...field("gate", "Test gate", p.test_gate), ...field("stop", "Stop point", p.stop_point), ...field("next", "Next", p.next_action));
  const listed = ctx.items.filter(i => i.kind === "WORK" || i.kind === "TEST_GATE");
  if (listed.length) {
    out.push({
      t: "section", id: "mongoku:items", label: `${view.work} work · ${view.testGates} test gate(s) listed`, description: "capped by Mongoku", icon: "list-unordered", collapsed: true,
      tooltip: "Mongoku lists at most 15 open work items per context. This is not a complete backlog count.",
      children: () => listed.map((item, i): Node => ({ t: "info", id: `mongoku:item:${i}`, label: clipText(item.summary), description: item.kind === "TEST_GATE" ? "test gate" : undefined, icon: item.kind === "TEST_GATE" ? "beaker" : "circle-small-filled", tooltip: `${item.id} · ${item.kind} · ${item.assertion}\n\n${item.summary}` }))
    });
  }
  return [...out, importRow];
}

function esc(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, m => `\\${m}`);
}
