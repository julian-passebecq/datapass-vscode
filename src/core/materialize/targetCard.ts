/**
 * SJDMAT1 step 3: the EXEC1c decision card "materialize as notebook" / "materialize as Spark job". Both options are always
 * offered; DataPass recommends one from project signals (origin `datapass-guidance`), the user picks (`chooseTarget`,
 * origin `user`), and the pick is the `target` of `materializeDbt`. Pure: no clock, no I/O, no AI call.
 *
 * Stub: EXEC1c's card contract is not in this repository yet. This keeps the same idea (question, options, recommendation
 * with reasons, user choice) under a local schema id; swap the shape for EXEC1c's when it lands. Every label and the
 * threshold are data (`TargetCardText`, `TargetCardPolicy`), never hard-coded in the decision.
 */
import { MATERIALIZATION_TARGETS, type MaterializationTarget } from "./dbtSparkJob";

export const TARGET_CARD_SCHEMA_ID = "datapass.exec1c-card-stub/1" as const;
export const TARGET_CARD_ID = "exec1c.materialization-target" as const;

export type TargetReasonId = "production-environment" | "many-models" | "unit-tests-wanted" | "exploration";

export interface TargetCardSignals {
  /** Number of dbt models that would be materialized. */
  modelCount: number;
  environment: string;
  /** Whether the project wants Python unit tests around the job logic. */
  unitTestsWanted?: boolean;
}

export interface TargetCardPolicy {
  /** Environments treated as production (project setting). */
  productionEnvironments: readonly string[];
  /** From this many models on, the Spark job + wheel is recommended. */
  sparkJobFromModels: number;
}

export interface TargetCardText {
  question: string;
  options: Record<MaterializationTarget, { label: string; summary: string }>;
  reasons: Record<TargetReasonId, string>;
  /** Tag shown next to the recommended option. */
  recommendedTag: string;
  /** Heading of the reasons in the card lines. */
  reasonsHeading: string;
  /** Heading of the person's pick in the card lines. */
  choiceHeading: string;
}

export const DEFAULT_TARGET_CARD_POLICY: TargetCardPolicy = { productionEnvironments: ["prod", "production"], sparkJobFromModels: 5 };

/** Default wording (settings may replace any entry). */
export const DEFAULT_TARGET_CARD_TEXT: TargetCardText = {
  question: "Materialize these dbt models as notebooks or as a Spark job?",
  options: {
    "fabric-notebook": { label: "Materialize as notebook", summary: "One Fabric notebook per model: easy to open, read and run by hand." },
    "spark-job-definition": { label: "Materialize as Spark job", summary: "One Spark job definition + a Python wheel (one module per model, tests stub): versioned, testable production code." }
  },
  reasons: {
    "production-environment": "The target environment is production: packaged, tested code is the safer default.",
    "many-models": "Many models: one job running them in dependency order is easier to operate than many notebooks.",
    "unit-tests-wanted": "Unit tests are wanted: a wheel package can be tested in CI, a notebook hardly.",
    "exploration": "Few models outside production: notebooks are quicker to read and adjust."
  },
  recommendedTag: "recommended",
  reasonsHeading: "Why DataPass recommends it:",
  choiceHeading: "Your choice:"
};

export interface TargetCardOption {
  target: MaterializationTarget;
  label: string;
  summary: string;
  recommended: boolean;
}

export interface TargetCard {
  schemaId: typeof TARGET_CARD_SCHEMA_ID;
  cardId: typeof TARGET_CARD_ID;
  question: string;
  /** Always both targets, in a fixed order. */
  options: TargetCardOption[];
  recommendation: { target: MaterializationTarget; reasonIds: TargetReasonId[]; reasons: string[]; origin: "datapass-guidance" };
  /** The user's pick; null until they choose. DataPass never picks for them. */
  choice: null | { target: MaterializationTarget; origin: "user" };
}

