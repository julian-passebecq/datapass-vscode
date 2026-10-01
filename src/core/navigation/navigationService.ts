/**
 * V4-NAV NAVSVC1: the one NavigationService. The Navigator, the view host, the Context panel, the
 * tree and the address bar read `state` and move with `dispatch`; none keeps its own position.
 * The ladder (where up/down lead) and the catalog (which views a location offers) are supplied by
 * the host and can be replaced (NAVLOC1 ladder, NAVCAT1 overrides, view packs). Pure (no `vscode`).
 */
import {
  DEFAULT_VIEW_CATALOG, initialNavState, reduceNav, resolveViews, sameLocation,
  type NavCommand, type NavLadder, type NavLocation, type NavState, type ViewCatalog, type ViewDef, type ViewOverrides
} from "./navTypes";

export type Listener<T> = (e: T) => void;
/** VS Code-shaped event without the `vscode` module, so the service runs under plain node tests. */
export type NavEvent<T> = (listener: Listener<T>) => { dispose(): void };

export interface NavChange { readonly state: NavState; readonly previous: NavState; readonly command: NavCommand | null }

export class NavigationService {
  private current: NavState;
  private overrides: ViewOverrides | null = null;
  private readonly listeners = new Set<Listener<NavChange>>();

  constructor(private ladderImpl: NavLadder, private catalogImpl: ViewCatalog = DEFAULT_VIEW_CATALOG) {
    this.current = initialNavState(ladderImpl, (l) => this.viewsAt(l));
  }

  readonly onDidChange: NavEvent<NavChange> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };

  get state(): NavState { return this.current; }
  get catalog(): ViewCatalog { return this.catalogImpl; }
  get ladder(): NavLadder { return this.ladderImpl; }

  /** The views the current location offers, in display order. */
  views(): readonly ViewDef[] { return this.viewsAt(this.current.location); }
  viewsAt(l: NavLocation): readonly ViewDef[] { return resolveViews(this.catalogImpl, this.overrides, l.artifactKind, l.level); }

  canUp(): boolean { return this.ladderImpl.parent(this.current.location) !== null; }
  canDown(): boolean { return this.ladderImpl.children(this.current.location).length > 0; }

  /** Apply one command; listeners hear only real changes. Returns the (possibly unchanged) state. */
  dispatch(command: NavCommand): NavState {
    return this.commit(reduceNav(this.current, command, this.ladderImpl, (l) => this.viewsAt(l)), command);
  }

  /** A new ladder (project reloaded, NAVLOC1): keep the location when it still exists, else go home. */
  setLadder(ladder: NavLadder): void {
    this.ladderImpl = ladder;
    this.revalidate();
  }

  /** A new catalog or user overrides: the view id is kept when still offered, else the first view. */
  setCatalog(catalog: ViewCatalog, overrides: ViewOverrides | null = this.overrides): void {
    this.catalogImpl = catalog;
    this.overrides = overrides;
    this.revalidate();
  }

  dispose(): void { this.listeners.clear(); }

  private revalidate(): void {
    const s = this.current;
    const exists = this.reachable(s.location);
    const location = exists ? s.location : this.ladderImpl.root();
    const offered = this.viewsAt(location);
    const viewId = s.viewId !== null && offered.some((v) => v.id === s.viewId) ? s.viewId : offered[0]?.id ?? null;
    const keep = (list: readonly NavLocation[]) => list.filter((l) => this.reachable(l));
    this.commit({ location, viewId, back: keep(s.back), forward: keep(s.forward) }, null);
  }

  /** On the ladder: the root, or a location whose parent chain reaches the root and lists it as a child. */
  private reachable(l: NavLocation): boolean {
    const root = this.ladderImpl.root();
    let cur: NavLocation = l;
    for (let depth = 0; depth < 16; depth++) {
      if (sameLocation(cur, root)) return true;
      const parent = this.ladderImpl.parent(cur);
      if (!parent || !this.ladderImpl.children(parent).some((c) => sameLocation(c, cur))) return false;
      cur = parent;
    }
    return false;
  }

  private commit(next: NavState, command: NavCommand | null): NavState {
    const previous = this.current;
    if (next === previous || equalState(next, previous)) return previous;
    this.current = next;
    for (const l of [...this.listeners]) l({ state: next, previous, command });
    return next;
  }
}

function equalState(a: NavState, b: NavState): boolean {
  const same = (x: readonly NavLocation[], y: readonly NavLocation[]) => x.length === y.length && x.every((l, i) => sameLocation(l, y[i]!));
  return sameLocation(a.location, b.location) && a.viewId === b.viewId && same(a.back, b.back) && same(a.forward, b.forward);
}
