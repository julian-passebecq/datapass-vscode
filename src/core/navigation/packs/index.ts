/** Built-in standalone view packs (one line per pack); resolved catalog = DEFAULT_VIEW_CATALOG + packs, then user overrides. */
import type { ViewCatalog } from "../navTypes";
import { NEXT_STEPS_PACK } from "./nextSteps";

export const VIEW_PACKS: readonly ViewCatalog["entries"][] = [
  NEXT_STEPS_PACK,
];
