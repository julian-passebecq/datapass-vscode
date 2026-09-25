/**
 * DataPass "Project" tree (left side bar): the whole architecture, collapsible.
 *
 *   sub-project ─► component ─► expected files (found / missing / not cloned / to generate)
 *   Repositories (cloned, not cloned, planned; commits to get)
 *   Problems in the project files
 *
 * Selecting a sub-project or component updates the shared selection (Details side bar,
 * Architecture panel, Workbench tab). Clicking a found file opens it; clicking a missing one
 * explains why it is expected. Native tree: keyboard and screen-reader accessible, themable.
 */
import * as vscode from "vscode";
import type { WorkSession } from "../work/session";
import type { ComponentView, SubprojectView } from "../core/project/projectMap";
import type { ExpectedFile, RepoView } from "../core/project/resolve";

type Node =
  | { t: "info"; id: string; label: string; description?: string; icon: [string, string?]; tooltip?: string; command?: vscode.Command }
  | { t: "subproject"; id: string; sp: SubprojectView }
  | { t: "component"; id: string; c: ComponentView; parent: string }
  | { t: "file"; id: string; c: ComponentView; f: ExpectedFile; parent: string }
  | { t: "section"; id: string; label: string; description?: string; icon: string; kids: () => Node[]; collapsed?: boolean }
  | { t: "repo"; id: string; r: RepoView };

const HEALTH_ICON: Record<string, [string, string?]> = {
  ok: ["pass", "testing.iconPassed"], attention: ["warning", "problemsWarningIcon.foreground"], blocked: ["error", "problemsErrorIcon.foreground"],
  planned: ["circle-large-outline", "disabledForeground"], info: ["info", "problemsInfoIcon.foreground"]
};
const REPO_ICON: Record<string, [string, string?]> = {
  local: ["repo", "testing.iconPassed"], unbound: ["cloud", "problemsWarningIcon.foreground"], planned: ["circle-large-outline", "disabledForeground"],
  missing: ["error", "problemsErrorIcon.foreground"], "wrong-remote": ["error", "problemsErrorIcon.foreground"], "not-a-repo": ["warning", "problemsWarningIcon.foreground"],
  restricted: ["shield", "disabledForeground"]
};
const icon = ([id, color]: [string, string?]) => new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);

function fileState(f: ExpectedFile): { text: string; icon: [string, string?] } {
  if (f.source === "generated" && f.state === "missing") return { text: `to generate · ${f.generated?.producer ?? "producer"}`, icon: ["gear", "problemsWarningIcon.foreground"] };
  if (f.optional && f.state === "missing") return { text: "recommended · missing", icon: ["circle-large-outline", "disabledForeground"] };
  switch (f.state) {
    case "found": return { text: f.kind === "file" ? f.role : `${f.count ?? 1} file(s)`, icon: ["check", "testing.iconPassed"] };
    case "missing": return { text: `missing · needed to ${f.requiredFor.slice(0, 3).join(", ")}`, icon: ["close", "problemsErrorIcon.foreground"] };
    case "unbound": return { text: "repository not cloned", icon: ["cloud", "disabledForeground"] };
    case "planned": return { text: "repository planned", icon: ["circle-large-outline", "disabledForeground"] };
    default: return { text: "not checked", icon: ["question", "disabledForeground"] };
  }
}

