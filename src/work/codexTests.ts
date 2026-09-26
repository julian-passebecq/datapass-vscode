/**
 * QA-2: the "Codex tests" section of the Work orders view (handoff/v3/12 §4.5), surface
 * `ai.codexTests` (DataPass and Advanced modes).
 *
 * It reads the clone of a test repository named by the machine setting
 * `datapass.codexTests.autoRepository` (datapass-codex-tests.json and its journeys, QA-1 formats),
 * and the audit clone beside it (the folder named after the report remote, e.g. datapass-codex-test)
 * for the last report under reports/<purpose>/<run id>/report.json. *Hand to Codex* writes a work
 * order of kind `qa-run` in this project's work-orders folder, prepares the run root under
 * %TEMP%\datapass-qa\<run id> and hands it to the Codex desktop app (the AI-3 hand-off: the only
 * host that can drive VS Code, QA-0).
 *
 * The receipt: when the order's result.json arrives (checked by the work-order service as usual),
 * report.json in the order folder must be a valid qa-report for the order's run id, version and
 * purpose. Then the order is marked done, with the report pull request found in the result.
 *
 * Every file read here is untrusted data (strict parsers, bounded sizes); nothing from it is executed.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { CODEX_TESTS_FILE, MAX_FILE_BYTES, QaFormatError, parseCodexTests, parseQaReport, parseTestJourney, reportFolder, runIdOf, type CodexTestsConfig, type TestJourney } from "../qa/formats";
import { auditFolderName, checkQaReceipt, latestRunId, qaRunOrderMd, reportPullRequest, reportSummary, type QaReportSummary, type QaRunStamp } from "../qa/runOrder";
import { buildOrder, resultFormatMd } from "../core/workOrders/builder";
import { localIso, shortId, type WorkOrder } from "../core/workOrders/format";
import { LOCAL_DIR, readOptional } from "../core/workspace/loader";
import { openExternal } from "../core/external";
import { machineSetting, orderDigest, type LoadedOrder, type WorkOrderService } from "./workOrders";
import type { WorkSession } from "./session";
import type { WbCodexTests } from "../views/workbenchState";
import { UserFacingError, errorMessage, guarded, jsonBytes, requireRoot } from "./io";

export const AUTO_REPOSITORY_SETTING = "codexTests.autoRepository";

interface Loaded {
  repository?: string;
  config?: CodexTestsConfig;
  error?: string;
  journeys: TestJourney[];
  journeyErrors: string[];
  auditFolder?: string;
  lastReport?: QaReportSummary & { folder: string };
  reportNote?: string;
}

function readBoundedSync(file: string): Uint8Array {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error(`${file} is not a file`);
  if (st.size > MAX_FILE_BYTES) throw new Error(`${path.basename(file)} is larger than ${MAX_FILE_BYTES / 1024} KiB`);
  return fs.readFileSync(file);
}

const stampOf = (o: WorkOrder): QaRunStamp | undefined => o.qa ? { purpose: o.qa.purpose, runId: o.qa.runId, version: o.qa.version } : undefined;

/** TOML literal string: single quotes, no quote inside (the paths DataPass writes never hold one). */
const tomlLiteral = (s: string) => { if (/['\r\n]/.test(s)) throw new UserFacingError(`The path ${s} cannot be written into the Codex settings.`); return `'${s}'`; };

export class CodexTestsService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private loaded: Loaded = { journeys: [], journeyErrors: [] };
  /** How a written order is handed to Codex (the AI-3 hand-off; replaced in the desktop tests). */
  launcher: (orderId: string) => Promise<unknown>;
  /** Receipts already turned into "done" (so an order is closed once). */
  private readonly closing = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: WorkSession,
    private readonly orders: WorkOrderService,
    handToCodexApp: (orderId: string) => Promise<unknown>
  ) {
    this.launcher = handToCodexApp;
    this.subs.push(
      this.emitter,
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(`datapass.${AUTO_REPOSITORY_SETTING}`)) void this.reload(); }),
      orders.onDidChange(() => { void this.checkReceipts(); this.emitter.fire(); })
    );
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  /** The machine-local clone of the test repository (a workspace can never set it). */
  repository(): string | undefined {
    const v = machineSetting<string>(AUTO_REPOSITORY_SETTING);
    return typeof v === "string" && v.trim() && path.isAbsolute(v.trim()) ? path.normalize(v.trim()) : undefined;
  }

  /** Re-read the test repository, its journeys and the audit clone's last report. */
  async reload(): Promise<void> {
    this.loaded = this.read();
    await this.checkReceipts();
    this.emitter.fire();
  }

  private read(): Loaded {
    const repository = this.repository();
    const out: Loaded = { repository, journeys: [], journeyErrors: [] };
    if (!repository) return out;
    try { out.config = parseCodexTests(readBoundedSync(path.join(repository, CODEX_TESTS_FILE)), CODEX_TESTS_FILE); }
    catch (e) { out.error = e instanceof QaFormatError ? e.message : `${CODEX_TESTS_FILE}: ${fs.existsSync(repository) ? errorMessage(e) : `the folder ${repository} does not exist`}`; return out; }
    for (const rel of out.config.journeys) {
      try { out.journeys.push(parseTestJourney(readBoundedSync(path.join(repository, ...rel.split("/"))), rel)); }
      catch (e) { out.journeyErrors.push(e instanceof QaFormatError ? e.message : `${rel}: ${errorMessage(e)}`); }
    }
    const name = auditFolderName(out.config.report.remote);
    if (!name) { out.reportNote = "The report remote has no repository name."; return out; }
    const audit = path.join(path.dirname(repository), name);
    out.auditFolder = audit;
    const runs = path.join(audit, ...out.config.report.folder.split("/"), out.config.purpose);
    let names: string[] = [];
    try { names = fs.readdirSync(runs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { /* none yet */ }
    const last = latestRunId(names);
    if (!last) { out.reportNote = fs.existsSync(audit) ? `No report yet in ${name}/${out.config.report.folder}/${out.config.purpose}.` : `Clone ${out.config.report.remote} beside the test repository to see its reports.`; return out; }
    const folder = path.join(runs, last);
    try { out.lastReport = { ...reportSummary(parseQaReport(readBoundedSync(path.join(folder, "report.json")))), folder }; }
    catch (e) { out.reportNote = `The last report (${last}) cannot be read: ${e instanceof QaFormatError ? e.issues.slice(0, 2).join("; ") : errorMessage(e)}`; }
    return out;
  }

  private qaOrders(): LoadedOrder[] { return this.orders.list().filter(o => o.order?.kind === "qa-run"); }

  /** A qa-run order's receipt: its result arrived and report.json in the order folder is for exactly its run. */
  private receiptOf(o: LoadedOrder): { receipt: "waiting" | "matches" | "refused"; message?: string; pr?: string } {
    const stamp = o.order && stampOf(o.order);
    if (!stamp) return { receipt: "refused", message: "not a Codex test run" };
    if (o.result.state === "refused") return { receipt: "refused", message: `result.json: ${o.result.message}` };
    if (o.result.state !== "valid") return { receipt: "waiting" };
    let raw: Uint8Array;
    try { raw = readBoundedSync(path.join(o.folder.fsPath, "report.json")); }
    catch { return { receipt: "refused", message: "result.json arrived without report.json in the order folder" }; }
    const r = checkQaReceipt(raw, stamp);
    if (!r.ok) return { receipt: "refused", message: r.message };
    return { receipt: "matches", pr: reportPullRequest(o.result.checked.result.summary, o.order!.qa!.report.remote) };
  }

  /** A matching receipt closes the order (done), once, with the report pull request in its note. */
  private async checkReceipts(): Promise<void> {
    for (const o of this.qaOrders()) {
      if (!o.state || o.state.closed || this.closing.has(o.id)) continue;
      const r = this.receiptOf(o);
      if (r.receipt !== "matches") continue;
      this.closing.add(o.id);
      try {
        await this.orders.updateState(o.id, s => ({ ...s, status: "done", closed: { at: localIso(new Date()), how: "done", note: `Codex test report ${o.order!.qa!.runId} received${r.pr ? `: ${r.pr}` : ""}` } }));
      } catch { this.closing.delete(o.id); }
    }
  }

  /** What the section shows. */
  view(): WbCodexTests {
    const l = this.loaded;
    const verdict = this.orders.verdict();
    const why = !l.repository ? "Set datapass.codexTests.autoRepository to the clone of your test repository."
      : !l.config ? "The test repository cannot be read."
      : !this.session.project.manifest ? "Open a DataPass project: the order is written in its work-orders folder."
      : !verdict.allowed ? verdict.why
      : !vscode.workspace.isTrusted ? "Restricted Mode: trust this workspace first."
      : !l.journeys.length ? "No journey could be read."
      : undefined;
    return {
      configured: Boolean(l.repository), repository: l.repository, error: l.error,
      purpose: l.config?.purpose, version: l.config?.datapass.version,
      title: l.config ? (l.config.purpose === "app" ? `DataPass app tests (${l.config.workspaces.length} workspace${l.config.workspaces.length === 1 ? "" : "s"})` : l.config.workspaces[0]!.client.title) : undefined,
      journeys: l.journeys.map(j => ({ id: j.id, title: j.title, features: [...j.features] })),
      journeyErrors: l.journeyErrors,
      auditFolder: l.auditFolder, lastReport: l.lastReport, reportNote: l.reportNote,
      runs: this.qaOrders().filter(o => o.order?.qa).map(o => ({ id: o.id, short: shortId(o.id), runId: o.order!.qa!.runId, status: o.state?.status ?? "written", ...this.receiptOf(o) })),
      canHand: !why, why
    };
  }

  /** *Hand to Codex*: write the qa-run order (and the run root's Codex settings), then hand it to the Codex app. */
  async handToCodex(): Promise<LoadedOrder> {
    await this.reload();
    const v = this.view();
    if (!v.canHand) throw new UserFacingError(v.why ?? "Codex tests are not ready.");
    const l = this.loaded;
    const config = l.config!;
    const manifest = this.session.project.manifest!;
    const ordersFolder = this.orders.ordersFolder();
    if (!ordersFolder) throw new UserFacingError("This project has no work-orders folder.");
    const now = new Date();
    const runId = runIdOf(config, now);
    const runRoot = path.join(os.tmpdir(), "datapass-qa", runId);
    const version = config.datapass.version;
    const folderFor = (id: string) => path.join(ordersFolder.fsPath, id);
    const order = buildOrder({
      now, random: randomBytes(12), createdBy: `DataPass ${String(this.context.extension.packageJSON.version ?? "unknown")}`,
      kind: "qa-run", title: `Codex tests ${runId}`.slice(0, 80),
      goal: `Walk the ${l.journeys.length} ${config.purpose === "app" ? "app" : "client"} journey${l.journeys.length === 1 ? "" : "s"} of the test repository with DataPass ${version} and report (run ${runId}).`,
      project: { id: manifest.project.id, title: manifest.project.title, type: this.orders.projectType().type },
      scope: {}, known: { subprojects: [], components: [], cards: [], decisions: [], columns: [] },
      repositories: [{ ref: "tests", localPath: l.repository!, access: "read" }],
      branchPrefix: "dp/",
      context: { datapassFiles: [], conventions: [], handoffs: [], attachments: ["attachments/result-format.md"] },
      expected: { doneWhen: [`report.json of run ${runId} (DataPass ${version}) is in this order's folder and its pull request is open on ${config.report.remote}`] },
      merge: "person",
      qa: { purpose: config.purpose, runId, version, autoRepository: l.repository!, runRoot, report: { remote: config.report.remote, folder: reportFolder(config, runId) } },
      agent: { tool: "codex", surface: "desktop", effort: "medium", permissions: "ask" },
      folderFor, pathJoin: (...p) => path.join(...p)
    });
    const folder = vscode.Uri.file(folderFor(order.id));
    const md = qaRunOrderMd({
      order: { id: order.id, receipt: order.receipt, resultPath: order.result.path, folder: folder.fsPath },
      config, journeys: l.journeys, stamp: { purpose: config.purpose, runId, version }, autoRepository: l.repository!, runRoot
    });
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, "attachments"));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, "attachments", "result-format.md"), new TextEncoder().encode(resultFormatMd(order)));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, "order.json"), jsonBytes(order));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, "order.md"), new TextEncoder().encode(md));
    const ignore = vscode.Uri.joinPath(requireRoot(this.session.root), ...LOCAL_DIR.split("/"), ".gitignore");
    if (!(await readOptional(ignore))) await vscode.workspace.fs.writeFile(ignore, new TextEncoder().encode("# DataPass private session data. Never committed.\n*\n"));
    // The run root, with Codex's project settings: workspace-write in the run root, the order folder writable, approvals on request.
    const codexDir = vscode.Uri.file(path.join(runRoot, ".codex"));
    await vscode.workspace.fs.createDirectory(codexDir);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(codexDir, "config.toml"), new TextEncoder().encode([
      `# Written by DataPass for the Codex test run ${runId} (work order ${order.id}).`,
      "# Workspace-write in this run root; the order folder is writable for report.json and result.json.",
      "# Network is for git, npm and building the VSIX only (the order's rules). Launching VS Code needs one escalated run you approve.",
      'sandbox_mode = "workspace-write"',
      'approval_policy = "on-request"',
      "",
      "[sandbox_workspace_write]",
      "network_access = true",
      `writable_roots = [${tomlLiteral(folder.fsPath)}]`,
      ""
    ].join("\n")));
    const digest = await orderDigest(folder);
    await this.orders.markOwn(order.id, digest);
    await this.orders.writeState(folder, { format: "datapass.work-order-state", version: "1", orderId: order.id, digest, status: "written", launches: [], seen: { pullRequests: [] }, closed: null });
    await this.orders.reload();
    const loaded = this.orders.get(order.id);
    if (!loaded) throw new UserFacingError("The order was written but could not be read back.");
    await this.launcher(order.id);
    this.emitter.fire();
    return loaded;
  }

  /** Open the last report: summary.md beside it when there is one, else report.json. */
  async openLastReport(): Promise<void> {
    const last = this.loaded.lastReport;
    if (!last) throw new UserFacingError(this.loaded.reportNote ?? "No report yet.");
    const summary = path.join(last.folder, "summary.md");
    const file = fs.existsSync(summary) ? summary : path.join(last.folder, "report.json");
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
  }

  /** Open a run's report pull request (the address was rebuilt from the audit remote). */
  async openRunPr(orderId: unknown): Promise<void> {
    const run = this.view().runs.find(r => r.id === orderId);
    if (!run?.pr) throw new UserFacingError("This run has no report pull request yet.");
    await openExternal(vscode.Uri.parse(run.pr));
  }
}

