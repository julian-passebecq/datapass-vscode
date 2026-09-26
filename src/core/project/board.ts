/**
 * The project board (0.16): tasks, bugs, features, decisions and questions, sprints and
 * milestones, in one file the AI keeps up to date in the coordination repository and the person
 * moves on a kanban. Pure.
 *
 *   .datapass/board.json
 *     columns     the kanban columns, in order; a card's status is a column id
 *     sprints     dated iterations (start, end, goal)
 *     milestones  dated targets
 *     items       the cards: type, title, status, priority, the components and files they
 *                 concern, environment, sprint, milestone, due date, links (an Azure DevOps work
 *                 item, a GitHub issue, a pull request), and (0.21) the toolkit recipe and route
 *                 the work follows
 *
 * Other viewers (Mongoku, a web page) read the same file from GitHub; DataPass never talks to them.
 * DataPass shows the board, opens a card's component or file, prepares an AI pack for a card and,
 * when the person moves a card, rewrites only that card's "status" value: the rest of the file,
 * formatting included, stays byte for byte.
 */
import { arr, constOf, enumOf, ID, obj, TEXT, validateSchema, type Schema, type SchemaIssue } from "../contracts/schemaDsl";
import { parseStrictJson } from "../model/strictJson";
import { locateJsonValue } from "../model/jsonLocate";
import { jsonEqual } from "../model/deepEqual";
import { vetRelativePath } from "../exchange/pathSafety";
import type { ProjectGraph } from "../workspace/graph";
import type { DataPassProjectManifest } from "../projectManifestModel";
import type { MapProblem, ProjectMap } from "./projectMap";
import type { OptionsFile } from "./options";
import { obsKey, type FileObservation } from "./resolve";

export const BOARD_PATH = ".datapass/board.json";
export const BOARD_FORMAT = "datapass.board";
export const ITEM_TYPES = ["task", "bug", "feature", "decision", "question"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
export type BoardItemType = typeof ITEM_TYPES[number];
export type Priority = typeof PRIORITIES[number];

const SHORT: Schema = { type: "string", minLength: 1, maxLength: 200 };
const LABEL: Schema = { type: "string", minLength: 1, maxLength: 40 };
const DATE: Schema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const LINK: Schema = { type: "string", maxLength: 2000, pattern: "^https://\\S+$" };
const REL_PATH: Schema = { type: "string", minLength: 1, maxLength: 400, pattern: "^(?![/\\\\~])(?![A-Za-z]:)(?!.*(^|[/\\\\])\\.\\.([/\\\\]|$)).+$" };

const COLUMN: Schema = obj({ id: ID, title: SHORT, done: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 99 }, description: TEXT }, ["id"]);
const SPRINT: Schema = obj({ id: ID, title: SHORT, start: DATE, end: DATE, goal: TEXT }, ["id", "title", "start", "end"]);
const MILESTONE: Schema = obj({ id: ID, title: SHORT, due: DATE, description: TEXT }, ["id", "title"]);
const FILE: Schema = obj({ repoRef: ID, path: REL_PATH, line: { type: "integer", minimum: 1, maximum: 1_000_000 } }, ["path"]);
const ITEM: Schema = obj({
  id: ID, type: enumOf(...ITEM_TYPES), title: SHORT, status: ID, priority: enumOf(...PRIORITIES), description: TEXT,
  subproject: ID, components: arr(ID, 30), files: arr(FILE, 30), environment: ID, sprint: ID, milestone: ID,
  due: DATE, created: DATE, closed: DATE, assignee: SHORT, labels: arr(LABEL, 20), links: arr(LINK, 20), decisionRef: ID,
  recipe: ID, route: ID
}, ["id", "type", "title", "status"]);

export const BOARD_SCHEMA: Schema = obj({
  $schema: { type: "string", maxLength: 500 },
  format: constOf(BOARD_FORMAT), version: constOf("1"), title: SHORT, description: TEXT, updated: DATE,
  columns: arr(COLUMN, 12, 1), sprints: arr(SPRINT, 100), milestones: arr(MILESTONE, 50), items: arr(ITEM, 2000)
}, ["format", "version", "columns", "items"]);

