/** V5 EXPLAIN1 surface: the "export explainer page" command, fed by the NavHost session (root, project). */
import type { NavSurface } from "../../core/navigation/register";
import { registerExplainExport } from "./exportCommand";

export default ((context, host) => registerExplainExport(context, host)) satisfies NavSurface;
