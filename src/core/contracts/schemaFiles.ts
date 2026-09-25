import { SCHEMAS, ENVELOPE_KINDS } from "./envelopes";
import { GRAPH_SCHEMA, V02_ITEM_FIELDS } from "../workspace/graph";
import { PACK_SCHEMA } from "../domainPacks/pack";
import { CLAIMS_REGISTER_SCHEMA } from "../publication/claimsRegister";
import { CATALOG_SCHEMA } from "../project/catalog";
import { OPTIONS_SCHEMA, VALUE_SCHEMA } from "../project/options";
import { SHEET_SCHEMA } from "../project/sheet";
import { BOARD_SCHEMA } from "../project/board";
import { WORK_ORDER_RESULT_SCHEMA, WORK_ORDER_SCHEMA, WORK_ORDER_STATE_SCHEMA } from "../workOrders/format";
import { WORK_LOG_SCHEMA } from "../workOrders/workLog";
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
  out["schemas/datapass-catalog.schema.json"] = withMeta(CATALOG_SCHEMA, "datapass-catalog.schema.json", "DataPass project catalog (1)");
  out["schemas/datapass-options.schema.json"] = withMeta(optionsEditorSchema(), "datapass-options.schema.json", "DataPass architecture options (1)");
  out["schemas/datapass-sheet.schema.json"] = withMeta(SHEET_SCHEMA, "datapass-sheet.schema.json", "DataPass project sheet (1)");
  out["schemas/datapass-board.schema.json"] = withMeta(BOARD_SCHEMA, "datapass-board.schema.json", "DataPass project board (1)");
  out["schemas/datapass-work-order.schema.json"] = withMeta(WORK_ORDER_SCHEMA, "datapass-work-order.schema.json", "DataPass work order (1)");
  out["schemas/datapass-work-order-state.schema.json"] = withMeta(WORK_ORDER_STATE_SCHEMA, "datapass-work-order-state.schema.json", "DataPass work order state (1)");
  out["schemas/datapass-work-order-result.schema.json"] = withMeta(WORK_ORDER_RESULT_SCHEMA, "datapass-work-order-result.schema.json", "DataPass work order result (1)");
  out["schemas/datapass-work-log.schema.json"] = withMeta(WORK_LOG_SCHEMA, "datapass-work-log.schema.json", "DataPass work log (1)");
  return out;
}

const TARGET_MAP = {
  type: "object", maxProperties: 50, description: "Resource names for this environment (function app, bundle target, database…). Never credentials.",
  propertyNames: { pattern: "^[a-z][a-zA-Z0-9_.-]{0,79}$" },
  additionalProperties: { type: "string", minLength: 1, maxLength: 120, pattern: "^[^\\s\"'`]+$" }
};

/** A graph item as editors see it: operation targets are string maps (checked by parseGraph at runtime). */
function editorItem(item: any): any {
  const i = structuredClone(item);
  i.properties.operations.items.properties.target = TARGET_MAP;
  return i;
}

/**
 * The runtime graph validator checks `roles`, `producedFrom` and operation `target` as string maps
 * separately (parseGraph); the editor schema expresses the same rules with propertyNames. It also
 * states that the V3 item fields need `"version": "0.2"`, as parseGraph does.
 */
function graphEditorSchema(): Schema {
  const g = structuredClone(GRAPH_SCHEMA) as unknown as { properties: Record<string, any>; allOf?: unknown[] };
  const map = { type: "object", propertyNames: { pattern: "^[a-z][a-z0-9_.-]{0,79}$" }, additionalProperties: { type: "string", maxLength: 200 } };
  g.properties.roles = map;
  g.properties.outputs.items.properties.producedFrom = map;
  g.properties.items.items = editorItem(g.properties.items.items);
  g.allOf = [{
    if: { properties: { version: { const: "0.1-draft" } } },
    then: { properties: { items: { items: { not: { anyOf: V02_ITEM_FIELDS.map(f => ({ required: [f] })) } } } } }
  }];
  return g as unknown as Schema;
}

/** Options as editors see them: criterion values are a map; added components are graph items. */
function optionsEditorSchema(): Schema {
  const o = structuredClone(OPTIONS_SCHEMA) as unknown as { properties: Record<string, any> };
  const option = o.properties.decisions.items.properties.options.items;
  option.properties.values = { type: "object", maxProperties: 30, description: "Criterion id → value: short text, a number, or { text, score 1–5, note }.", propertyNames: { pattern: "^[a-z][a-z0-9_.-]{0,79}$" }, additionalProperties: VALUE_SCHEMA };
  const changes = option.properties.changes.properties;
  changes.add.items = editorItem(changes.add.items);
  changes.replace.items = editorItem(changes.replace.items);
  return o as unknown as Schema;
}