export function materializationTargetCard(
  signals: TargetCardSignals,
  policy: TargetCardPolicy = DEFAULT_TARGET_CARD_POLICY,
  text: TargetCardText = DEFAULT_TARGET_CARD_TEXT
): TargetCard {
  const reasonIds: TargetReasonId[] = [];
  if (policy.productionEnvironments.includes(signals.environment)) reasonIds.push("production-environment");
  if (signals.modelCount >= policy.sparkJobFromModels) reasonIds.push("many-models");
  if (signals.unitTestsWanted) reasonIds.push("unit-tests-wanted");
  const target: MaterializationTarget = reasonIds.length ? "spark-job-definition" : "fabric-notebook";
  if (!reasonIds.length) reasonIds.push("exploration");
  return {
    schemaId: TARGET_CARD_SCHEMA_ID,
    cardId: TARGET_CARD_ID,
    question: text.question,
    options: MATERIALIZATION_TARGETS.map(t => ({ target: t, label: text.options[t].label, summary: text.options[t].summary, recommended: t === target })),
    recommendation: { target, reasonIds, reasons: reasonIds.map(r => text.reasons[r]), origin: "datapass-guidance" },
    choice: null
  };
}

/** Records the user's pick (either option, whatever the recommendation). */
export function chooseTarget(card: TargetCard, target: MaterializationTarget): TargetCard {
  if (!card.options.some(o => o.target === target)) throw new Error(`Unknown materialization target "${target}".`);
  return { ...card, choice: { target, origin: "user" } };
}

/** Optional `targetCard` block of the project config: policy, signals and wording overrides (all data). */
export interface TargetCardSettings {
  policy: TargetCardPolicy;
  text: TargetCardText;
  unitTestsWanted?: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** Reads an untrusted `targetCard` block; anything missing or malformed keeps the default. */
export function parseTargetCardSettings(raw: unknown): TargetCardSettings {
  const r = isObj(raw) ? raw : {};
  const policy: TargetCardPolicy = {
    productionEnvironments: Array.isArray(r.productionEnvironments) && r.productionEnvironments.every(e => typeof e === "string")
      ? (r.productionEnvironments as string[]) : DEFAULT_TARGET_CARD_POLICY.productionEnvironments,
    sparkJobFromModels: typeof r.sparkJobFromModels === "number" && Number.isInteger(r.sparkJobFromModels) && r.sparkJobFromModels > 0
      ? r.sparkJobFromModels : DEFAULT_TARGET_CARD_POLICY.sparkJobFromModels
  };
  const t = isObj(r.text) ? r.text : {};
  const opts = isObj(t.options) ? t.options : {};
  const reasons = isObj(t.reasons) ? t.reasons : {};
  const d = DEFAULT_TARGET_CARD_TEXT;
  const text: TargetCardText = {
    question: str(t.question) ?? d.question,
    options: Object.fromEntries(MATERIALIZATION_TARGETS.map(k => {
      const o = isObj(opts[k]) ? (opts[k] as Record<string, unknown>) : {};
      return [k, { label: str(o.label) ?? d.options[k].label, summary: str(o.summary) ?? d.options[k].summary }];
    })) as TargetCardText["options"],
    reasons: Object.fromEntries((Object.keys(d.reasons) as TargetReasonId[]).map(k => [k, str(reasons[k]) ?? d.reasons[k]])) as TargetCardText["reasons"],
    recommendedTag: str(t.recommendedTag) ?? d.recommendedTag,
    reasonsHeading: str(t.reasonsHeading) ?? d.reasonsHeading,
    choiceHeading: str(t.choiceHeading) ?? d.choiceHeading
  };
  return { policy, text, ...(typeof r.unitTestsWanted === "boolean" ? { unitTestsWanted: r.unitTestsWanted } : {}) };
}

/** Pick items for the card, in the card's fixed order; the recommended one carries the tag and is pre-selected. */
export function targetCardPicks(card: TargetCard, text: TargetCardText = DEFAULT_TARGET_CARD_TEXT): Array<{ target: MaterializationTarget; label: string; description: string; detail: string; picked: boolean }> {
  return card.options.map(o => ({ target: o.target, label: o.label, description: o.recommended ? text.recommendedTag : "", detail: o.summary, picked: o.recommended }));
}

/** The card as text lines (output channel, report). */
export function targetCardLines(card: TargetCard, text: TargetCardText = DEFAULT_TARGET_CARD_TEXT): string[] {
  const lines = [`[${card.cardId}] ${card.question}`];
  for (const o of card.options) lines.push(`  ${o.recommended ? "*" : "-"} ${o.label}${o.recommended ? ` (${text.recommendedTag})` : ""}: ${o.summary}`);
  lines.push(`  ${text.reasonsHeading}`);
  for (const r of card.recommendation.reasons) lines.push(`    ${r}`);
  if (card.choice) {
    const target = card.choice.target;
    lines.push(`  ${text.choiceHeading} ${card.options.find(o => o.target === target)?.label ?? target}`);
  }
  return lines;
}
