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