export interface BoardColumn { id: string; title?: string; done?: boolean; limit?: number; description?: string }
export interface Sprint { id: string; title: string; start: string; end: string; goal?: string }
export interface Milestone { id: string; title: string; due?: string; description?: string }
export interface BoardFileRef { repoRef?: string; path: string; line?: number }
export interface BoardItem {
  id: string; type: BoardItemType; title: string; status: string; priority?: Priority; description?: string;
  subproject?: string; components?: string[]; files?: BoardFileRef[]; environment?: string; sprint?: string; milestone?: string;
  due?: string; created?: string; closed?: string; assignee?: string; labels?: string[]; links?: string[]; decisionRef?: string;
  /** 0.21: the toolkit recipe the work follows (.datapass/toolkit), and optionally which of its routes. */
  recipe?: string; route?: string;
}
export interface Board {
  $schema?: string; format: typeof BOARD_FORMAT; version: "1"; title?: string; description?: string; updated?: string;
  columns: BoardColumn[]; sprints?: Sprint[]; milestones?: Milestone[]; items: BoardItem[];
}

export class BoardError extends Error {
  constructor(message: string, readonly issues: SchemaIssue[] = []) {
    super(issues.length ? `${message}: ${issues.slice(0, 5).map(i => `${i.path} ${i.message}`).join("; ")}` : message);
  }
}

/** A real calendar date (the schema only checks the YYYY-MM-DD shape). */
export function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return Boolean(days && d >= 1 && d <= days);
}

/** Why a card's link is refused: a committed file never carries a credential, a token or a signature. */
export function linkProblem(url: string): string | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return "is not a valid web address"; }
  if (u.protocol !== "https:") return "must be https://";
  if (u.username || u.password) return "contains a user name or password";
  if (/[?&](sig|token|access_token|code|key|password|secret|se)=/i.test(u.search)) return "carries a token or a signature in its query";
  return undefined;
}

export function parseBoard(raw: string | Uint8Array): Board {
  const doc = parseStrictJson(raw, { maxBytes: 2 * 1024 * 1024, maxEntries: 200_000 });
  const issues = validateSchema(BOARD_SCHEMA, doc);
  if (issues.length) throw new BoardError("Invalid board", issues);
  const b = doc as Board;
  for (const [kind, list] of [["column", b.columns], ["sprint", b.sprints], ["milestone", b.milestones], ["card", b.items]] as const) {
    const ids = (list ?? []).map(x => x.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) throw new BoardError(`Duplicate ${kind} id "${dup}"`);
  }
  const columns = new Set(b.columns.map(c => c.id));
  const sprints = new Set((b.sprints ?? []).map(s => s.id));
  const milestones = new Set((b.milestones ?? []).map(m => m.id));
  const dates: Array<[string, string | undefined]> = [["updated", b.updated]];
  for (const s of b.sprints ?? []) {
    dates.push([`sprint ${s.id} start`, s.start], [`sprint ${s.id} end`, s.end]);
    if (s.end < s.start) throw new BoardError(`Sprint "${s.id}" ends (${s.end}) before it starts (${s.start})`);
  }
  for (const m of b.milestones ?? []) dates.push([`milestone ${m.id} due`, m.due]);
  for (const it of b.items) {
    if (!columns.has(it.status)) throw new BoardError(`Card "${it.id}": status "${it.status}" is not a column (${[...columns].join(", ")})`);
    if (it.sprint && !sprints.has(it.sprint)) throw new BoardError(`Card "${it.id}": sprint "${it.sprint}" is not declared in sprints`);
    if (it.milestone && !milestones.has(it.milestone)) throw new BoardError(`Card "${it.id}": milestone "${it.milestone}" is not declared in milestones`);
    if (it.route && !it.recipe) throw new BoardError(`Card "${it.id}": route "${it.route}" needs the recipe it belongs to ("recipe")`);
    dates.push([`card ${it.id} due`, it.due], [`card ${it.id} created`, it.created], [`card ${it.id} closed`, it.closed]);
    for (const link of it.links ?? []) {
      const why = linkProblem(link);
      if (why) throw new BoardError(`Card "${it.id}": link ${why}; keep links to pages (a work item, an issue, a pull request), never a credential`);
    }
  }
  for (const [where, d] of dates) if (d !== undefined && !isCalendarDate(d)) throw new BoardError(`${where}: "${d}" is not a calendar date`);
  return b;
}

// ------------------------------------------------------------------ checks against the project

