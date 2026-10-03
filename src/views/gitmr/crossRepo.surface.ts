/** V5 GITMR3 surface (NAVWIRE1 convention): cross-repository impact + Common pin drift, collected by scripts/gen-registry.mjs. */
import type { NavSurface } from "../../core/navigation/register";
import { registerCrossRepoViews } from "./crossRepoViews";

export default registerCrossRepoViews satisfies NavSurface;