/** The section's commands. Arguments are untrusted: an order id is looked up in the current list. */
export function registerCodexTestsCommands(context: vscode.ExtensionContext, tests: CodexTestsService, showWorkOrders: () => Promise<void>): void {
  const reg = (id: string, fn: (...args: any[]) => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));
  reg("datapass.codexTests.handToCodex", async () => {
    const v = tests.view();
    if (!v.canHand) throw new UserFacingError(v.why ?? "Codex tests are not ready.");
    const ok = await vscode.window.showWarningMessage(`Hand ${v.journeys.length} Codex test journey${v.journeys.length === 1 ? "" : "s"} to the Codex app?`, {
      modal: true,
      detail: [
        `DataPass writes a qa-run work order in this project and a run folder under ${path.join(os.tmpdir(), "datapass-qa")}, copies the prompt and opens the Codex app there.`,
        "Codex then builds and installs your DataPass VSIX in an isolated VS Code profile and drives that window with Computer Use: it takes over the mouse and keyboard, so leave the PC alone while it runs.",
        "It uses your Codex plan. It never signs in to a cloud, and it opens one pull request in the audit repository."
      ].join("\n")
    }, "Hand to Codex");
    if (ok !== "Hand to Codex") return;
    const o = await tests.handToCodex();
    await showWorkOrders();
    void vscode.window.showInformationMessage(`Work order ${shortId(o.id)} handed to Codex: paste the copied prompt into a new thread of the Codex app (in its run folder).`);
  });
  reg("datapass.codexTests.openLastReport", () => tests.openLastReport());
  reg("datapass.codexTests.openRunPr", id => tests.openRunPr(id));
  reg("datapass.codexTests.chooseRepository", async () => { await vscode.commands.executeCommand("workbench.action.openSettings", `datapass.${AUTO_REPOSITORY_SETTING}`); });
  reg("datapass.codexTests.refresh", () => tests.reload());
}