/** References the manifest, the graph or options.json do not know (warnings: those files may be updated separately). */
export function boardProblems(board: Board, manifest: DataPassProjectManifest | undefined, graph: ProjectGraph | undefined, options?: OptionsFile, recipes?: ReadonlyMap<string, { routes: ReadonlyArray<{ id: string }> }>): MapProblem[] {
  const out: MapProblem[] = [];
  const items = new Set((graph?.items ?? []).map(i => i.id));
  const scopes = new Set((manifest?.scopes ?? []).map(s => s.id));
  const envs = new Set((manifest?.environments ?? []).map(e => e.id));
  const repos = new Set(Object.keys(manifest?.repositories ?? {}));
  const decisions = new Set((options?.decisions ?? []).map(d => d.id));
  for (const it of board.items) {
    const warn = (message: string) => out.push({ severity: "warning", where: `board.json items.${it.id}`, message });
    if (it.subproject && !scopes.has(it.subproject)) warn(`subproject "${it.subproject}" is not a sub-project (scope) of project.json.`);
    for (const c of it.components ?? []) if (!items.has(c)) warn(`component "${c}" is not a component of graph.json.`);
    if (it.environment && !envs.has(it.environment)) warn(`environment "${it.environment}" is not declared in project.json environments.`);
    for (const f of it.files ?? []) if (f.repoRef && !repos.has(f.repoRef)) warn(`file ${f.path}: repository "${f.repoRef}" is not declared in project.json.`);
    if (it.decisionRef && !decisions.has(it.decisionRef)) warn(`decisionRef "${it.decisionRef}" is not a decision of options.json.`);
    // Recipes live in the hub repository's toolkit: checked only when DataPass read one.
    const r = it.recipe && recipes ? recipes.get(it.recipe) : undefined;
    if (it.recipe && recipes && !r) warn(`recipe "${it.recipe}" is not a recipe of the toolkit (.datapass/toolkit).`);
    if (r && it.route && !r.routes.some(x => x.id === it.route)) warn(`route "${it.route}" is not a route of recipe "${it.recipe}" (${r.routes.map(x => x.id).join(", ")}).`);
  }
  return out;
}

// ------------------------------------------------------------------ what the kanban shows

/** Columns whose cards are finished: those marked "done", else a column named done or closed. */
export function doneColumns(board: Board): Set<string> {
  const marked = board.columns.filter(c => c.done).map(c => c.id);
  return new Set(marked.length ? marked : board.columns.filter(c => c.id === "done" || c.id === "closed").map(c => c.id));
}

/** The column a finished pull request moves a card to: "review" if the board has one, else the last open column. */
export function reviewColumn(board: Board): BoardColumn | undefined {
  const done = doneColumns(board);
  const open = board.columns.filter(c => !done.has(c.id));
  return open.find(c => c.id === "review") ?? open[open.length - 1];
}

export const TYPE_LABELS: Readonly<Record<BoardItemType, string>> = { task: "Task", bug: "Bug", feature: "Feature", decision: "Decision", question: "Question" };
const PRIORITY_RANK: Readonly<Record<string, number>> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

export type CardFileState = "found" | "missing" | "not-cloned" | "planned" | "unknown" | "refused";
export interface CardFileView { index: number; repoKey: string; repoLabel: string; path: string; line?: number; state: CardFileState; detail?: string }
export interface CardView {
  id: string; type: BoardItemType; title: string; status: string; done: boolean; priority?: Priority; description?: string;
  /** Declared sub-project plus the sub-projects of the card's components. */
  subprojects: string[];
  components: Array<{ id: string; label: string; known: boolean; glyph?: string }>;
  files: CardFileView[];
  environment?: { id: string; title?: string; production: boolean; known: boolean };
  sprint?: { id: string; title: string };
  milestone?: { id: string; title: string; due?: string };
  due?: string; overdue: boolean; created?: string; closed?: string; assignee?: string; labels: string[];
  links: Array<{ index: number; url: string; label: string }>;
  decision?: { id: string; title: string; current?: string; chosen?: string };
  /** 0.21: the toolkit recipe (resolved against the catalogue by the Workbench). */
  recipe?: { id: string; route?: string };
}
export interface BoardView {
  title?: string; description?: string; updated?: string;
  columns: Array<{ id: string; title: string; done: boolean; limit?: number; count: number; over: boolean; description?: string }>;
  sprints: Array<{ id: string; title: string; start: string; end: string; goal?: string; state: "past" | "current" | "future"; open: number; done: number }>;
  milestones: Array<{ id: string; title: string; due?: string; open: number; done: number; overdue: boolean }>;
  cards: CardView[];
  summary: { open: number; bugs: number; overdue: number; currentSprint?: string };
}

