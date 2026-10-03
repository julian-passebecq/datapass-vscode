/**
 * V5 GITMR1: the "Repositories" Context section — the repo set and each repo's read-only status.
 *
 * Shaped like a NAVCTX1 `ContextSectionProvider` (tab id + `provide()` → body, origin, holes) so it registers as-is once the
 * Context view has a "repositories" tab (NAVCTX1 !209, one SURFACES line; the on/off and labels settings come with that wiring).
 * Titles and role labels are data (`repositoriesLabels` takes overrides). Pure: the caller loads the set and the statuses.
 */
import type { RepoSet, RepoSetRole } from "../../core/gitmr/repoSetContract";
import type { RepoSetIssue, RepoSetStatus } from "../../core/gitmr/repoSet";

export const REPOSITORIES_TAB = "repositories";

export interface RepositoriesLabels {
  readonly title: string;
  readonly roles: Readonly<Record<RepoSetRole, string>>;
  readonly clean: string;
  readonly noUpstream: string;
  readonly notARepo: string;
  readonly empty: string;
}
export const DEFAULT_REPOSITORIES_LABELS: RepositoriesLabels = {
  title: "Repositories",
  roles: { app: "App", common: "Common", infra: "Infrastructure", data: "Data", docs: "Docs", other: "Other" },
  clean: "clean", noUpstream: "no upstream", notARepo: "not a Git repository",
  empty: "No repository found in this workspace."
};

/** Default labels with any valid string overrides (≤ 60 chars). */
export function repositoriesLabels(overrides: unknown): RepositoriesLabels {
  const o = overrides && typeof overrides === "object" ? overrides as Record<string, unknown> : {};
  const pick = (v: unknown, d: string) => typeof v === "string" && v.trim() && v.length <= 60 ? v.trim() : d;
  const roles = o.roles && typeof o.roles === "object" ? o.roles as Record<string, unknown> : {};
  const d = DEFAULT_REPOSITORIES_LABELS;
  return {
    title: pick(o.title, d.title),
    roles: Object.fromEntries(Object.entries(d.roles).map(([k, v]) => [k, pick(roles[k], v)])) as Record<RepoSetRole, string>,
    clean: pick(o.clean, d.clean), noUpstream: pick(o.noUpstream, d.noUpstream), notARepo: pick(o.notARepo, d.notARepo), empty: pick(o.empty, d.empty)
  };
}

/** One line per repo: `id (role) · path · branch · ↑a ↓b · n changes`, then the declared edges. */
export function repositoriesBody(set: RepoSet, statuses: readonly RepoSetStatus[], labels: RepositoriesLabels = DEFAULT_REPOSITORIES_LABELS): string {
  if (!set.repos.length) return labels.empty;
  const byId = new Map(statuses.map(s => [s.id, s]));
  const lines = set.repos.map(r => {
    const s = byId.get(r.id);
    const parts = [`${r.id} (${labels.roles[r.role]})`, r.path];
    if (!s || s.state !== "ok") parts.push(labels.notARepo);
    else {
      parts.push(s.branch ?? "?");
      parts.push(!s.upstream ? labels.noUpstream : `↑${s.ahead ?? 0} ↓${s.behind ?? 0}`);
      parts.push(s.dirty ? `${s.dirty} change${s.dirty === 1 ? "" : "s"}` : labels.clean);
    }
    if (r.remote) parts.push(r.remote.url);
    return `- ${parts.join(" · ")}`;
  });
  for (const e of set.edges) lines.push(`- ${e.from} → ${e.to} (${e.kind}${e.reason ? `: ${e.reason}` : ""})`);
  return lines.join("\n");
}

/** A provider for the Context view: observed Git state, issues as holes. */
export function createRepositoriesProvider(load: () => Promise<{ set: RepoSet; statuses: readonly RepoSetStatus[]; issues: readonly RepoSetIssue[] }>, labels: RepositoriesLabels = DEFAULT_REPOSITORIES_LABELS) {
  return {
    tab: REPOSITORIES_TAB,
    async provide() {
      const { set, statuses, issues } = await load();
      return { body: repositoriesBody(set, statuses, labels), origin: "observed", holes: issues.map(i => ({ reason: `${i.path}: ${i.reason}` })) };
    }
  };
}
