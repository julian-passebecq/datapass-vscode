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

type Node =
  | { t: "section"; id: string; label: string; description?: string; icon: string; tooltip?: string; command?: vscode.Command; children: () => Node[] }
  | { t: "info"; id: string; label: string; description?: string; icon?: string; tooltip?: string; command?: vscode.Command; contextValue?: string }
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
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
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
        if (node.icon) item.iconPath = icon(node.icon);
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
        item.description = `${r.status}${c.implementation === "documented-only" ? " · native tool" : ""}`;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${esc(c.label)}** \`${c.id}\`\n\n**${r.status}** — ${esc(r.nextStep)}\n\n`);
        if (r.sideEffects.length) md.appendMarkdown(`Side effects: ${r.sideEffects.join(", ")}\n\n`);
        md.appendMarkdown(`*${esc(r.evidenceNote)}*`);
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

function esc(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, m => `\\${m}`);
}
