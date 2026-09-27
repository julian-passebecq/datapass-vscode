/**
 * 0.25 (package V-A): the selected variant (a preview) on this machine — the status-bar switcher, the commands,
 * and the link between the session's architecture preview and VS Code's global state.
 *
 * The preview *is* the active variant: choosing a scenario in the Options view, on the diagram or
 * in the status bar switches it, and it comes back when the project reopens (any window, same
 * machine). Nothing is written in a repository; *Record decision* stays the committed path.
 */
import * as vscode from "vscode";
import type { WorkSession } from "./session";
import { guarded, UserFacingError } from "./io";
import { SwitchCounter } from "../core/refresh/tracker";
import {
  ACTIVE_VARIANT_KEY, activeVariantLine, activeVariantView, readStore, resolveActiveVariant, sameRequest,
  statusBarText, variantChoices, withEntry, withOwn, type ActiveVariantEntry, type ActiveVariantStore, type ActiveVariantView, type VariantRequest
} from "../core/project/activeVariant";
import { CODING_LABELS, CODING_NOTE } from "../core/project/variants";

const SURFACE = "status.selectedVariant";

/** This project's key in the machine-wide store (the project id; the folder when there is no manifest). */
function projectKey(session: WorkSession): string | undefined {
  return session.project.manifest?.project.id ?? session.root?.toString();
}

/** The active variant as the packs and the status bar show it (undefined when the project has no options). */
export function currentActiveVariant(session: WorkSession): ActiveVariantView | undefined {
  const options = session.project.options;
  if (!options) return undefined;
  return activeVariantView(options, session.variants(), session.preview());
}

/** The header line of a pack for an AI, or undefined when the project has no options. */
export function activeVariantHeader(session: WorkSession): string | undefined {
  const v = currentActiveVariant(session);
  return v ? activeVariantLine(v) : undefined;
}

