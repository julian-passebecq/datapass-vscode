/** V5 GITMR2 surface (NAVWIRE1 convention): the cross-repository history views, collected by scripts/gen-registry.mjs. */
import type { NavSurface } from "../navigation/register";
import { registerRepoHistoryViews } from "./repoHistorySurface";

export default registerRepoHistoryViews satisfies NavSurface;
