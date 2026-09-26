import assert from "node:assert/strict";
import test from "node:test";
import { renderFabricPreflightWorkflow } from "../src/core/fabricWorkflow";

test("Fabric preflight workflow is manual and read-only", () => {
  const yaml = renderFabricPreflightWorkflow({
    workspaceName: "FOIL Wind Lab",
    deploymentConfigPath: ".deploy/fabric.yml"
  });

  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /id-token: write/);
  assert.match(yaml, /pip install ms-fabric-cli/);
  assert.match(yaml, /fab auth login --azure-cli/);
  assert.match(yaml, /fab get 'FOIL Wind Lab\.Workspace'/);
  assert.match(yaml, /fab ls 'FOIL Wind Lab\.Workspace' -l/);
  assert.match(yaml, /test -f '\.deploy\/fabric\.yml'/);
  assert.doesNotMatch(yaml, /\bpush:\b|fab deploy|--force|bulk_publish/);
});

test("Fabric preflight workflow uses secret references rather than values", () => {
  const yaml = renderFabricPreflightWorkflow({ workspaceName: "X" });
  assert.match(yaml, /secrets\.AZURE_CLIENT_ID/);
  assert.match(yaml, /secrets\.AZURE_TENANT_ID/);
  assert.match(yaml, /secrets\.AZURE_SUBSCRIPTION_ID/);
  assert.doesNotMatch(yaml, /client-secret|SPN_CLIENT_SECRET/);
});
