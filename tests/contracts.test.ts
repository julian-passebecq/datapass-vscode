import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseStrictJson } from "../src/core/model/strictJson";
import { SCHEMAS, ENVELOPE_KINDS } from "../src/core/contracts/envelopes";
import { checkResult, validateEnvelope } from "../src/core/contracts/validate";
import { isRfc3339 } from "../src/core/contracts/schemaDsl";

const FIX = join(__dirname, "fixtures", "contract-kit");
const read = (name: string) => readFileSync(join(FIX, name));
const json = (name: string) => JSON.parse(read(name).toString("utf8"));
const clone = <T>(v: T): T => structuredClone(v);

const EXAMPLES = {
  io: json("io.example.json"),
  "app-request": json("app-request.example.json"),
  "app-result": json("app-result.example.json"),
  authority: json("authority.example.json"),
  architecture: json("architecture.example.json"),
  brief: json("brief.example.json")
};
const REQUEST_BYTES = read("app-request.example.json");

test("emitted schemas are identical to the Python contract kit (single-source parity)", () => {
  for (const kind of ENVELOPE_KINDS) {
    assert.deepEqual(JSON.parse(JSON.stringify(SCHEMAS[kind])), json(`${kind}.schema.json`), kind);
  }
});

test("all six synthetic kit examples validate", () => {
  for (const [name, doc] of Object.entries(EXAMPLES)) {
    assert.doesNotThrow(() => validateEnvelope(parseStrictJson(JSON.stringify(doc))), name);
  }
});

test("request/result pairing over frozen bytes is accepted", () => {
  assert.doesNotThrow(() => checkResult(REQUEST_BYTES, clone(EXAMPLES["app-result"])));
});

test("pairing is insensitive to key order in base, like the Python kit", () => {
  const result = clone(EXAMPLES["app-result"]);
  const { repositories, manifestHash, scopeRevision } = result.base;
  result.base = { repositories, scopeRevision, manifestHash };
  assert.doesNotThrow(() => checkResult(REQUEST_BYTES, result));
});

test("strict parser rejects duplicate keys, nonfinite values, oversize, prototype keys, trailing data", () => {
  for (const raw of ['{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}', '{"x":1e999}', '{"__proto__":{"a":1}}', '{"a":1} {"b":2}', '{"a":01}']) {
    assert.throws(() => parseStrictJson(raw), raw);
  }
  assert.throws(() => parseStrictJson('"' + "x".repeat(1_048_576) + '"'));
  assert.throws(() => parseStrictJson("[".repeat(40) + "]".repeat(40)));
  assert.throws(() => parseStrictJson(new Uint8Array([0x7b, 0xff, 0x7d])), /UTF-8/);
});

test("strict parser preserves numbers, unicode and escapes like JSON.parse", () => {
  const raw = '{"a":1,"b":1.0,"c":-0,"d":1e-7,"e":"é\\u00e9\\n","f":[true,false,null],"g":{}}';
  assert.deepEqual(parseStrictJson(raw), JSON.parse(raw));
});

test("RFC 3339 date-time checks reject impossible dates", () => {
  assert.equal(isRfc3339("2026-09-24T00:00:00Z"), true);
  assert.equal(isRfc3339("2026-09-24T00:00:00.123+02:00"), true);
  assert.equal(isRfc3339("2026-02-30T00:00:00Z"), false);
  assert.equal(isRfc3339("2026-09-24 00:00:00"), false);
  assert.equal(isRfc3339("not-a-time"), false);
});

test("negative cases from the Python kit are rejected", () => {
  let rejected = 0;
  const reject = (fn: () => unknown, label: string) => {
    assert.throws(fn, label);
    rejected++;
  };
  const bad = (name: keyof typeof EXAMPLES, mutate: (d: any) => void, label: string) => {
    const d = clone(EXAMPLES[name]);
    mutate(d);
    reject(() => validateEnvelope(d), label);
  };
  reject(() => validateEnvelope(null), "null");
  reject(() => checkResult(REQUEST_BYTES, clone(EXAMPLES.io)), "io as result");
  bad("io", d => { d.contractVersion = "999"; }, "version");
  bad("io", d => { d.shell = "echo untrusted"; }, "extra field");
  bad("io", d => { d.sources.push(clone(d.sources[0])); }, "duplicate source");
  bad("io", d => { d.createdAt = "not-a-time"; }, "time");
  bad("io", d => { d.base.manifestHash.value = "invalid"; }, "hash");
  bad("architecture", d => { d.payload.edges[0].target = "absent"; }, "dangling");
  bad("architecture", d => { d.payload.nodes.push(clone(d.payload.nodes[0])); }, "duplicate node");
  bad("architecture", d => { d.payload.publication = "authorized"; }, "publication");
  bad("app-request", d => { d.payload.resultState = "succeeded"; }, "request claiming success");
  bad("app-result", d => { d.payload.executionEvidenceRef = null; }, "success without evidence");
  bad("authority", d => { d.payload.state = "empty"; }, "empty with records");
  bad("authority", d => { d.payload.state = "not-authorized"; }, "failure with records");
  bad("authority", d => { d.payload.omissions = []; }, "partial undescribed");
  bad("brief", d => { d.payload.releaseState = "reviewed-for-generation"; }, "unreviewed claim");
  bad("brief", d => { d.payload.claims[0].sourceRefs = ["unknown-source"]; }, "unknown source");
  const mutations: Array<(d: any) => void> = [
    d => { d.projectRef = "other-company"; },
    d => { d.base.scopeRevision = "newer"; },
    d => { d.payload.inputRefs = ["wrong-input"]; },
    d => { d.payload.requestHash.value = "a".repeat(64); }
  ];
  for (const m of mutations) {
    const wrong = clone(EXAMPLES["app-result"]);
    m(wrong);
    reject(() => checkResult(REQUEST_BYTES, wrong), "wrong result");
  }
  reject(() => checkResult(Buffer.concat([REQUEST_BYTES, Buffer.from(" ")]), clone(EXAMPLES["app-result"])), "changed request bytes");
  reject(() => checkResult(REQUEST_BYTES, clone(EXAMPLES["app-request"])), "request as result");

  const reviewed = clone(EXAMPLES.brief);
  reviewed.payload.releaseState = "reviewed-for-generation";
  reviewed.payload.claims[0].review = "approved";
  assert.doesNotThrow(() => validateEnvelope(clone(reviewed)));
  reviewed.payload.audience = "public";
  reviewed.payload.claims[0].allowedAudiences = ["public"];
  reject(() => validateEnvelope(reviewed), "public brief internal sources");

  // + the 5 strict-parser cases covered above = 29, matching validation-report.json.
  assert.equal(rejected + 5, json("validation-report.json").negative_cases_rejected);
});