/** A short name for a card's link: "GitHub issue #3", "Azure DevOps work item 12", else the host. */
export function linkLabel(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url.slice(0, 60); }
  const p = u.pathname;
  let m: RegExpExecArray | null;
  if (u.host === "github.com") {
    if ((m = /^\/[^/]+\/[^/]+\/issues\/(\d+)/.exec(p))) return `GitHub issue #${m[1]}`;
    if ((m = /^\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(p))) return `GitHub pull request #${m[1]}`;
    if (/^\/[^/]+\/[^/]+\/actions\/runs\/\d+/.test(p)) return "GitHub Actions run";
  }
  if (u.host === "dev.azure.com" || u.host.endsWith(".visualstudio.com")) {
    if ((m = /\/_workitems\/edit\/(\d+)/.exec(p))) return `Azure DevOps work item ${m[1]}`;
    if ((m = /\/pullrequest\/(\d+)/.exec(p))) return `Azure DevOps pull request ${m[1]}`;
    if (/\/_build\/results/.test(p)) return "Azure Pipelines run";
  }
  if (u.host === "gitlab.com" || u.host.startsWith("gitlab.")) {
    if ((m = /\/-\/issues\/(\d+)/.exec(p))) return `GitLab issue #${m[1]}`;
    if ((m = /\/-\/merge_requests\/(\d+)/.exec(p))) return `GitLab merge request !${m[1]}`;
    if (/\/-\/pipelines\/\d+/.test(p)) return "GitLab pipeline";
  }
  return u.host;
}

export interface BoardViewInput {
  map: ProjectMap;
  /** Observed files (the session plans the board's files too). */
  files: ReadonlyMap<string, FileObservation>;
  options?: OptionsFile;
  /** Local date, YYYY-MM-DD. */
  today: string;
}

/** Repository and repository-relative path of a card's file (the coordination repository when repoRef is omitted). */
export function cardFileLocation(f: BoardFileRef, coordinationKey: string): { repoKey: string; repoPath?: string } {
  const vet = vetRelativePath(f.path.replace(/\/+$/, ""));
  return { repoKey: f.repoRef ?? coordinationKey, repoPath: vet.ok ? vet.relative : undefined };
}

