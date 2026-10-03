/**
 * V5 GITMR3: cross-repository change impact. A change in repository A (NAVCHG1 change set, paths relative to A) is
 * followed through the workspace lineage graph (evidence paths relative to the workspace root) to the artifacts it
 * reaches in the other repositories of the repo set; a change to a Common package also reaches every repository that
 * vendors that package (repo-set / manifest pins). Declared repo edges into A that no lineage path or pin explains
 * are listed as holes: downstream artifacts there are unknown, never guessed.
 * Pure: the repo set, change set, lineage graph and pins are inputs. Labels and legend are data (settings).
 */
import type { ViewCatalog, ViewDef } from "../navigation/navTypes";
import type { Pin } from "./pinDrift";
import type { ChangedFile, ChangeStatus, ImpactLineageLike, RepoSetLike, RepoSetRepoLike } from "./stubs";

export const CROSS_REPO_SOURCE = "cross-repo-impact";
export const CROSS_REPO_IMPACT_VIEW = "cross-repo-impact";
export const PIN_DRIFT_VIEW = "common-pin-drift";
export const CROSS_REPO_LABELS_SETTING = "crossRepoImpact.labels";
export const CROSS_REPO_DEFAULTS = { depth: 4, maxNodes: 300, edgeKinds: ["reads", "writes", "derives"] as readonly string[] };

export interface CrossRepoLabels {
  readonly impactTitle: string;
  readonly pinDriftTitle: string;
  /** `{repo}` = repository id. */
  readonly repoGroup: string;
  /** `{package}`, `{repo}`. */
  readonly vendoredCopy: string;
  /** `{kind}`, `{repo}`, `{source}`. */
  readonly unexplainedEdge: string;
  readonly noLineage: string;
  readonly unplacedNode: string;
  readonly noChange: string;
}
export const DEFAULT_CROSS_REPO_LABELS: CrossRepoLabels = {
  impactTitle: "Cross-repository impact",
  pinDriftTitle: "Common pin drift",
  repoGroup: "{repo}",
  vendoredCopy: "{package} (vendored in {repo})",
  unexplainedEdge: "{repo} declares a '{kind}' edge to {source}, but no lineage path or pin reaches it: downstream artifacts there are unknown.",
  noLineage: "No lineage graph for this workspace yet: only vendored copies and declared repository edges are shown.",
  unplacedNode: "Lineage node outside every repository of the repo set",
  noChange: "No changed file in this repository."
};

/** Default labels with any string override (≤ 200 chars) from settings; unknown keys and other types are ignored. */
export function crossRepoLabels(raw: unknown): CrossRepoLabels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_CROSS_REPO_LABELS;
  const out: Record<string, string> = { ...DEFAULT_CROSS_REPO_LABELS };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k in DEFAULT_CROSS_REPO_LABELS && typeof v === "string" && v.trim() && v.length <= 200) out[k] = v.trim();
  }
  return out as unknown as CrossRepoLabels;
}
const fill = (t: string, v: Readonly<Record<string, string | number>>): string => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

// ------------------------------------------------------------------ paths

const posix = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
/** Workspace-relative path of a file of `repo`. */
export function workspacePath(repo: Pick<RepoSetRepoLike, "path">, file: string): string {
  const root = posix(repo.path).replace(/\/+$/, "");
  return root === "" || root === "." ? posix(file) : `${root}/${posix(file)}`;
}
/** The repository owning a workspace-relative path: the deepest repo root containing it ("." owns the rest). */
export function owningRepo(repos: readonly RepoSetRepoLike[], path: string): RepoSetRepoLike | undefined {
  const p = posix(path);
  let best: RepoSetRepoLike | undefined, depth = -1;
  for (const r of repos) {
    const root = posix(r.path).replace(/\/+$/, "");
    const d = root === "" || root === "." ? 0 : (p === root || p.startsWith(root + "/")) ? root.length : -1;
    if (d > depth) { best = r; depth = d; }
  }
  return best;
}

// ------------------------------------------------------------------ impact

