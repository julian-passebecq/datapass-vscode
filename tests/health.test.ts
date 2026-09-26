import assert from "node:assert/strict";
import test from "node:test";
import { buildGalaxyHealth, platformCountTotal } from "../src/core/health";
import type { PlatformState, ProjectProfileState } from "../src/core/types";

const project: ProjectProfileState = {
  id: "demo",
  title: "Demo",
  active: true,
  summary: "Demo project",
  bindings: [
    { id: "repo", label: "Repository", status: "bound", value: "/tmp/repo" },
    { id: "fabric", label: "Fabric workspace", status: "unknown" }
  ],
  actions: [
    { id: "project.openManifest", label: "Open manifest", enabled: true, kind: "open" }
  ]
};

test("Galaxy health summarizes tools, platforms and bindings", () => {
  const platforms: PlatformState[] = [
    {
      id: "fabric",
      title: "Microsoft Fabric",
      status: "partial",
      summary: "Partial",
      tools: [
        { id: "fab", label: "Fabric CLI", available: true },
        { id: "studio", label: "Fabric Studio", available: false }
      ],
      actions: []
    },
    {
      id: "databricks",
      title: "Databricks",
      status: "ready",
      summary: "Ready",
      tools: [{ id: "db", label: "Databricks", available: true }],
      actions: []
    }
  ];

  const health = buildGalaxyHealth(project, platforms);
  assert.equal(health.overall, "healthy");
  assert.deepEqual(health.tools, { available: 2, total: 3 });
  assert.equal(health.bindings.bound, 1);
  assert.equal(health.bindings.unknown, 1);
  assert.equal(health.platformCounts.partial, 1);
  assert.equal(health.platformCounts.ready, 1);
  assert.equal(platformCountTotal(health), 2);
});

test("Galaxy health surfaces invalid project and platform errors", () => {
  const invalid: ProjectProfileState = {
    id: "invalid-manifest",
    title: "DataPass project",
    active: false,
    summary: "Invalid manifest",
    bindings: [],
    actions: [
      { id: "project.openManifest", label: "Open manifest", enabled: true, kind: "open" }
    ]
  };
  const platforms: PlatformState[] = [
    {
      id: "fabric",
      title: "Microsoft Fabric",
      status: "error",
      summary: "Detection failed",
      tools: [],
      actions: [{ id: "fabric.open", label: "Open Fabric", enabled: true, kind: "open" }]
    }
  ];

  const health = buildGalaxyHealth(invalid, platforms);
  assert.equal(health.overall, "attention");
  assert.equal(health.attention.length, 2);
  assert.equal(health.attention[0]?.severity, "error");
  assert.equal(health.attention[0]?.action?.id, "project.openManifest");
});

test("Missing project binding elevates health to attention", () => {
  const missing: ProjectProfileState = {
    ...project,
    bindings: [{ id: "repo", label: "Repository", status: "missing", value: "/missing" }]
  };
  const health = buildGalaxyHealth(missing, []);
  assert.equal(health.overall, "attention");
  assert.ok(health.attention.some(item => item.id === "binding.missing.repo"));
});
