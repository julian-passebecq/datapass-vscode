import assert from "node:assert/strict";
import test from "node:test";
import { buildDatabricksBundleCommand, buildFabricAssessmentCommand, buildFabricCliCommand, buildFabricDeployCommand, buildFabricSecurityAuditCommand, fabricCliArgs, buildGrafanaPreviewCommand, buildIaCCommand, quotePowerShellArg, quoteShellArg } from "../src/core/commands";

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

test("Fabric assessment builds a credential-free Databricks command", () => {
  assert.equal(
    buildFabricAssessmentCommand(
      { source: "databricks", cloud: "azure", workspace: "foil-lab", output: "./assessment output" },
      "linux"
    ),
    "fat assess --source databricks --mode full -o './assessment output' --cloud azure --ws 'foil-lab'"
  );
});

test("Fabric assessment rejects control characters", () => {
  assert.throws(
    () => buildFabricAssessmentCommand({ source: "synapse", output: "./out\nrm -rf /" }, "linux"),
    /control characters/
  );
});

test("Fabric CLI uses official read-only workspace commands", () => {
  assert.equal(buildFabricCliCommand("auth-status"), "fab auth status");
  assert.equal(buildFabricCliCommand("list-workspaces"), "fab ls");
  assert.equal(
    buildFabricCliCommand("list-workspace-items", "FOIL Wind Lab", "linux"),
    "fab ls 'FOIL Wind Lab.Workspace' -l"
  );
});

test("Fabric CLI does not duplicate .Workspace suffix", () => {
  assert.equal(
    buildFabricCliCommand("list-workspace-items", "FOIL.Workspace", "linux"),
    "fab ls 'FOIL.Workspace' -l"
  );
});

test("Fabric CLI read-only args can be executed without a shell", () => {
  assert.deepEqual(
    fabricCliArgs("get-workspace", "FOIL Wind Lab"),
    ["get", "FOIL Wind Lab.Workspace"]
  );
  assert.deepEqual(
    fabricCliArgs("list-workspace-items", "FOIL Wind Lab"),
    ["ls", "FOIL Wind Lab.Workspace", "-l"]
  );
});

test("Fabric deploy command is review-first and never forces execution", () => {
  const command = buildFabricDeployCommand(".deploy/fabric.yml", "dev", "linux");
  assert.equal(command, "fab deploy --config '.deploy/fabric.yml' --target_env 'dev'");
  assert.doesNotMatch(command, /--force|-f\b|bulk_publish/);
});
