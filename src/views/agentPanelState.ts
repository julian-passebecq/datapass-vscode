/**
 * What the Claude & Codex panel shows (pass AI-3, handoff/v3/09 §7 and §8.7). Pure: built in the
 * extension host from Claude Control's sanitized snapshot and the quick-link setting. Links never
 * reach the webview: it names a row by a key, and the host looks the link up again and checks it.
 */
import type { ControlSnapshot } from "../work/controlService";
import { conversationStatusText, tokenText, type ControlProject, type QuickLink } from "../work/controlClient";

export interface PanelConversation { key: string; title: string; status: string; statusText: string; openable: boolean; tokens?: string }
export interface PanelPr { key: string; text: string; openable: boolean }
export interface PanelTodo { date?: string; what: string; duration?: string }
export interface PanelAlert { key: string; text: string; openable: boolean }
export interface PanelProject { name: string; conversations: PanelConversation[]; prs: PanelPr[]; todo: PanelTodo[]; alerts: PanelAlert[] }

export interface AgentPanelState {
  control: { state: ControlSnapshot["state"]; detail?: string; checkedAt?: string; message?: string };
  links: Array<{ label: string; index: number; title: string }>;
  refused: string[];
  plan?: { fiveHour?: number; week?: number };
  projects: PanelProject[];
  /** Folder names tried with Control when none matched. */
  tried: string[];
  codex: { cli: boolean };
  hasProject: boolean;
}

export const OFF_MESSAGE = "Claude Control is off. DataPass works normally; conversation status and token counts are hidden.";
export const DISABLED_MESSAGE = "Reading Claude Control is switched off (datapass.control.enabled). DataPass sends it no request.";

/** Conversations worth a look from here: running, waiting for you, or with an open PR. */
const SHOWN = new Set(["running", "needs-you", "pr-open"]);
const ORDER = ["needs-you", "running", "pr-open"];

function project(p: ControlProject): PanelProject {
  const conversations = p.sessions.filter(s => SHOWN.has(s.status)).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (b.last ?? "").localeCompare(a.last ?? "")).slice(0, 12)
    .map(s => ({ key: `c:${p.name}:${s.id}`, title: s.title ?? s.id, status: s.status, statusText: conversationStatusText(s.status), openable: !!s.link, tokens: tokenText(s.tokens) }));
  const prs = p.prs.slice(0, 12).map((pr, i) => ({ key: `p:${p.name}:${i}`, text: `${pr.repo ? `${pr.repo.split("/").pop()} ` : ""}#${pr.n ?? "?"}${pr.title ? ` · ${pr.title}` : ""}`, openable: !!pr.url }));
  const alerts = p.alerts.map((a, i) => ({ a, i })).filter(x => x.a.level === "urgent").slice(0, 6)
    .map(({ a, i }) => ({ key: `a:${p.name}:${i}`, text: a.text, openable: !!a.link }));
  return { name: p.name, conversations, prs, todo: p.todo.slice(0, 10), alerts };
}

export function agentPanelState(snap: ControlSnapshot, links: readonly QuickLink[], refused: readonly string[], codexCli: boolean, hasProject: boolean): AgentPanelState {
  const message = snap.state === "off" ? OFF_MESSAGE : snap.state === "disabled" ? DISABLED_MESSAGE : snap.state === "bad-url" ? snap.detail : undefined;
  return {
    control: { state: snap.state, detail: snap.state === "off" ? snap.detail : undefined, checkedAt: snap.checkedAt ? localTime(snap.checkedAt) : undefined, message },
    links: links.map((l, index) => ({ label: l.label, index, title: l.url })),
    refused: [...refused],
    plan: snap.state === "on" && snap.plan && (snap.plan.fiveHour !== undefined || snap.plan.week !== undefined) ? { fiveHour: snap.plan.fiveHour, week: snap.plan.week } : undefined,
    projects: snap.state === "on" ? snap.projects.map(project) : [],
    tried: snap.state === "on" && !snap.projects.length ? snap.tried : [],
    codex: { cli: codexCli },
    hasProject
  };
}

function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The link behind a panel key, re-read from the snapshot (undefined when it is gone or not allowed). */
export function linkOfKey(snap: ControlSnapshot, key: unknown): string | undefined {
  if (typeof key !== "string" || key.length > 300) return undefined;
  const m = /^([cpa]):([^:]{1,100}):(.{1,100})$/.exec(key);
  if (!m) return undefined;
  const p = snap.projects.find(x => x.name === m[2]);
  if (!p) return undefined;
  if (m[1] === "c") return p.sessions.find(s => s.id === m[3])?.link;
  const i = /^\d{1,3}$/.test(m[3]!) ? Number(m[3]) : -1;
  if (m[1] === "p") return p.prs[i]?.url;
  return p.alerts[i]?.link;
}
