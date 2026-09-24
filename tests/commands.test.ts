import assert from "node:assert/strict";
import test from "node:test";
import { inDirectory, shellWord, buildDatabricksBundleCommand, buildFabricAssessmentCommand, buildFabricCliCommand, buildFabricDeployCommand, buildFabricSecurityAuditCommand, fabricCliArgs, buildGrafanaPreviewCommand, buildIaCCommand, quotePowerShellArg, quoteShellArg } from "../src/core/commands";

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
  for (const platform of ["linux", "win32"] as const) {
    assert.equal(buildFabricCliCommand("auth-status", undefined, platform), "fab auth status");
    assert.equal(buildFabricCliCommand("list-workspaces", undefined, platform), "fab ls");
  }
  assert.equal(
    buildFabricCliCommand("list-workspace-items", "FOIL Wind Lab", "linux"),
    "fab ls 'FOIL Wind Lab.Workspace' -l"
  );
});

test("Fabric CLI does not duplicate .Workspace suffix", () => {
  assert.equal(
    buildFabricCliCommand("list-workspace-items", "FOIL.Workspace", "linux"),
    "fab ls FOIL.Workspace -l"
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

test("Windows commands target PowerShell 5.1 and 7: no &&, literal quotes, stop on a missing directory", () => {
  const command = buildDatabricksBundleCommand("deploy", "D:\\PROJ\\my repo", undefined, "win32");
  assert.equal(command, "Set-Location -LiteralPath 'D:\\PROJ\\my repo'; if ($?) { databricks bundle deploy }");
  assert.doesNotMatch(command, /&&/);
  assert.equal(buildIaCCommand("tofu", "validate", "C:\\infra", "win32"), "Set-Location -LiteralPath 'C:\\infra'; if ($?) { tofu validate }");
  assert.equal(buildDatabricksBundleCommand("run", "C:\\b", "my job", "win32"), "Set-Location -LiteralPath 'C:\\b'; if ($?) { databricks bundle run 'my job' }");
});

test("Windows quoting is literal in PowerShell: $ and backticks cannot expand", () => {
  assert.equal(quoteShellArg("Sales $env:USERNAME `whoami`", "win32"), "'Sales $env:USERNAME `whoami`'");
  assert.equal(buildFabricCliCommand("list-workspace-items", "O'Neil $Lab", "win32"), "fab ls 'O''Neil $Lab.Workspace' -l");
});

test("shellWord leaves plain tokens bare and quotes the rest", () => {
  assert.equal(shellWord("dev", "linux"), "dev");
  assert.equal(shellWord("-l", "win32"), "-l");
  assert.equal(shellWord("a b", "linux"), "'a b'");
  assert.equal(shellWord("a,b", "win32"), "'a,b'", "a comma builds an array in PowerShell");
  assert.equal(shellWord("@x", "win32"), "'@x'", "a leading @ splats in PowerShell");
  assert.equal(shellWord("C:\\x", "linux"), "'C:\\x'", "a backslash escapes in POSIX shells");
});

test("inDirectory resolves with the target platform's path rules, not the host's", () => {
  assert.equal(inDirectory("/tmp/x", "true", "linux"), "cd '/tmp/x' && true");
  assert.match(inDirectory("C:\\x\\..\\y", "true", "win32"), /^Set-Location -LiteralPath 'C:\\y';/);
});
