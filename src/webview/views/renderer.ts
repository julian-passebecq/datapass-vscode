/**
 * V4-NAV one view renderer: views are data (ViewDef from the catalog), and one renderer draws every layout kind
 * through a registry, so a new view is JSON and a new kind is one `layouts/<kind>.layout.ts` file (collected
 * by scripts/gen-registry.mjs into out/gen/layouts.ts: no line to add here). The shell (location,
 * view switcher) and each layout build a pure node tree (`model.ts`); `toDom` turns it into elements.
 * Host messages are untrusted and validated (`parseHostMessage`); the webview only posts nav commands,
 * a selection or an "open surface" request — it never runs project code.
 */
import type { LayoutKind, NavCommand, NavState, ViewDef } from "../../core/navigation/navTypes";
import { label, parseHostMessage, type BindingData, type Labels, type LayoutModel, type VNode } from "./model";
import { LAYOUTS } from "../../../out/gen/layouts";
import { navCommandForKey } from "../navKeys";

const registry = new Map<string, LayoutModel>();
export function registerLayout(kind: LayoutKind, draw: LayoutModel): void { registry.set(kind, draw); }
export function registeredLayouts(): string[] { return [...registry.keys()]; }
for (const l of LAYOUTS) registerLayout(l.kind, l.model);

export interface ViewScreen { readonly state: NavState; readonly views: readonly ViewDef[]; readonly labels: Labels; readonly data: readonly BindingData[] | null }

/** The whole screen as a node tree: header (location + view switcher), then the current view's layout. */
export function screenModel(s: ViewScreen): VNode {
  const { state, views, labels } = s;
  const view = views.find(v => v.id === state.viewId) ?? views[0];
  const loc = state.location;
  const header: VNode = { tag: "header", cls: "nv-header", children: [
    { tag: "div", cls: "nv-location", children: [
      { tag: "span", cls: "nv-level", text: label(labels, `level.${loc.level}`) },
      { tag: "span", cls: "nv-node", text: loc.nodeId },
      { tag: "span", cls: "nv-kind", text: label(labels, `kind.${loc.artifactKind}`) }] },
    { tag: "div", cls: "nv-views", attrs: { role: "tablist", "aria-label": label(labels, "view.switcher") },
      children: views.map(v => ({ tag: "button", cls: v === view ? "nv-tab nv-active" : "nv-tab", text: v.title,
        attrs: { type: "button", role: "tab", "aria-selected": String(v === view), "data-view-id": v.id, ...(v.description ? { title: v.description } : {}) } })) }] };
  return { tag: "div", cls: "nv-screen", children: [header, { tag: "main", cls: "nv-main", children: [bodyModel(view, s)] }] };
}

function bodyModel(view: ViewDef | undefined, s: ViewScreen): VNode {
  const { labels } = s;
  if (!view) return { tag: "p", cls: "nv-empty", text: label(labels, "view.none") };
  const draw = registry.get(view.layout);
  if (!draw) return { tag: "div", cls: "nv-hole", attrs: { role: "note", "data-hole-kind": "layout-unregistered" }, children: [
    { tag: "span", cls: "nv-hole-kind", text: label(labels, "hole.layout-unregistered") }, { tag: "code", text: view.layout }] };
  if (s.data === null && view.layout !== "surface") return { tag: "p", cls: "nv-loading", attrs: { "aria-busy": "true" }, text: label(labels, "view.loading") };
  return draw({ view, data: s.data ?? [], labels, location: s.state.location });
}

export const SVG_NS = "http://www.w3.org/2000/svg";

/** Node tree → DOM. Text goes through textContent only (no innerHTML). An `svg` node and all its children are created in the SVG namespace. */
export function toDom(n: VNode, doc: Document, act: (on: NonNullable<VNode["on"]>) => void, inSvg = false): HTMLElement {
  const svg = inSvg || n.tag === "svg";
  const el = (svg ? doc.createElementNS(SVG_NS, n.tag) : doc.createElement(n.tag)) as HTMLElement;
  if (n.cls) el.setAttribute("class", n.cls);
  if (n.text !== undefined) el.textContent = n.text;
  for (const [k, v] of Object.entries(n.attrs ?? {})) el.setAttribute(k, v);
  for (const c of n.children ?? []) el.appendChild(toDom(c, doc, act, svg));
  if (n.on) {
    const on = n.on;
    el.addEventListener("click", () => act(on));
    el.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === el && n.tag !== "button") { e.preventDefault(); act(on); } });
  }
  return el;
}

/** `data-nav-dblclick` value → nav "down" command: a non-empty value names the child to enter. */
export function navDownCommand(childId: string | null): NavCommand {
  return childId ? { type: "down", childId } : { type: "down" };
}

export type WebviewOut = { type: "nav"; command: NavCommand } | { type: "select"; nodeId: string } | { type: "open-surface"; surface: string; viewId: string } | { type: "ready" };

/** Mounts the renderer in a nav webview: listens to the host, redraws, posts commands back. */
export function mountNavView(root: HTMLElement, post: (m: WebviewOut) => void, win: Window = window): void {
  let screen: ViewScreen | null = null;
  const doc = root.ownerDocument;
  const draw = (): void => {
    if (!screen) return;
    const s = screen;
    const viewId = (s.views.find(v => v.id === s.state.viewId) ?? s.views[0])?.id ?? "";
    root.replaceChildren(toDom(screenModel(s), doc, on => post(on.action === "select" ? { type: "select", nodeId: on.nodeId } : { type: "open-surface", surface: on.surface, viewId })));
  };
  win.addEventListener("message", (event: MessageEvent) => {
    const msg = parseHostMessage(event.data);
    if (!msg) return;
    if (msg.type === "nav-state") {
      const sameView = screen && screen.state.viewId === msg.state.viewId && screen.state.location.nodeId === msg.state.location.nodeId;
      screen = { state: msg.state, views: msg.views, labels: msg.labels, data: sameView ? screen!.data : null };
    } else if (screen && msg.viewId === (screen.state.viewId ?? screen.views[0]?.id)) {
      screen = { ...screen, data: msg.data };
    } else return;
    draw();
  });
  root.addEventListener("click", e => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-view-id]");
    if (tab?.dataset.viewId) post({ type: "nav", command: { type: "view", viewId: tab.dataset.viewId } });
  });
  // Double-click on any element marked `data-nav-dblclick` goes down a level (the value, if any, is the child id).
  root.addEventListener("dblclick", e => {
    const hit = (e.target as Element).closest?.("[data-nav-dblclick]");
    if (!hit) return;
    post({ type: "nav", command: navDownCommand(hit.getAttribute("data-nav-dblclick")) });
  });
  root.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    const group = t.closest(".nv-views") ? ".nv-tab" : t.matches(".nv-selectable, .nv-card[tabindex]") ? ".nv-selectable, .nv-card[tabindex]" : null;
    const next = !group || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ? 0
      : t.closest(".nv-views") ? (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) : (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0);
    if (!group || !next) {
      // NAVKEYS1 plain keys (NAVFIX1, review M5): what focus movement does not use navigates; Alt+Left/Right stay VS Code's Back/Forward.
      const cmd = navCommandForKey(e, t.closest?.("[data-nav-dblclick]")?.getAttribute("data-nav-dblclick") || undefined);
      if (cmd) { e.preventDefault(); post({ type: "nav", command: cmd }); }
      return;
    }
    const items = Array.from(root.querySelectorAll<HTMLElement>(group));
    const i = items.indexOf(t);
    items[(i + next + items.length) % items.length]?.focus();
    e.preventDefault();
  });
  post({ type: "ready" });
}
