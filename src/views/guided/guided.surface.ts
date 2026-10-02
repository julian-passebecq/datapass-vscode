/** V5 TOUR2 surface: guided mode over NAVTOUR1's tours; follows `datapass.guided.enabled` and NavTours' life. */
import type { NavSurface } from "../../core/navigation/register";
import { registerGuided } from "./guided";

export default ((context, host) => registerGuided(context, host)) satisfies NavSurface;
