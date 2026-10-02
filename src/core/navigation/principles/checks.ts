/**
 * V4-NAV NAVPRIN1 principle checks: one pure predicate per `check` id of principles.json, over facts DataPass already
 * holds. Each returns where the project applies the principle, where it breaks it (with why), and holes naming the
 * missing fact family. Never a guess: a fact family the host did not supply gives `unknown`, not `breaks`.
 * `PrincipleFacts` is structural; the host maps layer/role/segment, lineage, write-mode, test and partition facts to it.
 */
import type { NavLocation } from "../navTypes";

export const PRINCIPLE_CHECKS = ["layers", "lineage", "idempotence", "dq-gates", "scd", "partitioning"] as const;
export type PrincipleCheckId = (typeof PRINCIPLE_CHECKS)[number];

/** Canonical layer order (coarse ingest → consumer); aliases map client vocabulary onto it. */
export const LAYER_ORDER = ["staging", "processed", "curated"] as const;
export type CanonicalLayer = (typeof LAYER_ORDER)[number];
export const DEFAULT_LAYER_ALIASES: Readonly<Record<string, CanonicalLayer>> = {
  staging: "staging", stage: "staging", stg: "staging", raw: "staging", landing: "staging", bronze: "staging",
  processed: "processed", intermediate: "processed", int: "processed", clean: "processed", silver: "processed", conformed: "processed",
  curated: "curated", gold: "curated", mart: "curated", marts: "curated", presentation: "curated", serving: "curated",
};

export type WriteMode = "overwrite" | "partition-overwrite" | "merge" | "append" | "unknown";

export interface PrincipleWrite {
  readonly target: string;
  readonly mode: WriteMode;
  /** For `merge`: whether a match key is known (MERGE ON / dbt unique_key / Delta merge condition). */
  readonly keyed?: boolean;
  /** Partition columns written (partitionBy / PARTITIONED BY), when the partition facts are known. */
  readonly partitionBy?: readonly string[];
  /** Row estimate of the target, when volumetry knows it. */
  readonly rows?: number;
}

export interface PrincipleArtifact {
  readonly location: NavLocation;
  /** Layer / role / segment as the project declares or infers it; null = not assigned. */
  readonly layer?: string | null;
  readonly reads?: readonly string[];
  readonly writes?: readonly PrincipleWrite[];
  /** True when a lineage binding links this artifact's inputs and outputs. */
  readonly lineageBound?: boolean;
  /** Tables with a quality check (dbt test, expectation, assertion) on them. */
  readonly checkedTables?: readonly string[];
  /** Targets this artifact snapshots (dbt snapshot, SCD2 merge with validity columns). */
  readonly snapshots?: readonly string[];
}

/** Which fact families the host supplied; an absent family makes its check `unknown`. */
export interface PrincipleFactFamilies {
  readonly layers?: boolean;
  readonly lineage?: boolean;
  readonly writes?: boolean;
  readonly quality?: boolean;
  readonly partitions?: boolean;
}

export interface PrincipleFacts {
  readonly artifacts: readonly PrincipleArtifact[];
  readonly families: PrincipleFactFamilies;
}

export interface PrincipleSettings {
  readonly layerAliases?: Readonly<Record<string, CanonicalLayer>>;
  /** Table-name patterns that mark a dimension (regex sources, case-insensitive). */
  readonly dimensionPatterns?: readonly string[];
  /** Above this row estimate an unpartitioned table breaks the partitioning principle. */
  readonly partitionRowThreshold?: number;
}

export const DEFAULT_DIMENSION_PATTERNS: readonly string[] = ["(^|[._])dim_", "(^|[._])d_", "_dim$", "(^|[._])dimension_"];
export const DEFAULT_PARTITION_ROW_THRESHOLD = 10_000_000;

export interface PrincipleBreak { readonly location: NavLocation; readonly why: string }
export interface PrincipleCheckResult {
  readonly check: PrincipleCheckId;
  readonly status: "applies" | "breaks" | "unknown";
  readonly applies: readonly NavLocation[];
  readonly breaks: readonly PrincipleBreak[];
  readonly holes: readonly { readonly reason: string }[];
}

const key = (l: NavLocation) => `${l.level}:${l.nodeId}`;

