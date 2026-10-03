/**
 * V5 GITMR3: local structural stubs of the three packages it builds on, so it can merge before them.
 *   - GITMR1/GITSPI1 `datapass.repo-set/1` (repos, edges, vendored pins): the subset GITMR3 reads.
 *   - NAVCHG1 `ChangedFile` and `ImpactLineageLike` (lineage-core `datapass.lineage-graph/1` subset).
 *   - PINDRIFT1 `datapass.pin-drift-report/1` (Common `tools/pin-drift`).
 * Same field names and enumerations as those rows; once each is merged, these types become imports and this file goes.
 * Pure types and constants.
 */

// ---- GITMR1 / GITSPI1 repo set (subset) ----
export type RepoEdgeKind = "vendors" | "depends" | "deploys" | "lineage";
export interface RepoSetRepoLike { readonly id: string; readonly path: string; readonly role: string; readonly defaultBranch: string | null }
/** `from` uses `to` (vendors it, depends on it, deploys it or reads its data): impact flows `to` → `from`. */
export interface RepoEdgeLike { readonly from: string; readonly to: string; readonly kind: RepoEdgeKind; readonly reason: string | null }
/** `digest` is prefixed on the wire (`sha256:<hex>`, reviewed shape); no `schemaId` on the repo set. */
export interface VendoredPinLike { readonly repo: string; readonly package: string; readonly pinnedSha: string; readonly sourceRepo: string; readonly version: string | null; readonly digest: string | null }
export interface RepoSetLike { readonly repos: readonly RepoSetRepoLike[]; readonly edges: readonly RepoEdgeLike[]; readonly pins: readonly VendoredPinLike[] }

// ---- NAVCHG1 change set + lineage graph (subset) ----
export type ChangeStatus = "added" | "modified" | "removed" | "renamed";
export interface ChangedFile { readonly path: string; readonly oldPath?: string; readonly status: ChangeStatus }
export interface ImpactLineageLike {
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly name: string; readonly evidence: readonly { readonly locator: { readonly path: string } | null }[] }[];
  readonly edges: readonly { readonly id: string; readonly kind: string; readonly fromId: string; readonly toId: string }[];
}

// ---- PINDRIFT1 report ---- STUB until REPIN8 (project-contracts `pin-drift` subpath, V5FREEZE2)
export const PIN_DRIFT_REPORT_SCHEMA = "datapass.pin-drift-report/1" as const;
export const PIN_STATUSES = ["ok", "behind", "digest-mismatch", "unknown"] as const;
export type PinStatus = (typeof PIN_STATUSES)[number];
export interface PinDriftRow {
  readonly name: string; readonly pinned: string; readonly sha256: string | null; readonly sourceCommit: string | null;
  readonly common: string | null; readonly status: PinStatus; readonly reason: string;
}
export interface PinDriftReport {
  readonly schema: typeof PIN_DRIFT_REPORT_SCHEMA; readonly ref: string; readonly commit: string | null;
  readonly drift: boolean; readonly counts: Readonly<Record<PinStatus, number>>; readonly packages: readonly PinDriftRow[];
}
