/**
 * V1-TEST (GPT T4, finding A05): the native *Test* route of a component. The client's own test is a
 * VS Code task in the native repository's `.vscode/tasks.json`, in the `test` group; DataPass finds
 * it, shows what it runs, runs it only when you click and confirm, and keeps a receipt (commit,
 * time, exit code). No task declared → an honest "no test declared", never a guess, never a pass.
 *
 * Pure: the caller reads tasks.json (bounded) and passes its text. Nothing here runs anything.
 */
import { stripJsonc } from "../windows/company";

/** tasks.json larger than this is not read (a hand-written file is a few kilobytes). */
export const MAX_TASKS_BYTES = 256 * 1024;
export const TASKS_FILE = ".vscode/tasks.json";

export interface TestTask {
  label: string;
  type: string;
  /** What it runs, as written (command and args). */
  commandLine: string;
  /** Folder it runs in, relative to the repository root ("" = root); undefined when not expressible. */
  cwd: string | undefined;
  /** The cwd as written, when DataPass cannot resolve it (another variable than ${workspaceFolder}). */
  rawCwd?: string;
  isDefault: boolean;
}

export type TasksFile =
  | { state: "absent" }
  | { state: "unreadable"; reason: string }
  | { state: "read"; tests: TestTask[] };

export type TestResolution =
  | { state: "found"; task: TestTask; why: string }
  | { state: "none"; reason: string }
  | { state: "ambiguous"; labels: string[]; reason: string }
  | { state: "unsupported"; reason: string };

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function cmdText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") return (v as { value: string }).value;
  return undefined;
}

function isTestGroup(g: unknown): { test: boolean; isDefault: boolean } {
  if (g === "test") return { test: true, isDefault: false };
  if (g && typeof g === "object" && (g as { kind?: unknown }).kind === "test") return { test: true, isDefault: (g as { isDefault?: unknown }).isDefault === true };
  return { test: false, isDefault: false };
}

/** `${workspaceFolder}/processing` → "processing"; undefined for anything DataPass cannot place. */
export function resolveCwd(raw: string | undefined): string | undefined {
  if (raw === undefined) return "";
  const s = raw.replace(/\\/g, "/").trim();
  const m = /^\$\{workspaceFolder\}(\/.*)?$/.exec(s);
  let rest: string;
  if (m) rest = m[1] ?? "";
  else if (!s.includes("${") && !s.startsWith("/") && !/^[A-Za-z]:/.test(s) && !s.startsWith("~")) rest = s; // relative: VS Code resolves it from the folder
  else return undefined;
  const out: string[] = [];
  for (const seg of rest.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { if (!out.length) return undefined; out.pop(); } else out.push(seg);
  }
  return out.join("/");
}

/** Parse tasks.json (comments allowed) and keep the tasks of the `test` group. */
export function parseTasksFile(text: string | undefined, size?: number): TasksFile {
  if (text === undefined) return { state: "absent" };
  if ((size ?? text.length) > MAX_TASKS_BYTES) return { state: "unreadable", reason: `${TASKS_FILE} is larger than ${MAX_TASKS_BYTES / 1024} KB; DataPass does not read it` };
  let doc: unknown;
  try { doc = JSON.parse(stripJsonc(text.replace(/^﻿/, ""))); } catch { return { state: "unreadable", reason: `${TASKS_FILE} is not valid JSON (comments are allowed)` }; }
  const tasks = doc && typeof doc === "object" ? (doc as { tasks?: unknown }).tasks : undefined;
  if (tasks !== undefined && !Array.isArray(tasks)) return { state: "unreadable", reason: `"tasks" in ${TASKS_FILE} is not a list` };
  const tests: TestTask[] = [];
  for (const t of (tasks ?? []) as unknown[]) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const group = isTestGroup(o.group);
    const label = str(o.label) ?? str(o.taskName);
    if (!group.test || !label) continue;
    const command = cmdText(o.command);
    const args = Array.isArray(o.args) ? o.args.map(cmdText).filter((a): a is string => a !== undefined) : [];
    const rawCwd = str((o.options as { cwd?: unknown } | undefined)?.cwd);
    const cwd = resolveCwd(rawCwd);
    tests.push({
      label, type: str(o.type) ?? "(provided by an extension)",
      commandLine: command ? [command, ...args].join(" ") : `(${str(o.type) ?? "task"} task: its extension decides what runs)`,
      cwd, ...(cwd === undefined && rawCwd ? { rawCwd } : {}), isDefault: group.isDefault
    });
  }
  return { state: "read", tests };
}

