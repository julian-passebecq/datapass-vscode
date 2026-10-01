// NAVLOC1: the standalone granularity ladder. project → sub-project → artifact (component, then its
// files) → step (Hop understanding steps) → operation (analyzer facts with a source span).
// Node ids reuse existing ids: project id (or coordination key), sub-project ids, component ids,
// `<repoKey>:<repoPath>` for files (the key the project map observes files by), Hop step ids and
// analyzer operation ids under their file. Pure and vscode-free; content comes from the caller.
import { OTHER_SUBPROJECT, type ComponentView, type ProjectMap } from "../project/projectMap";
import type { UnderstandingStep } from "../understanding/contract";
import { stepForLine, stepsInLineOrder } from "../understanding/lines";
import { classifyArtifactKind, type ArtifactKindHints } from "./artifactKind";
import type { ArtifactKind, NavLadder, NavLevel, NavLocation } from "./navTypes";

/** An analyzer operation (fact) placed in a file; `lines` is 1-based inclusive when the span is known. */
export interface LadderOperation { readonly id: string; readonly label?: string; readonly lines?: readonly [number, number] }

export interface LadderInput {
  readonly map: ProjectMap;
  /** Decoded file head for kind classification; undefined = not read (kind stays "other" where content decides). */
  readonly head?: (repoKey: string, repoPath: string) => string | undefined;
  /** Hop steps of a file (validated understanding doc), when one exists. */
  readonly steps?: (repoKey: string, repoPath: string) => readonly Pick<UnderstandingStep, "id" | "title" | "lines">[] | undefined;
  /** Analyzer operations of a file, when analyzed. */
  readonly operations?: (repoKey: string, repoPath: string) => readonly LadderOperation[] | undefined;
  readonly kindHints?: (repoKey: string) => ArtifactKindHints | undefined;
}

/** What a location points at, for hosts that open code or bind views. */
export interface LadderEntry {
  readonly location: NavLocation;
  readonly label: string;
  readonly componentId?: string;
  readonly subprojectId?: string;
  readonly file?: { readonly repoKey: string; readonly repoPath: string };
  readonly lines?: readonly [number, number];
}

export interface ProjectLadder extends NavLadder {
  entry(l: NavLocation): LadderEntry | undefined;
  /** The finest location for a file position: operation, else step, else the file itself. */
  locate(repoKey: string, repoPath: string, line?: number): NavLocation | undefined;
}

interface Node { entry: LadderEntry; parent: NavLocation | null; children?: NavLocation[] }

const key = (level: NavLevel, nodeId: string) => `${level}\u0000${nodeId}`;
export const fileNodeId = (repoKey: string, repoPath: string) => `${repoKey}:${repoPath}`;
export const stepNodeId = (fileId: string, stepId: string) => `${fileId}#${stepId}`;
export const operationNodeId = (fileId: string, opId: string) => `${fileId}#op:${opId}`;

