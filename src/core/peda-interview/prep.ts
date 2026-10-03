/**
 * V5 PEDA2: the interview prep of a project in one pure call — ranked notions (rank.ts), their prep (questions,
 * where, why / alternative), the project brief (projectTopics.ts) and the three built-in tours (builtinTours.ts).
 * The host gathers the inputs (project map, PEDA1b facts, decision records, PEDA3 top queries) and draws the result.
 * Pure (no `vscode`).
 */
import type { NavLocation } from "../navigation/navTypes";
import type { ProjectMap } from "../project/projectMap";
import { bindConcept, bindDecision, type CodeSpan } from "../peda-cards/bind";
import { builtinTours } from "./builtinTours";
import { briefFromMap, type ProjectBrief } from "./projectTopics";
import { clampMaxNotions, prepNotion, rankNotions, type NotionPrep, type RankInputs, type RankedNotion, type Said } from "./rank";
import { spineStops, type SpineNode } from "./spine";
import type { TourDocument } from "./tourShape";

export interface InterviewSettings {
  readonly maxNotions?: number;
  /** `datapass.pedagogy.askYourself.enabled`: off = the interview tour excludes the `ask-yourself` section. */
  readonly askYourself?: boolean;
  readonly learning?: boolean;
  readonly interview?: boolean;
}

export interface InterviewInputs extends RankInputs {
  readonly map?: ProjectMap;
  readonly root: NavLocation;
  readonly spineNodes: readonly SpineNode[];
  readonly queries?: readonly { readonly title: string; readonly location: NavLocation }[];
  readonly volumetry?: readonly Said[];
  readonly locate: (span: CodeSpan) => NavLocation | null;
  readonly viewAt: (location: NavLocation) => string;
  readonly settings?: InterviewSettings;
}

export interface InterviewPrep {
  readonly notions: readonly RankedNotion[];
  readonly preps: readonly NotionPrep[];
  readonly brief: ProjectBrief;
  readonly tours: TourDocument;
}

export function interviewPrep(i: InterviewInputs): InterviewPrep {
  const s = i.settings ?? {};
  const notions = rankNotions(i, clampMaxNotions(s.maxNotions));
  const spine = spineStops(i.spineNodes, i.root);
  const queries = i.queries ?? [];
  const brief = briefFromMap(i.map, { rationales: i.rationales, volumetry: i.volumetry, spine, queries: queries.map(q => q.title) });
  const spanOf = (ref: string): CodeSpan | null => {
    const m = /^(concept|decision):(\S+)$/.exec(ref);
    const entry = m && i.entries.find(e => e.id === m[2]);
    if (!m || !entry) return null;
    if (m[1] === "concept") { const b = bindConcept(entry, i.facts); return b.excerpt.source === "project" ? b.excerpt.at : null; }
    return bindDecision(entry, i.facts, i.rationales, i.repositoryKey).taken[0]?.at ?? null;
  };
  const doc = builtinTours({ root: i.root, spine, entries: i.entries, spanOf, notions, queries: queries.map(q => q.location), locate: i.locate, viewAt: i.viewAt },
    { learning: s.learning, interview: s.interview });
  const tours: TourDocument = s.askYourself === false
    ? { ...doc, tours: doc.tours.map(t => t.mode === "interview" ? { ...t, generation: { exclude: ["ask-yourself"] } } : t) }
    : doc;
  return { notions, preps: notions.map(prepNotion), brief, tours };
}
