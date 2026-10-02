/** V4-NAV NAVBAR1 surface: the Navigator (secondary side bar or left), fed by the NavHost's NavigationService. */
import type { NavSurface } from "../core/navigation/register";
import { registerNavigator } from "./navigator";

export default ((context, host) => {
  registerNavigator(context, host.nav, { label: (l) => host.label(l), canUp: () => host.nav.canUp(), canDown: () => host.nav.canDown() });
}) satisfies NavSurface;
