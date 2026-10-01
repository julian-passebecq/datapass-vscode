/**
 * NAVSVC1 minimal ladder over the project map: project → sub-project → component, so the
 * NavigationService works on its own. NAVLOC1 replaces it (`nav.setLadder`) with the full
 * granularity resolver (steps, operations, artifact kinds). Pure (no `vscode`).
 */
import type { ProjectMap } from "../project/projectMap";
import type { NavLadder, NavLocation } from "./navTypes";

/** Node id of the project root when the manifest has no project id. */
export const PROJECT_NODE = "project";

export function projectLocation(map: ProjectMap): NavLocation {
  return { level: "project", nodeId: map.project?.id ?? PROJECT_NODE, artifactKind: "project" };
}
export const subprojectLocation = (id: string): NavLocation => ({ level: "subproject", nodeId: id, artifactKind: "subproject" });
/** Components are artifacts; their precise kind comes with NAVLOC1. */
export const componentLocation = (id: string): NavLocation => ({ level: "artifact", nodeId: id, artifactKind: "other" });

export function projectLadder(map: () => ProjectMap): NavLadder {
  return {
    root: () => projectLocation(map()),
    parent(l) {
      const m = map();
      if (l.level === "subproject") return m.subprojects.some((s) => s.id === l.nodeId) ? projectLocation(m) : null;
      if (l.level === "artifact") {
        const sp = m.subprojects.find((s) => s.componentIds.includes(l.nodeId));
        return sp ? subprojectLocation(sp.id) : null;
      }
      return null;
    },
    children(l) {
      const m = map();
      if (l.level === "project") return m.subprojects.map((s) => subprojectLocation(s.id));
      if (l.level === "subproject") return (m.subprojects.find((s) => s.id === l.nodeId)?.componentIds ?? []).map(componentLocation);
      return [];
    }
  };
}

/** Display label of a location (title from the project files, else its id). */
export function locationLabel(map: ProjectMap, l: NavLocation): string {
  if (l.level === "project") return map.project?.title ?? l.nodeId;
  if (l.level === "subproject") return map.subprojects.find((s) => s.id === l.nodeId)?.title ?? l.nodeId;
  return map.components.find((c) => c.id === l.nodeId)?.label ?? l.nodeId;
}

/** The ladder path root → location (the address bar / breadcrumb). */
export function locationPath(ladder: NavLadder, l: NavLocation): NavLocation[] {
  const path = [l];
  for (let p = ladder.parent(l); p && path.length < 16; p = ladder.parent(p)) path.unshift(p);
  return path;
}

/** Session selection ↔ location. */
export function selectionOf(l: NavLocation, ladder: NavLadder): { subproject?: string; component?: string } {
  if (l.level === "subproject") return { subproject: l.nodeId };
  if (l.level === "artifact") {
    const sp = ladder.parent(l);
    return { subproject: sp?.level === "subproject" ? sp.nodeId : undefined, component: l.nodeId };
  }
  return {};
}
export function locationOf(sel: { subproject?: string; component?: string }, map: ProjectMap): NavLocation {
  if (sel.component && map.components.some((c) => c.id === sel.component)) return componentLocation(sel.component);
  if (sel.subproject && map.subprojects.some((s) => s.id === sel.subproject)) return subprojectLocation(sel.subproject);
  return projectLocation(map);
}
