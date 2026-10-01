/**
 * V5 PQSAMP1 host: `datapass.codeSteps.sampleStep` gives a code step a data sample, chosen by the person:
 *  - from a local data file they pick, read by Data X-Ray's DuckDB (only when X-Ray is installed);
 *  - by copying a sample request for their own AI, then pasting its answer back (stamped ai-proposed).
 * No hidden AI call, no execution of the step's code, no remote call. Samples live in memory per step
 * (`PqSampleStore`); the code-steps host reads them through `bindCodeStepsSamples` (`withSamples`).
 * Labels are data (`DEFAULT_PQ_SAMPLE_UI`).
 */
import * as vscode from "vscode";
import type { NavSurface } from "../core/navigation/register";
import {
  readAiSampleAnswer, readXraySample, resolveStepSample, SAMPLE_MAX_ROWS, stepSampleRequest,
  type StepSample, type StepSampleRequest, type StepSampleSubject
} from "../core/exchange/stepSample";
import { stepSubjectOf, withSamples, type CodeStepsInput } from "../webview/views/layouts/codeSteps";

export const XRAY_EXTENSION_ID = "datapass.datapass-data-xray";
export const XRAY_SAMPLE_COMMAND = "datapass.dataXray._sample";
export const SAMPLE_STEP_COMMAND = "datapass.codeSteps.sampleStep";

export const DEFAULT_PQ_SAMPLE_UI = {
  placeholder: "Data sample for step \"{step}\"",
  fromFile: "From a local data file (Data X-Ray)",
  fromFileDetail: "Reads a small read-only sample of the file you pick. Nothing else runs.",
  copyRequest: "Copy a sample request for my AI",
  copyRequestDetail: "Your AI proposes a sample; it is marked ai-proposed.",
  pasteAnswer: "Paste my AI's sample answer",
  clear: "Clear this step's sample",
  noXray: "Data X-Ray is not installed: the step keeps a hole, or ask your AI through the exchange.",
  copied: "Sample request copied. Paste it in your AI, copy its JSON answer, then run this command again and choose \"Paste my AI's sample answer\".",
  noRequest: "Copy a sample request for this step first.",
  askStep: "Step id (select a step in the code-steps view to skip this)",
  pickFile: "Sample this file",
  fileFilter: "Data files"
} as const;

interface Entry { xray?: StepSample; ai?: StepSample; request?: StepSampleRequest }

export class PqSampleStore implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly changed = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changed.event;
  /** Set by the code-steps host on `{type:"select"}`; the command uses it when called without a step. */
  selected?: StepSampleSubject;

  sampleOf(stepId: string): StepSample | undefined {
    const e = this.entries.get(stepId);
    return e && (e.xray || e.ai) ? resolveStepSample(e) : undefined;
  }
  requestOf(stepId: string): StepSampleRequest | undefined { return this.entries.get(stepId)?.request; }
  set(stepId: string, patch: Entry): void {
    this.entries.set(stepId, { ...this.entries.get(stepId), ...patch });
    this.changed.fire(stepId);
  }
  clear(stepId: string): void { this.entries.delete(stepId); this.changed.fire(stepId); }
  dispose(): void { this.changed.dispose(); }
}

/** One store per activation; the code-steps view host reads it. */
export const pqSamples = new PqSampleStore();

function subjectOf(arg: unknown): StepSampleSubject | undefined {
  if (typeof arg === "string" && arg) return { id: arg, label: arg, kind: "other" };
  if (arg && typeof arg === "object" && typeof (arg as { id?: unknown }).id === "string") {
    const a = arg as Partial<StepSampleSubject> & { id: string };
    return { id: a.id, label: typeof a.label === "string" ? a.label : a.id, kind: typeof a.kind === "string" ? a.kind : "other", tables: a.tables, params: a.params };
  }
  return undefined;
}