export type CrossStatus = Exclude<ChangeStatus, "renamed"> | "impacted" | "vendored";
export type CrossVia = "change" | "lineage" | "vendored";
export interface CrossNode { readonly id: string; readonly label: string; readonly kind: string; readonly repo: string | null; readonly status: CrossStatus; readonly distance: number; readonly via: CrossVia }
export interface CrossEdge { readonly id: string; readonly fromId: string; readonly toId: string; readonly kind: string }
export interface CrossHole { readonly reason: string; readonly kind: "no-lineage" | "unexplained-edge" | "unplaced-node" | "no-change"; readonly repo?: string }
export interface CrossRepoImpact {
  readonly source: string;
  readonly nodes: readonly CrossNode[];
  readonly edges: readonly CrossEdge[];
  /** Downstream repositories with the number of their artifacts reached (lineage) or vendored copies affected. */
  readonly byRepo: readonly { readonly repo: string; readonly artifacts: number; readonly vendored: number }[];
  readonly holes: readonly CrossHole[];
  readonly truncated: boolean;
}
export interface CrossRepoInput {
  readonly set: RepoSetLike;
  /** Repository id of the change. */
  readonly sourceRepo: string;
  /** Changed files, relative to the source repository. */
  readonly files: readonly ChangedFile[];
  readonly lineage: ImpactLineageLike | null;
  /** Vendored pins (repo set + manifests, `mergePins`). */
  readonly pins: readonly Pin[];
  /** Package name → `packages/<dir>` in the Common clone (pin drift `packageDirs`). */
  readonly packageDirs?: Readonly<Record<string, string>>;
}

const NOT_SHIPPED = /(^|\/)(tests?|__tests__|fixtures|node_modules|dist)\//;
const toStatus = (s: ChangeStatus): CrossStatus => (s === "renamed" ? "modified" : s);
const merge = (a: CrossStatus | undefined, b: CrossStatus): CrossStatus => (a === undefined || a === b ? b : "modified");

