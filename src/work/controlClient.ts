/**
 * Claude Control client (pass AI-3, handoff/v3/09 §7 and §9). Plain Node, no `vscode`: the panel and
 * the Work orders view call it from the extension host, the unit tests against a fake server.
 *
 * Control is Julian's local dashboard (`python server/server.py` in the claude-control repository),
 * bound to 127.0.0.1:7430. DataPass only reads four GET endpoints, each with a short timeout:
 *
 *   /api/health                  is Control on
 *   /api/status                  plan usage (5-hour and weekly percentages)
 *   /api/project/<name>          sessions, open PRs, "À faire par toi" rows, alerts of one project
 *   /api/work-orders?ids=…       conversations whose first message is a DataPass order's marker
 *                                (Galaxy contract claude-control-api.work-orders/1)
 *
 * Everything Control returns is untrusted: a rogue process could listen on the port while Control is
 * off. Only allowlisted fields are kept, text is bounded and flattened, and links are kept only when
 * they are `claude://claude.ai/epitaxy/<id>` or an https pull-request page on a known Git host.
 * Never kept: `task`, `last_user`, `last_claude`, `agents`, `mode` and the project `info`.
 */
import * as http from "node:http";

export const DEFAULT_CONTROL_URL = "http://127.0.0.1:7430";
/** Control answers `Host: 127.0.0.1:<port>` or `localhost:<port>` only (DNS-rebinding guard), so DataPass talks to nothing else. */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})\/?$/;
export const HEALTH_TIMEOUT_MS = 800;
export const READ_TIMEOUT_MS = 3000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_ORDER_IDS = 50;
const ORDER_ID = /^wo-\d{8}-\d{4}-[0-9a-z]{4}$/;

export type Failure = "off" | "timeout" | "bad-json" | "too-big" | "http" | "bad-url";
export type Fetched<T> = { ok: true; data: T } | { ok: false; reason: Failure; detail: string };

/** The Control address, if it is loopback http (anything else is refused before any request). */
export function controlBase(url: string | undefined): string | undefined {
  const m = LOOPBACK.exec((url ?? DEFAULT_CONTROL_URL).trim());
  if (!m) return undefined;
  const port = Number(m[2]);
  return port >= 1 && port <= 65535 ? `http://${m[1]}:${port}` : undefined;
}

/** One GET with a timeout and a size cap; the body must be JSON. */
export function getJson(base: string, pathAndQuery: string, timeoutMs = READ_TIMEOUT_MS): Promise<Fetched<unknown>> {
  const b = controlBase(base);
  if (!b) return Promise.resolve({ ok: false, reason: "bad-url", detail: "Claude Control's address must be http://127.0.0.1:<port> or http://localhost:<port>." });
  return new Promise(resolve => {
    let done = false;
    const finish = (r: Fetched<unknown>) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const req = http.get(`${b}${pathAndQuery}`, { headers: { Accept: "application/json" }, agent: false }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) { finish({ ok: false, reason: "too-big", detail: "Claude Control's answer is too large." }); req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        if (res.statusCode !== 200) { finish({ ok: false, reason: "http", detail: `Claude Control answered HTTP ${res.statusCode}.` }); return; }
        try { finish({ ok: true, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch { finish({ ok: false, reason: "bad-json", detail: "Claude Control's answer is not JSON." }); }
      });
      res.on("error", () => finish({ ok: false, reason: "off", detail: "Claude Control closed the connection." }));
    });
    const timer = setTimeout(() => { finish({ ok: false, reason: "timeout", detail: `Claude Control did not answer within ${timeoutMs} ms.` }); req.destroy(); }, timeoutMs);
    req.on("error", () => finish({ ok: false, reason: "off", detail: "Claude Control is not running." }));
  });
}

// ------------------------------------------------------------------ sanitizing

const rec = (x: unknown): Record<string, unknown> | undefined => (x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : undefined);
const list = (x: unknown, max: number): unknown[] => (Array.isArray(x) ? x.slice(0, max) : []);
/** One line of plain text, bounded (Control's data is shown as text only). */
export function text(x: unknown, max = 200): string | undefined {
  if (typeof x !== "string" && typeof x !== "number") return undefined;
  const s = String(x).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : undefined;
}
const num = (x: unknown, max = 1e12): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : undefined);
const pct = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : undefined);
const when = (x: unknown): string | undefined => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(x) ? x.slice(0, 19) : undefined);

