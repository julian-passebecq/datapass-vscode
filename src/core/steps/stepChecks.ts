/**
 * V5 STEPBAR1 (Julian 1 Oct 13:45, CEO ARCHI REVIEW B6/B7): the checks that used to sit in the
 * Project tree (readiness, tools, sign-ins, expected-file states) become small checks next to the
 * steps of the current journey. Pure (no `vscode`).
 *
 * Which step a check belongs to is DATA, not code: `resources/steps/check-steps.json` maps a check
 * area to a step target, overridable key by key by the setting `datapass.guided.checkSteps`.
 * A target is `first` (the journey's first step), `component` (the step standing on the check's
 * component), `project-checks` (the fallback step at the end), or anything a step is matched by:
 * its id, its section, its Location's nodeId, artifactKind or level. Unmapped → "Project checks".
 */
import builtin from "../../../resources/steps/check-steps.json";
import type { NavLocation } from "../navigation/navTypes";
import type { ProjectMap } from "../project/projectMap";
import { fileStateText, keyStateText, type Readiness } from "../readiness/readiness";
import { toolStateText } from "../toolchain/toolchain";
import { extensionsJsonText } from "../toolchain/extensionsJson";

export type StepCheckStatus = "pass" | "fail" | "not-checked" | "hole";
export const STEP_CHECK_STATUSES: readonly StepCheckStatus[] = ["fail", "hole", "not-checked", "pass"];

/** What a click on the check runs: the same command the tree node ran. */
export interface StepCheckAction { readonly command: string; readonly title: string; readonly arguments?: readonly unknown[] }

export interface StepCheck {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: StepCheckStatus;
  /** Readiness area (`environment`, `tools`, `connection`, …) or `files` for expected files. */
  readonly area: string;
  /** The component the check is about, when it has one (expected files). */
  readonly nodeId?: string;
  readonly action?: StepCheckAction;
}

export const PROJECT_CHECKS_STEP = "project-checks";

export interface CheckStepMap { readonly areas: Readonly<Record<string, string>>; readonly labels: Readonly<Record<string, string>> }

/** Built-in map and labels, overridden key by key (`{ areas?, labels? }` or a flat area → target object). */
export function checkStepMap(override?: unknown): CheckStepMap {
  const areas: Record<string, string> = { ...(builtin.areas as Record<string, string>) };
  const labels: Record<string, string> = { ...(builtin.labels as Record<string, string>) };
  if (override && typeof override === "object" && !Array.isArray(override)) {
    const o = override as Record<string, unknown>;
    const nested = (o.areas && typeof o.areas === "object") || (o.labels && typeof o.labels === "object");
    const put = (into: Record<string, string>, from: unknown) => {
      if (!from || typeof from !== "object" || Array.isArray(from)) return;
      for (const [k, v] of Object.entries(from as Record<string, unknown>)) if (typeof v === "string" && k.length <= 128 && v.length <= 200) into[k] = v;
    };
    if (nested) { put(areas, o.areas); put(labels, o.labels); } else put(areas, o);
  }
  return { areas, labels };
}

/** A step as the bar sees it (TOUR2's steps, or the built-in "Explore the project" ones). */
export interface StepLike { readonly id: string; readonly location: NavLocation; readonly section?: string }

export interface AssignedChecks { readonly byStep: readonly StepCheck[][]; readonly project: readonly StepCheck[] }

/** Each check under the step its area (or component) maps to; unmapped ones under "Project checks". */
export function assignChecks(steps: readonly StepLike[], checks: readonly StepCheck[], map: CheckStepMap): AssignedChecks {
  const byStep: StepCheck[][] = steps.map(() => []);
  const project: StepCheck[] = [];
  for (const c of checks) {
    const at = stepFor(steps, c, map.areas[c.area]);
    if (at === undefined) project.push(c); else byStep[at]!.push(c);
  }
  return { byStep, project };
}

function stepFor(steps: readonly StepLike[], c: StepCheck, target: string | undefined): number | undefined {
  if (!steps.length || !target || target === PROJECT_CHECKS_STEP) return undefined;
  if (target === "first") return 0;
  if (target === "component") {
    if (!c.nodeId) return undefined;
    const i = steps.findIndex((s) => s.location.nodeId === c.nodeId);
    return i >= 0 ? i : undefined;
  }
  const i = steps.findIndex((s) => s.id === target || s.section === target || s.location.nodeId === target || s.location.artifactKind === target || s.location.level === target);
  return i >= 0 ? i : undefined;
}

/** Counts by status, worst first (the small chips next to a step). */
export function checkCounts(checks: readonly StepCheck[]): Record<StepCheckStatus, number> {
  const out: Record<StepCheckStatus, number> = { fail: 0, hole: 0, "not-checked": 0, pass: 0 };
  for (const c of checks) out[c.status]++;
  return out;
}

const severityStatus = (s: "error" | "warning" | "info"): StepCheckStatus => (s === "info" ? "not-checked" : "fail");

/**
 * The checks the Project tree used to show (readiness sections): tools, `.vscode/extensions.json`,
 * connections (sign-in / portal / check), env files and variable names, non-secret ids, companions,
 * and the remaining readiness findings (manifest, repositories). Each keeps its tree action.
 */
