/**
 * DataPass Home (V3-HOME, vision §2.1 and §2.5): the module dashboard. Pure (no `vscode`), so the
 * state and the page can be tested without a host.
 *
 * Each tile opens one module on its own through a command that already exists; the Home adds no
 * behaviour behind them. The Home reads only what the session already loaded (project map, board,
 * links file, saved work views): opening it starts no probe, no Git call and no network call, and a
 * module that is not opened loads nothing for the Home.
 *
 * Webview messages name an action id, a saved view id or a link position — never a command or a
 * URL. The host maps action ids through HOME_ACTIONS (a fixed table) and re-reads the link from the
 * validated links file.
 */
import type { ProjectMap } from "../core/project/projectMap";
import type { BoardView } from "../core/project/board";
import { KIND_LABELS, linkHost, linksProblems, LINKS_PATH, type LinkKind, type LinksFile } from "../core/project/links";

/** Home action id → the existing command it runs (and its fixed arguments). */
export const HOME_ACTIONS: Readonly<Record<string, { command: string; args?: readonly unknown[]; surface?: string }>> = {
  "architecture.workbench": { command: "datapass.openWorkbench" },
  "architecture.panel": { command: "datapass.architecture.focus", surface: "view.architecture" },
  "architecture.options": { command: "datapass.openOptions", surface: "workbench.options" },
  "architecture.tree": { command: "datapass.project.focus", surface: "view.project" },
  "git.view": { command: "datapass.git.focus", surface: "view.git" },
  "ai.view": { command: "datapass.aiExchange.focus", surface: "view.aiExchange" },
  "ai.workOrders": { command: "datapass.workOrders.show", surface: "ai.agent" },
  "ai.agentPanel": { command: "datapass.agentPanel.focus", surface: "view.agentPanel" },
  "readiness.report": { command: "datapass.readinessReport" },
  "readiness.toolkit": { command: "datapass.openToolkit", surface: "workbench.toolkit" },
  "board.open": { command: "datapass.openBoard", surface: "workbench.board" },
  "board.file": { command: "datapass.openBoardFile" },
  "links.page": { command: "datapass.openProjectLinks" },
  "links.file": { command: "datapass.openLinksFile" },
  "links.home": { command: "datapass.openHome" },
  "layout.save": { command: "datapass.saveWorkView" },
  "layout.manage": { command: "datapass.manageWorkViews" },
  "project.open": { command: "datapass.openClientProject" },
  "project.guide": { command: "datapass.openPreparationGuide" }
};

export interface HomeAction { id: string; label: string; /** Why it cannot run here (shown instead of running). */ disabled?: string }
export interface HomeTile { id: string; title: string; summary: string; actions: HomeAction[]; coming?: boolean; attention?: boolean }
export interface HomeArea { id: string; title: string; tiles: HomeTile[] }

export interface HomeLink { group: number; index: number; label: string; host: string; kind: LinkKind; kindLabel: string; environment?: string; description?: string; local: boolean }
export interface HomeLinks {
  state: "none" | "error" | "ok";
  error?: string;
  title?: string;
  groups: Array<{ title: string; description?: string; links: HomeLink[] }>;
  count: number;
  warnings: string[];
  /** One line saying how to add the file (shown when there is none). */
  howTo: string;
}

export interface HomeLayout { id: string; name: string; detail: string; project?: string }
export interface HomePreview { lanes: Array<{ title: string; components: string[]; more: number }>; components: number; relations: number }

export interface HomeState {
  project?: { title: string; description?: string };
  areas: HomeArea[];
  preview?: HomePreview;
  layouts: HomeLayout[];
  layoutsError?: string;
  links: HomeLinks;
  /** The Home was opened by the workspace's startup view. */
  startup?: boolean;
}

export interface HomeInput {
  hasProject: boolean;
  map: ProjectMap;
  board?: BoardView;
  boardError?: string;
  links?: LinksFile;
  linksError?: string;
  optionsDecisions?: number;
  workOrdersEnabled: boolean;
  layouts: HomeLayout[];
  layoutsError?: string;
  /** Surfaces the current DataPass mode shows (a tile action whose surface is hidden says so). */
  shows: (surface: string) => boolean;
}

export const LINKS_HOW_TO = `No links declared. Ask your AI to add ${LINKS_PATH} to the bridge repository: groups of links, each { "label", "url", "kind" } (docs/PREPARING_A_PROJECT.md, "Project links").`;
const PREVIEW_LANES = 6;
const PREVIEW_CHIPS = 8;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function homeLinks(links: LinksFile | undefined, error: string | undefined, environments?: readonly string[]): HomeLinks {
  if (error) return { state: "error", error, groups: [], count: 0, warnings: [], howTo: LINKS_HOW_TO };
  if (!links) return { state: "none", groups: [], count: 0, warnings: [], howTo: LINKS_HOW_TO };
  const groups = links.groups.map((g, gi) => ({
    title: g.title, description: g.description,
    links: g.links.map((l, li): HomeLink => {
      const host = linkHost(l.url);
      return { group: gi, index: li, label: l.label, host, kind: l.kind, kindLabel: KIND_LABELS[l.kind], environment: l.environment, description: l.description, local: /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) };
    })
  }));
  return { state: "ok", title: links.title, groups, count: groups.reduce((n, g) => n + g.links.length, 0), warnings: linksProblems(links, environments), howTo: LINKS_HOW_TO };
}

