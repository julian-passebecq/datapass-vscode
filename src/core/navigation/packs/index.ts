/** Built-in standalone view packs (one line per pack); resolved catalog = DEFAULT_VIEW_CATALOG + packs, then user overrides. */
import type { ViewCatalog } from "../navTypes";
import { LINEAGE_PACK } from "../bindings/lineage";
import { DATA_FLOW_PACK } from "../bindings/dataFlow";

export const VIEW_PACKS: readonly ViewCatalog["entries"][] = [
  LINEAGE_PACK,
  DATA_FLOW_PACK,
];
