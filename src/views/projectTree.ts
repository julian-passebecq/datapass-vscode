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
import { fileStateText, keySourceText, keyStateText, type Readiness } from "../core/readiness/readiness";
import { openCardsByUrgency, TYPE_LABELS, type BoardItemType, type BoardView } from "../core/project/board";
import { gitHostOf, repositoryWebLinks } from "../core/project/gitHosts";

type Node =
  | { t: "info"; id: string; label: string; description?: string; icon: [string, string?]; tooltip?: string; command?: vscode.Command; contextValue?: string }
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
      // The tree's own reveals (following a selection made elsewhere) fire this event later; a late one
      // must not bring back an older selection (0.17: a work view applied right after another selection).
      const at = n?.id ? this.revealing.get(n.id) : undefined;
      if (n?.id && at !== undefined) { this.revealing.delete(n.id); if (Date.now() - at < 3000) return; }
      if (n?.t === "subproject") void this.session.select({ subproject: n.sp.id });
      else if (n?.t === "component") void this.session.select({ subproject: this.parentSubproject(n), component: n.c.id });
    }));
  }

  /** Nodes revealed by the tree itself, and when: their selection events are not the person's clicks. */
  private readonly revealing = new Map<string, number>();

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
        item.id = n.id; item.description = n.description; item.iconPath = icon(n.icon); item.tooltip = n.tooltip ?? n.label; item.command = n.command; item.contextValue = n.contextValue;
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
        const url = r.state === "planned" ? undefined : r.remoteUrl ?? r.git?.originUrl;
        const host = gitHostOf(url)?.label;
        item.tooltip = `${r.label}${r.description ? ` — ${r.description}` : ""}${host ? ` (${host})` : ""}\n${r.detail}${r.nextStep ? `\nNext: ${r.nextStep}` : ""}${r.usedBy.length ? `\nUsed by: ${r.usedBy.join(", ")}` : ""}`;
        item.contextValue = `repo.${r.state}${(r.git?.behind ?? 0) > 0 ? ".behind" : ""}${r.coordination ? ".coordination" : ""}${repositoryWebLinks(url).length ? ".web" : ""}`;
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
    // 0.16: the board (tasks, bugs, sprints), when the project has one.
    const bv = s.boardView();
    if (bv || ctx.boardError) nodes.push(boardSection(bv, ctx.boardError));
    // 0.15: architecture options and project sheet, when the project has them.
    const o = ctx.options;
    if (o || ctx.optionsError) nodes.push({
      t: "section", id: "options", label: "Architecture options", icon: "git-compare", collapsed: true,
      description: o ? `${o.decisions.length} decision(s) · ${(o.scenarios?.length ?? 0)} scenario(s)` : "errors in options.json",
      kids: () => o ? [
        { t: "info" as const, id: "opt:scenarios", label: "Compare scenarios", description: (o.scenarios ?? []).map(x => x.title).slice(0, 3).join(" · "), icon: ["type-hierarchy"] as [string], command: { command: "datapass.openOptions", title: "Compare", arguments: ["scenarios"] } },
        ...o.decisions.map(d => {
          const cur = d.options.find(x => x.id === d.current)?.label ?? d.current;
          const chosen = d.chosen && d.chosen !== d.current ? d.options.find(x => x.id === d.chosen)?.label : undefined;
          return { t: "info" as const, id: `opt:${d.id}`, label: d.title, description: `current: ${cur}${chosen ? ` · decided: ${chosen}` : ""} · ${d.options.length} options`, icon: (chosen ? ["star-full", "charts.yellow"] : ["git-compare"]) as [string, string?], tooltip: d.question ?? d.title, command: { command: "datapass.openOptions", title: "Compare", arguments: [d.id] } };
        })
      ] : [{ t: "info" as const, id: "opt:error", label: ctx.optionsError ?? "", icon: ["error", "problemsErrorIcon.foreground"] as [string, string], command: { command: "datapass.openOptionsFile", title: "Open" } }]
    });
    const sh = ctx.sheet;
    if (sh || ctx.sheetError) nodes.push({
      t: "section", id: "sheet", label: "Project sheet", icon: "table", collapsed: true,
      description: sh ? `${sh.datasets?.length ?? 0} data · ${sh.formulas?.length ?? 0} formulas · ${sh.runtimes?.length ?? 0} runtimes` : "errors in sheet.json",
      kids: () => sh ? ([
        ["datasets", "Data (tables, collections, files)", "database", sh.datasets?.length ?? 0],
        ["formulas", "Formulas", "symbol-operator", sh.formulas?.length ?? 0],
        ["runtimes", "Where code runs", "server-environment", sh.runtimes?.length ?? 0],
        ["glossary", "Glossary", "book", sh.glossary?.length ?? 0]
      ] as Array<[string, string, string, number]>).filter(([, , , n]) => n > 0).map(([section, label, icon, n]) => ({ t: "info" as const, id: `sheet:${section}`, label, description: String(n), icon: [icon] as [string], command: { command: "datapass.openSheet", title: "Open", arguments: [{ section }] } }))
        : [{ t: "info" as const, id: "sheet:error", label: ctx.sheetError ?? "", icon: ["error", "problemsErrorIcon.foreground"] as [string, string], command: { command: "datapass.openSheetFile", title: "Open" } }]
    });
    nodes.push({
      t: "section", id: "repositories", label: "Repositories", icon: "repo",
      description: `${map.repositories.filter(r => r.state === "local").length}/${map.repositories.length} cloned${map.repositories.some(r => (r.git?.behind ?? 0) > 0) ? " · updates to get" : ""}`,
      kids: () => map.repositories.map(r => ({ t: "repo" as const, id: `repo:${r.key}`, r }))
    });
    nodes.push(...readinessNodes(s.readiness()));
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
      if (node.id) this.revealing.set(node.id, Date.now());
      try { await this.view.reveal(node, { select: true, focus: false, expand: false }); } catch { if (node.id) this.revealing.delete(node.id); /* not rendered yet */ }
    }
  }
}

