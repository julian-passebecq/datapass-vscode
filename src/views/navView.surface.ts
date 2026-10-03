/** V4-NAV NAVHOST1 surface: the DataPass view host, fed by the NavHost (its NavigationService and project map). */
import type { NavSurface } from "../core/navigation/register";
import { registerNavView } from "./navView";

export default ((context, host) => {
  registerNavView(context, host.nav, { projectMap: () => host.projectMap(), labelOf: (l) => host.label(l), hop: (l) => host.hop(l), onDidLoadHop: host.onDidLoadHop,
    repoHistory: () => host.repoHistory(), onDidLoadRepoHistory: host.onDidLoadRepoHistory });
}) satisfies NavSurface;
