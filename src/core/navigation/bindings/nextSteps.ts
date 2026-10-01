/**
 * V4-NAV NAVTODO1 binding `next-steps`: the things still to do, per Location, gathered only from facts
 * DataPass already holds (project map next steps and problems, readiness checks and env files, open
 * board cards and board problems, open checklist entries, missing evidence, typed holes of the other
 * providers). Nothing is invented: a fact source that is absent adds no row. Pure; the host supplies
 * the facts and how a component / sub-project maps to a Location.
 */
import type { ProjectMap, MapProblem } from "../../project/projectMap";
import type { Readiness } from "../../readiness/readiness";
import type { BoardView } from "../../project/board";
import { sameLocation, type NavLadder, type NavLocation } from "../navTypes";
import type { NavHole, NavOrigin } from "./origin";
import type { ProcessStep } from "../context/processStep";

/** Lifecycle step of a Location (the host builds it from NAVCTX2 `resolveProcessStep(location, facts).current`). */
export type ProcessStepOf = (location: NavLocation) => ProcessStep | null;
/** Default: the step is unknown (null), never guessed. */
export const unknownProcessStep: ProcessStepOf = () => null;

export const NEXT_STEPS_SOURCE = "next-steps";
export const MAX_NEXT_STEPS = 500;

export const NEXT_STEP_KINDS = ["readiness", "check", "evidence", "hole", "board"] as const;
export type NextStepKind = (typeof NEXT_STEP_KINDS)[number];
export type NextStepSeverity = "error" | "warning" | "info";

export interface NextStepRow {
  readonly location: NavLocation;
  /** Lifecycle step of the Location (NAVCTX2 processStep); null when not known. */
  readonly step: ProcessStep | null;
  readonly kind: NextStepKind;
  readonly text: string;
  readonly origin: NavOrigin;
  readonly severity: NextStepSeverity;
  /** The view that shows the item, when the fact names one (row click opens it). */
  readonly viewId?: string;
}

/** Missing evidence as reported by the `evidence` binding (when present). */
export interface MissingEvidence { readonly location: NavLocation; readonly text: string; readonly origin: NavOrigin; readonly viewId?: string }

export interface NextStepsFacts {
  readonly map?: Pick<ProjectMap, "components" | "subprojects" | "problems" | "nextStep">;
  readonly readiness?: Pick<Readiness, "checks" | "files">;
  readonly board?: Pick<BoardView, "cards">;
  readonly boardProblems?: readonly MapProblem[];
  readonly missingEvidence?: readonly MissingEvidence[];
  readonly holes?: readonly NavHole[];
}

export interface NextStepsLocator {
  readonly root: NavLocation;
  component(componentId: string): NavLocation | null;
  subproject(subprojectId: string): NavLocation | null;
  /** Repository (by repo key) to the Location that holds it; null = project root. */
  repository?(repoKey: string): NavLocation | null;
}

export interface NextStepsResult {
  readonly rows: readonly NextStepRow[];
  readonly holes: readonly { reason: string }[];
  readonly origin: NavOrigin;
  /** Rows per Location (`level:nodeId`), before truncation. */
  readonly countByLocation: ReadonlyMap<string, number>;
  readonly total: number;
  readonly truncated: boolean;
}

export const locationKey = (l: NavLocation) => `${l.level}:${l.nodeId}`;

