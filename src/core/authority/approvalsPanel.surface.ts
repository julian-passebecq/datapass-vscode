/** V5 AUTHPNL1 surface: the Authority section of the DataPass Context view (read-only, workspace approvals). */
import type { NavSurface } from "../navigation/register";
import { registerContextProvider } from "../navigation/context";
import { authorityProvider, stateAuthoritySource } from "./approvalsPanel";

export default (context => registerContextProvider(authorityProvider(stateAuthoritySource(context.workspaceState)))) satisfies NavSurface;
