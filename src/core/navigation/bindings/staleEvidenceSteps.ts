/**
 * TODOSTALE1 Next-steps source "stale evidence": a verdict pinned (EVPIN1) to a file state that no longer
 * matches the file is a todo. One row per Location (several stale verdicts at one Location are counted in one
 * row), linking to the view that shows the verdict. No ranking (TODORANK1 deferred). Labels are data
 * (STALE_EVIDENCE_LABELS, overridable through the facts). Pure (no `vscode`, no I/O): the host reads the
 * current file state (src/core/evidence/pin.ts `currentFileState`) and passes it in.
 */
import type { NavLocation } from "../navTypes";
import type { NextStepItem, NextStepSource } from "./nextStepSources";

export const STALE_EVIDENCE_SOURCE_ID = "stale-evidence";

/**
 * Stub of EVPIN1 (`src/core/evidence/pin.ts`, Common project-contracts evidence-pin/1), structurally the same
 * as its `EvidencePin` / `CurrentFileState`. When EVPIN1 merges, import those types and `pinState` instead.
 */
export interface StalePin { readonly gitSha: string | null; readonly artifactDigest: { readonly algorithm: string; readonly value: string } }
export interface StaleFileState { readonly gitSha: string | null; readonly artifactDigest: { readonly algorithm: string; readonly value: string } | null }
export type PinFreshness = "current" | "stale" | "unpinned";

/** Same rule as EVPIN1 `pinState`: the exact-bytes digest decides, the Git SHA too when both sides know it; a gone file is stale. */
export function pinFreshness(pin: StalePin | null, now: StaleFileState | null): PinFreshness {
  if (pin === null) return "unpinned";
  if (now === null) return "stale";
  const digestKnown = now.artifactDigest !== null;
  const shaKnown = pin.gitSha !== null && now.gitSha !== null;
  if (!digestKnown && !shaKnown) return "stale";
  if (digestKnown && (now.artifactDigest!.algorithm !== pin.artifactDigest.algorithm || now.artifactDigest!.value !== pin.artifactDigest.value)) return "stale";
  if (shaKnown && now.gitSha !== pin.gitSha) return "stale";
  return "current";
}

/** One pinned verdict and the state of its file now (`null` = the file is gone). */
export interface PinnedVerdictFact {
  /** The Location the verdict is about; null = project root. */
  readonly location: NavLocation | null;
  readonly subjectKey: string;
  readonly pin: StalePin | null;
  readonly now: StaleFileState | null;
  /** The view that shows the verdict (row click opens it). */
  readonly viewId?: string;
}

export interface StaleEvidenceLabels {
  /** `{subject}` `{sha}` placeholders. */
  readonly one: string;
  /** `{count}` placeholder. */
  readonly many: string;
  /** Appended when the file is gone. */
  readonly gone: string;
  readonly notInGit: string;
}

/** Default labels (data; a setting may replace any of them). */
export const STALE_EVIDENCE_LABELS: StaleEvidenceLabels = {
  one: "Stale evidence: {subject} was computed on {sha}; the file changed since — recompute it",
  many: "Stale evidence: {count} verdicts here were computed on an older file — recompute them",
  gone: " (file gone)",
  notInGit: "a file not in Git",
};

export interface StaleEvidenceStepFacts {
  readonly verdicts: readonly PinnedVerdictFact[];
  readonly labels?: Partial<StaleEvidenceLabels>;
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
const locKey = (l: NavLocation | null) => (l ? `${l.level}:${l.nodeId}` : "");

/** One row per Location that holds at least one stale verdict. */
export function staleEvidenceItems(facts: StaleEvidenceStepFacts): NextStepItem[] {
  const labels = { ...STALE_EVIDENCE_LABELS, ...facts.labels };
  const byLocation = new Map<string, PinnedVerdictFact[]>();
  for (const v of facts.verdicts) {
    if (pinFreshness(v.pin, v.now) !== "stale") continue;
    const k = locKey(v.location);
    (byLocation.get(k) ?? byLocation.set(k, []).get(k)!).push(v);
  }
  return [...byLocation.values()].map(stale => {
    const first = stale[0]!;
    const subjects = new Set(stale.map(v => v.subjectKey));
    const text = subjects.size === 1
      ? fill(labels.one, { subject: first.subjectKey, sha: first.pin!.gitSha ? first.pin!.gitSha.slice(0, 7) : labels.notInGit }) + (first.now === null ? labels.gone : "")
      : fill(labels.many, { count: String(subjects.size) });
    const viewId = stale.find(v => v.viewId)?.viewId;
    return { location: first.location, kind: "stale", text, severity: "warning", origin: "observed", ...(viewId ? { viewId } : {}) } as const;
  });
}

export const STALE_EVIDENCE_STEPS: NextStepSource = {
  id: STALE_EVIDENCE_SOURCE_ID,
  collect: facts => (facts.staleEvidence ? staleEvidenceItems(facts.staleEvidence) : []),
};