export function checksFromReadiness(r: Readiness): StepCheck[] {
  const out: StepCheck[] = [];
  const tc = r.toolchain;
  if (tc.declared) {
    for (const e of tc.entries) {
      const fix = e.state === "missing" || e.state === "outside-range";
      const action: StepCheckAction | undefined = fix && e.extensionId ? { command: "datapass.installTool", title: "Show extension", arguments: [e.extensionId] }
        : (fix || e.state === "not-checked") && (e.install?.command || e.install?.docs) ? { command: "datapass.toolchain.copyInstall", title: "Copy install command", arguments: [e.tool] }
        : undefined;
      const status: StepCheckStatus = e.state === "ok" ? "pass" : e.state === "unknown-tool" ? "hole" : fix ? (e.optional ? "not-checked" : "fail") : "not-checked";
      out.push({ id: `tool:${e.tool}@${e.where}`, label: e.label, detail: toolStateText(e), status, area: "tools", ...(action ? { action } : {}) });
    }
    const missing = r.extensions.expected.some((x) => !x.recommended && !x.optional);
    out.push({
      id: "tool:extensions-json", label: ".vscode/extensions.json", detail: extensionsJsonText(r.extensions), area: "tools",
      status: r.extensions.state === "invalid" || missing ? "fail" : "pass",
      action: { command: "datapass.showRecommendedExtensions", title: "Show Recommended Extensions" }
    });
  }
  for (const c of r.connections) {
    const action: StepCheckAction | undefined = c.signIn ? { command: "datapass.connections.copySignIn", title: "Copy sign-in command", arguments: [c.id] }
      : c.hasPortal ? { command: "datapass.connections.openPortal", title: "Open portal page", arguments: [c.id] }
      : c.state === "not-checked-yet" ? { command: "datapass.checkConnections", title: "Check connections" }
      : c.state === "tool-missing" && c.tool ? { command: "datapass.toolchain.copyInstall", title: "Copy install command", arguments: [c.tool] }
      : undefined;
    const status: StepCheckStatus = c.state === "ok" ? "pass" : c.state === "identifier-pending" ? "hole"
      : c.state === "not-checked-yet" || c.state === "declared" ? "not-checked" : "fail";
    out.push({ id: `connection:${c.id}`, label: c.label, detail: `${c.kind}${c.environment ? ` · ${c.environment}` : ""} · ${c.detail}`, status, area: "connection", ...(action ? { action } : {}) });
  }
  for (const f of r.files) {
    const status: StepCheckStatus = f.git === "tracked" ? "fail" : f.state === "found" ? (f.git === "not-ignored" ? "fail" : "pass")
      : f.state === "missing" ? (f.optional ? "not-checked" : "fail") : f.state === "not-cloned" ? "not-checked" : "fail";
    out.push({ id: `env:file:${f.id}`, label: f.repoLabel ? `${f.path} · ${f.repoLabel}` : f.path, detail: fileStateText(f), status, area: "environment",
      action: { command: "datapass.env.openFile", title: "Open", arguments: [f.id] } });
  }
  for (const k of r.keys) {
    out.push({ id: `env:key:${k.name}`, label: k.name, detail: keyStateText(k), area: "environment",
      status: k.state === "set" ? "pass" : k.state === "not-checked" ? "not-checked" : "fail",
      action: { command: "datapass.env.copyKeyName", title: "Copy name", arguments: [k.name] } });
  }
  for (const d of r.identifiers) {
    out.push({ id: `env:id:${d.id}`, label: d.label, detail: d.pending ? "pending" : "non-secret id", area: "environment", status: d.pending ? "hole" : "pass",
      ...(d.pending ? {} : { action: { command: "datapass.env.copyIdentifier", title: "Copy", arguments: [d.id] } }) });
  }
  for (const c of r.companions) {
    out.push({ id: `companion:${c.module}`, label: c.label, detail: c.detail, area: "companion", status: c.state === "configured" ? "pass" : "not-checked" });
  }
  // Findings the rows above do not already carry.
  const covered = new Set(["environment", "tools", "connection", "companion"]);
  r.checks.forEach((c, i) => {
    if (covered.has(c.area)) return;
    out.push({ id: `check:${c.id}:${i}`, label: c.message, ...(c.nextStep ? { detail: `Next: ${c.nextStep}` } : {}), area: c.area, status: severityStatus(c.severity) });
  });
  return out;
}

/** Expected-file states (the tree's check icons on files), one check per file, under its component's step. */
export function checksFromFiles(map: Pick<ProjectMap, "components">): StepCheck[] {
  const out: StepCheck[] = [];
  for (const c of map.components) for (const f of c.artifacts?.files ?? []) {
    const status: StepCheckStatus = f.state === "found" ? "pass" : f.state === "missing" ? (f.optional ? "not-checked" : "fail")
      : f.state === "unbound" || f.state === "planned" ? "not-checked" : "hole";
    out.push({
      id: `file:${c.id}:${f.repoPath}`, label: f.path, detail: f.state === "missing" && f.source === "generated" ? `to generate · ${f.generated?.producer ?? "producer"}` : f.state,
      status, area: "files", nodeId: c.id,
      action: f.state === "found" ? { command: "datapass.openComponentFile", title: "Open", arguments: [c.id, f.repoPath] }
        : { command: "datapass.explainMissingFile", title: "Why is this expected?", arguments: [c.id, f.repoPath] }
    });
  }
  return out;
}

/** "Explore the project": the built-in default journey when the project declares none (project, then sub-projects). */
export function exploreSteps(locations: readonly NavLocation[], limit = 20): StepLike[] {
  const root = locations.find((l) => l.level === "project");
  const subs = locations.filter((l) => l.level === "subproject");
  return [...(root ? [root] : []), ...subs].slice(0, limit).map((location, i) => ({ id: `explore.${i + 1}`, location }));
}
