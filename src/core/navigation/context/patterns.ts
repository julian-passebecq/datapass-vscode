import type { NavLocation } from "../navTypes";
import { fillLabel, strongestOrigin, type ContextHole, type NavFact, type SectionResult, type ValueOrigin } from "./facts";
import type { RationaleInput } from "./why";

/**
 * NAVCTX2 patterns: the arch-catalog concept entries (Common packages/arch-catalog `datapass.concept-entry/1`, CONCEPT1) that
 * apply to the location, i.e. which problems the code solves and the options a senior would weigh. Three ways a concept
 * matches, strongest first:
 *   1. `fact`: a fact names the concept (`concept:<id>`), carrying that fact's origin;
 *   2. `detector`: a fact `detector:<id>` is one of the concept's shipped detectors;
 *   3. `artifact-kind`: the concept's domain is relevant to the artifact kind (`DEFAULT_PATTERN_DOMAINS`, data), origin `theoretical`.
 * When a rationale for the location answers the concept's decision point, the card shows the option chosen.
 *
 * `ConceptInput` is the subset of `ConceptEntry` read here, structural until NAVSVC1 vendors the package.
 */
export interface ConceptInput {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly concept: string;
  readonly scale: string;
  readonly decisionPoint: string;
  readonly options: readonly { readonly id: string; readonly title: string; readonly rightWhen: readonly string[]; readonly wrongWhen: readonly string[]; readonly cost: string; readonly risk: string }[];
  readonly detectors: readonly string[];
  readonly signals: readonly string[];
}

export interface PatternDomainRule {
  readonly domain: string;
  /** Artifact kinds the domain applies to; `*` = any. */
  readonly artifactKinds: readonly string[];
  /** Concept scales shown for this rule at each level (macro at project, micro at operation…); absent = all. */
  readonly scales?: readonly string[];
}

export const DEFAULT_PATTERN_DOMAINS: readonly PatternDomainRule[] = [
  { domain: "spark-perf", artifactKinds: ["spark-notebook", "spark-job"] },
  { domain: "pyspark", artifactKinds: ["spark-notebook", "spark-job", "python-notebook"] },
  { domain: "query-perf", artifactKinds: ["sql-script", "dbt-model", "powerbi"] },
  { domain: "sql", artifactKinds: ["sql-script", "dbt-model"] },
  { domain: "layout", artifactKinds: ["spark-notebook", "spark-job", "sql-script", "dbt-model", "pipeline"] },
  { domain: "cost", artifactKinds: ["project", "subproject", "spark-job", "pipeline", "iac"] },
  { domain: "powerbi", artifactKinds: ["powerbi"] },
  { domain: "ingestion", artifactKinds: ["pipeline", "airflow-dag"] }
];

/** Scales shown at each level (coarse levels show macro decisions, fine levels show micro ones). */
export const DEFAULT_LEVEL_SCALES: Readonly<Record<string, readonly string[]>> = {
  project: ["macro", "medium"], subproject: ["macro", "medium"], artifact: ["macro", "medium", "micro"], step: ["medium", "micro"], operation: ["micro", "medium"]
};

export type PatternMatch = "fact" | "detector" | "artifact-kind";
const MATCH_RANK: Readonly<Record<PatternMatch, number>> = { fact: 0, detector: 1, "artifact-kind": 2 };

export interface PatternCard {
  readonly conceptId: string;
  readonly title: string;
  readonly summary: string;
  readonly decisionPoint: string;
  readonly options: readonly { readonly id: string; readonly title: string; readonly cost: string; readonly risk: string }[];
  readonly chosenOption: string | null;
  readonly matchedBy: PatternMatch;
  readonly evidence: readonly NavFact[];
  readonly origin: ValueOrigin;
}

export interface PatternLabels { readonly none: string }
export const DEFAULT_PATTERN_LABELS: PatternLabels = { none: "No catalogue pattern for {kind} at {level} yet" };

export interface PatternOptions {
  readonly domains?: readonly PatternDomainRule[];
  readonly levelScales?: Readonly<Record<string, readonly string[]>>;
  readonly rationales?: readonly RationaleInput[];
  readonly labels?: PatternLabels;
  /** Cap on theoretical (artifact-kind) cards; fact and detector matches are always shown. */
  readonly maxTheoretical?: number;
}

export function resolvePatterns(
  location: NavLocation,
  facts: readonly NavFact[],
  concepts: readonly ConceptInput[],
  opts: PatternOptions = {}
): SectionResult<PatternCard> {
  const domains = opts.domains ?? DEFAULT_PATTERN_DOMAINS;
  const scales = (opts.levelScales ?? DEFAULT_LEVEL_SCALES)[location.level];
  const labels = opts.labels ?? DEFAULT_PATTERN_LABELS;
  const chosen = new Map<string, string>();
  for (const r of opts.rationales ?? []) if (r.decisionPoint && r.choice.option && !chosen.has(r.decisionPoint)) chosen.set(r.decisionPoint, r.choice.option);

  const cards: PatternCard[] = [];
  for (const c of concepts) {
    const named = facts.filter(f => f.kind === `concept:${c.id}`);
    const detected = facts.filter(f => f.kind.startsWith("detector:") && c.detectors.includes(f.kind.slice("detector:".length)));
    const byKind = domains.some(d => d.domain === c.domain && (d.artifactKinds.includes("*") || d.artifactKinds.includes(location.artifactKind)))
      && (!scales || scales.includes(c.scale));
    const matchedBy: PatternMatch | null = named.length ? "fact" : detected.length ? "detector" : byKind ? "artifact-kind" : null;
    if (!matchedBy) continue;
    const evidence = matchedBy === "fact" ? named : matchedBy === "detector" ? detected : [];
    cards.push({
      conceptId: c.id, title: c.title, summary: c.concept, decisionPoint: c.decisionPoint,
      options: c.options.map(o => ({ id: o.id, title: o.title, cost: o.cost, risk: o.risk })),
      chosenOption: chosen.get(c.decisionPoint) ?? chosen.get(c.id) ?? null,
      matchedBy, evidence,
      origin: evidence.length ? strongestOrigin(evidence.map(f => f.origin)) : "theoretical"
    });
  }
  cards.sort((a, b) => MATCH_RANK[a.matchedBy] - MATCH_RANK[b.matchedBy] || a.conceptId.localeCompare(b.conceptId));
  const max = opts.maxTheoretical ?? Number.POSITIVE_INFINITY;
  let theoretical = 0;
  const shown = cards.filter(c => c.matchedBy !== "artifact-kind" || theoretical++ < max);
  const holes: ContextHole[] = shown.length === 0
    ? [{ reason: fillLabel(labels.none, { kind: location.artifactKind, level: location.level }), fill: "add-catalogue-entry" }]
    : [];
  return { cards: shown, holes, origin: shown.length ? strongestOrigin(shown.map(c => c.origin)) : "static" };
}
