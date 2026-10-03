/** V4-NAV NAVCAT1 surface: view overrides (customize, hide, reset) at the NavHost's current location and view. */
import type { NavSurface } from "./register";
import { registerViewCatalog } from "./catalogCommands";

export default ((context, host) => {
  registerViewCatalog(context, host.nav, () => host.nav.state.location, () => host.nav.state.viewId);
}) satisfies NavSurface;
