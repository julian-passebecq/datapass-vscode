/**
 * V1-TEST (GPT T4, A05): *Run Component Test*. Finds the component's test task in its native
 * repository's `.vscode/tasks.json` (core/nativeTest), shows what it runs, runs it through VS Code's
 * own task system only after you confirm, and keeps a receipt (commit, time, exit code) on this
 * machine (workspace state: nothing is written in any repository). Refuses in Restricted Mode, when
 * no test is declared, when the choice is ambiguous and when the repository is not open in this
 * window. Never runs on its own.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { gitRunner } from "./session";
import { confirmModal, guarded, output, report, UserFacingError } from "./io";
import {
  addReceipt, MAX_TASKS_BYTES, outcomeOf, parseTasksFile, receiptLines, resolveTestTask, TASKS_FILE,
  type TasksFile, type TestReceipt, type TestResolution
} from "../core/nativeTest/tasks";

export const RUN_TEST = "datapass.runComponentTest";
export const SHOW_TEST_RECEIPTS = "datapass.showComponentTestReceipts";
const KEY = "datapass.nativeTest.receipts";

async function readTasksFile(folder: vscode.Uri): Promise<TasksFile> {
  const uri = vscode.Uri.joinPath(folder, ".vscode", "tasks.json");
  let size: number;
  try { size = (await vscode.workspace.fs.stat(uri)).size; } catch { return { state: "absent" }; }
  if (size > MAX_TASKS_BYTES) return parseTasksFile("", size);
  try { return parseTasksFile(new TextDecoder("utf-8", { fatal: true }).decode(await vscode.workspace.fs.readFile(uri)), size); }
  catch { return { state: "unreadable", reason: `${TASKS_FILE} could not be read (permissions or not UTF-8)` }; }
}

export interface ComponentTestView { componentId: string; repoKey?: string; resolution: TestResolution }

/** What *Test* would do for a component, without running anything. */
export async function resolveComponentTest(session: WorkSession, componentId: string): Promise<ComponentTestView & { folder?: vscode.Uri }> {
  const map = session.projectMap();
  const c = map.components.find(x => x.id === componentId);
  if (!c) throw new UserFacingError(`Unknown component "${componentId}".`);
  const a = c.artifacts;
  if (!a) return { componentId, resolution: { state: "none", reason: "no test declared: this component has no files in a repository (no artifacts in graph.json)" } };
  const folder = session.repoFolder(a.repoKey);
  if (!folder) return { componentId, repoKey: a.repoKey, resolution: { state: "unsupported", reason: `repository ${a.repoKey} is not cloned on this machine` } };
  const sole = map.components.filter(x => x.artifacts?.repoKey === a.repoKey).length === 1;
  return { componentId, repoKey: a.repoKey, folder, resolution: resolveTestTask(await readTasksFile(folder), a.root, sole) };
}

async function gitState(folder: string): Promise<{ commit?: string; dirty?: boolean }> {
  const [head, st] = await Promise.all([gitRunner(["rev-parse", "HEAD"], folder, 10_000), gitRunner(["status", "--porcelain=v1", "--untracked-files=normal"], folder, 15_000)]);
  return { ...(head.ok ? { commit: head.stdout.trim() } : {}), ...(st.ok ? { dirty: st.stdout.trim().length > 0 } : {}) };
}

function sameFolder(a: vscode.Uri, b: vscode.Uri): boolean {
  const n = (u: vscode.Uri) => u.toString().replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}

export class NativeTests {
  constructor(private readonly context: vscode.ExtensionContext, private readonly session: WorkSession, private readonly version: string) {}

  receipts(): TestReceipt[] {
    const v = this.context.workspaceState.get<unknown>(KEY);
    return Array.isArray(v) ? v as TestReceipt[] : [];
  }

  private async keep(r: TestReceipt): Promise<void> { await this.context.workspaceState.update(KEY, addReceipt(this.receipts(), r)); }

