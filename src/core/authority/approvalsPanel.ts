/**
 * V5 AUTHPNL1: the "Authority" context section — who may do what, per Location, from typed approvals.
 *
 * Read-only: it lists what is granted (local approvals minted by a DataPass host action, for an exact
 * digest + audience + scope) and what is only claimed (imported labels: a file or exchange that says
 * "approved"/"reviewed"). An imported label never authorizes itself (PM review B5): it is always shown
 * as a claim, even when it names a reviewer. No approval flow here, no agent runtime (AC-V5).
 *
 * Stored approvals are untrusted shapes (workspace state): anything that is not a well-formed local
 * approval is dropped and counted as a hole, never shown as granted. Rows without a location are
 * project-wide and shown at every Location. The authority table is data. Pure (no `vscode`).
 */
import type { NavLocation } from "../navigation/navTypes";
import type { ContextSectionProvider } from "../navigation/context";

export type ApprovalScope = "generation" | "publication";
export type ApprovalAudience = "internal" | "named-reviewers" | "public";
const SCOPES = new Set<string>(["generation", "publication"]);
const AUDIENCES = new Set<string>(["internal", "named-reviewers", "public"]);

/** Per approval scope: the only route that may mint it (data, shown as "who may"). */
export interface AuthorityRule { readonly scope: ApprovalScope; readonly who: string; readonly how: string }
export const AUTHORITY_TABLE: readonly AuthorityRule[] = [
  { scope: "generation", who: "You, locally", how: "DataPass: Approve Brief — for the exact bytes and audience only" },
  { scope: "publication", who: "Nobody through DataPass", how: "publication stays not-authorized; approve it in the publishing tool" }
];

