/** Standalone binding sources (one line per provider). */
import { LINEAGE_SOURCE } from "./lineage";
import { DATA_FLOW_SOURCE } from "./dataFlow";
import { ENDPOINTS_SOURCE, ENDPOINT_TRACE_SOURCE } from "./endpoints";

export const BINDING_SOURCES: readonly string[] = [
  LINEAGE_SOURCE,
  DATA_FLOW_SOURCE,
  ENDPOINTS_SOURCE, ENDPOINT_TRACE_SOURCE,
];