function result(check: PrincipleCheckId, applies: NavLocation[], breaks: PrincipleBreak[], holes: { reason: string }[]): PrincipleCheckResult {
  const seen = new Set<string>();
  const uniq = applies.filter(l => !seen.has(key(l)) && (seen.add(key(l)), true));
  const broken = new Set(breaks.map(b => key(b.location)));
  const ok = uniq.filter(l => !broken.has(key(l)));
  const status = breaks.length ? "breaks" : ok.length ? "applies" : "unknown";
  if (status === "unknown" && !holes.length) holes.push({ reason: "no artifact gives evidence for or against this principle" });
  return { check, status, applies: ok, breaks, holes };
}

const missing = (check: PrincipleCheckId, family: string): PrincipleCheckResult =>
  ({ check, status: "unknown", applies: [], breaks: [], holes: [{ reason: `${family} facts not available` }] });

export function canonicalLayer(layer: string | null | undefined, aliases = DEFAULT_LAYER_ALIASES): CanonicalLayer | null {
  if (!layer) return null;
  return aliases[layer.trim().toLowerCase()] ?? null;
}

function producers(facts: PrincipleFacts): Map<string, PrincipleArtifact> {
  const m = new Map<string, PrincipleArtifact>();
  for (const a of facts.artifacts) for (const w of a.writes ?? []) if (!m.has(w.target.toLowerCase())) m.set(w.target.toLowerCase(), a);
  return m;
}

export function checkLayers(facts: PrincipleFacts, s: PrincipleSettings = {}): PrincipleCheckResult {
  if (!facts.families.layers) return missing("layers", "layer / role / segment");
  const aliases = s.layerAliases ?? DEFAULT_LAYER_ALIASES;
  const prod = producers(facts);
  const applies: NavLocation[] = [], breaks: PrincipleBreak[] = [], holes: { reason: string }[] = [];
  for (const a of facts.artifacts) {
    const layer = canonicalLayer(a.layer, aliases);
    if (!layer) {
      if (a.layer) holes.push({ reason: `layer '${a.layer}' of ${a.location.nodeId} is not mapped to staging / processed / curated` });
      else breaks.push({ location: a.location, why: "not assigned to a layer" });
      continue;
    }
    const skipped = (a.reads ?? []).find(t => {
      const p = prod.get(t.toLowerCase());
      const pl = p && p !== a ? canonicalLayer(p.layer, aliases) : null;
      return pl !== null && LAYER_ORDER.indexOf(layer) - LAYER_ORDER.indexOf(pl) > 1;
    });
    if (skipped) breaks.push({ location: a.location, why: `${layer} reads ${skipped} straight from staging, skipping processed` });
    else applies.push(a.location);
  }
  return result("layers", applies, breaks, holes);
}

export function checkLineage(facts: PrincipleFacts): PrincipleCheckResult {
  if (!facts.families.lineage) return missing("lineage", "lineage binding");
  const applies: NavLocation[] = [], breaks: PrincipleBreak[] = [];
  for (const a of facts.artifacts) {
    if (!(a.writes ?? []).length && !(a.reads ?? []).length) continue;
    if (a.lineageBound) applies.push(a.location);
    else breaks.push({ location: a.location, why: "reads or writes tables with no lineage binding" });
  }
  return result("lineage", applies, breaks, []);
}

export function checkIdempotence(facts: PrincipleFacts): PrincipleCheckResult {
  if (!facts.families.writes) return missing("idempotence", "write mode (PySpark / SQL)");
  const applies: NavLocation[] = [], breaks: PrincipleBreak[] = [], holes: { reason: string }[] = [];
  for (const a of facts.artifacts) {
    const ws = a.writes ?? [];
    const append = ws.find(w => w.mode === "append");
    const unkeyed = ws.find(w => w.mode === "merge" && w.keyed === false);
    if (append) breaks.push({ location: a.location, why: `blind append to ${append.target}: a rerun duplicates rows` });
    else if (unkeyed) breaks.push({ location: a.location, why: `merge into ${unkeyed.target} has no match key` });
    else if (ws.some(w => w.mode !== "unknown")) applies.push(a.location);
    for (const w of ws) if (w.mode === "unknown") holes.push({ reason: `write mode of ${w.target} in ${a.location.nodeId} not known` });
  }
  return result("idempotence", applies, breaks, holes);
}