export function buildLadder(input: LadderInput): ProjectLadder {
  const { map } = input;
  const nodes = new Map<string, Node>();
  const fileKinds = new Map<string, ArtifactKind>();
  const add = (location: NavLocation, label: string, parent: NavLocation | null, extra: Partial<LadderEntry> = {}) => {
    const k = key(location.level, location.nodeId);
    if (!nodes.has(k)) nodes.set(k, { entry: { location, label, ...extra }, parent, children: [] });
    if (parent) nodes.get(key(parent.level, parent.nodeId))?.children?.push(location);
    return location;
  };

  const root = add({ level: "project", nodeId: map.project?.id ?? map.coordinationKey, artifactKind: "project" }, map.project?.title ?? map.coordinationKey, null);
  const byId = new Map(map.components.map((c) => [c.id, c]));

  const fileKind = (repoKey: string, repoPath: string): ArtifactKind => {
    const id = fileNodeId(repoKey, repoPath);
    let kind = fileKinds.get(id);
    if (!kind) fileKinds.set(id, (kind = classifyArtifactKind(repoPath, input.head?.(repoKey, repoPath), input.kindHints?.(repoKey) ?? {})));
    return kind;
  };
  const filesOf = (c: ComponentView) => {
    const a = c.artifacts;
    if (!a) return [];
    const seen = new Set<string>();
    return [a.entry, ...a.files].filter((f) => f && f.kind === "file" && !seen.has(f.repoPath) && seen.add(f.repoPath)).map((f) => ({ repoKey: a.repoKey, repoPath: f!.repoPath }));
  };
  /** A component's kind: its entry file's, else the one kind all its files share, else "other". */
  const componentKind = (c: ComponentView): string => {
    const a = c.artifacts;
    if (a?.entry?.kind === "file") return fileKind(a.repoKey, a.entry.repoPath);
    const kinds = new Set(filesOf(c).map((f) => fileKind(f.repoKey, f.repoPath)));
    return kinds.size === 1 ? [...kinds][0]! : "other";
  };

  const addComponent = (c: ComponentView, parent: NavLocation, subprojectId: string, stack: Set<string>) => {
    if (stack.has(c.id) || nodes.has(key("artifact", c.id))) return;
    const loc = add({ level: "artifact", nodeId: c.id, artifactKind: componentKind(c) }, c.label, parent, { componentId: c.id, subprojectId });
    stack.add(c.id);
    for (const childId of c.children) { const child = byId.get(childId); if (child) addComponent(child, loc, subprojectId, stack); }
    stack.delete(c.id);
    for (const f of filesOf(c)) {
      const id = fileNodeId(f.repoKey, f.repoPath);
      if (nodes.has(key("artifact", id))) continue; // a file shared by two components stays under the first
      add({ level: "artifact", nodeId: id, artifactKind: fileKind(f.repoKey, f.repoPath) }, f.repoPath.split("/").pop() ?? f.repoPath, loc,
        { componentId: c.id, subprojectId, file: f });
    }
  };

  const subprojects = [...map.subprojects];
  const placed = new Set(subprojects.flatMap((s) => s.componentIds));
  const orphans = map.components.filter((c) => !placed.has(c.id)).map((c) => c.id);
  if (orphans.length && !subprojects.some((s) => s.id === OTHER_SUBPROJECT)) {
    subprojects.push({ id: OTHER_SUBPROJECT, title: OTHER_SUBPROJECT, implicit: true, componentIds: orphans } as (typeof subprojects)[number]);
  }
  for (const s of subprojects) {
    const sLoc = add({ level: "subproject", nodeId: s.id, artifactKind: "subproject" }, s.title, root, { subprojectId: s.id });
    const inHere = new Set(s.componentIds);
    for (const id of s.componentIds) {
      const c = byId.get(id);
      if (c && !(c.parent && inHere.has(c.parent))) addComponent(c, sLoc, s.id, new Set());
    }
  }

  /** Steps and operations of a file, built on first use. */
  const expandFile = (fileLoc: NavLocation, node: Node) => {
    const f = node.entry.file!;
    const fileId = fileLoc.nodeId;
    const kind = fileLoc.artifactKind;
    const steps = input.steps?.(f.repoKey, f.repoPath) ?? [];
    const doc = { steps: steps as UnderstandingStep[] };
    const base = { componentId: node.entry.componentId, subprojectId: node.entry.subprojectId, file: f };
    const stepLocs = new Map<string, NavLocation>();
    for (const s of stepsInLineOrder(doc)) {
      stepLocs.set(s.id, add({ level: "step", nodeId: stepNodeId(fileId, s.id), artifactKind: kind }, s.title, fileLoc, { ...base, lines: [s.lines[0], s.lines[1]] }));
    }
    for (const op of input.operations?.(f.repoKey, f.repoPath) ?? []) {
      const step = op.lines ? stepForLine(doc, op.lines[0]) : undefined;
      const parent = (step && stepLocs.get(step.id)) ?? fileLoc;
      add({ level: "operation", nodeId: operationNodeId(fileId, op.id), artifactKind: kind }, op.label ?? op.id, parent, { ...base, lines: op.lines });
    }
    for (const s of stepLocs.values()) {
      const n = nodes.get(key("step", s.nodeId))!;
      n.children!.sort((a, b) => (nodes.get(key(a.level, a.nodeId))!.entry.lines?.[0] ?? 0) - (nodes.get(key(b.level, b.nodeId))!.entry.lines?.[0] ?? 0));
    }
  };
  const expanded = new Set<string>();
  const nodeOf = (l: NavLocation): Node | undefined => {
    const n = nodes.get(key(l.level, l.nodeId));
    if (n?.entry.file && n.entry.location.level === "artifact" && !expanded.has(l.nodeId)) { expanded.add(l.nodeId); expandFile(n.entry.location, n); }
    if (!n && (l.level === "step" || l.level === "operation")) {
      // Lazily expand the owning file, then look again.
      const fileId = l.nodeId.slice(0, l.nodeId.indexOf("#"));
      const file = nodes.get(key("artifact", fileId));
      if (file && !expanded.has(fileId)) { expanded.add(fileId); expandFile(file.entry.location, file); return nodes.get(key(l.level, l.nodeId)); }
    }
    return n;
  };

  return {
    root: () => root,
    parent: (l) => nodeOf(l)?.parent ?? null,
    children: (l) => nodeOf(l)?.children ?? [],
    entry: (l) => nodeOf(l)?.entry,
    locate(repoKey, repoPath, line) {
      const fileLoc = nodeOf({ level: "artifact", nodeId: fileNodeId(repoKey, repoPath), artifactKind: "other" })?.entry.location;
      if (!fileLoc || line === undefined) return fileLoc;
      let best: LadderEntry | undefined;
      const visit = (l: NavLocation) => {
        for (const c of nodeOf(l)?.children ?? []) {
          const e = nodeOf(c)!.entry;
          if (e.lines && e.lines[0] <= line && line <= e.lines[1]) {
            if (!best || e.lines[1] - e.lines[0] < best.lines![1] - best.lines![0] || (e.location.level === "operation" && best.location.level === "step")) best = e;
            visit(c);
          }
        }
      };
      visit(fileLoc);
      return best?.location ?? fileLoc;
    }
  };
}