/** `claude://claude.ai/epitaxy/<id>`: the only conversation link DataPass opens. */
export const CONVERSATION_LINK = /^claude:\/\/claude\.ai\/epitaxy\/[A-Za-z0-9_-]{1,100}$/;
/** Pull-request pages on the Git hosts DataPass knows. */
export const PR_LINK = /^https:\/\/(github\.com|gitlab\.com|dev\.azure\.com|[a-z0-9-]{1,60}\.visualstudio\.com)\/[A-Za-z0-9_.~%\/-]{1,300}$/;
export const safeConversationLink = (x: unknown): string | undefined => (typeof x === "string" && CONVERSATION_LINK.test(x) ? x : undefined);
export const safePrLink = (x: unknown): string | undefined => (typeof x === "string" && PR_LINK.test(x) && !x.includes("..") ? x : undefined);

export type ConversationStatus = "running" | "needs-you" | "idle" | "pr-open" | "archived" | "other";
const STATUSES: readonly ConversationStatus[] = ["running", "needs-you", "idle", "pr-open", "archived"];
const status = (x: unknown): ConversationStatus => (STATUSES.includes(x as ConversationStatus) ? x as ConversationStatus : "other");

export interface ControlPr { n?: number; state?: string; url?: string; repo?: string; title?: string }
export interface ControlSession {
  id: string; link?: string; title?: string; status: ConversationStatus; created?: string; last?: string;
  prs: ControlPr[]; tokens?: number; effort?: string; model?: string; worktree?: boolean;
}
export interface ControlTodo { date?: string; what: string; duration?: string }
export interface ControlAlert { level: "urgent" | "act" | "info"; text: string; time?: string; link?: string }
export interface ControlProject { name: string; sessions: ControlSession[]; prs: ControlPr[]; todo: ControlTodo[]; alerts: ControlAlert[] }
export interface ControlPlan { fiveHour?: number; week?: number; sampled?: string }

function cleanPr(x: unknown): ControlPr | undefined {
  const p = rec(x);
  if (!p) return undefined;
  const n = num(p.n ?? p.number, 1e7);
  const pr: ControlPr = { n: n === undefined ? undefined : Math.floor(n), state: text(p.state, 20), url: safePrLink(p.url), repo: text(p.repo, 120), title: text(p.title, 160) };
  return pr.n !== undefined || pr.url ? pr : undefined;
}

function cleanSession(x: unknown): ControlSession | undefined {
  const s = rec(x);
  const id = typeof s?.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(s.id) ? s.id : undefined;
  if (!s || !id) return undefined;
  return {
    id, link: safeConversationLink(s.link), title: text(s.title, 160), status: s.archived === true ? "archived" : status(s.status),
    created: when(s.created), last: when(s.last), prs: list(s.prs, 20).map(cleanPr).filter((p): p is ControlPr => !!p),
    tokens: num(s.tokens), effort: text(s.effort, 12), model: text(s.model, 60), worktree: typeof s.worktree === "boolean" ? s.worktree : undefined
  };
}

/** A todo row: Control's French column names (Date, À faire, Durée). */
function cleanTodo(x: unknown): ControlTodo | undefined {
  const r = rec(x);
  const what = text(r?.["À faire"], 300);
  return r && what ? { date: when(r.Date)?.slice(0, 10), what, duration: text(r["Durée"], 30) } : undefined;
}

function cleanAlert(x: unknown): ControlAlert | undefined {
  const a = rec(x);
  const t = text(a?.text, 240);
  if (!a || !t) return undefined;
  const level = a.level === "urgent" || a.level === "act" ? a.level : "info";
  return { level, text: t, time: when(a.time), link: safeConversationLink(a.link) ?? safePrLink(a.link) };
}

export function parseHealth(x: unknown): boolean { return rec(x)?.ok === true; }

export function parsePlan(x: unknown): ControlPlan {
  const p = rec(rec(x)?.plan);
  return { fiveHour: pct(p?.five_hour), week: pct(p?.week), sampled: when(p?.sampled) };
}

/** `/api/project/<name>`: the project, or the list of Control's project names when it does not know that one. */
export function parseProject(x: unknown, name: string): { project?: ControlProject; known?: string[] } {
  const r = rec(x);
  if (!r) return {};
  if (r.error !== undefined) return { known: list(r.projects, 500).filter((p): p is string => typeof p === "string" && p.length < 120) };
  const todo = list(rec(r.todo)?.["À faire par toi"], 50).map(cleanTodo).filter((t): t is ControlTodo => !!t);
  return {
    project: {
      name,
      sessions: list(r.sessions, 30).map(cleanSession).filter((s): s is ControlSession => !!s),
      prs: list(r.prs, 50).map(cleanPr).filter((p): p is ControlPr => !!p),
      todo,
      alerts: list(r.alerts, 30).map(cleanAlert).filter((a): a is ControlAlert => !!a)
    }
  };
}

