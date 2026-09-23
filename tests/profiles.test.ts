import assert from "node:assert/strict";
import test from "node:test";
import { validateProjectProfile } from "../src/core/profiles";

test("profile validator accepts a simple project profile", () => {
  assert.deepEqual(
    validateProjectProfile({
      id:"foil",
      title:"FOIL",
      repoBindings:[{id:"control",label:"Control",setting:"foil.controlRoot"}],
      platformBindings:["fabric"]
    }),
    []
  );
});

test("profile validator detects duplicate binding ids", () => {
  const issues = validateProjectProfile({
    id:"x",
    title:"X",
    repoBindings:[
      {id:"repo",label:"One",setting:"a"},
      {id:"repo",label:"Two",setting:"b"}
    ],
    platformBindings:[]
  });
  assert.ok(issues.some(issue => issue.includes("Duplicate")));
});