const WARN: [string, string] = ["warning", "problemsWarningIcon.foreground"];
const ERR: [string, string] = ["error", "problemsErrorIcon.foreground"];

const TYPE_ICON: Record<BoardItemType, [string, string?]> = {
  bug: ["bug", "problemsErrorIcon.foreground"], task: ["tasklist"], feature: ["sparkle", "charts.blue"], decision: ["git-compare", "charts.yellow"], question: ["question", "charts.purple"]
};

/** "Board": open cards, most urgent first; each opens the board on that card. */
function boardSection(bv: BoardView | undefined, error: string | undefined): Node {
  if (!bv) return { t: "section", id: "board", label: "Board", icon: "project", description: "errors in board.json", kids: () => [{ t: "info", id: "board:error", label: error ?? "", icon: ERR, command: { command: "datapass.openBoardFile", title: "Open" } }] };
  const current = bv.sprints.find(s => s.state === "current");
  const column = (id: string) => bv.columns.find(c => c.id === id)?.title ?? id;
  const open = openCardsByUrgency(bv);
  return {
    t: "section", id: "board", label: "Board", icon: "project", collapsed: open.length > 12,
    description: [`${bv.summary.open} open`, bv.summary.bugs ? `${bv.summary.bugs} bug${bv.summary.bugs === 1 ? "" : "s"}` : undefined, bv.summary.overdue ? `${bv.summary.overdue} overdue` : undefined, current ? `${current.title} → ${current.end}` : undefined].filter(Boolean).join(" · "),
    kids: () => [
      { t: "info", id: "board:open", label: "Open the board", description: "kanban · filter by sub-project, sprint, type", icon: ["project"], command: { command: "datapass.openBoard", title: "Open" } },
      ...open.slice(0, 40).map((c): Node => ({
        t: "info", id: `board:card:${c.id}`, label: c.title,
        description: [TYPE_LABELS[c.type].toLowerCase(), column(c.status), c.priority, c.overdue ? `overdue (${c.due})` : undefined].filter(Boolean).join(" · "),
        icon: TYPE_ICON[c.type], contextValue: "boardCard",
        tooltip: `${TYPE_LABELS[c.type]} ${c.id}: ${c.title}\n${column(c.status)}${c.sprint ? ` · ${c.sprint.title}` : ""}${c.components.length ? `\nComponents: ${c.components.map(x => x.label).join(", ")}` : ""}${c.files.length ? `\nFiles: ${c.files.map(f => f.path).join(", ")}` : ""}`,
        command: { command: "datapass.openBoard", title: "Open", arguments: [c.id] }
      }))
    ]
  };
}
const OK: [string, string] = ["pass", "testing.iconPassed"];
const MUTED: [string, string] = ["circle-large-outline", "disabledForeground"];

/**
 * "Local environment" (env files, variable names, non-secret ids, vault) and "Readiness" (checks,
 * optional companions). Built from the Readiness, which holds names and states only.
 */
