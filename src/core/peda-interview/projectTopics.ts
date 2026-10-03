/**
 * V5 PEDA2 (Julian addendum 3, go/TOUR-PEDA-contract.md § 3): the `project:<topic>` explanation refs — `explain`,
 * `objectives`, `volumetry` (VOL1), `platforms`, `whole-picture.<stepId>`, `queries-worth-showing` — resolved from
 * project facts only. Unknown → a typed hole ("explanation not found" / "not known yet"), never invented text.
 * Words around the facts are label keys (`interview.*`), overridable by the host labels. Pure (no `vscode`).
 */
import type { Hole } from "../../webview/views/model";
import type { ProjectMap } from "../project/projectMap";
import type { DecisionRationale } from "@juliandatapass-group/decision-rationale";
import type { Said } from "./rank";
import { WHOLE_PICTURE_STEP_IDS, type SpineStop } from "./spine";

export const PROJECT_TOPICS = ["explain", "objectives", "volumetry", "platforms", "whole-picture", "queries-worth-showing"] as const;

/** What the project's files and facts say about it (each item keeps its origin). */
export interface ProjectBrief {
  readonly title: string | null;
  readonly description: Said | null;
  readonly objectives: readonly Said[];
  /** VOL1 volumetry facts (rows/day, sizes, frequencies); empty = unknown. */
  readonly volumetry: readonly Said[];
  readonly platforms: readonly Said[];
  readonly spine: readonly SpineStop[];
  /** Titles of the top "queries worth showing" (PEDA3), best first. */
  readonly queries: readonly string[];
}

/** The brief from the project map (manifest), decision records and the facts the host has. */
export function briefFromMap(map: ProjectMap | undefined, extra: {
  readonly rationales?: readonly DecisionRationale[]; readonly volumetry?: readonly Said[];
  readonly spine: readonly SpineStop[]; readonly queries?: readonly string[];
}): ProjectBrief {
  const objectives: Said[] = [];
  for (const s of map?.subprojects ?? []) if (s.objective) objectives.push({ text: `${s.title}: ${s.objective}`, origin: "declared" });
  const seen = new Set<string>();
  for (const r of extra.rationales ?? []) if (r.problemSolved && !seen.has(r.problemSolved)) { seen.add(r.problemSolved); objectives.push({ text: r.problemSolved, origin: r.origin }); }
  const platforms = [...new Set((map?.components ?? []).map(c => c.provider?.label ?? c.providerId).filter((p): p is string => !!p))].sort()
    .map(text => ({ text, origin: "declared" }));
  return {
    title: map?.project?.title ?? null,
    description: map?.project?.description ? { text: map.project.description, origin: "declared" } : null,
    objectives, volumetry: extra.volumetry ?? [], platforms, spine: extra.spine, queries: extra.queries ?? []
  };
}

export type TopicText = { readonly lines: readonly Said[]; readonly holes: readonly Hole[] };

const hole = (topic: string, kind: string, reason: string): TopicText => ({ lines: [], holes: [{ kind, field: `project:${topic}`, reason }] });

/** Resolve `project:<topic>`; undefined = not a project ref (another scheme owns it). */
export function resolveProjectRef(ref: string, brief: ProjectBrief): TopicText | undefined {
  const m = /^project:(\S+)$/.exec(ref);
  if (!m) return undefined;
  const topic = m[1]!;
  switch (topic) {
    case "explain": {
      const lines: Said[] = [
        ...(brief.title ? [{ text: brief.title, origin: "declared" }] : []),
        ...(brief.description ? [brief.description] : []),
        ...brief.objectives.slice(0, 3), ...brief.platforms.length ? [{ text: brief.platforms.map(p => p.text).join(", "), origin: "declared" }] : []
      ];
      const holes: Hole[] = [];
      if (!brief.description && !brief.objectives.length) holes.push({ kind: "missing-objectives", field: "project:explain", reason: "The manifest and decision records say nothing about the project's purpose yet (ask the owner)." });
      if (!brief.volumetry.length) holes.push({ kind: "missing-volumetry", field: "project:volumetry", reason: "No volumetry fact (VOL1) yet: data sizes and frequencies are unknown." });
      return { lines, holes };
    }
    case "objectives": return brief.objectives.length ? { lines: brief.objectives, holes: [] } : hole(topic, "missing-objectives", "No objective in the manifest or decision records (ask the owner).");
    case "volumetry": return brief.volumetry.length ? { lines: brief.volumetry, holes: [] } : hole(topic, "missing-volumetry", "No volumetry fact (VOL1) yet: data sizes and frequencies are unknown.");
    case "platforms": return brief.platforms.length ? { lines: brief.platforms, holes: [] } : hole(topic, "missing-platforms", "No component declares its platform yet.");
    case "queries-worth-showing": return brief.queries.length ? { lines: brief.queries.map(text => ({ text, origin: "static" })), holes: [] }
      : hole(topic, "missing-facts", "No SQL / Spark SQL / PySpark query facts for this project yet.");
    default: {
      const w = /^whole-picture\.([a-z]+)$/.exec(topic);
      const step = w && (WHOLE_PICTURE_STEP_IDS as readonly string[]).includes(w[1]!) ? brief.spine.find(s => s.step === w[1]) : undefined;
      if (!step) return hole(topic, "explanation-not-found", `Unknown project topic "${topic}".`);
      return step.hole ? hole(topic, "missing-spine-node", `No project node answers "${step.step}" yet: the project root is shown.`)
        : { lines: [{ text: step.label ?? step.location.nodeId, origin: "static" }], holes: [] };
    }
  }
}
