/**
 * V4-NAV NAVTODO1 view pack 'Next steps': a table view offered for every artifact kind at every level
 * (project = everything, lower levels = the Location's subtree), grouped by lifecycle step then by
 * Location; a row click goes to the Location (and its view when the item names one). Titles and group
 * labels are data: the catalog entry and NEXT_STEPS_LABELS are overridable (view overrides / settings).
 */
import { NAV_LEVELS, type NavCommand, type ViewCatalog, type ViewDef } from "../navTypes";
import { PROCESS_STEPS, type ProcessStep } from "../context/processStep";
import { NEXT_STEPS_SOURCE, locationKey, type NextStepRow } from "../bindings/nextSteps";

export const NEXT_STEPS_VIEW_ID = "next-steps";

export const NEXT_STEPS_VIEW: ViewDef = {
  id: NEXT_STEPS_VIEW_ID,
  title: "Next steps",
  layout: "table",
  bindings: [{ source: NEXT_STEPS_SOURCE, params: { groupBy: ["step", "location"] } }],
  description: "What is still to do here, from facts DataPass already has; each row jumps to where it is.",
};

export const NEXT_STEPS_PACK: ViewCatalog["entries"] = NAV_LEVELS.map(level => ({ artifactKind: "*", level, views: [NEXT_STEPS_VIEW] }));

/** Default group labels (data; a setting may replace any of them). */
export const NEXT_STEPS_LABELS: Readonly<Record<ProcessStep | "unknown", string>> = {
  understand: "Understand", design: "Design", build: "Build", deploy: "Deploy", observe: "Observe", optimize: "Optimize",
  unknown: "Not placed in the lifecycle yet",
};

export interface NextStepsGroup {
  readonly step: ProcessStep | null;
  readonly label: string;
  readonly locations: readonly { readonly key: string; readonly rows: readonly NextStepRow[] }[];
}

/** Rows grouped in lifecycle order (unknown last), then by Location in first-seen order. */
export function groupNextSteps(rows: readonly NextStepRow[], labels: Partial<Record<ProcessStep | "unknown", string>> = {}): NextStepsGroup[] {
  const order: (ProcessStep | null)[] = [...PROCESS_STEPS, null];
  const groups: NextStepsGroup[] = [];
  for (const step of order) {
    const inStep = rows.filter(r => r.step === step);
    if (!inStep.length) continue;
    const byLoc = new Map<string, NextStepRow[]>();
    for (const r of inStep) { const k = locationKey(r.location); (byLoc.get(k) ?? byLoc.set(k, []).get(k)!).push(r); }
    const key = step ?? "unknown";
    groups.push({ step, label: labels[key] ?? NEXT_STEPS_LABELS[key], locations: [...byLoc].map(([k, rs]) => ({ key: k, rows: rs })) });
  }
  return groups;
}

/** Commands a row click dispatches: go to its Location, then open its view when it names one. */
export function nextStepCommands(row: NextStepRow): NavCommand[] {
  const cmds: NavCommand[] = [{ type: "go", location: row.location }];
  if (row.viewId) cmds.push({ type: "view", viewId: row.viewId });
  return cmds;
}
