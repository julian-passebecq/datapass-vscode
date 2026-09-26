import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  renderSafeFabricDeploymentConfig,
  repositoryPathRelativeToConfig
} from "../src/core/fabricDeployment";

test("safe Fabric deployment config disables unpublish", () => {
  const yaml = renderSafeFabricDeploymentConfig({
    workspaceName: "FOIL Wind Lab",
    repositoryDirectory: "../fabric"
  });
  assert.match(yaml, /workspace: "FOIL Wind Lab"/);
  assert.match(yaml, /repository_directory: "\.\.\/fabric"/);
  assert.match(yaml, /unpublish:\n  skip: true/);
  assert.doesNotMatch(yaml, /bulk|force/i);
});

test("workspace id takes precedence and must be a GUID", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  const yaml = renderSafeFabricDeploymentConfig({
    workspaceName: "ignored",
    workspaceId: id,
    repositoryDirectory: "."
  });
  assert.match(yaml, new RegExp(`workspace_id: "${id}"`));
  assert.doesNotMatch(yaml, /workspace: "ignored"/);
  assert.throws(
    () => renderSafeFabricDeploymentConfig({ workspaceId: "not-a-guid", repositoryDirectory: "." }),
    /GUID/
  );
});

test("repository path is calculated relative to deploy config", () => {
  const root = path.resolve("/tmp/project");
  const config = path.join(root, ".deploy", "fabric.yml");
  assert.equal(repositoryPathRelativeToConfig(config, root), "..");
  assert.equal(
    repositoryPathRelativeToConfig(config, path.join(root, "fabric")),
    "../fabric"
  );
});