export interface OrderConversation {
  tool: "claude" | "codex"; surface: "desktop" | "terminal"; id?: string; cliId?: string; link?: string;
  status: ConversationStatus; created?: string; last?: string; tokens?: number; prs: ControlPr[];
}

/** `/api/work-orders`: per asked id, its conversations (newest first); ids not asked are dropped. */
export function parseWorkOrders(x: unknown, asked: readonly string[]): Map<string, OrderConversation[]> {
  const out = new Map<string, OrderConversation[]>();
  const orders = rec(rec(x)?.orders);
  if (!orders) return out;
  for (const id of asked) {
    const rows = list(orders[id], 20).map(rec).filter((r): r is Record<string, unknown> => !!r).map((r): OrderConversation => ({
      tool: r.tool === "codex" ? "codex" : "claude",
      surface: r.surface === "terminal" ? "terminal" : "desktop",
      id: typeof r.id === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(r.id) ? r.id : undefined,
      cliId: typeof r.cli_id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(r.cli_id) ? r.cli_id : undefined,
      link: safeConversationLink(r.link),
      status: status(r.status), created: when(r.created), last: when(r.last), tokens: num(r.tokens),
      prs: list(r.prs, 20).map(cleanPr).filter((p): p is ControlPr => !!p)
    }));
    out.set(id, rows);
  }
  return out;
}

// ------------------------------------------------------------------ the client

export class ControlClient {
  constructor(private readonly base: string, private readonly fetch: typeof getJson = getJson) {}

  async health(): Promise<Fetched<boolean>> {
    const r = await this.fetch(this.base, "/api/health", HEALTH_TIMEOUT_MS);
    if (!r.ok) return r;
    return parseHealth(r.data) ? { ok: true, data: true } : { ok: false, reason: "bad-json", detail: "Something answers on Claude Control's port, but not Claude Control." };
  }

  async plan(): Promise<Fetched<ControlPlan>> {
    const r = await this.fetch(this.base, "/api/status");
    return r.ok ? { ok: true, data: parsePlan(r.data) } : r;
  }

  async project(name: string): Promise<Fetched<{ project?: ControlProject; known?: string[] }>> {
    if (!/^[A-Za-z0-9 _.()-]{1,100}$/.test(name)) return { ok: false, reason: "bad-url", detail: "Not a project folder name." };
    const r = await this.fetch(this.base, `/api/project/${encodeURIComponent(name)}`);
    return r.ok ? { ok: true, data: parseProject(r.data, name) } : r;
  }

  async workOrders(ids: readonly string[]): Promise<Fetched<Map<string, OrderConversation[]>>> {
    const asked = [...new Set(ids.filter(i => ORDER_ID.test(i)))].slice(0, MAX_ORDER_IDS);
    if (!asked.length) return { ok: true, data: new Map() };
    const r = await this.fetch(this.base, `/api/work-orders?ids=${asked.join(",")}`);
    return r.ok ? { ok: true, data: parseWorkOrders(r.data, asked) } : r;
  }
}

/**
 * Control names projects by their folder under D:\PROJ. DataPass tries the folder names of the
 * project's clones: first as they are, then (once Control said which names it knows) by a
 * case-insensitive match.
 */
export function matchProjectNames(folderNames: readonly string[], known: readonly string[] | undefined): string[] {
  const names = [...new Set(folderNames.filter(n => n && n.length <= 100))];
  if (!known) return names;
  const lower = new Map(known.map(k => [k.toLowerCase(), k]));
  return [...new Set(names.map(n => lower.get(n.toLowerCase())).filter((k): k is string => !!k))];
}

// ------------------------------------------------------------------ quick links (datapass.ai.quickLinks)

export interface QuickLink { label: string; url: string }
export const DEFAULT_QUICK_LINKS: readonly QuickLink[] = [
  { label: "ChatGPT", url: "https://chatgpt.com/" },
  { label: "Claude", url: "https://claude.ai/" },
  { label: "Claude Code web", url: "https://claude.ai/code" },
  { label: "Codex", url: "https://chatgpt.com/codex" },
  { label: "Control", url: "http://127.0.0.1:7430/" }
];
export const MAX_QUICK_LINKS = 12;

