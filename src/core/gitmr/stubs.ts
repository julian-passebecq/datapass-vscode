/**
 * V5 GITMR3: local structural stubs of the three packages it builds on, so it can merge before them.
 *   - GITMR1/GITSPI1 `datapass.repo-set/1` (repos, edges, vendored pins): the subset GITMR3 reads.
 *   - NAVCHG1 `ChangedFile` and `ImpactLineageLike` (lineage-core `datapass.lineage-graph/1` subset).
 *   - PINDRIFT1 `datapass.pin-drift-report/1`: re-exported from the vendored project-contracts `pin-drift` subpath.
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

// ---- PINDRIFT1 report: vendored project-contracts `pin-drift` subpath (V5FREEZE2) ----
export {
  PIN_DRIFT_REPORT_SCHEMA,
  PIN_DRIFT_STATUSES as PIN_STATUSES,
  type PinDriftStatus as PinStatus,
  type PinDriftRow,
  type PinDriftReport
} from "@juliandatapass-group/project-contracts/pin-drift";