export class ActiveVariantService implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subs: vscode.Disposable[] = [];
  /** The project whose remembered variant was applied (switches after that are remembered). */
  private appliedFor?: string;
  private applying = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: WorkSession, private readonly shows: (surface: string) => boolean, onSurfaces: vscode.Event<unknown>) {
    this.item = vscode.window.createStatusBarItem("datapass.activeVariant", vscode.StatusBarAlignment.Left, 21);
    this.item.name = "DataPass selected variant";
    this.item.command = "datapass.switchVariant";
    this.subs.push(
      this.item,
      session.onDidChange(() => void this.sync()),
      session.onDidChangeSelection(() => void this.remember()),
      onSurfaces(() => this.paint())
    );
    void this.sync();
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }

  /**
   * V1-FLAKE2: the entries this window saved, over the global state. Its in-memory copy is replaced
   * wholesale when a storage change comes back from the workbench, and that echo can be of an older
   * write (B after C and "current" were saved): read alone, it brought a forgotten variant back.
   */
  private readonly own = new Map<string, ActiveVariantEntry | undefined>();
  private store(): ActiveVariantStore { return withOwn(readStore(this.context.globalState.get(ACTIVE_VARIANT_KEY)), this.own); }

  /** After a project (re)load: apply the remembered variant once, and fall back when it vanished. */
  private async sync(): Promise<void> {
    const key = projectKey(this.session);
    if (!key || !this.session.project.options) { this.appliedFor = key; this.paint(); return; }
    const first = this.appliedFor !== key;
    const note = this.switches.note();
    // First load: the remembered variant; with none yet, the window's preview (0.15–0.24) is kept.
    const entry = first ? this.store()[key] ?? this.session.previewRequest() : this.session.previewRequest();
    const r = resolveActiveVariant(this.session.project.options, entry);
    if (first || r.fellBack) {
      this.appliedFor = key;
      if (!sameRequest(r.request, this.session.previewRequest())) {
        this.applying = true;
        try { await this.session.setPreview(r.request); } finally { this.applying = false; }
      }
      // V1-FRESH: a switch made while the remembered variant was applied wins; no late save over it.
      if (this.switches.switchedSince(note)) { this.paint(); return; }
      if (r.fellBack) await this.save(key, undefined);
      else if (first && !this.store()[key] && r.request) await this.save(key, r.request);
      if (r.fellBack) {
        void vscode.window.showInformationMessage(`DataPass: back to the current architecture — ${r.fellBack}.`);
      }
    }
    this.paint();
  }

  /** Every preview change after the first load is the person's switch: remember it for this project. */
  private async remember(): Promise<void> {
    const key = projectKey(this.session);
    if (!key || this.applying || this.appliedFor !== key || !this.session.project.options) { this.paint(); return; }
    const req = this.session.previewRequest();
    if (!sameRequest(req, this.store()[key])) await this.save(key, req);
    this.paint();
  }

  /** Saves run one after the other; the entry is this window's at once, the global state follows. */
  private saving: Promise<void> = Promise.resolve();
  private readonly switches = new SwitchCounter();
  private save(key: string, req: VariantRequest | undefined): Promise<void> {
    this.own.set(key, withEntry({}, key, req, new Date().toISOString())[key]);
    this.saving = this.saving.catch(() => undefined).then(() => {
      const s = this.store();
      // withEntry with the entry already there: only keeps the store within MAX_REMEMBERED_PROJECTS.
      return this.context.globalState.update(ACTIVE_VARIANT_KEY, withEntry(s, key, s[key], s[key]?.at ?? ""));
    });
    return this.saving;
  }

  private paint(): void {
    const v = currentActiveVariant(this.session);
    if (!v || !this.shows(SURFACE)) { this.item.hide(); return; }
    this.item.text = statusBarText(v);
    this.item.tooltip = `Selected variant (a preview on this machine): ${v.title}${v.state ? `\nFiles: ${CODING_LABELS[v.state]}${v.reason ? ` — ${v.reason}` : ""} (${CODING_NOTE})` : ""}\nThe tree, Details, the diagram and Copy Context for My AI follow it. Click to switch.\nNot a decision (Record decision in Options commits one) and not a deployment: DataPass does not see or change the live route.`;
    this.item.show();
  }

  /** The switch itself: the session's preview, remembered for this project. */
  async activate(req: VariantRequest | undefined): Promise<void> {
    const r = resolveActiveVariant(this.session.project.options, req);
    if (r.fellBack) throw new UserFacingError(`DataPass cannot switch: ${r.fellBack}.`);
    this.switches.bump();
    // V1-STAB: the switch saves its own entry; the preview event it fires must not save a second,
    // older one after it (the test "back to current forgets the entry" was flaky on Windows).
    this.applying = true;
    try { await this.session.setPreview(r.request); } finally { this.applying = false; }
    const key = projectKey(this.session);
    if (key) { this.appliedFor = key; await this.save(key, r.request); }
    this.paint();
  }

  statusText(): string { return this.item.text; }
  statusVisible(): boolean { return !!currentActiveVariant(this.session) && this.shows(SURFACE); }
  remembered(): VariantRequest | undefined { const k = projectKey(this.session); return k ? this.store()[k] : undefined; }
}

export function registerActiveVariantCommands(context: vscode.ExtensionContext, service: ActiveVariantService, session: WorkSession): void {
  context.subscriptions.push(
    service,
    vscode.commands.registerCommand("datapass.switchVariant", guarded(async () => {
      const options = session.project.options;
      if (!options) throw new UserFacingError("This project has no .datapass/options.json: there is no variant to switch to.");
      const choices = variantChoices(options, session.variants(), session.previewRequest());
      const pick = await vscode.window.showQuickPick(choices.map(c => ({ label: `${c.active ? "$(check) " : ""}${c.label}`, description: c.description, detail: c.detail, choice: c })), {
        title: "Selected variant (a preview on this machine)", placeHolder: "The tree, Details, the diagram and the packs for your AI follow it; nothing is written or deployed"
      });
      if (pick) await service.activate(pick.choice.request);
    })),
    vscode.commands.registerCommand("datapass.setSelectedVariant", guarded(async (scenario?: unknown) => {
      if (scenario !== undefined && (typeof scenario !== "string" || !scenario)) throw new UserFacingError("Choose a scenario from options.json.");
      await service.activate(!scenario || scenario === "current" ? undefined : { scenario: scenario as string });
    }))
  );
}
