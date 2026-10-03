/**
 * V5HOLE11: the automatic Workbench landing never steals the keyboard. It opens with preserveFocus,
 * once per install, and never over editors the person already opened (an open Quick Pick closed
 * mid-selection in V5 acceptance row 05).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AUTO_OPEN, autoLandingAllowed, LANDING_SHOWN_KEY } from "../src/core/experience/landing";

test("V5HOLE11: the automatic landing is once per install and only onto an empty editor area", () => {
  assert.equal(autoLandingAllowed({ alreadyShown: false, openTabs: 0 }), true, "first run, nothing open: the welcome landing");
  assert.equal(autoLandingAllowed({ alreadyShown: true, openTabs: 0 }), false, "never again on later activations");
  assert.equal(autoLandingAllowed({ alreadyShown: false, openTabs: 1 }), false, "a file is open: the person is working");
  assert.equal(autoLandingAllowed({ alreadyShown: true, openTabs: 3 }), false);
  assert.equal(AUTO_OPEN.preserveFocus, true);
  assert.ok(Object.isFrozen(AUTO_OPEN));
  assert.equal(LANDING_SHOWN_KEY, "datapass.landing.shown");
});

test("V5HOLE11: the startup path opens the Workbench with preserveFocus and through the gate", () => {
  const ext = readFileSync("src/extension.ts", "utf8");
  const land = /const landOnWorkbench = \(\) => \{ host\.openPanel\(([^;]*)\); \};/.exec(ext);
  assert.ok(land, "landOnWorkbench is defined");
  assert.match(land[1]!, /AUTO_OPEN\.preserveFocus\s*$/, "the automatic open keeps the keyboard");
  assert.match(ext, /landed = landOnArchitecture\([^)]*landOnWorkbench, autoLanding\)/, "startup passes the once-per-install gate");
  const exp = readFileSync("src/work/experienceCommands.ts", "utf8");
  const gate = exp.indexOf("autoLandingAllowed(");
  assert.ok(gate > 0 && gate < exp.indexOf("openWorkbench();"), "the gate runs before the Workbench opens");
  // Every other automatic Workbench open (Hop's way back, a work view) keeps the keyboard too.
  assert.match(readFileSync("src/views/hop.ts", "utf8"), /this\.workbench\.openPanel\(column, "architecture", undefined, true\)/);
});