export function crossRepoImpact(input: CrossRepoInput, opts: Partial<typeof CROSS_REPO_DEFAULTS> = {}, labels: CrossRepoLabels = DEFAULT_CROSS_REPO_LABELS): CrossRepoImpact {
  const depth = Math.max(0, Math.min(8, opts.depth ?? CROSS_REPO_DEFAULTS.depth));
  const maxNodes = Math.max(1, Math.min(2000, opts.maxNodes ?? CROSS_REPO_DEFAULTS.maxNodes));
  const kinds = new Set(opts.edgeKinds ?? CROSS_REPO_DEFAULTS.edgeKinds);
  const { set, sourceRepo, files } = input;
  const repo = set.repos.find(r => r.id === sourceRepo);
  const holes: CrossHole[] = [];
  const nodes = new Map<string, CrossNode>();
  const edges = new Map<string, CrossEdge>();
  let truncated = false;
  if (!repo || !files.length) {
    holes.push({ kind: "no-change", reason: labels.noChange, repo: sourceRepo });
    return { source: sourceRepo, nodes: [], edges: [], byRepo: [], holes, truncated };
  }

  // 1. Lineage: seeds = nodes with evidence in a changed file; walk downstream (data-flow direction), bounded.
  if (!input.lineage) holes.push({ kind: "no-lineage", reason: labels.noLineage });
  else {
    const g = input.lineage;
    const byPath = new Map<string, ChangeStatus>();
    for (const f of files) { byPath.set(workspacePath(repo, f.path), f.status); if (f.oldPath) byPath.set(workspacePath(repo, f.oldPath), f.status); }
    const seeds = new Map<string, CrossStatus>();
    for (const n of g.nodes) for (const e of n.evidence) {
      const s = e.locator && byPath.get(posix(e.locator.path));
      if (s) seeds.set(n.id, merge(seeds.get(n.id), toStatus(s)));
    }
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    const dist = new Map<string, number>([...seeds.keys()].map(id => [id, 0]));
    let frontier = new Set(seeds.keys());
    for (let d = 1; d <= depth && frontier.size; d += 1) {
      const next = new Set<string>();
      for (const e of g.edges) {
        if (!kinds.has(e.kind) || !frontier.has(e.fromId) || !byId.has(e.toId)) continue;
        if (!dist.has(e.toId)) {
          if (dist.size >= maxNodes) { truncated = true; continue; }
          dist.set(e.toId, d); next.add(e.toId);
        }
        edges.set(e.id, { id: e.id, fromId: e.fromId, toId: e.toId, kind: e.kind });
      }
      frontier = next;
    }
    let unplaced = 0;
    for (const [id, distance] of dist) {
      const n = byId.get(id)!;
      const path = n.evidence.find(e => e.locator)?.locator?.path;
      const owner = path ? owningRepo(set.repos, path) : undefined;
      if (!owner) unplaced += 1;
      nodes.set(id, { id, label: n.name, kind: n.kind, repo: owner?.id ?? null, status: seeds.get(id) ?? "impacted", distance, via: seeds.has(id) ? "change" : "lineage" });
    }
    if (unplaced) holes.push({ kind: "unplaced-node", reason: `${labels.unplacedNode} (${unplaced})` });
  }

  // 2. Vendored copies: changed shipped files under packages/<dir>/ of the source repo reach every pin of that package.
  const dirToName = new Map(Object.entries(input.packageDirs ?? {}).map(([name, dir]) => [dir, name]));
  const changedDirs = new Map<string, CrossStatus>();
  for (const f of files) {
    const m = /^packages\/([^/]+)\/(.+)$/.exec(posix(f.path));
    if (m && !NOT_SHIPPED.test(m[2]!)) changedDirs.set(m[1]!, merge(changedDirs.get(m[1]!), toStatus(f.status)));
  }
  for (const [dir, status] of changedDirs) {
    const name = dirToName.get(dir) ?? `@juliandatapass-group/${dir}`;
    const consumers = input.pins.filter(p => p.name === name && p.repo !== sourceRepo);
    if (!consumers.length) continue;
    const pkgId = `package:${sourceRepo}:${dir}`;
    if (!nodes.has(pkgId)) nodes.set(pkgId, { id: pkgId, label: name, kind: "package", repo: sourceRepo, status, distance: 0, via: "change" });
    for (const p of consumers) {
      const id = `vendored:${p.repo}:${name}`;
      nodes.set(id, { id, label: fill(labels.vendoredCopy, { package: name, repo: p.repo }), kind: "vendored-package", repo: p.repo, status: "vendored", distance: 1, via: "vendored" });
      edges.set(`${pkgId}->${id}`, { id: `${pkgId}->${id}`, fromId: pkgId, toId: id, kind: "vendors" });
    }
  }

  // 3. Per downstream repo; declared edges into the source repo with nothing reached are holes.
  const counts = new Map<string, { artifacts: number; vendored: number }>();
  for (const n of nodes.values()) {
    if (!n.repo || n.repo === sourceRepo) continue;
    const c = counts.get(n.repo) ?? { artifacts: 0, vendored: 0 };
    if (n.via === "vendored") c.vendored += 1; else c.artifacts += 1;
    counts.set(n.repo, c);
  }
  for (const e of set.edges) {
    if (e.to !== sourceRepo || e.from === sourceRepo || counts.has(e.from)) continue;
    holes.push({ kind: "unexplained-edge", repo: e.from, reason: fill(labels.unexplainedEdge, { kind: e.kind, repo: e.from, source: sourceRepo }) });
  }
  const byRepo = [...counts].map(([r, c]) => ({ repo: r, ...c })).sort((a, b) => a.repo.localeCompare(b.repo));
  return { source: sourceRepo, nodes: [...nodes.values()], edges: [...edges.values()], byRepo, holes, truncated };
}

/** Only what crosses a repository boundary: downstream nodes in other repos, plus the changed nodes they come from. */
export function crossRepoOnly(impact: CrossRepoImpact): CrossRepoImpact {
  const outside = new Set(impact.nodes.filter(n => n.repo !== null && n.repo !== impact.source).map(n => n.id));
  const keepEdges = impact.edges.filter(e => outside.has(e.toId));
  const keep = new Set([...outside, ...keepEdges.map(e => e.fromId)]);
  return { ...impact, nodes: impact.nodes.filter(n => keep.has(n.id)), edges: keepEdges };
}

// ------------------------------------------------------------------ binding data (graph view, table rows)

interface NodeStyle { readonly shape: string; readonly color: string; readonly border: string }
interface EdgeStyle { readonly line: string; readonly color: string; readonly width: number; readonly arrow: string }
/** Status → look (legend data; `params.legend` of a view overrides entries). Colours are theme tokens. */
export const DEFAULT_CROSS_LEGEND: Readonly<Record<CrossStatus, { label: string; style: NodeStyle }>> = {
  added: { label: "Added", style: { shape: "rect", color: "added", border: "solid" } },
  modified: { label: "Modified", style: { shape: "rect", color: "modified", border: "solid" } },
  removed: { label: "Removed", style: { shape: "rect", color: "removed", border: "dashed" } },
  impacted: { label: "Impacted downstream", style: { shape: "rect", color: "impacted", border: "dotted" } },
  vendored: { label: "Vendored copy (will drift)", style: { shape: "rect", color: "vendored", border: "double" } }
};
const EDGE_STYLE: EdgeStyle = { line: "solid", color: "edge", width: 1, arrow: "end" };

