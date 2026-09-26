/**
 * What the AI view's Agent and Manual tabs show (pass AI-2, Julian's three modes in handoff/v3/09
 * §13.1). Built in the extension host; only names, states and short texts reach the webview —
 * never a local path, a goal text of another order or anything the agent wrote except its status,
 * questions count and PR numbers.
 */
import type { WorkOrderService } from "../work/workOrders";
import type { WorkSession } from "../work/session";
import { AGENT_CHOICES, CHOICE_LABELS, stampLabel, stampVerdict, type AgentChoice } from "../core/workOrders/launch";
import { selectionStamp } from "../work/packStamps";
import { withStale, type PackStamp } from "../core/exchange/stamp";
import { EFFORTS, ORDER_KINDS, shortId, type Effort, type MergePolicy, type OrderKind, type ProjectType } from "../core/workOrders/format";
import { KIND_LABELS } from "../core/workOrders/builder";
import { TYPE_DEFAULTS, defaultMergePolicy } from "../core/workOrders/projectType";
import { outputText } from "../core/workOrders/status";
import type { ExportScope } from "../core/workOrders/export";
import type { PilotCard, PilotService } from "../work/pilot";

export interface AgentRecent {
  id: string;
  short: string;
  title: string;
  status: string;
  agent: string;
  createdAt: string;
  outputs: string[];
  result?: string;
  needs: string[];
  next: string;
  suggestDone: boolean;
  canResume: boolean;
  error?: string;
  /** 0.27 (P1, D-23): "Built for <variant>" or "not stamped"; `otherVariant` when the selection has changed since. */
  stamp?: string;
  otherVariant?: boolean;
}

export interface AgentTabState {
  verdict: { allowed: boolean; why: string; fix?: string };
  projectType: { type: ProjectType; source: string; explain: string };
  defaults: { choice: AgentChoice; effort: Effort; merge: MergePolicy; exportScope: ExportScope; model?: string };
  choices: Array<{ id: AgentChoice; label: string }>;
  kinds: Array<{ id: OrderKind; label: string }>;
  efforts: readonly Effort[];
  subprojects: Array<{ id: string; title: string }>;
  components: Array<{ id: string; label: string; subproject?: string; repoKey?: string }>;
  cards: Array<{ id: string; title: string }>;
  decisions: Array<{ id: string; title: string }>;
  columns: Array<{ id: string; title: string }>;
  repos: Array<{ key: string; label: string; coordination: boolean; usable: boolean; note: string }>;
  coordinationKey: string;
  selection: { subproject?: string; component?: string };
  recent: AgentRecent[];
  counts: { total: number; open: number; needs: number };
  /** 0.24 (AI-3): a Codex CLI is configured or on PATH (terminal launch, `codex app <folder>`). */
  codex?: { cli: boolean };
}

export interface ManualTabState {
  gitNeeds: number;
  problems: number;
  filesMissing: number;
  opsReady: string;
  behind: number;
}

export function agentTabState(session: WorkSession, service: WorkOrderService, settings: { choice: AgentChoice; effort: Effort; model?: string; exportScope: ExportScope; codexCli?: boolean }): AgentTabState {
  const map = session.projectMap();
  const ctx = session.project;
  const verdict = service.verdict();
  const type = service.projectType();
  const list = service.list();
  const selected = selectionStamp(session);
  const recent: AgentRecent[] = list.slice(0, 6).map(o => {
    const s = o.summary;
    if (!o.order || !s) return { id: o.id, short: shortId(o.id), title: o.error ?? "unreadable order", status: "error", agent: "", createdAt: "", outputs: [], needs: [], next: "Open its folder to see what is wrong.", suggestDone: false, canResume: false, error: o.error };
    return {
      id: o.id, short: s.short, title: s.title, status: s.status, agent: s.agent, createdAt: s.createdAt,
      outputs: s.outputs.filter(x => x.access === "change").map(outputText),
      result: s.result.state === "valid" ? `${s.result.checked.result.status} (the agent says)` : s.result.state === "refused" ? `refused: ${s.result.message}` : undefined,
      needs: s.needs, next: s.next, suggestDone: s.suggestDone,
      canResume: Boolean(o.order.agent.sessionId) && o.state?.launches.some(l => l.how === "launched") === true,
      stamp: o.order.stamp ? `Built for ${stampLabel(o.order)}` : stampLabel(o.order),
      ...(stampVerdict(o.order, selected).kind === "other-variant" ? { otherVariant: true } : {})
    };
  });
  const repos = map.repositories.map(r => ({
    key: r.key, label: r.label, coordination: r.coordination, usable: r.state === "local",
    note: r.state === "local" ? (r.git?.changes ? `${r.git.changes} uncommitted file${r.git.changes === 1 ? "" : "s"} here (not part of the base)` : "cloned") : r.detail
  }));
  if (!map.repositories.some(r => r.coordination) && session.root) repos.unshift({ key: map.coordinationKey, label: "Coordination repository", coordination: true, usable: true, note: "this folder" });
  return {
    verdict: { allowed: verdict.allowed, why: verdict.why, fix: verdict.allowed ? undefined : verdict.fix },
    projectType: { type: type.type, source: type.source === "machine" ? "this computer's setting" : type.source === "manifest" ? "project.json" : "default", explain: TYPE_DEFAULTS[type.type].explain },
    defaults: { choice: settings.choice, effort: settings.effort, merge: defaultMergePolicy(type.type), exportScope: settings.exportScope, model: settings.model },
    choices: AGENT_CHOICES.map(id => ({ id, label: CHOICE_LABELS[id] })),
    // 0.26: pilot orders are written from the Pilot tab.
    kinds: ORDER_KINDS.filter(id => id !== "pilot-read").map(id => ({ id, label: KIND_LABELS[id] })),
    efforts: EFFORTS,
    subprojects: map.subprojects.filter(s => !s.implicit).map(s => ({ id: s.id, title: s.title })),
    components: map.components.map(c => ({ id: c.id, label: c.label, subproject: c.subprojects[0], repoKey: c.repoKey })),
    cards: (ctx.board?.items ?? []).filter(i => !session.boardView()?.cards.find(c => c.id === i.id)?.done).slice(0, 200).map(i => ({ id: i.id, title: i.title })),
    decisions: (ctx.options?.decisions ?? []).map(d => ({ id: d.id, title: d.title })),
    columns: session.boardView()?.columns.map(c => ({ id: c.id, title: c.title })) ?? [],
    repos,
    coordinationKey: map.coordinationKey,
    selection: session.selection(),
    recent,
    codex: settings.codexCli === undefined ? undefined : { cli: settings.codexCli },
    counts: { total: list.length, open: list.filter(o => o.state && o.state.status !== "done" && o.state.status !== "abandoned").length, needs: list.reduce((n, o) => n + (o.summary?.needs.length ?? 0), 0) }
  };
}