/** A typed local approval (core/publication/brief LocalApproval), optionally tied to a Location node. */
export interface GrantedApproval {
  readonly subjectDigest: string; readonly audience: ApprovalAudience; readonly scope: ApprovalScope;
  readonly approvedBy: "local-user"; readonly approvedAt: string; readonly note?: string;
  readonly locationId?: string;
}
/** A label imported from a file or an exchange: a claim, never a grant. */
export interface ImportedLabel {
  readonly source: string; readonly label: string;
  readonly claimedBy?: string; readonly digest?: string; readonly audience?: string; readonly locationId?: string;
}
export interface AuthorityInput {
  readonly location: NavLocation | null;
  readonly approvals: readonly unknown[];
  readonly imported: readonly ImportedLabel[];
}
export interface AuthorityRow {
  readonly state: "granted" | "claimed";
  readonly approver: string; readonly scope: string; readonly digest: string; readonly audience: string;
  readonly at?: string; readonly source: string; readonly projectWide: boolean; readonly note?: string;
}
export interface AuthorityView {
  readonly rows: readonly AuthorityRow[];
  readonly rules: readonly AuthorityRule[];
  readonly holes: readonly { reason: string }[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const str = (v: unknown, max = 200): string | undefined => typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined;

/** A stored value is a granted approval only if every typed field holds; otherwise undefined. */
export function asGrantedApproval(raw: unknown): GrantedApproval | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const digest = str(a.subjectDigest, 64)?.toLowerCase();
  if (!digest || !HEX64.test(digest)) return undefined;
  if (typeof a.scope !== "string" || !SCOPES.has(a.scope)) return undefined;
  if (typeof a.audience !== "string" || !AUDIENCES.has(a.audience)) return undefined;
  if (a.approvedBy !== "local-user") return undefined;
  const at = str(a.approvedAt, 40);
  if (!at || Number.isNaN(Date.parse(at))) return undefined;
  return {
    subjectDigest: digest, scope: a.scope as ApprovalScope, audience: a.audience as ApprovalAudience,
    approvedBy: "local-user", approvedAt: at, note: str(a.note), locationId: str(a.locationId)
  };
}

const short = (d: string | undefined) => d ? `sha256 ${d.slice(0, 12)}…` : "no digest";
const here = (locationId: string | undefined, location: NavLocation) => !locationId || locationId === location.nodeId;

export function authorityView(input: AuthorityInput): AuthorityView {
  const holes: { reason: string }[] = [];
  const { location } = input;
  if (!location) return { rows: [], rules: AUTHORITY_TABLE, holes: [{ reason: "No location yet: navigate the project to see who may do what here." }] };
  const granted = input.approvals.map(asGrantedApproval);
  const bad = granted.filter(g => !g).length;
  if (bad) holes.push({ reason: `${bad} stored approval(s) are malformed and are not shown as granted.` });
  const ok = granted.filter((g): g is GrantedApproval => !!g);
  const rows: AuthorityRow[] = ok.filter(g => here(g.locationId, location)).map(g => ({
    state: "granted", approver: "You (local)", scope: g.scope, digest: g.subjectDigest, audience: g.audience,
    at: g.approvedAt, source: "local approval", projectWide: !g.locationId, note: g.note
  }));
  for (const l of input.imported.filter(l => here(l.locationId, location))) {
    const digest = str(l.digest, 64)?.toLowerCase() ?? "";
    const matches = digest && ok.some(g => g.subjectDigest === digest && (!l.audience || g.audience === l.audience));
    rows.push({
      state: "claimed", approver: str(l.claimedBy) ? `${str(l.claimedBy)} (claimed)` : "unknown (claimed)",
      scope: str(l.label, 80) ?? "approval", digest, audience: str(l.audience, 40) ?? "unknown",
      source: str(l.source) ?? "imported", projectWide: !l.locationId,
      note: matches ? "A local approval for these bytes exists; that approval grants, not this label." : "Imported label: a claim, never an approval."
    });
  }
  if (!rows.length) holes.push({ reason: "No approval is recorded for this location: nothing is granted here." });
  return { rows, rules: AUTHORITY_TABLE, holes };
}

/** Plain text for the Context view section body. */
export function authorityText(view: AuthorityView): string {
  const line = (r: AuthorityRow) =>
    `• ${r.approver} — ${r.scope} · ${r.audience} · ${short(r.digest || undefined)}${r.at ? ` · ${r.at}` : ""}${r.projectWide ? " · project-wide" : ""} · ${r.source}${r.note ? `\n    ${r.note}` : ""}`;
  const granted = view.rows.filter(r => r.state === "granted");
  const claimed = view.rows.filter(r => r.state === "claimed");
  const parts: string[] = [];
  parts.push("Granted", granted.length ? granted.map(line).join("\n") : "• none");
  if (claimed.length) parts.push("", "Claimed, not granted", claimed.map(line).join("\n"));
  parts.push("", "Who may approve", view.rules.map(r => `• ${r.scope}: ${r.who} (${r.how})`).join("\n"));
  return parts.join("\n");
}

/** Where the provider reads approvals and imported labels from (the extension wires workspace state). */
export interface AuthoritySource { approvals(): readonly unknown[]; imported(): readonly ImportedLabel[] }

/** The Context view provider for the "authority" tab. */
export function authorityProvider(source: AuthoritySource): ContextSectionProvider {
  return {
    tab: "authority",
    provide({ location }) {
      const view = authorityView({ location, approvals: source.approvals(), imported: source.imported() });
      return { body: location ? authorityText(view) : "", origin: "user", holes: view.holes };
    }
  };
}

/** Workspace-state keys written by the WorkSession (work/session.ts KEYS: approvals, exchanges). */
export const AUTHORITY_STATE_KEYS = { approvals: "datapass.v22.approvals", exchanges: "datapass.v22.exchanges" } as const;

/** Reads approvals and claimed briefs from a Memento-like store; read-only. */
export function stateAuthoritySource(state: { get<T>(key: string): T | undefined }): AuthoritySource {
  const list = (key: string): unknown[] => { const v = state.get<unknown>(key); return Array.isArray(v) ? v : []; };
  return {
    approvals: () => list(AUTHORITY_STATE_KEYS.approvals),
    imported: () => list(AUTHORITY_STATE_KEYS.exchanges).flatMap(raw => {
      const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      if (r.kind !== "brief" || r.status !== "claimed-not-granted") return [];
      return [{ source: str(r.file) ?? str(r.label) ?? "imported brief", label: "reviewed-for-generation", digest: str(r.digest, 64) }];
    })
  };
}