/** https anywhere, `claude:` (the desktop app), or http on 127.0.0.1 / localhost only. */
export function quickLinkAllowed(url: string): boolean {
  if (typeof url !== "string" || url.length > 500 || /[\s"'<>\\]/.test(url)) return false;
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/|$)/.test(url)) return true;
  if (/^claude:\/\/[A-Za-z0-9.\/_-]*$/.test(url)) return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/.test(url);
}

/** The links to show, and why the others are left out. A missing setting means the defaults. */
export function parseQuickLinks(raw: unknown): { links: QuickLink[]; refused: string[] } {
  if (raw === undefined || raw === null) return { links: [...DEFAULT_QUICK_LINKS], refused: [] };
  if (!Array.isArray(raw)) return { links: [...DEFAULT_QUICK_LINKS], refused: ["datapass.ai.quickLinks must be a list of { label, url }: the defaults are shown."] };
  const links: QuickLink[] = [];
  const refused: string[] = [];
  for (const item of raw.slice(0, 40)) {
    const r = rec(item);
    const label = text(r?.label, 40);
    const url = typeof r?.url === "string" ? r.url.trim() : "";
    if (!label || !url) { refused.push("An entry without a label or a url was left out."); continue; }
    if (!quickLinkAllowed(url)) { refused.push(`"${label}": only https, claude: or http on 127.0.0.1 / localhost links open.`); continue; }
    if (links.length >= MAX_QUICK_LINKS) { refused.push(`At most ${MAX_QUICK_LINKS} links are shown.`); break; }
    links.push({ label, url });
  }
  return { links, refused };
}

// ------------------------------------------------------------------ a work order's conversation

/** "1.8 M", "640 k", "900": Control's token counts, rounded. */
export function tokenText(n: number | undefined): string | undefined {
  if (n === undefined) return undefined;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(Math.round(n));
}

const STATUS_TEXT: Readonly<Record<ConversationStatus, string>> = {
  running: "◐ running", "needs-you": "● needs you", idle: "○ idle", "pr-open": "◌ PR open", archived: "archived", other: "seen"
};
export const conversationStatusText = (s: ConversationStatus) => STATUS_TEXT[s];

export interface ConversationView {
  status: ConversationStatus;
  /** One line: status, where it runs, how it is linked. */
  text: string;
  tokens?: string;
  /** How DataPass knows it is this order's conversation. */
  linked: "session-id" | "desktop" | "marker";
  /** Control has an `Open in Claude` link for it (the link itself stays in the extension host). */
  openable: boolean;
  last?: string;
  /** More conversations started from the same order (a relaunch, a follow-up in another app). */
  others: number;
}

/**
 * The conversation to show for an order: the newest one Control linked to it. The link is exact when
 * Control's CLI session id is the one DataPass chose (`--session-id`); after `/desktop` the Claude app
 * keeps that id, so an app conversation with it is "moved to the app". Otherwise Control linked it by
 * the marker line of the first message.
 */
export function orderConversation(agent: { tool: "claude-code" | "codex"; surface: "desktop" | "terminal"; sessionId?: string }, rows: readonly OrderConversation[] | undefined): ConversationView | undefined {
  if (!rows?.length) return undefined;
  const exact = agent.sessionId ? rows.find(r => r.cliId === agent.sessionId || r.id === agent.sessionId) : undefined;
  const row = exact ?? rows[0]!;
  const linked: ConversationView["linked"] = exact ? (exact.surface === "desktop" && agent.surface === "terminal" ? "desktop" : "session-id") : "marker";
  const where = `${row.tool === "codex" ? "Codex" : "Claude"} ${row.surface === "desktop" ? "app" : "terminal"}`;
  const how = linked === "desktop" ? "moved to the app with /desktop" : linked === "session-id" ? "exact session" : "found by the marker line";
  return { status: row.status, text: `${STATUS_TEXT[row.status]} · ${where} · ${how}`, tokens: tokenText(row.tokens), linked, openable: !!row.link, last: row.last, others: rows.length - 1 };
}

/** The link to open for an order's conversation (the same choice as orderConversation). */
export function orderConversationLink(agent: { sessionId?: string }, rows: readonly OrderConversation[] | undefined): string | undefined {
  if (!rows?.length) return undefined;
  const exact = agent.sessionId ? rows.find(r => r.cliId === agent.sessionId || r.id === agent.sessionId) : undefined;
  return (exact ?? rows[0]!).link;
}
