import assert from "node:assert/strict";
import test from "node:test";
import { deriveStatus } from "../src/core/status";

test("all tools plus configuration is ready", () => {
  assert.equal(deriveStatus([{id:"a",label:"A",available:true}], true), "ready");
});

test("some tools detected is partial", () => {
  assert.equal(
    deriveStatus([{id:"a",label:"A",available:true},{id:"b",label:"B",available:false}], false),
    "partial"
  );
});

test("no tools and no config is missing", () => {
  assert.equal(deriveStatus([{id:"a",label:"A",available:false}], false), "missing");
});
