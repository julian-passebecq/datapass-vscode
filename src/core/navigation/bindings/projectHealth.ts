/**
 * V4-NAV NAVHOME1 binding `project-health`: the project dashboard at one glance — health tiles
 * (readiness, open items, drift, CI, pending reviews/approvals), the recent local commits, and what
 * waits for the local git user. Views only, from facts DataPass already holds: CI comes from the
 * pull-request cache the Git observer filled (never a new remote call; nothing cached = `unknown`),
 * recent changes from a bounded read-only `git log` the host runs. A fact the project lacks is a hole,
 * never a guess. Pure apart from the injected git runner.
 */
import type { ProjectMap } from "../../project/projectMap";
import { reviewColumn, type Board, type BoardView } from "../../project/board";
import type { CiState, HostPrs } from "../../git/hostPrs";
import type { NavLocation } from "../navTypes";
import type { NavHole, NavOrigin } from "./origin";

export const PROJECT_HEALTH_SOURCE = "project-health";
export const MAX_RECENT_PER_REPO = 20;
export const MAX_RECENT_TOTAL = 100;

export const HEALTH_TILE_IDS = ["readiness", "open-items", "drift", "ci", "reviews"] as const;
export type HealthTileId = (typeof HEALTH_TILE_IDS)[number];
/** Default for the setting `datapass.nav.dashboardTiles` (set and order). */
export const DEFAULT_DASHBOARD_TILES: readonly HealthTileId[] = HEALTH_TILE_IDS;
/** Default tile titles; the pack's view params may override them (labels are data). */
export const DEFAULT_TILE_TITLES: Readonly<Record<HealthTileId, string>> = {
  readiness: "Readiness", "open-items": "Open items", drift: "Drift", ci: "CI", reviews: "Pending reviews"
};

export type TileState = "ok" | "attention" | "blocked" | "unknown";

export interface HealthTile {
  readonly id: HealthTileId;
  readonly title: string;
  /** Main figure ("12/15", "3", "failing"); "—" when unknown. */
  readonly value: string;
  readonly detail: string;
  readonly state: TileState;
  readonly origin: NavOrigin;
  /** Tile click: the view (and its filter) the host opens with a `go` + `view` command. */
  readonly go: { readonly viewId: string; readonly filter?: string };
}

export interface RecentChange {
  readonly repoKey: string;
  readonly sha: string;
  readonly author: string;
  readonly email: string;
  /** ISO date (author date). */
  readonly date: string;
  readonly subject: string;
  readonly origin: NavOrigin;
}

export type AwaitingKind = "review" | "approval" | "pull-request" | "board";
export interface AwaitingRow {
  readonly kind: AwaitingKind;
  readonly id: string;
  readonly text: string;
  readonly origin: NavOrigin;
  readonly viewId: string;
  readonly url?: string;
}

/** An approval request found in the project files (supplied by the host when the project has any). */
export interface ApprovalRequest { readonly id: string; readonly title: string; readonly requestedFrom?: string; readonly done?: boolean }
/** Desired-vs-actual facts, when the project carries a reconcile result. */
export interface DriftFacts { readonly compared: number; readonly differing: number }

export interface ProjectHealthFacts {
  readonly map?: Pick<ProjectMap, "components" | "subprojects" | "problems">;
  /** NAVTODO1 `next-steps` total for the project root, once that binding is wired. */
  readonly nextStepsTotal?: number;
  /** Holes the other providers reported (the open-items count until `next-steps` is wired). */
  readonly holes?: readonly NavHole[];
  readonly drift?: DriftFacts;
  /** The Git observer's pull-request cache, per repository; never fetched here. */
  readonly prs?: ReadonlyArray<{ readonly repoKey: string; readonly prs: HostPrs }>;
  readonly board?: { readonly board: Board; readonly view: BoardView };
  readonly approvals?: readonly ApprovalRequest[];
  /** `git config user.name` / `user.email` of the local user, when known. */
  readonly gitUser?: { readonly name?: string; readonly email?: string };
  readonly recent?: readonly RecentChange[];
}

export interface ProjectHealthOptions {
  /** `datapass.nav.dashboardTiles`; unknown ids are dropped, an empty list falls back to the default. */
  readonly tiles?: readonly string[];
  readonly titles?: Readonly<Partial<Record<string, string>>>;
}

export interface ProjectHealthResult {
  readonly metrics: readonly HealthTile[];
  readonly recent: readonly RecentChange[];
  readonly awaiting: readonly AwaitingRow[];
  readonly holes: readonly { reason: string }[];
  readonly origin: NavOrigin;
}

