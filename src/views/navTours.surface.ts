/** V4-NAV NAVTOUR1 surface: journey tours + 'Jump to a box', on while `datapass.guided.enabled` is on. */
import type { NavSurface } from "../core/navigation/register";
import { registerNavTours } from "./navTours";

export default ((context, host) => registerNavTours(context, host)) satisfies NavSurface;
