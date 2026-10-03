/**
 * V5HOLE17 (V5 acceptance row 03): the `repo-history` binding of the "Repository history" (lanes) and "Repositories →
 * components" (Sankey) views, self-registered (NAVWIRE1: out/gen/bindings.ts). The host reads the repo set and each
 * repository's read-only `git log` (WorkSession.repoHistoryLogs) and hands them through `BindingContext.repoHistory`;
 * this provider only shapes them. While the host reads: a "loading" hole; with no host data: a typed hole, never a guess.
 */
import type { BindingProvider, BindingResult, BindingRow } from "../navigation/bindings";
import type { GraphView } from "@juliandatapass-group/view-spi";
import { componentPlaces } from "../exchange/fileContext";
import { buildRepoLanes, buildRepoSankey, REPO_HISTORY_SOURCE } from "./repoHistory";

export const REPO_HISTORY_LOADING = "Reading the repositories' history…";
export const REPO_HISTORY_UNAVAILABLE = "Repository history needs the workspace's Git, which this view host does not pass.";
export const REPO_HISTORY_EMPTY = "No repository in this workspace.";

export const repoHistoryProvider: BindingProvider = {
  source: REPO_HISTORY_SOURCE,
  provide: (ctx): BindingResult => {
    const data = ctx.repoHistory?.();
    if (data === "loading") return { holes: [{ reason: REPO_HISTORY_LOADING, kind: "loading" }], origin: "observed" };
    if (!data) return { holes: [{ reason: REPO_HISTORY_UNAVAILABLE, kind: "binding-unavailable" }], origin: "static" };
    if (data.error) return { holes: [{ reason: data.error, kind: "binding-failed" }], origin: "observed" };
    if (!data.set.repos.length) return { holes: [{ reason: REPO_HISTORY_EMPTY, kind: "not-declared" }], origin: "observed" };
    if (ctx.params?.facet === "sankey") {
      const s = buildRepoSankey(data.set, data.logs, ctx.projectMap ? componentPlaces(ctx.projectMap) : [], data.labels);
      return { graph: s.graph as unknown as GraphView, holes: s.holes, origin: "observed" };
    }
    const l = buildRepoLanes(data.set, data.logs, data.labels);
    // One row per commit, lane after lane (repo-set order), each lane newest first.
    const rows: BindingRow[] = l.lanes.flatMap(lane => lane.commits.map(c => ({
      id: `${lane.repo}:${c.rev}`, label: c.message || c.rev.slice(0, 7), origin: "observed" as const,
      repository: lane.label, date: c.date.slice(0, 10), author: c.author, commit: c.rev.slice(0, 7)
    })));
    return { rows, holes: l.holes, origin: "observed" };
  }
};

export default repoHistoryProvider;