/** The setting value made safe: known ids, no duplicates, default when empty. */
export function dashboardTiles(setting: readonly string[] | undefined): HealthTileId[] {
  const known = new Set<string>(HEALTH_TILE_IDS);
  const out: HealthTileId[] = [];
  for (const id of setting ?? []) if (known.has(id) && !out.includes(id as HealthTileId)) out.push(id as HealthTileId);
  return out.length ? out : [...DEFAULT_DASHBOARD_TILES];
}

const CI_RANK: Record<CiState, number> = { failing: 4, running: 3, unknown: 2, passing: 1, none: 0 };

export function projectHealth(facts: ProjectHealthFacts, opts: ProjectHealthOptions = {}): ProjectHealthResult {
  const holes: { reason: string }[] = [];
  const title = (id: HealthTileId) => opts.titles?.[id] ?? DEFAULT_TILE_TITLES[id];
  const unknown = (id: HealthTileId, detail: string, viewId: string): HealthTile =>
    ({ id, title: title(id), value: "—", detail, state: "unknown", origin: "static", go: { viewId } });

  const reviewCards = reviewCardsOf(facts.board);
  const openApprovals = (facts.approvals ?? []).filter(a => !a.done);

  const build: Record<HealthTileId, () => HealthTile> = {
    readiness: () => {
      const m = facts.map;
      if (!m) { holes.push({ reason: "readiness: no project map" }); return unknown("readiness", "No project map", "project-map"); }
      const all = [...m.components.map(c => c.health), ...m.subprojects.map(s => s.health)];
      const ok = all.filter(h => h === "ok" || h === "info").length;
      const blocked = all.filter(h => h === "blocked").length;
      const attention = all.filter(h => h === "attention").length + m.problems.filter(p => p.severity === "error").length;
      return { id: "readiness", title: title("readiness"), value: `${ok}/${all.length}`,
        detail: `${blocked} blocked · ${attention} need attention`, state: blocked ? "blocked" : attention ? "attention" : "ok",
        origin: "static", go: { viewId: "project-map", filter: blocked ? "blocked" : attention ? "attention" : undefined } };
    },
    "open-items": () => {
      const fromNext = facts.nextStepsTotal;
      const n = fromNext ?? (facts.holes?.length ?? 0) + (facts.map?.problems.length ?? 0);
      if (fromNext === undefined && !facts.holes && !facts.map) {
        holes.push({ reason: "open items: no next-steps or hole facts" });
        return unknown("open-items", "No next-steps facts", "next-steps");
      }
      return { id: "open-items", title: title("open-items"), value: String(n),
        detail: fromNext !== undefined ? "next steps" : "holes and map problems", state: n ? "attention" : "ok",
        origin: "static", go: { viewId: "next-steps" } };
    },
    drift: () => {
      const d = facts.drift;
      if (!d) { holes.push({ reason: "drift: this project has no desired-vs-actual facts" }); return unknown("drift", "No desired-vs-actual facts", "project-map"); }
      return { id: "drift", title: title("drift"), value: String(d.differing), detail: `${d.differing} of ${d.compared} differ`,
        state: d.differing ? "attention" : "ok", origin: "observed", go: { viewId: "project-map", filter: "drift" } };
    },
    ci: () => {
      const open = (facts.prs ?? []).flatMap(r => r.prs.open);
      if (!open.length) return unknown("ci", facts.prs?.length ? "No open pull request" : "No cached CI status", "recent-changes");
      const worst = open.map(p => p.ci.state).reduce<CiState>((w, s) => (CI_RANK[s] > CI_RANK[w] ? s : w), "none");
      const failing = open.filter(p => p.ci.state === "failing").length;
      return { id: "ci", title: title("ci"), value: worst, detail: `${open.length} open · ${failing} failing (cached)`,
        state: worst === "failing" ? "blocked" : worst === "running" || worst === "unknown" ? "attention" : worst === "passing" ? "ok" : "unknown",
        origin: "observed", go: { viewId: "recent-changes", filter: "ci" } };
    },
    reviews: () => {
      const reviewPrs = (facts.prs ?? []).flatMap(r => r.prs.open).filter(p => !p.draft && p.review === "review-required").length;
      if (!facts.board && !facts.approvals && !facts.prs) {
        holes.push({ reason: "reviews: no board, approval or pull-request facts" });
        return unknown("reviews", "No review facts", "awaiting-you");
      }
      const n = reviewCards.length + openApprovals.length + reviewPrs;
      return { id: "reviews", title: title("reviews"), value: String(n),
        detail: `${reviewCards.length} in review · ${openApprovals.length} approvals · ${reviewPrs} pull requests`,
        state: n ? "attention" : "ok", origin: "declared", go: { viewId: "awaiting-you" } };
    }
  };

  const metrics = dashboardTiles(opts.tiles).map(id => build[id]());
  if (!facts.recent) holes.push({ reason: "recent changes: git log not read" });
  return { metrics, recent: facts.recent ?? [], awaiting: awaitingYou(facts, reviewCards, openApprovals), holes, origin: "static" };
}

