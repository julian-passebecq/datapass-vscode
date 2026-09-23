import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  foilProjectManifest,
  genericProjectManifest,
  parseProjectManifest,
  resolveManifestPath,
  validateProjectManifest
} from "../src/core/projectManifestModel";

test("generic manifest creates a portable project id", () => {
  const manifest = genericProjectManifest("My Data Project");
  assert.equal(manifest.project.id, "my-data-project");
  assert.equal(manifest.project.title, "My Data Project");
  assert.deepEqual(validateProjectManifest(manifest), []);
});

test("FOIL template binds repositories without inventing cloud identities", () => {
  const manifest = foilProjectManifest();
  assert.equal(manifest.project.profile, "foil");
  assert.equal(manifest.repositories?.control?.path, "../foil-control-v1");
  assert.equal(manifest.repositories?.databricks?.path, "../foil_databrick_dab");
  assert.equal(manifest.platforms?.fabric?.workspaceId, undefined);
  assert.equal(manifest.platforms?.oracle?.sshHost, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /password|token|clientSecret/i);
});

test("manifest parser rejects invalid links and missing project identity", () => {
  const errors = validateProjectManifest({
    schemaVersion: 1,
    project: { id: "", title: "" },
    links: [{ label: "bad", url: "http://example.com" }]
  });
  assert.ok(errors.some(error => error.includes("project.id")));
  assert.ok(errors.some(error => error.includes("project.title")));
  assert.ok(errors.some(error => error.includes("https://")));
  assert.throws(() => parseProjectManifest(null), /object/);
});

test("manifest paths resolve relative to the workspace root", () => {
  const root = path.resolve("/tmp/project");
  assert.equal(
    resolveManifestPath(root, "../shared"),
    path.resolve("/tmp/shared")
  );
  assert.equal(
    resolveManifestPath(root, "/opt/data"),
    path.normalize("/opt/data")
  );
});
