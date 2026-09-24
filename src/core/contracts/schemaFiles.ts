import { SCHEMAS, ENVELOPE_KINDS } from "./envelopes";
import { GRAPH_SCHEMA } from "../workspace/graph";
import { PACK_SCHEMA } from "../domainPacks/pack";
import { CLAIMS_REGISTER_SCHEMA } from "../publication/claimsRegister";
import type { Schema } from "./schemaDsl";

const withMeta = (schema: Schema, id: string, title: string) =>
  ({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://datapass.local/schemas/${id}`, title, ...(schema as object) });

/** Relative path (from the repository root) -> JSON Schema document. */
export function emittedSchemaFiles(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kind of ENVELOPE_KINDS) out[`schemas/contracts/${kind}.schema.json`] = withMeta(SCHEMAS[kind], `contracts/${kind}.schema.json`, `DataPass ${kind} envelope (0.1-draft)`);
  out["schemas/datapass-graph.schema.json"] = withMeta(graphEditorSchema(), "datapass-graph.schema.json", "DataPass project graph (0.1-draft)");
  out["schemas/datapass-domain-pack.schema.json"] = withMeta(PACK_SCHEMA, "datapass-domain-pack.schema.json", "DataPass domain pack (0.1-draft)");
  out["schemas/datapass-claims-register.schema.json"] = withMeta(CLAIMS_REGISTER_SCHEMA, "datapass-claims-register.schema.json", "DataPass claims register (0.1-draft)");
  return out;
}

/**
 * The runtime graph validator checks `roles` and `producedFrom` as string maps separately
 * (parseGraph); the editor schema expresses the same rule with propertyNames.
 */
function graphEditorSchema(): Schema {
  const g = structuredClone(GRAPH_SCHEMA) as unknown as { properties: Record<string, any> };
  const map = { type: "object", propertyNames: { pattern: "^[a-z][a-z0-9_.-]{0,79}$" }, additionalProperties: { type: "string", maxLength: 200 } };
  g.properties.roles = map;
  g.properties.outputs.items.properties.producedFrom = map;
  return g as unknown as Schema;
}
