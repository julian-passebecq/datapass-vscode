/**
 * V4-NAVCODE1: the VS Code side of the code link (pure logic in codeLink.ts).
 *
 * A location change opens the span's file beside the view (preview, preserveFocus), reveals and
 * decorates it with Hop's look in the location's colour (navPalette, passed in); no span = a status
 * message with the typed hole reason. A cursor move made by the person (keyboard or mouse, never our
 * own reveal) goes, debounced, to the innermost step/operation holding it. Focus is never stolen.
 * Settings: datapass.nav.codeLink.{enabled,followCursor,debounceMs,holeLabels}.
 */
import * as vscode from "vscode";
import { clampSpan, holeMessage, innermostAt, isHole, resolveSpan, type CodeSpanProvider, type SourceSpan } from "./codeLink";
import type { NavigationService } from "./navigationService";
import { sameLocation, type NavLocation } from "./navTypes";

/** The part of NAVSVC1's NavigationService the code link uses. */
export type NavigationServiceLike = Pick<NavigationService, "state" | "onDidChange" | "dispatch">;

const SECTION = "datapass.nav.codeLink";
const DEFAULT_COLOR = "editor.rangeHighlightBackground";
/** Editor events within this window after our own reveal are ignored (no ping-pong). */
const ECHO_MS = 400;

export interface CodeLinkOptions {
  readonly providers: () => readonly CodeSpanProvider[];
  /** navPalette (NAVMAP1): a theme colour id or a CSS colour for a node; undefined = Hop's default. */
  readonly colorFor?: (nodeId: string) => string | undefined;
  /** The column of the DataPass view the code opens beside; default ViewColumn.Beside. */
  readonly viewColumn?: () => vscode.ViewColumn | undefined;
}

export class CodeLink implements vscode.Disposable {
  private readonly subs: vscode.Disposable[] = [];
  private readonly decorations = new Map<string, vscode.TextEditorDecorationType>();
  private shown: { location: NavLocation; span: SourceSpan } | undefined;
  private echoUntil = 0;
  private followTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly nav: NavigationServiceLike, private readonly opts: CodeLinkOptions) {
    this.subs.push(
      nav.onDidChange(({ state: s }) => { if (!this.shown || !sameLocation(s.location, this.shown.location)) void this.show(s.location); }),
      vscode.window.onDidChangeTextEditorSelection(e => this.onSelection(e)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate())
    );
  }

  private config(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration(SECTION); }

  /** Show a location's code, or say why there is none. */
  async show(location: NavLocation): Promise<void> {
    if (!this.config().get<boolean>("enabled", true)) return;
    let r = resolveSpan(this.opts.providers(), location);
    if (isHole(r)) return this.hole(r);
    const uri = vscode.Uri.file(r.file);
    let doc: vscode.TextDocument;
    try { doc = await vscode.workspace.openTextDocument(uri); } catch { return this.hole({ reason: "no-source", detail: r.file }); }
    r = clampSpan(r, doc.lineCount);
    if (isHole(r)) { this.shown = undefined; this.decorate(); return this.hole(r); }
    this.shown = { location, span: r };
    this.echoUntil = Date.now() + ECHO_MS;
    const column = this.opts.viewColumn?.() ?? vscode.ViewColumn.Beside;
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
      ?? await vscode.window.showTextDocument(doc, { viewColumn: column, preview: true, preserveFocus: true });
    this.echoUntil = Date.now() + ECHO_MS;
    editor.revealRange(toRange(r), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.decorate();
  }

  private hole(h: Parameters<typeof holeMessage>[0]): void {
    vscode.window.setStatusBarMessage(holeMessage(h, this.config().get<Record<string, unknown>>("holeLabels")), 5000);
  }

  private decorationFor(color: string): vscode.TextEditorDecorationType {
    let d = this.decorations.get(color);
    if (!d) {
      const c = /^[a-zA-Z][\w-]*(\.[\w-]+)+$/.test(color) ? new vscode.ThemeColor(color) : color;
      d = vscode.window.createTextEditorDecorationType({
        isWholeLine: true, backgroundColor: c,
        overviewRulerColor: color === DEFAULT_COLOR ? new vscode.ThemeColor("editorOverviewRuler.rangeHighlightForeground") : c,
        overviewRulerLane: vscode.OverviewRulerLane.Left
      });
      this.decorations.set(color, d);
    }
    return d;
  }

  private decorate(): void {
    const s = this.shown;
    const color = s ? this.opts.colorFor?.(s.location.nodeId) ?? DEFAULT_COLOR : undefined;
    const active = color ? this.decorationFor(color) : undefined;
    for (const editor of vscode.window.visibleTextEditors) {
      const mine = s && editor.document.uri.fsPath.toLowerCase() === vscode.Uri.file(s.span.file).fsPath.toLowerCase();
      for (const d of this.decorations.values()) editor.setDecorations(d, d === active && mine ? [toRange(s!.span)] : []);
    }
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    if (Date.now() < this.echoUntil) return;
    if (e.kind !== vscode.TextEditorSelectionChangeKind.Keyboard && e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
    const cfg = this.config();
    if (!cfg.get<boolean>("enabled", true) || !cfg.get<boolean>("followCursor", true)) return;
    if (e.textEditor.document.uri.scheme !== "file") return;
    const pos = e.selections[0]?.active;
    if (!pos) return;
    const file = e.textEditor.document.uri.fsPath;
    clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => {
      const location = innermostAt(this.opts.providers(), file, pos.line + 1, pos.character + 1);
      if (!location || sameLocation(location, this.nav.state.location)) return;
      const span = this.opts.providers().flatMap(p => p.locationsIn(file)).find(x => sameLocation(x.location, location))?.span;
      if (span) { this.shown = { location, span }; this.decorate(); }
      this.nav.dispatch({ type: "go", location });
    }, Math.max(0, cfg.get<number>("debounceMs", 250)));
  }

  dispose(): void {
    clearTimeout(this.followTimer);
    for (const d of this.decorations.values()) d.dispose();
    for (const s of this.subs) s.dispose();
  }
}

function toRange(s: SourceSpan): vscode.Range {
  return new vscode.Range(s.startLine - 1, Math.max(0, (s.startColumn ?? 1) - 1), s.endLine - 1, s.endColumn ?? 0);
}

/** The one line register.ts adds: `registerCodeLink(ctx, nav, opts)`. */
export function registerCodeLink(ctx: vscode.ExtensionContext, nav: NavigationServiceLike, opts: CodeLinkOptions): CodeLink {
  const link = new CodeLink(nav, opts);
  ctx.subscriptions.push(link);
  return link;
}
