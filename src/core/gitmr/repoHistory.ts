/**
 * V5 GITMR2: cross-repository history as two views of the navigation catalog (AC-N16, AC-V2), not a separate panel.
 *
 *   repo-lanes       `diff-history` kind (NAVREN3): one lane of commits per repository of the GITMR1 repo set
 *   repo-components  `graph` kind (NAVREN2): a Sankey repository → component, edge width = commits touching the component
 *
 * Pure (no `vscode`, no Git call): the read-only `git log` arguments, the parser of their output, and the builders of the
 * binding data the renderers draw. Components come from the project model (`ComponentPlace`, repository key + root).
 * Titles and labels are data (defaults here, overridden by settings); anything that cannot be placed is a typed hole.
 */
import type { ViewCatalog, ViewDef } from "../navigation/navTypes";
import { owningComponents, type ComponentPlace } from "../exchange/fileContext";
import type { RepoSet, RepoSetRepo } from "./repoSetContract";

/** Only the repo list is read: the set header (schema, edges, pins) does not matter here. */
type Repos = Pick<RepoSet, "repos">;
import { readOnlyGit } from "./readOnly";

/** Binding source of both views (a host slug: view-spi accepts any provider id). */
export const REPO_HISTORY_SOURCE = "repo-history";
export const REPO_LANES_VIEW = "repo-lanes";
export const REPO_COMPONENTS_VIEW = "repo-components";
/** Commits read per repository (newest first). */
export const REPO_LOG_LIMIT = 100;
/** Setting holding label overrides (`datapass.repoHistory.labels`). */
export const REPO_HISTORY_LABELS_SETTING = "repoHistory.labels";

const SEP = "\x1f";
const REC = "\x1e";
const SHA = /^[0-9a-f]{40}$/;

export interface RepoHistoryLabels {
  readonly lanesTitle: string;
  readonly componentsTitle: string;
  readonly repositories: string;
  readonly components: string;
  /** `{n}` = number of commits. */
  readonly commits: string;
  readonly unplaced: string;
  readonly noComponent: string;
  readonly logFailed: string;
}
export const DEFAULT_REPO_HISTORY_LABELS: RepoHistoryLabels = {
  lanesTitle: "Repository history",
  componentsTitle: "Repositories → components",
  repositories: "Repositories",
  components: "Components",
  commits: "{n} commits",
  unplaced: "Changed files outside any component",
  noComponent: "No component of the project model lives in this repository",
  logFailed: "Git history could not be read"
};

/** Default labels with any string override (≤ 80 chars) from settings; unknown keys and other types are ignored. */
export function repoHistoryLabels(raw: unknown): RepoHistoryLabels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_REPO_HISTORY_LABELS;
  const out: Record<string, string> = { ...DEFAULT_REPO_HISTORY_LABELS };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k in DEFAULT_REPO_HISTORY_LABELS && typeof v === "string" && v.trim() && v.length <= 80) out[k] = v.trim();
  }
  return out as unknown as RepoHistoryLabels;
}

// ------------------------------------------------------------------ catalog

/** The two views, as catalog data (titles are default labels; users rename them through view overrides). */
export function repoHistoryViews(labels: RepoHistoryLabels = DEFAULT_REPO_HISTORY_LABELS): ViewDef[] {
  return [
    { id: REPO_LANES_VIEW, title: labels.lanesTitle, layout: "diff-history", bindings: [{ source: REPO_HISTORY_SOURCE, params: { facet: "lanes" } }],
      description: "Commits of every repository of the workspace, one lane per repository." },
    { id: REPO_COMPONENTS_VIEW, title: labels.componentsTitle, layout: "graph", bindings: [{ source: REPO_HISTORY_SOURCE, params: { facet: "sankey" } }],
      description: "Which components each repository's recent commits changed." }
  ];
}

/** The catalog with the two views at the end of the project and sub-project entries (idempotent: re-applying refreshes titles). */
export function withRepoHistoryViews(catalog: ViewCatalog, labels: RepoHistoryLabels = DEFAULT_REPO_HISTORY_LABELS): ViewCatalog {
  const add = repoHistoryViews(labels);
  const ours = new Set(add.map(v => v.id));
  return {
    ...catalog,
    entries: catalog.entries.map(e => {
      if (!(e.level === "project" || e.level === "subproject") || e.artifactKind !== e.level) return e;
      return { ...e, views: [...e.views.filter(v => !ours.has(v.id)), ...add] };
    })
  };
}

// ------------------------------------------------------------------ git log (read-only)

export interface RepoCommit {
  readonly rev: string;
  readonly author: string;
  /** ISO 8601 author date. */
  readonly date: string;
  readonly message: string;
  /** Repository-relative paths the commit changed. */
  readonly files: readonly string[];
}

/** `git log` of a whole repository's current branch: header line, then the changed file names. No merges. */
export function repoLogArgs(limit = REPO_LOG_LIMIT): string[] {
  return ["log", "--no-merges", "-n", String(limit), `--format=${REC}%H${SEP}%an${SEP}%aI${SEP}%s`, "--name-only"];
}

