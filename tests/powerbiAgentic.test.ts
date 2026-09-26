import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaudeMarketplaceCommand,
  buildClaudePluginInstallCommand,
  buildCopilotMarketplaceCommand,
  buildCopilotPluginInstallCommand,
  isPowerBiAgenticPlugin,
  supportedPowerBiAgenticPlugins
} from "../src/core/powerbiAgentic";

test("Power BI marketplace command is copy-only compatible", () => {
  assert.equal(
    buildCopilotMarketplaceCommand(),
    "copilot plugin marketplace add data-goblin/power-bi-agentic-development"
  );
});

test("Power BI plugin install command targets named marketplace plugin", () => {
  assert.equal(
    buildCopilotPluginInstallCommand("semantic-models"),
    "copilot plugin install semantic-models@power-bi-agentic-development"
  );
});

test("Power BI agentic catalog lists the 11 plugins of the marketplace (marketplace.json, 2026-09-25)", () => {
  const ids = supportedPowerBiAgenticPlugins().map(item => item.id);
  assert.deepEqual([...ids].sort(), [
    "custom-visuals", "etl", "fabric-admin", "fabric-cli", "goblin-mode", "paginated-reports",
    "pbi-desktop", "pbip", "reports", "semantic-models", "tabular-editor"
  ]);
  assert.equal(new Set(ids).size, 11);
  for (const p of supportedPowerBiAgenticPlugins()) assert.ok(p.label && p.description.length > 10, p.id);
});

test("Power BI plugins: Claude Code commands use the same marketplace; unknown plugins are refused", () => {
  assert.equal(buildClaudeMarketplaceCommand(), "claude plugin marketplace add data-goblin/power-bi-agentic-development");
  assert.equal(buildClaudePluginInstallCommand("paginated-reports"), "claude plugin install paginated-reports@power-bi-agentic-development");
  assert.equal(buildCopilotPluginInstallCommand("etl"), "copilot plugin install etl@power-bi-agentic-development");
  assert.ok(isPowerBiAgenticPlugin("goblin-mode"));
  assert.ok(!isPowerBiAgenticPlugin("pbi-search"), "archived repository, not a plugin");
  assert.ok(!isPowerBiAgenticPlugin("pbip; rm -rf ~"));
});
