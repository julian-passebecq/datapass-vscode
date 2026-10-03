/** V5 TOURSHARE1 surface: "Export Explainer Page with a Tour…" = the EXPLAIN1 export with the tour step required. */
import * as vscode from "vscode";
import type { NavSurface } from "../../core/navigation/register";
import { EXPLAIN_EXPORT_COMMAND } from "./exportCommand";
import { EXPLAIN_EXPORT_TOUR_COMMAND } from "./tourPick";

export default (() => vscode.commands.registerCommand(EXPLAIN_EXPORT_TOUR_COMMAND,
  () => vscode.commands.executeCommand(EXPLAIN_EXPORT_COMMAND, { includeTour: true }))) satisfies NavSurface;