export interface CrossGraphView {
  readonly schema: "datapass.graph-view/1";
  readonly groups: { id: string; label: string; memberCount: number; collapsed: boolean; color: string }[];
  readonly nodes: { id: string; kind: string; label: string; groupId: string | null; origin: string; certain: boolean; memberIds: string[]; style: NodeStyle }[];
  readonly edges: { id: string; fromId: string; toId: string; kinds: string[]; origin: string; certain: boolean; volumetry: { label: string } | null; style: EdgeStyle }[];
  readonly legend: { label: string; target: "node" | "edge"; ruleId: string; nodeStyle: NodeStyle | null; edgeStyle: EdgeStyle | null }[];
}
export interface CrossImpactData { readonly source: string; readonly origin: "static"; readonly holes: readonly CrossHole[]; readonly graph: CrossGraphView; readonly truncated: boolean }

/** One group per repository; nodes styled by status from the legend data. */
export function crossRepoGraph(impact: CrossRepoImpact, labels: CrossRepoLabels = DEFAULT_CROSS_REPO_LABELS,
  legend: Readonly<Record<CrossStatus, { label: string; style: NodeStyle }>> = DEFAULT_CROSS_LEGEND): CrossImpactData {
  const members = new Map<string, string[]>();
  for (const n of impact.nodes) if (n.repo) members.set(n.repo, [...(members.get(n.repo) ?? []), n.id]);
  const groups = [...members].map(([repo, ids]) => ({ id: `repo:${repo}`, label: fill(labels.repoGroup, { repo }), memberCount: ids.length, collapsed: false, color: "repository" }));
  const used = new Set(impact.nodes.map(n => n.status));
  return {
    source: CROSS_REPO_SOURCE, origin: "static", holes: impact.holes, truncated: impact.truncated,
    graph: {
      schema: "datapass.graph-view/1", groups,
      nodes: impact.nodes.map(n => ({ id: n.id, kind: n.kind, label: n.label, groupId: n.repo ? `repo:${n.repo}` : null, origin: "static", certain: n.via !== "lineage" || n.distance <= 1, memberIds: [], style: legend[n.status].style })),
      edges: impact.edges.map(e => ({ id: e.id, fromId: e.fromId, toId: e.toId, kinds: [e.kind], origin: "static", certain: true, volumetry: null, style: EDGE_STYLE })),
      legend: (Object.keys(legend) as CrossStatus[]).filter(s => used.has(s)).map(s => ({ label: legend[s].label, target: "node" as const, ruleId: `status:${s}`, nodeStyle: legend[s].style, edgeStyle: null }))
    }
  };
}

// ------------------------------------------------------------------ catalog

export function crossRepoViews(labels: CrossRepoLabels = DEFAULT_CROSS_REPO_LABELS): ViewDef[] {
  return [
    { id: CROSS_REPO_IMPACT_VIEW, title: labels.impactTitle, layout: "graph", bindings: [{ source: CROSS_REPO_SOURCE, params: { part: "impact" } }],
      description: "What the open change reaches in the other repositories: lineage downstream and vendored Common copies." },
    { id: PIN_DRIFT_VIEW, title: labels.pinDriftTitle, layout: "table", bindings: [{ source: CROSS_REPO_SOURCE, params: { part: "pins" } }],
      description: "Vendored Common packages of each repository against Common main in the local clone (ok, behind, digest mismatch, unknown)." }
  ];
}

/** The catalog with the two views at the end of the project and sub-project entries (idempotent). */
export function withCrossRepoViews(catalog: ViewCatalog, labels: CrossRepoLabels = DEFAULT_CROSS_REPO_LABELS): ViewCatalog {
  const add = crossRepoViews(labels);
  const ours = new Set(add.map(v => v.id));
  return {
    ...catalog,
    entries: catalog.entries.map(e => {
      if (!(e.level === "project" || e.level === "subproject") || e.artifactKind !== e.level) return e;
      return { ...e, views: [...e.views.filter(v => !ours.has(v.id)), ...add] };
    })
  };
}
