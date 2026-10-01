/**
 * V1-SURF: which DataPass commands the Command Palette lists in each mode.
 *
 * Every command the palette can list is classified here: `null` = listed in every mode (the core),
 * a surface id = listed while that surface is shown. `palette.full` is the Advanced-only surface
 * ("every DataPass command"); a person can also switch it on in any mode through Customize.
 * package.json `menus.commandPalette` must match this table (tests/palette.test.ts): the `when`
 * of a gated command is `!datapass.hidden.<surface>`, as for views (listed before activation).
 *
 * Hiding a command from the palette is presentation only (D-03 as amended by V1-SURF): the command
 * stays registered, its view and editor menus and keybindings keep working, blockers still show in
 * every mode, and nothing here authorises anything. Pure (no `vscode`).
 */

/** Core, listed in every mode (Vanilla has exactly these). */
const CORE = [
  "openClientProject", "switchProject", "selectProjectFolder", "openSwitcher", "refreshProject",
  "openPreparationGuide", "initializeProjectManifest", "openProjectManifest", "upgradeManifest",
  "copyFileContext", "showAiExchange", "copyForAi", "importFromAi", "restoreBackup",
  "validateContract", "checkThisFile", "checkThisRepository", "fileVersions.openVersion", "fileVersions.compare",
  "git.refresh", "git.fetchAll", "checkForUpdates", "getUpdates",
  "cloneRepository", "locateRepository", "openRepositoryWindow", "openRepositoryWeb",
  "experience.switchMode", "experience.customize",
  // V3-HOME: the module dashboard.
  "openHome"
] as const;

/** Gated on a surface: listed while the mode shows it. */
const GATED: Record<string, readonly string[]> = {
  // Standard: the architecture, Details and the selected variant.
  "view.architecture": ["arrangeWorkbench", "previewArchitecture", "clearPreview"],
  "view.details": ["preparationPack", "openComponentFolder", "openComponentEntry", "openNativeTool", "showOperation", "copyComponentCommand", "openCiRuns", "runComponentTest", "showComponentTestReceipts"],
  "status.selectedVariant": ["switchVariant"],
  // DataPass: the Project tree and the Workbench.
  "view.project": ["openWorkbench", "chooseModules", "saveWorkView", "applyWorkView"],
  "project.variantFilter": ["showAllVariants", "showSelectedArchitecture"],
  "project.readiness": ["readinessReport", "checkConnections"],
  "workbench.options": ["openOptions", "recordDecision", "optionsAiContext"],
  "workbench.sheet": ["openSheet"],
  "workbench.toolkit": ["openToolkit"],
  "ai.agent": ["workOrders.new", "workOrders.show", "workOrders.launch", "workOrders.copyForChat", "workOrders.enable"],
  "ai.codexTests": ["codexTests.handToCodex"],
  "ai.pilot": ["pilot.show"],
  // Advanced: the board, the V1 Galaxy and V2 Work views.
  "workbench.board": ["openBoard", "board.moveCard", "board.aiPack"],
  "view.galaxy": ["openGalaxy", "refresh", "recordQualification", "exportQualificationReport", "clearQualificationResults"],
  "view.work": ["work.refresh", "selectScope", "showPreflight"],
  // Advanced only (or switched on by the person): every other command, including the V2
  // app/publication flows and the second-level variants of core ones. (The client-named V1 FOIL
  // profile commands and settings were removed in V1-FOILSURF.)
  "palette.full": [
    "copyEnvironmentSnapshot", "fabric.captureSummary", "fabric.scaffoldDeployConfig", "fabric.copyDeployCommand", "fabric.scaffoldPreflightWorkflow",
    "createAppRequest", "importAppResult", "observeAppRevision", "createCandidate", "analyzeImpact", "prepareBrief", "approveBrief",
    "importOutputManifest", "importAuthoritySnapshot", "exportDiagramCloud", "inspectPowerBiProject", "copyAiContext",
    "diagramCloud.openArchitecture", "diagramCloud.copyAiContext", "diagramCloud.importAiPlan", "diagramCloud.copySummary",
    "migrateManifestToV2", "initGraph", "openGraph", "openCompanionLink", "openResource", "copySshCommand",
    "setSelectedVariant", "openAdfStudio", "recordComponentResult",
    "manageWorkViews", "renameWorkView", "deleteWorkView", "setStartupView", "openWorkbenchFloating",
    "createCompanyWorkspace", "exportCompanyWorkspaces",
    "env.copyKeyName", "env.openFile", "env.copyIdentifier", "copyProjectId", "openPowerOps",
    "exportOptionsComparison", "openOptionsFile", "openSheetFile", "openBoardFile",
    "showRecommendedExtensions", "lookUpId",
    "workOrders.refresh", "workOrders.resume", "workOrders.copyPrompt", "workOrders.markDone", "workOrders.abandon", "workOrders.archive",
    "workOrders.followUp", "workOrders.revise", "workOrders.checkPrFiles", "workOrders.importProposed", "workOrders.publishSummary",
    "workOrders.exportProject", "workOrders.openFolder", "workOrders.newForMissingFiles",
    "codexTests.openLastReport", "codexTests.chooseRepository", "codexTests.refresh", "pilot.enable",
    "fileVersions.openLatest", "fileVersions.lastUpdate", "experience.resetOverrides",
    "control.refresh", "control.copyStartCommand",
    "openProjectLinks", "openLinksFile", "setCodeFontSize",
    // V3-AIRFLOW: also in the editor context menu of Python files (the view opens by itself).
    "showAirflowDag",
    "layout.toggleArchitecturePanel",
    // V3-GITDIAG: reached from the editor title / context menus and the diagram legend in the lighter modes.
    "fileVersions.history", "diagram.toggleGitBadges",
    // V3-HOP2: DataPass Hop (the lighter modes are at their palette budget; the editor's context menu,
    // its title button on an explained file and the Home tile reach it in every mode).
    "hop.explain", "hop.showExplained", "workOrders.newForExplanation",
    // V4-NAV NAVKEYS1: the navigation commands (plain arrows inside the nav views, Shift+Alt+P chords outside them).
    "nav.up", "nav.down", "nav.left", "nav.right", "nav.home", "nav.back", "nav.forward", "nav.pickView"
  ]
};

/** Full command id → gating surface id, or null for the core. */
export const PALETTE_TIERS: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  ...CORE.map(c => [`datapass.${c}`, null] as [string, null]),
  ...Object.entries(GATED).flatMap(([surface, cmds]) => cmds.map(c => [`datapass.${c}`, surface] as [string, string]))
]);

/** The palette `when` clause a command must carry (undefined = none, listed in every mode). */
export const paletteWhen = (command: string): string | undefined => {
  const s = PALETTE_TIERS.get(command);
  return s ? `!datapass.hidden.${s}` : undefined;
};

/** Commands the palette lists when exactly the given surfaces are shown. */
export function paletteFor(shown: ReadonlySet<string>): string[] {
  return [...PALETTE_TIERS].filter(([, s]) => s === null || shown.has(s)).map(([c]) => c).sort();
}