export function homePreview(map: ProjectMap): HomePreview | undefined {
  if (!map.components.length) return undefined;
  const label = new Map(map.components.map(c => [c.id, c.label]));
  const lanes = map.subprojects.filter(s => s.componentIds.length).slice(0, PREVIEW_LANES).map(s => ({
    title: s.title, components: s.componentIds.slice(0, PREVIEW_CHIPS).map(id => label.get(id) ?? id), more: Math.max(0, s.componentIds.length - PREVIEW_CHIPS)
  }));
  return { lanes, components: map.components.length, relations: map.relations.length };
}

export function homeState(input: HomeInput): HomeState {
  const { map, shows } = input;
  const act = (id: string, label: string, extra?: string): HomeAction => {
    const surface = HOME_ACTIONS[id]?.surface;
    const disabled = extra ?? (surface && !shows(surface) ? "Hidden in this DataPass mode (DataPass: Switch Mode or Customize shows it)" : undefined);
    return disabled ? { id, label, disabled } : { id, label };
  };
  const noProject = input.hasProject ? undefined : "Open a DataPass project first";
  const links = homeLinks(input.links, input.linksError, map.environments.map(e => e.id));
  const repos = map.repositories.length;
  const local = map.repositories.filter(r => r.state === "local").length;
  const boardSummary = input.boardError ? "board.json has errors" : input.board
    ? `${plural(input.board.summary.open, "open card")}${input.board.summary.bugs ? ` · ${plural(input.board.summary.bugs, "bug")}` : ""}${input.board.summary.currentSprint ? ` · sprint ${input.board.summary.currentSprint}` : ""}`
    : "No board yet (.datapass/board.json)";

  const areas: HomeArea[] = [
    {
      id: "build", title: "Build & understand",
      tiles: [
        {
          id: "architecture", title: "Architecture",
          summary: map.components.length
            ? `${plural(map.components.length, "component")} in ${plural(map.subprojects.filter(s => !s.implicit).length || 1, "sub-project")}${input.optionsDecisions ? ` · ${plural(input.optionsDecisions, "decision")} with options` : ""}`
            : input.hasProject ? "No components yet (.datapass/graph.json)" : "No DataPass project in this window",
          actions: [act("architecture.workbench", "Open the diagram", noProject), act("architecture.panel", "Architecture panel", noProject), act("architecture.options", "Compare options", noProject), act("architecture.tree", "Project tree")]
        },
        {
          id: "understand", title: "Understand a file — DataPass Hop", coming: true,
          summary: "Coming: a file's code beside its visual explanation (PySpark and SQL first).",
          actions: []
        }
      ]
    },
    {
      id: "deliver", title: "Deliver",
      tiles: [
        {
          id: "git", title: "Git",
          summary: repos ? `${plural(repos, "repository", "repositories")} · ${local} on this computer` : "Repositories, worktrees, pull requests with CI",
          actions: [act("git.view", "Open the Git view")]
        },
        {
          id: "ai", title: "AI & work orders",
          summary: input.workOrdersEnabled ? "Copy a file for your AI, or hand a work order to Claude or Codex" : "Copy a file for your AI and paste its answer (work orders are off on this computer)",
          actions: [act("ai.view", "Open the AI view"), act("ai.workOrders", "Work orders", input.workOrdersEnabled ? undefined : "Work orders are off on this computer (setting datapass.ai.workOrders.enabled)"), act("ai.agentPanel", "Claude & Codex")]
        },
        {
          id: "board", title: "Board", attention: Boolean(input.boardError),
          summary: boardSummary,
          actions: [act("board.open", "Open the board", noProject), ...(input.boardError ? [act("board.file", "Open board.json")] : [])]
        }
      ]
    },
    {
      id: "run", title: "Run & reach",
      tiles: [
        {
          id: "readiness", title: "Readiness & tools",
          summary: map.summary.reposToBind ? `${plural(map.summary.reposToBind, "repository", "repositories")} to bind · env files, tools, connections` : "Env files, variables, tools and versions, connections",
          actions: [act("readiness.report", "Readiness report", noProject), act("readiness.toolkit", "Toolkit")]
        },
        {
          id: "links", title: "Project links", attention: links.state === "error",
          summary: links.state === "ok" ? `${plural(links.count, "link")} in ${plural(links.groups.length, "group")}` : links.state === "error" ? "links.json has errors" : LINKS_HOW_TO,
          actions: [act("links.page", "Open the links page", noProject), ...(links.state !== "none" ? [act("links.file", "Open links.json")] : [])]
        }
      ]
    }
  ];
  return {
    project: map.project ? { title: map.project.title, description: map.project.description } : undefined,
    areas,
    preview: homePreview(map),
    layouts: input.layouts,
    layoutsError: input.layoutsError,
    links
  };
}
