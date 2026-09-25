/**
 * Work orders (pass AI-2): what an order has become, on separate axes (handoff/v3/09 §3.2, §8.4,
 * §8.5). Pure. Nothing here collapses the axes into one green light:
 *
 *   order    written · launched · reported · done · abandoned (state.json, DataPass)
 *   output   per repository to change: no PR · PR open (CI) · merged · merged, not pulled · closed ·
 *            not checked (git + the host's CLI, found by the planned branch, even without a result)
 *   result   none · valid (the agent says done / partial / blocked / failed) · refused (why)
 *
 * "Done" is the person's to set; DataPass suggests it when every PR is merged and pulled. What a
 * result claims is shown as "the agent says", never as a check.
 */
import type { CiState, ReviewState } from "../git/hostPrs";
import type { GitRepoReport, NeedsYou } from "../git/gitReport";
import { shortId, type CheckedResult, type OrderState, type ResultVerdict, type SeenPr, type WorkOrder } from "./format";
import { CHOICE_LABELS, choiceOf } from "./launch";

export type ResultInfo =
  | { state: "none" }
  | { state: "valid"; checked: CheckedResult; at?: string }
  | { state: "refused"; why: Exclude<ResultVerdict, { ok: true }>["why"]; message: string; at?: string };

export interface RepoOutput {
  ref: string;
  access: "change" | "read";
  branch?: string;
  state: "read-only" | "not-checked" | "no-pr" | "open" | "merged" | "closed";
  /** Why it is not checked (no host CLI, not cloned…). */
  why?: string;
  pr?: { number: number; url: string; title?: string; ci?: CiState; review?: ReviewState; draft?: boolean; failing?: string[] };
  /** Merged on the host and in this clone's default branch (false: Get updates). */
  pulled?: boolean;
  /** The PR the result names, when DataPass did not find it by branch. */
  claimed?: { number: number; url: string };
}

export interface TimelineEntry { at?: string; what: string; detail?: string[]; tone?: "ok" | "warn" | "error" | "muted" }

