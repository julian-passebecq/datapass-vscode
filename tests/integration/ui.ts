/**
 * Scripted UI for desktop tests. Replaces the `vscode.window` prompt methods (and the
 * clipboard) of the extension host's API object with a queue of scripted answers, so the
 * real command handlers run end to end without a human. Every prompt is recorded; the
 * system clipboard is never read or written.
 */
import * as vscode from "vscode";

export type Step =
  | { pick: string | string[] }          // label substring(s); canPickMany takes all matches
  | { input: string }
  | { button: string }                   // message/modal button
  | { open: vscode.Uri[] }               // file dialog result
  | { dismiss: true };                   // Esc / close

export interface Prompt { kind: "pick" | "input" | "message" | "open"; title?: string; text?: string; options?: string[]; modal?: boolean }

const plain = (label: string) => label.replace(/\$\([^)]+\)\s*/g, "").trim();
const labelOf = (item: unknown) => (typeof item === "string" ? item : String((item as { label?: string })?.label ?? ""));

export class ScriptedUi {
  readonly prompts: Prompt[] = [];
  readonly errors: string[] = [];
  readonly notices: string[] = [];
  clipboard = "";
  private steps: Step[] = [];
  private saved: Array<[object, string, unknown]> = [];

  /** Queue answers in the order the command will ask. */
  script(...steps: Step[]): this { this.steps.push(...steps); return this; }
  remaining(): number { return this.steps.length; }

  install(): this {
    const w = vscode.window as unknown as Record<string, unknown>;
    const patch = (target: object, key: string, fn: unknown) => {
      this.saved.push([target, key, (target as Record<string, unknown>)[key]]);
      (target as Record<string, unknown>)[key] = fn;
      if ((target as Record<string, unknown>)[key] !== fn) throw new Error(`vscode API ${key} is not patchable in this VS Code build`);
    };
    patch(w, "showQuickPick", async (items: unknown, options?: vscode.QuickPickOptions) => {
      const list = (await items) as unknown[];
      this.prompts.push({ kind: "pick", title: options?.title, options: list.map(i => plain(labelOf(i))) });
      const step = this.next("pick", options?.title);
      if (!step || "dismiss" in step) return undefined;
      if (!("pick" in step)) throw new Error(`expected a pick step for "${options?.title}", got ${JSON.stringify(step)}`);
      const wanted = Array.isArray(step.pick) ? step.pick : [step.pick];
      const matches = list.filter(i => wanted.some(w => plain(labelOf(i)).includes(w)));
      if (!matches.length) throw new Error(`no item matching ${JSON.stringify(wanted)} in "${options?.title}": ${list.map(i => plain(labelOf(i))).join(" | ")}`);
      return options?.canPickMany ? matches : matches[0];
    });
    patch(w, "showInputBox", async (options?: vscode.InputBoxOptions) => {
      this.prompts.push({ kind: "input", title: options?.title, text: options?.prompt });
      const step = this.next("input", options?.title);
      if (!step || "dismiss" in step) return undefined;
      if (!("input" in step)) throw new Error(`expected an input step for "${options?.title}", got ${JSON.stringify(step)}`);
      const invalid = await options?.validateInput?.(step.input);
      if (invalid) throw new Error(`scripted input rejected by the command's own validation: ${typeof invalid === "string" ? invalid : invalid.message}`);
      return step.input;
    });
    const message = (level: "info" | "warning" | "error") => async (text: string, ...rest: unknown[]) => {
      const opts = rest[0] && typeof rest[0] === "object" && !("title" in (rest[0] as object)) ? rest.shift() as vscode.MessageOptions : undefined;
      const buttons = rest.map(labelOf);
      if (level === "error") this.errors.push(text); else this.notices.push(text);
      this.prompts.push({ kind: "message", text: opts?.detail ? `${text}
${opts.detail}` : text, options: buttons, modal: !!opts?.modal });
      // Plain notifications do not consume a step; anything asking for a choice does.
      if (!buttons.length) return undefined;
      const step = this.next("message", text);
      if (!step || "dismiss" in step) return undefined;
      if (!("button" in step)) throw new Error(`expected a button step for "${text}", got ${JSON.stringify(step)}`);
      if (!buttons.includes(step.button)) throw new Error(`no button "${step.button}" on "${text}": ${buttons.join(" | ")}`);
      return rest.find(b => labelOf(b) === step.button);
    };
    patch(w, "showInformationMessage", message("info"));
    patch(w, "showWarningMessage", message("warning"));
    patch(w, "showErrorMessage", message("error"));
    patch(w, "showOpenDialog", async (options?: vscode.OpenDialogOptions) => {
      this.prompts.push({ kind: "open", title: options?.title });
      const step = this.next("open", options?.title);
      if (!step || "dismiss" in step) return undefined;
      if (!("open" in step)) throw new Error(`expected an open step for "${options?.title}", got ${JSON.stringify(step)}`);
      return step.open;
    });
    // vscode.env.clipboard is frozen; DataPass routes all clipboard use through a Test-mode seam.
    this.setClipboard({ readText: async () => this.clipboard, writeText: async (value: string) => { this.clipboard = value; } });
    this.saved.push([{}, "clipboard", undefined]);
    return this;
  }

  constructor(private readonly setClipboard: (impl?: { readText(): Thenable<string>; writeText(v: string): Thenable<void> }) => void) {}

  restore(): void {
    this.setClipboard(undefined);
    for (const [target, key, value] of this.saved.reverse()) if (key !== "clipboard") (target as Record<string, unknown>)[key] = value;
    this.saved = [];
  }

  private next(kind: string, what?: string): Step | undefined {
    const step = this.steps.shift();
    if (!step) this.prompts.push({ kind: "message", text: `(unscripted ${kind} "${what ?? ""}" dismissed)` });
    return step;
  }
}

/** Run `fn` with a scripted UI; fail if the command reported an error or left steps unused. */
let setClipboard: ConstructorParameters<typeof ScriptedUi>[0] = () => { throw new Error("call bindUi() first"); };

/** Connect the scripted UI to the extension's Test-mode clipboard seam. */
export function bindUi(api: { setClipboard: ConstructorParameters<typeof ScriptedUi>[0] }): void {
  setClipboard = impl => api.setClipboard(impl);
}

export async function withUi(steps: Step[], fn: (ui: ScriptedUi) => PromiseLike<unknown>, opts: { allowErrors?: boolean } = {}): Promise<ScriptedUi> {
  const ui = new ScriptedUi(setClipboard).script(...steps);
  try {
    ui.install();
    await fn(ui);
  } finally {
    ui.restore();
  }
  if (!opts.allowErrors && ui.errors.length) throw new Error(`command reported: ${ui.errors.join(" / ")}`);
  if (ui.remaining()) throw new Error(`${ui.remaining()} scripted step(s) were never asked for; prompts were: ${JSON.stringify(ui.prompts)}`);
  return ui;
}