  /** Resolve, confirm, run, wait, record. Returns the receipt, or undefined when nothing ran. */
  async run(componentId: string): Promise<TestReceipt | undefined> {
    if (!vscode.workspace.isTrusted) throw new UserFacingError("Restricted Mode: DataPass does not run a project's tests in an untrusted workspace. Trust the folder first (Manage Workspace Trust).");
    const c = this.session.projectMap().components.find(x => x.id === componentId)!;
    const view = await resolveComponentTest(this.session, componentId);
    const r = view.resolution;
    if (r.state !== "found") {
      report(`Test · ${c?.label ?? componentId}`, [`Not run: ${r.reason}.`, ...(r.state === "none" ? [`To declare one, add a task with "group": "test" and "options": { "cwd": "\${workspaceFolder}/<component folder>" } to ${TASKS_FILE} in the native repository.`] : [])]);
      void vscode.window.showWarningMessage(`DataPass: not run — ${r.reason}.`);
      return undefined;
    }
    const folder = view.folder!;
    const wsFolder = vscode.workspace.workspaceFolders?.find(f => sameFolder(f.uri, folder));
    if (!wsFolder) throw new UserFacingError(`Repository ${view.repoKey} is not a folder of this window, so VS Code cannot run its tasks. Open it in this window (File › Add Folder to Workspace) or in its own window.`);
    const tasks = (await vscode.tasks.fetchTasks()).filter(t => t.name === r.task.label && t.scope && typeof t.scope === "object" && sameFolder((t.scope as vscode.WorkspaceFolder).uri, folder));
    if (tasks.length !== 1) throw new UserFacingError(tasks.length ? `VS Code lists ${tasks.length} tasks named "${r.task.label}" in this repository; rename one.` : `VS Code does not list the task "${r.task.label}" (its type may need an extension that is not installed).`);
    const ok = await confirmModal(`Run the test of ${c.label}?`, [
      `Task "${r.task.label}" from ${TASKS_FILE} (${r.why}).`,
      `Runs: ${r.task.commandLine}`,
      `In: ${r.task.cwd || "the repository root"} of ${view.repoKey}.`,
      "It runs this project's own code on your machine. DataPass records the commit, the time and the exit code on this machine only."
    ].join("\n"), "Run test");
    if (!ok) return undefined;
    const before = await gitState(folder.fsPath);
    const startedAt = new Date().toISOString();
    let exitCode: number | undefined, cancelled = false;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `DataPass: testing ${c.label} ("${r.task.label}")`, cancellable: true }, async (_p, token) => {
      const execution = await vscode.tasks.executeTask(tasks[0]!);
      await new Promise<void>(resolve => {
        const subs: vscode.Disposable[] = [];
        const done = () => { subs.forEach(s => s.dispose()); resolve(); };
        subs.push(
          vscode.tasks.onDidEndTaskProcess(e => { if (e.execution === execution) exitCode = e.exitCode; }),
          vscode.tasks.onDidEndTask(e => { if (e.execution === execution) setTimeout(done, 50); }), // the process event may arrive just after
          token.onCancellationRequested(() => { cancelled = true; execution.terminate(); })
        );
      });
    });
    const receipt: TestReceipt = {
      componentId, repoKey: view.repoKey!, task: r.task.label, commandLine: r.task.commandLine, cwd: r.task.cwd ?? "",
      ...before, startedAt, endedAt: new Date().toISOString(), ...(exitCode !== undefined ? { exitCode } : {}),
      outcome: outcomeOf(exitCode, cancelled), dataPassVersion: this.version
    };
    await this.keep(receipt);
    report(`Test receipt · ${c.label}`, receiptLines(receipt));
    const msg = `DataPass: test of ${c.label} — ${receiptLines(receipt)[0]!.replace(/^Result: /, "")}.`;
    if (receipt.outcome === "passed") void vscode.window.showInformationMessage(msg); else void vscode.window.showWarningMessage(msg);
    return receipt;
  }
}

export function registerNativeTestCommands(context: vscode.ExtensionContext, session: WorkSession, version: string): NativeTests {
  const tests = new NativeTests(context, session, version);
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  const componentOf = async (arg: unknown): Promise<string | undefined> => {
    // A component id, { componentId }, or the Project tree's component node ({ t: "component", c: { id } }).
    const o = arg && typeof arg === "object" ? arg as { componentId?: unknown; t?: unknown; c?: { id?: unknown } } : undefined;
    const id = typeof arg === "string" ? arg : typeof o?.componentId === "string" ? o.componentId : o?.t === "component" && typeof o.c?.id === "string" ? o.c.id : session.selection().component;
    if (id) return id;
    const pick = await vscode.window.showQuickPick(session.projectMap().components.filter(c => c.artifacts).map(c => ({ label: c.label, description: c.id, id: c.id })), { title: "Test which component?" });
    return pick?.id;
  };
  reg(RUN_TEST, async (arg?: unknown) => {
    const id = await componentOf(arg);
    if (id) await tests.run(id);
  });
  reg(SHOW_TEST_RECEIPTS, async () => {
    const list = tests.receipts();
    if (!list.length) { void vscode.window.showInformationMessage("DataPass: no test has been run from DataPass in this workspace."); return; }
    report("Test receipts (this machine, newest first)", list.flatMap(r => [`— ${r.componentId}`, ...receiptLines(r).map(l => `  ${l}`)]));
    output().show(true);
  });
  return tests;
}