export function parseRepoLog(stdout: string, limit = REPO_LOG_LIMIT): RepoCommit[] {
  const out: RepoCommit[] = [];
  for (const record of stdout.split(REC)) {
    const lines = record.split(/\r?\n/);
    const [rev, author, date, ...rest] = (lines[0] ?? "").split(SEP);
    if (!rev || !SHA.test(rev)) continue;
    const files = lines.slice(1).map(l => l.trim()).filter(Boolean);
    out.push({ rev, author: (author ?? "").trim(), date: (date ?? "").trim(), message: rest.join(SEP).trim(), files });
    if (out.length >= limit) break;
  }
  return out;
}

/** One repository's log as read by the host: commits, or the reason it could not be read. */
export interface RepoLog { readonly repo: string; readonly commits: readonly RepoCommit[]; readonly error?: string }

// ------------------------------------------------------------------ binding data

/** Shapes of the renderers' inputs (NAVREN1 `BindingData`, NAVREN2 `datapass.graph-view/1`), structural. */
export interface HistoryHole { readonly reason: string; readonly kind?: string; readonly field?: string }
export interface Lane { readonly repo: string; readonly label: string; readonly role: string; readonly commits: readonly RepoCommit[] }
export interface LanesData { readonly source: string; readonly origin: "static"; readonly holes: readonly HistoryHole[]; readonly lanes: readonly Lane[] }

function repoLabel(r: RepoSetRepo): string {
  return r.path === "." ? r.id : r.path.split("/").filter(Boolean).pop() ?? r.id;
}

function logHoles(logs: readonly RepoLog[], labels: RepoHistoryLabels): HistoryHole[] {
  return logs.filter(l => l.error !== undefined).map(l => ({ kind: "git-log-failed", reason: `${labels.logFailed}: ${l.error}`, field: l.repo }));
}

/** Lanes in repo-set order; each lane newest first. A repository with no log is a hole, not an empty lane. */
export function buildRepoLanes(set: Repos, logs: readonly RepoLog[], labels: RepoHistoryLabels = DEFAULT_REPO_HISTORY_LABELS): LanesData {
  const byRepo = new Map(logs.filter(l => l.error === undefined).map(l => [l.repo, l.commits]));
  const lanes: Lane[] = [];
  for (const r of set.repos) {
    const commits = byRepo.get(r.id);
    if (!commits) continue;
    lanes.push({ repo: r.id, label: repoLabel(r), role: r.role, commits: [...commits].sort((a, b) => b.date.localeCompare(a.date)) });
  }
  return { source: REPO_HISTORY_SOURCE, origin: "static", holes: logHoles(logs, labels), lanes };
}

export interface SankeyData { readonly source: string; readonly origin: "static"; readonly holes: readonly HistoryHole[]; readonly graph: GraphView }
interface NodeStyle { readonly shape: string; readonly color: string; readonly border: string }
interface EdgeStyle { readonly line: string; readonly color: string; readonly width: number; readonly arrow: string }
export interface GraphView {
  readonly schema: "datapass.graph-view/1";
  readonly groups: { id: string; label: string; memberCount: number; collapsed: boolean; color: string }[];
  readonly nodes: { id: string; kind: string; label: string; groupId: string | null; origin: string; certain: boolean; memberIds: string[]; style: NodeStyle }[];
  readonly edges: { id: string; fromId: string; toId: string; kinds: string[]; origin: string; certain: boolean; volumetry: { label: string } | null; style: EdgeStyle }[];
  readonly legend: { label: string; target: "node" | "edge"; ruleId: string; nodeStyle: NodeStyle | null; edgeStyle: EdgeStyle | null }[];
}

const REPO_STYLE: NodeStyle = { shape: "rect", color: "repository", border: "solid" };
const COMPONENT_STYLE: NodeStyle = { shape: "rect", color: "component", border: "solid" };
/** Sankey band width range (px): the busiest flow gets the max. */
const MIN_WIDTH = 1;
const MAX_WIDTH = 12;

/** Repository keys a component may name for a repo-set repository: its slug id or its host repository id. */
function repoKeys(r: RepoSetRepo): string[] {
  return r.repositoryId ? [r.id, r.repositoryId] : [r.id];
}

/**
 * Sankey repository → component over the logs' commits. A commit counts once per component it touched (deepest
 * owning root, `owningComponents`). Files no component owns are counted per repository as a hole, never guessed.
 */