function readinessNodes(r: Readiness): Node[] {
  const nodes: Node[] = [];
  if (r.declared || r.identifiers.length) {
    const kids = (): Node[] => {
      const rows: Node[] = [];
      for (const f of r.files) rows.push({
        t: "info", id: `env:file:${f.id}`, label: f.repoLabel ? `${f.path} · ${f.repoLabel}` : f.path, description: fileStateText(f),
        icon: f.git === "tracked" ? ERR : f.state === "found" ? (f.git === "not-ignored" ? WARN : ["file", "testing.iconPassed"]) : f.state === "missing" ? (f.optional ? MUTED : WARN) : f.state === "not-cloned" ? ["cloud", "disabledForeground"] : WARN,
        tooltip: `${f.path}${f.repoLabel ? ` in ${f.repoLabel}` : ""}: ${fileStateText(f)}${f.reason ? ` (${f.reason})` : ""}\nClick to open it${f.state === "missing" ? " (DataPass offers to create it with the variable names and empty values)" : ""}. DataPass only checks which names it defines, never the values.`,
        command: { command: "datapass.env.openFile", title: "Open", arguments: [f.id] }, contextValue: "envFile"
      });
      for (const k of r.keys) rows.push({
        t: "info", id: `env:key:${k.name}`, label: k.name, description: `${keyStateText(k)} · ${k.source === "identifier" ? "non-secret id" : "secret · vault"}`,
        icon: k.state === "set" ? OK : k.state === "not-checked" ? ["question", "disabledForeground"] : WARN,
        tooltip: `${k.name}: ${keyStateText(k)}\n${keySourceText(k)}\nClick to copy the name (never the value).`,
        command: { command: "datapass.env.copyKeyName", title: "Copy name", arguments: [k.name] }, contextValue: k.source === "identifier" ? "envKey.identifier" : "envKey"
      });
      for (const d of r.identifiers) rows.push({
        t: "info", id: `env:id:${d.id}`, label: d.label, description: ["non-secret id", d.provider, d.envKey ? `→ ${d.envKey}` : undefined, "click to copy"].filter(Boolean).join(" · "),
        icon: ["symbol-constant"], tooltip: `${d.label}: declared in .datapass/project.json as non-secret. Click to copy its value.`,
        command: { command: "datapass.env.copyIdentifier", title: "Copy", arguments: [d.id] }, contextValue: "identifier"
      });
      rows.push({ t: "info", id: "env:projectId", label: "Copy project ID", description: "to find this project in Power Ops", icon: ["copy"], command: { command: "datapass.copyProjectId", title: "Copy" } });
      rows.push({ t: "info", id: "env:powerOps", label: "Open Power Ops", description: "secrets live in your local vault", icon: ["lock"], tooltip: "Starts Power Ops (datapass.powerOps.path). Nothing is passed to it; DataPass never handles secret values.", command: { command: "datapass.openPowerOps", title: "Open" } });
      return rows;
    };
    const missing = r.keys.filter(k => k.state === "missing" || k.state === "empty").length;
    const filesMissing = r.files.filter(f => f.state === "missing" && !f.optional).length;
    nodes.push({
      t: "section", id: "env", label: "Local environment", icon: "symbol-variable",
      description: [r.keys.length ? `${r.summary.keysSet}/${r.keys.length} variables set` : undefined, filesMissing ? `${filesMissing} file(s) missing` : undefined, missing ? `${missing} to fill` : undefined].filter(Boolean).join(" · ") || "names only",
      kids
    });
  }
  const serious = r.summary.errors + r.summary.warnings;
  nodes.push({
    t: "section", id: "readiness", label: "Readiness", icon: "checklist", collapsed: !serious,
    description: `${r.summary.errors} error(s) · ${r.summary.warnings} warning(s)${r.summary.infos ? ` · ${r.summary.infos} note(s)` : ""}`,
    kids: () => [
      ...r.checks.map((c, i): Node => ({
        t: "info", id: `check:${c.id}:${i}`, label: c.message, description: c.area,
        icon: c.severity === "error" ? ERR : c.severity === "warning" ? WARN : ["info", "problemsInfoIcon.foreground"], tooltip: `${c.message}${c.nextStep ? `\nNext: ${c.nextStep}` : ""}`
      })),
      ...r.companions.map((c): Node => ({
        t: "info", id: `companion:${c.module}`, label: c.label, description: c.detail,
        icon: c.state === "disabled" ? ["circle-slash", "disabledForeground"] : c.state === "configured" ? OK : MUTED,
        tooltip: c.state === "disabled" ? `${c.label} is an optional module, switched off for this project.` : `${c.label} (optional): ${c.detail}`
      })),
      { t: "info", id: "readiness:report", label: "Show readiness report", description: "names and states only", icon: ["output"], command: { command: "datapass.readinessReport", title: "Report" } }
    ]
  });
  return nodes;
}

function esc(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, m => `\\${m}`);
}
