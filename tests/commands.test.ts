import assert from "node:assert/strict";
import test from "node:test";
import { buildDatabricksBundleCommand, buildFabricSecurityAuditCommand, buildGrafanaPreviewCommand, buildIaCCommand, quotePowerShellArg, quoteShellArg } from "../src/core/commands";

test("quoteShellArg escapes POSIX single quotes", () => {
  assert.equal(quoteShellArg("a'b", "linux"), `'a'"'"'b'`);
});

test("Databricks command changes directory and validates", () => {
  const command = buildDatabricksBundleCommand("validate", "/tmp/my repo", undefined, "linux");
  assert.match(command, /databricks bundle validate$/);
  assert.match(command, /'\/tmp\/my repo'/);
});

test("Grafana preview requires a configured generator", () => {
  assert.throws(() => buildGrafanaPreviewCommand(""), /generatorCommand/);
});

test("Grafana preview quotes generator and watch path", () => {
  assert.equal(
    buildGrafanaPreviewCommand("npm run dashboards", "src/grafana", "linux"),
    "gcx dev serve --script 'npm run dashboards' --watch 'src/grafana'"
  );
});

test("IaC command is copy-safe and explicit", () => {
  assert.match(buildIaCCommand("tofu", "plan", "/tmp/infra", "linux"), /tofu plan$/);
});
test("PowerShell quoting doubles embedded single quotes", () => {
  assert.equal(quotePowerShellArg("O'Brien"), "'O''Brien'");
});

test("Fabric security audit requires https and quotes inputs", () => {
  assert.throws(
    () => buildFabricSecurityAuditCommand("/tmp/audit.ps1", "http://example.com"),
    /https/
  );
  assert.equal(
    buildFabricSecurityAuditCommand("/tmp/audit.ps1", "https://app.fabric.microsoft.com/item", "user@example.com"),
    "& '/tmp/audit.ps1' -Url 'https://app.fabric.microsoft.com/item' -NoPrompt -User 'user@example.com'"
  );
});