function reviewCardsOf(b: ProjectHealthFacts["board"]) {
  if (!b) return [];
  const col = reviewColumn(b.board);
  // Only an explicit review column counts as "pending review"; the fallback last open column does not.
  if (!col || col.id !== "review") return [];
  return b.view.cards.filter(c => !c.done && c.status === col.id);
}

/** True when `who` names the local git user (name or e-mail, case-insensitive). */
export function isLocalUser(who: string | undefined, user: ProjectHealthFacts["gitUser"]): boolean {
  const w = who?.trim().toLowerCase();
  if (!w || !user) return false;
  const name = user.name?.trim().toLowerCase();
  const email = user.email?.trim().toLowerCase();
  const handle = email?.split("@")[0];
  return w === name || w === email || (!!handle && (w === handle || w === `@${handle}`));
}

function awaitingYou(facts: ProjectHealthFacts, reviewCards: ReturnType<typeof reviewCardsOf>, approvals: readonly ApprovalRequest[]): AwaitingRow[] {
  const user = facts.gitUser;
  const rows: AwaitingRow[] = [];
  const seen = new Set<string>();
  const add = (r: AwaitingRow) => { const k = `${r.kind}:${r.id}`; if (!seen.has(k)) { seen.add(k); rows.push(r); } };
  // Review items: someone else's card waiting in review (yours waits for others, not for you).
  for (const c of reviewCards) if (!isLocalUser(c.assignee, user))
    add({ kind: "review", id: c.id, text: `${c.type} ${c.id}: ${c.title}`, origin: "declared", viewId: "board" });
  for (const a of approvals) if (!a.requestedFrom || isLocalUser(a.requestedFrom, user))
    add({ kind: "approval", id: a.id, text: a.title, origin: "declared", viewId: "awaiting-you" });
  for (const r of facts.prs ?? []) for (const p of r.prs.open) if (!p.draft && p.review === "review-required")
    add({ kind: "pull-request", id: `${r.repoKey}#${p.number}`, text: `${r.repoKey} #${p.number}: ${p.title}`, origin: "observed", viewId: "recent-changes", url: p.url });
  if (user && facts.board) for (const c of facts.board.view.cards) if (!c.done && isLocalUser(c.assignee, user))
    add({ kind: "board", id: c.id, text: `${c.type} ${c.id}: ${c.title}`, origin: "declared", viewId: "board" });
  return rows;
}

// ---- recent changes: bounded, read-only git log ----

const US = "\u001f", RS = "\u001e";
/** Read-only and bounded; run through the existing git runner (absolute git path, limiter). */
export const RECENT_LOG_ARGS: readonly string[] = ["log", `-n${MAX_RECENT_PER_REPO}`, "--no-color", `--pretty=format:%H${US}%an${US}%ae${US}%aI${US}%s${RS}`];

export function parseRecentLog(stdout: string, repoKey: string, max = MAX_RECENT_PER_REPO): RecentChange[] {
  const out: RecentChange[] = [];
  for (const rec of stdout.split(RS)) {
    const f = rec.replace(/^\s+/, "").split(US);
    const [sha = "", author = "", email = "", date = ""] = f;
    if (f.length < 5 || !/^[0-9a-f]{7,64}$/.test(sha)) continue;
    out.push({ repoKey, sha, author, email, date, subject: f.slice(4).join(" ").trim(), origin: "observed" });
    if (out.length >= max) break;
  }
  return out;
}

/** Runs `git <args>` in `cwd` and resolves its stdout, or undefined on failure (the host's runner). */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string | undefined>;

/** Recent commits of every repository, newest first, at most MAX_RECENT_TOTAL; a failed repo is a hole. */
export async function readRecentChanges(git: GitRunner, repos: ReadonlyArray<{ repoKey: string; folder: string }>):
  Promise<{ recent: RecentChange[]; holes: { reason: string }[] }> {
  const holes: { reason: string }[] = [];
  const all = (await Promise.all(repos.map(async r => {
    const out = await git(RECENT_LOG_ARGS, r.folder).catch(() => undefined);
    if (out === undefined) { holes.push({ reason: `recent changes: git log failed in ${r.repoKey}` }); return []; }
    return parseRecentLog(out, r.repoKey);
  }))).flat();
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { recent: all.slice(0, MAX_RECENT_TOTAL), holes };
}

/** The dashboard is a project-level view: other levels get nothing. */
export const isDashboardLocation = (l: NavLocation) => l.level === "project";