export function buildRepoSankey(set: Repos, logs: readonly RepoLog[], components: readonly ComponentPlace[],
  labels: RepoHistoryLabels = DEFAULT_REPO_HISTORY_LABELS): SankeyData {
  const holes = logHoles(logs, labels);
  const logOf = new Map(logs.filter(l => l.error === undefined).map(l => [l.repo, l.commits]));
  const flows = new Map<string, { repo: string; component: string; commits: number }>();
  const touched = new Map<string, ComponentPlace>();
  const repos: RepoSetRepo[] = [];
  for (const r of set.repos) {
    const commits = logOf.get(r.id);
    if (!commits) continue;
    repos.push(r);
    const keys = repoKeys(r);
    const placed = components.filter(c => c.repoKey !== undefined && keys.includes(c.repoKey));
    if (!placed.length) { holes.push({ kind: "no-component", reason: labels.noComponent, field: r.id }); continue; }
    let unplaced = 0;
    for (const c of commits) {
      const hit = new Set<string>();
      for (const f of c.files) {
        const owners = keys.flatMap(k => owningComponents(k, f, placed));
        if (!owners.length) unplaced++;
        for (const o of owners) hit.add(o.id);
      }
      for (const id of hit) {
        const key = `${r.id}\u0000${id}`;
        const flow = flows.get(key) ?? { repo: r.id, component: id, commits: 0 };
        flow.commits++;
        flows.set(key, flow);
        touched.set(id, placed.find(p => p.id === id)!);
      }
    }
    if (unplaced) holes.push({ kind: "unplaced-files", reason: `${labels.unplaced} (${unplaced})`, field: r.id });
  }
  const max = Math.max(1, ...[...flows.values()].map(f => f.commits));
  const width = (n: number) => Math.round((MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * (n / max)) * 10) / 10;
  const comps = [...touched.values()].sort((a, b) => a.id.localeCompare(b.id));
  const graph: GraphView = {
    schema: "datapass.graph-view/1",
    groups: [
      { id: "repositories", label: labels.repositories, memberCount: repos.length, collapsed: false, color: "repository" },
      { id: "components", label: labels.components, memberCount: comps.length, collapsed: false, color: "component" }
    ],
    nodes: [
      ...repos.map(r => ({ id: `repo:${r.id}`, kind: "repository", label: repoLabel(r), groupId: "repositories", origin: "static", certain: true, memberIds: [], style: REPO_STYLE })),
      ...comps.map(c => ({ id: `component:${c.id}`, kind: c.kind ?? "component", label: c.label, groupId: "components", origin: "static", certain: true, memberIds: [], style: COMPONENT_STYLE }))
    ],
    edges: [...flows.values()].sort((a, b) => b.commits - a.commits || a.repo.localeCompare(b.repo) || a.component.localeCompare(b.component)).map(f => ({
      id: `flow:${f.repo}:${f.component}`, fromId: `repo:${f.repo}`, toId: `component:${f.component}`, kinds: ["changes"], origin: "static", certain: true,
      volumetry: { label: labels.commits.replace("{n}", String(f.commits)) },
      style: { line: "solid", color: "repository", width: width(f.commits), arrow: "none" }
    })),
    legend: [
      { label: labels.repositories, target: "node", ruleId: "kind:repository", nodeStyle: REPO_STYLE, edgeStyle: null },
      { label: labels.components, target: "node", ruleId: "kind:component", nodeStyle: COMPONENT_STYLE, edgeStyle: null }
    ]
  };
  return { source: REPO_HISTORY_SOURCE, origin: "static", holes, graph };
}

/** NAVREN3 `HistoryCommit` rows of one lane (the diff-history renderer draws one list per lane). */
export function laneRows(lane: Lane): { rev: string; date: string; author: string; message: string; files: readonly string[] }[] {
  return lane.commits.map(c => ({ rev: c.rev, date: c.date, author: c.author, message: c.message, files: c.files }));
}

// ------------------------------------------------------------------ provider (Git through the caller's runner)

/** Same runner shape as GITMR1's `RepoSetDeps.git`: read-only `git log` only, never fetch. */
export type RepoLogRunner = (args: string[], cwd: string, timeoutMs: number) => Promise<{ ok: boolean; stdout: string; stderr?: string }>;
const LOG_TIMEOUT_MS = 15_000;
const LOG_CONCURRENCY = 4;

/** Each repository's log, at most `LOG_CONCURRENCY` Git processes at once; a failure is that repo's error, never a throw. */
export async function readRepoLogs(set: Repos, absPath: (repoPath: string) => string, git: RepoLogRunner, limit = REPO_LOG_LIMIT): Promise<RepoLog[]> {
  const run = readOnlyGit(git);
  const queue = [...set.repos];
  const out = new Map<string, RepoLog>();
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const res = await run(repoLogArgs(limit), absPath(r.path), LOG_TIMEOUT_MS);
        out.set(r.id, res.ok ? { repo: r.id, commits: parseRepoLog(res.stdout, limit) } : { repo: r.id, commits: [], error: (res.stderr ?? "").trim().split(/\r?\n/)[0] || "git log failed" });
      } catch (e) {
        out.set(r.id, { repo: r.id, commits: [], error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOG_CONCURRENCY, queue.length) }, worker));
  return set.repos.map(r => out.get(r.id)!);
}

/** The `repo-history` binding provider: `facet` "lanes" (diff-history) or "sankey" (graph). */
export function repoHistoryBinding(facet: unknown, set: Repos, logs: readonly RepoLog[], components: readonly ComponentPlace[],
  labels: RepoHistoryLabels = DEFAULT_REPO_HISTORY_LABELS): LanesData | SankeyData {
  return facet === "sankey" ? buildRepoSankey(set, logs, components, labels) : buildRepoLanes(set, logs, labels);
}
