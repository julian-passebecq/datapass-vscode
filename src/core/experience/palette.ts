/**
 * V1-SURF: which DataPass commands the Command Palette lists in each mode.
 *
 * Every command the palette can list is classified here: `null` = listed in every mode (the core),
 * a surface id = listed while that surface is shown. `palette.full` is the Advanced-only surface
 * ("every DataPass command"); a person can also switch it on in any mode through Customize.
 * package.json `menus.commandPalette` must match this table (tests/palette.test.ts): the `when`
 * of a gated command is `!datapass.hidden.<surface>`, as for views (listed before activation).
 *
 * A feature adds its gated commands in its own `*.palette.ts` file (default export: surface id →
 * command ids, without the `datapass.` prefix), collected into out/gen/palette.ts by
 * scripts/gen-registry.mjs (NAVWIRE1), so it never edits the tables below.
 *
 * Hiding a command from the palette is presentation only (D-03 as amended by V1-SURF): the command
 * stays registered, its view and editor menus and keybindings keep working, blockers still show in
 * every mode, and nothing here authorises anything. Pure (no `vscode`).
 */
import { PALETTE } from "../../../out/gen/palette";

/** A `*.palette.ts` file's default export: gating surface id → command ids (no `datapass.` prefix). */
export type PaletteEntry = Readonly<Record<string, readonly string[]>>;

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
  "openHome",
  // V1.1.x-POLISH-4: Home (restore the project layout), Appearance, DataPass back in the Activity Bar.
  "home.restore", "appearance", "showInActivityBar"
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
    // V1.1.x-POLISH-4: also in the status bar, on the Home page, in Appearance and on Alt+- / Alt+=.
    "codeFont.smaller", "codeFont.bigger", "codeFont.reset",
    // V3-AIRFLOW: also in the editor context menu of Python files (the view opens by itself).
    "showAirflowDag",
    "layout.toggleArchitecturePanel",
    // V3-GITDIAG: reached from the editor title / context menus and the diagram legend in the lighter modes.
    "fileVersions.history", "diagram.toggleGitBadges",
    // V3-HOP2: DataPass Hop (the lighter modes are at their palette budget; the editor's context menu,
    // its title button on an explained file and the Home tile reach it in every mode).
    "hop.explain", "hop.showExplained", "workOrders.newForExplanation", "understanding.analyzeSelection",
    // DBT3W: static read of the workspace dbt projects with their profiles.yml targets.
    "understanding.analyzeDbtProjects",
    // V5 EXPLAIN1: export the client-shareable explainer page (the lighter modes are at their palette budget).
    "explain.export",
    // DETACH1: detach a materialized dbt model (authority flip + stamp); also reached from the Project tree section.
    // V5HOLE7: re-attach = a new MAT1 proposal; also on a detached tree row and offered by Detach on a detached model.
    "dbt.detach", "dbt.reattach"
  ],
  // V5 DBTMAT1: dbt model(s) → Fabric notebooks as a MAT1 proposal (TL-5 complement).
  "v5.dbtmat": ["dbt.materialize"],
  // V5 PEDA1b: pedagogy cards bound to the project.
  "v5.peda1b": ["pedagogy.patternCards"],
  // V5 PEDA3: query showcase cards.
  "v5.peda3": ["pedagogy.queriesWorthShowing"]
};

/** Full command id → gating surface id, or null for the core. */
export const PALETTE_TIERS: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  ...CORE.map(c => [`datapass.${c}`, null] as [string, null]),
  ...[GATED, ...PALETTE].flatMap(t => Object.entries(t).flatMap(([surface, cmds]) => cmds.map(c => [`datapass.${c}`, surface] as [string, string])))
]);

/**
 * Commands that exist only while a setting is on (the feature unregisters them when it is off): full command id →
 * the boolean settings, all of which must be true for the palette to list it (V5HOLE9, V5 acceptance row 10).
 */
export const PALETTE_SETTINGS: ReadonlyMap<string, readonly string[]> = new Map([
  ["datapass.pedagogy.patternCards", ["datapass.pedagogy.enabled"]],
  ["datapass.pedagogy.queriesWorthShowing", ["datapass.pedagogy.queryShowcase.enabled"]]
]);

/** The palette `when` clause a command must carry (undefined = none, listed in every mode). */
export const paletteWhen = (command: string): string | undefined => {
  const s = PALETTE_TIERS.get(command);
  const parts = [...(s ? [`!datapass.hidden.${s}`] : []), ...(PALETTE_SETTINGS.get(command) ?? []).map(k => `config.${k}`)];
  return parts.length ? parts.join(" && ") : undefined;
};

/** Commands the palette lists when exactly the given surfaces are shown. */
export function paletteFor(shown: ReadonlySet<string>): string[] {
  return [...PALETTE_TIERS].filter(([, s]) => s === null || shown.has(s)).map(([c]) => c).sort();
}