export class ProjectTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  static readonly viewType = "datapass.project";
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private readonly parents = new Map<string, Node | undefined>();
  private readonly byId = new Map<string, Node>();
  private view?: vscode.TreeView<Node>;

  constructor(private readonly session: WorkSession) {
    this.subs.push(session.onDidChange(() => this.emitter.fire(undefined)), session.onDidChangeSelection(() => void this.revealSelection()));
  }

  dispose(): void { for (const s of this.subs) s.dispose(); this.emitter.dispose(); }

  attach(view: vscode.TreeView<Node>): void {
    this.view = view;
    this.subs.push(view.onDidChangeSelection(e => {
      const n = e.selection[0];
      if (n?.t === "subproject") void this.session.select({ subproject: n.sp.id });
      else if (n?.t === "component") void this.session.select({ subproject: this.parentSubproject(n), component: n.c.id });
    }));
  }

  private parentSubproject(n: Node): string | undefined {
    let p = this.parents.get(n.id);
    while (p && p.t !== "subproject") p = this.parents.get(p.id);
    return p?.t === "subproject" ? p.sp.id : undefined;
  }

  private remember(nodes: Node[], parent: Node | undefined): Node[] {
    for (const n of nodes) { this.parents.set(n.id, parent); this.byId.set(n.id, n); }
    return nodes;
  }

  getParent(node: Node): Node | undefined { return this.parents.get(node.id); }

  getChildren(node?: Node): Node[] {
    if (!node) return this.remember(this.roots(), undefined);
    switch (node.t) {
      case "subproject": return this.remember(node.sp.componentIds.map(id => this.session.projectMap().components.find(c => c.id === id)).filter((c): c is ComponentView => !!c && !(c.parent && node.sp.componentIds.includes(c.parent))).map(c => ({ t: "component" as const, id: `${node.id}/c:${c.id}`, c, parent: node.id })), node);
      case "component": {
        const map = this.session.projectMap();
        const files = (node.c.artifacts?.files ?? []).map(f => ({ t: "file" as const, id: `${node.id}/f:${f.repoPath}`, c: node.c, f, parent: node.id }));
        const kids = node.c.children.map(id => map.components.find(c => c.id === id)).filter((c): c is ComponentView => !!c).map(c => ({ t: "component" as const, id: `${node.id}/c:${c.id}`, c, parent: node.id }));
        return this.remember([...files, ...kids], node);
      }
      case "section": return this.remember(node.kids(), node);
      default: return [];
    }
  }

  getTreeItem(n: Node): vscode.TreeItem {
    switch (n.t) {
      case "info": {
        const item = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
        item.id = n.id; item.description = n.description; item.iconPath = icon(n.icon); item.tooltip = n.tooltip ?? n.label; item.command = n.command;
        return item;
      }
      case "subproject": {
        const s = n.sp;
        const item = new vscode.TreeItem(s.title, vscode.TreeItemCollapsibleState.Expanded);
        item.id = n.id;
        item.description = `${s.summary.filesFound}/${s.summary.filesExpected} files · ${s.summary.opsReady}/${s.summary.opsTotal} ops`;
        item.iconPath = icon(HEALTH_ICON[s.health] ?? ["circle-outline"]);
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${esc(s.title)}**${s.objective ? `\n\n${esc(s.objective)}` : ""}\n\nNext: ${esc(s.nextStep)}`);
        if (s.needs.repositories.length) md.appendMarkdown(`\n\nRepositories needed: ${s.needs.repositories.map(r => esc(`${r.label} (${r.state})`)).join(", ")}`);
        if (s.needs.tools.length) md.appendMarkdown(`\n\nTools not installed: ${s.needs.tools.map(t => esc(t.label)).join("; ")}`);
        item.tooltip = md;
        item.contextValue = "subproject";
        return item;
      }
      case "component": {
        const c = n.c;
        const hasKids = Boolean(c.artifacts?.files.length || c.children.length);
        const item = new vscode.TreeItem(c.label, hasKids ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.id = n.id;
        item.description = `${c.provider?.label ?? c.kind} · ${c.headline}`;
        item.iconPath = new vscode.ThemeIcon(c.provider?.icon ?? "symbol-misc", new vscode.ThemeColor((HEALTH_ICON[c.health] ?? ["", "foreground"])[1] ?? "foreground"));
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${esc(c.label)}** — ${esc(c.provider?.label ?? c.kind)}\n\n${c.description ? `${esc(c.description)}\n\n` : ""}${esc(c.headline)}\n\nNext: ${esc(c.nextStep)}`);
        item.tooltip = md;
        const repo = c.repoKey ? this.session.projectMap().repositories.find(r => r.key === c.repoKey) : undefined;
        item.contextValue = `component${repo?.state === "local" ? ".local" : ""}${c.artifacts?.entry?.state === "found" ? ".entry" : ""}${c.provider?.nativeTool ? ".tool" : ""}`;
        return item;
      }
      case "file": {
        const { f, c } = n;
        const st = fileState(f);
        const item = new vscode.TreeItem(f.path, vscode.TreeItemCollapsibleState.None);
        item.id = n.id;
        item.description = st.text;
        item.iconPath = icon(st.icon);
        item.tooltip = `${f.repoPath}\n${f.about ?? f.role}${f.generated ? `\nGenerated by ${f.generated.producer}${f.generated.how ? ` (${f.generated.how})` : ""}` : ""}`;
        item.command = f.state === "found"
          ? { command: "datapass.openComponentFile", title: "Open", arguments: [c.id, f.repoPath] }
          : { command: "datapass.explainMissingFile", title: "Why is this expected?", arguments: [c.id, f.repoPath] };
        item.contextValue = f.state === "found" ? "file.found" : "file.absent";
        return item;
      }
      case "section": {
        const item = new vscode.TreeItem(n.label, n.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
        item.id = n.id; item.description = n.description; item.iconPath = new vscode.ThemeIcon(n.icon); item.contextValue = `section.${n.id}`;
        return item;
      }
      case "repo": {
        const r = n.r;
        const item = new vscode.TreeItem(r.label, vscode.TreeItemCollapsibleState.None);
        item.id = n.id;
        item.description = r.state === "local" ? r.detail : r.remote ? `${r.state === "unbound" ? "not cloned" : r.state} · ${r.remote}` : r.detail;
        item.iconPath = icon(REPO_ICON[r.state] ?? ["repo"]);
        item.tooltip = `${r.label}${r.description ? ` — ${r.description}` : ""}\n${r.detail}${r.nextStep ? `\nNext: ${r.nextStep}` : ""}${r.usedBy.length ? `\nUsed by: ${r.usedBy.join(", ")}` : ""}`;
        item.contextValue = `repo.${r.state}${(r.git?.behind ?? 0) > 0 ? ".behind" : ""}${r.coordination ? ".coordination" : ""}`;
        return item;
      }
    }
  }

  private roots(): Node[] {
    const s = this.session;
    const ctx = s.project;
    if (!ctx.root) return [{ t: "info", id: "noroot", label: "Open a folder to use DataPass.", icon: ["folder"], command: { command: "vscode.openFolder", title: "Open folder" } }];
    if (!ctx.manifestExists) return [
      { t: "info", id: "init", label: "Initialize a project manifest…", icon: ["add"], command: { command: "datapass.initializeProjectManifest", title: "Initialize" } },
      { t: "info", id: "guide", label: "How to prepare a project (for you or your AI)", icon: ["book"], command: { command: "datapass.openPreparationGuide", title: "Guide" } },
      { t: "info", id: "switch", label: "Switch project…", icon: ["arrow-swap"], command: { command: "datapass.switchProject", title: "Switch" } }
    ];
    if (ctx.manifestErrors.length) return [{ t: "info", id: "errors", label: "The project manifest has errors", description: `${ctx.manifestErrors.length}`, icon: ["error", "problemsErrorIcon.foreground"], tooltip: ctx.manifestErrors.join("\n"), command: { command: "datapass.openProjectManifest", title: "Open" } }];
    const map = s.projectMap();
    const nodes: Node[] = [];
    nodes.push({ t: "info", id: "next", label: map.nextStep, description: "next", icon: ["arrow-right"], tooltip: map.nextStep });
    if (!vscode.workspace.isTrusted) nodes.push({ t: "info", id: "restricted", label: "Restricted Mode: Git state is not read", icon: ["shield", "problemsWarningIcon.foreground"], command: { command: "workbench.trust.manage", title: "Manage trust" } });
    if (s.projectRootCandidates().length > 1) nodes.push({ t: "info", id: "roots", label: `${s.projectRootCandidates().length} project folders in this window`, description: "choose…", icon: ["root-folder"], command: { command: "datapass.selectProjectFolder", title: "Choose" } });
    if (ctx.graphError) nodes.push({ t: "info", id: "graphError", label: `graph.json: ${ctx.graphError}`, icon: ["error", "problemsErrorIcon.foreground"], command: { command: "datapass.openGraph", title: "Open" } });
    if (!map.components.length && !ctx.graphError) nodes.push({ t: "info", id: "nographs", label: "No components yet: describe them in .datapass/graph.json", icon: ["type-hierarchy"], command: { command: "datapass.openGraph", title: "Open" } });
    for (const sp of map.subprojects) if (sp.componentIds.length || !sp.implicit) nodes.push({ t: "subproject", id: `sp:${sp.id}`, sp });
    nodes.push({
      t: "section", id: "repositories", label: "Repositories", icon: "repo",
      description: `${map.repositories.filter(r => r.state === "local").length}/${map.repositories.length} cloned${map.repositories.some(r => (r.git?.behind ?? 0) > 0) ? " · updates to get" : ""}`,
      kids: () => map.repositories.map(r => ({ t: "repo" as const, id: `repo:${r.key}`, r }))
    });
    const serious = map.problems.filter(p => p.severity !== "info");
    if (map.problems.length) nodes.push({
      t: "section", id: "problems", label: "Problems in project files", icon: "warning", collapsed: !serious.length, description: `${serious.length || map.problems.length}`,
      kids: () => map.problems.map((p, i) => ({ t: "info" as const, id: `problem:${i}`, label: p.message, description: p.where, icon: p.severity === "error" ? ["error", "problemsErrorIcon.foreground"] as [string, string] : p.severity === "warning" ? ["warning", "problemsWarningIcon.foreground"] as [string, string] : ["info"] as [string], tooltip: `${p.where}: ${p.message}` }))
    });
    return nodes;
  }

  /** Reveal the selected component (or sub-project) when the selection changed elsewhere. */
  private async revealSelection(): Promise<void> {
    if (!this.view?.visible) return;
    const sel = this.session.selection();
    const id = sel.component ? `sp:${sel.subproject}/c:${sel.component}` : sel.subproject ? `sp:${sel.subproject}` : undefined;
    const node = id ? this.byId.get(id) : undefined;
    if (node && this.view.selection[0]?.id !== node.id) {
      try { await this.view.reveal(node, { select: true, focus: false, expand: false }); } catch { /* not rendered yet */ }
    }
  }
}

function esc(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, m => `\\${m}`);
}
