import assert from "node:assert/strict";
import test from "node:test";
import { buildSanitizedEnvironmentSnapshot } from "../src/core/snapshot";
import type { GalaxyState } from "../src/core/types";

test("environment snapshot removes local values and detail strings", () => {
  const state: GalaxyState = {
    generatedAt: "2026-09-23T12:00:00Z",
    project: {
      id: "foil",
      title: "FOIL",
      active: true,
      summary: "secret-ish project summary",
      bindings: [
        { id: "control", label: "Control", value: "C:\\Users\\julian\\foil-control-v1", status: "bound" }
      ],
      actions: [
        { id: "x", label: "Run secret command", enabled: true, kind: "run", detail: "token=abc" }
      ]
    },
    platforms: [
      {
        id: "fabric",
        title: "Microsoft Fabric",
        status: "partial",
        summary: "summary",
        tools: [
          { id: "fab", label: "Fabric CLI", available: true, version: "1.2.3", detail: "C:\\private\\fab.exe" }
        ],
        actions: [
          { id: "fabric.login", label: "Login", enabled: true, kind: "run" }
        ],
        details: ["Local Toolbox: C:\\private\\fabric-toolbox"],
        catalog: {
          title: "Fabric Toolbox",
          items: [
            {
              id: "a",
              name: "A",
              category: "Monitoring",
              kind: "tool",
              source: "microsoft/fabric-toolbox",
              actions: []
            }
          ]
        }
      }
    ]
  };

  const snapshot = buildSanitizedEnvironmentSnapshot(state);
  const text = JSON.stringify(snapshot);

  assert.equal(snapshot.project.bindings[0]?.status, "bound");
  assert.equal(snapshot.platforms[0]?.tools[0]?.version, "1.2.3");
  assert.deepEqual(snapshot.platforms[0]?.catalog?.categories, ["Monitoring"]);
  assert.doesNotMatch(text, /Users|private|token=abc|secret command|secret-ish/);
});

test("environment snapshot keeps health counts but drops attention detail", () => {
  const state: GalaxyState = {
    generatedAt: "2026-09-23T12:00:00Z",
    project: {
      id: "demo",
      title: "Demo",
      active: true,
      summary: "Demo",
      bindings: [],
      actions: []
    },
    platforms: [],
    health: {
      overall: "attention",
      platformCounts: { ready: 1, partial: 0, missing: 1, unbound: 0, error: 0 },
      tools: { available: 2, total: 3 },
      bindings: { bound: 0, missing: 0, unknown: 0, total: 0 },
      attention: [
        {
          id: "platform.missing.fabric",
          severity: "warning",
          label: "Microsoft Fabric tooling is missing",
          detail: "C:\\private\\tooling\\detail",
          action: {
            id: "fabric.open",
            label: "Open Fabric",
            enabled: true,
            kind: "open",
            detail: "secret action detail"
          }
        }
      ]
    }
  };

  const snapshot = buildSanitizedEnvironmentSnapshot(state);
  const text = JSON.stringify(snapshot);
  assert.equal(snapshot.health?.overall, "attention");
  assert.equal(snapshot.health?.attention[0]?.label, "Microsoft Fabric tooling is missing");
  assert.doesNotMatch(text, /private|secret action detail|platform\.missing\.fabric/);
});