const SEVERITY_RANK: Record<NextStepSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Collects the rows for `scope` (project root = everything, else the Location and its subtree). */
export function collectNextSteps(facts: NextStepsFacts, locator: NextStepsLocator, opts: {
  scope?: NavLocation; ladder?: NavLadder; processStep?: ProcessStepOf; max?: number;
} = {}): NextStepsResult {
  const stepOf = opts.processStep ?? unknownProcessStep;
  const out: NextStepRow[] = [];
  const seen = new Set<string>();
  const add = (location: NavLocation | null, kind: NextStepKind, text: string, severity: NextStepSeverity, origin: NavOrigin, viewId?: string) => {
    const t = text.trim();
    if (!t) return;
    const loc = location ?? locator.root;
    const key = `${locationKey(loc)}\u0000${kind}\u0000${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ location: loc, step: stepOf(loc), kind, text: t, origin, severity, ...(viewId ? { viewId } : {}) });
  };

  const map = facts.map;
  if (map) {
    for (const c of map.components) {
      const loc = locator.component(c.id);
      if (c.health === "blocked" || c.health === "attention" || c.health === "planned")
        add(loc, "readiness", c.nextStep, c.health === "blocked" ? "error" : c.health === "attention" ? "warning" : "info", "static");
      for (const p of c.problems) add(loc, "readiness", p, "warning", "static");
      for (const e of c.checklist) if (e.state === "todo" || e.state === "blocked" || e.state === "problem")
        add(loc, "check", e.note ? `${e.label} — ${e.note}` : e.label, e.state === "todo" ? "info" : e.state === "blocked" ? "error" : "warning", "declared");
    }
    for (const s of map.subprojects) {
      const loc = locator.subproject(s.id);
      if (s.health === "blocked" || s.health === "attention") add(loc, "readiness", s.nextStep, s.health === "blocked" ? "error" : "warning", "static");
      for (const e of s.checklist) if (e.state === "todo" || e.state === "blocked" || e.state === "problem")
        add(loc, "check", e.note ? `${e.label} — ${e.note}` : e.label, e.state === "todo" ? "info" : e.state === "blocked" ? "error" : "warning", "declared");
    }
    for (const p of map.problems) add(null, "readiness", `${p.where}: ${p.message}`, p.severity, "static");
  }

  const r = facts.readiness;
  if (r) {
    for (const f of r.files) if (!f.optional && (f.state === "missing" || f.state === "not-cloned" || f.state === "unreadable"))
      add(f.repoKey ? locator.repository?.(f.repoKey) ?? null : null, "readiness", `${f.path}: ${f.state}${f.reason ? ` (${f.reason})` : ""}`, f.state === "missing" ? "error" : "warning", "observed");
    for (const c of r.checks) add(null, "readiness", c.nextStep ? `${c.message} — ${c.nextStep}` : c.message, c.severity, "observed");
  }

  if (facts.board) {
    for (const card of facts.board.cards) {
      if (card.done) continue;
      const text = `${card.type} ${card.id}: ${card.title}`;
      const sev: NextStepSeverity = card.overdue || card.priority === "P0" ? "error" : card.type === "bug" || card.priority === "P1" ? "warning" : "info";
      const locs = card.components.filter(c => c.known).map(c => locator.component(c.id)).filter((l): l is NavLocation => !!l);
      if (!locs.length) for (const s of card.subprojects) { const l = locator.subproject(s); if (l) locs.push(l); }
      if (!locs.length) add(null, "board", text, sev, "declared", "board");
      else for (const l of locs) add(l, "board", text, sev, "declared", "board");
    }
  }
  for (const p of facts.boardProblems ?? []) add(null, "board", `${p.where}: ${p.message}`, p.severity, "static", "board");

  for (const e of facts.missingEvidence ?? []) add(e.location, "evidence", e.text, "warning", e.origin, e.viewId);
  for (const h of facts.holes ?? []) add(h.location ?? null, "hole", h.reason, "info", "static");

  const scoped = opts.scope && !sameLocation(opts.scope, locator.root) ? out.filter(row => within(row.location, opts.scope!, opts.ladder)) : out;
  const countByLocation = new Map<string, number>();
  for (const row of scoped) countByLocation.set(locationKey(row.location), (countByLocation.get(locationKey(row.location)) ?? 0) + 1);
  const sorted = [...scoped].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const max = opts.max ?? MAX_NEXT_STEPS;
  const holes = map || r || facts.board ? [] : [{ reason: "No project facts loaded yet (project map, readiness, board)." }];
  return { rows: sorted.slice(0, max), holes, origin: "static", countByLocation, total: scoped.length, truncated: scoped.length > max };
}

/** True when `l` is `scope` or below it on the ladder (without a ladder: the same Location only). */
function within(l: NavLocation, scope: NavLocation, ladder?: NavLadder): boolean {
  for (let cur: NavLocation | null = l, guard = 0; cur && guard < 20; cur = ladder?.parent(cur) ?? null, guard++)
    if (sameLocation(cur, scope)) return true;
  return false;
}

/** Value of the context key `datapass.nav.todoCount`. */
export const TODO_COUNT_CONTEXT_KEY = "datapass.nav.todoCount";
export const todoCount = (r: NextStepsResult) => r.total;
