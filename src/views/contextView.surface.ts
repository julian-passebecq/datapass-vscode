/** V4-NAV NAVCTX1 surface: the DataPass Context view (bottom panel), fed by the NavHost's NavigationService. */
import type { NavSurface } from "../core/navigation/register";
import { registerContextView } from "./contextView";

export default ((context, host) => {
  registerContextView(context, host.nav);
}) satisfies NavSurface;