export function boardView(board: Board, input: BoardViewInput): BoardView {
  const { map, today } = input;
  const done = doneColumns(board);
  const components = new Map(map.components.map(c => [c.id, c]));
  const envs = new Map(map.environments.map(e => [e.id, e]));
  const sprints = new Map((board.sprints ?? []).map(s => [s.id, s]));
  const milestones = new Map((board.milestones ?? []).map(m => [m.id, m]));
  const repos = new Map(map.repositories.map(r => [r.key, r]));
  const cards: CardView[] = board.items.map(it => {
    const isDone = done.has(it.status);
    const subprojects = new Set<string>(it.subproject ? [it.subproject] : []);
    for (const c of it.components ?? []) for (const s of components.get(c)?.subprojects ?? []) subprojects.add(s);
    const files = (it.files ?? []).map((f, index): CardFileView => {
      const { repoKey, repoPath } = cardFileLocation(f, map.coordinationKey);
      const repo = repos.get(repoKey);
      const base = { index, repoKey, repoLabel: repo?.label ?? repoKey, path: f.path, line: f.line };
      if (!repoPath) return { ...base, state: "refused", detail: "not a relative path inside the repository" };
      if (!repo) return { ...base, state: "unknown", detail: `repository "${repoKey}" is not declared in project.json` };
      if (repo.state === "planned") return { ...base, state: "planned", detail: "the repository is planned" };
      if (repo.state === "restricted") return { ...base, state: "unknown", detail: "not inspected in Restricted Mode" };
      if (repo.state !== "local" && repo.state !== "not-a-repo") return { ...base, state: "not-cloned", detail: repo.nextStep ?? repo.detail };
      const o = input.files.get(obsKey(repoKey, repoPath));
      return { ...base, state: !o ? "unknown" : o.state === "found" ? "found" : o.state === "missing" ? "missing" : "unknown", detail: o?.detail };
    });
    const env = it.environment ? envs.get(it.environment) : undefined;
    const sprint = it.sprint ? sprints.get(it.sprint) : undefined;
    const milestone = it.milestone ? milestones.get(it.milestone) : undefined;
    const d = it.decisionRef ? input.options?.decisions.find(x => x.id === it.decisionRef) : undefined;
    return {
      id: it.id, type: it.type, title: it.title, status: it.status, done: isDone, priority: it.priority, description: it.description,
      subprojects: [...subprojects],
      components: (it.components ?? []).map(id => { const c = components.get(id); return { id, label: c?.label ?? id, known: Boolean(c), glyph: c?.provider?.glyph }; }),
      files,
      environment: it.environment ? { id: it.environment, title: env?.title, production: Boolean(env?.production), known: Boolean(env) } : undefined,
      sprint: sprint ? { id: sprint.id, title: sprint.title } : undefined,
      milestone: milestone ? { id: milestone.id, title: milestone.title, due: milestone.due } : undefined,
      due: it.due, overdue: Boolean(!isDone && it.due && it.due < today), created: it.created, closed: it.closed, assignee: it.assignee, labels: it.labels ?? [],
      links: (it.links ?? []).map((url, index) => ({ index, url, label: linkLabel(url) })),
      decision: it.decisionRef ? { id: it.decisionRef, title: d?.title ?? it.decisionRef, current: d?.options.find(o => o.id === d.current)?.label, chosen: d?.chosen && d.chosen !== d.current ? d.options.find(o => o.id === d.chosen)?.label : undefined } : undefined,
      recipe: it.recipe ? { id: it.recipe, route: it.route } : undefined
    };
  });
  const count = (pred: (c: CardView) => boolean) => cards.filter(pred).length;
  const sprintState = (s: Sprint): "past" | "current" | "future" => s.end < today ? "past" : s.start > today ? "future" : "current";
  const current = (board.sprints ?? []).find(s => sprintState(s) === "current");
  return {
    title: board.title, description: board.description, updated: board.updated,
    columns: board.columns.map(c => {
      const n = count(x => x.status === c.id);
      return { id: c.id, title: c.title ?? c.id, done: done.has(c.id), limit: c.limit, count: n, over: Boolean(c.limit && n > c.limit), description: c.description };
    }),
    sprints: (board.sprints ?? []).map(s => ({ id: s.id, title: s.title, start: s.start, end: s.end, goal: s.goal, state: sprintState(s), open: count(x => x.sprint?.id === s.id && !x.done), done: count(x => x.sprint?.id === s.id && x.done) })),
    milestones: (board.milestones ?? []).map(m => ({ id: m.id, title: m.title, due: m.due, open: count(x => x.milestone?.id === m.id && !x.done), done: count(x => x.milestone?.id === m.id && x.done), overdue: Boolean(m.due && m.due < today && cards.some(x => x.milestone?.id === m.id && !x.done)) })),
    cards,
    summary: { open: count(x => !x.done), bugs: count(x => !x.done && x.type === "bug"), overdue: count(x => x.overdue), currentSprint: current?.id }
  };
}

/** Open cards, most urgent first: priority, then the column furthest along. */
export function openCardsByUrgency(view: BoardView): CardView[] {
  const order = new Map(view.columns.map((c, i) => [c.id, i]));
  return view.cards.filter(c => !c.done).sort((a, b) =>
    (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9) || (order.get(b.status) ?? 0) - (order.get(a.status) ?? 0) || a.id.localeCompare(b.id));
}

/** Cards that concern a component (directly). */
export function cardsForComponent(view: BoardView, componentId: string): CardView[] {
  return view.cards.filter(c => c.components.some(x => x.id === componentId));
}

// ------------------------------------------------------------------ moving a card

/**
 * board.json with only one card's status changed. The status value is replaced where it stands;
 * every other byte of the text is kept. The result is parsed again and must equal the board with
 * that single change, otherwise nothing is returned for writing.
 */
export function withCardStatus(text: string, itemId: string, status: string): string {
  const board = parseBoard(text);
  const index = board.items.findIndex(i => i.id === itemId);
  if (index < 0) throw new BoardError(`There is no card "${itemId}" on the board`);
  if (!board.columns.some(c => c.id === status)) throw new BoardError(`"${status}" is not a column of the board`);
  const span = locateJsonValue(text, ["items", index, "status"]);
  if (!span) throw new BoardError(`The status of card "${itemId}" could not be located in board.json`);
  const next = text.slice(0, span.start) + JSON.stringify(status) + text.slice(span.end);
  const expected = structuredClone(board);
  expected.items[index]!.status = status;
  if (!jsonEqual(parseBoard(next), expected)) throw new BoardError("The card could not be moved without changing anything else; nothing was written");
  return next;
}
