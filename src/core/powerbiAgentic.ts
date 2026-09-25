/**
 * data-goblin/power-bi-agentic-development: a plugin marketplace (skills, sub-agents, hooks) for
 * Claude Code and GitHub Copilot CLI. DataPass only builds the commands to copy; it installs
 * nothing. The plugin list was read from the repository's .claude-plugin/marketplace.json on
 * 2026-09-25 (marketplace version 26.31.5, 11 plugins); both CLIs read that same manifest.
 */
export type PowerBiAgenticPlugin =
  | "goblin-mode"
  | "tabular-editor"
  | "pbi-desktop"
  | "pbip"
  | "semantic-models"
  | "reports"
  | "paginated-reports"
  | "fabric-cli"
  | "fabric-admin"
  | "custom-visuals"
  | "etl";

const REPOSITORY = "data-goblin/power-bi-agentic-development";
const MARKETPLACE = "power-bi-agentic-development";

const PLUGINS: ReadonlyArray<{ id: PowerBiAgenticPlugin; label: string; description: string }> = [
  { id: "goblin-mode", label: "Goblin mode", description: "Set up, audit and improve an agentic Power BI development workspace." },
  { id: "tabular-editor", label: "Tabular Editor", description: "Automate semantic models from the terminal with Tabular Editor." },
  { id: "pbi-desktop", label: "Power BI Desktop", description: "Inspect and query the live Power BI Desktop model (TOM, ADOMD.NET)." },
  { id: "pbip", label: "PBIP", description: "Edit and understand PBIP projects: TMDL, PBIR and the project structure." },
  { id: "semantic-models", label: "Semantic models", description: "Design, build, optimize and review semantic models." },
  { id: "reports", label: "Reports", description: "Build, format, optimize and review interactive reports." },
  { id: "paginated-reports", label: "Paginated reports", description: "Author, validate, publish and test print-ready paginated reports." },
  { id: "fabric-cli", label: "Fabric CLI", description: "Read and change Fabric items through the official Fabric CLI." },
  { id: "fabric-admin", label: "Fabric admin", description: "Audit tenant settings, governance, security groups and Fabric admin state." },
  { id: "custom-visuals", label: "Custom visuals", description: "Build Deneb, Python, R, SVG and pbiviz custom visuals." },
  { id: "etl", label: "ETL", description: "Inspect, query and transform lakehouse data with Spark, Livy and DuckDB." }
];

export function isPowerBiAgenticPlugin(id: string): id is PowerBiAgenticPlugin {
  return PLUGINS.some(p => p.id === id);
}

export function buildCopilotMarketplaceCommand(): string {
  return `copilot plugin marketplace add ${REPOSITORY}`;
}

export function buildCopilotPluginInstallCommand(plugin: PowerBiAgenticPlugin): string {
  return `copilot plugin install ${plugin}@${MARKETPLACE}`;
}

/** Claude Code reads the same marketplace (`claude plugin …`, or `/plugin` inside a session). */
export function buildClaudeMarketplaceCommand(): string {
  return `claude plugin marketplace add ${REPOSITORY}`;
}

export function buildClaudePluginInstallCommand(plugin: PowerBiAgenticPlugin): string {
  return `claude plugin install ${plugin}@${MARKETPLACE}`;
}

/**
 * On Windows, some TMDL paths in the repository exceed 260 characters: `copilot plugin install`
 * stops with "Filename too long" unless long paths are enabled for Windows and Git.
 */
export const WINDOWS_LONG_PATHS_NOTE = "On Windows, enable long paths first (Windows and `git config --global core.longpaths true`), or the install stops with \"Filename too long\".";

export function supportedPowerBiAgenticPlugins(): Array<{ id: PowerBiAgenticPlugin; label: string; description: string }> {
  return PLUGINS.map(p => ({ ...p }));
}