export function manualTabState(session: WorkSession, gitNeeds: number): ManualTabState {
  const map = session.projectMap();
  return {
    gitNeeds,
    problems: map.problems.filter(p => p.severity === "error").length,
    filesMissing: map.summary.filesMissing,
    opsReady: `${map.summary.opsReady}/${map.summary.opsTotal}`,
    behind: map.repositories.reduce((n, r) => n + (r.git?.behind ?? 0), 0)
  };
}


// ------------------------------------------------------------------ 0.26 (AI-4a): the Pilot tab

export interface PilotTabState {
  /** datapass.pilot.enabled on this computer, and the work-order verdict (a pilot order is a work order). */
  enabled: boolean;
  allowed: boolean;
  why?: string;
  fix?: "pilot-setting" | "machine-setting" | "trust" | "project-module";
  choices: Array<{ id: AgentChoice; label: string; disabled?: string }>;
  defaults: { choice: AgentChoice; effort: Effort };
  efforts: readonly Effort[];
  components: Array<{ id: string; label: string }>;
  environment: string;
  orders: Array<{ id: string; short: string; title: string; status: string; agent: string; next: string; canLaunch: boolean }>;
  cards: PilotCard[];
  pending: number;
}

export function pilotTabState(session: WorkSession, service: WorkOrderService, pilot: PilotService, settings: { choice: AgentChoice; effort: Effort; enabled: boolean; codexAppQualified: boolean; trusted: boolean; now?: PackStamp }): PilotTabState {
  const verdict = service.verdict();
  const allowed = settings.enabled && verdict.allowed;
  const choices = AGENT_CHOICES.map(id => ({ id, label: CHOICE_LABELS[id], ...(id === "codex-desktop" && !settings.codexAppQualified ? { disabled: "not qualified on this computer yet (stage 1)" } : {}) }));
  const choice = choices.find(c => c.id === settings.choice && !c.disabled)?.id ?? "claude-terminal";
  return {
    enabled: settings.enabled, allowed,
    ...(allowed ? {} : settings.enabled
      ? { why: verdict.why, fix: (verdict.allowed ? undefined : verdict.fix) as PilotTabState["fix"] }
      : { why: "Pilot mode is off on this computer. It lets an agent read your dev cloud read-only (az, func) and ask DataPass for VS Code actions you click.", fix: "pilot-setting" as const }),
    choices, defaults: { choice, effort: settings.effort }, efforts: EFFORTS,
    components: session.projectMap().components.map(c => ({ id: c.id, label: c.label })),
    environment: "dev",
    orders: pilot.pilotOrders().slice(0, 6).map(o => {
      const s = o.summary;
      const closed = o.state?.status === "done" || o.state?.status === "abandoned";
      return { id: o.id, short: shortId(o.id), title: s?.title ?? o.error ?? "unreadable order", status: s?.status ?? "error", agent: s?.agent ?? "", next: s?.next ?? "", canLaunch: allowed && settings.trusted && !closed && Boolean(o.order) && Boolean(service.ownDigest(o.id)) };
    }),
    // 0.27 (P1, D-23): a card whose order was built for another variant or bridge revision is stale.
    cards: withStale(pilot.list(), id => service.get(id)?.order?.stamp, settings.now),
    pending: pilot.pending()
  };
}