export interface OrderSummary {
  id: string;
  short: string;
  title: string;
  kind: WorkOrder["kind"];
  createdAt: string;
  status: OrderState["status"];
  agent: string;
  scope: string;
  outputs: RepoOutput[];
  result: ResultInfo;
  changedAfterLaunch: boolean;
  /** Plain-language items that need the person, most urgent first. */
  needs: string[];
  suggestDone: boolean;
  next: string;
  timeline: TimelineEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CI_TEXT: Record<CiState, string> = { passing: "CI ✓", failing: "CI ✗", running: "CI ●", none: "no CI", unknown: "CI not reported" };

/** Find each repository's PR by the planned branch (open, then merged/closed), else by the number the result names. */
export function discoverOutputs(order: WorkOrder, checked: CheckedResult | undefined, reportOf: (ref: string) => GitRepoReport | undefined): RepoOutput[] {
  return order.repositories.map(repo => {
    if (repo.access === "read") return { ref: repo.ref, access: "read", state: "read-only" };
    const claimed = checked?.pullRequests.find(p => p.ref === repo.ref);
    const base: RepoOutput = { ref: repo.ref, access: "change", branch: repo.branch, state: "no-pr", ...(claimed ? { claimed: { number: claimed.number, url: claimed.url } } : {}) };
    const r = reportOf(repo.ref);
    if (!r || r.state !== "ok") return { ...base, state: "not-checked", why: r?.detail ?? "this repository is not checked here" };
    if (!r.prs) {
      const why = r.hostData.kind === "links" ? `pull requests are not read here (${r.hostData.tool ?? "host CLI"}: ${r.hostData.reason})` : "no Git host";
      return { ...base, state: "not-checked", why };
    }
    const open = r.prs.find(p => p.head === repo.branch) ?? (claimed ? r.prs.find(p => p.number === claimed.number) : undefined);
    if (open) {
      const { claimed: _c, ...rest } = base;
      return { ...rest, state: "open", pr: { number: open.number, url: open.url, title: open.title, ci: open.ci.state, review: open.review, draft: open.draft, failing: open.ci.failed.map(f => f.name).slice(0, 3) } };
    }
    const closed = (r.closed ?? []).find(p => p.head === repo.branch) ?? (claimed ? (r.closed ?? []).find(p => p.number === claimed.number) : undefined);
    if (closed) {
      const { claimed: _c, ...rest } = base;
      const pulled = closed.state === "merged" ? r.mergeNotPulled?.number !== closed.number : undefined;
      return { ...rest, state: closed.state, pr: { number: closed.number, url: closed.url, title: closed.title }, ...(pulled !== undefined ? { pulled } : {}) };
    }
    return base;
  });
}

/** PRs as seen now, for state.json's display cache (never evidence). */
export function seenPullRequests(outputs: readonly RepoOutput[], now: string): SeenPr[] {
  return outputs.filter(o => o.pr && (o.state === "open" || o.state === "merged" || o.state === "closed")).map(o => ({
    repoRef: o.ref, url: o.pr!.url, number: o.pr!.number, state: o.state as SeenPr["state"],
    ...(o.pr!.ci ? { ci: o.pr!.ci } : {}), headBranch: o.branch ?? "", checkedAt: now
  })).filter(p => p.headBranch);
}

function scopeText(o: WorkOrder): string {
  const parts = [o.scope.subproject, o.scope.components?.join(", "), o.scope.boardCard ? `card ${o.scope.boardCard}` : "", o.scope.decision ? `decision ${o.scope.decision}` : ""].filter(Boolean);
  return parts.join(" › ") || "whole project";
}

function outputText(o: RepoOutput): string {
  switch (o.state) {
    case "read-only": return `${o.ref}: read only`;
    case "not-checked": return `${o.ref}: ${o.claimed ? `PR #${o.claimed.number} (the agent says) · ` : ""}not checked (${o.why})`;
    case "no-pr": return `${o.ref}: no PR for ${o.branch}${o.claimed ? ` (the result names #${o.claimed.number}, not found)` : ""}`;
    case "open": return `${o.ref} #${o.pr!.number} open · ${CI_TEXT[o.pr!.ci ?? "unknown"]}${o.pr!.draft ? " · draft" : ""}${o.pr!.review === "approved" ? " · approved" : o.pr!.review === "changes-requested" ? " · changes requested" : ""}`;
    case "merged": return `${o.ref} #${o.pr!.number} merged${o.pulled === false ? " · not pulled here: Get updates" : " ✓ pulled"}`;
    case "closed": return `${o.ref} #${o.pr!.number} closed without merging`;
  }
}
export { outputText };

export interface SummaryInput {
  order: WorkOrder;
  state: OrderState;
  result: ResultInfo;
  outputs: RepoOutput[];
  /** order.json + order.md + attachments now, to compare with state.digest. */
  digestNow?: string;
  now: number;
}

export function summarize(i: SummaryInput): OrderSummary {
  const { order: o, state: s, result, outputs } = i;
  const closed = s.status === "done" || s.status === "abandoned";
  const changedAfterLaunch = !!i.digestNow && i.digestNow !== s.digest && s.launches.length > 0;
  const needs: string[] = [];
  const changes = outputs.filter(x => x.access === "change");
  if (!closed) {
    for (const x of changes) {
      if (x.state === "open" && x.pr?.ci === "failing") needs.push(`${x.ref} #${x.pr.number}: CI failed${x.pr.failing?.length ? ` (${x.pr.failing.join(", ")})` : ""}`);
    }
    if (result.state === "refused") needs.push(`result refused: ${result.message}`);
    if (result.state === "valid") {
      const q = result.checked.result.questions?.length ?? 0;
      if (q) needs.push(`${q} question${q === 1 ? "" : "s"} from the agent`);
      if (result.checked.result.status === "blocked" || result.checked.result.status === "failed") needs.push(`the agent says it is ${result.checked.result.status}`);
    }
    for (const x of changes) {
      if (x.state === "open" && x.pr?.ci !== "failing" && x.pr?.ci !== "running" && !x.pr?.draft && o.policy.merge === "person") needs.push(`${x.ref} #${x.pr!.number}: review and merge`);
      if (x.state === "merged" && x.pulled === false) needs.push(`${x.ref} #${x.pr!.number} merged: Get updates`);
    }
    if (o.expected.pullRequests === "one-per-changed-repository" && noPrNeed(o, s, result, outputs, i.now)) needs.push("no pull request yet");
    if (changedAfterLaunch) needs.push("the order was changed on disk after its launch");
  }
  const allMerged = changes.length > 0 && changes.every(x => x.state === "merged" && x.pulled !== false);
  const suggestDone = !closed && (o.expected.pullRequests === "none" ? result.state === "valid" && result.checked.result.status === "done" : allMerged);
  const next = closed ? (s.status === "done" ? "Done." : "Abandoned.")
    : suggestDone ? "Everything is merged and pulled: mark it done, then publish the summary."
    : !s.launches.length ? "Launch it (Claude or Codex), or copy it for a chat."
    : result.state === "none" && changes.every(x => x.state === "no-pr" || x.state === "not-checked") ? "The agent is working, or has not written its result yet."
    : changes.some(x => x.state === "open") ? (o.policy.merge === "person" ? "Review and merge the pull requests, then Get updates." : "The agent merges its pull requests when CI is green; then Get updates.")
    : changes.some(x => x.state === "merged" && x.pulled === false) ? "Get updates to bring the merged work here."
    : result.state === "valid" && result.checked.result.questions?.length ? "Answer the agent's questions in a follow-up order."
    : "Check the result and the pull requests.";

  const timeline: TimelineEntry[] = [];
  const nChange = o.repositories.filter(r => r.access === "change").length, nRead = o.repositories.length - nChange;
  timeline.push({ at: o.createdAt, what: `written · ${o.kind} · ${nChange} repositor${nChange === 1 ? "y" : "ies"} to change${nRead ? `, ${nRead} to read` : ""}`, detail: [scopeText(o), ...(o.context.attachments.length ? [`attachments: ${o.context.attachments.join(", ")}`] : [])] });
  for (const l of s.launches) {
    const label = CHOICE_LABELS[choiceOf(l.tool, l.surface)];
    timeline.push({ at: l.at, what: l.how === "copied" ? `prompt copied for ${label}` : `launched · ${label}`, detail: [`effort ${o.agent.effort}${o.agent.model ? ` · model ${o.agent.model}` : ""}${l.sessionId ? ` · session ${l.sessionId.slice(0, 8)}…` : ""}`] });
  }
  if (result.state === "valid") {
    const r = result.checked.result;
    const detail = [r.summary];
    for (const c of r.checks ?? []) detail.push(`check: ${c.what} ${c.outcome}${c.note ? ` (${c.note})` : ""} — the agent says`);
    for (const q of r.questions ?? []) detail.push(`question: ${q}`);
    for (const f of r.followUps ?? []) detail.push(`follow-up: ${f.title}${f.why ? ` — ${f.why}` : ""}`);
    for (const w of result.checked.warnings) detail.push(`⚠ ${w}`);
    timeline.push({ at: r.finishedAt ?? result.at, what: `result: ${r.status} (the agent says)`, detail, tone: r.status === "done" ? "ok" : "warn" });
  } else if (result.state === "refused") {
    timeline.push({ at: result.at, what: "result refused", detail: [result.message], tone: "error" });
  }
  for (const x of changes) timeline.push({ what: outputText(x), tone: x.state === "open" && x.pr?.ci === "failing" ? "error" : x.state === "merged" && x.pulled !== false ? "ok" : x.state === "no-pr" || x.state === "not-checked" ? "muted" : undefined });
  for (const imp of s.imported ?? []) timeline.push({ at: imp.at, what: `imported proposed ${imp.kind}.json`, detail: imp.backup ? [`backup ${imp.backup}`] : [] });
  if (s.published) timeline.push({ at: s.published.at, what: "summary published", detail: [[s.published.workLog ? ".datapass/work-log.json" : "", s.published.privateLog ? "private log repository" : ""].filter(Boolean).join(" · ")] });
  if (s.closed) timeline.push({ at: s.closed.at, what: s.closed.how === "done" ? "marked done" : "abandoned", detail: s.closed.note ? [s.closed.note] : [], tone: s.closed.how === "done" ? "ok" : "muted" });

  return {
    id: o.id, short: shortId(o.id), title: o.title, kind: o.kind, createdAt: o.createdAt, status: s.status,
    agent: CHOICE_LABELS[choiceOf(o.agent.tool, o.agent.surface)], scope: scopeText(o),
    outputs, result, changedAfterLaunch, needs, suggestDone, next, timeline
  };
}

/** Rule 8's condition: a change order whose result names no PR, or launched a day ago with neither a result nor a PR. */
function noPrNeed(o: WorkOrder, s: OrderState, result: ResultInfo, outputs: readonly RepoOutput[], now: number): boolean {
  const missing = outputs.filter(x => x.access === "change" && x.state === "no-pr");
  if (!missing.length) return false;
  if (result.state === "valid") return result.checked.result.status === "done" || result.checked.result.status === "partial";
  const launched = s.launches.map(l => Date.parse(l.at)).filter(Number.isFinite);
  return result.state === "none" && launched.length > 0 && now - Math.max(...launched) > DAY_MS;
}

/**
 * Needs you rule 8 for the Git view: a work order whose result names no PR, or whose planned branch
 * has no PR a day after its launch. Only repositories whose PRs the host's CLI reported count.
 */
export function workOrderNeedsYou(items: ReadonlyArray<{ order: WorkOrder; state: OrderState; result: ResultInfo; outputs: RepoOutput[] }>, reportKeyOf: (ref: string) => string | undefined, labelOf: (key: string) => string, now: number): NeedsYou[] {
  const out: NeedsYou[] = [];
  for (const it of items) {
    if (it.state.status === "done" || it.state.status === "abandoned" || it.order.expected.pullRequests === "none") continue;
    if (!noPrNeed(it.order, it.state, it.result, it.outputs, now)) continue;
    for (const x of it.outputs.filter(y => y.access === "change" && y.state === "no-pr")) {
      const key = reportKeyOf(x.ref);
      if (key === undefined) continue;
      const why = it.result.state === "valid" ? "its result names no pull request" : "no result and no pull request a day after the launch";
      out.push({
        rank: 8, kind: "work-order-no-pr", repoKey: key, section: "project", repoLabel: labelOf(key),
        text: `work order ${shortId(it.order.id)}: no PR for ${x.branch}`, detail: `${it.order.title} · ${why}`,
        action: "open-work-order", order: it.order.id
      });
    }
  }
  return out;
}
