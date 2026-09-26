/**
 * Presenting imported authority snapshots honestly: an error is not an empty collection,
 * partial is not complete, and an old snapshot is labelled stale rather than current.
 */
import type { AuthoritySnapshotPayload, Envelope } from "../contracts/envelopes";

export type SnapshotDisplayState = "complete" | "partial" | "empty" | "error" | "not-authorized" | "stale" | "unverified-query";

export interface SnapshotDescription {
  state: SnapshotDisplayState;
  headline: string;
  details: string[];
  usableAsContext: boolean;
}

export function describeSnapshot(
  env: Envelope<"authority-snapshot", AuthoritySnapshotPayload>,
  now: Date,
  opts: { maxAgeHours?: number; knownQueryHashes?: ReadonlySet<string> } = {}
): SnapshotDescription {
  const p = env.payload;
  const ageHours = (now.getTime() - Date.parse(p.asOf)) / 3_600_000;
  const details = [
    `Query ${p.querySpecRef} · as of ${p.asOf} (${ageHours < 1 ? "<1" : Math.round(ageHours)} h ago)`,
    `Sources: ${env.sources.map(s => `${s.authority} ${s.recordRef}@${s.revision}`).join("; ") || "none declared"}`,
    ...(p.omissions.length ? [`Omitted: ${p.omissions.join("; ")}`] : []),
    ...(p.nextCursorAvailable ? ["More records exist beyond this page."] : []),
    "A timestamp is not a consistent snapshot across multiple clusters."
  ];
  if (p.state === "error") return { state: "error", headline: "Source query failed. This is not an empty result.", details, usableAsContext: false };
  if (p.state === "not-authorized") return { state: "not-authorized", headline: "Not authorized for this source. No records were read.", details, usableAsContext: false };
  if (opts.knownQueryHashes && !opts.knownQueryHashes.has(p.querySpecHash.value)) {
    return { state: "unverified-query", headline: "Snapshot was produced by a query that is not in the reviewed QuerySpec set.", details, usableAsContext: false };
  }
  if (ageHours > (opts.maxAgeHours ?? 168)) return { state: "stale", headline: `Snapshot is ${Math.round(ageHours / 24)} days old; refresh before relying on it.`, details, usableAsContext: true };
  if (p.state === "empty") return { state: "empty", headline: "Query succeeded and matched no records.", details, usableAsContext: true };
  if (p.state === "partial") return { state: "partial", headline: `Partial: ${p.recordRefs.length} record(s); coverage is incomplete.`, details, usableAsContext: true };
  return { state: "complete", headline: `Complete for this query: ${p.recordRefs.length} record(s).`, details, usableAsContext: true };
}