export function checkDqGates(facts: PrincipleFacts, s: PrincipleSettings = {}): PrincipleCheckResult {
  if (!facts.families.quality) return missing("dq-gates", "data-quality test / expectation");
  const aliases = s.layerAliases ?? DEFAULT_LAYER_ALIASES;
  const checked = new Set(facts.artifacts.flatMap(a => a.checkedTables ?? []).map(t => t.toLowerCase()));
  const applies: NavLocation[] = [], breaks: PrincipleBreak[] = [], holes: { reason: string }[] = [];
  if (!facts.families.layers) holes.push({ reason: "layer facts not available: every written table is treated as a boundary" });
  for (const a of facts.artifacts) {
    const layer = canonicalLayer(a.layer, aliases);
    // A boundary = data leaving staging/processed for the next layer; curated outputs feed consumers, also a boundary.
    if (facts.families.layers && layer === "staging") continue;
    const ws = a.writes ?? [];
    if (!ws.length) continue;
    const unchecked = ws.find(w => !checked.has(w.target.toLowerCase()));
    if (unchecked) breaks.push({ location: a.location, why: `no quality check on ${unchecked.target} before the next layer reads it` });
    else applies.push(a.location);
  }
  return result("dq-gates", applies, breaks, holes);
}

export function checkScd(facts: PrincipleFacts, s: PrincipleSettings = {}): PrincipleCheckResult {
  if (!facts.families.writes) return missing("scd", "write mode / snapshot");
  const dims = (s.dimensionPatterns ?? DEFAULT_DIMENSION_PATTERNS).map(p => new RegExp(p, "i"));
  const isDim = (t: string) => dims.some(r => r.test(t));
  const applies: NavLocation[] = [], breaks: PrincipleBreak[] = [], holes: { reason: string }[] = [];
  let found = false;
  for (const a of facts.artifacts) {
    const snaps = new Set((a.snapshots ?? []).map(t => t.toLowerCase()));
    if (snaps.size) { found = true; applies.push(a.location); continue; }
    for (const w of (a.writes ?? []).filter(w => isDim(w.target))) {
      found = true;
      if (w.mode === "merge" && w.keyed !== false) applies.push(a.location);
      else if (w.mode === "overwrite" || w.mode === "append" || w.mode === "partition-overwrite")
        breaks.push({ location: a.location, why: `dimension ${w.target} is ${w.mode === "append" ? "appended" : "overwritten"}: no versioned history (SCD type not chosen)` });
      else holes.push({ reason: `write mode of dimension ${w.target} not known` });
    }
  }
  if (!found) holes.push({ reason: "no dimension table or snapshot found (dimension patterns are a setting)" });
  return result("scd", applies, breaks, holes);
}

export function checkPartitioning(facts: PrincipleFacts, s: PrincipleSettings = {}): PrincipleCheckResult {
  if (!facts.families.partitions) return missing("partitioning", "partition (NAVSQL1)");
  const threshold = s.partitionRowThreshold ?? DEFAULT_PARTITION_ROW_THRESHOLD;
  const applies: NavLocation[] = [], breaks: PrincipleBreak[] = [], holes: { reason: string }[] = [];
  for (const a of facts.artifacts) {
    for (const w of a.writes ?? []) {
      if (w.partitionBy?.length) applies.push(a.location);
      else if (w.rows === undefined) holes.push({ reason: `${w.target} is not partitioned and its volume is unknown` });
      else if (w.rows > threshold) breaks.push({ location: a.location, why: `${w.target} (~${w.rows.toLocaleString("en-US")} rows) is not partitioned` });
    }
  }
  return result("partitioning", applies, breaks, holes);
}

const CHECKS: Readonly<Record<PrincipleCheckId, (f: PrincipleFacts, s: PrincipleSettings) => PrincipleCheckResult>> = {
  layers: checkLayers, lineage: checkLineage, idempotence: checkIdempotence,
  "dq-gates": checkDqGates, scd: checkScd, partitioning: checkPartitioning,
};

export function isPrincipleCheck(id: string): id is PrincipleCheckId { return (PRINCIPLE_CHECKS as readonly string[]).includes(id); }

/** Runs one check; an unknown check id is a hole, not an error (card text is data and may name a future check). */
export function runPrincipleCheck(id: string, facts: PrincipleFacts, s: PrincipleSettings = {}): PrincipleCheckResult | { check: string; status: "unknown"; applies: []; breaks: []; holes: { reason: string }[] } {
  if (!isPrincipleCheck(id)) return { check: id, status: "unknown", applies: [], breaks: [], holes: [{ reason: `no check '${id}' in this DataPass version` }] };
  return CHECKS[id](facts, s);
}
