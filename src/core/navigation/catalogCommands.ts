/**
 * V4-NAV NAVCAT1: the view catalog store in the window (catalogStore.ts holds the rules).
 * Watches `.datapass/views.json` and hands it to the NavigationService (`nav.setCatalog`); the
 * overrides are then read back from `nav.overrides`, no copy is kept here. Commands Customize views,
 * Hide view, Reset views. Writes only that file, and only after the person asked (reset asks for
 * confirmation). No client code runs.
 */
import * as vscode from "vscode";
import { projectRoot } from "../workspace/root";
import type { NavigationService } from "./navigationService";
import { ARTIFACT_KINDS, NAV_LEVELS, resolveViews, type NavLevel, type NavLocation, type ViewCatalog, type ViewDef, type ViewOverrides } from "./navTypes";
import {
  entryKey, hasEntry, hideView, parseViewOverrides, resetViews, serializeOverrides, withEntry,
  VIEW_OVERRIDES_PATH
} from "./catalogStore";

type Spot = Pick<NavLocation, "artifactKind" | "level">;
/** The part of the NavigationService the store needs: its live catalog, the overrides it holds and their one write path. */
export type NavCatalogTarget = Pick<NavigationService, "catalog" | "overrides" | "setCatalog">;

export class ViewCatalogStore implements vscode.Disposable {
  private warned = "";
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subs: vscode.Disposable[] = [this.changed];
  readonly onDidChange = this.changed.event;

  /**
   * The catalog is the NavigationService's live one (built-in + view packs + what other surfaces added), read at
   * each use: the store only swaps the user overrides, so with no `.datapass/views.json` the views are unchanged.
   * `catalog` pins one instead (tests).
   */
  constructor(private readonly nav: NavCatalogTarget, private readonly pinned?: ViewCatalog) {
    const w = vscode.workspace.createFileSystemWatcher(`**/${VIEW_OVERRIDES_PATH}`);
    this.subs.push(w, w.onDidCreate(() => this.reload()), w.onDidChange(() => this.reload()), w.onDidDelete(() => this.reload()));
    void this.reload();
  }

  get catalog(): ViewCatalog { return this.pinned ?? this.nav.catalog; }
  get overrides(): ViewOverrides | null { return this.nav.overrides; }

  /** The views offered at a location (catalog, then the person's overrides: '*' then the kind). */
  views(l: Spot): readonly ViewDef[] { const k = entryKey(l); return resolveViews(this.catalog, this.nav.overrides, k.artifactKind, k.level); }

  file(): vscode.Uri | undefined {
    const root = projectRoot();
    return root && vscode.Uri.joinPath(root, ...VIEW_OVERRIDES_PATH.split("/"));
  }

  async reload(): Promise<void> {
    const uri = this.file();
    let raw: Uint8Array | undefined;
    if (uri) try { raw = await vscode.workspace.fs.readFile(uri); } catch { raw = undefined; }
    const { overrides, warnings } = parseViewOverrides(raw);
    this.nav.setCatalog(this.catalog, overrides);
    const text = warnings.join("\n");
    if (text && text !== this.warned) void vscode.window.showWarningMessage(`DataPass views: ${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}. Using the defaults where needed.`);
    this.warned = text;
    this.changed.fire();
  }

  async write(o: ViewOverrides): Promise<vscode.Uri | undefined> {
    const uri = this.file();
    if (!uri) { void vscode.window.showWarningMessage("DataPass views: open a project folder first."); return undefined; }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeOverrides(o), "utf8"));
    await this.reload();
    return uri;
  }

  dispose(): void { for (const s of this.subs) s.dispose(); }
}

/** The location the commands act on: the navigator's current one, else a quick pick of level and kind. */
async function spot(current: () => Spot | undefined): Promise<Spot | undefined> {
  const c = current();
  if (c) return c;
  const level = await vscode.window.showQuickPick(NAV_LEVELS.map(l => l as string), { placeHolder: "Which level?" }) as NavLevel | undefined;
  if (!level) return undefined;
  const kind = await vscode.window.showQuickPick(["*", ...ARTIFACT_KINDS], { placeHolder: "Which kind of artifact? (* = any)" });
  return kind ? { level, artifactKind: kind } : undefined;
}

/**
 * Registers the store and its commands. `current` gives the navigator's location (NAVSVC1);
 * `currentView` the shown view id, used as the default of Hide view.
 */
export function registerViewCatalog(ctx: vscode.ExtensionContext, nav: NavCatalogTarget, current: () => Spot | undefined = () => undefined,
  currentView: () => string | null | undefined = () => undefined, store = new ViewCatalogStore(nav)): ViewCatalogStore {
  ctx.subscriptions.push(store,
    vscode.commands.registerCommand("datapass.nav.customizeViews", async () => {
      const l = await spot(current);
      if (!l) return;
      const o = store.overrides;
      const next = withEntry(store.catalog, o, l);
      const uri = next.entries.length !== (o?.entries.length ?? 0) || !o ? await store.write(next) : store.file();
      if (uri) await vscode.window.showTextDocument(uri);
    }),
    vscode.commands.registerCommand("datapass.nav.hideView", async (viewId?: unknown) => {
      const l = await spot(current);
      if (!l) return;
      let id = typeof viewId === "string" ? viewId : currentView() ?? undefined;
      if (!id) {
        const pick = await vscode.window.showQuickPick(store.views(l).map(v => ({ label: v.title, description: v.id, id: v.id })), { placeHolder: "Hide which view?" });
        id = pick?.id;
      }
      if (!id || !store.views(l).some(v => v.id === id)) return;
      await store.write(hideView(store.overrides, l, id));
    }),
    vscode.commands.registerCommand("datapass.nav.resetViews", async () => {
      const o = store.overrides;
      if (!o?.entries.length) { void vscode.window.showInformationMessage("DataPass views: nothing to reset, the defaults are in use."); return; }
      const c = current();
      const choices = [...(c && hasEntry(o, c) ? [{ label: "This location", here: true }] : []), { label: "All locations", here: false }];
      const choice = choices.length === 1 ? choices[0] : await vscode.window.showQuickPick(choices, { placeHolder: "Reset the views to the defaults for…" });
      if (!choice) return;
      const what = choice.here ? `the views of ${c!.artifactKind} at ${c!.level}` : "every view customization";
      const ok = await vscode.window.showWarningMessage(`Reset ${what} to the defaults?`, { modal: true }, "Reset");
      if (ok !== "Reset") return;
      await store.write(resetViews(o, choice.here ? c : undefined));
    }));
  return store;
}
