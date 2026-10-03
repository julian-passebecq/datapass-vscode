/**
 * V5 GITMR2: the navigation surface that offers the cross-repository history views (lanes, repo → component Sankey)
 * at the project and sub-project levels. Wired by `repoHistory.surface.ts` (NAVWIRE1 generated registry); the binding data comes from
 * `repoHistoryBinding` (core/git/repoHistory.ts). Titles follow the `datapass.repoHistory.labels` setting.
 */
import * as vscode from "vscode";
import type { NavSurface } from "../navigation/register";
import { REPO_HISTORY_LABELS_SETTING, repoHistoryLabels, withRepoHistoryViews } from "./repoHistory";

export const registerRepoHistoryViews: NavSurface = (_context, host) => {
  const apply = () => host.nav.setCatalog(withRepoHistoryViews(host.nav.catalog, repoHistoryLabels(vscode.workspace.getConfiguration("datapass").get(REPO_HISTORY_LABELS_SETTING))));
  apply();
  return vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(`datapass.${REPO_HISTORY_LABELS_SETTING}`)) apply(); });
};
