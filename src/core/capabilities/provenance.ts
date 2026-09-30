/**
 * Tool provenance: the ONE vocabulary shared with Common's tool catalog (`datapass.tool-catalog/2`,
 * Common MR !135). The standalone keeps its own labels (`publisher` in tools.ts, `source`/`kind` in
 * resources/catalogs/fabric-tools.json); each is mapped here by exactly one function, and nothing
 * else in the extension invents a second provenance vocabulary.
 *
 * Unknown labels map to "community": a label DataPass does not recognise is never promoted to
 * "official".
 */

// TODO(TOOLPROV1): replace with @juliandatapass-group/tool-catalog datapass.tool-catalog/2 once Common !135 is published
export const TOOL_PROVENANCE = ["official", "community", "fork", "accelerator", "sample-reference"] as const;
export type ToolProvenance = (typeof TOOL_PROVENANCE)[number];

export interface ToolProvenanceInfo {
  provenance: ToolProvenance;
  /** Entry id of the canonical upstream: required for "fork", null otherwise. */
  canonicalUpstream: string | null;
}

export function isToolProvenance(value: unknown): value is ToolProvenance {
  return typeof value === "string" && (TOOL_PROVENANCE as readonly string[]).includes(value);
}

const COMMUNITY: ToolProvenanceInfo = { provenance: "community", canonicalUpstream: null };

/**
 * `publisher` of tools.ts / toolchain.ts. "vendor" tools are the vendor's own official products
 * (Databricks, GitLab, Git, Python…), so they are official. A workspace file has no publisher: community.
 */
export function provenanceFromPublisher(publisher: string | undefined): ToolProvenanceInfo {
  switch (publisher) {
    case "microsoft":
    case "vendor":
      return { provenance: "official", canonicalUpstream: null };
    default:
      return COMMUNITY;
  }
}

/**
 * Source repositories of the Fabric tool catalog (fabric-tools.json `source`, "owner/repo"), with
 * the fork's canonical upstream as a Common tool-catalog/2 entry id. Compared case-insensitively.
 */
const FABRIC_SOURCES: Readonly<Record<string, ToolProvenanceInfo>> = {
  "microsoft/fabric-toolbox": { provenance: "accelerator", canonicalUpstream: null },
  "gbrueckl/fabric.toolbox": { provenance: "sample-reference", canonicalUpstream: null },
  "gbrueckl/fabric-cicd": { provenance: "fork", canonicalUpstream: "tool.fabric-cicd" }
};

/**
 * One Fabric catalog entry (fabric-tools.json `source` + `kind`). A known source repository wins;
 * otherwise an item from another microsoft/* repository is an accelerator when its kind says so and
 * official otherwise; anything else is community.
 */
export function provenanceFromFabricTool(item: { source: string; kind: string }): ToolProvenanceInfo {
  const source = item.source.trim().toLowerCase();
  const known = FABRIC_SOURCES[source];
  if (known) return known;
  if (source.startsWith("microsoft/")) {
    return { provenance: item.kind === "accelerator" ? "accelerator" : "official", canonicalUpstream: null };
  }
  return COMMUNITY;
}