/**
 * The test task of one component (its folder `root` in the repository, "." for the root). A task
 * belongs to a component when it runs in the component's folder. A repository-root task counts
 * only for a component at the repository root, or when it is the repository's only component.
 * Two candidates → ambiguous unless exactly one is the group's default. Never a guess.
 */
export function resolveTestTask(file: TasksFile, root: string, soleComponentOfRepo: boolean): TestResolution {
  if (file.state === "absent") return { state: "none", reason: `no test declared: the repository has no ${TASKS_FILE}` };
  if (file.state === "unreadable") return { state: "unsupported", reason: file.reason };
  const want = root === "." ? "" : resolveCwd(root) ?? root;
  if (!file.tests.length) return { state: "none", reason: `no test declared: ${TASKS_FILE} has no task in the "test" group` };
  const unplaced = file.tests.filter(t => t.cwd === undefined);
  const exact = file.tests.filter(t => t.cwd === want);
  const rootTasks = want !== "" && soleComponentOfRepo ? file.tests.filter(t => t.cwd === "") : [];
  const candidates = exact.length ? exact : rootTasks;
  if (!candidates.length) {
    if (unplaced.length) return { state: "unsupported", reason: `DataPass cannot tell where ${unplaced.map(t => `"${t.label}"`).join(", ")} runs (cwd ${unplaced.map(t => t.rawCwd).join(", ")}); use \${workspaceFolder}/<folder>` };
    return { state: "none", reason: `no test declared for this component: no task of the "test" group runs in ${want ? `"${want}"` : "the repository root"}` };
  }
  if (candidates.length === 1) return { state: "found", task: candidates[0]!, why: exact.length ? `runs in ${want ? `"${want}"` : "the repository root"}` : "the repository's only component; the task runs at the root" };
  const defaults = candidates.filter(t => t.isDefault);
  if (defaults.length === 1) return { state: "found", task: defaults[0]!, why: "the default test task of this folder" };
  const labels = candidates.map(t => t.label);
  return { state: "ambiguous", labels, reason: `several test tasks run here (${labels.map(l => `"${l}"`).join(", ")}); mark one "isDefault": true in its group` };
}

// ------------------------------------------------------------------ receipts

export type TestOutcome = "passed" | "failed" | "cancelled" | "unknown";

export interface TestReceipt {
  componentId: string;
  repoKey: string;
  task: string;
  commandLine: string;
  cwd: string;
  /** HEAD of the native repository when the run started; undefined when Git could not tell. */
  commit?: string;
  /** Uncommitted changes when the run started: the result is for the files on disk, not the commit. */
  dirty?: boolean;
  startedAt: string;
  endedAt: string;
  exitCode?: number;
  outcome: TestOutcome;
  dataPassVersion: string;
}

/** Exit code 0 → passed, any other → failed; no exit code → cancelled (you stopped it) or unknown. */
export function outcomeOf(exitCode: number | undefined, cancelled: boolean): TestOutcome {
  if (cancelled) return "cancelled";
  if (exitCode === undefined) return "unknown";
  return exitCode === 0 ? "passed" : "failed";
}

export const OUTCOME_TEXT: Readonly<Record<TestOutcome, string>> = {
  passed: "passed (exit code 0)",
  failed: "failed",
  cancelled: "cancelled — you stopped it; no result",
  unknown: "unknown — the task ended without an exit code (DataPass cannot say whether it passed)"
};

/** The receipt as lines, for the output and reports. A test pass is not a deployment or a verified target. */
export function receiptLines(r: TestReceipt): string[] {
  return [
    `Result: ${r.outcome === "failed" ? `failed (exit code ${r.exitCode})` : OUTCOME_TEXT[r.outcome]}`,
    `Task: "${r.task}" — ${r.commandLine}`,
    `Ran in: ${r.cwd || "(repository root)"} of repository ${r.repoKey}`,
    `Commit: ${r.commit ? r.commit.slice(0, 12) : "unknown (Git could not tell)"}${r.dirty ? " + uncommitted changes (the result is for the files on disk)" : ""}`,
    `Started ${r.startedAt} · ended ${r.endedAt} · DataPass ${r.dataPassVersion}`,
    "A local test run: not a deployment, not a check of any cloud target."
  ];
}

export const MAX_RECEIPTS = 50;

/** Newest first, bounded. */
export function addReceipt(list: readonly TestReceipt[], r: TestReceipt): TestReceipt[] {
  return [r, ...list].slice(0, MAX_RECEIPTS);
}
