import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCopilotMarketplaceCommand,
  buildCopilotPluginInstallCommand,
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

test("Power BI agentic catalog contains focused modules only", () => {
  const ids = supportedPowerBiAgenticPlugins().map(item => item.id);
  assert.deepEqual(ids, [
    "pbip",
    "semantic-models",
    "reports",
    "pbi-desktop",
    "tabular-editor",
    "fabric-cli"
  ]);
});