async function sampleFromFile(store: PqSampleStore, step: StepSampleSubject, ui: typeof DEFAULT_PQ_SAMPLE_UI): Promise<void> {
  if (!vscode.extensions.getExtension(XRAY_EXTENSION_ID)) { void vscode.window.showInformationMessage(ui.noXray); return; }
  const [uri] = await vscode.window.showOpenDialog({
    canSelectMany: false, openLabel: ui.pickFile, filters: { [ui.fileFilter]: ["parquet", "csv", "tsv", "json", "jsonl", "ndjson"] }
  }) ?? [];
  if (!uri) return;
  try {
    const sample = readXraySample(await vscode.commands.executeCommand(XRAY_SAMPLE_COMMAND, uri, SAMPLE_MAX_ROWS));
    store.set(step.id, { xray: sample ?? { state: "hole", reason: "Data X-Ray returned no usable sample." } });
  } catch (e) {
    store.set(step.id, { xray: { state: "hole", reason: `Data X-Ray could not sample the file: ${(e as Error).message}`.slice(0, 300) } });
  }
}

export function registerPqSampleCommand(store: PqSampleStore = pqSamples, ui = DEFAULT_PQ_SAMPLE_UI): vscode.Disposable {
  return vscode.commands.registerCommand(SAMPLE_STEP_COMMAND, async (arg?: unknown) => {
    let step = subjectOf(arg) ?? store.selected;
    if (!step) {
      const id = (await vscode.window.showInputBox({ prompt: ui.askStep }))?.trim();
      if (!id) return;
      step = { id, label: id, kind: "other" };
    }
    type Item = vscode.QuickPickItem & { run: () => Promise<void> | void };
    const items: Item[] = [
      { label: ui.fromFile, detail: ui.fromFileDetail, run: () => sampleFromFile(store, step!, ui) },
      { label: ui.copyRequest, detail: ui.copyRequestDetail, run: async () => {
        const request = stepSampleRequest(step!);
        store.set(step!.id, { request });
        await vscode.env.clipboard.writeText(request.text);
        void vscode.window.showInformationMessage(ui.copied);
      } },
      { label: ui.pasteAnswer, run: async () => {
        const request = store.requestOf(step!.id);
        if (!request) { void vscode.window.showWarningMessage(ui.noRequest); return; }
        const read = readAiSampleAnswer(await vscode.env.clipboard.readText(), { stepId: step!.id, digest: request.digest });
        if (read.ok) store.set(step!.id, { ai: read.sample }); else void vscode.window.showWarningMessage(read.reason);
      } },
      ...(store.sampleOf(step.id) ? [{ label: ui.clear, run: () => store.clear(step!.id) }] : [])
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: ui.placeholder.replace("{step}", step.label) });
    await pick?.run();
  });
}

/**
 * The code-steps host's hook (one call where it draws the layout): `input` adds the stored samples
 * (`withSamples`), `onMessage` sets `selected` on `{type:"select"}` so the command needs no step id, and
 * `redraw` runs whenever a sample changes. Dispose it with the view.
 */
export function bindCodeStepsSamples(current: () => CodeStepsInput | undefined, redraw: () => void, store: PqSampleStore = pqSamples): {
  input(base: CodeStepsInput): CodeStepsInput; onMessage(message: unknown): void; dispose(): void
} {
  const sub = store.onDidChange(() => redraw());
  return {
    input: base => withSamples(base, id => store.sampleOf(id)),
    onMessage: message => {
      const m = message as { type?: unknown; nodeId?: unknown } | null;
      const input = current();
      if (m && m.type === "select" && typeof m.nodeId === "string" && input) store.selected = stepSubjectOf(input, m.nodeId) ?? store.selected;
    },
    dispose: () => sub.dispose()
  };
}

/** NavSurface, self-registered by `pqSample.surface.ts`. */
export const registerPqSample: NavSurface = () => [registerPqSampleCommand(), pqSamples];
