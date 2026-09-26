/**
 * What the AI view's Agent and Manual tabs show (pass AI-2, Julian's three modes in handoff/v3/09
 * §13.1). Built in the extension host; only names, states and short texts reach the webview —
 * never a local path, a goal text of another order or anything the agent wrote except its status,
 * questions count and PR numbers.
 */
import type { WorkOrderService } from "../work/workOrders";
import type { WorkSession } from "../work/session";
import { AGENT_CHOICES, CHOICE_LABELS, type AgentChoice } from "../core/workOrders/launch";
import { EFFORTS, ORDER_KINDS, shortId, type Effort, type MergePolicy, type OrderKind, type ProjectType } from "../core/workOrders/format";
import { KIND_LABELS } from "../core/workOrders/builder";
import { TYPE_DEFAULTS, defaultMergePolicy } from "../core/workOrders/projectType";
import { outputText } from "../core/workOrders/status";
import type { ExportScope } from "../core/workOrders/export";

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
  const recent: AgentRecent[] = list.slice(0, 6).map(o => {
    const s = o.summary;
    if (!o.order || !s) return { id: o.id, short: shortId(o.id), title: o.error ?? "unreadable order", status: "error", agent: "", createdAt: "", outputs: [], needs: [], next: "Open its folder to see what is wrong.", suggestDone: false, canResume: false, error: o.error };
    return {
      id: o.id, short: s.short, title: s.title, status: s.status, agent: s.agent, createdAt: s.createdAt,
      outputs: s.outputs.filter(x => x.access === "change").map(outputText),
      result: s.result.state === "valid" ? `${s.result.checked.result.status} (the agent says)` : s.result.state === "refused" ? `refused: ${s.result.message}` : undefined,
      needs: s.needs, next: s.next, suggestDone: s.suggestDone,
      canResume: Boolean(o.order.agent.sessionId) && o.state?.launches.some(l => l.how === "launched") === true
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
    kinds: ORDER_KINDS.map(id => ({ id, label: KIND_LABELS[id] })),
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

